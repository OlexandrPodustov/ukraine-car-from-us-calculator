// Курси НБУ. Потрібні два: EUR/USD — щоб перевести акциз (у ПКУ він заданий у
// євро) в долари, і USD/UAH — щоб звірити митну вартість із гривневими порогами
// пенсійного збору (вони прив'язані до прожиткового мінімуму).
export function createRatesService() {
  var NBU_KEY = "nbu_rates_cache_v2";
  var NBU_TTL = 24 * 60 * 60 * 1000;

  function loadCachedRates() {
    try {
      var c = JSON.parse(localStorage.getItem(NBU_KEY));
      if (c && c.eurUsd && c.usdUah && Date.now() - c.ts < NBU_TTL) return c;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function saveCachedRates(eurUsd, usdUah) {
    try {
      localStorage.setItem(
        NBU_KEY,
        JSON.stringify({ eurUsd: eurUsd, usdUah: usdUah, ts: Date.now() }),
      );
    } catch (e) {
      /* ignore */
    }
  }

  return {
    initNbuRate: function (vm) {
      var cached = loadCachedRates();
      if (cached) {
        vm.eurUsd = cached.eurUsd;
        vm.usdUah = cached.usdUah;
        return;
      }
      fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json")
        .then(function (resp) {
          return resp.json();
        })
        .then(function (data) {
          var usd = data.find(function (x) {
            return x.cc === "USD";
          });
          var eur = data.find(function (x) {
            return x.cc === "EUR";
          });
          if (usd && eur && usd.rate > 0) {
            vm.eurUsd = parseFloat((eur.rate / usd.rate).toFixed(4));
            vm.usdUah = parseFloat(usd.rate.toFixed(4));
            saveCachedRates(vm.eurUsd, vm.usdUah);
          }
        })
        .catch(function (e) {
          console.warn("[НБУ] лишаємось на дефолтних курсах", e);
        });
    },
  };
}
window.createRatesService = createRatesService;
