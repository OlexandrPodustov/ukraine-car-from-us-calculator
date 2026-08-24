"use strict";
/**
 * Рядок перепродажу: збирання з трьох джерел і вся арифметика наварки.
 *
 * Формула (див. docs/resale-markup-baseline.md):
 *   landed_cost  = totalForPrice(sold_price)      — авто на укр. номерах
 *   gross_profit = ria_price_usd − landed_cost
 *   net_profit   = gross_profit − ua_repair_cost − overhead_cost
 *   margin_pct   = net_profit / (landed_cost + ua_repair_cost + overhead_cost)
 *
 * `us_repair_cost` (кошторис страховика США) сюди НЕ входить і входити не
 * може: це вартість ремонту американськими нормо-годинами оригінальними
 * деталями, вона не має стосунку до того, скільки той самий ремонт коштує
 * тут. Правило те саме, що вже діє у вердикті калькулятора (CLAUDE.md).
 * Поки український ремонт не введено, `ua_repair_source = 'none'` — і такий
 * рядок не має потрапляти в зведені медіани, бо його «чистий» насправді
 * валовий.
 */

// Порядок = порядок колонок в INSERT. Один масив на всі три списки —
// колонки / «?» / UPSERT, — бо їх розсинхрон уже ламав lots.
const RESALE_COLS = [
  "ts",
  "vin",
  "ria_auto_id",
  "ria_url",
  "ria_price_usd",
  "ria_price_uah",
  "ria_year",
  "ria_mileage_km",
  "ria_city",
  "ria_region",
  "ria_fuel",
  "ria_gearbox",
  "ria_drive",
  "ria_custom",
  "ria_damage",
  "ria_add_date",
  "ria_update_date",
  "ria_sold_date",
  "ria_active",
  "ria_dealer",
  "ria_description",
  "ria_photo_count",
  "ria_title",
  "ria_json",
  "auction",
  "lot_number",
  "sold_price",
  "sale_date",
  "odometer",
  "odometer_brand",
  "primary_damage",
  "secondary_damage",
  "acv",
  "us_repair_cost",
  "keys_present",
  "condition",
  "documents",
  "seller",
  "location",
  "location_state",
  "location_zip",
  "color",
  "engine",
  "transmission",
  "drive",
  "fuel",
  "make",
  "model",
  "year",
  "images_json",
  "history_source",
  "history_url",
  "history_json",
  "landed_cost",
  "landed_breakdown_json",
  "matched_location",
  "location_weak",
  "location_matched",
  "inland_us_fee",
  "departure_port",
  "destination_port",
  "vehicle_type",
  "risk_coefficient",
  "max_bid_for_market",
  "ua_repair_cost",
  "ua_repair_source",
  "overhead_cost",
  "gross_profit",
  "net_profit",
  "margin_pct",
  "days_to_market",
  "rates_asof",
  "usd_uah",
  "eur_usd",
  "notes",
];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function json(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch (e) {
    return null;
  }
}

/** Днів між продажем на аукціоні і появою оголошення в Україні. */
function daysBetween(from, to) {
  const a = Date.parse(String(from || "").replace(" ", "T"));
  const b = Date.parse(String(to || "").replace(" ", "T"));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Похідні числа. Викликається після кожного злиття, ніколи не зберігається наосліп. */
function deriveResale(row) {
  const out = Object.assign({}, row);
  const price = num(out.ria_price_usd);
  const landed = num(out.landed_cost);
  const repair = num(out.ua_repair_cost) || 0;
  const overhead = num(out.overhead_cost) || 0;

  out.ua_repair_source =
    out.ua_repair_source || (repair > 0 ? "manual" : "none");
  out.overhead_cost = overhead;
  out.ua_repair_cost = num(out.ua_repair_cost);

  if (price === null || landed === null) {
    out.gross_profit = null;
    out.net_profit = null;
    out.margin_pct = null;
  } else {
    out.gross_profit = Math.round(price - landed);
    out.net_profit = Math.round(out.gross_profit - repair - overhead);
    const invested = landed + repair + overhead;
    out.margin_pct = invested > 0 ? out.net_profit / invested : null;
  }
  out.days_to_market = daysBetween(out.sale_date, out.ria_add_date);
  return out;
}

/**
 * Злиття поверх уже збереженого рядка. Порожнє значення в патчі НЕ затирає
 * заповнене — та сама гарантія, що дає COALESCE в UPSERT для lots, тільки
 * зроблена в JS, щоб похідні рахувались уже від злитих даних.
 */
function mergeResale(existing, patch) {
  const base = existing ? Object.assign({}, existing) : {};
  const src = patch || {};
  RESALE_COLS.forEach(function (col) {
    const v = src[col];
    if (v === undefined || v === null || v === "") return;
    base[col] = v;
  });
  // Нуль — осмислене значення саме для цих двох (ремонту не було / без
  // накладних), тож їх пропускаємо через окрему гілку.
  ["ua_repair_cost", "overhead_cost"].forEach(function (col) {
    if (src[col] === 0 || src[col] === "0") base[col] = 0;
  });
  if (src.ua_repair_source) base.ua_repair_source = src.ua_repair_source;
  if (src.notes !== undefined) base.notes = str(src.notes);
  return deriveResale(base);
}

/**
 * Три джерела → один плоский рядок під колонки resales.
 *   advert  — normalizeAdvert() з lib/ria.js
 *   history — fetchVinHistory() з lib/vin-history.js ({found:false} допустимо)
 *   landed  — computeLanded() з lib/landed.js (може бути null)
 */
function buildResaleRow(parts) {
  const p = parts || {};
  const a = p.advert || {};
  const h = p.history || {};
  const l = p.landed || {};
  const found = h.found !== false && (h.soldPrice || h.saleDate || h.lotNumber);

  const row = {
    ts: p.ts || new Date().toISOString(),
    vin: str((a.vin || h.vin || p.vin || "").toUpperCase()),

    ria_auto_id: num(a.autoId),
    ria_url: str(a.url),
    ria_price_usd: num(a.priceUsd),
    ria_price_uah: num(a.priceUah),
    ria_year: num(a.year),
    ria_mileage_km: num(a.mileageKm),
    ria_city: str(a.city),
    ria_region: str(a.region),
    ria_fuel: str(a.fuel),
    ria_gearbox: str(a.gearbox),
    ria_drive: str(a.drive),
    ria_custom: num(a.custom),
    ria_damage: num(a.damaged),
    ria_add_date: str(a.addDate),
    ria_update_date: str(a.updateDate),
    ria_sold_date: str(a.soldDate),
    ria_active: num(a.active),
    ria_dealer: str(a.dealer),
    ria_description: str(a.description),
    ria_photo_count: num(a.photoCount),
    ria_title: str(a.title),
    ria_json: json(p.advertRaw),

    auction: str(h.auction),
    lot_number: str(h.lotNumber),
    sold_price: num(h.soldPrice),
    sale_date: str(h.saleDate),
    odometer: num(h.odometer),
    odometer_brand: str(h.odometerBrand),
    primary_damage: str(h.primaryDamage),
    secondary_damage: str(h.secondaryDamage),
    acv: num(h.acv),
    us_repair_cost: num(h.usRepairCost),
    keys_present: str(h.keys),
    condition: str(h.condition),
    documents: str(h.documents),
    seller: str(h.seller),
    location: str(h.location),
    location_state: str(h.locationState),
    location_zip: str(h.locationZip),
    color: str(h.color),
    engine: str(h.engine),
    transmission: str(h.transmission),
    drive: str(h.drive),
    fuel: str(h.fuel),
    make: str(h.make),
    model: str(h.model),
    year: num(h.year),
    images_json: json(h.images),
    // «Аукціонної історії нема» — це теж спостереження, і воно зберігається
    // явно, а не як мовчазний NULL.
    history_source: found ? str(h.source) || "saleshistory" : "none",
    history_url: str(h.url),
    history_json: json(found ? h : null),

    landed_cost: num(l.landedCost),
    landed_breakdown_json: json(l.breakdown),
    matched_location: str(l.matchedLocation),
    location_weak:
      l.locationWeak === true ? 1 : l.locationWeak === false ? 0 : null,
    // Окремо від location_weak: weak = зматчено лише за штатом, а
    // location_matched = 0 означає, що штату не було взагалі і наземне плече
    // порахувалось від дефолтної локації довідника.
    location_matched:
      l.locationMatched === undefined ? null : l.locationMatched,
    inland_us_fee: num(l.inlandUsFee),
    departure_port: str(l.departurePort),
    destination_port: str(l.destinationPort),
    vehicle_type: str(l.vehicleType),
    risk_coefficient: num(l.riskCoefficient),
    max_bid_for_market: num(l.maxBidForMarket),

    ua_repair_cost: num(p.uaRepairCost),
    ua_repair_source: str(p.uaRepairSource),
    overhead_cost: num(p.overheadCost),
    // Ставки й курси історичні не бувають: рахуємо сьогоднішніми, тож дату
    // зрізу зберігаємо разом із числом — інакше набір через рік стане
    // несумісним сам із собою.
    rates_asof: p.ratesAsOf || new Date().toISOString().slice(0, 10),
    usd_uah: num(l.usdUah),
    eur_usd: num(l.eurUsd),
    notes: str(
      [].concat(h.notes || [], p.notes ? [p.notes] : []).join("; ") || null,
    ),
  };
  if (p.uaRepairCost === 0) row.ua_repair_cost = 0;
  if (p.overheadCost === 0) row.overhead_cost = 0;
  return deriveResale(row);
}

module.exports = {
  RESALE_COLS,
  buildResaleRow,
  deriveResale,
  mergeResale,
  daysBetween,
};
