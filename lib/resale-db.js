"use strict";
/**
 * Схема й доступ до таблиць перепродажів.
 *
 * Живе окремо від server.js, бо тим самим кодом користується
 * scripts/resale.mjs: інакше CLI і API писали б рядки за двома різними
 * наборами правил, і розійшлись би тихо (як уже було з мапінгом лотів).
 *
 * `attach(db)` створює таблиці на переданому з'єднанні — так само, як
 * scripts/vin-plate.mjs самодогоняє ALTER TABLE, щоб працювати на базі, яку
 * новий сервер ще не відкривав.
 */
const { RESALE_COLS } = require("./resale.js");

function attach(db) {
  // Одне спостереження = «це авто купили з молотка за X, зараз воно
  // продається в Україні за Y». Окремо від lots: там лоти, які МИ розглядали
  // до купівлі, тут — чужі авто, які вже приїхали. Змішування отруїло б
  // обидві вибірки.
  db.exec(`
    CREATE TABLE IF NOT EXISTS resales (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                    TEXT NOT NULL,
      vin                   TEXT NOT NULL,

      ria_auto_id           INTEGER,
      ria_url               TEXT,
      ria_price_usd         INTEGER,
      ria_price_uah         INTEGER,
      ria_year              INTEGER,
      ria_mileage_km        INTEGER,
      ria_city              TEXT,
      ria_region            TEXT,
      ria_fuel              TEXT,
      ria_gearbox           TEXT,
      ria_drive             TEXT,
      ria_custom            INTEGER,
      ria_damage            INTEGER,
      ria_add_date          TEXT,
      ria_update_date       TEXT,
      ria_sold_date         TEXT,
      ria_active            INTEGER,
      ria_dealer            TEXT,
      ria_description       TEXT,
      ria_photo_count       INTEGER,
      ria_title             TEXT,
      ria_json              TEXT,

      auction               TEXT,
      lot_number            TEXT,
      sold_price            INTEGER,
      sale_date             TEXT,
      odometer              INTEGER,
      odometer_brand        TEXT,
      primary_damage        TEXT,
      secondary_damage      TEXT,
      acv                   INTEGER,
      us_repair_cost        INTEGER,
      keys_present          TEXT,
      condition             TEXT,
      documents             TEXT,
      seller                TEXT,
      location              TEXT,
      location_state        TEXT,
      location_zip          TEXT,
      color                 TEXT,
      engine                TEXT,
      transmission          TEXT,
      drive                 TEXT,
      fuel                  TEXT,
      make                  TEXT,
      model                 TEXT,
      year                  INTEGER,
      images_json           TEXT,
      history_source        TEXT,
      history_url           TEXT,
      history_json          TEXT,

      landed_cost           INTEGER,
      landed_breakdown_json TEXT,
      matched_location      TEXT,
      location_weak         INTEGER,
      location_matched      INTEGER,
      inland_us_fee         INTEGER,
      departure_port        TEXT,
      destination_port      TEXT,
      vehicle_type          TEXT,
      risk_coefficient      REAL,
      max_bid_for_market    INTEGER,
      ua_repair_cost        INTEGER,
      ua_repair_source      TEXT,
      overhead_cost         INTEGER,
      gross_profit          INTEGER,
      net_profit            INTEGER,
      margin_pct            REAL,
      days_to_market        INTEGER,
      rates_asof            TEXT,
      usd_uah               REAL,
      eur_usd               REAL,
      notes                 TEXT
    )
  `);

  // Ключ = (VIN, оголошення). Те саме авто може продаватись двічі — це два
  // рядки, і різниця між ними теж дані. Повторний lookup того самого
  // оголошення оновлює свій рядок, а не плодить дублі.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_resales_vin_advert " +
      "ON resales(vin, ria_auto_id)",
  );

  // Ціна оголошення змінюється, і саме дельта відрізняє «просять» від
  // «дають». Тому історія ДОПИСУЄТЬСЯ — те саме правило, що для датованих
  // зрізів у docs/*-baseline.md.
  db.exec(`
    CREATE TABLE IF NOT EXISTS resale_price_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      resale_id     INTEGER NOT NULL,
      ts            TEXT NOT NULL,
      price_usd     INTEGER,
      ria_active    INTEGER,
      ria_sold_date TEXT
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_resale_price_history_resale " +
      "ON resale_price_history(resale_id)",
  );

  // Черга кандидатів на спостереження. `searches.classifieds_json` тримає
  // сотні `auto_id`, які AUTO.RIA віддала при пошуку ціни, і кожен із них
  // коштує одного виклику `/auto/info` — а той ділить годинний ліміт вільного
  // тарифу з усім іншим. Тому спроба фіксується НЕЗАЛЕЖНО від того, чи щось
  // із неї вийшло: без цього кожен наступний прохід витрачав би ліміт на ті
  // самі мертві id (оголошення без VIN, VIN без аукціонної історії).
  //
  // Окремо від `resales` свідомо: там дані, тут журнал спроб. Рядок у
  // `resales` з'являється лише коли є VIN, а знати треба й про решту.
  db.exec(`
    CREATE TABLE IF NOT EXISTS resale_candidates (
      auto_id INTEGER PRIMARY KEY,
      ts      TEXT NOT NULL,
      status  TEXT NOT NULL,
      vin     TEXT,
      note    TEXT
    )
  `);

  // Колонки / «?» / UPSERT будуються з одного масиву: розсинхрон цих трьох
  // списків уже ламав lots і саме його пінує __tests__/server.test.js.
  const insertStmt = db.prepare(
    "INSERT INTO resales (" +
      RESALE_COLS.join(", ") +
      ") VALUES (" +
      RESALE_COLS.map(() => "?").join(", ") +
      ") ON CONFLICT(vin, ria_auto_id) DO UPDATE SET " +
      RESALE_COLS.filter((c) => c !== "vin" && c !== "ria_auto_id")
        .map((c) => c + "=excluded." + c)
        .join(", "),
  );
  // UPSERT свідомо перезаписує все, а не COALESCE'ить, як lots: рядок
  // збирається в JS (mergeResale) поверх збереженого, тож «худша» повторна
  // відповідь нічого не затирає, а похідні (gross/net/margin) рахуються вже
  // від злитих значень, а не лишаються від старої ціни.

  const byKeyStmt = db.prepare(
    "SELECT * FROM resales WHERE vin = ? AND ria_auto_id IS ?",
  );
  const byIdStmt = db.prepare("SELECT * FROM resales WHERE id = ?");
  const insertPriceStmt = db.prepare(
    "INSERT INTO resale_price_history (resale_id, ts, price_usd, ria_active, " +
      "ria_sold_date) VALUES (?, ?, ?, ?, ?)",
  );
  const lastPriceStmt = db.prepare(
    "SELECT price_usd, ria_active, ria_sold_date FROM resale_price_history " +
      "WHERE resale_id = ? ORDER BY id DESC LIMIT 1",
  );
  const priceHistoryStmt = db.prepare(
    "SELECT id, ts, price_usd, ria_active, ria_sold_date FROM " +
      "resale_price_history WHERE resale_id = ? ORDER BY id",
  );

  // Список без важких *_json — так само, як LIST_COLS для пошуків.
  const LIST_COLS = ["id"].concat(RESALE_COLS.filter((c) => !/_json$/.test(c)));
  const listStmt = db.prepare(
    "SELECT " +
      LIST_COLS.join(", ") +
      " FROM resales ORDER BY id DESC LIMIT 200",
  );
  const allStmt = db.prepare("SELECT * FROM resales ORDER BY id");
  const candidateStmt = db.prepare(
    "SELECT auto_id, ts, status, vin, note FROM resale_candidates " +
      "WHERE auto_id = ?",
  );
  const markCandidateStmt = db.prepare(
    "INSERT INTO resale_candidates (auto_id, ts, status, vin, note) " +
      "VALUES (?, ?, ?, ?, ?) ON CONFLICT(auto_id) DO UPDATE SET " +
      "ts=excluded.ts, status=excluded.status, vin=excluded.vin, " +
      "note=excluded.note",
  );
  const candidateStatsStmt = db.prepare(
    "SELECT status, COUNT(*) AS n FROM resale_candidates GROUP BY status",
  );

  function byKey(vin, autoId) {
    return byKeyStmt.get(vin, autoId === undefined ? null : autoId);
  }

  /**
   * Пише злитий рядок і, якщо ціна/статус оголошення змінились, ДОПИСУЄ зріз
   * у resale_price_history. Перезапис попереднього зрізу знищив би саме те,
   * заради чого таблиця існує.
   */
  function write(row) {
    insertStmt.run(
      ...RESALE_COLS.map((c) => (row[c] === undefined ? null : row[c])),
    );
    const saved = byKey(
      row.vin,
      row.ria_auto_id == null ? null : row.ria_auto_id,
    );
    if (!saved) return null;
    const last = lastPriceStmt.get(saved.id);
    const changed =
      !last ||
      last.price_usd !== saved.ria_price_usd ||
      last.ria_active !== saved.ria_active ||
      (last.ria_sold_date || null) !== (saved.ria_sold_date || null);
    if (changed) {
      insertPriceStmt.run(
        saved.id,
        new Date().toISOString(),
        saved.ria_price_usd,
        saved.ria_active,
        saved.ria_sold_date,
      );
    }
    return saved.id;
  }

  /** Розкриває *_json і підклеює історію ціни — як GET /api/searches/:id. */
  function expand(row) {
    const out = Object.assign({}, row);
    [
      "images_json",
      "history_json",
      "landed_breakdown_json",
      "ria_json",
    ].forEach((col) => {
      const key = col.replace(/_json$/, "");
      try {
        out[key] = out[col] ? JSON.parse(out[col]) : null;
      } catch (e) {
        out[key] = null;
      }
      delete out[col];
    });
    out.priceHistory = priceHistoryStmt.all(row.id);
    return out;
  }

  return {
    db,
    write,
    expand,
    byKey,
    byId: (id) => byIdStmt.get(id),
    list: () => listStmt.all(),
    all: () => allStmt.all(),
    priceHistory: (id) => priceHistoryStmt.all(id),
    candidate: (autoId) => candidateStmt.get(autoId),
    markCandidate: (autoId, status, vin, note) =>
      markCandidateStmt.run(
        autoId,
        new Date().toISOString(),
        status,
        vin || null,
        note || null,
      ),
    candidateStats: () => candidateStatsStmt.all(),
  };
}

module.exports = { attach };
