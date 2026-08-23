/**
 * Пошук ринкової ціни на AUTO.RIA: що потрапляє в БД і що — в кеш.
 * Безкоштовний тариф API лімітований погодинно, тож кеш обов'язковий; але
 * кеш не має «ковтати» подію пошуку — інакше другий лот тієї самої моделі
 * лишається в БД без жодної оцінки.
 */
const { createVm } = require("./helpers/load-calculator");

function marketVm(overrides) {
  const vm = createVm(
    Object.assign(
      {
        customs: {
          carrierInfo: { make: "BMW", model: "M340I", mileage: 40000 },
          manufactureYear: 2020,
          engineType: "petrol",
          engineVolume: "3.0",
        },
      },
      overrides || {},
    ),
  );
  vm.riaApiKey = () => "test-key";
  vm.saveToLocalStorage = () => {};
  return vm;
}

describe("влучання в кеш ринкової ціни", () => {
  beforeEach(() => localStorage.clear());

  it("теж записує пошук у БД — інакше лот лишається без плашки угоди", async () => {
    const vm = marketVm();
    vm.currentLot = { auction: "iaai", lotNumber: "12345678", vin: "X" };
    const logged = [];
    vm.logSearch = (p) => {
      logged.push(p);
      return Promise.resolve(true);
    };
    vm.riaFetchJson = () => {
      throw new Error("не має бути звернення до API при влучанні в кеш");
    };

    const target = vm.normalizeMarketTarget();
    vm.writeMarketCache(vm.getMarketCacheKey(target), {
      ts: Date.now(),
      medianPrice: 31000,
      sampleCount: 12,
      marketCategory: "underpriced",
      markaId: 9,
      modelId: 77,
      modelMatched: true,
      prices: [29000, 31000, 33000],
      percentiles: { "50.0": 31000 },
      filtersApplied: ["3 Series", "бензин"],
    });

    await vm.lookupUkrainianPrice();

    expect(vm.marketStatus).toBe("ok");
    expect(vm.customs.ukrainianMarketPrice).toBe(31000);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      auction: "iaai",
      lotNumber: "12345678",
      marketPrice: 31000,
      sampleCount: 12,
      markaId: 9,
      modelId: 77,
    });
    // Розподіл теж переживає кеш — без нього stats.html малює порожньо.
    expect(logged[0].prices).toEqual([29000, 31000, 33000]);
    expect(logged[0].filtersApplied).toContain("кеш");
  });

  it("рядок з кешу несе той самий кошт із ремонтом, що й свіжий", async () => {
    const vm = marketVm({ repairCost: 4000 });
    vm.currentLot = { auction: "iaai", lotNumber: "1", vin: "" };
    let payload = null;
    vm.logSearch = (p) => {
      payload = p;
      return Promise.resolve(true);
    };
    vm.writeMarketCache(vm.getMarketCacheKey(vm.normalizeMarketTarget()), {
      ts: Date.now(),
      medianPrice: 40000,
      sampleCount: 7,
      marketCategory: "underpriced",
    });

    await vm.lookupUkrainianPrice();

    expect(payload.totalCost).toBe(vm.total());
    expect(payload.repairCost).toBe(4000);
    expect(payload.diff).toBe(40000 - vm.total() - 4000);
  });
});

describe("свіжий пошук", () => {
  beforeEach(() => localStorage.clear());

  it("кладе розподіл у кеш, щоб наступний лот не бив по API", async () => {
    const vm = marketVm();
    vm.currentLot = { auction: "iaai", lotNumber: "2", vin: "" };
    vm.logSearch = () => Promise.resolve(true);
    vm.getRiaMarks = async () => [{ value: 9, name: "BMW" }];
    vm.getRiaModels = async () => [{ value: 77, name: "3 Series" }];
    vm.getRiaFuels = async () => [{ value: 1, name: "Бензин" }];
    vm.getRiaGearboxes = async () => [];
    vm.riaFetchJson = async () => ({
      total: 11,
      interQuartileMean: 30500,
      arithmeticMean: 31000,
      percentiles: { "50.0": 30000 },
      prices: [28000, 30000, 32000],
      classifieds: [1, 2, 3],
    });

    await vm.lookupUkrainianPrice();

    const cached = vm.readMarketCache(
      vm.getMarketCacheKey(vm.normalizeMarketTarget()),
    );
    expect(cached.medianPrice).toBe(30500);
    expect(cached.prices).toEqual([28000, 30000, 32000]);
    expect(cached.percentiles).toEqual({ "50.0": 30000 });
    // Оголошення — найважча частина відповіді і для графіка не потрібні.
    expect(cached.classifieds).toBeUndefined();
  });
});
