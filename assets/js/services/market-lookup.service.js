function createMarketLookupService() {
  return { lookup: function (vm) { return vm.__rawLookupUkrainianPrice(); } };
}
