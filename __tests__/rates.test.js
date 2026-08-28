/**
 * Курси НБУ: за ними рахується акциз (у ПКУ він у євро) і пороги пенсійного
 * збору (вони в гривнях), тож питання «звідки цей курс» — не косметичне.
 *
 * До 2026-08-28 протухлий кеш просто викидався, і при недоступному НБУ
 * калькулятор мовчки повертався на захардкоджені 1.1 / 44.7 — тобто на зріз
 * із коміту, який завжди старіший за будь-який кеш.
 */
const { createVm, loadModules } = require("./helpers/load-calculator");

loadModules();

const DAY = 24 * 60 * 60 * 1000;
const NBU_OK = [
  { cc: "USD", rate: 41.5 },
  { cc: "EUR", rate: 48.4 },
];

function seedCache(ageMs) {
  localStorage.setItem(
    "nbu_rates_cache_v2",
    JSON.stringify({ eurUsd: 1.2, usdUah: 40, ts: Date.now() - ageMs }),
  );
}

describe("initNbuRate", () => {
  let warn;

  beforeEach(() => {
    localStorage.clear();
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    delete global.fetch;
  });

  it("свіжий кеш не витрачає запит до НБУ", async () => {
    seedCache(1000);
    global.fetch = jest.fn();
    const vm = createVm();

    expect(await window.createRatesService().initNbuRate(vm)).toBe("nbu");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(vm.usdUah).toBe(40);
    expect(vm.ratesSource).toBe("nbu");
  });

  it("свіжа відповідь НБУ лягає і в стан, і в кеш", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ json: () => Promise.resolve(NBU_OK) }),
    );
    const vm = createVm();

    expect(await window.createRatesService().initNbuRate(vm)).toBe("nbu");
    expect(vm.usdUah).toBe(41.5);
    expect(vm.eurUsd).toBe(1.1663); // 48.4 / 41.5
    expect(vm.ratesSource).toBe("nbu");
    expect(JSON.parse(localStorage.getItem("nbu_rates_cache_v2")).usdUah).toBe(
      41.5,
    );
  });

  it("НБУ впав, але кеш протух — беремо кеш, а не дефолти", async () => {
    seedCache(3 * DAY);
    global.fetch = jest.fn(() => Promise.reject(new Error("offline")));
    const vm = createVm();
    const defaults = { eurUsd: vm.eurUsd, usdUah: vm.usdUah };

    expect(await window.createRatesService().initNbuRate(vm)).toBe("stale");
    expect(vm.usdUah).toBe(40);
    expect(vm.usdUah).not.toBe(defaults.usdUah);
    expect(vm.ratesSource).toBe("stale");
    // Дата зрізу — це дата кешу, а не сьогодні.
    expect(vm.ratesAsOf).toBe(
      new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10),
    );
  });

  it("НБУ впав і кешу немає — лишаємось на дефолтах і кажемо це", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("offline")));
    const vm = createVm();

    expect(await window.createRatesService().initNbuRate(vm)).toBe("default");
    expect(vm.usdUah).toBe(44.7);
    expect(vm.ratesSource).toBe("default");
    expect(vm.ratesNote()).toMatch(/за замовчуванням/);
    expect(vm.ratesNote()).toContain(vm.ratesAsOf);
  });

  it("відповідь без USD/EUR — не курс, а порожній масив", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([]) }),
    );
    const vm = createVm();

    expect(await window.createRatesService().initNbuRate(vm)).toBe("default");
    expect(vm.usdUah).toBe(44.7);
  });

  it("зі свіжим курсом підпис зникає", () => {
    const vm = createVm({ ratesSource: "nbu" });
    expect(vm.ratesNote()).toBe("");
  });
});
