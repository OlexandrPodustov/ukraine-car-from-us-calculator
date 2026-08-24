"use strict";
/**
 * Landed-вартість перепродажу: скільки коштувало привезти сюди авто, яке
 * реально відійшло з молотка за `soldPrice`.
 *
 * Жодної власної математики тут немає. Дані saleshistory перекладаються у ту
 * саму форму, яку віддає IAAI (`inventoryView.attributes` + `saleInformation`),
 * і проганяються через справжній `applyLotJson()` з market.methods.js — тобто
 * рік, тип палива, об'єм, локація й порт визначаються тим самим кодом, що і в
 * браузері. Далі `totalForPrice(soldPrice)`.
 *
 * Через це фікс у парсері чи в ставках автоматично доїжджає і сюди; другої
 * копії мапінгу, яка мовчки розійдеться, не існує.
 */
const path = require("node:path");

let appVmPromise = null;
function appVm() {
  if (!appVmPromise) {
    appVmPromise = import(
      "file://" + path.join(__dirname, "..", "scripts", "lib", "app-vm.mjs")
    );
  }
  return appVmPromise;
}

/** «CA - VAN NUYS VAN NUYS (91405 1509)» → «VAN NUYS» (без дублів слів). */
function branchName(location, state) {
  var raw = String(location || "")
    .replace(/\(.*$/, "")
    .trim();
  if (state) raw = raw.replace(new RegExp("^" + state + "\\s*-\\s*"), "");
  var seen = {};
  return raw
    .split(/\s+/)
    .filter(function (w) {
      if (!w || seen[w.toUpperCase()]) return false;
      seen[w.toUpperCase()] = true;
      return true;
    })
    .join(" ");
}

/**
 * Історія з saleshistory → дерево, яке розуміє applyLotJson.
 *
 * `state` — ручне перекриття штату. Потрібне тому, що в частини лотів у полі
 * Location немає коду штату взагалі («Dream Rides Westchester»), а без штату
 * `matchAuctionLocation` не матчить нічого і наземне плече рахується від
 * першої локації довідника — тобто від випадкового штату.
 */
function toLotJson(history, state) {
  const h = history || {};
  const stateCode = String(state || h.locationState || "")
    .trim()
    .toUpperCase();
  const branch = branchName(h.location, stateCode);
  const engine = String(h.engine || "");
  const displ = /([0-9]+(?:\.[0-9])?)\s*L/i.exec(engine);
  return {
    inventoryView: {
      attributes: {
        Year: h.year ? String(h.year) : " ",
        Make: h.make || " ",
        Model: h.model || " ",
        FuelTypeCode: h.fuel || " ",
        FuelTypeDesc: h.fuel || " ",
        DisplLiters: displ ? displ[1] + "L" : " ",
        EngineSize: engine || " ",
        TransmissionDesc: h.transmission || " ",
        ExteriorColor: h.color || " ",
        DriveLineTypeDesc: h.drive || " ",
        PrimaryDamageDesc: h.primaryDamage || " ",
        SecondaryDamageDesc: h.secondaryDamage || " ",
        KeysPresent: h.keys || " ",
        ODOValue: h.odometer ? String(h.odometer) : " ",
        ODOUoM: "mi",
        OdometerBrand: h.odometerBrand || " ",
        State: stateCode || " ",
        BranchState: stateCode || " ",
        BranchName: branch || " ",
        City: branch || " ",
        Zip: h.locationZip || " ",
        SalvageId: h.lotNumber ? String(h.lotNumber) : " ",
        VIN: h.vin || " ",
      },
      saleInformation: {
        $values: [
          { key: "ActualCashValue", value: h.acv ? "$" + h.acv : "" },
          {
            key: "EstimatedRepairCost",
            value: h.usRepairCost ? "$" + h.usRepairCost : "",
          },
        ],
      },
    },
  };
}

/**
 * Рахує landed для реальної ставки.
 *
 * `overrides` — те, чого saleshistory не віддає взагалі: тип кузова (впливає
 * на надбавку за габарит) і порт призначення. Мовчки вгадувати їх з назви
 * моделі не можна — цифра виглядатиме так само впевнено, як зматчена.
 */
async function computeLanded(history, soldPrice, overrides) {
  const mod = await appVm();
  const win = mod.sharedCalculator();
  const opts = overrides || {};
  const auction = history && history.auction === "copart" ? "copart" : "iaai";

  const nd = toLotJson(history, opts.state);
  const attrs = nd.inventoryView.attributes;

  const vm = mod.createVm(win, {
    autoPricing: { auctions: { selected: auction } },
  });
  // Розрахунок не має ходити в мережу: applyLotJson у кінці смикає пошук ціни
  // на AUTO.RIA, а він на годинному ліміті. Тут він не потрібен взагалі.
  vm.maybeLookupUkrainianPrice = function () {};
  vm.logLot = function () {
    return null;
  };
  vm.saveToLocalStorage = function () {};

  // Чи знайшлась локація ВЗАГАЛІ — питання окреме від того, наскільки точно
  // вона знайшлась. Без коду штату applyLotJson лишає локацію дефолтною
  // (перша в довіднику), і наземне плече мовчки рахується від чужого штату.
  const matched = vm.matchAuctionLocation(attrs);
  vm.applyLotJson(nd, "", { save: false });
  // applyLotJson відкладає onLocationChange() на $nextTick; у нашому vm він
  // синхронний, але порт міг лишитись дефолтним, якщо локація не зматчилась.
  vm.onLocationChange();

  if (opts.vehicleType) vm.autoShipping.vehicleType = opts.vehicleType;
  if (opts.destinationPort)
    vm.autoShipping.destinationPort.selected = opts.destinationPort;
  if (opts.riskCoefficient) vm.riskCoefficient = opts.riskCoefficient;
  if (opts.usdUah) vm.usdUah = opts.usdUah;
  if (opts.eurUsd) vm.eurUsd = opts.eurUsd;

  const price = Math.round(Number(soldPrice) || 0);
  const landed = price > 0 ? vm.totalForPrice(price) : null;

  const loc = vm.getCurrentLocation();
  return {
    landedCost: landed,
    auction: auction,
    // Локації не знайшлось — назву дефолтної не віддаємо взагалі, щоб її не
    // прийняли за зматчену. Сама сума лишається (ставка й ціна в Україні
    // реальні, спостереження втрачати шкода), але позначена як оцінка.
    locationMatched: matched ? 1 : 0,
    matchedLocation: matched ? loc.name : null,
    fallbackLocation: matched ? null : loc ? loc.name : null,
    inlandUsFee: vm.inlandUsFee(),
    // Локація підібрана лише за штатом — наземне плече в межах штату
    // різниться до $375, тож слабкий збіг має бути видимим.
    locationWeak: matched ? vm.locationMatchIsWeak(attrs, loc) : true,
    departurePort: vm.autoShipping.shippingPort || null,
    destinationPort: vm.autoShipping.destinationPort.selected || null,
    vehicleType: vm.autoShipping.vehicleType || null,
    riskCoefficient: vm.riskCoefficient,
    engineType: vm.customs.engineType,
    engineVolume: vm.customs.engineVolume,
    manufactureYear: vm.customs.manufactureYear,
    usdUah: vm.usdUah,
    eurUsd: vm.eurUsd,
    breakdown: {
      auctionFee: vm.auctionFee(),
      shipping: vm.shippingBreakdown(),
      customs: vm.customsBreakdown(),
      fixedFees: vm.fixedFees,
      fixedFeesTotal: vm.fixedFeesTotal(),
      commissionBank: vm.commissionBank(),
      anzFee: vm.anzFee(),
      strahovka: vm.strahovka(),
      mreo: vm.mreo(),
    },
    // Стеля, яку порадив би калькулятор під ту саму ринкову ціну — з нею
    // порівнюється реальна ставка (блок калібрування на resales.html).
    maxBidForMarket: opts.marketPrice
      ? (function () {
          vm.customs.ukrainianMarketPrice = Math.round(opts.marketPrice);
          return vm.maxBidForMarket();
        })()
      : null,
  };
}

module.exports = { computeLanded, toLotJson, branchName };
