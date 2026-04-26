(function(){
var engineType = {
                  Petrol: "petrol",
                  Diesel: "diesel",
                };

                var engineVolumes = [];
                for (var i = 0.6; i <= 6.7; i = i + 0.1) {
                  engineVolumes.push(i.toFixed(1));
                }

                var manYearOptions = [];
                var currentYear = new Date().getFullYear();
                for (var i = 0; i <= 20; i++) {
                  manYearOptions.push(currentYear - i);
                }
window.engineType = engineType;
window.engineVolumes = engineVolumes;
window.currentYear = currentYear;
window.manYearOptions = manYearOptions;
})();
