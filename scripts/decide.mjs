#!/usr/bin/env node
/**
 * Порівняти способи вкласти ті самі гроші — з консолі.
 *
 *   node scripts/decide.mjs                              # порівняння на дефолтах
 *   node scripts/decide.mjs --capital 50000 --years 2
 *   node scripts/decide.mjs --lot 42                     # пригін = конкретний лот із БД
 *   node scripts/decide.mjs --evidence                   # що саме зміряно в resales
 *   node scripts/decide.mjs --sensitivity                # що справді вирішує
 *   node scripts/decide.mjs --save --key "s5-vs-ovdp"    # датований зріз у decisions
 *   node scripts/decide.mjs --series "s5-vs-ovdp"        # як висновок дрейфував
 *
 * Пише через lib/decision-db.js — тим самим кодом, що й /api/decision/compare,
 * тож CLI і API дають однакові рядки.
 *
 * Ключове, що варто розуміти, читаючи вивід: «дохідність» пригону тут — це
 * РІЧНА дохідність капіталу, а не маржа за угоду. +33 % за 300 днів і +33 %
 * за 900 днів — це 40 % річних і 12 % річних; у таблиці на resales.html вони
 * виглядають однаково, тут — ні.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./lib/app-vm.mjs";

const require = createRequire(import.meta.url);
const decision = require("../lib/decision.js");
const decisionOptions = require("../lib/decision-options.js");
const decisionEvidence = require("../lib/decision-evidence.js");
const decisionDbLib = require("../lib/decision-db.js");

const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "searches.db");

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes("--" + name);
}
function opt(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : fallback;
}

const money = (n) =>
  n == null || !isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US");
const pctStr = (n, dp = 1) =>
  n == null || !isFinite(n) ? "—" : (n * 100).toFixed(dp) + "%";

const db = new DatabaseSync(DB_PATH);
const decisionDb = decisionDbLib.attach(db);

// ── --series: як висновок дрейфував ────────────────────────────────
if (flag("series")) {
  const key = opt("series", "default");
  const rows = decisionDb.series(key);
  if (!rows.length) {
    console.log(`Серія «${key}» порожня.`);
    process.exit(0);
  }
  console.log(`Серія «${key}» — ${rows.length} зріз(ів):\n`);
  console.log(
    "дата                 капітал  базова  n  переможець    за грошима",
  );
  for (const r of rows) {
    console.log(
      [
        r.ts.slice(0, 19).replace("T", " "),
        money(r.capital).padStart(8),
        pctStr(r.baseline_rate).padStart(7),
        String(r.evidence_n ?? "—").padStart(2),
        (r.winner_id || "—").padEnd(13),
        r.wealth_winner_id || "—",
      ].join(" "),
    );
  }
  console.log(
    "\nЗріз ніколи не перезаписується: ставка ОВДП, курс і кількість\n" +
      "спостережень на кожну дату були свої, і саме вони пояснюють вердикт.",
  );
  process.exit(0);
}

const summary = decisionEvidence.summarize(db);

// ── --evidence: що саме зміряно ────────────────────────────────────
if (flag("evidence")) {
  console.log(`Спостережень у resales, придатних до виміру: ${summary.n}\n`);
  const show = (s) =>
    s.basis === "measured"
      ? `медіана ${s.median.toFixed(2)}  (P10 ${s.p10.toFixed(2)} … P90 ${s.p90.toFixed(2)}, n=${s.n})`
      : `— (n=${s.n})`;
  console.log("  ціна в Україні ÷ landed :", show(summary.exitMultiple));
  console.log("  днів до оголошення      :", show(summary.daysToListing));
  console.log("  днів у продажу          :", show(summary.daysOnMarket));
  console.log("  landed, $               :", show(summary.landed));
  console.log("  валова за угоду         :", show(summary.grossRoi));
  console.log(
    `\n  знято з продажу без дати продажу: ${summary.daysOnMarket.withdrawnWithoutSale}`,
  );
  console.log(
    `  рядків з українським ремонтом: ${summary.uaRepairCoverage.n} з ${summary.n}`,
  );
  if (summary.uaRepairCoverage.note)
    console.log("\n  ⚠ " + summary.uaRepairCoverage.note);
  console.log(
    "\n  ⚠ Два зміщення, обидва вгору:\n" +
      "    1. Ціна в Україні — ЗАПИТАНА. Активних оголошень: " +
      summary.rows.filter((r) => r.stillListed).length +
      ` з ${summary.n} — за ці гроші ще ніхто не дав.\n` +
      "    2. «Днів до оголошення» — це до ВИСТАВЛЕННЯ, не до продажу.\n" +
      "       Капітал вивільняється, коли авто продане.",
  );
  console.log("\nПорядково:\n");
  console.log(
    "VIN               авто                     landed   в Україні   ×      днів",
  );
  for (const r of summary.rows) {
    console.log(
      [
        r.vin,
        (r.car || "").slice(0, 22).padEnd(23),
        money(r.landed).padStart(8),
        money(r.askingUa).padStart(10),
        r.exitMultiple.toFixed(2).padStart(6),
        String(Math.round(r.daysToListing)).padStart(6),
        r.stillListed ? " (ще висить)" : "",
        r.locationWeak ? " ⚠локація" : "",
      ].join(" "),
    );
  }
  process.exit(0);
}

// ── Контекст і опції ───────────────────────────────────────────────
const years = Number(opt("years", 3));
const ctx = decisionOptions.defaultContext({
  capital: Number(opt("capital", 35000)),
  horizonDays: Math.round(years * 365),
  hourlyRate: Number(opt("hourly", 40)),
});

/**
 * `--lot N` заміняє медіану набору конкретним лотом: його landed з останнього
 * пошуку, ринкову ціну звідти ж, ремонт — той, що порахувала vision-гілка.
 * Набір при цьому лишається джерелом РОЗКИДУ (P10/P90), а лот дає центр.
 */
let flipOverride = {};
const lotId = opt("lot", null);
if (lotId) {
  const lot = db
    .prepare(
      "SELECT l.id, l.auction, l.lot_number, l.make, l.model, l.year, l.ua_repair_cost," +
        " s.total_cost, s.market_price FROM lots l" +
        " LEFT JOIN searches s ON s.lot_id = l.id" +
        " WHERE l.id = ? ORDER BY s.id DESC LIMIT 1",
    )
    .get(Number(lotId));
  if (!lot) {
    console.error(`Лота ${lotId} немає в базі.`);
    process.exit(1);
  }
  if (!lot.total_cost || !lot.market_price) {
    console.error(
      `У лота ${lotId} немає збереженого пошуку ціни (total_cost / market_price).\n` +
        "Спочатку прогони його через калькулятор — інакше landed і ринок брати нізвідки.",
    );
    process.exit(1);
  }
  flipOverride = {
    landed: lot.total_cost,
    exitPrice: lot.market_price,
    uaRepairCost: lot.ua_repair_cost ?? undefined,
  };
  console.log(
    `Лот ${lotId}: ${[lot.year, lot.make, lot.model].filter(Boolean).join(" ")} ` +
      `(${lot.auction} ${lot.lot_number})\n` +
      `  landed ${money(lot.total_cost)}, ринок ${money(lot.market_price)}, ` +
      `ремонт ${lot.ua_repair_cost ? money(lot.ua_repair_cost) : "не рахований"}\n`,
  );
}

const flip = decisionEvidence.flipOption(summary, flipOverride);
const options = [flip]
  .concat(decisionOptions.baseOptions(ctx))
  .concat([decisionOptions.keepCarOption()]);

const result = decision.compare(options, ctx, {
  trials: Number(opt("trials", 3000)),
  seed: 7,
});

// ── Вивід ──────────────────────────────────────────────────────────
console.log(
  `Капітал ${money(ctx.capital)} · горизонт ${years} р. · година часу ${money(ctx.hourlyRate)}\n` +
    `Базова ставка (ОВДП у гривні, переведена в долар при девальвації ` +
    `${ctx.devaluationPct.toFixed(2)}%): ${pctStr(ctx.baselineRate, 2)} → ${money(result.baseline)}\n`,
);

console.log(
  "опція                          бал    річних      P10      P50      P90  >базової",
);
console.log("─".repeat(84));
for (const r of result.ranked) {
  console.log(
    [
      (r.label || r.id).slice(0, 29).padEnd(30),
      r.score.toFixed(3).padStart(5),
      (r.irr === null ? "—" : pctStr(r.irr)).padStart(8),
      money(r.sim.p10).padStart(9),
      money(r.sim.p50).padStart(9),
      money(r.sim.p90).padStart(9),
      pctStr(r.sim.probBeatBaseline, 0).padStart(9),
      r.feasible ? "" : "  НЕДОСТУПНО",
    ].join(" "),
  );
}

if (result.weightsFlippedOrder) {
  console.log(
    `\n⚠ Ваги перевернули порядок: за чистими грошима перший — ` +
      `«${result.byWealth[0].label}», за балами — «${result.ranked[0].label}».\n` +
      "  Рішення прийняли переваги, а не арифметика. Це нормально, але це треба знати.",
  );
}

const flipRow = result.options.find((o) => o.id === "flip");
if (flipRow) {
  const th = decision.screeningThreshold(flipRow.option, ctx, result.baseline);
  console.log("\n── Поріг відсіву для пригону ──");
  if (!th) {
    console.log(
      "  Беззбитковості немає в розумному діапазоні цін: за цих припущень\n" +
        "  пригін не дотягує до облігацій за жодної ціни продажу.",
    );
  } else {
    console.log(
      `  Щоб лише ЗРІВНЯТИСЬ з ОВДП, авто має піти за ${money(th.exitPrice)}\n` +
        `  = ${th.exitMultiple.toFixed(3)} × landed, тобто цільова знижка від ринку ` +
        `${th.discountPct.toFixed(1)} %.\n` +
        `  Медіана нашого набору: ${summary.exitMultiple.median.toFixed(3)} × ` +
        `(знижка ${((1 - 1 / summary.exitMultiple.median) * 100).toFixed(1)} %).\n` +
        `  Це те саме поле «цільова знижка» на калькуляторі — там дефолт 30 %.`,
    );
  }
}

if (flag("sensitivity")) {
  const sens = decision.sensitivity(
    flip,
    ctx,
    [
      "exitPrice",
      "landed",
      "uaRepairCost",
      "priceHaircutPct",
      "hours",
      "daysOnMarket",
      "daysToListing",
      "overheadCost",
    ],
    25,
  );
  console.log("\n── Що справді вирішує (вплив на капітал через горизонт) ──");
  for (const r of sens.rows) {
    console.log(
      `  ${r.field.padEnd(18)} ${(Math.round(r.low.value) + " … " + Math.round(r.high.value)).padStart(20)}` +
        ` → розмах ${money(r.swing).padStart(9)}  ${r.basis === "range" ? "заявлений діапазон" : "±25 %"}`,
    );
  }
  console.log(
    "\n  Зверху те, що вирішує, а не те, що найлегше налаштувати.\n" +
      "  Рядки на різній основі в лоб не порівнюються: «заявлений діапазон» —\n" +
      "  це реальна невизначеність поля, «±25 %» — просто збурення. Поле, чиє\n" +
      "  САМЕ ІСНУВАННЯ припущене (ремонт: 0 з 10 рядків), при ±25 % виглядає\n" +
      "  дрібним, хоча вирішує все — саме на цьому тут одного разу ледь не\n" +
      "  побудувався хибний висновок.",
  );
}

if (flag("save")) {
  const id = decisionDb.write(
    decisionDbLib.toRow(result, {
      scenarioKey: opt("key", "default"),
      title: opt("title", null),
      notes: opt("notes", null),
      evidence: summary,
      evidenceN: summary.n,
      ovdpUahPct: decisionOptions.RATES.ovdpUah.value,
      ratesAsOf: decisionOptions.ASOF,
    }),
  );
  console.log(`\nЗбережено зріз #${id} у серію «${opt("key", "default")}».`);
}
