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
    const BUILTINS = new Set(["if", "for", "return", "typeof", "toLocaleString"]);
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
