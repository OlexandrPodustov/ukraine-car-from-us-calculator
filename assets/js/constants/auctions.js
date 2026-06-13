var auctions = [
  {
    id: "copart",
    name: "Copart",
  },
  {
    id: "iaai",
    name: "IAAI",
  },
];

function calculateCopartFee(price) {
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
    inRange(25000.0, 29999.99, price * 0.04)(price) +
    inRange(30000.0, 34999.99, price * 0.04)(price) +
    inRange(35000.0, 10000000.0, price * 0.04)(price);
  return Math.round(stdVehicleFee);
}
function calculateIaaIFee(price) {
  var saleFee =
    inRange(0, 99.99, 75.0 + 30)(price) +
    inRange(100.0, 199.99, 143.0 + 30)(price) +
    inRange(200.0, 299.99, 163.0 + 30)(price) +
    inRange(300.0, 349.99, 178.0 + 30)(price) +
    inRange(350.0, 399.99, 193.0 + 30)(price) +
    inRange(400.0, 449.99, 203.0 + 30)(price) +
    inRange(450.0, 499.99, 203.0 + 30)(price) +
    inRange(500.0, 549.99, 243.0 + 30)(price) +
    inRange(550.0, 599.99, 243.0 + 30)(price) +
    inRange(600.0, 699.99, 258.0 + 30)(price) +
    inRange(700.0, 799.99, 273.0 + 30)(price) +
    inRange(800.0, 899.99, 288.0 + 30)(price) +
    inRange(900.0, 999.99, 303.0 + 30)(price) +
    inRange(1000.0, 1099.99, 338.0 + 30)(price) +
    inRange(1100.0, 1199.99, 353.0 + 30)(price) +
    inRange(1200.0, 1299.99, 363.0 + 30)(price) +
    inRange(1300.0, 1399.99, 373.0 + 30)(price) +
    inRange(1400.0, 1499.99, 388.0 + 30)(price) +
    inRange(1500.0, 1599.99, 413.0 + 30)(price) +
    inRange(1600.0, 1699.99, 433.0 + 30)(price) +
    inRange(1700.0, 1799.99, 433.0 + 30)(price) +
    inRange(1800.0, 1999.99, 453.0 + 30)(price) +
    inRange(2000.0, 2199.99, 478.0 + 30)(price) +
    inRange(2200.0, 2399.99, 483.0 + 30)(price) +
    inRange(2400.0, 2499.99, 498.0 + 30)(price) +
    inRange(2500.0, 2999.99, 513.0 + 30)(price) +
    inRange(3000.0, 3499.99, 553.0 + 30)(price) +
    inRange(3500.0, 3999.99, 603.0 + 30)(price) +
    inRange(4000.0, 4499.99, 638.0 + 30)(price) +
    inRange(4500.0, 4999.99, 663.0 + 30)(price) +
    inRange(5000.0, 5999.99, 688.0 + 30)(price) +
    inRange(6000.0, 7499.99, 723.0 + 30)(price) +
    inRange(7500.0, 7699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(7700.0, 7799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(7800.0, 7899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(7900.0, 7999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8000.0, 8099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8100.0, 8199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8200.0, 8299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8300.0, 8399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8400.0, 8499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8500.0, 8599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8600.0, 8699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8700.0, 8799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8800.0, 8899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(8900.0, 8999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9000.0, 9099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9100.0, 9199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9200.0, 9299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9300.0, 9399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9400.0, 9499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9500.0, 9599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9600.0, 9699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9700.0, 9799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9800.0, 9899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(9900.0, 9999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10000.0, 10099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10100.0, 10199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10200.0, 10299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10300.0, 10399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10400.0, 10499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10500.0, 10599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10600.0, 10699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10700.0, 10799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10800.0, 10899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(10900.0, 10999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11000.0, 11099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11100.0, 11199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11200.0, 11299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11300.0, 11399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11400.0, 11499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11500.0, 11599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11600.0, 11699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11700.0, 11799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11800.0, 11899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(11900.0, 11999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12000.0, 12099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12100.0, 12199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12200.0, 12299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12300.0, 12399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12400.0, 12499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12500.0, 12599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12600.0, 12699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12700.0, 12799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12800.0, 12899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(12900.0, 12999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13000.0, 13099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13100.0, 13199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13200.0, 13299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13300.0, 13399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13400.0, 13499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13500.0, 13599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13600.0, 13699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13700.0, 13799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13800.0, 13899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(13900.0, 13999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14000.0, 14099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14100.0, 14199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14200.0, 14299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14300.0, 14399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14400.0, 14499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14500.0, 14599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14600.0, 14699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14700.0, 14799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14800.0, 14899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(14900.0, 14999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15000.0, 15099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15100.0, 15199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15200.0, 15299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15300.0, 15399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15400.0, 15499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15500.0, 15599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15600.0, 15699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15700.0, 15799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15800.0, 15899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(15900.0, 15999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16000.0, 16099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16100.0, 16199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16200.0, 16299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16300.0, 16399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16400.0, 16499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16500.0, 16599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16600.0, 16699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16700.0, 16799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16800.0, 16899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(16900.0, 16999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17000.0, 17099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17100.0, 17199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17200.0, 17299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17300.0, 17399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17400.0, 17499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17500.0, 17599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17600.0, 17699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17700.0, 17799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17800.0, 17899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(17900.0, 17999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18000.0, 18099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18100.0, 18199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18200.0, 18299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18300.0, 18399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18400.0, 18499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18500.0, 18599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18600.0, 18699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18700.0, 18799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18800.0, 18899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(18900.0, 18999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19000.0, 19099.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19100.0, 19199.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19200.0, 19299.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19300.0, 19399.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19400.0, 19499.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19500.0, 19599.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19600.0, 19699.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19700.0, 19799.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19800.0, 19899.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(19900.0, 19999.99, (price / 100) * 1 + 500 + 233)(price) +
    inRange(20000.0, 20099.99, (price / 100) * 4 + 233)(price) +
    inRange(20100.0, 20199.99, (price / 100) * 4 + 233)(price) +
    inRange(20200.0, 20299.99, (price / 100) * 4 + 233)(price) +
    inRange(20300.0, 20399.99, (price / 100) * 4 + 233)(price) +
    inRange(20400.0, 20499.99, (price / 100) * 4 + 233)(price) +
    inRange(20500.0, 20599.99, (price / 100) * 4 + 233)(price) +
    inRange(20600.0, 20699.99, (price / 100) * 4 + 233)(price) +
    inRange(20700.0, 20799.99, (price / 100) * 4 + 233)(price) +
    inRange(20800.0, 20899.99, (price / 100) * 4 + 233)(price) +
    inRange(20900.0, 20999.99, (price / 100) * 4 + 233)(price) +
    inRange(21000.0, 21099.99, (price / 100) * 4 + 233)(price) +
    inRange(21100.0, 21199.99, (price / 100) * 4 + 233)(price) +
    inRange(21200.0, 21299.99, (price / 100) * 4 + 233)(price) +
    inRange(21300.0, 21399.99, (price / 100) * 4 + 233)(price) +
    inRange(21400.0, 21499.99, (price / 100) * 4 + 233)(price) +
    inRange(21500.0, 21599.99, (price / 100) * 4 + 233)(price) +
    inRange(21600.0, 21699.99, (price / 100) * 4 + 233)(price) +
    inRange(21700.0, 21799.99, (price / 100) * 4 + 233)(price) +
    inRange(21800.0, 21899.99, (price / 100) * 4 + 233)(price) +
    inRange(21900.0, 21999.99, (price / 100) * 4 + 233)(price) +
    inRange(22000.0, 22099.99, (price / 100) * 4 + 233)(price) +
    inRange(22100.0, 22199.99, (price / 100) * 4 + 233)(price) +
    inRange(22200.0, 22299.99, (price / 100) * 4 + 233)(price) +
    inRange(22300.0, 22399.99, (price / 100) * 4 + 233)(price) +
    inRange(22400.0, 22499.99, (price / 100) * 4 + 233)(price) +
    inRange(22500.0, 22599.99, (price / 100) * 4 + 233)(price) +
    inRange(22600.0, 22699.99, (price / 100) * 4 + 233)(price) +
    inRange(22700.0, 22799.99, (price / 100) * 4 + 233)(price) +
    inRange(22800.0, 22899.99, (price / 100) * 4 + 233)(price) +
    inRange(22900.0, 22999.99, (price / 100) * 4 + 233)(price) +
    inRange(23000.0, 23099.99, (price / 100) * 4 + 233)(price) +
    inRange(23100.0, 23199.99, (price / 100) * 4 + 233)(price) +
    inRange(23200.0, 23299.99, (price / 100) * 4 + 233)(price) +
    inRange(23300.0, 23399.99, (price / 100) * 4 + 233)(price) +
    inRange(23400.0, 23499.99, (price / 100) * 4 + 233)(price) +
    inRange(23500.0, 23599.99, (price / 100) * 4 + 233)(price) +
    inRange(23600.0, 23699.99, (price / 100) * 4 + 233)(price) +
    inRange(23700.0, 23799.99, (price / 100) * 4 + 233)(price) +
    inRange(23800.0, 23899.99, (price / 100) * 4 + 233)(price) +
    inRange(23900.0, 23999.99, (price / 100) * 4 + 233)(price) +
    inRange(24000.0, 24099.99, (price / 100) * 4 + 233)(price) +
    inRange(24100.0, 24199.99, (price / 100) * 4 + 233)(price) +
    inRange(24200.0, 24299.99, (price / 100) * 4 + 233)(price) +
    inRange(24300.0, 24399.99, (price / 100) * 4 + 233)(price) +
    inRange(24400.0, 24499.99, (price / 100) * 4 + 233)(price) +
    inRange(24500.0, 24599.99, (price / 100) * 4 + 233)(price) +
    inRange(24600.0, 24699.99, (price / 100) * 4 + 233)(price) +
    inRange(24700.0, 24799.99, (price / 100) * 4 + 233)(price) +
    inRange(24800.0, 24899.99, (price / 100) * 4 + 233)(price) +
    inRange(24900.0, 24999.99, (price / 100) * 4 + 233)(price) +
    inRange(25000.0, 25099.99, (price / 100) * 4 + 233)(price) +
    inRange(25100.0, 25199.99, (price / 100) * 4 + 233)(price) +
    inRange(25200.0, 25299.99, (price / 100) * 4 + 233)(price) +
    inRange(25300.0, 25399.99, (price / 100) * 4 + 233)(price) +
    inRange(25400.0, 25499.99, (price / 100) * 4 + 233)(price) +
    inRange(25500.0, 25599.99, (price / 100) * 4 + 233)(price) +
    inRange(25600.0, 25699.99, (price / 100) * 4 + 233)(price) +
    inRange(25700.0, 25799.99, (price / 100) * 4 + 233)(price) +
    inRange(25800.0, 25899.99, (price / 100) * 4 + 233)(price) +
    inRange(25900.0, 25999.99, (price / 100) * 4 + 233)(price) +
    inRange(26000.0, 26099.99, (price / 100) * 4 + 233)(price) +
    inRange(26100.0, 26199.99, (price / 100) * 4 + 233)(price) +
    inRange(26200.0, 26299.99, (price / 100) * 4 + 233)(price) +
    inRange(26300.0, 26399.99, (price / 100) * 4 + 233)(price) +
    inRange(26400.0, 26499.99, (price / 100) * 4 + 233)(price) +
    inRange(26500.0, 26599.99, (price / 100) * 4 + 233)(price) +
    inRange(26600.0, 26699.99, (price / 100) * 4 + 233)(price) +
    inRange(26700.0, 26799.99, (price / 100) * 4 + 233)(price) +
    inRange(26800.0, 26899.99, (price / 100) * 4 + 233)(price) +
    inRange(26900.0, 26999.99, (price / 100) * 4 + 233)(price) +
    inRange(27000.0, 27099.99, (price / 100) * 4 + 233)(price) +
    inRange(27100.0, 27199.99, (price / 100) * 4 + 233)(price) +
    inRange(27200.0, 27299.99, (price / 100) * 4 + 233)(price) +
    inRange(27300.0, 27399.99, (price / 100) * 4 + 233)(price) +
    inRange(27400.0, 27499.99, (price / 100) * 4 + 233)(price) +
    inRange(27500.0, 27599.99, (price / 100) * 4 + 233)(price) +
    inRange(27600.0, 27699.99, (price / 100) * 4 + 233)(price) +
    inRange(27700.0, 10000000.0, (price / 100) * 4 + 233)(price);
  return Math.round(saleFee);
}
function inRange(min, max, val) {
  return function (num) {
    return num >= min && num <= max ? val : 0;
  };
}
export { auctions, calculateCopartFee, calculateIaaIFee, inRange };
window.auctions = auctions;
window.calculateCopartFee = calculateCopartFee;
window.calculateIaaIFee = calculateIaaIFee;
window.inRange = inRange;
