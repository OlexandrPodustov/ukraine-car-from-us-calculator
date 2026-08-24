/**
 * Запускає РЕАЛЬНИЙ код калькулятора поза браузером.
 *
 * Ті самі файли й той самий порядок, що в `<script type="module">` в index.html;
 * ESM-синтаксис знімає той самий трансформер, що й у jest
 * (`test/esm-to-cjs-transform.cjs`) — справжній контракт між файлами це `window.*`,
 * а не експорти.
 *
 * Цим користуються і скрипти обслуговування БД, і server.js: landed-вартість
 * перепродажу рахується тим самим `totalForPrice()`, що й на сторінці
 * калькулятора, а не другою копією формул.
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stripEsm = createRequire(import.meta.url)(
  path.join(ROOT, "test", "esm-to-cjs-transform.cjs"),
);

// Порядок = порядок <script> у index.html. Міняти лише разом із index.html.
export const LOAD_ORDER = [
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

// Лоту вистачає констант і market.methods — не тягнемо state/computed там,
// де потрібен лише розбір JSON аукціону.
export const LOT_SOURCES = [
  "constants/auctions.js",
  "constants/locations.js",
  "constants/ports.js",
  "constants/vehicle.js",
  "constants/engine.js",
  "methods/market.methods.js",
];

let cachedFull = null;

/** Виконує перелічені файли в одному node:vm-контексті й повертає його `window`. */
export function loadCalculator(sources, opts) {
  const options = opts || {};
  // server.js рахує landed на кожен запит, а applyLotJson діагностично
  // друкує розбір лота — у консолі сервера це просто шум. Помилки лишаються.
  const quietConsole = {
    log: () => {},
    warn: () => {},
    error: (...a) => console.error(...a),
    info: () => {},
    debug: () => {},
  };
  const sandbox = {
    console: options.quiet ? quietConsole : console,
    Date,
    JSON,
    Math,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const ctx = createContext(sandbox);
  (sources || LOAD_ORDER).forEach((rel) => {
    const file = path.join(ROOT, "assets", "js", rel);
    const code = stripEsm.process(readFileSync(file, "utf8"), file).code;
    runInContext(code, ctx, { filename: file });
  });
  return sandbox;
}

/** Той самий контекст, завантажений один раз (server.js смикає його на кожен запит). */
export function sharedCalculator() {
  if (!cachedFull) cachedFull = loadCalculator(LOAD_ORDER, { quiet: true });
  return cachedFull;
}

/**
 * Мінімальний «vm» для розбору лота: collectLotData спирається лише на кілька
 * методів і на вибраний аукціон.
 */
export function lotVm(win, auction) {
  const methods = win.__createAllMethods();
  const vm = { autoPricing: { auctions: { selected: auction || "iaai" } } };
  Object.keys(methods).forEach((k) => {
    vm[k] = methods[k].bind(vm);
  });
  return vm;
}

/**
 * Повний Vue-подібний інстанс: data з createInitialState(), усі три набори
 * методів і computed — рівно як їх зводить app.js.
 *
 * Vue 2 прив'язує КОЖЕН метод до інстансу і тримає дані ще й у `vm._data`;
 * повторюємо обидва, бо `totalForPrice()` на це спирається (див.
 * __tests__/helpers/load-calculator.js — там та сама причина).
 */
export function createVm(win, overrides) {
  const state = win.createInitialState();
  const vm = Object.assign({}, state);
  Object.defineProperty(vm, "_data", { value: state, enumerable: false });

  const methods = Object.assign(
    {},
    win.createUiMethods(),
    win.createFeesMethods(),
    win.createMarketMethods(),
  );
  Object.keys(methods).forEach((key) => {
    vm[key] = methods[key].bind(vm);
  });

  vm.$nextTick = function (cb) {
    if (typeof cb === "function") cb();
    return Promise.resolve();
  };

  const computed = win.createComputed();
  Object.keys(computed).forEach((key) => {
    Object.defineProperty(vm, key, { get: computed[key], enumerable: true });
  });

  deepAssign(vm, overrides || {});
  Object.keys(state).forEach((key) => {
    state[key] = vm[key];
  });
  return vm;
}

function deepAssign(target, src) {
  Object.keys(src).forEach((key) => {
    const val = src[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      deepAssign(target[key], val);
    } else {
      target[key] = val;
    }
  });
}

export { ROOT };
