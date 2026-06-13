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
import { createStorageService } from "./services/storage.service.js";
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
          if (savedData.autoPricing)
            Object.assign(vm.autoPricing, savedData.autoPricing);
          if (savedData.autoShipping)
            Object.assign(vm.autoShipping, savedData.autoShipping);
          if (savedData.customs) Object.assign(vm.customs, savedData.customs);
          if (savedData.locationSearch)
            vm.locationSearch = savedData.locationSearch;
          if (savedData.auctionUrl) vm.auctionUrl = savedData.auctionUrl;
          if (savedData.auctionStatus)
            vm.auctionStatus = savedData.auctionStatus;
          if (savedData.auctionMsg) vm.auctionMsg = savedData.auctionMsg;
          if (savedData.marketStatus) vm.marketStatus = savedData.marketStatus;
          if (savedData.marketMsg) vm.marketMsg = savedData.marketMsg;
          if (savedData.ukrainianMarketPrice)
            vm.customs.ukrainianMarketPrice = savedData.ukrainianMarketPrice;
          if (savedData.marketCategory)
            vm.customs.marketCategory = savedData.marketCategory;
          if (savedData.acv) vm.acv = savedData.acv;
          if (savedData.repairCost) vm.repairCost = savedData.repairCost;
          if (savedData.buyNowPrice) vm.buyNowPrice = savedData.buyNowPrice;
          if (savedData.riskCoefficient)
            vm.riskCoefficient = savedData.riskCoefficient;
          if (savedData.customs && savedData.customs.ukrainianMarketPrice)
            vm.customs.ukrainianMarketPrice =
              savedData.customs.ukrainianMarketPrice;
          if (savedData.customs && savedData.customs.marketCategory)
            vm.customs.marketCategory = savedData.customs.marketCategory;
        } catch (e) {
          console.warn("[LocalStorage] Помилка при завантаженні даних", e);
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
