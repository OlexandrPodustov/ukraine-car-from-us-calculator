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

// Порти призначення.
// `toUkraine` — доставка автовозом від порту призначення до кордону України.
// Для Одеси це 0: порт уже в Україні, і внутрішня доставка по Україні
// врахована окремим рядком у total(). Для Клайпеди/Гданська це реальне
// міжнародне перевезення, без якого порівняння портів було б нечесним —
// дешевший фрахт до ЄС частково з'їдається цим плечем.
var destinationPorts = [
  {
    id: "odessa",
    name: "Одеса (Україна)",
    toUkraine: 0,
    note: "Прямо в Україну, але фрахт із воєнною надбавкою",
  },
  {
    id: "klaipeda",
    name: "Клайпеда (Литва)",
    toUkraine: 700,
    note: "Найдешевший фрахт, далі ~1200 км автовозом",
  },
  {
    id: "gdansk",
    name: "Гданськ (Польща)",
    toUkraine: 650,
    note: "Дешевший фрахт ніж Одеса, коротше плече до кордону",
  },
];

// Океанський фрахт за авто, USD: [порт призначення][узбережжя США].
// Одеса дорожча через воєнну надбавку на страхування — саме тому фрахт до
// ЄС «майже удвічі дешевший».
// Джерела та дата зрізу: docs/shipping-rates-baseline.md
var oceanFreightRates = {
  odessa: { east: 2500, west: 3000, gulf: 2700 },
  klaipeda: { east: 675, west: 1400, gulf: 725 },
  gdansk: { east: 1200, west: 1900, gulf: 1250 },
};

window.shippingPorts = shippingPorts;
window.destinationPorts = destinationPorts;
window.oceanFreightRates = oceanFreightRates;
export { shippingPorts, destinationPorts, oceanFreightRates };
