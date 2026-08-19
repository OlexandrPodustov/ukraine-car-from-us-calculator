/**
 * Тести ганяють РЕАЛЬНИЙ код з assets/js — той самий, що вантажить браузер.
 *
 * Раніше цей файл тримав власні копії `inRange`/`calculateCopartFee` і власний
 * `mockVm`. Копії розійшлися з джерелом непомітно: тест стверджував, що збір
 * Copart містить gate fee $59 і що діапазону $25 000–29 999.99 не існує — у
 * коді ні того, ні іншого немає. Тому тепер усе вантажиться через
 * helpers/load-calculator.js і розійтися вже не може.
 */
const { createVm, loadModules } = require("./helpers/load-calculator");

loadModules();

describe("inRange", () => {
  test("повертає значення всередині діапазону і 0 поза ним", () => {
    expect(window.inRange(0, 10, 5)(7)).toBe(5);
    expect(window.inRange(0, 10, 5)(15)).toBe(0);
  });

  test("межі включні з обох боків", () => {
    expect(window.inRange(0, 10, 5)(0)).toBe(5);
    expect(window.inRange(0, 10, 5)(10)).toBe(5);
  });
});

describe("Сітка зборів Copart", () => {
  const fee = (p) => window.calculateCopartFee(p);

  test("фіксовані сходинки", () => {
    expect(fee(0)).toBe(75);
    expect(fee(50)).toBe(75);
    expect(fee(100)).toBe(138);
    expect(fee(10000)).toBe(788);
    expect(fee(14999)).toBe(788);
  });

  test("від $15 000 — 4% від ціни, але не менше попередньої сходинки", () => {
    // 4% від $15 000 = $600 < $788 на сходинці $10 000–14 999.99, тому до
    // $19 700 тримається $788, далі відсоток його переганяє.
    expect(fee(15000)).toBe(788);
    expect(fee(19700)).toBe(788);
    expect(fee(20000)).toBe(800);
    expect(fee(100000)).toBe(4000);
  });

  test("сітка не спадає зі зростанням ціни", () => {
    let prev = 0;
    for (let p = 0; p <= 200000; p += 97) {
      const cur = fee(p);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  test("сітка покриває діапазон без дірок аж до $10 млн", () => {
    // Кожна сходинка мусить давати ненульовий збір: «дірка» в таблиці
    // inRange мовчки дає 0 і занижує підсумок на сотні доларів.
    for (let p = 50; p <= 200000; p += 137) {
      expect(fee(p)).toBeGreaterThan(0);
    }
  });
});

describe("Сітка зборів IAAI", () => {
  const fee = (p) => window.calculateIaaIFee(p);

  // Офіційна таблиця IAA Standard Volume, чинна з 04.11.2024.
  // Джерела й повна таблиця — docs/auction-fees-baseline.md.
  test("фіксовані сходинки за офіційною таблицею", () => {
    expect(fee(0)).toBe(25);
    expect(fee(49)).toBe(25);
    expect(fee(50)).toBe(45);
    expect(fee(100)).toBe(80);
    expect(fee(300)).toBe(138); // $137.50 з округленням
    expect(fee(2000)).toBe(535);
    expect(fee(10000)).toBe(1000);
    expect(fee(14999)).toBe(1000);
  });

  test("від $15 000 — 7.5% від ціни", () => {
    expect(fee(15000)).toBe(1125);
    expect(fee(25750)).toBe(1931);
    expect(fee(50000)).toBe(3750);
  });

  test("сітка не спадає зі зростанням ціни", () => {
    // Збір аукціону не може зменшуватись, коли авто дорожчає.
    let prev = 0;
    for (let p = 0; p <= 200000; p += 97) {
      const cur = fee(p);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  test("internet bid fee — сходинками до $140", () => {
    expect(window.iaaiInternetBidFee(1000)).toBe(0);
    expect(window.iaaiInternetBidFee(2000)).toBe(100);
    expect(window.iaaiInternetBidFee(5000)).toBe(110);
    expect(window.iaaiInternetBidFee(7000)).toBe(125);
    expect(window.iaaiInternetBidFee(25750)).toBe(140);
  });
});

describe("auctionFee — вибір сітки за аукціоном", () => {
  const at = (auction, price) =>
    createVm({
      autoPricing: { autoPrice: price, auctions: { selected: auction } },
    }).auctionFee();

  test("Copart: надбавки 0 / +25 / +15 / +203 за тирами ціни", () => {
    expect(at("copart", 1500)).toBe(window.calculateCopartFee(1500));
    expect(at("copart", 9000)).toBe(window.calculateCopartFee(9000) + 25);
    expect(at("copart", 5000)).toBe(window.calculateCopartFee(5000) + 15);
    expect(at("copart", 20000)).toBeCloseTo(
      window.calculateCopartFee(20000) + 203,
      5,
    );
  });

  test("IAAI: збір покупця + фіксовані збори + internet bid fee", () => {
    expect(at("iaai", 12000)).toBe(
      window.calculateIaaIFee(12000) + 140 + window.iaaiInternetBidFee(12000),
    );
  });

  test("невідомий аукціон не робить підсумок NaN", () => {
    // До того як сітка переїхала в constants/auctions.js, auctionFee()
    // не повертав нічого для чужого id і total() ставав NaN.
    const vm = createVm({
      autoPricing: { autoPrice: 5000, auctions: { selected: "manheim" } },
    });
    expect(Number.isFinite(vm.auctionFee())).toBe(true);
    expect(Number.isFinite(vm.total())).toBe(true);
  });
});

describe("Коефіцієнт віку для акцизу", () => {
  test("рік випуску = поточний → 1 (нове авто)", () => {
    const vm = createVm({ customs: { manufactureYear: window.currentYear } });
    expect(vm.ageCoefficient()).toBe(1);
  });

  test("КВ = поточний рік − рік випуску − 1", () => {
    const vm = createVm({
      customs: { manufactureYear: window.currentYear - 6 },
    });
    expect(vm.ageCoefficient()).toBe(5);
  });

  test("ніколи не менший за 1", () => {
    const vm = createVm({
      customs: { manufactureYear: window.currentYear + 1 },
    });
    expect(vm.ageCoefficient()).toBe(1);
  });
});

describe("Акциз", () => {
  const base = { manufactureYear: window.currentYear - 6 }; // КВ = 5

  test("бензин ≤ 3.0 л — 50 €/л", () => {
    const vm = createVm({
      customs: {
        ...base,
        engineType: window.engineType.Petrol,
        engineVolume: "2.0",
      },
    });
    expect(vm.exciseEur()).toBeCloseTo(50 * 2.0 * 5, 5);
  });

  test("бензин > 3.0 л — 100 €/л", () => {
    const vm = createVm({
      customs: {
        ...base,
        engineType: window.engineType.Petrol,
        engineVolume: "3.5",
      },
    });
    expect(vm.exciseEur()).toBeCloseTo(100 * 3.5 * 5, 5);
  });

  test("дизель ≤ 3.5 л — 75 €/л, > 3.5 л — 150 €/л", () => {
    const small = createVm({
      customs: {
        ...base,
        engineType: window.engineType.Diesel,
        engineVolume: "3.0",
      },
    });
    const big = createVm({
      customs: {
        ...base,
        engineType: window.engineType.Diesel,
        engineVolume: "4.0",
      },
    });
    expect(small.exciseEur()).toBeCloseTo(75 * 3.0 * 5, 5);
    expect(big.exciseEur()).toBeCloseTo(150 * 4.0 * 5, 5);
  });

  test("електро — 1 €/кВт·год БЕЗ коефіцієнта віку", () => {
    const nova = createVm({
      customs: {
        engineType: window.engineType.Electric,
        batteryKwh: 77,
        manufactureYear: window.currentYear,
      },
    });
    const stara = createVm({
      customs: {
        engineType: window.engineType.Electric,
        batteryKwh: 77,
        manufactureYear: window.currentYear - 10,
      },
    });
    expect(nova.exciseEur()).toBe(77);
    expect(stara.exciseEur()).toBe(77);
  });

  test("конвертація в долари через курс євро", () => {
    const vm = createVm({
      eurUsd: 1.1566,
      customs: {
        ...base,
        engineType: window.engineType.Petrol,
        engineVolume: "2.0",
      },
    });
    expect(vm.exciseUsd()).toBeCloseTo(vm.exciseEur() * 1.1566, 5);
  });
});

describe("Мито і ПДВ", () => {
  test("ДВЗ — мито 10% від митної вартості", () => {
    const vm = createVm({ customs: { engineType: window.engineType.Petrol } });
    expect(vm.importDuty()).toBeCloseTo(vm.customsBase() * 0.1, 5);
  });

  test("електро — мито 0%", () => {
    const vm = createVm({
      customs: { engineType: window.engineType.Electric },
    });
    expect(vm.importDuty()).toBe(0);
  });

  test("ПДВ 20% від (вартість + мито + акциз)", () => {
    const vm = createVm();
    expect(vm.vatFee()).toBeCloseTo(
      (vm.customsBase() + vm.importDuty() + vm.exciseUsd()) * 0.2,
      5,
    );
  });

  test("електро не звільнене від ПДВ (нульова ставка скасована з 2026)", () => {
    const vm = createVm({
      customs: { engineType: window.engineType.Electric },
    });
    expect(vm.vatFee()).toBeGreaterThan(0);
  });

  test("totalCustomsFee = мито + акциз + ПДВ, без збору до ПФ", () => {
    const vm = createVm();
    expect(vm.totalCustomsFee()).toBe(
      Math.round(vm.importDuty() + vm.exciseUsd() + vm.vatFee()),
    );
    // ПФ рахується окремо в mreo() і додається в total() — тут його бути не має.
    expect(vm.totalCustomsFee()).toBeLessThan(vm.total());
  });
});

describe("Митна вартість", () => {
  test("= ціна + збір аукціону + доставка до кордону + страхування", () => {
    const vm = createVm();
    expect(vm.customsBase()).toBeCloseTo(
      vm.autoPricing.autoPrice +
        vm.auctionFee() +
        vm.totalShippingFee() +
        vm.strahovka(),
      5,
    );
  });

  test("дешевший маршрут → менша база → менше мито", () => {
    const odessa = createVm({
      autoShipping: { destinationPort: { selected: "odessa" } },
    });
    const klaipeda = createVm({
      autoShipping: { destinationPort: { selected: "klaipeda" } },
    });
    expect(klaipeda.totalShippingFee()).toBeLessThan(odessa.totalShippingFee());
    expect(klaipeda.importDuty()).toBeLessThan(odessa.importDuty());
  });
});

describe("Доставка", () => {
  test("totalShippingFee = сума рядків розкладу (UI і сума не розходяться)", () => {
    const vm = createVm();
    const sum = vm.shippingBreakdown().reduce((s, r) => s + r.amount, 0);
    expect(vm.totalShippingFee()).toBe(sum);
  });

  test("для Одеси немає плеча «порт → кордон»", () => {
    const vm = createVm({
      autoShipping: { destinationPort: { selected: "odessa" } },
    });
    expect(vm.toUkraineFee()).toBe(0);
    expect(vm.shippingBreakdown().some((r) => r.key === "toUkraine")).toBe(
      false,
    );
  });

  test("для Клайпеди плече «порт → кордон» присутнє окремим рядком", () => {
    const vm = createVm({
      autoShipping: { destinationPort: { selected: "klaipeda" } },
    });
    expect(vm.toUkraineFee()).toBeGreaterThan(0);
    expect(vm.shippingBreakdown().some((r) => r.key === "toUkraine")).toBe(
      true,
    );
  });
});

describe("Підсумок", () => {
  test("total() — число, а не NaN, для дефолтного стану", () => {
    const vm = createVm();
    expect(Number.isFinite(vm.total())).toBe(true);
    expect(vm.total()).toBeGreaterThan(vm.autoPricing.autoPrice);
  });

  test("зростає монотонно з ціною авто", () => {
    const cheap = createVm({ autoPricing: { autoPrice: 5000 } });
    const dear = createVm({ autoPricing: { autoPrice: 25000 } });
    expect(dear.total()).toBeGreaterThan(cheap.total());
  });

  test("benefit = чиста вартість − повні витрати", () => {
    const vm = createVm({ acv: 30000, repairCost: 4000 });
    expect(vm.cleanValue()).toBe(26000);
    expect(vm.benefit()).toBe(26000 - vm.total());
  });

  test("maxBid — ставка, за якої ПОВНІ витрати вкладаються в ліміт", () => {
    const vm = createVm({ acv: 30000, repairCost: 4000, riskCoefficient: 0.5 });
    const limit = vm.cleanValue() * vm.riskCoefficient;

    expect(vm.totalForPrice(vm.maxBid())).toBeLessThanOrEqual(limit);
    // І це саме МАКСИМУМ: на долар більше — вже за межею.
    expect(vm.totalForPrice(vm.maxBid() + 1)).toBeGreaterThan(limit);
  });

  test("maxBid віднімає супутні витрати, а не ігнорує їх", () => {
    const vm = createVm({ acv: 30000, repairCost: 4000, riskCoefficient: 0.5 });
    // Стара формула повертала (ACV − ремонт) × коефіцієнт = 13000, тобто
    // ставку, за якої підсумок удвічі перевищує власний ліміт.
    expect(vm.maxBid()).toBeLessThan(13000);
    expect(vm.totalForPrice(13000)).toBeGreaterThan(13000);
  });

  test("maxBid = 0, коли витрати з'їдають ліміт навіть за нульової ставки", () => {
    const vm = createVm({ acv: 8000, repairCost: 3000, riskCoefficient: 0.5 });
    expect(vm.maxBid()).toBe(0);
  });

  test("maxBid зростає з ACV і з коефіцієнтом ризику", () => {
    const base = createVm({
      acv: 30000,
      repairCost: 4000,
      riskCoefficient: 0.5,
    });
    const richer = createVm({
      acv: 40000,
      repairCost: 4000,
      riskCoefficient: 0.5,
    });
    const bolder = createVm({
      acv: 30000,
      repairCost: 4000,
      riskCoefficient: 0.8,
    });
    expect(richer.maxBid()).toBeGreaterThan(base.maxBid());
    expect(bolder.maxBid()).toBeGreaterThan(base.maxBid());
  });

  test("totalForPrice не чіпає реальний стан", () => {
    const vm = createVm({ autoPricing: { autoPrice: 7000 } });
    const before = vm.total();
    vm.totalForPrice(50000);
    expect(vm.autoPricing.autoPrice).toBe(7000);
    expect(vm.total()).toBe(before);
  });

  test("totalForPrice не пише в реактивний стан через сеттер", () => {
    // Vue визначає поля data аксесорами, а не простими значеннями. Наївне
    // `Object.create(pricing).autoPrice = price` викликає УСПАДКОВАНИЙ сеттер
    // і мутує справжній стан під час рендеру — сторінка вішається в циклі.
    const vm = createVm({ autoPricing: { autoPrice: 7000 } });
    let stored = vm.autoPricing.autoPrice;
    let writes = 0;
    Object.defineProperty(vm.autoPricing, "autoPrice", {
      get: () => stored,
      set: (v) => {
        writes += 1;
        stored = v;
      },
      configurable: true,
      enumerable: true,
    });

    vm.totalForPrice(50000);
    vm.maxBid();

    expect(writes).toBe(0);
    expect(vm.autoPricing.autoPrice).toBe(7000);
  });

  test("totalForPrice не підміняє сам autoPricing через сеттер інстансу", () => {
    // Той самий капкан рівнем вище: Vue проксіює ключі data на інстанс теж
    // аксесорами, тож `probe.autoPricing = ...` замінив би autoPricing у vm.
    const vm = createVm({ autoPricing: { autoPrice: 7000 } });
    const real = vm.autoPricing;
    let writes = 0;
    Object.defineProperty(vm, "autoPricing", {
      get: () => real,
      set: () => {
        writes += 1;
      },
      configurable: true,
      enumerable: true,
    });

    vm.totalForPrice(50000);
    vm.maxBid();

    expect(writes).toBe(0);
    expect(vm.autoPricing).toBe(real);
    expect(vm.autoPricing.autoPrice).toBe(7000);
  });
});

describe("filteredLocations (computed)", () => {
  test("локації Copart не показуються при вибраному IAAI і навпаки", () => {
    const copart = createVm({
      autoPricing: { auctions: { selected: "copart" } },
    });
    const iaai = createVm({ autoPricing: { auctions: { selected: "iaai" } } });

    expect(
      copart.filteredLocations.every(
        (l) => l.name.toLowerCase().indexOf("(iaai)") === -1,
      ),
    ).toBe(true);
    expect(
      iaai.filteredLocations.every(
        (l) => l.name.toLowerCase().indexOf("(copart)") === -1,
      ),
    ).toBe(true);
  });

  test("текстовий пошук звужує список", () => {
    const vm = createVm({ locationSearch: "birmingham" });
    const all = createVm({ locationSearch: "" });
    expect(vm.filteredLocations.length).toBeGreaterThan(0);
    expect(vm.filteredLocations.length).toBeLessThan(
      all.filteredLocations.length,
    );
    expect(
      vm.filteredLocations.every(
        (l) => l.name.toLowerCase().indexOf("birmingham") !== -1,
      ),
    ).toBe(true);
  });
});

describe("Збір до Пенсійного фонду", () => {
  // Пороги — 165 / 290 прожиткових мінімумів, у гривнях.
  // Див. docs/pension-fee-baseline.md.
  const withBaseUah = (uah) => {
    const vm = createVm();
    // Підбираємо ціну так, щоб митна вартість у гривнях була приблизно uah.
    const probe = createVm({ autoPricing: { autoPrice: 10000 } });
    const overhead = probe.customsBase() - probe.autoPricing.autoPrice;
    vm.autoPricing.autoPrice = Math.max(
      1000,
      Math.round(uah / vm.usdUah - overhead),
    );
    return vm;
  };

  test("ставка 3% нижче 165 прожиткових мінімумів", () => {
    const vm = withBaseUah(165 * 3328 * 0.7);
    expect(vm.pensionFeeRate()).toBe(0.03);
  });

  test("ставка 4% між 165 і 290 прожиткових мінімумів", () => {
    const vm = withBaseUah(165 * 3328 * 1.2);
    expect(vm.pensionFeeRate()).toBe(0.04);
  });

  test("ставка 5% вище 290 прожиткових мінімумів", () => {
    const vm = withBaseUah(290 * 3328 * 1.5);
    expect(vm.pensionFeeRate()).toBe(0.05);
  });

  test("пороги рухаються разом із прожитковим мінімумом", () => {
    const vm = withBaseUah(165 * 3328 * 1.2);
    expect(vm.pensionFeeRate()).toBe(0.04);
    vm.subsistenceMinUah = 3328 * 2; // умовне подвоєння ПМ
    expect(vm.pensionFeeRate()).toBe(0.03);
  });

  test("база — митна вартість, та сама, що й для мита", () => {
    const vm = createVm();
    expect(vm.mreo()).toBe(Math.ceil(vm.customsBase() * vm.pensionFeeRate()));
  });

  test("електромобілі звільнені від збору", () => {
    const vm = createVm({
      customs: { engineType: window.engineType.Electric, batteryKwh: 77 },
    });
    expect(vm.mreo()).toBe(0);
  });

  test("ДВЗ збір платить", () => {
    const vm = createVm({ customs: { engineType: window.engineType.Petrol } });
    expect(vm.mreo()).toBeGreaterThan(0);
  });
});
