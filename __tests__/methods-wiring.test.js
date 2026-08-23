/**
 * Методи визначені всі в одному місці (__createAllMethods), а на інстанс Vue
 * потрапляють трьома наборами з app.js. Раніше кожен набір мав власний
 * поіменний список, і метод, забутий у всіх трьох, тихо не існував на vm —
 * шаблон падав на «is not a function» уже в браузері. Тепер market бере
 * доповнення до ui+fees; ці тести стережуть саме цю інваріанту.
 */
const fs = require("fs");
const path = require("path");
const { createVm, loadModules } = require("./helpers/load-calculator");

const ROOT = path.resolve(__dirname, "..");

describe("Розкладка методів по трьох наборах", () => {
  test("кожен метод потрапляє рівно в один набір і жоден не губиться", () => {
    loadModules();
    const all = Object.keys(window.__createAllMethods());
    const ui = Object.keys(window.createUiMethods());
    const fees = Object.keys(window.createFeesMethods());
    const market = Object.keys(window.createMarketMethods());
    const merged = ui.concat(fees, market);

    expect(merged.length).toBe(all.length);
    expect(new Set(merged).size).toBe(all.length);
    expect(all.filter((m) => merged.indexOf(m) === -1)).toEqual([]);
  });

  test("новий метод потрапляє на інстанс без правок у списках", () => {
    loadModules();
    const original = window.__createAllMethods;
    window.__createAllMethods = function () {
      const all = original();
      all.__brandNewMethod = function () {
        return 42;
      };
      return all;
    };
    try {
      expect(window.createMarketMethods().__brandNewMethod).toBeDefined();
    } finally {
      window.__createAllMethods = original;
    }
  });
});

describe("Шаблон index.html не кличе неіснуючих методів", () => {
  test("кожен виклик у Vue-виразах є методом або полем інстансу", () => {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const vm = createVm();

    // Vue-вирази — це вміст {{…}} і значення атрибутів v-*.
    const expressions = [];
    const mustache = /\{\{([\s\S]*?)\}\}/g;
    let m;
    while ((m = mustache.exec(html))) expressions.push(m[1]);
    const directive = /\sv-[\w:.-]+="([^"]*)"/g;
    while ((m = directive.exec(html))) expressions.push(m[1]);

    // Дозволені виклики, які не є методами інстансу.
    const BUILTINS = new Set([
      "if",
      "for",
      "return",
      "typeof",
      "toLocaleString",
    ]);
    const missing = new Set();
    expressions.forEach(function (expr) {
      const call = /([A-Za-z_$][\w$]*)\s*\(/g;
      let c;
      while ((c = call.exec(expr))) {
        const name = c[1];
        if (BUILTINS.has(name)) continue;
        // Виклик через крапку (obj.method()) перевіряти не беремось.
        if (expr[c.index - 1] === ".") continue;
        if (typeof vm[name] !== "function") missing.add(name);
      }
    });

    expect(Array.from(missing)).toEqual([]);
  });
});

describe("Шаблон index.html не читає неіснуючих полів", () => {
  test("корінь кожного виразу є на інстансі", () => {
    // Ловить друге джерело мовчазних поламок: посилання на поле, якого в
    // data немає. Так `vehicleTypeOptions` замість
    // `autoShipping.vehicleTypeOptions` дав би порожній селект без жодної
    // помилки в консолі.
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const vm = createVm();

    const expressions = [];
    const aliases = new Set();
    let m;
    const mustache = /\{\{([\s\S]*?)\}\}/g;
    while ((m = mustache.exec(html))) expressions.push(m[1]);
    const directive = /\s(v-[\w:.-]+)="([^"]*)"/g;
    while ((m = directive.exec(html))) {
      const [, name, value] = m;
      if (name.indexOf("v-for") === 0) {
        // «opt in list» / «(item, i) in list» — ліва частина це локальні імена.
        const parts = value.split(/\s+(?:in|of)\s+/);
        parts[0]
          .replace(/[()]/g, " ")
          .split(",")
          .forEach((a) => a.trim() && aliases.add(a.trim()));
        expressions.push(parts.slice(1).join(" "));
      } else {
        expressions.push(value);
      }
    }

    // Vue 2 пускає в шаблон обмежений набір глобалей (allowedGlobals).
    const GLOBALS = new Set([
      "Math",
      "Date",
      "JSON",
      "Number",
      "String",
      "Boolean",
      "Array",
      "Object",
      "parseInt",
      "parseFloat",
      "isNaN",
      "isFinite",
      "undefined",
      "null",
      "true",
      "false",
      "NaN",
      "Infinity",
      "typeof",
      "in",
      "of",
      "new",
      "return",
      "if",
      "else",
      "$event",
      "$nextTick",
      "$refs",
    ]);

    const missing = new Set();
    expressions.forEach(function (raw) {
      // HTML-сутності («benefit()&gt;=0») спершу назад у символи, потім
      // прибираємо рядкові літерали — усередині них ідентифікаторів немає.
      const expr = raw
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/'[^']*'/g, "''")
        .replace(/`[^`]*`/g, "''");
      const ident = /([A-Za-z_$][\w$]*)/g;
      let c;
      while ((c = ident.exec(expr))) {
        const name = c[1];
        const before = expr.slice(0, c.index).trimEnd();
        const after = expr.slice(c.index + name.length).trimStart();
        if (before.endsWith(".")) continue; // властивість об'єкта
        if (after.startsWith(":")) continue; // ключ у літералі {color:…}
        if (GLOBALS.has(name) || aliases.has(name)) continue;
        if (typeof vm[name] === "undefined" && !(name in vm)) missing.add(name);
      }
    });

    expect(Array.from(missing).sort()).toEqual([]);
  });
});

describe("Watcher'и", () => {
  test("кожен watcher стежить за полем, яке справді є в data", () => {
    // ukrainianMarketPrice і marketCategory довго висіли тут верхнім рівнем,
    // хоча обидва живуть у customs — тобто не спрацьовували ніколи.
    loadModules();
    const state = window.createInitialState();
    const vm = createVm();
    const unknown = Object.keys(window.createWatchers()).filter(
      (key) => !(key in state) && typeof vm[key] === "undefined",
    );
    expect(unknown).toEqual([]);
  });

  test("правка ACV / ремонту / коефіцієнта не переписує ціну авто", () => {
    const watchers = window.createWatchers();
    const vm = createVm({ autoPricing: { autoPrice: 9000 } });
    vm.saveToLocalStorage = () => {};

    ["acv", "repairCost", "riskCoefficient"].forEach((key) => {
      const handler = watchers[key].handler || watchers[key];
      handler.call(vm, 1, 0);
    });

    expect(vm.autoPricing.autoPrice).toBe(9000);
  });

  test("recalcMaxBid підставляє максимальну ставку, коли її просять", () => {
    const vm = createVm({
      autoPricing: { autoPrice: 9000 },
      acv: 40000,
      repairCost: 5000,
    });
    vm.saveToLocalStorage = () => {};
    const expected = vm.maxBid();
    vm.recalcMaxBid();
    expect(vm.autoPricing.autoPrice).toBe(expected);
  });
});

describe("Довідники не мають других копій", () => {
  test("селект палива покриває рівно значення engineType", () => {
    loadModules();
    const ids = window.engineTypeOptions.map((o) => o.id).sort();
    const known = Object.keys(window.engineType)
      .map((k) => window.engineType[k])
      .sort();
    expect(ids).toEqual(known);
    expect(window.engineTypeOptions.every((o) => o.name)).toBe(true);
  });

  test("надбавка за габарит задана на самому типі кузова", () => {
    loadModules();
    const vm = createVm({ autoShipping: { vehicleType: "pikap" } });
    expect(vm.oversizeFee()).toBe(
      window.getVehicleTypeById("pikap").oversizeFee,
    );
    expect(
      createVm({ autoShipping: { vehicleType: "sedan" } }).oversizeFee(),
    ).toBe(0);
    // Невідомий id не має обвалювати підсумок у NaN.
    const broken = createVm({ autoShipping: { vehicleType: "нема-такого" } });
    expect(broken.oversizeFee()).toBe(0);
    expect(Number.isFinite(broken.total())).toBe(true);
  });
});
