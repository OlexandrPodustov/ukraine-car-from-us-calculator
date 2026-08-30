"use strict";
/**
 * Збереження сценаріїв порівняння.
 *
 * `attach(db)` на переданому з'єднанні — так само, як lib/resale-db.js, і з
 * тієї ж причини: тими самими таблицями користуються і сервер, і
 * scripts/decide.mjs, тож схема мусить бути в одному місці, інакше CLI і API
 * розійдуться тихо.
 *
 * ГОЛОВНЕ ПРАВИЛО ЦІЄЇ ТАБЛИЦІ: рішення НЕ перезаписуються.
 *
 * Порівняння, зроблене сьогодні, спиралось на сьогоднішню ставку ОВДП,
 * сьогоднішній курс і те, скільки спостережень було в `resales` на той
 * момент. Через півроку всі три будуть іншими. Перезаписати старий сценарій
 * новим розрахунком означало б стерти те, ЧОМУ рішення тоді виглядало
 * правильним — а це єдине, за чим можна судити, чи воно було правильним.
 * Тому кожен прогін — новий рядок, а `scenario_key` лише групує серію.
 *
 * Це те саме правило датованих зрізів, що в docs/*-baseline.md і в
 * `resale_price_history`.
 */

function attach(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                TEXT NOT NULL,
      -- Групує прогони однієї серії ("купити S5 чи ОВДП"). Не унікальний:
      -- у серії стільки рядків, скільки разів її переганяли.
      scenario_key      TEXT NOT NULL,
      title             TEXT,

      -- Контекст: без нього рядок неможливо прочитати через рік.
      capital           REAL,
      horizon_days      INTEGER,
      currency          TEXT,
      baseline_rate     REAL,
      devaluation_pct   REAL,
      hourly_rate       REAL,

      -- Провенанс ставок на момент прогону. Курс і ставка ОВДП рухаються;
      -- landed, порахований півроку тому, порахований не за сьогоднішнім.
      rates_asof        TEXT,
      usd_uah           REAL,
      ovdp_uah_pct      REAL,

      -- Скільки спостережень стояло за параметрами пригону. Один і той самий
      -- висновок на n = 2 і на n = 40 — це різні висновки.
      evidence_n        INTEGER,
      evidence_json     TEXT,

      weights_json      TEXT,
      options_json      TEXT,
      results_json      TEXT,

      winner_id         TEXT,
      winner_score      REAL,
      -- Переможець за грошима може не збігтися з переможцем за балами.
      -- Коли не збігається — рішення прийняли ваги, а не арифметика, і це
      -- має бути видно в таблиці, а не лише в JSON.
      wealth_winner_id  TEXT,
      weights_flipped   INTEGER,

      notes             TEXT
    )
  `);

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_decisions_key ON decisions (scenario_key, ts)",
  );

  const insert = db.prepare(`
    INSERT INTO decisions (
      ts, scenario_key, title, capital, horizon_days, currency, baseline_rate,
      devaluation_pct, hourly_rate, rates_asof, usd_uah, ovdp_uah_pct,
      evidence_n, evidence_json, weights_json, options_json, results_json,
      winner_id, winner_score, wealth_winner_id, weights_flipped, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  function write(row) {
    const r = insert.run(
      row.ts || new Date().toISOString(),
      String(row.scenario_key || "default"),
      row.title || null,
      row.capital == null ? null : Number(row.capital),
      row.horizon_days == null ? null : Number(row.horizon_days),
      row.currency || "USD",
      row.baseline_rate == null ? null : Number(row.baseline_rate),
      row.devaluation_pct == null ? null : Number(row.devaluation_pct),
      row.hourly_rate == null ? null : Number(row.hourly_rate),
      row.rates_asof || null,
      row.usd_uah == null ? null : Number(row.usd_uah),
      row.ovdp_uah_pct == null ? null : Number(row.ovdp_uah_pct),
      row.evidence_n == null ? null : Number(row.evidence_n),
      row.evidence_json || null,
      row.weights_json || null,
      row.options_json || null,
      row.results_json || null,
      row.winner_id || null,
      row.winner_score == null ? null : Number(row.winner_score),
      row.wealth_winner_id || null,
      row.weights_flipped ? 1 : 0,
      row.notes || null,
    );
    return Number(r.lastInsertRowid);
  }

  const listStmt = db.prepare(
    "SELECT id, ts, scenario_key, title, capital, horizon_days, baseline_rate," +
      " evidence_n, winner_id, winner_score, wealth_winner_id, weights_flipped, notes" +
      " FROM decisions ORDER BY id DESC LIMIT ?",
  );
  const byIdStmt = db.prepare("SELECT * FROM decisions WHERE id = ?");
  const seriesStmt = db.prepare(
    "SELECT * FROM decisions WHERE scenario_key = ? ORDER BY ts ASC",
  );

  return {
    write: write,
    list: function (limit) {
      return listStmt.all(Number(limit) || 100);
    },
    byId: function (id) {
      return byIdStmt.get(Number(id));
    },
    /** Уся серія в хронологічному порядку — щоб бачити, як висновок дрейфував. */
    series: function (key) {
      return seriesStmt.all(String(key));
    },
  };
}

/** Результат compare() → рядок таблиці. Одна точка правди для CLI та API. */
function toRow(result, meta) {
  const m = meta || {};
  const ctx = result.ctx;
  return {
    ts: new Date().toISOString(),
    scenario_key: m.scenarioKey || "default",
    title: m.title || null,
    capital: ctx.capital,
    horizon_days: ctx.horizonDays,
    currency: ctx.currency,
    baseline_rate: ctx.baselineRate,
    devaluation_pct: ctx.devaluationPct,
    hourly_rate: ctx.hourlyRate,
    rates_asof: m.ratesAsOf || ctx.asof || null,
    usd_uah: m.usdUah == null ? null : m.usdUah,
    ovdp_uah_pct: m.ovdpUahPct == null ? null : m.ovdpUahPct,
    evidence_n: m.evidenceN == null ? null : m.evidenceN,
    evidence_json: m.evidence ? JSON.stringify(m.evidence) : null,
    weights_json: JSON.stringify(ctx.weights || {}),
    // Опції зберігаються цілком: інакше через рік буде видно вердикт, але не
    // те, на яких припущеннях він стояв.
    options_json: JSON.stringify(
      result.options.map(function (o) {
        return o.option;
      }),
    ),
    results_json: JSON.stringify(
      result.options.map(function (o) {
        return {
          id: o.id,
          label: o.label,
          irr: o.irr,
          terminalWealth: o.terminalWealth,
          vsBaseline: o.vsBaseline,
          score: o.score,
          scoreParts: o.scoreParts,
          sim: o.sim,
          feasible: o.feasible,
          requiredCapital: o.requiredCapital,
          cycles: o.cycles,
          cycleDays: o.cycleDays,
        };
      }),
    ),
    winner_id: result.winner ? result.winner.id : null,
    winner_score: result.winner ? result.winner.score : null,
    wealth_winner_id: result.byWealth[0] ? result.byWealth[0].id : null,
    weights_flipped: result.weightsFlippedOrder,
    notes: m.notes || null,
  };
}

module.exports = { attach: attach, toRow: toRow };
