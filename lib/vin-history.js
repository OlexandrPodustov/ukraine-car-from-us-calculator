"use strict";
/**
 * Аукціонна історія за VIN — saleshistory.org.
 *
 * Навіщо саме воно (зріз 2026-08-24, деталі в docs/resale-markup-baseline.md):
 *  - URL детальної сторінки детермінований від VIN: https://<vin>.saleshistory.org/
 *  - ціна продажу не за пейволом;
 *  - працює ПРЯМИМ запитом з машини, CONFIG.proxyUrl не потрібен (на відміну від
 *    opendatacar / bidhistory.org, які напряму віддають 403).
 * opendatacar сюди не годиться: його /auction/lot-history має лише свіжі лоти,
 * а на VIN Macan WP1AA2A53RLB16469 він повернув «2007 CHEVROLET TAHOE».
 *
 * Аукціон беремо з сайдбара «Auction Info» детальної сторінки, а НЕ з бейджа
 * .label_icon на видачі пошуку: на перевіреному Audi WAUC4CF56RA030212 бейдж
 * каже IAAI, тоді як сайдбар, текст огляду й префікс теки фото (c51505035)
 * узгоджено кажуть copart. На двох відомих нам IAAI-авто сайдбар каже iaai.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const SEARCH_URL = "https://saleshistory.org/search/?vin=";
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Прибирає теги й нормалізує пробіли — значення в таблиці бувають у <a>. */
function text(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function toInt(v) {
  if (v === null || v === undefined) return null;
  const digits = String(v).replace(/[^\d]/g, "");
  if (!digits) return null;
  return parseInt(digits, 10);
}

/** Усі пари <tr><td>label</td><td>value</td></tr> сторінки, ключ у lowercase. */
function tableRows(html) {
  const out = {};
  const re = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    const key = text(m[1]).replace(/:$/, "").toLowerCase();
    if (key) out[key] = text(m[2]);
  }
  return out;
}

/** «CA - VAN NUYS VAN NUYS (91405 1509)» → штат, індекс, назва. */
function parseLocation(raw) {
  const value = text(raw);
  if (!value) return { location: null, state: null, zip: null };
  const state = /^([A-Z]{2})\s*-\s/.exec(value);
  const zip = /\((\d{5})/.exec(value);
  return {
    location: value,
    state: state ? state[1] : null,
    zip: zip ? zip[1] : null,
  };
}

/** «19186 (A)» → 19186 + позначка достовірності одометра. */
function parseMileage(raw) {
  const value = text(raw);
  const brand = /\(([^)]+)\)/.exec(value);
  return { odometer: toInt(value), odometerBrand: brand ? brand[1] : null };
}

/** «2025-07-15 19:00:00» → дата окремо (у БД тримаємо ISO-дату). */
function parseSaleDate(raw) {
  const m = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(
    text(raw),
  );
  if (!m) return { saleDate: null, saleTime: null };
  return { saleDate: m[1], saleTime: m[2] || null };
}

/**
 * Картки видачі пошуку. Потрібні лише щоб дізнатись, чи VIN узагалі є в базі,
 * і взяти лінк на деталі; усе змістовне читається з детальної сторінки.
 */
function parseSearchResults(html) {
  const out = [];
  const re =
    /<div class="product-listing-m[\s\S]*?<div class="car-location">[\s\S]*?<\/div>/gi;
  const blocks = String(html || "").match(re) || [];
  blocks.forEach((block) => {
    const href = /<a href="([^"]*saleshistory\.org\/?[^"]*)"/i.exec(block);
    const badge = /class="label_icon">([^<]*)</i.exec(block);
    const price = /class="list-price">([^<]*)</i.exec(block);
    const title = /<h5>\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const thumb = /<img src="([^"]+)"/i.exec(block);
    const loc = /class="car-location">([\s\S]*)$/i.exec(block);
    out.push({
      detailUrl: href ? normalizeUrl(href[1]) : null,
      auctionBadge: badge ? text(badge[1]).toLowerCase() : null,
      soldPrice: price ? toInt(price[1]) : null,
      title: title ? text(title[1]) : null,
      thumb: thumb ? thumb[1] : null,
      location: loc ? text(loc[1]) : null,
    });
  });
  return out;
}

function normalizeUrl(href) {
  const raw = String(href || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return "https:" + raw;
  return null;
}

/** Розбір детальної сторінки — єдине джерело всіх полів. */
function parseDetail(html, vin) {
  const page = String(html || "");
  const rows = tableRows(page);
  const sidebar = /Auction Info([\s\S]{0,900})/i.exec(page);
  const sideText = sidebar ? text(sidebar[1]) : "";
  const auctionM = /Auction:\s*([a-z]+)/i.exec(sideText);
  const lotM = /Lot number:\s*([\w-]+)/i.exec(sideText);
  const sellerM = /Seller:\s*([^:]*?)\s*VIN:/i.exec(sideText);
  const priceM = /class="price_info">\s*<p>([^<]*)</i.exec(page);

  const images = [];
  const seen = {};
  const imgRe = /https:\/\/saleshistory\.org\/uploads\/[^"'\s>)]+/g;
  let im;
  while ((im = imgRe.exec(page))) {
    if (!seen[im[0]]) {
      seen[im[0]] = true;
      images.push(im[0]);
    }
  }
  // Тека фото — незалежне підтвердження аукціону: i<lot> = IAAI, c<lot> = Copart.
  const dirM = /\/uploads\/([ic])(\d+)\//.exec(page);

  const loc = parseLocation(rows.location);
  const miles = parseMileage(rows.mileage);
  const sale = parseSaleDate(rows["date of sale"]);
  const pageVin = rows.vin || null;

  const auction = auctionM ? auctionM[1].toLowerCase() : null;
  const dirAuction = dirM ? (dirM[1] === "i" ? "iaai" : "copart") : null;

  return {
    vin: pageVin || vin || null,
    auction: auction || dirAuction,
    auctionFromUploads: dirAuction,
    lotNumber: lotM ? lotM[1] : dirM ? dirM[2] : null,
    seller: sellerM ? text(sellerM[1]) || null : null,
    soldPrice: toInt(priceM ? priceM[1] : null),
    saleDate: sale.saleDate,
    saleTime: sale.saleTime,
    odometer: miles.odometer,
    odometerBrand: miles.odometerBrand,
    primaryDamage: rows["primary damage"] || null,
    secondaryDamage: rows["secondary damage"] || null,
    year: toInt(rows.year),
    make: rows.make || null,
    model: rows.model || null,
    engine: rows.engine || null,
    transmission: rows.transmission || null,
    color: rows["body color"] || null,
    drive: rows.drive || null,
    fuel: rows.fuel || null,
    keys: rows.keys || null,
    condition: rows.condition || null,
    documents: rows.documents || null,
    location: loc.location,
    locationState: loc.state,
    locationZip: loc.zip,
    acv: toInt(rows["estimated retail value"]),
    usRepairCost: toInt(rows["estimated repair cost"]),
    images: images,
  };
}

function detailUrl(vin) {
  return "https://" + String(vin).toLowerCase() + ".saleshistory.org/";
}

async function getText(url, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  if (!res.ok) {
    const err = new Error("saleshistory " + res.status + " " + url);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

/**
 * VIN → аукціонна історія. Повертає {found:false} без кидання помилки, коли
 * авто просто нема в базі: «є в Україні, аукціонної історії нема» — це теж
 * спостереження, і воно має зберігатись, а не зникати.
 */
async function fetchVinHistory(vin, opts) {
  const options = opts || {};
  const value = String(vin || "")
    .trim()
    .toUpperCase();
  if (!VIN_RE.test(value))
    throw new Error("VIN має бути 17 символів без I, O, Q");

  const searchUrl = SEARCH_URL + value;
  const searchHtml = await getText(searchUrl, options.fetch);
  const cards = parseSearchResults(searchHtml);
  if (!cards.length) {
    return { found: false, vin: value, source: "saleshistory", searchUrl };
  }

  const url = cards[0].detailUrl || detailUrl(value);
  const detailHtml = await getText(url, options.fetch);
  const data = parseDetail(detailHtml, value);

  const notes = [];
  if (
    cards[0].auctionBadge &&
    data.auction &&
    cards[0].auctionBadge !== data.auction
  ) {
    // Бейдж видачі бреше — фіксуємо розбіжність, а не мовчки обираємо один.
    notes.push(
      "бейдж пошуку каже " +
        cards[0].auctionBadge +
        ", сторінка лота — " +
        data.auction,
    );
  }
  if (data.vin && data.vin !== value) {
    notes.push("сторінка віддала інший VIN: " + data.vin);
  }

  return Object.assign({}, data, {
    found: true,
    vin: value,
    source: "saleshistory",
    searchUrl,
    url,
    auctionBadge: cards[0].auctionBadge || null,
    notes: notes,
  });
}

module.exports = {
  fetchVinHistory,
  parseSearchResults,
  parseDetail,
  detailUrl,
  parseLocation,
  parseMileage,
  parseSaleDate,
  tableRows,
  text,
  toInt,
};
