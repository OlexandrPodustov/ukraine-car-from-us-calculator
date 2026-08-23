// Порти відправлення в США.
// `coast` визначає ставку океанського фрахту. Важливо: узбережжя береться саме
// з порту ВІДПРАВЛЕННЯ, а не зі штату аукціону — авто з Колорадо може їхати
// через Нью-Йорк, і тоді фрахт має бути східний, а не західний.
var shippingPorts = [
  { id: "new_york", name: "New York (NY)", coast: "east" },
  { id: "savannah", name: "Savannah (GA)", coast: "east" },
  { id: "los_angeles", name: "Los Angeles (CA)", coast: "west" },
  { id: "san_francisco", name: "San Francisco (CA)", coast: "west" },
  // { id: "houston", name: "Houston (TX)", coast: "gulf" },
];

// Порт відправлення за штатом аукціону.
//
// Довідник локацій має поле `toPort`, але воно суцільно -1 (обнулене
// 2026-08-17 разом із подвійним рахунком фрахту — див.
// docs/shipping-rates-baseline.md). Через це «оптимальний порт» ніколи не
// вибирався, і фрахт завжди рахувався за СХІДНИМ узбережжям — навіть для авто
// з Каліфорнії, де він на $650 дорожчий.
//
// Тут — лише маршрутизація «штат → порт», без жодних ставок: рейт бере
// oceanFreightRates за coast порту. Savannah і New York обидва east, тож для
// південного сходу змінюється тільки підпис плеча, не сума. Портів Мексиканської
// затоки в списку нема, тому TX/LA/OK поки їдуть через Нью-Йорк.
var portByState = {
  AK: "los_angeles",
  AZ: "los_angeles",
  CA: "los_angeles",
  HI: "los_angeles",
  ID: "los_angeles",
  MT: "los_angeles",
  NV: "los_angeles",
  OR: "los_angeles",
  UT: "los_angeles",
  WA: "los_angeles",
  WY: "los_angeles",
  AL: "savannah",
  FL: "savannah",
  GA: "savannah",
  MS: "savannah",
  NC: "savannah",
  SC: "savannah",
  TN: "savannah",
};

// Порт відправлення для штату; за замовчуванням — Нью-Йорк (східне узбережжя).
function portForState(state) {
  var code = (state == null ? "" : String(state)).trim().toUpperCase();
  return portByState[code] || "new_york";
}

// Порти призначення.
//
// Одеси в списку НЕМА і бути не має: з 2022 року в Україну не возять — порти
// під війною, лінійні перевізники в українські порти автовози не приймають, а
// «зерновий коридор» до RoRo/консолідованих контейнерів з авто не стосується.
// Історичні ставки на Одесу ($2500/3000/2700, успадковані з коміту 33b5526 без
// джерела) лишились тільки в docs/shipping-rates-baseline.md як запис — у
// розрахунку вони не беруть участі, щоб калькулятор не пропонував маршрут,
// яким авто не поїде.
//
// `toUkraine` — доставка автовозом від порту призначення до кордону України.
// Без цього плеча порівняння портів було б нечесним: дешевший фрахт до ЄС
// частково з'їдається дорогою до кордону.
var destinationPorts = [
  {
    id: "gdansk",
    name: "Гданськ (Польща)",
    toUkraine: 650,
    note: "Найкоротше плече до кордону, ~700 км автовозом",
  },
  {
    id: "klaipeda",
    name: "Клайпеда (Литва)",
    toUkraine: 700,
    note: "Найдешевший фрахт, далі ~1200 км автовозом",
  },
];

// Океанський фрахт за авто, USD: [порт призначення][узбережжя США].
// Консолідований контейнер (не RoRo, не окремий контейнер — там дорожче).
//
// ⚠️ Публічні джерела розходяться в 2–3 рази (див. docs/shipping-rates-baseline.md).
// Тут закладено збіжну середину, а не найнижчу з знайдених ставок.
// Для реального розрахунку став свою котировку в полі «Своя ставка фрахту».
var oceanFreightRates = {
  gdansk: { east: 1400, west: 2050, gulf: 1500 },
  klaipeda: { east: 1350, west: 2000, gulf: 1450 },
};

window.shippingPorts = shippingPorts;
window.portByState = portByState;
window.portForState = portForState;
window.destinationPorts = destinationPorts;
window.oceanFreightRates = oceanFreightRates;
export {
  shippingPorts,
  destinationPorts,
  oceanFreightRates,
  portByState,
  portForState,
};
