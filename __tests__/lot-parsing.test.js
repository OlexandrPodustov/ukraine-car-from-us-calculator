/**
 * Розбір лота IAAI: імена полів у JSON аукціону та наслідки для розрахунку.
 *
 * Фікстура — реальний лот 46380419 (2012 Porsche 911 Carrera S), збережений у
 * data/searches.db 2026-08-17. На ньому видно всі три граблі одразу:
 * порожні поля приходять пробілом, потрібні значення лежать під іншими іменами
 * (ODOValue, а не Odometer), а філія продажу — в іншому штаті, ніж саме авто.
 */
const { createVm } = require("./helpers/load-calculator");
const LOT = require("./fixtures/iaai-lot-46380419.json");
const ATTRS = LOT.inventoryView.attributes;
const SALE = LOT.inventoryView.saleInformation.$values;

function iaaiVm() {
  const vm = createVm();
  vm.autoPricing.auctions.selected = "iaai";
  return vm;
}

describe("pickAttr", () => {
  const vm = createVm();

  it("вважає порожнім рядок з самих пробілів (так IAAI віддає «нема даних»)", () => {
    expect(vm.pickAttr(" ", "", "RWD")).toBe("RWD");
    expect(vm.pickAttr(" ")).toBe("");
  });

  it("повертає перше непорожнє й обрізає пробіли", () => {
    expect(vm.pickAttr(null, undefined, "  NY ")).toBe("NY");
    expect(vm.pickAttr()).toBe("");
  });
});

describe("parseOdometer", () => {
  const vm = createVm();

  it("читає ODOValue (IAAI), а не неіснуючий Odometer", () => {
    expect(vm.parseOdometer(ATTRS)).toBe(58639);
  });

  it("переводить кілометри в милі", () => {
    expect(vm.parseOdometer({ ODOValue: "160934", ODOUoM: "km" })).toBe(100000);
  });

  it("розуміє формат Copart із комами", () => {
    expect(vm.parseOdometer({ Odometer: "58,639 mi" })).toBe(58639);
  });

  it("повертає null, коли пробігу нема", () => {
    expect(vm.parseOdometer({})).toBeNull();
    expect(vm.parseOdometer(null)).toBeNull();
  });
});

describe("collectLotData — поля лота", () => {
  const data = iaaiVm().collectLotData(
    LOT,
    ATTRS,
    SALE,
    "https://x.iaai.com/1",
  );

  it("заповнює поля, які раніше йшли в БД порожніми", () => {
    expect(data.odometer).toBe(58639);
    expect(data.color).toBe("SILVER");
    expect(data.drive).toBe("RWD");
    expect(data.primaryDamage).toBe("NORMAL WEAR & TEAR");
    expect(data.cylinders).toBe("6 Cyl");
  });

  it("зберігає стан лота, важливий для оцінки ремонту", () => {
    expect(data.runAndDrive).toBe("True");
    expect(data.hasKeys).toBe("True");
    expect(data.airbags).toBe("Intact");
    expect(data.lossType).toBe("Other");
    expect(data.odometerBrand).toBe("ACTUAL");
    expect(data.vehicleGrade).toBe("50");
  });

  it("розрізняє місце авто і філію продажу (offsite-лот)", () => {
    expect(data.vehicleCity).toBe("Yonkers");
    expect(data.vehicleState).toBe("NY");
    expect(data.vehicleZip).toBe("10701");
    expect(data.branchState).toBe("IL");
    expect(data.offsite).toBe(1);
  });

  it("не тягне пробіли замість значень", () => {
    Object.keys(data).forEach((k) => {
      if (typeof data[k] === "string") expect(data[k]).toBe(data[k].trim());
    });
  });
});

describe("matchAuctionLocation", () => {
  const vm = iaaiVm();

  it("шукає філію за BranchName, а не за містом", () => {
    // місто Medford, філія Long Island — у довіднику є саме філія
    expect(
      vm.matchAuctionLocation({
        City: "Medford",
        State: "NY ",
        BranchName: "Long Island (NY)",
      }).name,
    ).toBe("NY LONG ISLAND - NY (IAAI)");
    expect(
      vm.matchAuctionLocation({
        City: "Aurora",
        State: "IL ",
        BranchName: "Chicago-West (IL)",
      }).name,
    ).toBe("IL CHICAGO WEST - IL (IAAI)");
  });

  it("для offsite-лота бере штат авто, а не штат філії", () => {
    const loc = vm.matchAuctionLocation(ATTRS);
    expect(loc.name.slice(0, 2)).toBe("NY"); // авто в Yonkers, NY; філія — IL
  });

  it("повертає локацію того ж аукціону", () => {
    expect(vm.matchAuctionLocation(ATTRS).name).toContain("IAAI");
  });

  it("не вигадує локацію для невідомого штату", () => {
    expect(vm.matchAuctionLocation({ State: "ZZ" })).toBeNull();
    expect(vm.matchAuctionLocation({})).toBeNull();
  });
});

describe("порт відправлення", () => {
  it("західні штати відправляються із західного узбережжя", () => {
    expect(window.portForState("CA")).toBe("los_angeles");
    expect(window.portForState("wa")).toBe("los_angeles");
    expect(window.portForState("GA")).toBe("savannah");
    expect(window.portForState("OH")).toBe("new_york");
    expect(window.portForState("")).toBe("new_york");
  });

  it("зміна локації переставляє порт і узбережжя", () => {
    const vm = iaaiVm();
    const ca = window.autoLocation.filter((l) => /^CA .*IAAI/.test(l.name))[0];
    vm.autoShipping.location.selected = ca.id;
    vm.onLocationChange();
    expect(vm.autoShipping.shippingPort).toBe("los_angeles");
    expect(vm.currentCoast()).toBe("west");

    const oh = window.autoLocation.filter((l) => /^OH .*IAAI/.test(l.name))[0];
    vm.autoShipping.location.selected = oh.id;
    vm.onLocationChange();
    expect(vm.autoShipping.shippingPort).toBe("new_york");
    expect(vm.currentCoast()).toBe("east");
  });

  it("західне узбережжя дорожче за східне на ставку фрахту", () => {
    const vm = iaaiVm();
    const ca = window.autoLocation.filter((l) => /^CA .*IAAI/.test(l.name))[0];
    const oh = window.autoLocation.filter((l) => /^OH .*IAAI/.test(l.name))[0];

    vm.autoShipping.location.selected = oh.id;
    vm.onLocationChange();
    const east = vm.oceanFreightFee();

    vm.autoShipping.location.selected = ca.id;
    vm.onLocationChange();
    expect(vm.oceanFreightFee()).toBeGreaterThan(east);
  });

  it("ручний вибір порту не перезатирається зміною локації", () => {
    const vm = iaaiVm();
    vm.autoShipping.shippingPort = "new_york";
    vm.onDeparturePortChange();

    const ca = window.autoLocation.filter((l) => /^CA .*IAAI/.test(l.name))[0];
    vm.autoShipping.location.selected = ca.id;
    vm.onLocationChange();
    expect(vm.autoShipping.shippingPort).toBe("new_york");
  });
});

describe("ключ кешу ринкової ціни", () => {
  const vm = createVm();
  const base = {
    make: "BMW",
    model: "M340I",
    year: 2020,
    engineType: "petrol",
    engineVolume: 3,
    mileage: 37000,
    transmission: "Automatic",
  };

  it("розрізняє лоти з різним пробігом — пробіг іде у фільтр запиту", () => {
    const far = Object.assign({}, base, { mileage: 100000 });
    expect(vm.getMarketCacheKey(base)).not.toBe(vm.getMarketCacheKey(far));
  });

  it("не дробить кеш на дрібних відмінностях пробігу (крок бакета 10 тис. км)", () => {
    const near = Object.assign({}, base, { mileage: 38000 });
    expect(vm.getMarketCacheKey(near)).toBe(vm.getMarketCacheKey(base));
  });

  it("розрізняє коробки передач", () => {
    const manual = Object.assign({}, base, { transmission: "Manual" });
    expect(vm.getMarketCacheKey(manual)).not.toBe(vm.getMarketCacheKey(base));
  });

  it("однакове авто — однаковий ключ", () => {
    expect(vm.getMarketCacheKey(Object.assign({}, base))).toBe(
      vm.getMarketCacheKey(base),
    );
  });
});

describe("purgeLegacyMarketCache", () => {
  it("прибирає записи кешу зі старим ключем і не чіпає решту", () => {
    const vm = createVm();
    localStorage.setItem("ukr_market_cache_v1|bmw|m340i|2020", "{}");
    localStorage.setItem("ukr_market_cache_v2|bmw|m340i|2020", "{}");
    localStorage.setItem("carCalcData", "{}");

    expect(vm.purgeLegacyMarketCache()).toBe(1);
    expect(
      localStorage.getItem("ukr_market_cache_v1|bmw|m340i|2020"),
    ).toBeNull();
    expect(localStorage.getItem("ukr_market_cache_v2|bmw|m340i|2020")).toBe(
      "{}",
    );
    expect(localStorage.getItem("carCalcData")).toBe("{}");
  });
});

describe("фіксовані збори", () => {
  it("таблиця витрат і total() беруть ті самі суми", () => {
    const vm = createVm();
    const shown = vm.fixedFees.reduce((s, f) => s + f.amount, 0);
    expect(vm.fixedFeesTotal()).toBe(shown);
  });

  it("зміна збору зсуває підсумок рівно на дельту", () => {
    const vm = createVm();
    const before = vm.total();
    vm.fixedFees[0].amount += 100;
    expect(vm.total()).toBe(before + 100);
  });

  it("кожен збір має підпис для таблиці", () => {
    const vm = createVm();
    expect(vm.fixedFees.length).toBeGreaterThan(0);
    vm.fixedFees.forEach((f) => {
      expect(typeof f.label).toBe("string");
      expect(f.label.length).toBeGreaterThan(0);
      expect(Number.isFinite(f.amount)).toBe(true);
    });
  });
});

describe("applyLotJson / loadSavedLot", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("заповнює форму з JSON лота і зберігає його в БД", () => {
    const vm = iaaiVm();
    const saved = [];
    vm.logLot = (payload) => {
      saved.push(payload);
      return Promise.resolve(true);
    };

    vm.applyLotJson(LOT, "https://www.iaai.com/VehicleDetail/46380419~US");

    expect(vm.auctionStatus).toBe("ok");
    expect(vm.customs.manufactureYear).toBe(2012);
    expect(vm.customs.engineType).toBe("petrol");
    expect(vm.customs.engineVolume).toBe("3.8");
    expect(vm.customs.carrierInfo.mileage).toBe(58639);
    expect(vm.currentLot.lotNumber).toBe("46380419");
    expect(saved).toHaveLength(1);
    expect(saved[0].url).toBe("https://www.iaai.com/VehicleDetail/46380419~US");
  });

  it("попереджає про offsite-лот — плече до порту рахується від авто", () => {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    vm.applyLotJson(LOT, "https://x.iaai.com/1");
    expect(vm.auctionMsg).toMatch(/offsite/);
    expect(vm.auctionMsg).toMatch(/Yonkers/);
  });

  it("з БД лот НЕ перезаписується назад у БД", async () => {
    const vm = iaaiVm();
    let posts = 0;
    vm.logLot = () => {
      posts++;
      return Promise.resolve(true);
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 29,
            url: "https://www.iaai.com/VehicleDetail/46380419~US",
            raw: LOT,
          }),
      }),
    );

    await expect(vm.loadSavedLot(29)).resolves.toBe(true);
    expect(posts).toBe(0);
    expect(vm.auctionUrl).toBe(
      "https://www.iaai.com/VehicleDetail/46380419~US",
    );
    expect(vm.customs.carrierInfo.model).toBe("911");
  });

  it("каже, коли лот із БД не дістати", async () => {
    const vm = iaaiVm();
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));

    await expect(vm.loadSavedLot(999)).resolves.toBe(false);
    expect(vm.auctionStatus).toBe("error");
    expect(vm.auctionMsg).toMatch(/HTTP 404/);
  });

  it("не падає на чужій структурі JSON — каже заповнити вручну", () => {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    vm.autoPricing.auctions.selected = "copart";
    vm.applyLotJson(
      { props: { pageProps: {} } },
      "https://www.copart.com/lot/1",
    );
    expect(vm.auctionStatus).toBe("warn");
    expect(vm.auctionMsg).toMatch(/вручну/);
    expect(vm.auctionMsg).toMatch(/COPART/);
  });
});

describe("стан лота в калькуляторі", () => {
  it("заповнюється зі зчитаного лота", () => {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    vm.applyLotJson(LOT, "https://x.iaai.com/1");

    const rows = vm.lotConditionRows();
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Пошкодження"]).toBe("NORMAL WEAR & TEAR");
    expect(byLabel["Заводиться/їде"]).toBe("так");
    expect(byLabel["Ключі"]).toBe("є");
    expect(byLabel["Подушки"]).toBe("цілі");
    expect(byLabel["Пробіг"]).toBe("58,639 mi (ACTUAL)");
    expect(byLabel["Тайтл"]).toBe("CLR");
  });

  it("порожній до зчитування і скидається разом з лотом", () => {
    const vm = iaaiVm();
    expect(vm.lotConditionRows()).toHaveLength(0);

    vm.logLot = () => Promise.resolve(true);
    vm.applyLotJson(LOT, "https://x.iaai.com/1");
    expect(vm.lotConditionRows().length).toBeGreaterThan(0);

    vm.resetLotData();
    expect(vm.lotConditionRows()).toHaveLength(0);
  });

  it("переживає перезавантаження сторінки разом з рештою стану", () => {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    vm.applyLotJson(LOT, "https://x.iaai.com/1");

    const saved = JSON.parse(JSON.stringify(window.pickPersistedState(vm)));
    const restored = createVm();
    window.applyPersistedState(restored, saved);

    expect(restored.lotCondition.runAndDrive).toBe("True");
    expect(restored.lotConditionRows().length).toBe(
      vm.lotConditionRows().length,
    );
  });
});
