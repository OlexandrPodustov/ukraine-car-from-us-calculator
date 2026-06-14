// Локальний сервер: роздає статику + логує результати пошуку ціни в SQLite.
// Запуск: npm start  (Node 24+, вбудований node:sqlite).
// БД: data/searches.db — відкривається будь-яким SQLite-переглядачем.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = process.env.PORT || 5500;

// ── DB ──────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const db = new DatabaseSync(path.join(ROOT, "data", "searches.db"));
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
].forEach(function (col) {
  try {
    db.exec("ALTER TABLE searches ADD COLUMN " + col);
  } catch (e) {
    /* колонка вже існує */
  }
});

// Колонки списку (без важких JSON-масивів) — для таблиці пошуків
const LIST_COLS =
  "id, ts, make, model, year, engine_type, engine_volume, marka_id, " +
  "model_id, model_matched, market_price, sample_count, arithmetic_mean, " +
  "iq_mean, median, total_cost, diff, category";

const insertStmt = db.prepare(`
  INSERT INTO searches
    (ts, make, model, year, engine_type, engine_volume, marka_id, model_id,
     model_matched, market_price, sample_count, arithmetic_mean, iq_mean,
     median, total_cost, diff, category, prices_json, percentiles_json,
     classifieds_json, filters_json)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    image_count   INTEGER,
    primary_thumb TEXT,
    primary_hd    TEXT,
    image360_url  TEXT,
    images_json   TEXT,
    videos_json   TEXT,
    raw_json      TEXT
  )
`);

const LOT_LIST_COLS =
  "id, ts, url, auction, lot_number, vin, year, make, model, series, " +
  "body_style, fuel, engine, transmission, color, odometer, primary_damage, " +
  "title_brand, acv, repair_cost, buy_now_price, min_bid, selling_branch, " +
  "branch_state, sale_date, image_count, primary_thumb, primary_hd, image360_url";

const insertLotStmt = db.prepare(`
  INSERT INTO lots
    (ts, url, auction, lot_number, vin, year, make, model, series, body_style,
     fuel, engine, cylinders, drive, transmission, color, odometer,
     primary_damage, secondary_damage, title_brand, title_state, acv,
     repair_cost, buy_now_price, min_bid, selling_branch, branch_state,
     sale_date, image_count, primary_thumb, primary_hd, image360_url,
     images_json, videos_json, raw_json)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  // Захист від path traversal
  if (!filePath.startsWith(ROOT)) {
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
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
      .prepare("SELECT * FROM searches WHERE id = ?")
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
    sendJson(res, 200, lot);
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
            p.url || null,
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
          );
          sendJson(res, 201, { ok: true });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (req.method === "GET") {
      var lots = db
        .prepare(
          "SELECT " + LOT_LIST_COLS + " FROM lots ORDER BY id DESC LIMIT 200",
        )
        .all();
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
            num(p.diff),
            p.category || null,
            Array.isArray(p.prices) ? JSON.stringify(p.prices) : null,
            p.percentiles ? JSON.stringify(p.percentiles) : null,
            Array.isArray(p.classifieds)
              ? JSON.stringify(p.classifieds)
              : null,
            Array.isArray(p.filtersApplied)
              ? JSON.stringify(p.filtersApplied)
              : null,
          );
          sendJson(res, 201, { ok: true });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (req.method === "GET") {
      var rows = db
        .prepare(
          "SELECT " + LIST_COLS + " FROM searches ORDER BY id DESC LIMIT 200",
        )
        .all();
      sendJson(res, 200, rows);
      return;
    }
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, function () {
  console.log("▶ http://localhost:" + PORT);
  console.log("  SQLite: " + path.join(ROOT, "data", "searches.db"));
  console.log("  Перегляд логів: http://localhost:" + PORT + "/api/searches");
});
