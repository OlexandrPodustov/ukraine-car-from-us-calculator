// Курси НБУ. Потрібні два: EUR/USD — щоб перевести акциз (у ПКУ він заданий у
// євро) в долари, і USD/UAH — щоб звірити митну вартість із гривневими порогами
// пенсійного збору (вони прив'язані до прожиткового мінімуму).
export function createRatesService() {
  var NBU_KEY = "nbu_rates_cache_v2";
  var NBU_TTL = 24 * 60 * 60 * 1000;
  var NBU_URL =
    "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";

  function isoDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  // Кеш повертається навіть протухлим: за ним ще треба вирішити, чи він
  // свіжий, і — головне — до чого відкочуватись, якщо НБУ не відповів.
  function loadCachedRates() {
    try {
      var c = JSON.parse(localStorage.getItem(NBU_KEY));
      if (c && c.eurUsd > 0 && c.usdUah > 0 && c.ts) return c;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function saveCachedRates(eurUsd, usdUah, ts) {
    try {
      localStorage.setItem(
        NBU_KEY,
        JSON.stringify({ eurUsd: eurUsd, usdUah: usdUah, ts: ts }),
      );
    } catch (e) {
      /* ignore */
    }
  }

  function apply(vm, eurUsd, usdUah, source, ts) {
    vm.eurUsd = eurUsd;
    vm.usdUah = usdUah;
    vm.ratesSource = source;
    vm.ratesAsOf = isoDay(ts);
  }

  return {
    /**
     * Підтягує курси НБУ. Повертає проміс — щоб тест (і майбутній виклик,
     * якому треба дочекатись курсу) міг на нього почекати.
     *
     * Порядок відкоту важливий: протухлий, але СПРАВЖНІЙ курс кращий за
     * захардкоджений дефолт, який завжди старіший. Раніше кеш віком 25 годин
     * просто викидався, і при недоступному НБУ калькулятор мовчки рахував
     * акциз і пороги пенсійного збору за курсами з коміту.
     */
    initNbuRate: function (vm) {
      var cached = loadCachedRates();
      if (cached && Date.now() - cached.ts < NBU_TTL) {
        apply(vm, cached.eurUsd, cached.usdUah, "nbu", cached.ts);
        return Promise.resolve("nbu");
      }
      return fetch(NBU_URL)
        .then(function (resp) {
          return resp.json();
        })
        .then(function (data) {
          var usd = (data || []).find(function (x) {
            return x.cc === "USD";
          });
          var eur = (data || []).find(function (x) {
            return x.cc === "EUR";
          });
          if (!(usd && eur && usd.rate > 0))
            throw new Error("НБУ: немає USD/EUR");
          var now = Date.now();
          apply(
            vm,
            parseFloat((eur.rate / usd.rate).toFixed(4)),
            parseFloat(usd.rate.toFixed(4)),
            "nbu",
            now,
          );
          saveCachedRates(vm.eurUsd, vm.usdUah, now);
          return "nbu";
        })
        .catch(function (e) {
          if (cached) {
            console.warn("[НБУ] недоступний — курс із кешу", e);
            apply(vm, cached.eurUsd, cached.usdUah, "stale", cached.ts);
            return "stale";
          }
          console.warn("[НБУ] недоступний — лишаємось на дефолтних курсах", e);
          vm.ratesSource = "default";
          return "default";
        });
    },
  };
}
window.createRatesService = createRatesService;
