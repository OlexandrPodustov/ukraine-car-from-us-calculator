#!/usr/bin/env node
/**
 * Знімає маску з VIN у вже збережених лотах.
 *
 * IAAI не віддає повний VIN нікому: і незалогінений скрейп через проксі, і
 * залогінений акаунт бачать те саме `WP1AA2A53RL******` (перевірено
 * 2026-08-23 на лоті 46293657). Останні 6 символів серійника є рівно в
 * одному безкоштовному місці — на фото заводської таблички, яке сам аукціон
 * і викладає. Який саме зі знімків це, каже прихований `imageCaptions` у
 * HTML сторінки («Manufacturer VIN Plate»), а не JSON лота — тому старі
 * рядки в БД цього не знають і сторінку доводиться перечитати.
 *
 *   node scripts/vin-plate.mjs            # показати посилання на таблички
 *   node scripts/vin-plate.mjs --refetch  # перечитати сторінки й зберегти підписи
 *   node scripts/vin-plate.mjs --set <id> <VIN|хвіст>   # записати повний VIN
 *
 * Прочитати сам VIN зі знімка скрипт не вміє — це робота очей (або моделі з
 * зором). Тому вивід --refetch задуманий як список URL, який згодовується
 * далі, а --set приймає або всі 17 символів, або лише хвіст, якого бракує
 * в масці.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "searches.db");

const args = process.argv.slice(2);
const REFETCH = args.includes("--refetch");
const setAt = args.indexOf("--set");

const db = new DatabaseSync(DB_PATH);

// Ті самі колонки, що додає server.js. Дублюємо, щоб скрипт працював і на
// базі, яку новим сервером ще не відкривали — інакше перший же запит падає
// з «no such column: vin_full».
["vin_full TEXT", "image_captions TEXT"].forEach((col) => {
  try {
    db.exec("ALTER TABLE lots ADD COLUMN " + col);
  } catch {
    /* колонка вже існує */
  }
});

// ── Транслітерація ISO 3779 для контрольної цифри (позиція 9) ─────────
// Не арифметична: J..R і S..Z починають відлік заново.
const VIN_VAL = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function vinCheckDigitOk(vin) {
  const v = String(vin || "").toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = v[i];
    const n = c >= "0" && c <= "9" ? Number(c) : VIN_VAL[c];
    if (n === undefined) return false;
    sum += n * VIN_WEIGHTS[i];
  }
  const rest = sum % 11;
  return (rest === 10 ? "X" : String(rest)) === v[8];
}

function parseImageCaptions(html) {
  const m = (html || "").match(
    /<input[^>]*id="imageCaptions"[^>]*value="([^"]*)"/i,
  );
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function proxyUrl() {
  // config.js гітігнориться і не є модулем — читаємо як текст.
  try {
    const cfg = readFileSync(path.join(ROOT, "config.js"), "utf8");
    const m = cfg.match(/proxyUrl:\s*"([^"]+)"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function lotPageUrl(row) {
  if (row.url && /^https?:\/\//i.test(row.url)) return row.url;
  if (row.auction === "iaai" && row.lot_number)
    return `https://www.iaai.com/VehicleDetail/${row.lot_number}~US`;
  return "";
}

// Знімок таблички серед збережених фото лота: підпис під тим самим індексом,
// що й фото — обидва списки йдуть у порядку видачі аукціону.
function vinPlateUrl(row) {
  let captions = [];
  let images = [];
  try {
    captions = row.image_captions ? JSON.parse(row.image_captions) : [];
    images = row.images_json ? JSON.parse(row.images_json) : [];
  } catch {
    return "";
  }
  for (let i = 0; i < captions.length; i++) {
    if (/vin\s*plate/i.test(captions[i]) && images[i]) return images[i].hd;
  }
  return "";
}

// ── --set: записати повний VIN ───────────────────────────────────────
if (setAt >= 0) {
  const id = Number(args[setAt + 1]);
  const raw = String(args[setAt + 2] || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  const row = db.prepare("SELECT id, vin FROM lots WHERE id = ?").get(id);
  if (!row) {
    console.error(`Лота ${id} немає в базі.`);
    process.exit(1);
  }
  const mask = String(row.vin || "");
  let full = raw;
  if (raw.length < 17 && mask.length === 17) {
    const known = mask.replace(/\*+$/, "");
    if (raw.length === 17 - known.length) full = known + raw;
  }
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(full)) {
    console.error(`«${full}» — не 17 символів VIN (I, O, Q не бувають).`);
    process.exit(1);
  }
  for (let i = 0; i < 17; i++) {
    if (mask.length === 17 && mask[i] !== "*" && mask[i] !== full[i]) {
      console.error(`${full} не збігається з маскою аукціону ${mask}.`);
      process.exit(1);
    }
  }
  if (!vinCheckDigitOk(full)) {
    console.error(`${full}: контрольна цифра не сходиться — перевір символи.`);
    process.exit(1);
  }
  db.prepare("UPDATE lots SET vin_full = ? WHERE id = ?").run(full, id);
  console.log(`лот ${id}: ${mask} → ${full}`);
  process.exit(0);
}

// ── Список / перечитування ───────────────────────────────────────────
const rows = db
  .prepare(
    `SELECT id, auction, lot_number, url, vin, vin_full, image_captions,
            images_json
       FROM lots
      WHERE (vin_full IS NULL OR vin_full = '')
      ORDER BY id`,
  )
  .all();

const proxy = proxyUrl();
if (REFETCH && !proxy) {
  console.error("Немає CONFIG.proxyUrl у config.js — перечитати нічим.");
  process.exit(1);
}

const out = [];
for (const row of rows) {
  let url = vinPlateUrl(row);
  if (!url && REFETCH) {
    const page = lotPageUrl(row);
    if (!page) {
      out.push([row.id, row.lot_number, row.vin, "— немає адреси сторінки"]);
      continue;
    }
    let html = "";
    try {
      const res = await fetch(proxy + encodeURIComponent(page));
      html = await res.text();
    } catch (e) {
      out.push([row.id, row.lot_number, row.vin, `— ${e.message}`]);
      continue;
    }
    const captions = parseImageCaptions(html);
    if (captions.length) {
      db.prepare("UPDATE lots SET image_captions = ? WHERE id = ?").run(
        JSON.stringify(captions),
        row.id,
      );
      row.image_captions = JSON.stringify(captions);
      url = vinPlateUrl(row);
    }
  }
  out.push([
    row.id,
    row.lot_number,
    row.vin,
    url || (REFETCH ? "— фото таблички немає" : "— підписів ще не зчитано"),
  ]);
}

out.forEach((r) => console.log(r.join("\t")));
console.error(
  `\n${out.filter((r) => r[3].startsWith("http")).length} з ${out.length} лотів мають фото таблички.`,
);
