function createAuctionParserService() {
  return { parse: function (vm) { return vm.__rawParseAuctionLot(); } };
}
