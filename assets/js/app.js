(function(){
  var storageService = createStorageService();
  var ratesService = createRatesService();
  var auctionParserService = createAuctionParserService();
  var marketLookupService = createMarketLookupService();

  var calcApp = new Vue({
    el:'#shippingApp',
    data:createInitialState(),
    computed:createComputed(),
    watch:createWatchers(),
    methods:Object.assign({}, createUiMethods(), createFeesMethods(), createMarketMethods()),
    mounted:function(){
      var vm = this;
      var savedData = storageService.load();
      if (savedData) {
        try {
          if (savedData.autoPricing) Object.assign(vm.autoPricing, savedData.autoPricing);
          if (savedData.autoShipping) Object.assign(vm.autoShipping, savedData.autoShipping);
          if (savedData.customs) Object.assign(vm.customs, savedData.customs);
          if (savedData.locationSearch) vm.locationSearch = savedData.locationSearch;
          if (savedData.auctionUrl) vm.auctionUrl = savedData.auctionUrl;
          if (savedData.acv) vm.acv = savedData.acv;
          if (savedData.repairCost) vm.repairCost = savedData.repairCost;
          if (savedData.buyNowPrice) vm.buyNowPrice = savedData.buyNowPrice;
          if (savedData.riskCoefficient) vm.riskCoefficient = savedData.riskCoefficient;
          if (savedData.customs && savedData.customs.ukrainianMarketPrice) vm.customs.ukrainianMarketPrice = savedData.customs.ukrainianMarketPrice;
          if (savedData.customs && savedData.customs.marketCategory) vm.customs.marketCategory = savedData.customs.marketCategory;
        } catch (e) {
          console.warn('[LocalStorage] Помилка при завантаженні даних', e);
        }
      }
      ratesService.initNbuRate(vm);

      vm.__rawParseAuctionLot = vm.parseAuctionLot;
      vm.parseAuctionLot = function () { return auctionParserService.parse(vm); };
      vm.__rawLookupUkrainianPrice = vm.lookupUkrainianPrice;
      vm.lookupUkrainianPrice = function () { return marketLookupService.lookup(vm); };
    }
  });

  window.calcApp = calcApp;
})();
