/**
 * Посилання на сторінку лоту в lots.html («↗ Сторінка лоту»).
 *
 * Реальний баг: парсинг асинхронний (проксі відповідає до 13 с), а payload для
 * БД брав `vm.auctionUrl` уже після await. Якщо за цей час у поле вставляли
 * інший текст (а вставка ще й перезапускала парсинг), у колонку url летів той
 * текст — у БД так і лежав скопійований блок «Ціна на українському ринку …»
 * замість URL, і кнопка ставала битим відносним лінком.
 */
const { createVm } = require("./helpers/load-calculator");
const LOT = require("./fixtures/iaai-lot-46380419.json");

const LOT_URL = "https://www.iaai.com/VehicleDetail/46380419~US";

function iaaiVm(overrides) {
  const vm = createVm(overrides);
  vm.autoPricing.auctions.selected = "iaai";
  return vm;
}

function collect(vm, lotUrl) {
  const attrs = LOT.inventoryView.attributes;
  const saleValues = LOT.inventoryView.saleInformation.$values;
  return vm.collectLotData(LOT, attrs, saleValues, lotUrl);
}

describe("sanitizeLotUrl", () => {
  const vm = createVm();

  it("пропускає http(s)-посилання", () => {
    expect(vm.sanitizeLotUrl(LOT_URL)).toBe(LOT_URL);
    expect(vm.sanitizeLotUrl("  " + LOT_URL + " ")).toBe(LOT_URL);
    expect(vm.sanitizeLotUrl("http://www.copart.com/lot/123456")).toBe(
      "http://www.copart.com/lot/123456",
    );
  });

  it("відкидає скопійований текст сторінки та порожні значення", () => {
    expect(vm.sanitizeLotUrl("Ціна на українському ринку 🔍 Шукати")).toBe("");
    expect(vm.sanitizeLotUrl("www.iaai.com/VehicleDetail/1~US")).toBe("");
    expect(vm.sanitizeLotUrl("")).toBe("");
    expect(vm.sanitizeLotUrl(null)).toBe("");
    expect(vm.sanitizeLotUrl(undefined)).toBe("");
  });

  it("відкидає javascript: та інші схеми", () => {
    expect(vm.sanitizeLotUrl("javascript:alert(1)")).toBe("");
    expect(vm.sanitizeLotUrl("data:text/html,<b>x</b>")).toBe("");
  });
});

describe("canonicalLotUrl", () => {
  const vm = createVm();

  it("збирає посилання з аукціону та номера лоту", () => {
    expect(vm.canonicalLotUrl("iaai", "46380419")).toBe(LOT_URL);
    expect(vm.canonicalLotUrl("copart", "12345678")).toBe(
      "https://www.copart.com/lot/12345678",
    );
  });

  it("нічого не вигадує без валідного номера чи аукціону", () => {
    expect(vm.canonicalLotUrl("iaai", "")).toBe("");
    expect(vm.canonicalLotUrl("iaai", "abc")).toBe("");
    expect(vm.canonicalLotUrl("manheim", "46380419")).toBe("");
  });
});

describe("collectLotData — url", () => {
  it("бере URL, з якого реально парсили, а не поточне значення поля", () => {
    const vm = iaaiVm();
    vm.auctionUrl = "Ціна на українському ринку 🔍 Шукати ⚠ Мало даних";
    expect(collect(vm, LOT_URL).url).toBe(LOT_URL);
  });

  it("падає назад на канонічне посилання, якщо URL загубився зовсім", () => {
    const vm = iaaiVm();
    vm.auctionUrl = "";
    expect(collect(vm, "").url).toBe(LOT_URL);
  });

  it("ніколи не віддає не-URL", () => {
    const vm = iaaiVm();
    vm.auctionUrl = "не посилання";
    const data = collect(vm, "теж не посилання");
    expect(data.url === "" || /^https?:\/\//.test(data.url)).toBe(true);
  });

  it("витягує номер лоту (SalvageId), яким і будується посилання", () => {
    const vm = iaaiVm();
    expect(collect(vm, LOT_URL).lotNumber).toBe("46380419");
  });
});

describe("onAuctionUrlPaste", () => {
  it("запускає парсинг лише для посилання на підтриманий аукціон", () => {
    const vm = createVm();
    const spy = jest.fn();
    vm.parseAuctionLot = spy;

    vm.auctionUrl = "просто текст зі сторінки";
    vm.onAuctionUrlPaste();
    expect(spy).not.toHaveBeenCalled();

    vm.auctionUrl = "https://example.com/whatever";
    vm.onAuctionUrlPaste();
    expect(spy).not.toHaveBeenCalled();

    vm.auctionUrl = LOT_URL;
    vm.onAuctionUrlPaste();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("postToApi", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("мовчить, коли сервер прийняв запис", async () => {
    const vm = createVm();
    vm.dbMsg = "щось старе";
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 201 }));

    await expect(vm.logLot({ lotNumber: "1" })).resolves.toBe(true);
    expect(vm.dbMsg).toBe("");
  });

  it("каже, що лот не збережено, коли /api недоступний", async () => {
    const vm = createVm();
    global.fetch = jest.fn(() => Promise.reject(new Error("Failed to fetch")));

    await expect(vm.logLot({ lotNumber: "1" })).resolves.toBe(false);
    expect(vm.dbMsg).toMatch(/Лот не збережено в БД/);
    expect(vm.dbMsg).toMatch(/npm start/);
  });

  it("HTTP-помилка сервера теж не проходить непоміченою", async () => {
    const vm = createVm();
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 400 }));

    await expect(vm.logSearch({ make: "BMW" })).resolves.toBe(false);
    expect(vm.dbMsg).toMatch(/Пошук не збережено в БД \(HTTP 400\)/);
  });
});

describe("відновлення стану після перезавантаження", () => {
  it("не залишає статус «loading» від парсингу, обірваного релоадом", () => {
    const vm = createVm();
    vm.auctionStatus = "loading";
    vm.auctionMsg = "⏳ Завантаження сторінки лоту…";
    vm.marketStatus = "loading";
    vm.marketMsg = "⏳ Пошук…";

    const saved = JSON.parse(JSON.stringify(window.pickPersistedState(vm)));
    const restored = createVm();
    window.applyPersistedState(restored, saved);

    // Інакше кнопка «Заповнити» (:disabled на цьому статусі) лишалась мертвою.
    expect(restored.auctionStatus).toBe("");
    expect(restored.auctionMsg).toBe("");
    expect(restored.marketStatus).toBe("");
    expect(restored.marketMsg).toBe("");
  });

  it("нормальні статуси відновлюються як були", () => {
    const vm = createVm();
    vm.auctionStatus = "ok";
    vm.auctionMsg = "✅ рік 2012";

    const saved = JSON.parse(JSON.stringify(window.pickPersistedState(vm)));
    const restored = createVm();
    window.applyPersistedState(restored, saved);

    expect(restored.auctionStatus).toBe("ok");
    expect(restored.auctionMsg).toBe("✅ рік 2012");
  });
});
