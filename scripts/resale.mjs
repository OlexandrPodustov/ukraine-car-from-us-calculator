#!/usr/bin/env node
/**
 * Перепродажі з консолі: те саме, що робить resales.html, але без сервера.
 *
 *   node scripts/resale.mjs --add <URL оголошення AUTO.RIA | VIN>
 *   node scripts/resale.mjs --refresh [--limit N] [--dry]
 *   node scripts/resale.mjs --recompute [--dry]
 *   node scripts/resale.mjs                       # TSV усіх спостережень
 *
 * --refresh переопитує AUTO.RIA по збережених оголошеннях і ДОПИСУЄ зріз
 * ціни в resale_price_history (ніколи не перезаписує: цінність у дельті між
 * «просять» і «дають»). Вільний тариф RIA має годинний ліміт близько 25
 * викликів, тому --limit тут не косметика: без нього прогін на кілька
 * десятків рядків впреться в 429 посередині.
 *
 * --recompute перераховує landed зі збереженого history_json, без мережі —
 * так само, як backfill-lot-fields.mjs відновлює лоти з raw_json.
 *
 * Запис іде через lib/resale-db.js, тобто тим самим кодом, що й /api/resales.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./lib/app-vm.mjs";

const require = createRequire(import.meta.url);
const ria = require("../lib/ria.js");
const vinHistory = require("../lib/vin-history.js");
const landedLib = require("../lib/landed.js");
const resaleLib = require("../lib/resale.js");
const resaleDbLib = require("../lib/resale-db.js");

const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "searches.db");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};

const db = new DatabaseSync(DB_PATH);
const store = resaleDbLib.attach(db);

function out(...cols) {
  process.stdout.write(cols.join("\t") + "\n");
}
function note(msg) {
  process.stderr.write(msg + "\n");
}

async function lookupRow(input, extra) {
  const value = String(input || "").trim();
  let advert = null;
  let advertRaw = null;
  let vin = "";
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(value)) {
    vin = value.toUpperCase();
  } else {
    const autoId = ria.parseAdvertId(value);
    if (!autoId) throw new Error("не розпізнав ні URL оголошення, ні VIN: " + value);
    advertRaw = await ria.fetchAdvert(autoId);
    advert = ria.normalizeAdvert(advertRaw);
    vin = advert.vin || "";
    if (!vin) throw new Error("в оголошенні " + autoId + " немає VIN");
  }
  const history = await vinHistory.fetchVinHistory(vin);
  let landed = null;
  if (history.found && history.soldPrice > 0) {
    landed = await landedLib.computeLanded(history, history.soldPrice, {
      marketPrice: advert ? advert.priceUsd : null,
    });
  }
  return resaleLib.buildResaleRow(
    Object.assign({ advert, advertRaw, history, landed, vin }, extra || {}),
  );
}

async function cmdAdd(input) {
  const row = await lookupRow(input);
  const existing = store.byKey(row.vin, row.ria_auto_id);
  const merged = resaleLib.mergeResale(existing, row);
  if (DRY) {
    note("[dry-run] не записано");
  } else {
    store.write(merged);
  }
  out(
    merged.vin,
    merged.auction || "—",
    merged.sold_price || "—",
    merged.landed_cost || "—",
    merged.ria_price_usd || "—",
    merged.gross_profit === null ? "—" : merged.gross_profit,
  );
  note(
    merged.history_source === "none"
      ? "⚠ аукціонної історії за VIN нема — збережено лише український бік"
      : "ставка $" +
          merged.sold_price +
          " · привезти $" +
          merged.landed_cost +
          " · в Україні $" +
          merged.ria_price_usd +
          " · валова $" +
          merged.gross_profit,
  );
}

async function cmdRefresh() {
  const limit = Number(valueOf("--limit")) || 25;
  const rows = store
    .all()
    .filter((r) => r.ria_auto_id)
    // Спершу ті, що ще «живі»: у проданих оголошень ціна вже не зміниться.
    .sort((a, b) => (b.ria_active || 0) - (a.ria_active || 0))
    .slice(0, limit);
  note(`переопитую ${rows.length} оголошень (ліміт ${limit})`);
  let changed = 0;
  for (const row of rows) {
    try {
      const raw = await ria.fetchAdvert(row.ria_auto_id);
      const advert = ria.normalizeAdvert(raw);
      const patch = resaleLib.buildResaleRow({
        advert,
        advertRaw: raw,
        history: JSON.parse(row.history_json || "null") || { found: false },
        landed: null,
        vin: row.vin,
      });
      // landed рахувався раніше і від ціни оголошення не залежить — не чіпаємо.
      delete patch.landed_cost;
      delete patch.landed_breakdown_json;
      const merged = resaleLib.mergeResale(row, patch);
      const priceMoved =
        merged.ria_price_usd !== row.ria_price_usd ||
        merged.ria_active !== row.ria_active ||
        (merged.ria_sold_date || null) !== (row.ria_sold_date || null);
      if (priceMoved) changed += 1;
      out(
        row.id,
        row.vin,
        row.ria_price_usd === null ? "—" : row.ria_price_usd,
        "→",
        merged.ria_price_usd === null ? "—" : merged.ria_price_usd,
        merged.ria_active ? "активне" : "знято",
        merged.ria_sold_date || "",
      );
      if (!DRY) store.write(merged);
    } catch (e) {
      note(`лот ${row.id} (${row.vin}): ${e.message}`);
      if (e.rateLimited) {
        note("⛔ впертись у ліміт AUTO.RIA — зупиняюсь, добери решту за годину");
        break;
      }
    }
  }
  note((DRY ? "[dry-run] " : "") + `змінилось цін/статусів: ${changed}`);
}

async function cmdRecompute() {
  const rows = store.all().filter((r) => r.history_json);
  let touched = 0;
  for (const row of rows) {
    let history;
    try {
      history = JSON.parse(row.history_json);
    } catch {
      note(`рядок ${row.id}: history_json не парситься — пропускаю`);
      continue;
    }
    if (!history || !history.soldPrice) continue;
    const landed = await landedLib.computeLanded(history, history.soldPrice, {
      vehicleType: row.vehicle_type,
      destinationPort: row.destination_port,
      marketPrice: row.ria_price_usd,
    });
    const patch = resaleLib.buildResaleRow({
      advert: {},
      history,
      landed,
      vin: row.vin,
    });
    const merged = resaleLib.mergeResale(row, {
      landed_cost: patch.landed_cost,
      landed_breakdown_json: patch.landed_breakdown_json,
      matched_location: patch.matched_location,
      location_weak: patch.location_weak,
      departure_port: patch.departure_port,
      destination_port: patch.destination_port,
      max_bid_for_market: patch.max_bid_for_market,
      risk_coefficient: patch.risk_coefficient,
      rates_asof: new Date().toISOString().slice(0, 10),
      usd_uah: patch.usd_uah,
      eur_usd: patch.eur_usd,
    });
    if (merged.landed_cost !== row.landed_cost) {
      touched += 1;
      out(row.id, row.vin, row.landed_cost, "→", merged.landed_cost);
    }
    if (!DRY) store.write(merged);
  }
  note((DRY ? "[dry-run] " : "") + `перераховано landed: ${touched}`);
}

function cmdList() {
  out(
    "id", "vin", "auction", "sold", "landed", "ua_price",
    "gross", "repair_ua", "net", "margin", "days",
  );
  store.all().forEach((r) => {
    out(
      r.id,
      r.vin,
      r.auction || "—",
      r.sold_price === null ? "—" : r.sold_price,
      r.landed_cost === null ? "—" : r.landed_cost,
      r.ria_price_usd === null ? "—" : r.ria_price_usd,
      r.gross_profit === null ? "—" : r.gross_profit,
      r.ua_repair_source === "manual" ? r.ua_repair_cost : "—",
      r.net_profit === null ? "—" : r.net_profit,
      r.margin_pct === null ? "—" : (r.margin_pct * 100).toFixed(1) + "%",
      r.days_to_market === null ? "—" : r.days_to_market,
    );
  });
}

const target = valueOf("--add");
try {
  if (has("--add")) await cmdAdd(target);
  else if (has("--refresh")) await cmdRefresh();
  else if (has("--recompute")) await cmdRecompute();
  else cmdList();
} catch (e) {
  note("❌ " + e.message);
  process.exit(1);
}
