// Кожен аукціон несе власну функцію збору покупця. Раніше auctionFee()
// в market.methods.js звірявся з `auctions[0].id` / `auctions[1].id` за
// індексом і при невідомому id не повертав нічого — тобто весь підсумок
// ставав NaN. Тепер сітка збору лежить поруч із самим аукціоном.
var auctions = [
  {
    id: "copart",
    name: "Copart",
    buyerFee: copartBuyerFee,
  },
  {
    id: "iaai",
    name: "IAAI",
    buyerFee: iaaiBuyerFee,
  },
];

// Повний збір покупця = базова сітка + надбавки аукціону.
// Надбавки (25 / 203 / 15 у Copart, 15 у IAAI) були зашиті числами в
// auctionFee() без пояснення; джерело так само не встановлене — див.
// docs/auction-fees-baseline.md.
function copartBuyerFee(price) {
  var fee = calculateCopartFee(price);
  if (price < 2000) return fee;
  if (price >= 8000 && price < 10000) return fee + 25;
  if (price >= 15000) return fee + 203;
  return fee + 15;
}

function iaaiBuyerFee(price) {
  return calculateIaaIFee(price) + IAAI_FLAT_FEES + iaaiInternetBidFee(price);
}

// Невідомий id (застаріле сховище, ручне втручання) не має обвалювати
// розрахунок у NaN — падаємо на перший аукціон у списку.
function getAuctionById(id) {
  for (var a = 0; a < auctions.length; a++) {
    if (auctions[a].id === id) return auctions[a];
  }
  return auctions[0];
}

// ⚠️ Сітка Copart НЕ звірена з офіційним джерелом — успадкована з коміту
// 2021 року, джерело не цитувалось жодного разу. Вторинні джерела дають
// помітно дорожчий публічний тариф (10% від ціни понад $5 000 плюс gate fee).
// Див. docs/auction-fees-baseline.md, розділ Copart.
var COPART_FEE_TABLE = [
  [0, 75.0],
  [100, 138.0],
  [200, 163.0],
  [300, 188.0],
  [400, 223.0],
  [500, 248.0],
  [550, 253.0],
  [600, 263.0],
  [700, 278.0],
  [800, 293.0],
  [900, 308.0],
  [1000, 343.0],
  [1200, 368.0],
  [1300, 383.0],
  [1400, 393.0],
  [1500, 413.0],
  [1600, 428.0],
  [1700, 438.0],
  [1800, 453.0],
  [2000, 473.0],
  [2400, 483.0],
  [2500, 498.0],
  [3000, 548.0],
  [3500, 598.0],
  [4000, 633.0],
  [4500, 658.0],
  [5000, 683.0],
  [6000, 728.0],
  [7500, 753.0],
  [10000, 788.0],
];
var COPART_PERCENT_FROM = 15000;
var COPART_PERCENT_RATE = 0.04;

function calculateCopartFee(price) {
  var flat = tableLookup(COPART_FEE_TABLE, price);
  if (price < COPART_PERCENT_FROM) return Math.round(flat);
  // Math.max, а не просто відсоток: 4% від $15 000 — це $600, тобто менше
  // за $788 на сходинці $10 000–14 999.99. Стара таблиця саме так і робила,
  // і збір ПАДАВ на $188 рівно тоді, коли авто дорожчало через $15 000.
  return Math.round(Math.max(flat, price * COPART_PERCENT_RATE));
}

// Офіційна сітка збору покупця IAA (Standard Volume). Станом на 04.11.2024
// таблиці для ліцензованих (low volume) і неліцензованих покупців ІДЕНТИЧНІ —
// звірено по обох сторінках iaai.com, див. docs/auction-fees-baseline.md.
//
// Формат: [нижня межа діапазону, збір]. Останній рядок — відсоток від ціни.
var IAAI_FEE_TABLE = [
  [0, 25.0],
  [50, 45.0],
  [100, 80.0],
  [200, 130.0],
  [300, 137.5],
  [350, 145.0],
  [400, 175.0],
  [450, 185.0],
  [500, 205.0],
  [550, 210.0],
  [600, 240.0],
  [700, 270.0],
  [800, 295.0],
  [900, 320.0],
  [1000, 375.0],
  [1200, 395.0],
  [1300, 410.0],
  [1400, 430.0],
  [1500, 445.0],
  [1600, 465.0],
  [1700, 485.0],
  [1800, 510.0],
  [2000, 535.0],
  [2400, 570.0],
  [2500, 610.0],
  [3000, 655.0],
  [3500, 705.0],
  [4000, 725.0],
  [4500, 750.0],
  [5000, 775.0],
  [5500, 800.0],
  [6000, 825.0],
  [6500, 845.0],
  [7000, 880.0],
  [7500, 900.0],
  [8000, 925.0],
  [8500, 945.0],
  [10000, 1000.0],
];
var IAAI_PERCENT_FROM = 15000;
var IAAI_PERCENT_RATE = 0.075;

// Фіксовані збори IAA за кожен лот: service $105 + environmental $15 +
// title-handling $20. Premium Imagery Set ($10) береться не завжди, тому
// сюди не входить.
var IAAI_FLAT_FEES = 105 + 15 + 20;

// Internet Bid Fee, тариф для НЕліцензованих покупців (для ліцензованого
// брокера він нижчий — це найдорожчий, тобто консервативний варіант).
var IAAI_INTERNET_BID_TABLE = [
  [0, 0],
  [2000, 100],
  [4000, 110],
  [6000, 125],
  [8000, 140],
];

function tableLookup(table, price) {
  var fee = table[0][1];
  for (var i = 0; i < table.length; i++) {
    if (price >= table[i][0]) fee = table[i][1];
  }
  return fee;
}

// Збір покупця IAA без фіксованих зборів і без internet bid fee.
function calculateIaaIFee(price) {
  if (price >= IAAI_PERCENT_FROM) {
    return Math.round(price * IAAI_PERCENT_RATE);
  }
  return Math.round(tableLookup(IAAI_FEE_TABLE, price));
}

function iaaiInternetBidFee(price) {
  return tableLookup(IAAI_INTERNET_BID_TABLE, price);
}

export {
  auctions,
  calculateCopartFee,
  calculateIaaIFee,
  getAuctionById,
  iaaiInternetBidFee,
};
window.auctions = auctions;
window.calculateCopartFee = calculateCopartFee;
window.calculateIaaIFee = calculateIaaIFee;
window.getAuctionById = getAuctionById;
window.iaaiInternetBidFee = iaaiInternetBidFee;
