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
                    riskCoefficient: function () { this.recalcMaxBid(); },
                    riskCoefficient: function() { this.recalcMaxBid(); },
                    buyNowPrice:     function() { this.saveToLocalStorage(); },
                    auctionUrl: function(newVal) {
                      this.saveToLocalStorage();
                    }
  };
}
