// Test utilities and functions

function inRange(min, max, val) {
  return function (num) {
    return num >= min && num <= max ? val : 0;
  };
}

function calculateCopartFee(price) {
  var gateFee = 59;

  var stdVehicleFee =
    inRange(50.0, 99.99, 75.0)(price) +
    inRange(100.0, 199.99, 138.0)(price) +
    inRange(200.0, 299.99, 163.0)(price) +
    inRange(300.0, 349.99, 188.0)(price) +
    inRange(350.0, 399.99, 188.0)(price) +
    inRange(400.0, 449.99, 223.0)(price) +
    inRange(450.0, 499.99, 223.0)(price) +
    inRange(500.0, 549.99, 248.0)(price) +
    inRange(550.0, 599.99, 253.0)(price) +
    inRange(600.0, 699.99, 263.0)(price) +
    inRange(700.0, 799.99, 278.0)(price) +
    inRange(800.0, 899.99, 293.0)(price) +
    inRange(900.0, 999.99, 308.0)(price) +
    inRange(1000.0, 1199.99, 343.0)(price) +
    inRange(1200.0, 1299.99, 368.0)(price) +
    inRange(1300.0, 1399.99, 383.0)(price) +
    inRange(1400.0, 1499.99, 393.0)(price) +
    inRange(1500.0, 1599.99, 413.0)(price) +
    inRange(1600.0, 1699.99, 428.0)(price) +
    inRange(1700.0, 1799.99, 438.0)(price) +
    inRange(1800.0, 1999.99, 453.0)(price) +
    inRange(2000.0, 2399.99, 473.0)(price) +
    inRange(2400.0, 2499.99, 483.0)(price) +
    inRange(2500.0, 2999.99, 498.0)(price) +
    inRange(3000.0, 3499.99, 548.0)(price) +
    inRange(3500.0, 3999.99, 598.0)(price) +
    inRange(4000.0, 4499.99, 633.0)(price) +
    inRange(4500.0, 4999.99, 658.0)(price) +
    inRange(5000.0, 5999.99, 683.0)(price) +
    inRange(6000.0, 7499.99, 728.0)(price) +
    inRange(7500.0, 9999.99, 753.0)(price) +
    inRange(10000.0, 14999.99, 788.0)(price) +
    inRange(15000.0, 19999.99, price * 0.04)(price) +
    inRange(20000.0, 24999.99, price * 0.04)(price) +
    inRange(30000.0, 34999.99, price * 0.04)(price) +
    inRange(35000.0, 39999.99, price * 0.04)(price) +
    inRange(40000.0, 49999.99, price * 0.04)(price) +
    inRange(50000.0, 59999.99, price * 0.04)(price) +
    inRange(60000.0, 999999.99, price * 0.03)(price);

  return gateFee + stdVehicleFee;
}

describe("Calculator Functions", () => {
  test("inRange function", () => {
    expect(inRange(0, 10, 5)(7)).toBe(5);
    expect(inRange(0, 10, 5)(15)).toBe(0);
  });

  test("calculateCopartFee for price 100", () => {
    const fee = calculateCopartFee(100);
    expect(fee).toBe(59 + 138); // gateFee + fee for 100-199.99
  });

  test("calculateCopartFee for price 10000", () => {
    const fee = calculateCopartFee(10000);
    expect(fee).toBe(59 + 788); // for 10000-14999.99
  });

  test("calculateCopartFee for price 20000", () => {
    const fee = calculateCopartFee(20000);
    expect(fee).toBe(59 + 20000 * 0.04);
  });

  // Add more tests for other functions
});

// Mock Vue instance for testing methods
const mockVm = {
  autoPricing: { auctions: { selected: "copart" }, autoPrice: 1000 },
  autoShipping: {
    location: {
      options: [
        { id: "CA", name: "California" },
        { id: "OR", name: "Oregon (iaai)" },
      ],
    },
  },
  locationSearch: "cal",
  filteredLocations: function () {
    var q = (this.locationSearch || "").toLowerCase().trim();
    var auction = this.autoPricing.auctions.selected;
    return this.autoShipping.location.options.filter(function (loc) {
      var name = loc.name.toLowerCase();
      if (auction === "copart" && name.indexOf("(iaai)") !== -1) return false;
      if (auction === "iaai" && name.indexOf("(copart)") !== -1) return false;
      if (!q) return true;
      return name.indexOf(q) !== -1;
    });
  },
};

describe("Vue Computed Properties", () => {
  test("filteredLocations with search", () => {
    const result = mockVm.filteredLocations();
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("CA");
  });

  test("filteredLocations without search", () => {
    mockVm.locationSearch = "";
    mockVm.autoPricing.auctions.selected = "iaai"; // to include both
    const result = mockVm.filteredLocations();
    expect(result.length).toBe(2);
  });
});
