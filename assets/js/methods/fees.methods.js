window.createFeesMethods = function () {
  var all = window.__createAllMethods();
  var pick = [
    "auctionFee",
    "commissionBank",
    "anzFee",
    "strahovka",
    "totalAutoFee",
    "poshlina",
    "mreo",
    "shippingAllowedPorts",
    "transportFee",
    "currentDestination",
    "currentCoast",
    "baseOceanFreight",
    "oceanFreightFee",
    "inlandUsFee",
    "oversizeFee",
    "toUkraineFee",
    "shippingBreakdown",
    "totalShippingFee",
    "isElectricEngine",
    "akcis",
    "totalCustomsFee",
    "pensionFee",
    "totalCost",
    "cleanValue",
    "benefit",
    "maxBid",
    "recalcMaxBid",
    "total",
  ];
  var out = {};
  pick.forEach(function (k) {
    if (all[k]) out[k] = all[k];
  });
  return out;
};
export const createFeesMethods = window.createFeesMethods;
