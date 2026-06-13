var engineTypes = {
  Petrol: "petrol",
  Diesel: "diesel",
};

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
window.engineTypes = engineTypes;
window.engineVolumes = engineVolumes;
window.currentYear = currentYear;
window.manYearOptions = manYearOptions;
export { engineTypes, engineVolumes };
