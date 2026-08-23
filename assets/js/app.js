// Довідники підключаються заради побічного ефекту — вони пишуть себе у
// window.*, звідки їх і читає решта коду (див. CLAUDE.md). Іменовані імпорти
// тут нічого не давали: жодне з цих імен у app.js не використовується.
import "./constants/auctions.js";
import "./constants/locations.js";
import "./constants/ports.js";
import "./constants/vehicle.js";
import "./constants/engine.js";
import {
  createStorageService,
  applyPersistedState,
} from "./services/storage.service.js";
import { createRatesService } from "./services/rates.service.js";
import { createAuctionParserService } from "./services/auction-parser.service.js";
import { createMarketLookupService } from "./services/market-lookup.service.js";
import { createInitialState } from "./core/state.js";
import { createComputed } from "./core/computed.js";
import { createWatchers } from "./core/watchers.js";
import { createUiMethods } from "./methods/ui.methods.js";
import { createFeesMethods } from "./methods/fees.methods.js";
import { createMarketMethods } from "./methods/market.methods.js";

function initializeApp() {
  var storageService = createStorageService();
  var ratesService = createRatesService();
  var auctionParserService = createAuctionParserService();
  var marketLookupService = createMarketLookupService();

  var calcApp = new Vue({
    el: "#shippingApp",
    data: createInitialState(),
    computed: createComputed(),
    watch: createWatchers(),
    methods: Object.assign(
      {},
      createUiMethods(),
      createFeesMethods(),
      createMarketMethods(),
    ),
    mounted: function () {
      var vm = this;
      var savedData = storageService.load();
      if (savedData) {
        try {
          // Валідацію ідентифікаторів і міграцію зі старого формату сховища
          // робить applyPersistedState — див. services/storage.service.js.
          applyPersistedState(vm, savedData);
        } catch (e) {
          console.warn("[LocalStorage] Помилка при завантаженні даних", e);
        }
        // Ціна без підпису авто — зі старої версії сховища: невідомо, до якого
        // авто вона належить. Інакше — звіряємо підпис із поточним авто.
        if (!vm.marketTarget && vm.customs.ukrainianMarketPrice > 0) {
          vm.clearMarketResult();
        } else {
          vm.syncMarketFreshness();
        }
      }
      vm.purgeLegacyMarketCache();

      // /index.html?lot=<id> — перерахувати збережений лот (кнопка з lots.html).
      // Форма заповнюється з raw_json у БД, аукціон при цьому не смикаємо.
      var lotParam = new URLSearchParams(location.search).get("lot");
      if (lotParam && /^\d+$/.test(lotParam)) {
        vm.loadSavedLot(lotParam);
      } else {
        // Без ?lot= стан прийшов зі сховища, а повний VIN живе тільки в БД
        // (колонка vin_full) — перечитуємо його звідти, інакше після F5 на
        // екрані знову маска WP1AA2A53RL******.
        vm.refreshLotFromDb();
      }

      // Порт відправлення виводиться зі штату локації (див. ports.js). Робимо
      // це і при старті: у сховищі всіх, хто відкривав калькулятор раніше,
      // лежить new_york — воно б давало східний фрахт навіть для Каліфорнії.
      vm.onLocationChange();

      ratesService.initNbuRate(vm);

      vm.__rawParseAuctionLot = vm.parseAuctionLot;
      vm.parseAuctionLot = function () {
        return auctionParserService.parse(vm);
      };
      vm.__rawLookupUkrainianPrice = vm.lookupUkrainianPrice;
      vm.lookupUkrainianPrice = function () {
        return marketLookupService.lookup(vm);
      };
    },
  });

  window.calcApp = calcApp;
}

// Initialize after DOM is ready and constants are loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}
