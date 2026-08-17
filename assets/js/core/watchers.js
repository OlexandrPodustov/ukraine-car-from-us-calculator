window.createWatchers = function () {
  /* eslint-disable no-unused-vars */
  return {
    autoPricing: {
      handler: function (newVal) {
        this.saveToLocalStorage();
      },
      deep: true,
    },
    autoShipping: {
      handler: function (newVal) {
        this.saveToLocalStorage();
      },
      deep: true,
    },
    customs: {
      handler: function (newVal) {
        // Марка/модель/рік могли змінитись (новий лот або ручне редагування) —
        // тоді знайдена раніше ринкова ціна вже не про це авто.
        this.syncMarketFreshness();
        this.saveToLocalStorage();
      },
      deep: true,
    },
    locationSearch: function (newVal) {
      this.saveToLocalStorage();
    },
    acv: function () {
      this.recalcMaxBid();
    },
    repairCost: function () {
      this.recalcMaxBid();
    },
    riskCoefficient: function () {
      this.recalcMaxBid();
    },
    buyNowPrice: function () {
      this.saveToLocalStorage();
    },
    oceanFreightOverride: function () {
      this.saveToLocalStorage();
    },
    auctionUrl: function (newVal) {
      this.saveToLocalStorage();
    },
    auctionStatus: function (newVal) {
      this.saveToLocalStorage();
    },
    auctionMsg: function (newVal) {
      this.saveToLocalStorage();
    },
    marketStatus: function (newVal) {
      this.saveToLocalStorage();
    },
    marketMsg: function (newVal) {
      this.saveToLocalStorage();
    },
    ukrainianMarketPrice: function (newVal) {
      this.saveToLocalStorage();
    },
    marketCategory: function (newVal) {
      this.saveToLocalStorage();
    },
  };
};
export const createWatchers = window.createWatchers;
