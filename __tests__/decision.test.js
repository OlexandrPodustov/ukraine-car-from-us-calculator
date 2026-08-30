/**
 * Порівняння способів вкласти гроші: арифметика, провенанс і два зміщення.
 *
 * Тести тут перевіряють не «щось порахувалось», а СЕМАНТИКУ: що річна
 * дохідність не плутається з маржею за угоду, що гривнева ставка ділиться на
 * девальвацію, а не віднімається, що неділиму квартиру не «купують на 35 %»,
 * і що уникнута витрата не масштабується під капітал. Кожна з цих чотирьох
 * помилок дає правдоподібне число і жодного винятку — тобто рівно той клас
 * багів, який у цьому репозиторії вже ловили руками.
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const d = require("../lib/decision.js");
const opts = require("../lib/decision-options.js");
const evidence = require("../lib/decision-evidence.js");
const decisionDbLib = require("../lib/decision-db.js");

const YEAR = 365;

function ctxFor(over) {
  return opts.defaultContext(
    Object.assign({ capital: 10000, horizonDays: YEAR, uncertain: {} }, over),
  );
}

describe("IRR", () => {
  test("подвоєння за рік — це 100 % річних", () => {
    const r = d.irr([
      { t: 0, amount: -1000 },
      { t: YEAR, amount: 2000 },
    ]);
    expect(r).toBeCloseTo(1.0, 6);
  });

  test("той самий приріст за півроку — це більше, ніж за рік", () => {
    const half = d.irr([
      { t: 0, amount: -1000 },
      { t: YEAR / 2, amount: 1200 },
    ]);
    const full = d.irr([
      { t: 0, amount: -1000 },
      { t: YEAR, amount: 1200 },
    ]);
    // Уся суть модуля в одному рядку: +20 % за 180 днів і +20 % за 365 днів
    // у таблиці resales.html виглядають однаково, а це різні бізнеси.
    expect(half).toBeGreaterThan(full);
    expect(full).toBeCloseTo(0.2, 6);
  });

  test("потік одного знаку не має IRR — і повертає null, а не нуль", () => {
    expect(
      d.irr([
        { t: 0, amount: -100 },
        { t: YEAR, amount: -50 },
      ]),
    ).toBeNull();
    expect(d.irr([{ t: 0, amount: 100 }])).toBeNull();
  });
});

describe("валюта", () => {
  test("девальвація ділить, а не віднімає", () => {
    // 16.47 % у гривні при девальвації 8 % — це 7.84 %, не 8.47 %.
    const usd = d.uahRateToUsd(0.1647, 0.08);
    expect(usd).toBeCloseTo(0.0784, 4);
    expect(usd).not.toBeCloseTo(0.0847, 3);
  });

  test("при нульовій девальвації гривнева ставка не змінюється", () => {
    expect(d.uahRateToUsd(0.1647, 0)).toBeCloseTo(0.1647, 10);
  });
});

describe("податок", () => {
  test("пільга ОВДП справді щось важить", () => {
    // 15 % без податку сильніші за 17 % депозиту після ПДФО 18 % + ВЗ 5 %.
    const ovdp = d.afterTax(0.15, 0);
    const deposit = d.afterTax(0.17, 0.23);
    expect(ovdp).toBeGreaterThan(deposit);
    expect(deposit).toBeCloseTo(0.1309, 4);
  });
});

describe("потреба в капіталі", () => {
  test("пік — це landed ПЛЮС ремонт, а не лише перший платіж", () => {
    const flows = [
      { t: 0, amount: -30000 },
      { t: 45, amount: -5000 },
      { t: 360, amount: 40000 },
    ];
    // Рахувати потребу за першим платежем означало б спланувати угоду, на
    // яку не вистачить грошей рівно посередині.
    expect(d.peakOutflow(flows)).toBe(35000);
  });

  test("неділима опція, дорожча за капітал, помічається недоступною", () => {
    const ctx = ctxFor({ capital: 35000 });
    const flat = opts.baseOptions(ctx).find((o) => o.id === "apartment");
    const res = d.evaluate(flat, ctx);
    expect(flat.lumpy).toBe(true);
    expect(res.feasible).toBe(false);
    expect(res.requiredCapital).toBeGreaterThan(ctx.capital);
  });

  test("подільна опція просто робиться меншою і лишається доступною", () => {
    const ctx = ctxFor({ capital: 1000 });
    const ovdp = opts.baseOptions(ctx).find((o) => o.id === "ovdp-uah");
    expect(d.evaluate(ovdp, ctx).feasible).toBe(true);
  });

  test("уникнута витрата НЕ масштабується під капітал", () => {
    // Її потік — різниця двох сценаріїв, і його «пікова потреба» випадкова.
    // Масштабування під неї роздувало ремонт на $3 000 у п'ятнадцятикратний.
    const ctx = ctxFor({ capital: 35000 });
    const keep = opts.keepCarOption({ repairCost: 3000 });
    expect(d.evaluate(keep, ctx).scale).toBe(1);
  });
});

describe("термінальний капітал", () => {
  test("опція рівно з базовою дохідністю дає рівно базовий результат", () => {
    const ctx = ctxFor({ capital: 10000, baselineRate: 0.1 });
    const flows = [
      { t: 0, amount: -10000 },
      { t: YEAR, amount: 10000 * 1.1 },
    ];
    expect(d.terminalWealth(flows, ctx)).toBeCloseTo(11000, 6);
  });

  test("гроші поза опцією теж ростуть під базову ставку", () => {
    const ctx = ctxFor({ capital: 10000, baselineRate: 0.1 });
    // Опція взяла лише половину капіталу — решта лежить під базову.
    const flows = [
      { t: 0, amount: -5000 },
      { t: YEAR, amount: 5000 },
    ];
    // 5000 під 10 % = 5500, плюс 5000 без приросту = 10500.
    expect(d.terminalWealth(flows, ctx)).toBeCloseTo(10500, 6);
  });

  test("цикл не обрізається посередині горизонту", () => {
    // Авто, куплене за два місяці до горизонту, ще не продане, і зараховувати
    // його виручку не можна — це та сама помилка усічення, через яку
    // «44 % річних» у нашій таблиці виявились фікцією.
    const ctx = ctxFor({ capital: 10000, baselineRate: 0, horizonDays: 500 });
    const flows = [
      { t: 0, amount: -10000 },
      { t: 300, amount: 13000 },
    ];
    const rolled = d.rollCycles(flows, 300, ctx);
    expect(rolled.cycles).toBe(1); // 2×300 = 600 > 500, тож лише один
    expect(rolled.wealth).toBeCloseTo(13000, 6);
  });
});

describe("симуляція", () => {
  test("той самий seed дає той самий результат", () => {
    const ctx = ctxFor({ capital: 35000 });
    const o = opts.keepCarOption();
    const a = d.simulate(o, ctx, { trials: 300, seed: 5 });
    const b = d.simulate(o, ctx, { trials: 300, seed: 5 });
    expect(a.p50).toBe(b.p50);
    expect(d.simulate(o, ctx, { trials: 300, seed: 6 }).p50).not.toBe(a.p50);
  });

  test("P10 ≤ медіана ≤ P90", () => {
    const ctx = ctxFor({ capital: 35000 });
    const s = d.simulate(opts.keepCarOption(), ctx, { trials: 500, seed: 3 });
    expect(s.p10).toBeLessThanOrEqual(s.p50);
    expect(s.p50).toBeLessThanOrEqual(s.p90);
  });

  test("девальвація рухає і гривневу опцію, і планку одночасно", () => {
    // Тягнути їх незалежно означало б вигадати кореляцію, якої немає.
    const ctx = opts.defaultContext({ capital: 35000, horizonDays: 3 * YEAR });
    const rand = d.rng(1);
    const trial = d.drawContext(ctx, rand);
    expect(trial.devaluationPct).not.toBe(ctx.devaluationPct);
    expect(trial.baselineRate).toBeCloseTo(
      d.uahRateToUsd(ctx.baselineUahRatePct / 100, trial.devaluationPct / 100),
      10,
    );
  });

  test("без невизначеності результат детермінований", () => {
    const ctx = ctxFor({ capital: 35000, uncertain: {} });
    const plain = Object.assign({}, opts.keepCarOption());
    delete plain.uncertain;
    const s = d.simulate(plain, ctx, { trials: 100, seed: 1 });
    expect(s.deterministic).toBe(true);
    expect(s.p10).toBe(s.p90);
  });
});

describe("ваги", () => {
  test("нульова сума ваг — це помилка, а не тихий нуль", () => {
    const ctx = ctxFor({});
    expect(() => d.score([], { return: 0 }, ctx)).toThrow(/ваг/);
  });

  test("нормалізація не ділить на нуль, коли всі значення рівні", () => {
    expect(d.normalize([5, 5, 5], true)).toEqual([1, 1, 1]);
  });

  test("напрямок критерію враховується", () => {
    expect(d.normalize([1, 10], true)).toEqual([0, 1]);
    expect(d.normalize([1, 10], false)).toEqual([1, 0]);
  });
});

describe("час оператора — це гроші", () => {
  test("більше годин → менший результат, за інших рівних", () => {
    const ctx = ctxFor({ capital: 35000, hourlyRate: 40 });
    const base = {
      id: "x",
      kind: "flip",
      landed: 30000,
      exitPrice: 40000,
      daysToListing: 300,
      hours: 0,
    };
    const cheap = d.evaluate(base, ctx).terminalWealth;
    const dear = d.evaluate(
      Object.assign({}, base, { hours: 100 }),
      ctx,
    ).terminalWealth;
    expect(dear).toBeLessThan(cheap);
  });

  test("нульова ставка години знімає цей вплив повністю", () => {
    const ctx = ctxFor({ capital: 35000, hourlyRate: 0 });
    const base = {
      id: "x",
      kind: "flip",
      landed: 30000,
      exitPrice: 40000,
      daysToListing: 300,
      hours: 0,
    };
    expect(
      d.evaluate(Object.assign({}, base, { hours: 100 }), ctx).terminalWealth,
    ).toBeCloseTo(d.evaluate(base, ctx).terminalWealth, 6);
  });
});

describe("чутливість", () => {
  // Сторож на реальну помилку методики, зловлену 2026-08-29: ±25 % від
  // значення систематично занижує вплив полів, чиє САМЕ ІСНУВАННЯ
  // припущене. Ремонт, невідомий узагалі, при ±25 % виглядав третім за
  // важливістю; за заявленим діапазоном він перший.
  const ctx = ctxFor({ capital: 35000, horizonDays: 3 * YEAR });
  const option = {
    id: "f",
    kind: "flip",
    landed: 35000,
    exitPrice: 46000,
    daysToListing: 300,
    daysOnMarket: 60,
    uaRepairCost: 4200,
    hours: 0,
    uncertain: { uaRepairCost: { p10: 2100, p90: 8400 } },
  };

  test("заявлений діапазон перебиває ±deltaPct", () => {
    const s = d.sensitivity(option, ctx, ["uaRepairCost"], 25);
    const row = s.rows[0];
    expect(row.basis).toBe("range");
    expect(row.low.value).toBe(2100);
    expect(row.high.value).toBe(8400);
  });

  test("поле без заявленого діапазону падає на ±deltaPct", () => {
    const s = d.sensitivity(option, ctx, ["landed"], 25);
    expect(s.rows[0].basis).toBe("relative");
    expect(s.rows[0].low.value).toBeCloseTo(35000 * 0.75, 6);
  });

  test("заявлений діапазон дає більший розмах, ніж вузьке збурення", () => {
    const wide = d.sensitivity(option, ctx, ["uaRepairCost"], 25).rows[0].swing;
    const narrow = d.sensitivity(
      Object.assign({}, option, { uncertain: {} }),
      ctx,
      ["uaRepairCost"],
      25,
    ).rows[0].swing;
    expect(wide).toBeGreaterThan(narrow);
  });

  test("сортовано за впливом, а не за порядком полів", () => {
    const s = d.sensitivity(
      option,
      ctx,
      ["overheadCost", "exitPrice", "landed"],
      25,
    );
    for (let i = 1; i < s.rows.length; i += 1) {
      expect(s.rows[i - 1].swing).toBeGreaterThanOrEqual(s.rows[i].swing);
    }
  });
});

describe("невідомий тип опції", () => {
  test("кидає, а не рахує нуль", () => {
    expect(() => d.optionFlows({ id: "x", kind: "щось" }, ctxFor({}))).toThrow(
      /Невідомий тип/,
    );
  });
});

// ── Шар доказів: працює на СПРАВЖНІЙ базі ──────────────────────────

describe("докази з таблиці resales", () => {
  const dbPath = path.join(__dirname, "..", "data", "searches.db");
  const hasDb = fs.existsSync(dbPath);
  const maybe = hasDb ? test : test.skip;
  let db;
  let summary;

  beforeAll(() => {
    if (!hasDb) return;
    db = new DatabaseSync(dbPath, { readOnly: true });
    summary = evidence.summarize(db);
  });

  maybe("зведення виводиться з реальних рядків", () => {
    expect(summary.n).toBeGreaterThan(0);
    expect(summary.exitMultiple.basis).toBe("measured");
    expect(summary.exitMultiple.n).toBe(summary.n);
    expect(summary.exitMultiple.median).toBeGreaterThan(1);
  });

  maybe("днів до оголошення — додатні й з розкидом", () => {
    expect(summary.daysToListing.min).toBeGreaterThan(0);
    expect(summary.daysToListing.p90).toBeGreaterThan(
      summary.daysToListing.p10,
    );
  });

  maybe(
    "мала вибірка по днях у продажу помічається здогадом, а не медіаною",
    () => {
      const flip = evidence.flipOption(summary);
      if (summary.daysOnMarket.n >= 3) {
        expect(flip.provenance.daysOnMarket.basis).toBe("measured");
      } else {
        // Два зняті оголошення — це не медіана, і видавати їх за неї не можна.
        expect(flip.provenance.daysOnMarket.basis).toBe("assumed");
      }
    },
  );

  maybe("знижка на торг завжди лишається здогадом", () => {
    // Реальної ціни продажу в Україні ми не бачимо ніколи — тож це поле не
    // може стати «зміряним» саме собою, скільки б рядків не набралось.
    const flip = evidence.flipOption(summary);
    expect(flip.provenance.priceHaircutPct.basis).toBe("assumed");
  });

  maybe("перекриття лотом перебиває медіану набору", () => {
    const flip = evidence.flipOption(summary, {
      landed: 12345,
      exitPrice: 20000,
    });
    expect(flip.landed).toBe(12345);
    expect(flip.exitPrice).toBe(20000);
    // А розкид усе одно береться з набору — лот дає центр, набір дає межі.
    expect(flip.uncertain.daysToListing.p90).toBeGreaterThan(0);
  });

  maybe("поріг відсіву — це число для поля «цільова знижка»", () => {
    const ctx = opts.defaultContext({ capital: 35000, horizonDays: 3 * YEAR });
    const flip = evidence.flipOption(summary);
    const baseline = ctx.capital * d.grow(ctx.baselineRate, ctx.horizonDays);
    const th = d.screeningThreshold(flip, ctx, baseline);
    expect(th).not.toBeNull();
    expect(th.exitMultiple).toBeGreaterThan(1);
    // Знижка й множник — це одна величина у двох формах.
    expect(th.discountPct).toBeCloseTo((1 - 1 / th.exitMultiple) * 100, 9);
  });

  maybe("повне порівняння ранжує всі опції", () => {
    const ctx = opts.defaultContext({ capital: 35000, horizonDays: 3 * YEAR });
    const list = [evidence.flipOption(summary)]
      .concat(opts.baseOptions(ctx))
      .concat([opts.keepCarOption()]);
    const res = d.compare(list, ctx, { trials: 200, seed: 2 });
    expect(res.ranked.length).toBe(list.length);
    expect(res.winner).not.toBeNull();
    // Бали спадають — це і є ранжування.
    for (let i = 1; i < res.ranked.length; i += 1) {
      expect(res.ranked[i - 1].score).toBeGreaterThanOrEqual(
        res.ranked[i].score,
      );
    }
  });
});

// ── Запис: CLI та API мусять писати однакові рядки ──────────────────

describe("збереження зрізів", () => {
  let dbFile;
  let db;
  let store;

  beforeAll(() => {
    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dec-")), "t.db");
    db = new DatabaseSync(dbFile);
    store = decisionDbLib.attach(db);
  });
  afterAll(() => {
    try {
      db.close();
    } catch (e) {
      /* байдуже */
    }
  });

  function runOnce() {
    const ctx = opts.defaultContext({ capital: 20000, horizonDays: YEAR });
    const res = d.compare(opts.baseOptions(ctx), ctx, { trials: 100, seed: 4 });
    return { res, ctx };
  }

  test("зріз пише контекст, а не лише вердикт", () => {
    const { res } = runOnce();
    const id = store.write(
      decisionDbLib.toRow(res, { scenarioKey: "t", evidenceN: 10 }),
    );
    const row = store.byId(id);
    expect(row.capital).toBe(20000);
    expect(row.baseline_rate).toBeGreaterThan(0);
    expect(row.evidence_n).toBe(10);
    // Без збережених опцій через рік буде видно вердикт, але не припущення.
    expect(JSON.parse(row.options_json).length).toBeGreaterThan(0);
  });

  test("повторний прогін ДОПИСУЄ зріз, а не перезаписує", () => {
    const before = store.series("append").length;
    const { res } = runOnce();
    store.write(decisionDbLib.toRow(res, { scenarioKey: "append" }));
    store.write(decisionDbLib.toRow(res, { scenarioKey: "append" }));
    // Ставка ОВДП, курс і кількість спостережень на кожну дату були свої —
    // саме вони пояснюють вердикт, і стирати їх не можна.
    expect(store.series("append").length).toBe(before + 2);
  });

  test("серія повертається хронологічно", () => {
    const rows = store.series("append");
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].ts >= rows[i - 1].ts).toBe(true);
    }
  });
});
