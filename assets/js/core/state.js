function createInitialState() {
  return {
                    eurUsd: 1.10,
                    oceanFreight: { east: 2500, west: 3000, gulf: 2700 },
                    autoPricing: {
                      autoPrice: 4000,
                      auctions: {
                        selected: auctions[0].id,
                        options: auctions,
                      },
                    },
                    auctionUrl: '',
                    auctionStatus: '',   // '', 'loading', 'ok', 'warn', 'error'
                    auctionMsg: '',
                    acv: 0,
                    repairCost: 0,
                    buyNowPrice: 0,
                    riskCoefficient: 0.5,
                    locationSearch: '',
                    locationDropOpen: false,
                    autoShipping: {
                      location: {
                        selected: autoLocation[0].id,
                        options: autoLocation,
                      },
                      shippingPort: shippingPorts[0].id,
                      destinationPort: {
                        selected: destinationPorts[0].id,
                        options: destinationPorts,
                      },
                      vehicleType: vehicleType[0].id,
                    },
                    customs: {
                      engineVolume: "2.0",
                      // always a string value, so convert it for calculations
                      engineVolumeOpts: engineVolumes,
                      manufactureYear: currentYear,
                      manYearOptions: manYearOptions,
                      engineType: engineType.Petrol,
                      batteryKwh: 77,
                      // Ukrainian market comparison
                      ukrainianMarketPrice: 0,
                      marketCategory: '', // 'underpriced', 'fair', 'overpriced'
                      carrierInfo: {
                        make: '',
                        model: '',
                        color: '',
                        transmission: '',
                        mileage: 0,
                      },
                    },
                    marketStatus: '',   // '', 'loading', 'ok', 'warn', 'error'
                    marketMsg: '',
                    portExpeditor: 450,
                    portBrokerFee: 400,
                    portParking: 35,
                    legalCert: 250,
                    legalRegistration: 100,
                    toHomeTransport: 250,
                    bankCommission: 50
  };
}
