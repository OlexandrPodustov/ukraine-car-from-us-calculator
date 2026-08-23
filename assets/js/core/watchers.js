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
    // Ці три поля НЕ переписують ціну авто. Раніше кожне з них викликало
    // recalcMaxBid(), тобто autoPrice := maxBid(), і наслідків було два:
    //   1) виправлення оцінки ремонту (найчастіша ручна правка) стирало
    //      ставку, яку користувач щойно ввів;
    //   2) при autoPrice == maxBid() підсумок за побудовою дорівнює ліміту,
    //      тож «Вигода угоди» ставала тавтологією (ACV−ремонт)×(1−ризик)
    //      і показувала те саме число для будь-якого лота.
    // Максимальна ставка й далі рахується та показується окремим рядком, а
    // підставити її в ціну можна кнопкою поруч (recalcMaxBid).
    acv: function () {
      this.saveToLocalStorage();
    },
    repairCost: function () {
      this.saveToLocalStorage();
    },
    riskCoefficient: function () {
      this.saveToLocalStorage();
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
  };
};
export const createWatchers = window.createWatchers;
