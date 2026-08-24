"use strict";
/**
 * AUTO.RIA /auto/info — єдине місце, де можна взяти VIN українського
 * оголошення. Пошук по VIN в API немає (див. skill autoria-api), тож ланцюжок
 * завжди такий: URL оголошення → auto_id → /auto/info → VIN.
 *
 * Ключ читається з config.js ТЕКСТОМ: файл gitignored, це не модуль, і
 * scripts/vin-plate.mjs уже дістає з нього proxyUrl рівно так само.
 *
 * Годинний ліміт вільного тарифу низький (~25 викликів/год), тому кожен виклик
 * тут — свідомий: сервер ходить у RIA лише на явний lookup, ніколи фоном.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASE = "https://developers.ria.com";

function readConfigValue(key) {
  try {
    const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
    const m = new RegExp(key + ':\\s*"([^"]*)"').exec(src);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function apiKey() {
  return process.env.AUTO_RIA_TOKEN || readConfigValue("autoRiaToken");
}

/**
 * Приймає що завгодно з того, що людина може вставити:
 * повний URL оголошення, /auto_..._40023169.html, або голий id.
 */
function parseAdvertId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^\d{5,}$/.test(raw)) return parseInt(raw, 10);
  const m = /(\d{5,})(?:\.html)?(?:[?#]|$)/.exec(raw.split("?")[0]);
  return m ? parseInt(m[1], 10) : null;
}

async function fetchAdvert(autoId, opts) {
  const options = opts || {};
  const key = options.apiKey || apiKey();
  if (!key)
    throw new Error("немає autoRiaToken (config.js або AUTO_RIA_TOKEN)");
  const url =
    BASE +
    "/auto/info?api_key=" +
    encodeURIComponent(key) +
    "&auto_id=" +
    autoId;
  const doFetch = options.fetch || globalThis.fetch;
  const res = await doFetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(function () {
    return null;
  });
  if (!res.ok) {
    const err = new Error("AUTO.RIA " + res.status);
    err.status = res.status;
    // 429 — годинний ліміт, 403 — вичерпаний пакет; це різні біди.
    err.rateLimited = res.status === 429 || res.status === 403;
    throw err;
  }
  // Пакет може закінчитись при HTTP 200 — тоді в тілі лежить {error: "..."}.
  if (body && body.error) {
    const err = new Error(String(body.error));
    err.rateLimited = true;
    throw err;
  }
  if (!body || !body.autoData) throw new Error("AUTO.RIA: порожня відповідь");
  return body;
}

/** Плоский зріз /auto/info під колонки resales. Сирий json зберігається окремо. */
function normalizeAdvert(body) {
  const a = body.autoData || {};
  const state = body.stateData || {};
  const bar = body.autoInfoBar || {};
  const dealer = body.dealer || {};
  const photos = (body.photoData && body.photoData.all) || [];
  const vin = String(body.VIN || "")
    .trim()
    .toUpperCase();
  return {
    autoId: a.autoId || null,
    url: body.linkToView ? "https://auto.ria.com" + body.linkToView : null,
    vin: vin || null,
    priceUsd: body.USD || null,
    priceUah: body.UAH || null,
    year: a.year || null,
    // raceInt — тисячі км («38» = 38 000). У БД тримаємо кілометри.
    mileageKm: typeof a.raceInt === "number" ? a.raceInt * 1000 : null,
    city: state.name || null,
    region: state.regionName || null,
    fuel: a.fuelName || null,
    gearbox: a.gearboxName || null,
    drive: a.driveName || null,
    // custom: 0 — розмитнене; 1 — «під розмитнення».
    custom: typeof a.custom === "number" ? a.custom : null,
    damaged: bar.damage ? 1 : 0,
    addDate: body.addDate || null,
    updateDate: body.updateDate || null,
    soldDate: body.soldDate || null,
    active: a.active === false ? 0 : 1,
    dealer: dealer.name || null,
    description: a.description || null,
    photoCount: photos.length || null,
    title: body.title || null,
    markName: body.markName || null,
    modelName: body.modelName || null,
  };
}

module.exports = {
  apiKey,
  parseAdvertId,
  fetchAdvert,
  normalizeAdvert,
  readConfigValue,
};
