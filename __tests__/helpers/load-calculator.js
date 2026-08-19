/**
 * Завантажує РЕАЛЬНИЙ код калькулятора в jsdom так само, як це робить браузер:
 * ті самі файли, у тому самому порядку, що й `<script type="module">` в index.html.
 *
 * Раніше тести перевизначали `calculateCopartFee` та `mockVm` у себе всередині —
 * і встигли розійтися з джерелом (див. docs/auction-fees-baseline.md). Тепер
 * розійтися неможливо: тест бачить рівно ту функцію, що й прод.
 */
const path = require("path");

// Порядок = порядок <script> у index.html. Міняти лише разом із index.html.
const LOAD_ORDER = [
  "constants/auctions.js",
  "constants/locations.js",
  "constants/ports.js",
  "constants/vehicle.js",
  "constants/engine.js",
  "services/storage.service.js",
  "services/rates.service.js",
  "services/auction-parser.service.js",
  "services/market-lookup.service.js",
  "core/state.js",
  "core/computed.js",
  "core/watchers.js",
  "methods/ui.methods.js",
  "methods/fees.methods.js",
  "methods/market.methods.js",
];

let loaded = false;

/** Виконує всі модулі один раз; далі покладаємось на window.*. */
function loadModules() {
  if (loaded) return;
  const root = path.resolve(__dirname, "../../assets/js");
  LOAD_ORDER.forEach(function (rel) {
    require(path.join(root, rel));
  });
  loaded = true;
}

/**
 * Збирає об'єкт, еквівалентний Vue-інстансу: data-поля з createInitialState()
 * плюс усі методи з трьох *.methods.js, як їх зводить app.js.
 * `overrides` накладаються глибоко, щоб можна було задати лише `{customs:{...}}`.
 */
function createVm(overrides) {
  loadModules();

  const vm = Object.assign(
    {},
    window.createInitialState(),
    window.createUiMethods(),
    window.createFeesMethods(),
    window.createMarketMethods(),
  );

  const computed = window.createComputed();
  Object.keys(computed).forEach(function (key) {
    Object.defineProperty(vm, key, { get: computed[key], enumerable: true });
  });

  deepAssign(vm, overrides || {});
  return vm;
}

function deepAssign(target, src) {
  Object.keys(src).forEach(function (key) {
    const val = src[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      deepAssign(target[key], val);
    } else {
      target[key] = val;
    }
  });
}

module.exports = { loadModules, createVm, LOAD_ORDER };
