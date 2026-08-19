/**
 * Персистенція стану: що саме доживає до наступної сесії, а що мусить
 * підтягуватись зі свіжих довідників.
 */
const { createVm, loadModules } = require("./helpers/load-calculator");

loadModules();

describe("pickPersistedState", () => {
  test("не тягне в сховище довідники", () => {
    const vm = createVm();
    const saved = window.pickPersistedState(vm);
    const json = JSON.stringify(saved);

    expect(json).not.toContain("toPort");
    expect(json).not.toContain("manYearOptions");
    expect(json).not.toContain("engineVolumeOpts");
    expect(json).not.toContain("options");
  });

  test("зріз лишається компактним (довідник локацій важив ~61 КБ)", () => {
    const vm = createVm();
    expect(JSON.stringify(window.pickPersistedState(vm)).length).toBeLessThan(
      2000,
    );
  });

  test("зберігає вибір користувача", () => {
    const vm = createVm({
      autoPricing: { autoPrice: 12345, auctions: { selected: "iaai" } },
      autoShipping: { destinationPort: { selected: "klaipeda" } },
      acv: 30000,
      repairCost: 4000,
    });
    const saved = window.pickPersistedState(vm);

    expect(saved.autoPrice).toBe(12345);
    expect(saved.auction).toBe("iaai");
    expect(saved.destinationPort).toBe("klaipeda");
    expect(saved.acv).toBe(30000);
    expect(saved.repairCost).toBe(4000);
  });
});

describe("applyPersistedState", () => {
  test("round-trip повертає той самий розрахунок", () => {
    const source = createVm({
      autoPricing: { autoPrice: 18000, auctions: { selected: "iaai" } },
      autoShipping: { destinationPort: { selected: "gdansk" } },
      customs: {
        engineType: window.engineType.Diesel,
        engineVolume: "3.0",
        manufactureYear: window.currentYear - 8,
      },
      acv: 30000,
      repairCost: 4000,
    });

    const restored = createVm();
    window.applyPersistedState(restored, window.pickPersistedState(source));

    expect(restored.total()).toBe(source.total());
    expect(restored.totalCustomsFee()).toBe(source.totalCustomsFee());
    expect(restored.benefit()).toBe(source.benefit());
  });

  test("свіжі ставки доставки не затираються збереженими", () => {
    // Головна причина переходу на v2: раніше сюди клався цілий
    // autoShipping.location.options, і Object.assign повертав стару таблицю.
    const vm = createVm();
    const currentRate = window.autoLocation[0].toPort;

    window.applyPersistedState(vm, {
      autoShipping: {
        location: {
          selected: window.autoLocation[0].id,
          options: [{ id: window.autoLocation[0].id, name: "stale", toPort: {} }],
        },
      },
    });

    expect(vm.autoShipping.location.options).toBe(window.autoLocation);
    expect(vm.autoShipping.location.options[0].toPort).toBe(currentRate);
  });

  test("невідомі ідентифікатори ігноруються, лишається дефолт", () => {
    const vm = createVm();
    const defaults = {
      auction: vm.autoPricing.auctions.selected,
      location: vm.autoShipping.location.selected,
      port: vm.autoShipping.shippingPort,
      dest: vm.autoShipping.destinationPort.selected,
    };

    window.applyPersistedState(vm, {
      v: 2,
      auction: "manheim",
      location: "location99999",
      shippingPort: "atlantis",
      destinationPort: "mariupol",
      vehicleType: "submarine",
      customs: { engineType: "steam" },
    });

    expect(vm.autoPricing.auctions.selected).toBe(defaults.auction);
    expect(vm.autoShipping.location.selected).toBe(defaults.location);
    expect(vm.autoShipping.shippingPort).toBe(defaults.port);
    expect(vm.autoShipping.destinationPort.selected).toBe(defaults.dest);
    expect(Number.isFinite(vm.total())).toBe(true);
  });

  test("порожній / зіпсований вхід не валить відновлення", () => {
    const vm = createVm();
    expect(window.applyPersistedState(vm, null)).toBe(false);
    expect(window.applyPersistedState(vm, "не об'єкт")).toBe(false);
    expect(Number.isFinite(vm.total())).toBe(true);
  });
});

describe("Міграція зі старого формату сховища", () => {
  // Саме це лежить у браузерах усіх, хто вже відкривав калькулятор.
  const legacy = {
    autoPricing: {
      autoPrice: 9500,
      auctions: { selected: "iaai", options: [{ id: "iaai", name: "IAAI" }] },
    },
    autoShipping: {
      location: { selected: "location2", options: [] },
      shippingPort: "new_york",
      destinationPort: { selected: "klaipeda", options: [] },
      vehicleType: "suv",
    },
    customs: {
      engineVolume: "2.5",
      manufactureYear: 2018,
      engineType: "diesel",
      batteryKwh: 77,
      engineVolumeOpts: ["0.6"],
      manYearOptions: [2021],
    },
    acv: 21000,
    repairCost: 3000,
    ukrainianMarketPrice: 17500,
    marketCategory: "fair",
    marketTarget: "bmw|x3|2018",
  };

  test("вибір переноситься, довідники — ні", () => {
    const vm = createVm();
    window.applyPersistedState(vm, legacy);

    expect(vm.autoPricing.autoPrice).toBe(9500);
    expect(vm.autoPricing.auctions.selected).toBe("iaai");
    expect(vm.autoShipping.location.selected).toBe("location2");
    expect(vm.autoShipping.destinationPort.selected).toBe("klaipeda");
    expect(vm.autoShipping.vehicleType).toBe("suv");
    expect(vm.customs.engineType).toBe("diesel");
    expect(vm.customs.manufactureYear).toBe(2018);
    expect(vm.acv).toBe(21000);

    // Довідники — з коду, не зі сховища.
    expect(vm.customs.manYearOptions).toBe(window.manYearOptions);
    expect(vm.customs.engineVolumeOpts).toBe(window.engineVolumes);
    expect(vm.autoPricing.auctions.options).toBe(window.auctions);
  });

  test("ринкова ціна з кореня старого зрізу не губиться", () => {
    const vm = createVm();
    window.applyPersistedState(vm, legacy);
    expect(vm.customs.ukrainianMarketPrice).toBe(17500);
    expect(vm.customs.marketCategory).toBe("fair");
  });

  test("зріз, записаний старим кодом, читається новим", () => {
    const vm = createVm();
    window.applyPersistedState(vm, legacy);
    const rewritten = window.pickPersistedState(vm);

    const again = createVm();
    window.applyPersistedState(again, rewritten);
    expect(again.total()).toBe(vm.total());
  });
});
