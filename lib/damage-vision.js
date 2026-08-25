"use strict";
/**
 * Фото лота → перелік пошкоджень → кошторис ремонту в ЦІНАХ УКРАЇНИ.
 *
 * Навіщо окремо від `lots.repair_cost`: там лежить кошторис американського
 * страховика (на Audi S5 2024 — $38 711 при ринку в Україні $49 150), і у
 * вердикт він свідомо не входить — див. CLAUDE.md «The deal verdict is a
 * Ukrainian-side subtraction». Але ремонт існує, і без нього стеля ставки
 * завищена рівно на його суму. Цей модуль дає ту цифру, якої бракувало:
 * скільки коштує полагодити САМЕ ЦЕ авто САМЕ ТУТ.
 *
 * Дві половини, свідомо розділені:
 *   1. `downloadLotPhotos` — фото з `lots.images_json`. CDN `vis.iaai.com`
 *      віддає їх напряму, без проксі (перевірено 2026-08-24: 200, image/jpeg),
 *      і переживає саму сторінку лота, яка через кілька тижнів зникає.
 *   2. `assessDamage` — один виклик vision-моделі з фото, фактами лота і
 *      ДОВІДНИКОМ УКРАЇНСЬКИХ ЦІН. Довідник обов'язковий: без нього модель
 *      назве ціни зі своєї голови, і вони виглядатимуть так само впевнено,
 *      як зміряні. Усе, чого в довіднику немає, мусить лягти в `unknowns[]`.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PHOTO_ROOT =
  process.env.LOT_PHOTO_DIR || path.join(ROOT, "data", "lot-photos");

// Довга сторона знімка для моделі. 2576 px оригіналу — це ~8 800 vision-токенів
// на фото; на 17 фото вийшло б 150 k лише на картинки. 1400 px дає ~1 960
// токенів, і пошкодження на ньому видно так само.
const PHOTO_WIDTH = 1400;

const MODEL = process.env.DAMAGE_MODEL || "claude-opus-5";

/* ------------------------------------------------------------------ фото -- */

/**
 * Перелік знімків лота з підписами.
 *
 * Підписів МЕНШЕ, ніж фото (на лоті 42 — 13 на 17): IAAI підписує лише ті, для
 * яких має назву. Зайві індекси отримують "", а не падають і не зсувають
 * решту — інакше «Manufacturer VIN Plate» поїхав би на чужий кадр.
 */
function photoTargets(lot) {
  var images = parseJson(lot && lot.images_json) || [];
  var captions = parseJson(lot && lot.image_captions) || [];
  return images
    .map(function (img, i) {
      var url = (img && (img.hd || img.thumb || img.url)) || "";
      if (!url) return null;
      return {
        index: i,
        url: url,
        caption: String(img.caption || captions[i] || "").trim(),
        width: Number(img.w) || 0,
        height: Number(img.h) || 0,
      };
    })
    .filter(Boolean);
}

/**
 * Переписує розмір у query CDN-у. `imageKeys` (з `RW2576~H1932` усередині) —
 * це ключ ВИХІДНОГО файлу, його чіпати не можна: зміниш — і резайзер віддасть
 * 404. Керують лише `width`/`height`.
 *
 * Copart віддає прямі .jpg без параметрів — там повертаємо URL як є.
 */
function resizeUrl(url, width, srcW, srcH) {
  var w = Math.round(Number(width) || PHOTO_WIDTH);
  var s = String(url);
  if (s.indexOf("?") < 0 || s.indexOf("width=") < 0) return url;
  var ratio = srcW > 0 && srcH > 0 ? srcH / srcW : 1932 / 2576;
  // Точкова заміна, а НЕ URLSearchParams: той перекодовує `~` у `%7E`, а
  // тильди — роздільники всередині imageKeys, тобто чужого формату ключа.
  // Сьогодні CDN приймає обидві форми (перевірено 2026-08-25: і `~`, і `%7E`
  // дають 200 image/jpeg однакового розміру), але залежати від того, що він і
  // далі їх нормалізуватиме, тут нема потреби — URL лишається байт у байт
  // таким, яким його видав аукціон.
  return s
    .replace(/([?&]width=)\d+/, "$1" + w)
    .replace(/([?&]height=)\d+/, "$1" + Math.round(w * ratio));
}

function slug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function lotDirName(lot) {
  return (
    (lot.auction || "lot") + "-" + (lot.lot_number || lot.lotNumber || lot.id)
  );
}

/**
 * Качає фото на диск і повертає їх у тому ж порядку. Уже завантажене не
 * перекачує — розбір того самого лота вдруге має бути безкоштовним, а
 * сторінка лота до того часу може вже й зникнути.
 */
async function downloadLotPhotos(lot, opts) {
  var options = opts || {};
  var width = options.width || PHOTO_WIDTH;
  var dir = path.join(options.dir || PHOTO_ROOT, lotDirName(lot));
  fs.mkdirSync(dir, { recursive: true });

  var targets = photoTargets(lot);
  var out = [];
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var name =
      String(t.index + 1).padStart(2, "0") +
      (t.caption ? "-" + slug(t.caption) : "") +
      ".jpg";
    var file = path.join(dir, name);
    var cached = fs.existsSync(file) && fs.statSync(file).size > 0;
    if (!cached && !options.dry) {
      var res = await fetch(resizeUrl(t.url, width, t.width, t.height));
      if (!res.ok) {
        out.push({ ...t, file: file, error: "HTTP " + res.status });
        continue;
      }
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    out.push({
      ...t,
      file: file,
      cached: cached,
      // --dry не качає, але вже завантажене має бути видно: інакше «0 на
      // диску» читається як «фото немає», хоча вони є.
      bytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
    });
  }
  return out;
}

/* ----------------------------------------------------------------- промпт -- */

/** Факти лота, які змінюють кошторис. Порожні поля не шлемо взагалі. */
function lotFacts(lot) {
  var rows = [
    ["Рік", lot.year],
    [
      "Марка / модель",
      [lot.make, lot.model, lot.series].filter(Boolean).join(" "),
    ],
    ["Кузов", lot.body_style],
    ["Двигун", lot.engine],
    ["Привід / КПП", [lot.drive, lot.transmission].filter(Boolean).join(" / ")],
    ["Колір", lot.color],
    ["Пробіг, миль", lot.odometer],
    ["Показник пробігу", lot.odometer_brand],
    ["Основне пошкодження (аукціон)", lot.primary_damage],
    ["Додаткове пошкодження (аукціон)", lot.secondary_damage],
    ["Тип збитку", lot.loss_type],
    ["Заводиться", lot.starts],
    ["Заводиться і їде", lot.run_and_drive],
    ["Подушки", lot.airbags],
    ["Перелік подушок з заводу", lot.restraint_system],
    ["Ключі", lot.has_keys],
    ["Каталізатор", lot.catalytic_converter],
    ["Катастрофа (флуд/град)", lot.cat_indicator ? "ТАК" : ""],
    ["Тип документа", lot.title_sale_doc || lot.title_type],
    ["Примітки до документа", lot.title_notes],
    ["Диски / запаска", lot.wheels],
    ["Оцінка аукціону ACV, $", lot.acv],
    ["Кошторис страховика США, $", lot.repair_cost],
  ];
  return rows
    .filter(function (r) {
      return r[1] !== null && r[1] !== undefined && String(r[1]).trim() !== "";
    })
    .map(function (r) {
      return "- " + r[0] + ": " + r[1];
    })
    .join("\n");
}

const SYSTEM_PROMPT = [
  "Ти — оцінювач кузовного цеху в Україні. Тобі дають фото авто з американського",
  "аукціону (Copart/IAAI) і довідник цін українських СТО. Твоє завдання — скласти",
  "кошторис відновлення ЦЬОГО авто В УКРАЇНІ, у доларах США.",
  "",
  "Правила, від яких не відступай:",
  "1. Ціни бери ЛИШЕ з наданого довідника. Якщо позиції в довіднику немає —",
  "   все одно оціни її, але внеси в `unknowns` з поясненням, звідки взялась цифра.",
  "   Не видавай власну оцінку за довідникову.",
  "2. Оцінюй лише те, що ВИДНО на фото або прямо випливає з даних лота.",
  "   Не домальовуй пошкоджень «бо зазвичай так буває». Приховане (радіатори,",
  '   підсилювач, лонжерони за бампером) познач `confidence: "low"` і поясни.',
  "3. Кошторис американського страховика — довідка, а не орієнтир: там ціни США,",
  "   праця США й лише нові оригінальні деталі. В Україні той самий ремонт",
  "   роблять із вживаних/аналогових деталей. Не підганяй підсумок під нього.",
  "4. Деталі: за замовчуванням `used` (розборка/контракт) для кузовщини й оптики",
  "   преміум-марок, `aftermarket` для розхідників, `oem` лише там, де інакше не",
  "   буває (подушки, блоки, скло з датчиками). Вкажи, що саме обрав.",
  "5. `contingencyUsd` — запас на приховане: 10% для локального удару,",
  "   20% для фронтального/структурного. Це окремий рядок, не розмазуй по позиціях.",
  "6. Подушки: якщо в лоті «Airbags: Intact», НЕ став їх у кошторис.",
  "7. Підсумки мусять сходитись: partsTotalUsd + labourTotalUsd + paintTotalUsd",
  "   + contingencyUsd = totalUsd, і сума items[].totalUsd = перші три разом.",
].join("\n");

/** Схема структурованої відповіді — щоб кошторис приходив числами, а не прозою. */
const ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "severity",
    "structural",
    "airbagsDeployed",
    "items",
    "partsTotalUsd",
    "labourTotalUsd",
    "paintTotalUsd",
    "contingencyUsd",
    "totalUsd",
    "unknowns",
    "assumptions",
  ],
  properties: {
    summary: {
      type: "string",
      description: "2–4 речення українською: що видно на фото",
    },
    severity: {
      type: "string",
      enum: ["light", "moderate", "heavy", "severe"],
    },
    structural: {
      type: "boolean",
      description: "Чи зачеплені лонжерони/силова структура",
    },
    airbagsDeployed: { type: "boolean" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "part",
          "action",
          "zone",
          "partsGrade",
          "partCostUsd",
          "labourCostUsd",
          "paintCostUsd",
          "totalUsd",
          "confidence",
          "note",
        ],
        properties: {
          part: { type: "string" },
          action: {
            type: "string",
            enum: ["replace", "repair", "paint", "r&i", "diagnose"],
          },
          zone: {
            type: "string",
            enum: [
              "front",
              "rear",
              "left",
              "right",
              "roof",
              "interior",
              "mechanical",
              "electrical",
              "other",
            ],
          },
          partsGrade: {
            type: "string",
            enum: ["oem", "aftermarket", "used", "none"],
          },
          partCostUsd: { type: "number" },
          labourCostUsd: { type: "number" },
          paintCostUsd: { type: "number" },
          totalUsd: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string" },
        },
      },
    },
    partsTotalUsd: { type: "number" },
    labourTotalUsd: { type: "number" },
    paintTotalUsd: { type: "number" },
    contingencyUsd: { type: "number" },
    totalUsd: { type: "number" },
    unknowns: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
  },
};

/** Блоки user-повідомлення: факти → довідник → кожне фото зі своїм підписом. */
function buildContent(lot, photos, priceBook) {
  var content = [
    {
      type: "text",
      text:
        "ЛОТ\n" +
        lotFacts(lot) +
        "\n\nДОВІДНИК ЦІН УКРАЇНСЬКИХ СТО (" +
        (priceBook.asof || "без дати") +
        ", курс " +
        priceBook.usdUah +
        " грн/$)\n" +
        JSON.stringify(priceBook, null, 1) +
        "\n\nФОТО ЛОТА (" +
        photos.length +
        " шт., у порядку аукціону):",
    },
  ];
  photos.forEach(function (p) {
    if (!fs.existsSync(p.file)) return;
    content.push({
      type: "text",
      text: "Фото " + (p.index + 1) + (p.caption ? " — " + p.caption : ""),
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: fs.readFileSync(p.file).toString("base64"),
      },
    });
  });
  content.push({
    type: "text",
    text: "Склади кошторис відновлення цього авто в Україні за схемою відповіді.",
  });
  return content;
}

/**
 * Перевіряє арифметику кошторису й доводить підсумки до позицій.
 *
 * Підсумок, що не сходиться з позиціями, — найгірший вид помилки тут: він
 * виглядає як зважена цифра, а насправді не спирається на жоден рядок. Тому
 * джерелом правди лишаються `items`, а розбіжність повертається в `drift`.
 */
function reconcile(a) {
  var items = Array.isArray(a.items) ? a.items : [];
  var sum = function (key) {
    return Math.round(
      items.reduce(function (s, it) {
        return s + (Number(it[key]) || 0);
      }, 0),
    );
  };
  var parts = sum("partCostUsd");
  var labour = sum("labourCostUsd");
  var paint = sum("paintCostUsd");
  var contingency = Math.round(Number(a.contingencyUsd) || 0);
  var total = parts + labour + paint + contingency;
  return Object.assign({}, a, {
    partsTotalUsd: parts,
    labourTotalUsd: labour,
    paintTotalUsd: paint,
    contingencyUsd: contingency,
    totalUsd: total,
    drift: Math.round((Number(a.totalUsd) || 0) - total),
  });
}

/* ------------------------------------------------------------------ виклик -- */

let sdkPromise = null;
function anthropic() {
  if (!sdkPromise) {
    sdkPromise = (async function () {
      var Anthropic = require("@anthropic-ai/sdk");
      return new (Anthropic.default || Anthropic)();
    })();
  }
  return sdkPromise;
}

/** Довідник цін. Один файл, датований — як решта docs/*-baseline.md. */
function loadPriceBook() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "ua-repair-rates.json"), "utf8"),
  );
}

async function assessDamage(lot, opts) {
  var options = opts || {};
  var photos = options.photos || (await downloadLotPhotos(lot, options));
  var priceBook = options.priceBook || loadPriceBook();
  var client = await anthropic();

  var res = await client.messages.create({
    model: options.model || MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: ASSESSMENT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildContent(lot, photos, priceBook) }],
  });

  if (res.stop_reason === "refusal") {
    throw new Error(
      "модель відмовила: " + ((res.stop_details || {}).explanation || ""),
    );
  }
  var text = res.content
    .filter(function (b) {
      return b.type === "text";
    })
    .map(function (b) {
      return b.text;
    })
    .join("");

  var assessment = reconcile(JSON.parse(text));
  return {
    assessment: assessment,
    model: res.model,
    photoCount: photos.filter(function (p) {
      return fs.existsSync(p.file);
    }).length,
    priceBookAsof: priceBook.asof,
    usage: res.usage,
  };
}

function parseJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

module.exports = {
  photoTargets,
  resizeUrl,
  downloadLotPhotos,
  lotFacts,
  buildContent,
  reconcile,
  loadPriceBook,
  assessDamage,
  ASSESSMENT_SCHEMA,
  SYSTEM_PROMPT,
  PHOTO_ROOT,
  PHOTO_WIDTH,
};
