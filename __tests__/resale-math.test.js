/**
 * Арифметика наварки і переклад аукціонної історії у форму, яку розуміє
 * калькулятор.
 *
 * Числа взяті з реального наскрізного прогону 2026-08-24: Audi S5 Sportback
 * WAUC4CF56RA030212 — куплений з молотка за $20 000 (Copart, VAN NUYS CA,
 * 15.07.2025), продається в Луцьку за $43 300. Кошторис ремонту аукціону —
 * $32 804: якби він потрапив у формулу, як це вже одного разу сталося з
 * вердиктом калькулятора, авто виглядало б безнадійним збитком.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createVm } = require("./helpers/load-calculator");
const resale = require("../lib/resale.js");
const landed = require("../lib/landed.js");
const vh = require("../lib/vin-history.js");

const VIN = "WAUC4CF56RA030212";
const HISTORY = vh.parseDetail(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "saleshistory-detail-" + VIN + ".html"),
    "utf8",
  ),
  VIN,
);
const ADVERT = {
  autoId: 40023169,
  url: "https://auto.ria.com/auto_audi_s5_sportback_40023169.html",
  vin: VIN,
  priceUsd: 43300,
  year: 2023,
  mileageKm: 38000,
  city: "Луцьк",
  addDate: "2026-08-14 02:01:51",
  active: 1,
};

describe("buildResaleRow", () => {
  const row = resale.buildResaleRow({
    advert: ADVERT,
    history: HISTORY,
    landed: { landedCost: 37018, usdUah: 44.7, eurUsd: 1.1 },
  });

  it("зводить обидва боки в один рядок", () => {
    expect(row.vin).toBe(VIN);
    expect(row.sold_price).toBe(20000);
    expect(row.ria_price_usd).toBe(43300);
    expect(row.landed_cost).toBe(37018);
    expect(row.history_source).toBe("saleshistory");
  });

  it("валова = ціна в Україні − landed", () => {
    expect(row.gross_profit).toBe(43300 - 37018);
  });

  it("без українського ремонту чиста дорівнює валовій і позначена як 'none'", () => {
    // Саме тому такі рядки не входять у зведені медіани на resales.html:
    // «чиста» тут насправді валова.
    expect(row.ua_repair_source).toBe("none");
    expect(row.net_profit).toBe(row.gross_profit);
  });

  it("кошторис ремонту США зберігається, але у формулу не входить", () => {
    expect(row.us_repair_cost).toBe(32804);
    // Якби він віднімався, чиста була б від'ємною на ~$26 500 — рівно та
    // помилка, яку вже виправляли у вердикті калькулятора.
    expect(row.net_profit).toBe(6282);
  });

  it("рахує дні від продажу на аукціоні до появи оголошення", () => {
    expect(row.days_to_market).toBe(
      resale.daysBetween("2025-07-15", "2026-08-14"),
    );
    expect(row.days_to_market).toBe(395);
  });

  it("датує ставки, за якими рахувався landed", () => {
    expect(row.rates_asof).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("«аукціону не знайдено» зберігається явно, а не як мовчазний NULL", () => {
    const empty = resale.buildResaleRow({
      advert: ADVERT,
      history: { found: false, vin: VIN },
      landed: null,
    });
    expect(empty.history_source).toBe("none");
    expect(empty.ria_price_usd).toBe(43300);
    expect(empty.gross_profit).toBeNull();
  });
});

describe("deriveResale / mergeResale", () => {
  const base = resale.buildResaleRow({
    advert: ADVERT,
    history: HISTORY,
    landed: { landedCost: 37018 },
  });

  it("віднімає ремонт і накладні з валової", () => {
    const withRepair = resale.mergeResale(base, {
      ua_repair_cost: 9000,
      overhead_cost: 500,
      ua_repair_source: "manual",
    });
    expect(withRepair.net_profit).toBe(6282 - 9000 - 500);
    expect(withRepair.margin_pct).toBeCloseTo(-3218 / (37018 + 9000 + 500), 6);
  });

  it("порожній патч не затирає вже збережене", () => {
    const merged = resale.mergeResale(base, { ria_city: null, sold_price: "" });
    expect(merged.sold_price).toBe(20000);
    expect(merged.ria_city).toBe("Луцьк");
  });

  it("нуль у ремонті — це осмислене «ремонту не було», а не порожньо", () => {
    const withRepair = resale.mergeResale(base, { ua_repair_cost: 5000 });
    const zeroed = resale.mergeResale(withRepair, { ua_repair_cost: 0 });
    expect(zeroed.ua_repair_cost).toBe(0);
    expect(zeroed.net_profit).toBe(zeroed.gross_profit);
  });

  it("перераховує похідні після зміни ціни оголошення", () => {
    const cheaper = resale.mergeResale(base, { ria_price_usd: 39900 });
    expect(cheaper.gross_profit).toBe(39900 - 37018);
  });
});

describe("toLotJson — переклад у форму IAAI", () => {
  const nd = landed.toLotJson(HISTORY);
  const attrs = nd.inventoryView.attributes;

  it("знімає дубль слів і префікс штату з назви філії", () => {
    expect(landed.branchName("CA - VAN NUYS VAN NUYS (91405 1509)", "CA")).toBe(
      "VAN NUYS",
    );
  });

  it("віддає об'єм у форматі, який чекає applyLotJson", () => {
    expect(attrs.DisplLiters).toBe("3.0L");
    expect(attrs.ODOValue).toBe("19186");
    expect(attrs.ODOUoM).toBe("mi");
  });

  it("проходить справжнім applyLotJson і заповнює форму", () => {
    // Головна гарантія: мапінг року/палива/об'єму/локації робить той самий
    // код, що й у браузері, а не друга копія в lib/landed.js.
    const vm = createVm({ autoPricing: { auctions: { selected: "copart" } } });
    vm.maybeLookupUkrainianPrice = () => {};
    vm.logLot = () => null;
    vm.applyLotJson(nd, "", { save: false });

    expect(vm.customs.manufactureYear).toBe(2024);
    expect(vm.customs.engineType).toBe("petrol");
    expect(vm.customs.engineVolume).toBe("3.0");
    expect(vm.acv).toBe(49620);
    expect(vm.repairCost).toBe(32804);
    expect(vm.lotCondition.damage).toBe("FRONT END");
    expect(vm.getCurrentLocation().name).toMatch(/VAN NUYS/i);
  });

  it("landed для реальної ставки збігається зі зрізом 2026-08-24", () => {
    const vm = createVm({ autoPricing: { auctions: { selected: "copart" } } });
    vm.maybeLookupUkrainianPrice = () => {};
    vm.logLot = () => null;
    vm.applyLotJson(nd, "", { save: false });
    vm.onLocationChange();
    // Число зміниться, щойно переміряють фрахт чи митні ставки — і тоді разом
    // із ним має оновитись колонка в docs/resale-markup-baseline.md.
    expect(vm.totalForPrice(20000)).toBe(37018);
  });
});

describe("локація без коду штату", () => {
  // Реальний випадок: IAAI-лот 43951224 (2025 Audi S5) має Location
  // «Dream Rides Westchester» — без коду штату й без індексу. Без штату
  // matchAuctionLocation не матчить нічого, і applyLotJson лишає локацію
  // дефолтною (перша в довіднику, Алабама) — тобто наземне плече до порту
  // мовчки рахується від чужого штату, а сума виглядає так само впевнено,
  // як зматчена.
  const BARE = {
    auction: "iaai",
    lotNumber: "43951224",
    soldPrice: 22700,
    saleDate: "2026-02-16",
    location: "Dream Rides Westchester",
    locationState: null,
    year: 2025,
    make: "AUDI",
    model: "S5 SPORTBACK",
    engine: "3.0L 6",
    fuel: "GAS",
    odometer: 4362,
    acv: 54732,
  };

  it("не вигадує штат із назви філії", () => {
    const attrs = landed.toLotJson(BARE).inventoryView.attributes;
    expect(attrs.State).toBe(" ");
    expect(attrs.BranchName).toBe("Dream Rides Westchester");
  });

  it("без штату справжній matchAuctionLocation нічого не знаходить", () => {
    const vm = createVm({ autoPricing: { auctions: { selected: "iaai" } } });
    expect(vm.matchAuctionLocation(landed.toLotJson(BARE).inventoryView.attributes)).toBeNull();
  });

  it("ручний штат дає збіг і змінює порт відправлення", () => {
    const vm = createVm({ autoPricing: { auctions: { selected: "iaai" } } });
    const attrs = landed.toLotJson(BARE, "NY").inventoryView.attributes;
    expect(attrs.State).toBe("NY");
    const loc = vm.matchAuctionLocation(attrs);
    expect(loc).not.toBeNull();
    expect(loc.name).toMatch(/- NY \(IAAI\)/);
  });

  it("незматчена локація не потрапляє в matched_location", () => {
    const row = resale.buildResaleRow({
      advert: ADVERT,
      history: BARE,
      landed: {
        landedCost: 41086,
        locationMatched: 0,
        matchedLocation: null,
        fallbackLocation: "AL ADESA BIRMINGHAM - AL (IAAI)",
        inlandUsFee: 1475,
        locationWeak: true,
      },
    });
    expect(row.location_matched).toBe(0);
    expect(row.matched_location).toBeNull();
    expect(row.inland_us_fee).toBe(1475);
    // Спостереження не викидається: ставка й ціна в Україні реальні.
    expect(row.landed_cost).toBe(41086);
    expect(row.gross_profit).toBe(43300 - 41086);
  });
});
