module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  globals: {
    auctions: "readonly",
    autoLocation: "readonly",
    shippingPorts: "readonly",
    destinationPorts: "readonly",
    vehicleType: "readonly",
    engineVolumes: "readonly",
    currentYear: "readonly",
    manYearOptions: "readonly",
    engineType: "readonly",
    CONFIG: "readonly",
    calculateCopartFee: "readonly",
    calculateIaaIFee: "readonly",
    inRange: "readonly",
    Vue: "readonly",
    __createAllMethods: "readonly",
  },
  overrides: [
    {
      files: ["assets/js/constants/*.js"],
      parserOptions: {
        sourceType: "script",
      },
    },
  ],
  rules: {
    // Add custom rules if needed
  },
};
