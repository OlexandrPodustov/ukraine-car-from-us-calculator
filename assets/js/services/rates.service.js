export function createRatesService() {
  var NBU_KEY = "nbu_eurusd_cache";
  var NBU_TTL = 24 * 60 * 60 * 1000;
  function loadCachedRate() {
    try {
      var c = JSON.parse(localStorage.getItem(NBU_KEY));
      if (c && c.rate && Date.now() - c.ts < NBU_TTL) return c.rate;
    } catch (e) {
      /* ignore */
    }
    return null;
  }
  function saveCachedRate(rate) {
    try {
      localStorage.setItem(
        NBU_KEY,
        JSON.stringify({ rate: rate, ts: Date.now() }),
      );
    } catch (e) {
      /* ignore */
    }
  }
  return {
    initNbuRate: function (vm) {
      var cached = loadCachedRate();
      if (cached) {
        vm.eurUsd = cached;
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
            saveCachedRate(vm.eurUsd);
          }
        })
        .catch(function (e) {
          console.warn("[НБУ] fallback 1.10", e);
        });
    },
  };
}
window.createRatesService = createRatesService;
