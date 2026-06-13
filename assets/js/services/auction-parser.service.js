export function createAuctionParserService() {
  return {
    parse: function (vm) {
      return vm.__rawParseAuctionLot();
    },
  };
}
window.createAuctionParserService = createAuctionParserService;
