import {
  auctions,
  calculateCopartFee,
  calculateIaaIFee,
  inRange,
} from "./constants/auctions.js";
import { autoLocation } from "./constants/locations.js";
import { shippingPorts } from "./constants/ports.js";
import { vehicleTypes } from "./constants/vehicle.js";
import { engineTypes, engineVolumes } from "./constants/engine.js";
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
