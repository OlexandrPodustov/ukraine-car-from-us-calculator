#!/usr/bin/env node
/**
 * Добиває в data/searches.db поля лотів, які парсер раніше не діставав:
 * до 2026-08-22 collectLotData читав неіснуючі імена атрибутів IAAI
 * (Odometer замість ODOValue, Color замість ExteriorColor, PrimaryDamage
 * замість PrimaryDamageDesc…), тож пробіг, колір, привід і пошкодження
 * лежали в БД порожніми. Сам JSON лота при цьому збережено повністю —
 * тобто все відновлюється локально, без повторного скрейпу.
 *
 *   node scripts/backfill-lot-fields.mjs --dry   # показати, що зміниться
 *   node scripts/backfill-lot-fields.mjs         # записати
 *
 * Третім проходом добиває `searches.location_match` — він так само цілком
 * виводиться з raw_json. Курс (usd_uah / rates_source) НЕ добивається: його
 * ніде не збережено, а підставити сьогоднішній у рядок піврічної давнини —
 * це видати вигадку за вимір.
 *
 * Порожнє не затирає заповнене: оновлюються лише колонки, де зараз NULL/''.
 * Логіка розбору береться з assets/js/methods/market.methods.js — того самого
 * файлу, що працює в браузері, а не з копії.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { loadCalculator, lotVm, LOT_SOURCES, ROOT } from "./lib/app-vm.mjs";

const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "searches.db");
const DRY = process.argv.includes("--dry");

// колонка в БД → поле з collectLotData
const FIELD_MAP = {
  odometer: "odometer",
  color: "color",
  drive: "drive",
  cylinders: "cylinders",
  transmission: "transmission",
  primary_damage: "primaryDamage",
  secondary_damage: "secondaryDamage",
  title_brand: "titleBrand",
  title_state: "titleState",
  repair_cost: "repairCost",
  interior_color: "interiorColor",
  odometer_brand: "odometerBrand",
  loss_type: "lossType",
  run_and_drive: "runAndDrive",
  has_keys: "hasKeys",
  airbags: "airbags",
  vehicle_grade: "vehicleGrade",
  vehicle_city: "vehicleCity",
  vehicle_state: "vehicleState",
  vehicle_zip: "vehicleZip",
  offsite: "offsite",
  sale_lane: "saleLane",
  title_type: "titleType",
  title_code: "titleCode",
  starts: "starts",
  catalytic_converter: "catalyticConverter",
  cat_text: "catText",
  key_fob: "keyFob",
  title_notes: "titleNotes",
  title_sale_doc: "titleSaleDoc",
  wheels: "wheels",
  manufactured_in: "manufacturedIn",
  options: "options",
  restraint_system: "restraintSystem",
  who_can_buy: "whoCanBuy",
};

// Прапорці 0/1: «порожньо» для них — це NULL, а не нуль, тож заповнюємо лише
// поки колонки ще нема. Інакше кожен прогін «оновлював» hybrid=0 → hybrid=0.
const FLAG_MAP = { cat_indicator: "catIndicator", hybrid: "hybrid" };

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

const win = loadCalculator(LOT_SOURCES);
const db = new DatabaseSync(DB_PATH);
const rows = db
  .prepare("SELECT * FROM lots WHERE raw_json IS NOT NULL ORDER BY id")
  .all();

let touched = 0;
const perColumn = {};

rows.forEach((row) => {
  let nd;
  try {
    nd = JSON.parse(row.raw_json);
  } catch {
    console.warn(`лот ${row.id}: raw_json не парситься — пропускаю`);
    return;
  }
  const attrs = (nd.inventoryView || {}).attributes || {};
  const saleValues =
    ((nd.inventoryView || {}).saleInformation || {}).$values || [];
  const vm = lotVm(win, row.auction);
  const data = vm.collectLotData(nd, attrs, saleValues, row.url);

  const sets = [];
  const values = [];
  Object.keys(FIELD_MAP).forEach((col) => {
    const next = data[FIELD_MAP[col]];
    if (isEmpty(next)) return;
    // offsite=0 — теж значення, але «порожнім» його вважати не можна лише
    // тоді, коли колонка ще NULL.
    if (!isEmpty(row[col])) return;
    if (col === "offsite" && row[col] !== null) return;
    sets.push(`${col} = ?`);
    values.push(next);
    perColumn[col] = (perColumn[col] || 0) + 1;
  });
  Object.keys(FLAG_MAP).forEach((col) => {
    if (row[col] !== null && row[col] !== undefined) return;
    sets.push(`${col} = ?`);
    values.push(data[FLAG_MAP[col]] ? 1 : 0);
    perColumn[col] = (perColumn[col] || 0) + 1;
  });

  if (!sets.length) return;
  touched++;
  const label = [row.year, row.make, row.model].filter(Boolean).join(" ");
  console.log(
    `лот ${row.id} (${label}): ` +
      sets.map((s, i) => `${s.replace(" = ?", "")}=${values[i]}`).join(", "),
  );
  if (!DRY) {
    db.prepare(`UPDATE lots SET ${sets.join(", ")} WHERE id = ?`).run(
      ...values,
      row.id,
    );
  }
});

// ── Номер лота ──────────────────────────────────────────────────────
// Ключ лота — SalvageId: саме він стоїть в URL сторінки
// (/VehicleDetail/<SalvageId>~US), і з нього збирається посилання, якщо url
// загубився. Раніше парсер брав inventoryView.itemId, який у частини лотів
// інший, — через це той самий лот при повторному зчитуванні ліг би в БД
// другим рядком замість оновлення наявного.
let renamed = 0;
rows.forEach((row) => {
  let nd;
  try {
    nd = JSON.parse(row.raw_json);
  } catch {
    return;
  }
  const salvageId = String(
    ((nd.inventoryView || {}).attributes || {}).SalvageId || "",
  ).trim();
  if (!salvageId || salvageId === String(row.lot_number || "")) return;

  const clash = db
    .prepare("SELECT id FROM lots WHERE auction = ? AND lot_number = ?")
    .get(row.auction, salvageId);
  if (clash) {
    console.warn(
      `лот ${row.id}: № ${row.lot_number} → ${salvageId} зайнятий лотом ${clash.id} — пропускаю`,
    );
    return;
  }

  renamed++;
  console.log(`лот ${row.id}: № ${row.lot_number} → ${salvageId}`);
  if (!DRY) {
    db.prepare("UPDATE lots SET lot_number = ? WHERE id = ?").run(
      salvageId,
      row.id,
    );
  }
});

// ── Провенанс локації для вже записаних пошуків ─────────────────────
// searches.location_match з'явився 2026-08-28, тож у старих рядках там NULL.
// Він цілком виводиться з raw_json лота — тим самим matchAuctionLocation, що
// працює в браузері, — тож відновлюється локально, без повторного скрейпу.
//
// Курс (usd_uah / eur_usd / rates_source) відновити НЕ можна: його ніде не
// збережено, а підставити сьогоднішній у рядок піврічної давнини — це видати
// вигадку за вимір. Такі колонки лишаються NULL, і сторінки їх не мітять.
let located = 0;
const searchLocCounts = {};
if (
  db
    .prepare("PRAGMA table_info(searches)")
    .all()
    .some((c) => c.name === "location_match")
) {
  const searchRows = db
    .prepare(
      "SELECT s.id, l.raw_json, l.auction FROM searches s " +
        "JOIN lots l ON l.id = s.lot_id " +
        "WHERE s.location_match IS NULL AND l.raw_json IS NOT NULL " +
        "ORDER BY s.id",
    )
    .all();
  searchRows.forEach((row) => {
    let nd;
    try {
      nd = JSON.parse(row.raw_json);
    } catch {
      return;
    }
    const attrs = (nd.inventoryView || {}).attributes || {};
    const vm = lotVm(win, row.auction);
    const loc = vm.matchAuctionLocation(attrs);
    const value = !loc
      ? "none"
      : vm.locationMatchIsWeak(attrs, loc)
        ? "weak"
        : "ok";
    located++;
    searchLocCounts[value] = (searchLocCounts[value] || 0) + 1;
    console.log(
      `пошук ${row.id}: location_match=${value}` +
        (loc ? ` (${loc.name})` : " — штату в лоті немає"),
    );
    if (!DRY) {
      db.prepare("UPDATE searches SET location_match = ? WHERE id = ?").run(
        value,
        row.id,
      );
    }
  });
} else {
  console.warn(
    "у searches немає колонки location_match — запусти `npm start` один раз, " +
      "міграції живуть у server.js",
  );
}

console.log(
  `\n${DRY ? "[dry-run] " : ""}оновлено лотів: ${touched} з ${rows.length}` +
    (renamed ? `, переномеровано: ${renamed}` : "") +
    (located ? `, пошуків із локацією: ${located}` : ""),
);
Object.keys(searchLocCounts)
  .sort()
  .forEach((k) => console.log(`  location_match ${k}: ${searchLocCounts[k]}`));
Object.keys(perColumn)
  .sort()
  .forEach((c) => console.log(`  ${c}: ${perColumn[c]}`));
db.close();
