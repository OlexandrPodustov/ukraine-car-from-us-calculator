/**
 * Розбір лота IAAI: імена полів у JSON аукціону та наслідки для розрахунку.
 *
 * Фікстура — реальний лот 46380419 (2012 Porsche 911 Carrera S), узятий
 * ЦІЛКОМ із raw_json у data/searches.db (зріз 2026-08-23). До цього тут лежала
 * обрізана копія на 67 атрибутів із чотирьох гілок inventoryView замість 209
 * із тридцяти трьох — тобто тести бачили не ту структуру, що прод, і цілі
 * гілки (vehicleInformation, vehicleDescription) були для них невидимі. На ньому видно всі три граблі одразу:
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

describe("поля стану, які IAAI віддає окремими атрибутами", () => {
  const vm = iaaiVm();
  const data = vm.collectLotData(LOT, ATTRS, SALE, "https://x.iaai.com/1");

  it("читає «заводиться», каталізатор і брелок", () => {
    // У фікстурі StartsDesc порожній (пробіл) і CatalyticConverter відсутній —
    // саме той один лот із 24, де IAAI цих полів не дав.
    expect(data.starts).toBe("");
    expect(data.catalyticConverter).toBe("");
    expect(data.keyFob).toBe("True");

    // StartsDesc — не те саме, що RunAndDrive: «заводиться, але не їде».
    const rich = vm.collectLotData(
      LOT,
      Object.assign({}, ATTRS, {
        StartsCode: "CST",
        StartsDesc: "Starts",
        CatalyticConverter: "Present",
      }),
      SALE,
      "https://x.iaai.com/1",
    );
    expect(rich.starts).toBe("Starts");
    expect(rich.catalyticConverter).toBe("Present");
  });

  it("прапорець CAT (стихійне лихо) — 0/1, а не рядок", () => {
    expect(data.catIndicator).toBe(0);
    const flooded = vm.collectLotData(
      LOT,
      Object.assign({}, ATTRS, {
        CATIndicator: "True",
        CATText: "http://iaa-auctions.com/flood",
      }),
      SALE,
      "https://x.iaai.com/1",
    );
    expect(flooded.catIndicator).toBe(1);
    expect(flooded.catText).toContain("flood");
  });

  it("посилання на CAT не зберігається для звичайних лотів", () => {
    // Воно є на КОЖНІЙ сторінці лота — без цієї умови всі 25 рядків у БД
    // отримували однакову боілерплейтну адресу.
    const normal = vm.collectLotData(
      LOT,
      Object.assign({}, ATTRS, {
        CATIndicator: "False",
        CATText: "http://iaa-auctions.com/flood",
      }),
      SALE,
      "https://x.iaai.com/1",
    );
    expect(normal.catText).toBe("");
  });

  it("прапорець гібрида читається з HybridIndicator, а не з назви палива", () => {
    const hybridAttrs = Object.assign({}, ATTRS, {
      HybridIndicator: "True",
      FuelTypeCode: "GASOLINE",
    });
    const parsed = vm.collectLotData(
      LOT,
      hybridAttrs,
      SALE,
      "https://x.iaai.com/1",
    );
    expect(parsed.hybrid).toBe(1);

    const form = iaaiVm();
    form.logLot = () => Promise.resolve(true);
    const lot = JSON.parse(JSON.stringify(LOT));
    lot.inventoryView.attributes = hybridAttrs;
    form.applyLotJson(lot, "https://x.iaai.com/1", { save: false });
    expect(form.customs.isHybrid).toBe(true);
    expect(form.customs.engineType).toBe("petrol");
  });

  it("HybridIndicator=False перебиває «hybrid» у назві палива", () => {
    const form = iaaiVm();
    form.logLot = () => Promise.resolve(true);
    const lot = JSON.parse(JSON.stringify(LOT));
    lot.inventoryView.attributes.HybridIndicator = "False";
    lot.inventoryView.attributes.FuelTypeCode = "HYBRID";
    form.applyLotJson(lot, "https://x.iaai.com/1", { save: false });
    expect(form.customs.isHybrid).toBe(false);
  });

  it("нові поля доходять до блоку «Стан лота» на калькуляторі", () => {
    const form = iaaiVm();
    form.logLot = () => Promise.resolve(true);
    const lot = JSON.parse(JSON.stringify(LOT));
    lot.inventoryView.attributes.CATIndicator = "True";
    lot.inventoryView.attributes.CatalyticConverter = "Present";
    lot.inventoryView.attributes.StartsDesc = "Starts";
    form.applyLotJson(lot, "https://x.iaai.com/1", { save: false });
    const rows = form.lotConditionRows();
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["CAT-лот"]).toMatch(/стихійне лихо/);
    expect(byLabel["Брелок"]).toBe("є");
    expect(byLabel["Каталізатор"]).toBe("на місці");
    expect(byLabel["Заводиться"]).toBe("так");
    // Порожні поля в блок не потрапляють — рядків рівно стільки, скільки є.
    expect(rows.every((r) => r.value)).toBe(true);
  });

  it("resetLotData прибирає їх разом з рештою лота", () => {
    const form = iaaiVm();
    form.logLot = () => Promise.resolve(true);
    form.applyLotJson(LOT, "https://x.iaai.com/1", { save: false });
    form.resetLotData();
    expect(form.lotCondition.starts).toBe("");
    expect(form.lotCondition.keyFob).toBe("");
    expect(form.lotCondition.catalyticConverter).toBe("");
    expect(form.lotConditionRows()).toEqual([]);
  });
});

describe("другий і третій списки key/value з inventoryView", () => {
  const vm = iaaiVm();
  const data = vm.collectLotData(LOT, ATTRS, SALE, "https://x.iaai.com/1");

  it("читає стан документа зі штатом, а не самий лише код тайтла", () => {
    // TitleCode = «CLR» нічого не каже про штат і про те, чи тайтл на руках.
    // «Wait Title» означає, що відправка чекає документа.
    expect(data.titleCode).toBe("CLR");
    expect(data.titleSaleDoc).toBe("CLEAR (New York)");
  });

  it("читає країну виробництва й перелік подушок", () => {
    expect(data.manufacturedIn).toBe("Germany");
    expect(data.restraintSystem).toMatch(/airbag/i);
  });

  it("список ліцензій, яким дозволено купувати, склеюється в рядок", () => {
    expect(data.whoCanBuy).toBe("DEA, DIS, EXP, LBU, REB, SCR");
  });

  it("порожній whoCanBuy означає «обмежень немає»", () => {
    const open = JSON.parse(JSON.stringify(LOT));
    open.auctionInformation.biddingInformation.whoCanBuy.$values = [];
    expect(vm.lotWhoCanBuy(open)).toBe("");
    // І рядка в блоці стану для нього немає.
    const form = iaaiVm();
    form.logLot = () => Promise.resolve(true);
    form.applyLotJson(open, "https://x.iaai.com/1", { save: false });
    expect(form.lotConditionRows().map((r) => r.label)).not.toContain(
      "Купувати може",
    );
  });

  it("lotKeyValues не падає на чужій структурі", () => {
    expect(vm.lotKeyValues({}, "vehicleInformation")).toEqual([]);
    expect(
      vm.lotKeyValues({ inventoryView: {} }, "vehicleDescription"),
    ).toEqual([]);
    expect(vm.lotWhoCanBuy({})).toBe("");
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

  it("позначає збіг як слабкий, коли з філією не зійшлось жодне слово", () => {
    // Плече до порту в межах штату різниться до $375, тож «перша філія в
    // штаті» має виглядати інакше, ніж справжній збіг.
    const attrs = { State: "IL", BranchName: "Нема такої філії" };
    const loc = vm.matchAuctionLocation(attrs);
    expect(loc).not.toBeNull();
    expect(vm.locationMatchIsWeak(attrs, loc)).toBe(true);

    const good = { State: "IL", BranchName: "Chicago-West (IL)" };
    expect(vm.locationMatchIsWeak(good, vm.matchAuctionLocation(good))).toBe(
      false,
    );
  });
});

describe("locationMatch — чи можна вірити наземному плечу", () => {
  // Лот без штату («Dream Rides Westchester») лишає локацію дефолтною —
  // перший рядок довідника, філія в Алабамі. Звідти беруться і наземне
  // плече, і узбережжя (ставка фрахту), тож підсумок мусить це показувати.
  function lotWithoutState() {
    const lot = JSON.parse(JSON.stringify(LOT));
    const a = lot.inventoryView.attributes;
    a.State = " ";
    a.BranchState = " ";
    a.City = " ";
    a.BranchName = "Dream Rides Westchester";
    a.Name = "Dream Rides Westchester";
    return lot;
  }

  function applied(lot) {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    vm.applyLotJson(lot, "https://x.iaai.com/1", { save: false });
    return vm;
  }

  it("справжній збіг за філією — ok", () => {
    // Сам фікстурний лот — offsite (авто в Yonkers NY, філія «Dream Rides»
    // в IL), тобто збіг по штату без збігу по філії. Ставимо справжню філію
    // з довідника, щоб перевірити саме сильний збіг.
    const lot = JSON.parse(JSON.stringify(LOT));
    lot.inventoryView.attributes.BranchName = "Long Island (NY)";
    expect(applied(lot).locationMatch).toBe("ok");
  });

  it("збіг лише за штатом — weak", () => {
    const lot = JSON.parse(JSON.stringify(LOT));
    lot.inventoryView.attributes.BranchName = "Нема такої філії";
    lot.inventoryView.attributes.Name = "Нема такої філії";
    lot.inventoryView.attributes.City = "Нема такої філії";
    expect(applied(lot).locationMatch).toBe("weak");
  });

  it("без штату — none, і про дефолтну локацію сказано вголос", () => {
    const vm = applied(lotWithoutState());
    expect(vm.locationMatch).toBe("none");
    // локація лишилась першою в довіднику — саме те, про що попереджаємо
    expect(vm.autoShipping.location.selected).toBe(window.autoLocation[0].id);
    expect(vm.auctionMsg).toContain("локацію не визначено");
    expect(vm.auctionMsg).toContain(window.autoLocation[0].name);
  });

  it("ручний вибір локації знімає попередження", () => {
    const vm = applied(lotWithoutState());
    vm.selectLocation(window.autoLocation[1]);
    expect(vm.locationMatch).toBe("manual");
  });

  it("resetLotData скидає ознаку разом з рештою лота", () => {
    const vm = applied(lotWithoutState());
    vm.resetLotData();
    expect(vm.locationMatch).toBe("");
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

describe("гібриди", () => {
  // Для митниці гібрид — це його ДВЗ: ПКУ 215.3.5-1 бере базову ставку
  // відповідного бензинового/дизельного двигуна (docs/customs-rates-baseline.md).
  // Для AUTO.RIA це окремий fuel_id і окремий ціновий сегмент.
  // HybridIndicator тут прибираємо навмисно: це запасна гілка для лотів, де
  // явного прапорця немає (Copart, старі записи). Перевага самого прапорця
  // перевіряється окремими тестами нижче.
  function parseWithFuel(fuel) {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    const lot = JSON.parse(JSON.stringify(LOT));
    delete lot.inventoryView.attributes.HybridIndicator;
    lot.inventoryView.attributes.FuelTypeCode = fuel;
    lot.inventoryView.attributes.FuelTypeDesc = fuel;
    vm.applyLotJson(lot, "https://x.iaai.com/1", { save: false });
    return vm;
  }

  it.each([
    ["HYBRID", "petrol", true],
    ["GAS/ELECTRIC", "petrol", true],
    ["PLUG-IN HYBRID", "petrol", true],
    ["DIESEL HYBRID", "diesel", true],
    ["GASOLINE", "petrol", false],
    ["DIESEL", "diesel", false],
    ["ELECTRIC", "electric", false],
  ])("%s → %s, гібрид=%s", (fuel, engine, hybrid) => {
    const vm = parseWithFuel(fuel);
    expect(vm.customs.engineType).toBe(engine);
    expect(vm.customs.isHybrid).toBe(hybrid);
  });

  it("GAS/ELECTRIC не стає електромобілем — акцизу за батарею тут немає", () => {
    const vm = parseWithFuel("GAS/ELECTRIC");
    expect(vm.isElectricEngine()).toBe(false);
    expect(vm.exciseFormula()).toMatch(/л ×/);
  });

  it("акциз гібрида такий самий, як у бензинового з тим самим об'ємом", () => {
    const hybrid = createVm({
      customs: { engineType: "petrol", isHybrid: true, engineVolume: "2.5" },
    });
    const petrol = createVm({
      customs: { engineType: "petrol", isHybrid: false, engineVolume: "2.5" },
    });
    expect(hybrid.exciseEur()).toBe(petrol.exciseEur());
  });

  it("на AUTO.RIA гібрид фільтрується окремо і не ділить кеш із бензином", async () => {
    const vm = createVm({
      customs: { engineType: "petrol", isHybrid: true },
    });
    vm.getRiaFuels = async () => [
      { value: 1, name: "Бензин" },
      { value: 5, name: "Гібрид" },
    ];
    vm.getRiaGearboxes = async () => [];
    const target = vm.normalizeMarketTarget();
    expect(target.isHybrid).toBe(true);

    const filters = await vm.buildRiaFilters(target);
    expect(filters.fuel).toBe("&fuel_id%5B0%5D=5");
    expect(filters.fuelLabel).toBe("гібрид");

    const asPetrol = Object.assign({}, target, { isHybrid: false });
    expect(vm.getMarketCacheKey(target)).not.toBe(
      vm.getMarketCacheKey(asPetrol),
    );
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

  it("бере аукціон із рядка БД, а не зі сховища", async () => {
    // Калькулятор міг стояти на Copart (це дефолт), а лот у БД — IAAI.
    // Тоді збережений лот рахувався за чужою сіткою зборів, локація й наземне
    // плече бралися з філій іншого аукціону, посилання «сторінка лоту» вело
    // на copart.com, а пошук ціни не знаходив лот за (аукціон, номер).
    const vm = createVm();
    vm.autoPricing.auctions.selected = "copart";
    vm.logLot = () => Promise.resolve(true);
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 29,
            auction: "iaai",
            url: "https://www.iaai.com/VehicleDetail/46380419~US",
            raw: LOT,
          }),
      }),
    );

    await expect(vm.loadSavedLot(29)).resolves.toBe(true);

    expect(vm.autoPricing.auctions.selected).toBe("iaai");
    expect(vm.currentLot.auction).toBe("iaai");
    expect(vm.getCurrentLocation().name).toContain("(IAAI)");
    expect(
      vm.canonicalLotUrl(vm.currentLot.auction, vm.currentLot.lotNumber),
    ).toBe("https://www.iaai.com/VehicleDetail/46380419~US");
  });

  it("невідомий аукціон у рядку БД не збиває поточний вибір", async () => {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ id: 1, auction: "manheim", url: "", raw: LOT }),
      }),
    );

    await vm.loadSavedLot(1);
    expect(vm.autoPricing.auctions.selected).toBe("iaai");
  });

  it("з БД тягне повний VIN, якого в сирому JSON немає за визначенням", async () => {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 29,
            auction: "iaai",
            url: "https://www.iaai.com/VehicleDetail/46380419~US",
            vin_full: "WP0AB2A99CS721234",
            raw: LOT,
          }),
      }),
    );

    await vm.loadSavedLot(29);
    expect(vm.currentLot.vinFull).toBe("WP0AB2A99CS721234");
    expect(vm.displayVin()).toBe("WP0AB2A99CS721234");
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

/**
 * Зняття маски з VIN.
 *
 * IAAI показує лише перші 11 символів — і незалогіненому скрейпу, і
 * залогіненому акаунту (перевірено 2026-08-23 на лоті 46293657: у DOM
 * сторінки під логіном немає жодного повного 17-значного VIN). Останні 6 є
 * рівно на одному фото, яке аукціон підписує «Manufacturer VIN Plate» у
 * прихованому полі imageCaptions — у HTML сторінки, а не в JSON лота.
 */
describe("VIN за маскою", () => {
  const CAPTIONS_HTML =
    '<input id="imageCaptions" type="hidden" value="Passenger Front Image,' +
    'Dashboard / Odometer,Manufacturer VIN Plate,Engine photo" />';

  it("читає підписи фото з HTML сторінки", () => {
    const vm = iaaiVm();
    expect(vm.parseImageCaptions(CAPTIONS_HTML)).toEqual([
      "Passenger Front Image",
      "Dashboard / Odometer",
      "Manufacturer VIN Plate",
      "Engine photo",
    ]);
    expect(vm.parseImageCaptions("<html>без підписів</html>")).toEqual([]);
  });

  it("розкладає підписи по фото в тому ж порядку і знаходить табличку", () => {
    const vm = iaaiVm();
    const nd = JSON.parse(JSON.stringify(LOT));
    nd.imageCaptions = vm.parseImageCaptions(CAPTIONS_HTML);

    const media = vm.collectLotMedia(nd);
    expect(media.images[2].caption).toBe("Manufacturer VIN Plate");
    expect(vm.vinPlateImage(media.images)).toBe(media.images[2]);
  });

  it("не вигадує табличку, коли підписів немає", () => {
    const vm = iaaiVm();
    const media = vm.collectLotMedia(LOT);
    expect(media.images.length).toBeGreaterThan(0);
    expect(vm.vinPlateImage(media.images)).toBe(null);
  });

  it("контрольна цифра ловить одрук у переписаному з фото хвості", () => {
    const vm = iaaiVm();
    // Реальний лот 46293657: маска WP1AA2A53RL******, з таблички — B16469.
    expect(vm.vinCheckDigitOk("WP1AA2A53RLB16469")).toBe(true);
    expect(vm.vinCheckDigitOk("WP1AA2A53RLB16468")).toBe(false);
    // I, O, Q у VIN не бувають — саме щоб не плутались з 1 та 0.
    expect(vm.vinCheckDigitOk("WP1AA2A53RLB1646O")).toBe(false);
    expect(vm.vinCheckDigitOk("")).toBe(false);
  });

  it("показує повний VIN, коли він є, і маску, поки його нема", () => {
    const vm = iaaiVm();
    vm.currentLot = {
      auction: "iaai",
      lotNumber: "1",
      vin: "WP1AA2A53RL******",
    };
    expect(vm.displayVin()).toBe("WP1AA2A53RL******");

    vm.currentLot.vinFull = "WP1AA2A53RLB16469";
    expect(vm.displayVin()).toBe("WP1AA2A53RLB16469");
  });

  it("добудовує повний VIN із самого хвоста й не пише на сервер сміття", async () => {
    const vm = iaaiVm();
    vm.currentLot = {
      auction: "iaai",
      lotNumber: "1",
      vin: "WP1AA2A53RL******",
      vinFull: "",
      lotId: 34,
      vinPlate: "",
    };
    let sent = null;
    global.fetch = jest.fn((url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, vinFull: sent.body.vinFull }),
      });
    });

    await vm.saveVinFull("b16469");
    expect(sent.url).toMatch(/\/api\/lots\/34\/vin$/);
    expect(sent.body.vinFull).toBe("WP1AA2A53RLB16469");
    expect(vm.currentLot.vinFull).toBe("WP1AA2A53RLB16469");

    // Одрук навіть не доходить до мережі.
    global.fetch.mockClear();
    await vm.saveVinFull("B16468");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(vm.currentLot.vinFull).toBe("WP1AA2A53RLB16469");
  });

  it("не губить vin_full при повторному парсингу того самого лота", () => {
    const vm = iaaiVm();
    vm.logLot = () => Promise.resolve(true);
    vm.applyLotJson(LOT, "https://x.iaai.com/1");
    // Парсинг ніколи не приносить повного VIN — лише маску. Саме тому
    // vin_full і не входить у UPSERT на сервері.
    expect(vm.currentLot.vinFull).toBe("");
    expect(vm.currentLot.vin).toMatch(/\*/);
  });
});

// Повний VIN живе ЛИШЕ в колонці lots.vin_full: парсинг його не приносить
// (IAAI віддає маску), а в localStorage він міг і не потрапити — PUT з VIN
// відбувається вже після того, як стан збережено. Тому при старті сторінки
// джерело правди для VIN — база.
describe("refreshLotFromDb", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function lotVm(currentLot) {
    const vm = createVm();
    vm.saveToLocalStorage = () => {};
    Object.assign(vm.currentLot, currentLot);
    return vm;
  }

  it("бере vin_full за id лота", async () => {
    const vm = lotVm({
      lotId: 29,
      auction: "iaai",
      lotNumber: "46380419",
      vin: "WP0AB2A99CS******",
    });
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 29, vin_full: "WP0AB2A99CS721234" }),
      }),
    );

    await expect(vm.refreshLotFromDb()).resolves.toBe(true);
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/api\/lots\/29$/);
    expect(vm.displayVin()).toBe("WP0AB2A99CS721234");
  });

  it("без id знаходить лот у списку за парою (аукціон, номер)", async () => {
    const vm = lotVm({
      lotId: null,
      auction: "iaai",
      lotNumber: "46380419",
      vin: "WP0AB2A99CS******",
    });
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { id: 7, auction: "copart", lot_number: "46380419" },
            { id: 29, auction: "iaai", lot_number: 46380419, vin_full: "X" },
          ]),
      }),
    );

    await expect(vm.refreshLotFromDb()).resolves.toBe(true);
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/api\/lots$/);
    // lotId потрібен кнопці «зберегти VIN» — без нього писати нікуди.
    expect(vm.currentLot.lotId).toBe(29);
  });

  it("мовчить, коли лота нема або /api недоступне", async () => {
    const empty = lotVm({});
    await expect(empty.refreshLotFromDb()).resolves.toBe(false);

    const vm = lotVm({ lotId: 29, vin: "WP0AB2A99CS******" });
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
    await expect(vm.refreshLotFromDb()).resolves.toBe(false);
    // Маска лишається на екрані — решта калькулятора працює далі.
    expect(vm.displayVin()).toBe("WP0AB2A99CS******");
  });
});
