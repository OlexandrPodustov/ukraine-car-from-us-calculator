export function createMarketLookupService() {
  return {
    lookup: function (vm) {
      return vm.__rawLookupUkrainianPrice();
    },
  };
}
window.createMarketLookupService = createMarketLookupService;
