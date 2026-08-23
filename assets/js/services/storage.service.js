// Персистенція стану калькулятора в localStorage.
//
// Ключове правило: зберігається ВИБІР користувача (ідентифікатори, суми,
// тексти), а не довідники. Довідники — список локацій із ставками `toPort`,
// порти, ставки фрахту, перелік років і об'ємів двигуна — живуть у
// assets/js/constants/ і мають оновлюватись разом із кодом.
//
// До версії 2 сюди писались цілі об'єкти `autoPricing` / `autoShipping` /
// `customs` разом із їхніми `options`. Наслідки були два:
//   1. ~62 КБ JSON на кожну зміну поля (з них ~61 КБ — таблиця з 354 локацій),
//      бо watcher'и викликають save на кожен keystroke;
//   2. при відновленні `Object.assign` затирав свіжі довідники збереженою
//      копією — тобто оновлені ставки доставки НІКОЛИ не доїжджали до
//      користувача, який уже колись відкривав калькулятор.

var STORAGE_KEY = "carCalcData";
var STORAGE_VERSION = 2;

window.createStorageService = function () {
  return {
    load: function () {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    save: function (data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
  };
};

// Зріз стану, який має пережити перезавантаження сторінки.
window.pickPersistedState = function (vm) {
  return {
    v: STORAGE_VERSION,
    autoPrice: vm.autoPricing.autoPrice,
    auction: vm.autoPricing.auctions.selected,
    location: vm.autoShipping.location.selected,
    shippingPort: vm.autoShipping.shippingPort,
    shippingPortManual: vm.autoShipping.shippingPortManual,
    destinationPort: vm.autoShipping.destinationPort.selected,
    vehicleType: vm.autoShipping.vehicleType,
    customs: {
      engineVolume: vm.customs.engineVolume,
      manufactureYear: vm.customs.manufactureYear,
      engineType: vm.customs.engineType,
      batteryKwh: vm.customs.batteryKwh,
      ukrainianMarketPrice: vm.customs.ukrainianMarketPrice,
      marketCategory: vm.customs.marketCategory,
      carrierInfo: vm.customs.carrierInfo,
    },
    locationSearch: vm.locationSearch,
    auctionUrl: vm.auctionUrl,
    auctionStatus: vm.auctionStatus,
    auctionMsg: vm.auctionMsg,
    // Разом з auctionMsg — щоб після перезавантаження сторінки VIN лоту
    // не зникав із шапки.
    currentLot: vm.currentLot,
    lotCondition: vm.lotCondition,
    acv: vm.acv,
    repairCost: vm.repairCost,
    buyNowPrice: vm.buyNowPrice,
    riskCoefficient: vm.riskCoefficient,
    oceanFreightOverride: vm.oceanFreightOverride,
    marketStatus: vm.marketStatus,
    marketMsg: vm.marketMsg,
    marketTarget: vm.marketTarget,
  };
};

// Старий (до v2) формат — те, що зараз лежить у браузерах усіх, хто вже
// користувався калькулятором. Зводимо до плоского вигляду v2, ігноруючи
// вкладені `options`.
function migrateLegacy(saved) {
  var pricing = saved.autoPricing || {};
  var shipping = saved.autoShipping || {};
  var customs = saved.customs || {};
  return {
    v: STORAGE_VERSION,
    autoPrice: pricing.autoPrice,
    auction: (pricing.auctions || {}).selected,
    location: (shipping.location || {}).selected,
    shippingPort: shipping.shippingPort,
    shippingPortManual: shipping.shippingPortManual,
    destinationPort: (shipping.destinationPort || {}).selected,
    vehicleType: shipping.vehicleType,
    customs: {
      engineVolume: customs.engineVolume,
      manufactureYear: customs.manufactureYear,
      engineType: customs.engineType,
      batteryKwh: customs.batteryKwh,
      // До v2 ціну писали і в customs, і в корінь — беремо будь-яку наявну.
      ukrainianMarketPrice:
        customs.ukrainianMarketPrice != null
          ? customs.ukrainianMarketPrice
          : saved.ukrainianMarketPrice,
      marketCategory: customs.marketCategory || saved.marketCategory,
      carrierInfo: customs.carrierInfo,
    },
    locationSearch: saved.locationSearch,
    auctionUrl: saved.auctionUrl,
    auctionStatus: saved.auctionStatus,
    auctionMsg: saved.auctionMsg,
    currentLot: saved.currentLot,
    lotCondition: saved.lotCondition,
    acv: saved.acv,
    repairCost: saved.repairCost,
    buyNowPrice: saved.buyNowPrice,
    riskCoefficient: saved.riskCoefficient,
    oceanFreightOverride: saved.oceanFreightOverride,
    marketStatus: saved.marketStatus,
    marketMsg: saved.marketMsg,
    marketTarget: saved.marketTarget,
  };
}

window.normalizePersistedState = function (saved) {
  if (!saved || typeof saved !== "object") return null;
  return saved.v >= STORAGE_VERSION ? saved : migrateLegacy(saved);
};

function hasId(list, id) {
  return !!(
    id &&
    list &&
    list.some(function (item) {
      return item.id === id;
    })
  );
}

function isNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Накладає збережений стан на свіжий `vm`. Кожен ідентифікатор звіряється з
 * поточними довідниками: якщо локацію прибрали зі списку або перейменували id,
 * лишається дефолт, а не «висяча» позиція, через яку розрахунок дає NaN.
 */
window.applyPersistedState = function (vm, rawSaved) {
  var saved = window.normalizePersistedState(rawSaved);
  if (!saved) return false;

  if (isNum(saved.autoPrice)) vm.autoPricing.autoPrice = saved.autoPrice;
  if (hasId(window.auctions, saved.auction))
    vm.autoPricing.auctions.selected = saved.auction;
  if (hasId(window.autoLocation, saved.location))
    vm.autoShipping.location.selected = saved.location;
  if (hasId(window.shippingPorts, saved.shippingPort))
    vm.autoShipping.shippingPort = saved.shippingPort;
  vm.autoShipping.shippingPortManual = saved.shippingPortManual === true;
  if (hasId(window.destinationPorts, saved.destinationPort))
    vm.autoShipping.destinationPort.selected = saved.destinationPort;
  if (hasId(window.vehicleTypes, saved.vehicleType))
    vm.autoShipping.vehicleType = saved.vehicleType;

  var customs = saved.customs || {};
  var knownEngines = Object.keys(window.engineType).map(function (k) {
    return window.engineType[k];
  });
  if (customs.engineVolume) vm.customs.engineVolume = customs.engineVolume;
  if (isNum(customs.manufactureYear))
    vm.customs.manufactureYear = customs.manufactureYear;
  if (knownEngines.indexOf(customs.engineType) !== -1)
    vm.customs.engineType = customs.engineType;
  if (isNum(customs.batteryKwh)) vm.customs.batteryKwh = customs.batteryKwh;
  if (isNum(customs.ukrainianMarketPrice))
    vm.customs.ukrainianMarketPrice = customs.ukrainianMarketPrice;
  if (customs.marketCategory)
    vm.customs.marketCategory = customs.marketCategory;
  if (customs.carrierInfo)
    Object.assign(vm.customs.carrierInfo, customs.carrierInfo);

  [
    "locationSearch",
    "auctionUrl",
    "auctionStatus",
    "auctionMsg",
    "marketStatus",
    "marketMsg",
    "marketTarget",
  ].forEach(function (key) {
    if (typeof saved[key] === "string") vm[key] = saved[key];
  });
  // «loading» пережити перезавантаження не має права: кнопка «Заповнити»
  // вимкнена саме цим статусом, а парсинг, який його поставив, не переживе
  // релоад — сторінка відкривалась із назавжди заблокованою кнопкою.
  ["auctionStatus", "marketStatus"].forEach(function (key) {
    if (vm[key] === "loading") {
      vm[key] = "";
      vm[key === "auctionStatus" ? "auctionMsg" : "marketMsg"] = "";
    }
  });
  [
    "acv",
    "repairCost",
    "buyNowPrice",
    "riskCoefficient",
    "oceanFreightOverride",
  ].forEach(function (key) {
    if (isNum(saved[key])) vm[key] = saved[key];
  });
  if (saved.currentLot) Object.assign(vm.currentLot, saved.currentLot);
  if (saved.lotCondition) Object.assign(vm.lotCondition, saved.lotCondition);

  return true;
};

export const createStorageService = window.createStorageService;
export const pickPersistedState = window.pickPersistedState;
export const applyPersistedState = window.applyPersistedState;
export const normalizePersistedState = window.normalizePersistedState;
