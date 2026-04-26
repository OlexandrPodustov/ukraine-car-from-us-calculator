function createWatchers() {
  return {
                    autoPricing: {
                      handler: function(newVal) {
                        this.saveToLocalStorage();
                      },
                      deep: true
                    },
                    autoShipping: {
                      handler: function(newVal) {
                        this.saveToLocalStorage();
                      },
                      deep: true
                    },
                    customs: {
                      handler: function(newVal) {
                        this.saveToLocalStorage();
                      },
                      deep: true
                    },
                    locationSearch: function(newVal) {
                      this.saveToLocalStorage();
                    },
                    acv:             function () { this.recalcMaxBid(); },
                    repairCost:      function () { this.recalcMaxBid(); },
                    riskCoefficient: function() { this.recalcMaxBid(); },
                    buyNowPrice:     function() { this.saveToLocalStorage(); },
                    auctionUrl: function(newVal) {
                      this.saveToLocalStorage();
                    },
                    auctionStatus: function(newVal) {
                      this.saveToLocalStorage();
                    },
                    auctionMsg: function(newVal) {
                      this.saveToLocalStorage();
                    },
                    marketStatus: function(newVal) {
                      this.saveToLocalStorage();
                    },
                    marketMsg: function(newVal) {
                      this.saveToLocalStorage();
                    },
                    ukrainianMarketPrice: function(newVal) {
                      this.saveToLocalStorage();
                    },
                    marketCategory: function(newVal) {
                      this.saveToLocalStorage();
                    }
  };
}
