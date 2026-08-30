"use strict";
/**
 * Параметри пригону — з таблиці `resales`, а не з голови.
 *
 * Це та причина, заради якої порівняння взагалі варте довіри. Ставки ОВДП,
 * депозиту й оренди ми ЦИТУЄМО з чужих публікацій (див. docs/decision-baseline.md),
 * а параметри пригону — ВИМІРЮЄМО на власних спостереженнях: 10 рядків, де
 * відомі і молоток, і наш landed, і ціна того ж VIN в Україні.
 *
 * Кожне число повертається разом із тим, звідки воно:
 *   measured — порахували на своїх рядках, `n` каже на скількох;
 *   assumed  — припущення, бо виміряти нема на чому. Таких тут два, і обидва
 *              зміщують результат УГОРУ, тобто без них пригін виглядає
 *              кращим, ніж є.
 *
 * ДВА ЗМІЩЕННЯ, ЯКІ ТРЕБА ЗНАТИ (обидва вже враховані нижче):
 *
 * 1. `ria_price_usd` — ЗАПИТАНА ціна, не ціна продажу. На зрізі 2026-08-29
 *    8 із 10 оголошень досі активні: за ці гроші ще ніхто не дав. Наскільки
 *    торгуються — ми не бачили ЖОДНОГО разу, тож `priceHaircutPct` це
 *    відкрите припущення, а не вимір.
 * 2. «Днів до ринку» = від молотка до появи оголошення. Це НЕ строк, на
 *    який стоять гроші: капітал вивільняється, коли авто ПРОДАНО, а не коли
 *    виставлено. Скільки воно потім висить — міряється лише на знятих
 *    оголошеннях, а їх поки два.
 *
 * Порахувати «річну дохідність пригону» без цих двох поправок дуже легко —
 * і виходить ~44 % річних медіанних. Число красиве й неправдиве.
 */

const { median, percentile } = require("./decision.js");

const MS_PER_DAY = 86400000;

function daysBetween(a, b) {
  if (!a || !b) return null;
  var t0 = Date.parse(a);
  var t1 = Date.parse(b);
  if (!isFinite(t0) || !isFinite(t1)) return null;
  var d = (t1 - t0) / MS_PER_DAY;
  return d > 0 ? d : null;
}

function stat(values, label, source) {
  var vals = values.filter(function (v) {
    return typeof v === "number" && isFinite(v);
  });
  if (!vals.length)
    return { basis: "none", n: 0, label: label, source: source };
  return {
    basis: "measured",
    n: vals.length,
    label: label,
    source: source,
    median: median(vals),
    p10: percentile(vals, 0.1),
    p90: percentile(vals, 0.9),
    min: Math.min.apply(null, vals),
    max: Math.max.apply(null, vals),
  };
}

/**
 * Рядки, придатні для виміру: є і наш landed, і ціна в Україні, і дата
 * молотка. Європейські Macan (`WP1ZZZ95Z…`), яких у США не продавали, і
 * рядки з `history_source = 'none'` сюди не потрапляють — у них немає
 * аукціонного боку взагалі.
 */
function usableRows(db) {
  return db
    .prepare(
      "SELECT vin, make, model, year, sold_price, sale_date, landed_cost," +
        " ria_price_usd, ria_add_date, ria_sold_date, ria_active," +
        " ua_repair_cost, ua_repair_source, overhead_cost, location_weak" +
        " FROM resales" +
        " WHERE landed_cost IS NOT NULL AND ria_price_usd IS NOT NULL" +
        "   AND sale_date IS NOT NULL AND ria_add_date IS NOT NULL",
    )
    .all();
}

/**
 * Скільки днів оголошення провисіло до зняття. Дві незалежні ознаки продажу:
 * проставлений `ria_sold_date` і перехід `ria_active` у 0 у зрізах
 * `resale_price_history`. Друга слабша (оголошення знімають і без продажу),
 * тож вона рахується окремо і в медіану не йде.
 */
function marketDays(db) {
  var sold = db
    .prepare(
      "SELECT ria_add_date, ria_sold_date FROM resales" +
        " WHERE ria_sold_date IS NOT NULL AND ria_add_date IS NOT NULL",
    )
    .all()
    .map(function (r) {
      return daysBetween(r.ria_add_date, r.ria_sold_date);
    })
    .filter(function (d) {
      return d !== null;
    });

  var withdrawn = 0;
  try {
    withdrawn = db
      .prepare(
        "SELECT COUNT(*) n FROM resales WHERE ria_active = 0 AND ria_sold_date IS NULL",
      )
      .get().n;
  } catch (e) {
    withdrawn = 0;
  }
  return { sold: sold, withdrawnWithoutSale: withdrawn };
}

/**
 * Зведення по всіх спостереженнях. Нічого не пише, лише читає — цим самим
 * з'єднанням користуються і сервер, і CLI.
 */
function summarize(db) {
  var rows = usableRows(db);
  var exitMultiples = [];
  var listingDays = [];
  var grossRoi = [];
  var landed = [];
  var perRow = [];

  rows.forEach(function (r) {
    var mult = r.ria_price_usd / r.landed_cost;
    var days = daysBetween(r.sale_date, r.ria_add_date);
    exitMultiples.push(mult);
    landed.push(r.landed_cost);
    grossRoi.push((r.ria_price_usd - r.landed_cost) / r.landed_cost);
    if (days !== null) listingDays.push(days);
    perRow.push({
      vin: r.vin,
      car: [r.year, r.make, r.model].filter(Boolean).join(" "),
      soldPrice: r.sold_price,
      landed: r.landed_cost,
      askingUa: r.ria_price_usd,
      exitMultiple: mult,
      daysToListing: days,
      stillListed: r.ria_active === 1,
      uaRepairKnown: r.ua_repair_source && r.ua_repair_source !== "none",
      locationWeak: r.location_weak === 1,
    });
  });

  var market = marketDays(db);

  // Скільки рядків має український ремонт. Поки жоден — «чиста» наварка в
  // наборі дорівнює валовій, і це треба сказати, а не тихо порівнювати
  // валову з чистою дохідністю ОВДП.
  var withRepair = perRow.filter(function (r) {
    return r.uaRepairKnown;
  }).length;

  return {
    asof: new Date().toISOString().slice(0, 10),
    n: rows.length,
    rows: perRow,
    exitMultiple: stat(exitMultiples, "ціна в Україні ÷ landed", "resales"),
    daysToListing: stat(
      listingDays,
      "днів від молотка до оголошення",
      "resales",
    ),
    grossRoi: stat(grossRoi, "валова дохідність за угоду", "resales"),
    landed: stat(landed, "landed, $", "resales"),
    daysOnMarket: Object.assign(
      stat(market.sold, "днів у продажу до зняття", "resales.ria_sold_date"),
      { withdrawnWithoutSale: market.withdrawnWithoutSale },
    ),
    uaRepairCoverage: {
      basis: withRepair ? "measured" : "none",
      n: withRepair,
      of: rows.length,
      note:
        withRepair === 0
          ? "Український ремонт не введений у жодному рядку: у наборі є лише ВАЛОВА наварка. " +
            "Порівнювати її з чистою дохідністю ОВДП не можна — тому ремонт нижче задається " +
            "припущенням і винесений у чутливість."
          : "",
    },
  };
}

/**
 * Зведення → готова опція «пригін» для lib/decision.js.
 *
 * `overrides` дозволяє підставити свій лот (ставку, ремонт із фото, ринкову
 * ціну) замість медіани набору — саме так це має працювати з калькулятора:
 * набір дає розкид, конкретний лот дає центр.
 */
function flipOption(summary, overrides) {
  var o = overrides || {};
  var landed = o.landed || summary.landed.median || 35000;
  var mult = o.exitMultiple || summary.exitMultiple.median || 1.33;
  var listing = o.daysToListing || summary.daysToListing.median || 300;

  // Скільки авто висить у продажу. Виміряно на двох знятих оголошеннях —
  // цього мало для медіани, тож при n < 3 береться явне припущення, а поле
  // `daysOnMarketBasis` каже, що саме сталося.
  var onMarketMeasured = summary.daysOnMarket.n >= 3;
  var onMarket = o.daysOnMarket;
  if (onMarket === undefined) {
    onMarket = onMarketMeasured ? summary.daysOnMarket.median : 60;
  }

  var exitPrice = o.exitPrice || landed * mult;

  return {
    id: "flip",
    label: "Пригін авто з США під перепродаж",
    kind: "flip",
    currency: "USD",
    repeat: true,
    landed: landed,
    exitPrice: exitPrice,
    exitMultiple: mult,
    daysToListing: listing,
    daysOnMarket: onMarket,
    repairDays: o.repairDays === undefined ? 45 : o.repairDays,
    uaRepairCost:
      o.uaRepairCost === undefined ? Math.round(landed * 0.12) : o.uaRepairCost,
    overheadCost: o.overheadCost === undefined ? 600 : o.overheadCost,
    priceHaircutPct: o.priceHaircutPct === undefined ? 7 : o.priceHaircutPct,
    sellCostPct: o.sellCostPct === undefined ? 1.5 : o.sellCostPct,
    taxPct: o.taxPct === undefined ? 0 : o.taxPct,
    hours: o.hours === undefined ? 60 : o.hours,
    // Суб'єктивні критерії — 1..5. Пригін неліквідний (гроші в залізі),
    // капітал незахищений (авто може не продатись), рішення необоротне
    // (ставку на аукціоні не відкликати).
    liquidity: 1,
    safety: 2,
    reversibility: 1,
    uncertain: {
      // Розкид беремо з наших же спостережень, а не з уяви.
      exitPrice: {
        p10: landed * (summary.exitMultiple.p10 || 1.15),
        p90: landed * (summary.exitMultiple.p90 || 1.7),
      },
      daysToListing: {
        p10: summary.daysToListing.p10 || 120,
        p90: summary.daysToListing.p90 || 700,
      },
      uaRepairCost: {
        p10:
          (o.uaRepairCost === undefined ? landed * 0.12 : o.uaRepairCost) * 0.5,
        p90:
          (o.uaRepairCost === undefined ? landed * 0.12 : o.uaRepairCost) * 2,
      },
    },
    provenance: {
      landed: summary.landed,
      exitMultiple: summary.exitMultiple,
      daysToListing: summary.daysToListing,
      daysOnMarket: onMarketMeasured
        ? summary.daysOnMarket
        : {
            basis: "assumed",
            n: summary.daysOnMarket.n,
            value: onMarket,
            note:
              "Знятих оголошень лише " +
              summary.daysOnMarket.n +
              " — для медіани мало. Взято 60 днів як припущення; поле в чутливості.",
          },
      priceHaircutPct: {
        basis: "assumed",
        note:
          "Наскільки торгуються від запитаної ціни — не виміряно ЖОДНОГО разу: " +
          "реальної ціни продажу в Україні ми не бачимо. Без цієї поправки " +
          "дохідність пригону завищена.",
      },
      uaRepairCost: {
        basis: summary.uaRepairCoverage.basis,
        note: summary.uaRepairCoverage.note,
      },
    },
  };
}

module.exports = {
  daysBetween: daysBetween,
  usableRows: usableRows,
  marketDays: marketDays,
  summarize: summarize,
  flipOption: flipOption,
};
