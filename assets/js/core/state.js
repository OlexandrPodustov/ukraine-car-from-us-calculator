window.createInitialState = function () {
  return {
    // Дефолти на випадок, коли API НБУ недоступне; реальні курси підтягує
    // rates.service.js. Зріз курсів — 2026-08-17 (див. docs/*-baseline.md).
    eurUsd: 1.1,
    usdUah: 44.7,
    // Прожитковий мінімум для працездатних осіб, грн. До нього прив'язані
    // пороги пенсійного збору (165 / 290 ПМ). Оновлюється раз на рік
    // законом про держбюджет — див. docs/pension-fee-baseline.md.
    subsistenceMinUah: 3328,
    // Ставки фрахту [порт призначення][узбережжя США]. Редаговані в UI через
    // oceanFreightOverride — ставки експедиторів різняться в рази, тож
    // захардкоджені значення тут лише як стартова точка.
    oceanFreightRates: window.oceanFreightRates,
    // Ручна ставка фрахту; 0/порожньо → береться з oceanFreightRates.
    oceanFreightOverride: 0,
    autoPricing: {
      autoPrice: 4000,
      auctions: {
        selected: window.auctions[0].id,
        options: window.auctions,
      },
    },
    auctionUrl: "",
    auctionStatus: "", // '', 'loading', 'ok', 'warn', 'error'
    auctionMsg: "",
    // Ідентичність розпарсеного лота — щоб прив'язати пошук ціни до лота в БД
    // і показати VIN у шапці калькулятора.
    currentLot: { auction: "", lotNumber: "", vin: "" },
    acv: 0,
    repairCost: 0,
    buyNowPrice: 0,
    riskCoefficient: 0.5,
    locationSearch: "",
    locationDropOpen: false,
    autoShipping: {
      location: {
        selected: window.autoLocation[0].id,
        options: window.autoLocation,
      },
      shippingPort: window.shippingPorts[0].id,
      destinationPort: {
        selected: window.destinationPorts[0].id,
        options: window.destinationPorts,
      },
      vehicleType: window.vehicleType[0].id,
    },
    customs: {
      engineVolume: "2.0",
      // always a string value, so convert it for calculations
      engineVolumeOpts: window.engineVolumes,
      manufactureYear: window.currentYear,
      manYearOptions: window.manYearOptions,
      engineType: window.engineType.Petrol,
      batteryKwh: 77,
      // Ukrainian market comparison
      ukrainianMarketPrice: 0,
      marketCategory: "", // 'underpriced', 'fair', 'overpriced'
      carrierInfo: {
        make: "",
        model: "",
        color: "",
        transmission: "",
        mileage: 0,
      },
    },
    marketStatus: "", // '', 'loading', 'ok', 'warn', 'error'
    marketMsg: "",
    // Підпис авто (марка|модель|рік), до якого належить знайдена ринкова ціна.
    // Якщо він розійшовся з поточним авто — ціна застаріла і її треба прибрати.
    marketTarget: "",
    portExpeditor: 450,
    portBrokerFee: 400,
    portParking: 35,
    legalCert: 250,
    legalRegistration: 100,
    toHomeTransport: 250,
    bankCommission: 50,
  };
};
export const createInitialState = window.createInitialState;
