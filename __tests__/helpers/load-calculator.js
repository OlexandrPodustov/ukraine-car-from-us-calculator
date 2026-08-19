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

  // Vue тримає дані в `vm._data` і проксіює ключі на сам інстанс. Харнес
  // повторює обидва рівні, бо код (totalForPrice) на це спирається.
  const state = window.createInitialState();
  const vm = Object.assign({}, state);
  Object.defineProperty(vm, "_data", { value: state, enumerable: false });

  // Vue 2 прив'язує КОЖЕН метод до інстансу (`bind(vm)`). Робимо так само —
  // інакше харнес поводиться інакше за браузер: код, який підміняє `this`
  // через Object.create/call, у тестах «працює», а на сторінці мовчки
  // рахує зі справжнім станом і вішає рендер у циклі.
  const methods = Object.assign(
    {},
    window.createUiMethods(),
    window.createFeesMethods(),
    window.createMarketMethods(),
  );
  Object.keys(methods).forEach(function (key) {
    vm[key] = methods[key].bind(vm);
  });

  const computed = window.createComputed();
  Object.keys(computed).forEach(function (key) {
    Object.defineProperty(vm, key, { get: computed[key], enumerable: true });
  });

  deepAssign(vm, overrides || {});
  // Тримаємо _data синхронним із проксі-полями на інстансі.
  Object.keys(state).forEach(function (key) {
    state[key] = vm[key];
  });
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
