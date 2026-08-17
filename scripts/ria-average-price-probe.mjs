#!/usr/bin/env node
/**
 * Зонд поведінки /auto/average_price на developers.ria.com.
 *
 * Питання, на яке відповідає: які фільтри цей ендпоінт реально застосовує, і
 * над якою вибіркою рахує середні — бо `n` у відповідях подекуди більший за
 * кількість активних оголошень на сайті (911: n=144 при 80 активних).
 *
 * Запуск (потрібен config.js з CONFIG.autoRiaToken або змінна RIA_KEY):
 *   node scripts/ria-average-price-probe.mjs            # надрукувати таблицю
 *   node scripts/ria-average-price-probe.mjs --append   # ще й дописати зріз у docs/
 *
 * ⚠️ Ліміт безкоштовного тарифу — погодинний (~25 запитів). Тут рівно 9 викликів,
 * і скрипт зупиняється на першій відмові по ліміту, щоб не палити квоту даремно.
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "ria-average-price-probe.md");
const APPEND = process.argv.includes("--append");

function apiKey() {
  if (process.env.RIA_KEY) return process.env.RIA_KEY;
  const cfg = join(ROOT, "config.js");
  if (!existsSync(cfg)) throw new Error("нема config.js і нема RIA_KEY");
  const m = readFileSync(cfg, "utf8").match(/autoRiaToken:\s*"([^"]+)"/);
  if (!m) throw new Error("у config.js не знайдено autoRiaToken");
  return m[1];
}

const BMW = "marka_id=9&model_id=3219"; // BMW 3 Series
const PORSCHE = "marka_id=59&model_id=539"; // Porsche 911
const y = (lo, hi) => `&yers%5B0%5D.gte=${lo}&yers%5B0%5D.lte=${hi}`;

// Кожен зонд відрізняється від попереднього рівно одним доданим фільтром —
// так видно, чи цей фільтр взагалі впливає на вибірку.
const PROBES = [
  ["BMW 3 Series, без фільтрів", "marka_id=9&model_id=3219"],
  ["+ рік 2019–2021", BMW + y(2019, 2021)],
  ["+ рік 2022–2024", BMW + y(2022, 2024)],
  ["рік 2019–2021 + бензин", BMW + y(2019, 2021) + "&fuel_id%5B0%5D=1"],
  [
    "рік 2019–2021 + бензин + автомат",
    BMW + y(2019, 2021) + "&fuel_id%5B0%5D=1&gear_id%5B0%5D=2",
  ],
  ["рік 2019–2021 + custom=1", BMW + y(2019, 2021) + "&custom=1"],
  [
    "рік 2019–2021 + customs_cleared=1&abroad=0 (імена з сайту)",
    BMW + y(2019, 2021) + "&customs_cleared=1&abroad=0",
  ],
  ["Porsche 911, без року", PORSCHE],
  ["Porsche 911, рік 2018–2020", PORSCHE + y(2018, 2020)],
];

const num = (v) => (v == null ? "—" : Math.round(v).toLocaleString("uk-UA"));

async function probe(query, key) {
  const url = `https://developers.ria.com/auto/average_price?main_category=1&${query}&api_key=${key}`;
  const resp = await fetch(url);
  const body = await resp.json().catch(() => ({}));
  if (body.error) return { limited: true, error: body.error, url };
  if (resp.status === 429) return { limited: true, error: "429", url };
  if (!resp.ok) return { error: body.message || `HTTP ${resp.status}`, url };
  return {
    url,
    total: body.total,
    mean: body.arithmeticMean,
    iqMean: body.interQuartileMean,
    median: body.percentiles && body.percentiles["50.0"],
  };
}

const key = apiKey();
const rows = [];
for (const [label, query] of PROBES) {
  const r = await probe(query, key);
  if (r.limited) {
    console.error(`⛔ ліміт вичерпано на «${label}»: ${r.error}`);
    console.error("Спробуй за годину — решта зондів не виконана.");
    break;
  }
  rows.push([label, r]);
  console.log(
    `${label.padEnd(56)} n=${String(r.total ?? r.error).padStart(6)}  ` +
      `mean=${num(r.mean)}  IQ=${num(r.iqMean)}  med=${num(r.median)}`,
  );
  await new Promise((res) => setTimeout(res, 400));
}

if (APPEND && rows.length) {
  const date = new Date().toISOString().slice(0, 10);
  const table = [
    `\n## Зріз ${date}\n`,
    "| Запит | n | arithmeticMean | interQuartileMean | median |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows.map(
      ([label, r]) =>
        `| ${label} | ${r.total ?? r.error} | ${num(r.mean)} | ${num(r.iqMean)} | ${num(r.median)} |`,
    ),
    "",
  ].join("\n");
  appendFileSync(DOC, table);
  console.log(`\nДописано в ${DOC}`);
}
