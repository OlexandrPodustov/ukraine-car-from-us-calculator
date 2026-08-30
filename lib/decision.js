"use strict";
/**
 * Порівняння способів вкласти ті самі гроші: пригін авто, ОВДП, депозит,
 * квартира під оренду, ремонт власного авто.
 *
 * Навіщо окремий модуль. Решта репозиторію рахує УГОДУ: скільки коштує
 * пригнати конкретний лот і за скільки він піде тут. Але «+$11 616 валової»
 * — це не рішення. Рішення — це «чи варто взагалі», і воно вимагає трьох
 * речей, яких у цифрі маржі немає:
 *
 *   1. ЧАСУ. У docs/resale-markup-baseline.md чорним по білому: «Днів до
 *      ринку 112…926 — половина капіталу стоїть довше за пів року, і в жодну
 *      маржу цей час не закладений». +21 % за 386 днів і +23 % за 112 днів —
 *      це різні бізнеси, а не сусідні рядки таблиці.
 *   2. АЛЬТЕРНАТИВИ. Ті самі гроші в ОВДП дають 15–16 % річних без податку,
 *      без ремонту й без розмитнення. Маржа, менша за це, — збиток, хоч і
 *      записана зі знаком «плюс».
 *   3. ВАЛЮТИ. Пригін — доларовий бізнес (landed у USD, ціна на RIA у USD).
 *      ОВДП у гривні — ні. 16,47 % річних у гривні при девальвації 8 % — це
 *      7,8 % у доларі, а не 16,47 %.
 *
 * ЯК ЦЕ РАХУЄТЬСЯ. Кожна опція зводиться до потоку платежів і далі до двох
 * чисел:
 *
 *   • IRR — річна дохідність самого потоку. Інтуїтивна, але порівнювати за
 *     нею опції РІЗНОЇ тривалості не можна: IRR мовчки припускає, що гроші,
 *     які повернулись через 112 днів, до кінця горизонту крутяться під ту
 *     саму ставку. Для пригону це припущення і є вся суперечка.
 *   • Термінальний капітал на СПІЛЬНОМУ горизонті — з явною ставкою
 *     реінвестування. Це те, за чим опції ранжуються: скільки грошей буде на
 *     руках через N років, якщо піти цим шляхом. Різна тривалість, різний
 *     розмір вкладення й різна повторюваність тут враховані за побудовою.
 *
 * Ваги (`score`) стоять ПОВЕРХ грошей і лише для того, чого гроші не
 * ловлять: скільки це нервів, чи можна вийти достроково, чи все яйце в
 * одному кошику. Час оператора в ваги НЕ виноситься — він переводиться в
 * гроші через `hourlyRate` і віднімається з потоку. Інакше «зусилля» стає
 * повзунком, яким можна підкрутити будь-який висновок.
 *
 * Числа за замовчуванням — у lib/decision-options.js, їхнє походження й дати
 * вимірювання — у docs/decision-baseline.md. Параметри пригону НЕ
 * захардкоджені: вони виводяться з таблиці `resales` (lib/decision-evidence.js).
 */

const DAYS_PER_YEAR = 365;

// ── Дрібна математика ───────────────────────────────────────────────

function isNum(v) {
  return typeof v === "number" && isFinite(v);
}

function num(v, fallback) {
  var n = typeof v === "string" ? parseFloat(v) : v;
  return isNum(n) ? n : fallback === undefined ? 0 : fallback;
}

function pct(v, fallback) {
  return num(v, fallback) / 100;
}

/** Складний ріст за `days` днів під річну ставку `rate` (0.16 = 16 %). */
function grow(rate, days) {
  return Math.pow(1 + rate, days / DAYS_PER_YEAR);
}

function median(arr) {
  var s = arr
    .filter(isNum)
    .slice()
    .sort(function (a, b) {
      return a - b;
    });
  if (!s.length) return null;
  var m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Перцентиль за лінійною інтерполяцією; `p` у частках (0.1 = P10). */
function percentile(arr, p) {
  var s = arr
    .filter(isNum)
    .slice()
    .sort(function (a, b) {
      return a - b;
    });
  if (!s.length) return null;
  if (s.length === 1) return s[0];
  var idx = (s.length - 1) * p;
  var lo = Math.floor(idx);
  var hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// ── Валюта й податки ────────────────────────────────────────────────

/**
 * Гривнева ставка → доларова. 16,47 % річних при девальвації 8 % — це не
 * 8,47 %, а (1.1647 / 1.08 − 1) = 7,84 %: девальвація ділить, а не віднімає.
 * На однорічному горизонті різниця дрібна, на трирічному — вже ні.
 */
function uahRateToUsd(uahRate, devaluationRate) {
  return (1 + uahRate) / (1 + devaluationRate) - 1;
}

/**
 * Ставка після податку. Для ОВДП taxPct = 0 — це пряма пільга ПКУ, а не
 * округлення; саме вона робить 15 % ОВДП сильнішими за 17 % депозиту.
 */
function afterTax(rate, taxRate) {
  return rate * (1 - taxRate);
}

// ── IRR ─────────────────────────────────────────────────────────────

/** Чиста приведена вартість потоку під річну ставку `rate`. */
function npv(flows, rate) {
  var sum = 0;
  for (var i = 0; i < flows.length; i += 1) {
    sum += flows[i].amount / grow(rate, flows[i].t);
  }
  return sum;
}

/**
 * Річна дохідність потоку (XIRR) — бісекцією, а не Ньютоном: похідна тут
 * норовлива, а бісекція на [-0.99, 100] не розходиться ніколи. Повертає
 * null, коли кореня немає (усі платежі одного знаку) — це не нуль, і
 * підставляти нуль замість «не визначено» не можна.
 */
function irr(flows) {
  if (!flows || flows.length < 2) return null;
  var hasPos = false;
  var hasNeg = false;
  for (var i = 0; i < flows.length; i += 1) {
    if (flows[i].amount > 0) hasPos = true;
    if (flows[i].amount < 0) hasNeg = true;
  }
  if (!hasPos || !hasNeg) return null;

  var lo = -0.9999;
  var hi = 100;
  var fLo = npv(flows, lo);
  var fHi = npv(flows, hi);
  if (!isNum(fLo) || !isNum(fHi) || fLo * fHi > 0) return null;

  for (var k = 0; k < 200; k += 1) {
    var mid = (lo + hi) / 2;
    var fMid = npv(flows, mid);
    if (!isNum(fMid)) return null;
    if (Math.abs(fMid) < 1e-9) return mid;
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

// ── Потреба в капіталі ──────────────────────────────────────────────

/**
 * Скільки грошей опція реально зв'язує — максимум, на який ти будь-коли в
 * мінусі. Для пригону це НЕ landed: ремонт платиться через півтора місяця,
 * коли авто вже куплене, тож пікова потреба = landed + ремонт. Рахувати
 * потребу лише за першим платежем означало б спланувати угоду, на яку не
 * вистачить грошей рівно посередині.
 */
function peakOutflow(flows) {
  var sorted = flows.slice().sort(function (a, b) {
    return a.t - b.t;
  });
  var running = 0;
  var peak = 0;
  for (var i = 0; i < sorted.length; i += 1) {
    running += sorted[i].amount;
    if (-running > peak) peak = -running;
  }
  return peak;
}

/**
 * Привести опцію до наявного капіталу.
 *
 * Квартира за $100 тис. і капітал $35 тис. — це не «опція гірша», це опція
 * НЕДОСТУПНА. Порівнювати їх у лоб не можна: доходність порахувалась би на
 * $100 тис., а термінальний капітал відняв би всі $100 тис. з $35 тис., і
 * квартира вийшла б катастрофою через помилку масштабу, а не через ринок.
 *
 * Тому потоки масштабуються до пікової потреби, а обмеження називається
 * вголос: `feasible = false` і `minCapital`. Нерухомість не ділиться на
 * частки — 0.35 квартири купити не можна, — і саме тому масштаб позначений
 * `lumpy`, а не тихо застосований.
 */
function scaleFlows(flows, ctx, option) {
  var need = peakOutflow(flows);
  // Уникнута витрата (полагодити своє авто) не масштабується взагалі. Її
  // потік — це РІЗНИЦЯ двох сценаріїв, і його «пікова потреба» — випадкова
  // величина завбільшки з залишкову вартість. Масштабування під неї
  // роздувало ремонт на $3 000 у п'ятнадцятикратний, і опція вигравала
  // арифметикою масштабу. Це про конкретне авто: скільки коштує, стільки й
  // коштує.
  var noScale =
    ctx.scaleToCapital === false ||
    (option && (option.noScale || option.kind === "avoided-cost"));
  if (!(need > 0) || noScale) {
    return {
      flows: flows,
      scale: 1,
      required: Math.max(need, 0),
      feasible: true,
    };
  }
  var scale = ctx.capital / need;
  if (!isNum(scale) || scale <= 0) scale = 1;
  var scaled =
    scale === 1
      ? flows
      : flows.map(function (f) {
          return { t: f.t, amount: f.amount * scale, label: f.label };
        });
  return {
    flows: scaled,
    scale: scale,
    required: need,
    // Подільну опцію можна просто зробити меншою — вона доступна завжди
    // (комісія й час просто з'їдають частину тіла). Недоступною буває лише
    // неділима: 0.35 квартири не існує.
    feasible: !(option && option.lumpy) || need <= ctx.capital + 1e-6,
    lumpy: !!(option && option.lumpy),
  };
}

// ── Термінальний капітал ────────────────────────────────────────────

/**
 * Скільки грошей на руках через `horizonDays`, якщо піти цим шляхом.
 *
 * Модель навмисно проста і вся її суть в одному рядку: СПОЧАТКУ ввесь
 * капітал лежить під базовою ставкою, а потоки опції — це дельти до нього.
 * Тож опція, гірша за базову, дає менше за базову автоматично, без окремої
 * гілки. Гроші, які опція повернула раніше горизонту, доростають під базову
 * ставку — і це припущення видно в полі `baselineRate`, а не заховане
 * всередині IRR.
 */
function terminalWealth(flows, ctx) {
  var H = ctx.horizonDays;
  var b = ctx.baselineRate;
  var wealth = ctx.capital * grow(b, H);
  for (var i = 0; i < flows.length; i += 1) {
    var f = flows[i];
    if (f.t > H) continue; // за горизонт не заглядаємо
    wealth += f.amount * grow(b, H - f.t);
  }
  return wealth;
}

/**
 * Повторюваний цикл (пригін, короткі ОВДП) на довгому горизонті.
 *
 * Один цикл описується потоком на одиницю вкладеного капіталу. Далі цикли
 * котяться, поки ЦІЛИЙ цикл ще влазить у горизонт; залишок часу капітал
 * лежить під базову ставку. Обрізати останній цикл посередині не можна:
 * авто, куплене за два місяці до горизонту, ще не продане, і зараховувати
 * його виручку — це і є та сама помилка усічення, через яку «44 % річних»
 * у нашій же таблиці виявились фікцією.
 */
function rollCycles(cycleFlows, cycleDays, ctx) {
  var H = ctx.horizonDays;
  var b = ctx.baselineRate;
  if (!(cycleDays > 0))
    return { wealth: terminalWealth(cycleFlows, ctx), cycles: 1 };

  var capital = ctx.capital;
  var t = 0;
  var cycles = 0;
  // Масштаб потоку: описаний цикл побудований на ctx.capital, тож на другому
  // колі всі його платежі множаться на (новий капітал / ctx.capital).
  while (t + cycleDays <= H + 1e-9) {
    var scale = capital / ctx.capital;
    // Увесь капітал лежить під базову ставку, а платежі циклу — дельти до
    // нього: платіж «−landed» на t=0 і знімає ці гроші з базової. Тому
    // цикл, що дає рівно базову дохідність, тут дає рівно базовий приріст.
    var end = capital * grow(b, cycleDays);
    for (var i = 0; i < cycleFlows.length; i += 1) {
      var f = cycleFlows[i];
      end += f.amount * scale * grow(b, cycleDays - f.t);
    }
    capital = end;
    t += cycleDays;
    cycles += 1;
    if (cycles > 1000) break; // страховка від нульового циклу
  }
  // Хвіст горизонту — під базову ставку.
  capital *= grow(b, H - t);
  return { wealth: capital, cycles: cycles };
}

// ── Побудова потоків за типом опції ─────────────────────────────────

/**
 * Час оператора — це гроші, а не «зусилля». 40 годин навколо одного пригону
 * при $40/год це $1 600; на маржі $6 282 це чверть. Виносити таке у ваги
 * означало б дозволити собі підкрутити висновок повзунком.
 */
function timeCost(hours, ctx) {
  return num(hours) * num(ctx.hourlyRate);
}

/** Ставка опції, приведена до валюти розрахунку й до «після податку». */
function effectiveRate(option, ctx) {
  var nominal = pct(option.ratePct);
  var afterTaxRate = afterTax(nominal, pct(option.taxPct));
  if ((option.currency || "USD") === "UAH" && ctx.currency === "USD") {
    return uahRateToUsd(afterTaxRate, pct(ctx.devaluationPct));
  }
  return afterTaxRate;
}

/**
 * Депозит / ОВДП: гроші зайшли, через строк вийшли з відсотком.
 * Комісія брокера знімається з тіла на вході — на 3,4 % валютних ОВДП
 * 1 % комісії це майже третина річного доходу, і ховати її не можна.
 */
function yieldFlows(option, ctx) {
  var capital = num(option.capital, ctx.capital);
  var term = num(option.termDays, ctx.horizonDays);
  var rate = effectiveRate(option, ctx);
  var fee = capital * pct(option.feePct);
  var flows = [
    {
      t: 0,
      amount: -capital - fee - timeCost(option.hours, ctx),
      label: "вкладення",
    },
    {
      t: term,
      amount: capital * grow(rate, term),
      label: "погашення з доходом",
    },
  ];
  return { flows: flows, cycleDays: term };
}

/**
 * Пригін і перепродаж. Порядок платежів тут і є вся чесність розрахунку:
 *
 *   t=0            −landed            (ставка + збори + фрахт + розмитнення)
 *   t=repairDay    −ремонт в Україні  (український, НЕ кошторис страховика США)
 *   t=exitDay      +ціна × (1 − знижка на торг) − комісія продажу
 *
 * `daysOnMarket` додається до `daysToListing` окремо, бо це різні речі:
 * перше ми зміряли лише на двох знятих оголошеннях, друге — на десяти.
 * `priceHaircutPct` існує тому, що `ria_price_usd` — ЗАПИТАНА ціна: 8 з 10
 * оголошень у нашій вибірці досі активні, тобто за цю ціну ще ніхто не дав.
 */
function flipFlows(option, ctx) {
  var landed = num(option.landed, ctx.capital);
  var repair = num(option.uaRepairCost);
  var overhead = num(option.overheadCost);
  var exitGross = num(option.exitPrice, landed * num(option.exitMultiple, 1));
  var haircut = pct(option.priceHaircutPct);
  var sellFee = pct(option.sellCostPct);
  var repairDay = num(option.repairDays, 30);
  var exitDay = num(option.daysToListing, 0) + num(option.daysOnMarket, 0);
  if (exitDay < repairDay) exitDay = repairDay;

  var netExit = exitGross * (1 - haircut);
  netExit -= netExit * sellFee;
  netExit -= netExit * pct(option.taxPct);

  var flows = [
    {
      t: 0,
      amount: -landed - overhead - timeCost(option.hours, ctx),
      label: "landed + накладні",
    },
  ];
  if (repair > 0)
    flows.push({ t: repairDay, amount: -repair, label: "ремонт в Україні" });
  flows.push({ t: exitDay, amount: netExit, label: "продаж в Україні" });
  return { flows: flows, cycleDays: exitDay };
}

/**
 * Квартира під оренду. Місячна рента спрощена до квартальної — на горизонті
 * у роки різниця в межах похибки самої ставки оренди, а потік удвадцятеро
 * коротший.
 */
function rentalFlows(option, ctx) {
  var price = num(option.price, ctx.capital);
  var acquire = price * pct(option.acquisitionCostPct);
  var horizon = ctx.horizonDays;
  var grossYear = price * pct(option.grossYieldPct);
  var netYear =
    grossYear * (1 - pct(option.vacancyPct)) * (1 - pct(option.taxPct)) -
    price * pct(option.maintenancePct) -
    timeCost(option.hoursPerYear, ctx);

  var flows = [
    { t: 0, amount: -price - acquire, label: "купівля + оформлення" },
  ];
  var step = 91.25; // квартал
  for (var t = step; t <= horizon + 1e-9; t += step) {
    flows.push({
      t: t,
      amount: (netYear * step) / DAYS_PER_YEAR,
      label: "оренда",
    });
  }
  var appreciation = pct(option.appreciationPct);
  if ((option.currency || "USD") === "UAH" && ctx.currency === "USD") {
    appreciation = uahRateToUsd(appreciation, pct(ctx.devaluationPct));
  }
  var exit =
    price * grow(appreciation, horizon) * (1 - pct(option.sellCostPct));
  flows.push({ t: horizon, amount: exit, label: "продаж квартири" });
  return { flows: flows, cycleDays: horizon };
}

/**
 * Ремонт власного авто. Це НЕ інвестиція — це уникнута витрата, і рахувати
 * її як інвестицію означає порівнювати різне.
 *
 * Порівняння коректне лише за однакової умови «авто в мене має бути». Тоді
 * два сценарії такі:
 *
 *   лагодити:   −ремонт зараз, −обслуговування щороку, +залишкова через H
 *   міняти:     −(нове − продаж старого) зараз, −обслуговування', +залишкова' через H
 *
 * У потік іде РІЗНИЦЯ (лагодити − міняти). Ремонт зазвичай дешевший за
 * заміну, тож на t=0 різниця додатна: лагодячи, ти вивільняєш капітал, а
 * платиш за це потім — гіршою залишковою і дорожчим обслуговуванням. Це
 * профіль позики, і його IRR читається саме так: «лагодити = позичити стільки
 * під стільки-то відсотків». Дешевше за базову ставку — лагодити варто.
 */
function avoidedCostFlows(option, ctx) {
  var horizon = ctx.horizonDays;
  var repair = num(option.repairCost);
  var replaceNet =
    num(option.replacementCost) - num(option.currentCarSaleValue);
  var keepMaint = num(option.keepMaintenancePerYear);
  var replaceMaint = num(option.replaceMaintenancePerYear);
  var keepResidual = num(option.keepResidual);
  var replaceResidual = num(option.replaceResidual);

  var flows = [
    {
      t: 0,
      amount: replaceNet - repair,
      label: "вивільнено, не купуючи інше авто",
    },
  ];
  var step = 91.25;
  for (var t = step; t <= horizon + 1e-9; t += step) {
    flows.push({
      t: t,
      amount: ((replaceMaint - keepMaint) * step) / DAYS_PER_YEAR,
      label: "різниця в обслуговуванні",
    });
  }
  flows.push({
    t: horizon,
    amount: keepResidual - replaceResidual,
    label: "різниця залишкової вартості",
  });
  return { flows: flows, cycleDays: horizon, borrowing: true };
}

const KINDS = {
  yield: yieldFlows,
  flip: flipFlows,
  rental: rentalFlows,
  "avoided-cost": avoidedCostFlows,
};

/** Потік платежів опції. Кидає на невідомому `kind` — мовчазний нуль гірший. */
function optionFlows(option, ctx) {
  var fn = KINDS[option.kind];
  if (!fn) throw new Error("Невідомий тип опції: " + option.kind);
  return fn(option, ctx);
}

// ── Детермінований прогін ───────────────────────────────────────────

/**
 * Одна опція → усі числа, за якими її порівнюють.
 *
 * `repeat` вирішує, чи цикл котиться далі: пригін і короткі ОВДП котяться
 * (це бізнес, який роблять повторно), квартира — ні (її купують один раз).
 */
function evaluate(option, ctx) {
  var built = optionFlows(option, ctx);
  // Масштаб до наявного капіталу — ДО всіх розрахунків: інакше квартира за
  // $100 тис. віднімала б $100 тис. від капіталу $35 тис. і виглядала б
  // провалом ринку замість того, чим вона є, — недоступною опцією.
  var fitted = scaleFlows(built.flows, ctx, option);
  var flows = fitted.flows;
  // IRR масштабом не рухається (це ставка, а не сума) — але рахуємо на
  // масштабованих, щоб усе далі йшло з одного джерела.
  var rate = irr(flows);

  var wealth;
  var cycles = 1;
  if (
    option.repeat &&
    built.cycleDays > 0 &&
    built.cycleDays < ctx.horizonDays
  ) {
    var rolled = rollCycles(flows, built.cycleDays, ctx);
    wealth = rolled.wealth;
    cycles = rolled.cycles;
  } else {
    wealth = terminalWealth(flows, ctx);
  }

  var baseline = ctx.capital * grow(ctx.baselineRate, ctx.horizonDays);
  var invested = 0;
  for (var i = 0; i < flows.length; i += 1) {
    if (flows[i].amount < 0) invested -= flows[i].amount;
  }

  return {
    id: option.id,
    label: option.label,
    kind: option.kind,
    irr: rate,
    // Скільки капіталу опція зв'язує в піку — і чи вистачає його в принципі.
    requiredCapital: fitted.required,
    scale: fitted.scale,
    feasible: fitted.feasible,
    // Неділимі активи (квартира) не масштабуються насправді: 0.35 квартири
    // не існує. Масштаб тут лише щоб порівняти ДОХІДНІСТЬ, і це треба
    // сказати, а не сховати.
    lumpy: !!option.lumpy,
    // Для профілю позики (ремонт свого авто) IRR читається навпаки: це
    // ставка, під яку ти фактично позичаєш, а не заробляєш.
    irrIsBorrowingRate: !!built.borrowing,
    terminalWealth: wealth,
    vsBaseline: wealth - baseline,
    cycles: cycles,
    cycleDays: built.cycleDays,
    capitalAtRisk: invested,
    hours:
      num(option.hours) +
      num(option.hoursPerYear) * (ctx.horizonDays / DAYS_PER_YEAR),
    flows: flows,
  };
}

// ── Невизначеність ──────────────────────────────────────────────────

/** mulberry32 — щоб прогін відтворювався за тим самим seed. */
function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Нормальний розподіл через Бокса–Мюллера. */
function gauss(rand, mean, sd) {
  var u = Math.max(rand(), 1e-12);
  var v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Одна вибірка значення. `spec` — або число (певність), або
 * {mean, sd} / {lo, hi} / {p10, p90}.
 */
function sample(spec, rand) {
  if (isNum(spec)) return spec;
  if (!spec || typeof spec !== "object") return 0;
  if (isNum(spec.mean) && isNum(spec.sd))
    return gauss(rand, spec.mean, spec.sd);
  if (isNum(spec.p10) && isNum(spec.p90)) {
    // P10/P90 нормального розподілу відстоять від середнього на 1.2816 σ.
    var mean = (spec.p10 + spec.p90) / 2;
    var sd = (spec.p90 - spec.p10) / (2 * 1.2815515655446004);
    return gauss(rand, mean, sd);
  }
  if (isNum(spec.lo) && isNum(spec.hi))
    return spec.lo + rand() * (spec.hi - spec.lo);
  return num(spec.value);
}

/**
 * Monte Carlo по невизначених полях опції.
 *
 * Навіщо. Точкова оцінка ховає головне: у ОВДП розкид майже нульовий, у
 * пригоні — величезний (ремонт може вилізти вдвічі, авто може стояти рік,
 * ціну можуть збити на 15 %). Дві опції з однаковою МЕДІАНОЮ — це різні
 * рішення, і `probBeatBaseline` каже, наскільки саме різні.
 *
 * `uncertain` — {поле: spec}; поля перекривають однойменні в опції.
 */
/**
 * Контекст однієї спроби. Девальвація — не деталь: базова ставка виведена з
 * гривневої ОВДП, тож курс рухає і саму опцію, і планку, з якою її
 * порівнюють, ОДНОЧАСНО. Тягнути їх незалежно означало б вигадати
 * кореляцію, якої немає.
 *
 * Курс на 29.08 за чотири роки: 0 %, +12.8 %, +0.02 %, +7.97 % — девальвація
 * приходить сходинками. Однорічна гривнева ОВДП це не «мінус 5 % щороку», а
 * ставка на те, чи випаде сходинка саме цього року, і точкова оцінка цього
 * не показує взагалі.
 */
function drawContext(ctx, rand) {
  if (!ctx.uncertain) return ctx;
  var trial = Object.assign({}, ctx);
  var keys = Object.keys(ctx.uncertain);
  for (var i = 0; i < keys.length; i += 1) {
    trial[keys[i]] = sample(ctx.uncertain[keys[i]], rand);
  }
  // Базова ставка виведена з гривневої — переводимо її наново під той курс,
  // що випав саме в цій спробі.
  if (isNum(ctx.baselineUahRatePct)) {
    trial.baselineRate = uahRateToUsd(
      ctx.baselineUahRatePct / 100,
      num(trial.devaluationPct) / 100,
    );
  }
  return trial;
}

function simulate(option, ctx, opts) {
  var o = opts || {};
  var trials = num(o.trials, 2000);
  var rand = rng(num(o.seed, 42));
  var uncertain = option.uncertain || {};
  var keys = Object.keys(uncertain);
  var ctxUncertain = ctx.uncertain ? Object.keys(ctx.uncertain) : [];
  if (!keys.length && !ctxUncertain.length) {
    var single = evaluate(option, ctx);
    return {
      id: option.id,
      trials: 0,
      p10: single.terminalWealth,
      p50: single.terminalWealth,
      p90: single.terminalWealth,
      probBeatBaseline: single.vsBaseline > 0 ? 1 : 0,
      probLoss: single.terminalWealth < ctx.capital ? 1 : 0,
      deterministic: true,
    };
  }

  var results = [];
  var beat = 0;
  var loss = 0;
  for (var i = 0; i < trials; i += 1) {
    // Порядок важливий: спершу контекст, потім опція — так один seed дає
    // відтворюваний прогін незалежно від того, скільки полів невизначені.
    var trialCtx = drawContext(ctx, rand);
    var trialBaseline =
      trialCtx.capital * grow(trialCtx.baselineRate, trialCtx.horizonDays);
    var draw = Object.assign({}, option);
    for (var k = 0; k < keys.length; k += 1) {
      draw[keys[k]] = sample(uncertain[keys[k]], rand);
    }
    var w;
    try {
      w = evaluate(draw, trialCtx).terminalWealth;
    } catch (e) {
      continue;
    }
    results.push(w);
    if (w > trialBaseline) beat += 1;
    if (w < ctx.capital) loss += 1;
  }
  if (!results.length) throw new Error("Симуляція не дала жодного результату");
  return {
    id: option.id,
    trials: results.length,
    p10: percentile(results, 0.1),
    p50: percentile(results, 0.5),
    p90: percentile(results, 0.9),
    mean:
      results.reduce(function (a, b) {
        return a + b;
      }, 0) / results.length,
    probBeatBaseline: beat / results.length,
    probLoss: loss / results.length,
    deterministic: false,
  };
}

// ── Зважена оцінка ──────────────────────────────────────────────────

/**
 * Критерії, за якими опції можна порівнювати. `money: true` означає, що
 * значення береться з розрахунку, а не з думки; решта — оцінки 1..5, які
 * ставить користувач в описі опції.
 */
const CRITERIA = [
  { id: "return", label: "Дохідність", money: true, higherIsBetter: true },
  {
    id: "certainty",
    label: "Передбачуваність",
    money: true,
    higherIsBetter: true,
  },
  { id: "liquidity", label: "Ліквідність", money: false, higherIsBetter: true },
  {
    id: "effortFree",
    label: "Не з'їдає час",
    money: true,
    higherIsBetter: true,
  },
  {
    id: "safety",
    label: "Захищеність капіталу",
    money: false,
    higherIsBetter: true,
  },
  {
    id: "reversibility",
    label: "Оборотність рішення",
    money: false,
    higherIsBetter: true,
  },
];

/** Мін-макс нормалізація в [0,1]. Коли всі рівні — усім 1, а не 0/0. */
function normalize(values, higherIsBetter) {
  var vals = values.filter(isNum);
  if (!vals.length)
    return values.map(function () {
      return 0.5;
    });
  var lo = Math.min.apply(null, vals);
  var hi = Math.max.apply(null, vals);
  if (hi - lo < 1e-12)
    return values.map(function () {
      return 1;
    });
  return values.map(function (v) {
    if (!isNum(v)) return 0;
    var t = (v - lo) / (hi - lo);
    return higherIsBetter ? t : 1 - t;
  });
}

/**
 * Зважена оцінка опцій.
 *
 * Свідоме обмеження: ваги накладаються ЛИШЕ поверх уже порахованих грошей.
 * «Дохідність» і «передбачуваність» беруться з симуляції, «не з'їдає час» —
 * з годин, переведених у гроші. Три решта — суб'єктивні, і вони помічені
 * як суб'єктивні. Класична помилка зваженої матриці в тому, що всі шість
 * критеріїв виглядають однаково об'єктивно; тут видно, які з них вимір, а
 * які — думка.
 */
function score(rows, weights, ctx) {
  var w = {};
  var total = 0;
  for (var i = 0; i < CRITERIA.length; i += 1) {
    var c = CRITERIA[i];
    var v = Math.max(0, num(weights && weights[c.id], 0));
    w[c.id] = v;
    total += v;
  }
  if (total <= 0) throw new Error("Сума ваг має бути більшою за нуль");

  var columns = {};
  columns.return = normalize(
    rows.map(function (r) {
      return r.sim.p50;
    }),
    true,
  );
  // Передбачуваність — це вузькість розкиду, тож нормалізуємо ШИРИНУ і
  // перевертаємо. Ширина в частках капіталу, щоб опції різного розміру
  // порівнювались чесно.
  columns.certainty = normalize(
    rows.map(function (r) {
      return (r.sim.p90 - r.sim.p10) / ctx.capital;
    }),
    false,
  );
  columns.effortFree = normalize(
    rows.map(function (r) {
      return r.eval.hours;
    }),
    false,
  );
  ["liquidity", "safety", "reversibility"].forEach(function (id) {
    columns[id] = normalize(
      rows.map(function (r) {
        return num(r.option[id], 3);
      }),
      true,
    );
  });

  return rows.map(function (r, idx) {
    var parts = {};
    var sum = 0;
    for (var j = 0; j < CRITERIA.length; j += 1) {
      var cid = CRITERIA[j].id;
      var contribution = (columns[cid][idx] * w[cid]) / total;
      parts[cid] = {
        normalized: columns[cid][idx],
        weight: w[cid] / total,
        contribution: contribution,
      };
      sum += contribution;
    }
    return { id: r.option.id, label: r.option.label, score: sum, parts: parts };
  });
}

// ── Чутливість ──────────────────────────────────────────────────────

/**
 * За якого значення поля опція зрівняється з суперником.
 *
 * Це найкорисніший вихід усього модуля. «Пригін дає 74 бали» ні до чого не
 * зобов'язує; «пригін програє ОВДП, щойно ремонт перевищить $9 400» — це те,
 * що можна піти й перевірити на фото лота. Бісекція по монотонному діапазону;
 * коли на кінцях знак однаковий, кореня в діапазоні немає — так і кажемо.
 */
function breakEven(option, ctx, field, range, rivalWealth) {
  var lo = range.lo;
  var hi = range.hi;
  var f = function (x) {
    var probe = Object.assign({}, option);
    probe[field] = x;
    return evaluate(probe, ctx).terminalWealth - rivalWealth;
  };
  var fLo = f(lo);
  var fHi = f(hi);
  if (!isNum(fLo) || !isNum(fHi)) return null;
  if (fLo * fHi > 0) return null;
  for (var i = 0; i < 120; i += 1) {
    var mid = (lo + hi) / 2;
    var fMid = f(mid);
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Наскільки результат чутливий до кожного поля.
 *
 * ДІАПАЗОН БЕРЕТЬСЯ З `option.uncertain`, а не з ±`deltaPct`, коли він там
 * є. Це не дрібниця, і ось чому. ±25 % від ремонту в $4 246 — це $2 100
 * туди-сюди, і в торнадо ремонт виглядає дрібним. Але ремонт у нас не
 * «відомий з точністю 25 %» — він **здогад цілком**: у наборі 0 з 10 рядків
 * із заповненим `ua_repair_cost`. Правдивий діапазон тут не «±25 %», а
 * «від нуля до вдвічі більшого», і в ньому ремонт вирішує долю угоди.
 *
 * Пропорційне збурення систематично занижує вплив полів, чиє САМЕ ІСНУВАННЯ
 * припущене, — і саме на цьому тут один раз ледь не побудувався хибний
 * висновок «вердикт не тримається на здогадах».
 *
 * `basis` у кожному рядку каже, що саме зроблено: `range` — заявлений
 * діапазон невизначеності, `relative` — просто ±deltaPct.
 */
function sensitivity(option, ctx, fields, deltaPct) {
  var d = num(deltaPct, 20) / 100;
  var base = evaluate(option, ctx).terminalWealth;
  var uncertain = option.uncertain || {};
  var out = [];
  for (var i = 0; i < fields.length; i += 1) {
    var field = fields[i];
    var v0 = num(option[field]);
    var spec = uncertain[field];
    var loV;
    var hiV;
    var basis;
    if (spec && (isNum(spec.p10) || isNum(spec.lo))) {
      loV = isNum(spec.p10) ? spec.p10 : spec.lo;
      hiV = isNum(spec.p90) ? spec.p90 : spec.hi;
      basis = "range";
    } else {
      if (!v0) continue;
      loV = v0 * (1 - d);
      hiV = v0 * (1 + d);
      basis = "relative";
    }
    var down = Object.assign({}, option);
    down[field] = loV;
    var up = Object.assign({}, option);
    up[field] = hiV;
    var wDown = evaluate(down, ctx).terminalWealth;
    var wUp = evaluate(up, ctx).terminalWealth;
    out.push({
      field: field,
      base: v0,
      basis: basis,
      low: { value: loV, wealth: wDown, delta: wDown - base },
      high: { value: hiV, wealth: wUp, delta: wUp - base },
      swing: Math.abs(wUp - wDown),
    });
  }
  out.sort(function (a, b) {
    return b.swing - a.swing;
  });
  return { base: base, deltaPct: num(deltaPct, 20), rows: out };
}

/**
 * Поріг відсіву для пригону: за якої ціни продажу угода лише ЗРІВНЮЄТЬСЯ з
 * тим, щоб покласти ті самі гроші в ОВДП і нічого не робити.
 *
 * Це місце, де цей модуль стикується з рештою калькулятора. `optimalBid()` в
 * market.methods.js уже вирішує рівняння «витрати ≤ ринок × (1 −
 * targetDiscountPct)». Тут рахується, яким має бути `targetDiscountPct`, щоб
 * угода не програвала облігаціям. Тобто вихід цієї функції — не абстрактний
 * бал, а число, яке вводиться в наявне поле на сторінці.
 *
 * Повертає `null`, коли беззбитковості немає в розумному діапазоні: буває,
 * що жодна ціна продажу не рятує (наприклад, коли ремонт з'їдає все).
 */
function screeningThreshold(flipOption, ctx, baselineWealth) {
  var landed = num(flipOption.landed);
  if (!(landed > 0)) return null;
  var price = breakEven(
    flipOption,
    ctx,
    "exitPrice",
    { lo: landed * 0.5, hi: landed * 5 },
    baselineWealth,
  );
  if (price === null) return null;
  var multiple = price / landed;
  return {
    exitPrice: price,
    exitMultiple: multiple,
    // Та сама величина у формі, яку розуміє поле «цільова знижка» на сторінці.
    discountPct: (1 - 1 / multiple) * 100,
  };
}

// ── Повний прогін ───────────────────────────────────────────────────

/**
 * Порівняти набір опцій: гроші, невизначеність, ваги, чутливість.
 * Ранжування — за зваженою оцінкою, але поруч завжди лежить чисто грошовий
 * порядок (`byWealth`), щоб було видно, коли саме ваги перевернули висновок.
 */
function compare(options, ctx, opts) {
  var o = opts || {};
  var rows = options.map(function (option) {
    return {
      option: option,
      eval: evaluate(option, ctx),
      sim: simulate(option, ctx, { trials: o.trials, seed: o.seed }),
    };
  });
  var scored = score(rows, o.weights || ctx.weights, ctx);
  var byId = {};
  scored.forEach(function (s) {
    byId[s.id] = s;
  });

  var merged = rows.map(function (r) {
    return Object.assign({}, r.eval, {
      sim: r.sim,
      score: byId[r.option.id] ? byId[r.option.id].score : 0,
      scoreParts: byId[r.option.id] ? byId[r.option.id].parts : {},
      option: r.option,
    });
  });

  var ranked = merged.slice().sort(function (a, b) {
    return b.score - a.score;
  });
  var byWealth = merged.slice().sort(function (a, b) {
    return b.sim.p50 - a.sim.p50;
  });

  return {
    ctx: ctx,
    options: merged,
    ranked: ranked,
    byWealth: byWealth,
    winner: ranked[0] || null,
    // Ваги перевернули грошовий порядок — це не помилка, але це треба
    // сказати вголос: рішення прийняте не арифметикою, а перевагами.
    weightsFlippedOrder: !!(
      ranked[0] &&
      byWealth[0] &&
      ranked[0].id !== byWealth[0].id
    ),
    baseline: ctx.capital * grow(ctx.baselineRate, ctx.horizonDays),
  };
}

module.exports = {
  DAYS_PER_YEAR: DAYS_PER_YEAR,
  CRITERIA: CRITERIA,
  grow: grow,
  peakOutflow: peakOutflow,
  scaleFlows: scaleFlows,
  median: median,
  percentile: percentile,
  uahRateToUsd: uahRateToUsd,
  afterTax: afterTax,
  npv: npv,
  irr: irr,
  terminalWealth: terminalWealth,
  rollCycles: rollCycles,
  optionFlows: optionFlows,
  evaluate: evaluate,
  rng: rng,
  sample: sample,
  drawContext: drawContext,
  simulate: simulate,
  normalize: normalize,
  score: score,
  breakEven: breakEven,
  sensitivity: sensitivity,
  screeningThreshold: screeningThreshold,
  compare: compare,
};
