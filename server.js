// Локальний сервер: роздає статику + логує результати пошуку ціни в SQLite.
// Запуск: npm start  (Node 24+, вбудований node:sqlite).
// БД: data/searches.db — відкривається будь-яким SQLite-переглядачем.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = process.env.PORT || 5500;
// Тільки локальний інтерфейс. Сервер роздає всю теку проєкту, зокрема
// config.js із ключем AUTO.RIA і адресою CORS-проксі, а /api приймає POST
// без жодної автентифікації і відповідає з Access-Control-Allow-Origin: *.
// На 0.0.0.0 (типовий дефолт http.listen) усе це видно кожному в тій самій
// Wi-Fi мережі. HOST=0.0.0.0 npm start — свідомо відкрити, напр. для
// перевірки з телефона.
const HOST = process.env.HOST || "127.0.0.1";

// ── DB ──────────────────────────────────────────────────────────────
// Шлях до бази перекривається змінною оточення — інакше будь-який запуск
// сервера (зокрема з тесту) чіпав би робочу data/searches.db.
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "searches.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS searches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT    NOT NULL,
    make            TEXT,
    model           TEXT,
    year            INTEGER,
    engine_type     TEXT,
    engine_volume   REAL,
    marka_id        INTEGER,
    model_id        INTEGER,
    model_matched   INTEGER,
    market_price    INTEGER,
    sample_count    INTEGER,
    arithmetic_mean INTEGER,
    iq_mean         INTEGER,
    median          INTEGER,
    total_cost      INTEGER,
    diff            INTEGER,
    category        TEXT,
    prices_json     TEXT,
    percentiles_json TEXT,
    classifieds_json TEXT,
    filters_json    TEXT
  )
`);
// Міграції для вже створених БД (нові колонки)
[
  "prices_json TEXT",
  "percentiles_json TEXT",
  "classifieds_json TEXT",
  "filters_json TEXT",
  "lot_id INTEGER",
  // Кошт ремонту зберігається окремо від total_cost: total_cost — це
  // розмитнене авто на майданчику, а порівнюється з ринком уже сума обох.
  "repair_cost INTEGER",
].forEach(function (col) {
  try {
    db.exec("ALTER TABLE searches ADD COLUMN " + col);
  } catch (e) {
    /* колонка вже існує */
  }
});

// Колонки списку (без важких JSON-масивів) — для таблиці пошуків.
// Префікс s. обов'язковий: запит іде з JOIN на lots, а половина імен
// (id, ts, make, model, year) є в обох таблицях.
const LIST_COLS =
  "s.id, s.ts, s.make, s.model, s.year, s.engine_type, s.engine_volume, " +
  "s.marka_id, s.model_id, s.model_matched, s.market_price, s.sample_count, " +
  "s.arithmetic_mean, s.iq_mean, s.median, s.total_cost, s.repair_cost, " +
  "s.diff, s.category, " +
  "s.lot_id, l.vin, l.vin_full, l.lot_number, l.auction";

// VIN зберігається лише в lots, тож у пошуки він приходить через lot_id.
// LEFT JOIN — старі пошуки без прив'язки до лота лишаються з vin = NULL.
const SEARCH_JOIN = " FROM searches s LEFT JOIN lots l ON l.id = s.lot_id ";

const insertStmt = db.prepare(`
  INSERT INTO searches
    (ts, make, model, year, engine_type, engine_volume, marka_id, model_id,
     model_matched, market_price, sample_count, arithmetic_mean, iq_mean,
     median, total_cost, repair_cost, diff, category, prices_json,
     percentiles_json, classifieds_json, filters_json, lot_id)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// ── Таблиця лотів (повна інформація + HD-фото/відео + сирий JSON) ─────
db.exec(`
  CREATE TABLE IF NOT EXISTS lots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT NOT NULL,
    url           TEXT,
    auction       TEXT,
    lot_number    TEXT,
    vin           TEXT,
    year          INTEGER,
    make          TEXT,
    model         TEXT,
    series        TEXT,
    body_style    TEXT,
    fuel          TEXT,
    engine        TEXT,
    cylinders     TEXT,
    drive         TEXT,
    transmission  TEXT,
    color         TEXT,
    odometer      INTEGER,
    primary_damage   TEXT,
    secondary_damage TEXT,
    title_brand   TEXT,
    title_state   TEXT,
    acv           INTEGER,
    repair_cost   INTEGER,
    buy_now_price INTEGER,
    min_bid       INTEGER,
    selling_branch TEXT,
    branch_state  TEXT,
    sale_date     TEXT,
    interior_color TEXT,
    odometer_brand TEXT,
    loss_type     TEXT,
    run_and_drive TEXT,
    has_keys      TEXT,
    airbags       TEXT,
    vehicle_grade TEXT,
    vehicle_city  TEXT,
    vehicle_state TEXT,
    vehicle_zip   TEXT,
    offsite       INTEGER,
    sale_lane     TEXT,
    title_type    TEXT,
    title_code    TEXT,
    image_count   INTEGER,
    primary_thumb TEXT,
    primary_hd    TEXT,
    image360_url  TEXT,
    images_json   TEXT,
    videos_json   TEXT,
    raw_json      TEXT
  )
`);

// Міграції таблиці лотів. Поля стану авто (біжить/ключі/подушки/тип збитку) і
// фізичне місце зберігання парсер раніше просто викидав, хоча вони є в JSON
// лота і саме на них будується оцінка ремонту та плече до порту.
[
  "interior_color TEXT",
  "odometer_brand TEXT",
  "loss_type TEXT",
  "run_and_drive TEXT",
  "has_keys TEXT",
  "airbags TEXT",
  "vehicle_grade TEXT",
  "vehicle_city TEXT",
  "vehicle_state TEXT",
  "vehicle_zip TEXT",
  "offsite INTEGER",
  "sale_lane TEXT",
  "title_type TEXT",
  "title_code TEXT",
  // Поля стану, які IAAI віддає окремими атрибутами, а парсер до 2026-08-23
  // не читав: «заводиться» (не те саме, що run-and-drive), каталізатор,
  // прапорець стихійного лиха, брелок, примітка до тайтла й гібрид.
  "starts TEXT",
  "catalytic_converter TEXT",
  "cat_indicator INTEGER",
  "cat_text TEXT",
  "key_fob TEXT",
  "title_notes TEXT",
  "hybrid INTEGER",
  // Другий і третій списки key/value з inventoryView (vehicleInformation /
  // vehicleDescription) — парсер до 2026-08-23 читав лише saleInformation.
  "title_sale_doc TEXT",
  "wheels TEXT",
  "manufactured_in TEXT",
  "options TEXT",
  "restraint_system TEXT",
  "who_can_buy TEXT",
  // IAAI віддає VIN замаскованим (`WP1AA2A53RL******`) — і незалогіненому
  // скрейпу, і залогіненому акаунту однаково: останні 6 символів серійника
  // недоступні на сторінці взагалі. Єдине безкоштовне джерело повного VIN —
  // фото заводської таблички (у `imageCaptions` воно підписане
  // «Manufacturer VIN Plate»). Тому маска лишається в `vin` як прийшла з
  // аукціону, а зчитаний з фото повний VIN живе окремо у `vin_full`, і
  // всі сторінки показують `vin_full || vin`.
  "vin_full TEXT",
  // Підписи до фото в порядку їх видачі — саме вони кажуть, який зі знімків
  // є табличкою з VIN. Лежать не в JSON лота, а в HTML сторінки.
  "image_captions TEXT",
].forEach(function (col) {
  try {
    db.exec("ALTER TABLE lots ADD COLUMN " + col);
  } catch (e) {
    /* колонка вже існує */
  }
});

// Дедуплікація лотів за (auction, lot_number): лишаємо найсвіжіший запис
// (max id), решту видаляємо. Потрібно ПЕРЕД створенням унікального індексу,
// інакше індекс не створиться через наявні дублі. Рядки без lot_number
// (NULL) не чіпаємо — це нерозпізнані лоти, кожен лишається окремо.
db.exec(`
  DELETE FROM lots
  WHERE auction IS NOT NULL AND lot_number IS NOT NULL
    AND id NOT IN (
      SELECT MAX(id) FROM lots
      WHERE auction IS NOT NULL AND lot_number IS NOT NULL
      GROUP BY auction, lot_number
    )
`);
// Унікальний ключ лота = (аукціон, номер лота). NULL-номери лишаються
// унікальними (SQLite вважає NULL-и різними), тож нерозпізнані лоти не
// злипаються. Завдяки цьому повторний парсинг того ж лота не дублюється,
// а оновлює наявний рядок (див. ON CONFLICT нижче).
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_lots_auction_lot " +
    "ON lots(auction, lot_number)",
);

// Знаходить id лота за (аукціон, номер лота), щоб прив'язати до нього пошук.
// Готується ПІСЛЯ CREATE TABLE lots: на порожній базі prepare() падає з
// «no such table», і сервер не піднімався взагалі — не було видно лише тому,
// що data/searches.db лежить у репозиторії вже створеною.
const lotIdLookupStmt = db.prepare(
  "SELECT id FROM lots WHERE auction = ? AND lot_number = ?",
);

const LOT_LIST_COLS =
  "id, ts, url, auction, lot_number, vin, vin_full, year, make, model, series, " +
  "body_style, fuel, engine, transmission, color, odometer, primary_damage, " +
  "title_brand, acv, repair_cost, buy_now_price, min_bid, selling_branch, " +
  "branch_state, sale_date, image_count, primary_thumb, primary_hd, " +
  "image360_url, run_and_drive, has_keys, airbags, vehicle_grade, " +
  "vehicle_city, vehicle_state, offsite, title_code, title_type, loss_type, " +
  "starts, catalytic_converter, cat_indicator, key_fob, title_notes, hybrid, " +
  "title_sale_doc, wheels, manufactured_in, who_can_buy";

// Той самий список колонок, але з префіксом l. — для запиту з JOIN на пошуки.
const LOT_LIST_SQL =
  "SELECT " +
  LOT_LIST_COLS.split(", ")
    .map(function (c) {
      return "l." + c;
    })
    .join(", ") +
  // s.repair_cost під псевдонімом: у lots теж є repair_cost (оцінка
  // аукціону), і без нього одна колонка затирала б іншу в рядку відповіді.
  ", s.market_price, s.total_cost, s.repair_cost AS search_repair_cost, " +
  "s.diff, s.category, s.sample_count " +
  "FROM lots l " +
  "LEFT JOIN (SELECT lot_id, MAX(id) AS sid FROM searches " +
  "           WHERE lot_id IS NOT NULL GROUP BY lot_id) last " +
  "  ON last.lot_id = l.id " +
  "LEFT JOIN searches s ON s.id = last.sid " +
  "ORDER BY l.id DESC LIMIT 200";

const insertLotStmt = db.prepare(`
  INSERT INTO lots
    (ts, url, auction, lot_number, vin, year, make, model, series, body_style,
     fuel, engine, cylinders, drive, transmission, color, odometer,
     primary_damage, secondary_damage, title_brand, title_state, acv,
     repair_cost, buy_now_price, min_bid, selling_branch, branch_state,
     sale_date, image_count, primary_thumb, primary_hd, image360_url,
     images_json, videos_json, raw_json, interior_color, odometer_brand,
     loss_type, run_and_drive, has_keys, airbags, vehicle_grade, vehicle_city,
     vehicle_state, vehicle_zip, offsite, sale_lane, title_type, title_code,
     starts, catalytic_converter, cat_indicator, cat_text, key_fob,
     title_notes, hybrid, title_sale_doc, wheels, manufactured_in, options,
     restraint_system, who_can_buy, image_captions)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  -- COALESCE, а не голе excluded: повторний парсинг того самого лота
  -- НЕ має стирати поле, якого цього разу в JSON не виявилось. Саме так
  -- уже губились дані — до 2026-08-22 парсер читав неіснуючі ключі
  -- (Odometer замість ODOValue), і кожен новий парсинг записував порожньо
  -- поверх того, що колись зчиталося правильно. ts і offsite клієнт
  -- надсилає завжди, тож їх перезаписуємо як є.
  ON CONFLICT(auction, lot_number) DO UPDATE SET
    ts=excluded.ts,
    url=COALESCE(excluded.url, url),
    vin=COALESCE(excluded.vin, vin),
    year=COALESCE(excluded.year, year),
    make=COALESCE(excluded.make, make),
    model=COALESCE(excluded.model, model),
    series=COALESCE(excluded.series, series),
    body_style=COALESCE(excluded.body_style, body_style),
    fuel=COALESCE(excluded.fuel, fuel),
    engine=COALESCE(excluded.engine, engine),
    cylinders=COALESCE(excluded.cylinders, cylinders),
    drive=COALESCE(excluded.drive, drive),
    transmission=COALESCE(excluded.transmission, transmission),
    color=COALESCE(excluded.color, color),
    odometer=COALESCE(excluded.odometer, odometer),
    primary_damage=COALESCE(excluded.primary_damage, primary_damage),
    secondary_damage=COALESCE(excluded.secondary_damage, secondary_damage),
    title_brand=COALESCE(excluded.title_brand, title_brand),
    title_state=COALESCE(excluded.title_state, title_state),
    acv=COALESCE(excluded.acv, acv),
    repair_cost=COALESCE(excluded.repair_cost, repair_cost),
    buy_now_price=COALESCE(excluded.buy_now_price, buy_now_price),
    min_bid=COALESCE(excluded.min_bid, min_bid),
    selling_branch=COALESCE(excluded.selling_branch, selling_branch),
    branch_state=COALESCE(excluded.branch_state, branch_state),
    sale_date=COALESCE(excluded.sale_date, sale_date),
    image_count=COALESCE(excluded.image_count, image_count),
    primary_thumb=COALESCE(excluded.primary_thumb, primary_thumb),
    primary_hd=COALESCE(excluded.primary_hd, primary_hd),
    image360_url=COALESCE(excluded.image360_url, image360_url),
    images_json=COALESCE(excluded.images_json, images_json),
    videos_json=COALESCE(excluded.videos_json, videos_json),
    raw_json=COALESCE(excluded.raw_json, raw_json),
    interior_color=COALESCE(excluded.interior_color, interior_color),
    odometer_brand=COALESCE(excluded.odometer_brand, odometer_brand),
    loss_type=COALESCE(excluded.loss_type, loss_type),
    run_and_drive=COALESCE(excluded.run_and_drive, run_and_drive),
    has_keys=COALESCE(excluded.has_keys, has_keys),
    airbags=COALESCE(excluded.airbags, airbags),
    vehicle_grade=COALESCE(excluded.vehicle_grade, vehicle_grade),
    vehicle_city=COALESCE(excluded.vehicle_city, vehicle_city),
    vehicle_state=COALESCE(excluded.vehicle_state, vehicle_state),
    vehicle_zip=COALESCE(excluded.vehicle_zip, vehicle_zip),
    offsite=excluded.offsite,
    sale_lane=COALESCE(excluded.sale_lane, sale_lane),
    title_type=COALESCE(excluded.title_type, title_type),
    title_code=COALESCE(excluded.title_code, title_code),
    starts=COALESCE(excluded.starts, starts),
    catalytic_converter=COALESCE(excluded.catalytic_converter, catalytic_converter),
    cat_indicator=excluded.cat_indicator,
    cat_text=COALESCE(excluded.cat_text, cat_text),
    key_fob=COALESCE(excluded.key_fob, key_fob),
    title_notes=COALESCE(excluded.title_notes, title_notes),
    hybrid=excluded.hybrid,
    title_sale_doc=COALESCE(excluded.title_sale_doc, title_sale_doc),
    wheels=COALESCE(excluded.wheels, wheels),
    manufactured_in=COALESCE(excluded.manufactured_in, manufactured_in),
    options=COALESCE(excluded.options, options),
    restraint_system=COALESCE(excluded.restraint_system, restraint_system),
    who_can_buy=COALESCE(excluded.who_can_buy, who_can_buy),
    image_captions=COALESCE(excluded.image_captions, image_captions)
`);

// Схема, запис і читання перепродажів — у lib/resale-db.js: тим самим кодом
// користується scripts/resale.mjs, тож CLI і API пишуть однакові рядки.
const resaleLib = require("./lib/resale.js");
const resaleDb = require("./lib/resale-db.js").attach(db);

// У колонку url має потрапляти лише http(s)-посилання: одного разу туди
// прилетів скопійований зі сторінки текст, і lots.html відрендерив битий лінк.
function lotUrl(raw, auction, lotNumber) {
  var v = (raw == null ? "" : String(raw)).trim();
  if (/^https?:\/\/[^\s]+$/i.test(v)) return v;
  var n = (lotNumber == null ? "" : String(lotNumber)).trim();
  if (!/^[0-9]{4,12}$/.test(n)) return null;
  if (auction === "iaai")
    return "https://www.iaai.com/VehicleDetail/" + n + "~US";
  if (auction === "copart") return "https://www.copart.com/lot/" + n;
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Перепродажі: запис і читання ─────────────────────────────────────
function readJson(req, cb) {
  var chunks = [];
  req.on("data", function (c) {
    chunks.push(c);
  });
  req.on("end", function () {
    try {
      cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    } catch (e) {
      cb(e);
    }
  });
}

// URL/VIN/id → оголошення + аукціонна історія + landed. Мережа лише тут.
async function resaleLookup(p) {
  const ria = require("./lib/ria.js");
  const vinHistory = require("./lib/vin-history.js");
  const landedLib = require("./lib/landed.js");

  const input = String(p.url || p.autoId || p.vin || "").trim();
  let advert = null;
  let advertRaw = null;
  let vin = "";

  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(input)) {
    // Голий VIN — аукціонний бік є, українського нема. Такий рядок теж має
    // право на життя: ставку ми знаємо, ціну можна дописати руками.
    vin = input.toUpperCase();
  } else {
    const autoId = ria.parseAdvertId(input);
    if (!autoId) throw new Error("не розпізнав ні URL оголошення, ні VIN");
    advertRaw = await ria.fetchAdvert(autoId);
    advert = ria.normalizeAdvert(advertRaw);
    vin = advert.vin || "";
    if (!vin) {
      throw new Error(
        "в оголошенні " + autoId + " немає VIN (продавець його не вказав)",
      );
    }
  }

  const history = await vinHistory.fetchVinHistory(vin);
  let landed = null;
  if (history.found && history.soldPrice > 0) {
    landed = await landedLib.computeLanded(history, history.soldPrice, {
      vehicleType: p.vehicleType,
      destinationPort: p.destinationPort,
      // Ручний штат: без нього лоти без коду штату в Location рахувались би
      // від першої локації довідника, тобто від чужого штату.
      state: p.state,
      riskCoefficient: p.riskCoefficient,
      marketPrice: advert ? advert.priceUsd : p.marketPrice,
    });
  }
  const row = resaleLib.buildResaleRow({
    advert: advert,
    advertRaw: advertRaw,
    history: history,
    landed: landed,
    vin: vin,
    uaRepairCost: p.uaRepairCost,
    overheadCost: p.overheadCost,
    notes: p.notes,
  });
  return { row: row, advert: advert, history: history, landed: landed };
}

// ── Static serving ──────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function serveStatic(req, res) {
  var urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  var filePath = path.join(ROOT, urlPath);
  // Захист від path traversal. Порівнювати треба з ROOT + роздільник, а не з
  // самим ROOT: сусідня тека, чия назва починається так само («…-calculator»
  // → «…-calculator-private»), проходила голий startsWith і роздавалась.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

// ── Server ──────────────────────────────────────────────────────────
const server = http.createServer(function (req, res) {
  var route = req.url.split("?")[0];

  // CORS — щоб сторінки, відкриті через Live Server (:5501) чи file://,
  // могли звертатись до API на :5500.
  if (route.indexOf("/api/") === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // GET /api/searches/:id — повний запис з масивами (для графіків статистики)
  var idMatch = route.match(/^\/api\/searches\/(\d+)$/);
  if (idMatch && req.method === "GET") {
    var row = db
      .prepare(
        "SELECT s.*, l.vin, l.vin_full, l.lot_number, l.auction" +
          SEARCH_JOIN +
          "WHERE s.id = ?",
      )
      .get(Number(idMatch[1]));
    if (!row) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    try {
      row.prices = row.prices_json ? JSON.parse(row.prices_json) : [];
      row.percentiles = row.percentiles_json
        ? JSON.parse(row.percentiles_json)
        : null;
      row.classifieds = row.classifieds_json
        ? JSON.parse(row.classifieds_json)
        : [];
      row.filters = row.filters_json ? JSON.parse(row.filters_json) : [];
    } catch (e) {
      row.prices = [];
      row.percentiles = null;
      row.classifieds = [];
      row.filters = [];
    }
    delete row.prices_json;
    delete row.percentiles_json;
    delete row.classifieds_json;
    delete row.filters_json;
    sendJson(res, 200, row);
    return;
  }

  // GET /api/lots/:id — повний лот з фото/відео/сирим JSON
  var lotIdMatch = route.match(/^\/api\/lots\/(\d+)$/);
  if (lotIdMatch && req.method === "GET") {
    var lot = db
      .prepare("SELECT * FROM lots WHERE id = ?")
      .get(Number(lotIdMatch[1]));
    if (!lot) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    try {
      lot.images = lot.images_json ? JSON.parse(lot.images_json) : [];
      lot.videos = lot.videos_json ? JSON.parse(lot.videos_json) : [];
      lot.raw = lot.raw_json ? JSON.parse(lot.raw_json) : null;
    } catch (e) {
      lot.images = lot.images || [];
      lot.videos = lot.videos || [];
      lot.raw = null;
    }
    delete lot.images_json;
    delete lot.videos_json;
    delete lot.raw_json;
    try {
      lot.image_captions = lot.image_captions
        ? JSON.parse(lot.image_captions)
        : [];
    } catch (e) {
      lot.image_captions = [];
    }
    sendJson(res, 200, lot);
    return;
  }

  // PUT /api/lots/:id/vin — дописати повний VIN, зчитаний з фото заводської
  // таблички. Окремий ендпоінт, а не поле в POST /api/lots: повний VIN не
  // приходить із парсингу взагалі, тож повторний скрейп лота не має жодного
  // шансу його затерти (`vin_full` свідомо відсутній і в UPSERT вище).
  var lotVinMatch = route.match(/^\/api\/lots\/(\d+)\/vin$/);
  if (lotVinMatch && (req.method === "PUT" || req.method === "POST")) {
    var vchunks = [];
    req.on("data", function (c) {
      vchunks.push(c);
    });
    req.on("end", function () {
      try {
        var vp = JSON.parse(Buffer.concat(vchunks).toString("utf8") || "{}");
        var vinId = Number(lotVinMatch[1]);
        var target = db
          .prepare("SELECT id, vin FROM lots WHERE id = ?")
          .get(vinId);
        if (!target) {
          sendJson(res, 404, { ok: false, error: "not found" });
          return;
        }
        var full = String(vp.vinFull == null ? "" : vp.vinFull)
          .trim()
          .toUpperCase();
        // Порожній рядок — свідоме стирання помилково введеного VIN.
        if (!full) {
          db.prepare("UPDATE lots SET vin_full = NULL WHERE id = ?").run(vinId);
          sendJson(res, 200, { ok: true, vinFull: null });
          return;
        }
        // I, O та Q у VIN не використовуються (ISO 3779) — саме щоб не
        // плутались з 1 та 0. Тому вони ж і найкращий сигнал одруку.
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(full)) {
          sendJson(res, 400, {
            ok: false,
            error: "VIN має бути 17 символів без I, O, Q",
          });
          return;
        }
        // Найнадійніша перевірка — сама маска з аукціону: усе, що IAAI
        // показав, мусить збігтися символ у символ. Одрук у зчитаному з фото
        // хвості так не спіймати, але переставлений чи чужий VIN — так.
        var mask = String(target.vin || "").toUpperCase();
        if (mask.length === 17) {
          for (var mi = 0; mi < 17; mi++) {
            if (mask[mi] !== "*" && mask[mi] !== full[mi]) {
              sendJson(res, 400, {
                ok: false,
                error: "VIN не збігається з маскою аукціону " + target.vin,
              });
              return;
            }
          }
        }
        db.prepare("UPDATE lots SET vin_full = ? WHERE id = ?").run(full, vinId);
        sendJson(res, 200, { ok: true, vinFull: full });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message });
      }
    });
    return;
  }

  // POST /api/lots — зберегти лот; GET /api/lots — список (легкий)
  if (route === "/api/lots") {
    if (req.method === "POST") {
      var lchunks = [];
      req.on("data", function (c) {
        lchunks.push(c);
      });
      req.on("end", function () {
        try {
          var p = JSON.parse(Buffer.concat(lchunks).toString("utf8") || "{}");
          var images = Array.isArray(p.images) ? p.images : [];
          var primary = images[0] || {};
          insertLotStmt.run(
            new Date().toISOString(),
            lotUrl(p.url, p.auction, p.lotNumber),
            p.auction || null,
            p.lotNumber || null,
            p.vin || null,
            num(p.year),
            p.make || null,
            p.model || null,
            p.series || null,
            p.bodyStyle || null,
            p.fuel || null,
            p.engine || null,
            p.cylinders || null,
            p.drive || null,
            p.transmission || null,
            p.color || null,
            num(p.odometer),
            p.primaryDamage || null,
            p.secondaryDamage || null,
            p.titleBrand || null,
            p.titleState || null,
            num(p.acv),
            num(p.repairCost),
            num(p.buyNowPrice),
            num(p.minBid),
            p.sellingBranch || null,
            p.branchState || null,
            p.saleDate || null,
            images.length,
            primary.thumb || null,
            primary.hd || null,
            p.image360 || null,
            JSON.stringify(images),
            Array.isArray(p.videos) ? JSON.stringify(p.videos) : "[]",
            p.raw ? JSON.stringify(p.raw) : null,
            p.interiorColor || null,
            p.odometerBrand || null,
            p.lossType || null,
            p.runAndDrive || null,
            p.hasKeys || null,
            p.airbags || null,
            p.vehicleGrade || null,
            p.vehicleCity || null,
            p.vehicleState || null,
            p.vehicleZip || null,
            p.offsite ? 1 : 0,
            p.saleLane || null,
            p.titleType || null,
            p.titleCode || null,
            p.starts || null,
            p.catalyticConverter || null,
            p.catIndicator ? 1 : 0,
            p.catText || null,
            p.keyFob || null,
            p.titleNotes || null,
            p.hybrid ? 1 : 0,
            p.titleSaleDoc || null,
            p.wheels || null,
            p.manufacturedIn || null,
            p.options || null,
            p.restraintSystem || null,
            p.whoCanBuy || null,
            Array.isArray(p.imageCaptions) && p.imageCaptions.length
              ? JSON.stringify(p.imageCaptions)
              : null,
          );
          // Повертаємо id лота, щоб клієнт одразу знав, кому дописувати
          // повний VIN, і міг показати вже збережений vin_full.
          var saved = lotIdLookupStmt.get(
            p.auction || null,
            p.lotNumber || null,
          );
          sendJson(res, 201, {
            ok: true,
            id: saved ? saved.id : null,
            vinFull: saved
              ? db
                  .prepare("SELECT vin_full FROM lots WHERE id = ?")
                  .get(saved.id).vin_full
              : null,
          });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (req.method === "GET") {
      // До кожного лота чіпляємо ОСТАННІЙ пошук ринкової ціни по ньому —
      // інакше «вигідно/дорого» видно лише на searches.html, окремо від фото
      // й пошкоджень, за якими лот і обирають.
      var lots = db.prepare(LOT_LIST_SQL).all();
      sendJson(res, 200, lots);
      return;
    }
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }

  if (route === "/api/searches") {
    if (req.method === "POST") {
      var chunks = [];
      req.on("data", function (c) {
        chunks.push(c);
      });
      req.on("end", function () {
        try {
          var p = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          // Прив'язка пошуку до лота за (аукціон, номер лота), якщо відомі.
          var lotId = null;
          if (p.auction && p.lotNumber) {
            var lr = lotIdLookupStmt.get(p.auction, String(p.lotNumber));
            if (lr) lotId = lr.id;
          }
          insertStmt.run(
            new Date().toISOString(),
            p.make || null,
            p.model || null,
            num(p.year),
            p.engineType || null,
            num(p.engineVolume),
            num(p.markaId),
            num(p.modelId),
            p.modelMatched ? 1 : 0,
            num(p.marketPrice),
            num(p.sampleCount),
            num(p.arithmeticMean),
            num(p.iqMean),
            num(p.median),
            num(p.totalCost),
            num(p.repairCost),
            num(p.diff),
            p.category || null,
            Array.isArray(p.prices) ? JSON.stringify(p.prices) : null,
            p.percentiles ? JSON.stringify(p.percentiles) : null,
            Array.isArray(p.classifieds) ? JSON.stringify(p.classifieds) : null,
            Array.isArray(p.filtersApplied)
              ? JSON.stringify(p.filtersApplied)
              : null,
            lotId,
          );
          sendJson(res, 201, { ok: true, lotId: lotId });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (req.method === "GET") {
      var rows = db
        .prepare(
          "SELECT " + LIST_COLS + SEARCH_JOIN + "ORDER BY s.id DESC LIMIT 200",
        )
        .all();
      sendJson(res, 200, rows);
      return;
    }
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }
  // ── Перепродажі ────────────────────────────────────────────────────
  // POST /api/resales/lookup — {url|vin|autoId} → обидва боки + landed,
  // БЕЗ запису. Ходить у мережу (AUTO.RIA + saleshistory), тому окремо від
  // запису: людина спершу дивиться, що знайшлося, і лише тоді зберігає.
  if (route === "/api/resales/lookup" && req.method === "POST") {
    readJson(req, function (err, p) {
      if (err) {
        sendJson(res, 400, { ok: false, error: err.message });
        return;
      }
      resaleLookup(p || {})
        .then(function (out) {
          sendJson(res, 200, Object.assign({ ok: true }, out));
        })
        .catch(function (e) {
          sendJson(res, e.status === 429 || e.rateLimited ? 429 : 400, {
            ok: false,
            error: e.message,
          });
        });
    });
    return;
  }

  // GET /api/resales/:id — повний рядок + історія ціни оголошення
  var resaleIdMatch = route.match(/^\/api\/resales\/(\d+)$/);
  if (resaleIdMatch && req.method === "GET") {
    var rRow = resaleDb.byId(Number(resaleIdMatch[1]));
    if (!rRow) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    sendJson(res, 200, resaleDb.expand(rRow));
    return;
  }

  // PUT /api/resales/:id — ручні цифри: ремонт в Україні, накладні, нотатка.
  // Саме тут рядок стає придатним для зведеної статистики: без ua_repair_cost
  // «чистий» дорівнює валовому і брехав би назвою.
  if (resaleIdMatch && (req.method === "PUT" || req.method === "POST")) {
    readJson(req, function (err, p) {
      if (err) {
        sendJson(res, 400, { ok: false, error: err.message });
        return;
      }
      var current = resaleDb.byId(Number(resaleIdMatch[1]));
      if (!current) {
        sendJson(res, 404, { ok: false, error: "not found" });
        return;
      }
      var patch = {};
      if (p.uaRepairCost !== undefined) {
        patch.ua_repair_cost = num(p.uaRepairCost);
        patch.ua_repair_source = num(p.uaRepairCost) ? "manual" : "none";
      }
      if (p.overheadCost !== undefined) patch.overhead_cost = num(p.overheadCost);
      if (p.notes !== undefined) patch.notes = p.notes;
      var merged = resaleLib.mergeResale(current, patch);
      resaleDb.write(merged);
      sendJson(res, 200, resaleDb.expand(resaleDb.byId(current.id)));
    });
    return;
  }

  if (route === "/api/resales") {
    if (req.method === "POST") {
      readJson(req, function (err, p) {
        if (err) {
          sendJson(res, 400, { ok: false, error: err.message });
          return;
        }
        try {
          var vinKey = String(p.vin || "").toUpperCase();
          if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vinKey)) {
            sendJson(res, 400, {
              ok: false,
              error: "VIN має бути 17 символів без I, O, Q",
            });
            return;
          }
          var existing = resaleDb.byKey(vinKey, num(p.ria_auto_id));
          var merged = resaleLib.mergeResale(existing, p);
          merged.vin = vinKey;
          var id = resaleDb.write(merged);
          sendJson(res, 201, { ok: true, id: id });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (req.method === "GET") {
      var resaleRows = resaleDb.list();
      sendJson(res, 200, resaleRows);
      return;
    }
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, function () {
  console.log("▶ http://" + HOST + ":" + PORT);
  console.log("  SQLite: " + DB_PATH);
  console.log("  Перегляд логів: http://localhost:" + PORT + "/api/searches");
});
