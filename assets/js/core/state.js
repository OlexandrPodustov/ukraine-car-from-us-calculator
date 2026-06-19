window.createInitialState = function () {
  return {
    eurUsd: 1.1,
    oceanFreight: { east: 2500, west: 3000, gulf: 2700 },
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
    // Ідентичність розпарсеного лота — щоб прив'язати пошук ціни до лота в БД.
    currentLot: { auction: "", lotNumber: "" },
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
