"use strict";
/**
 * Каталог опцій вкладення й дефолтний контекст.
 *
 * ПРАВИЛО ЦЬОГО ФАЙЛУ те саме, що для docs/*-baseline.md: жодного числа без
 * дати й джерела. Кожна ставка нижче має `asof` і `source`; при
 * перевимірюванні — НОВИЙ рядок у docs/decision-baseline.md, а не перезапис
 * старого. Провенанс лежить поруч зі ставкою, а не в коментарі за 200 рядків
 * звідси — саме тому `feeNote` свого часу переїхав до `auctions[]`.
 *
 * Числа, які цитуються (не наші виміри), позначені `basis: "quoted"`. Наші
 * власні виміри — `basis: "measured"`. Здогади — `basis: "assumed"`, і їх
 * тут рівно стільки, скільки не вдалося виміряти.
 */

const ASOF = "2026-08-29";

/**
 * Девальвація гривні — ВИМІРЯНА за НБУ, не вгадана.
 *
 * Курс USD/UAH на 29 серпня кожного року (bank.gov.ua, statdirectory):
 *   2022  36.5686
 *   2023  36.5686   +0.00 %
 *   2024  41.2508  +12.80 %
 *   2025  41.2602   +0.02 %
 *   2026  44.5505   +7.97 %   (31.08.2026)
 *
 * CAGR за чотири роки = (44.5505 / 36.5686)^(1/4) − 1 = 5.06 % річних.
 *
 * Важливіше за середнє — ФОРМА: девальвація приходить сходинками, а не
 * рівномірно. Два роки з чотирьох курс не рухався взагалі, два — стрибав на
 * 8–13 %. Тож однорічна гривнева ОВДП це не «мінус 5 %», а ставка на те, чи
 * випаде сходинка саме цього року. Через це девальвація задана діапазоном
 * 0…12.8 % (спостережений розкид), а не точкою.
 */
const DEVALUATION = {
  value: 5.06,
  basis: "measured",
  asof: ASOF,
  source: "bank.gov.ua NBUStatService, курс USD на 29.08 за 2022–2026",
  observed: [
    { period: "2022→2023", pct: 0.0 },
    { period: "2023→2024", pct: 12.8 },
    { period: "2024→2025", pct: 0.02 },
    { period: "2025→2026", pct: 7.97 },
  ],
  spread: { lo: 0, hi: 12.8 },
};

/** Податок на пасивний дохід фізособи: ПДФО 18 % + військовий збір 5 %. */
const PERSONAL_INCOME_TAX = {
  value: 23,
  basis: "quoted",
  asof: ASOF,
  source:
    "ПДФО 18 % + військовий збір 5 % (ставка ВЗ для фізосіб піднята з 1.5 % до 5 % з 01.12.2024)",
};

/**
 * Ставки. `rate` — номінал у валюті опції; податок і комісія знімаються
 * окремо в lib/decision.js, а не «вже враховані» тут: інакше не видно, з
 * чого склалась чиста.
 */
const RATES = {
  ovdpUah: {
    value: 16.47,
    basis: "quoted",
    asof: "2026-08-25",
    source:
      "Аукціон Мінфіну 25.08.2026: 3-річні 16.47 %, 2-річні 15.63 %, 1-річні 15.17 %",
    alternatives: { "1y": 15.17, "2y": 15.63, "3y": 16.47 },
  },
  ovdpUsd: {
    value: 3.3,
    basis: "quoted",
    asof: "2026-03-31",
    source:
      "Валютні ОВДП: середньозважена 3.14 % (лютий 2026), максимум 3.47 % (березень 2026). " +
      "Свіжішого зрізу на 2026-08-29 знайти не вдалось — число СТАРІШЕ за решту.",
    stale: true,
  },
  depositUah: {
    value: 14.5,
    basis: "quoted",
    asof: ASOF,
    source:
      "minfin.com.ua/deposits: типові 13–14.5 % річних, максимальні пропозиції до 17.2 %",
  },
  depositUsd: {
    value: 1.5,
    basis: "assumed",
    asof: ASOF,
    source:
      "Точної цифри за доларовими вкладами не знайдено; джерела кажуть лише «значно нижче гривневих». " +
      "Це ПРИПУЩЕННЯ — перевір перед тим, як спиратись.",
  },
  rentalGrossYield: {
    value: 6,
    basis: "quoted",
    asof: ASOF,
    source:
      "Оцінки девелоперів на 2026: 5–7 % річних у гривні, 4–5 % у доларі; окупність 12–17 років",
  },
  apartmentPrice: {
    value: 100000,
    basis: "quoted",
    asof: ASOF,
    source: "Середня квартира з ремонтом у новобудові — близько $100 тис.",
  },
};

/**
 * Контекст порівняння. `baselineRate` — це «нічого не робити з розумом»:
 * гривнева ОВДП після переведення в долар. Саме з нею порівнюється все
 * інше, і саме під неї доростають гроші, повернені раніше горизонту.
 */
function defaultContext(overrides) {
  const o = overrides || {};
  const decision = require("./decision.js");
  const devaluation =
    o.devaluationPct === undefined ? DEVALUATION.value : o.devaluationPct;
  const baseline =
    o.baselineRate === undefined
      ? decision.uahRateToUsd(RATES.ovdpUah.value / 100, devaluation / 100)
      : o.baselineRate;

  return {
    capital: o.capital === undefined ? 35000 : o.capital,
    currency: "USD",
    horizonDays: o.horizonDays === undefined ? 1095 : o.horizonDays, // 3 роки
    devaluationPct: devaluation,
    baselineRate: baseline,
    // Скільки коштує година власного часу. Не «зусилля» в балах, а гроші:
    // 60 годин навколо пригону при $40/год — це $2 400, тобто третина
    // медіанної валової наварки в нашому наборі.
    hourlyRate: o.hourlyRate === undefined ? 40 : o.hourlyRate,
    weights: o.weights || defaultWeights(),
    asof: ASOF,
    // Звідки виведена базова ставка — щоб симуляція могла перерахувати її
    // під той курс, що випав у спробі, а не тягнути зафіксовану.
    baselineUahRatePct: RATES.ovdpUah.value,
    // Девальвація йде сходинками (0 %, 12.8 %, 0.02 %, 7.97 % за чотири
    // роки), тож у симуляції вона діапазон, а не точка. Це єдина
    // невизначеність РІВНЯ КОНТЕКСТУ: вона рухає і гривневі опції, і планку,
    // з якою їх порівнюють, одночасно.
    uncertain: o.uncertain || {
      devaluationPct: { lo: DEVALUATION.spread.lo, hi: DEVALUATION.spread.hi },
    },
  };
}

/**
 * Дефолтні ваги. Дохідність важить найбільше, але не все: опція, яка дає
 * +2 % і при цьому забирає рік життя й не дає вийти достроково, — не
 * автоматичний переможець.
 */
function defaultWeights() {
  return {
    return: 35,
    certainty: 20,
    liquidity: 10,
    effortFree: 15,
    safety: 15,
    reversibility: 5,
  };
}

/** Опції, які не залежать від таблиці `resales`. */
function baseOptions(ctx) {
  const c = ctx || defaultContext();
  return [
    {
      id: "ovdp-uah",
      label: "ОВДП у гривні (3 роки)",
      kind: "yield",
      currency: "UAH",
      repeat: true,
      capital: c.capital,
      ratePct: RATES.ovdpUah.value,
      termDays: 1095,
      taxPct: 0, // пряма пільга ПКУ — не округлення
      feePct: 0.3,
      hours: 4,
      liquidity: 3, // вторинний ринок є, але тонкий
      safety: 4, // держава платила навіть у 2022
      reversibility: 4,
      uncertain: {
        // Не ставка гуляє, а курс. Діапазон — спостережений, 0…12.8 %.
        ratePct: { lo: RATES.ovdpUah.value, hi: RATES.ovdpUah.value },
      },
      provenance: { ratePct: RATES.ovdpUah, tax: "0 % — пряма пільга ПКУ" },
    },
    {
      id: "ovdp-usd",
      label: "Валютні ОВДП (долар)",
      kind: "yield",
      currency: "USD",
      repeat: true,
      capital: c.capital,
      ratePct: RATES.ovdpUsd.value,
      termDays: 730,
      taxPct: 0,
      feePct: 0.5,
      hours: 4,
      liquidity: 3,
      safety: 4,
      reversibility: 4,
      provenance: { ratePct: RATES.ovdpUsd },
    },
    {
      id: "deposit-uah",
      label: "Депозит у гривні",
      kind: "yield",
      currency: "UAH",
      repeat: true,
      capital: c.capital,
      ratePct: RATES.depositUah.value,
      termDays: 365,
      taxPct: PERSONAL_INCOME_TAX.value,
      feePct: 0,
      hours: 2,
      liquidity: 4,
      safety: 4,
      reversibility: 4,
      provenance: { ratePct: RATES.depositUah, tax: PERSONAL_INCOME_TAX },
    },
    {
      id: "apartment",
      label: "Квартира під оренду",
      kind: "rental",
      currency: "USD",
      repeat: false,
      // Квартиру не можна купити частково: якщо капіталу менше за ціну,
      // опція недоступна, а не «доступна в меншому масштабі».
      lumpy: true,
      price: RATES.apartmentPrice.value,
      acquisitionCostPct: 3,
      grossYieldPct: RATES.rentalGrossYield.value,
      vacancyPct: 10,
      maintenancePct: 1,
      taxPct: 6, // ФОП 3 група: 5 % єдиного + 1 % ВЗ
      appreciationPct: 3,
      sellCostPct: 4,
      hoursPerYear: 30,
      liquidity: 1, // продати квартиру — місяці
      safety: 3, // війна: об'єкт нерухомий і застрахувати його важко
      reversibility: 1,
      uncertain: {
        grossYieldPct: { lo: 4, hi: 7 },
        appreciationPct: { lo: -2, hi: 6 },
        vacancyPct: { lo: 5, hi: 25 },
      },
      provenance: {
        grossYieldPct: RATES.rentalGrossYield,
        price: RATES.apartmentPrice,
        taxPct: {
          basis: "quoted",
          asof: ASOF,
          source: "ФОП 3 група: 5 % єдиного податку + 1 % військового збору",
        },
      },
    },
  ];
}

/**
 * «Лагодити своє авто замість купувати інше» — уникнута витрата, не
 * інвестиція. Потік будується як РІЗНИЦЯ між двома сценаріями, тож числа
 * тут парні: скільки коштує ремонт проти скільки коштує заміна.
 * Дефолти — свідомо порожні заготовки: це єдина опція, де жодне число не
 * можна взяти ні з ринку, ні з нашої бази, бо воно про конкретне авто.
 */
function keepCarOption(overrides) {
  const o = overrides || {};
  return {
    id: "keep-car",
    label: "Полагодити своє авто, а не міняти",
    kind: "avoided-cost",
    currency: "USD",
    repeat: false,
    repairCost: o.repairCost === undefined ? 3000 : o.repairCost,
    replacementCost:
      o.replacementCost === undefined ? 25000 : o.replacementCost,
    currentCarSaleValue:
      o.currentCarSaleValue === undefined ? 9000 : o.currentCarSaleValue,
    keepMaintenancePerYear:
      o.keepMaintenancePerYear === undefined ? 1800 : o.keepMaintenancePerYear,
    replaceMaintenancePerYear:
      o.replaceMaintenancePerYear === undefined
        ? 700
        : o.replaceMaintenancePerYear,
    keepResidual: o.keepResidual === undefined ? 5000 : o.keepResidual,
    replaceResidual:
      o.replaceResidual === undefined ? 17000 : o.replaceResidual,
    hours: o.hours === undefined ? 20 : o.hours,
    liquidity: 3,
    safety: 4,
    reversibility: 3,
    uncertain: {
      repairCost: {
        p10: (o.repairCost === undefined ? 3000 : o.repairCost) * 0.7,
        p90: (o.repairCost === undefined ? 3000 : o.repairCost) * 2,
      },
      keepMaintenancePerYear: {
        p10:
          (o.keepMaintenancePerYear === undefined
            ? 1800
            : o.keepMaintenancePerYear) * 0.6,
        p90:
          (o.keepMaintenancePerYear === undefined
            ? 1800
            : o.keepMaintenancePerYear) * 2.2,
      },
    },
    provenance: {
      all: {
        basis: "assumed",
        note:
          "Усі числа цієї опції — про конкретне авто, і взяти їх ні з ринку, ні з нашої бази " +
          "не можна. Дефолти тут — заглушки, а не вимір: підстав свої.",
      },
    },
  };
}

module.exports = {
  ASOF: ASOF,
  DEVALUATION: DEVALUATION,
  PERSONAL_INCOME_TAX: PERSONAL_INCOME_TAX,
  RATES: RATES,
  defaultContext: defaultContext,
  defaultWeights: defaultWeights,
  baseOptions: baseOptions,
  keepCarOption: keepCarOption,
};
