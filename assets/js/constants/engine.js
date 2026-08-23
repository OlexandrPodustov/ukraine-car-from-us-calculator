var engineTypes = {
  Petrol: "petrol",
  Diesel: "diesel",
  Electric: "electric",
};

// Той самий перелік, але з підписами — для селекта «Тип палива». Раніше три
// <option> стояли в index.html окремим списком, тобто другою копією
// довідника; тест звіряє, що список покриває рівно значення engineTypes.
// Гібрид сюди НЕ входить: для митниці це його ДВЗ, а окремий прапорець
// customs.isHybrid потрібен лише для пошуку ціни на AUTO.RIA.
var engineTypeOptions = [
  { id: engineTypes.Petrol, name: "Бензин" },
  { id: engineTypes.Diesel, name: "Дизель" },
  { id: engineTypes.Electric, name: "Електро (EV)" },
];

var engineVolumes = [];
for (var i = 0.6; i <= 6.7; i = i + 0.1) {
  engineVolumes.push(i.toFixed(1));
}

var manYearOptions = [];
var currentYear = new Date().getFullYear();
for (var j = 0; j <= 20; j++) {
  manYearOptions.push(currentYear - j);
}
window.engineType = engineTypes;
window.engineTypeOptions = engineTypeOptions;
window.engineTypes = engineTypes;
window.engineVolumes = engineVolumes;
window.currentYear = currentYear;
window.manYearOptions = manYearOptions;
export { engineTypes, engineTypeOptions, engineVolumes };
