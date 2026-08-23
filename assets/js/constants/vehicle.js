// Тип кузова впливає на фрахт: пікап/вантажівка займають більше місця в
// контейнері. Надбавка лежить тут, поруч із самим типом, а не числом у
// oversizeFee() — так само, як сітки зборів переїхали до аукціонів.
//
// ⚠️ $300 — оцінка; у коміті 9572538 (2026-08-17) джерело не вказане.
// Див. docs/shipping-rates-baseline.md.
var vehicleTypes = [
  {
    id: "sedan",
    name: "Седан",
    oversizeFee: 0,
  },
  {
    id: "suv",
    name: "Кросовер / позашляховик",
    oversizeFee: 0,
  },
  {
    id: "pikap",
    name: "Пікап або вантажівка",
    oversizeFee: 300,
  },
];

// Невідомий id (застаріле сховище, ручна правка) не має обвалювати розрахунок —
// падаємо на перший тип, як це робить getAuctionById.
function getVehicleTypeById(id) {
  for (var i = 0; i < vehicleTypes.length; i++) {
    if (vehicleTypes[i].id === id) return vehicleTypes[i];
  }
  return vehicleTypes[0];
}

window.vehicleType = vehicleTypes;
window.vehicleTypes = vehicleTypes;
window.getVehicleTypeById = getVehicleTypeById;
export { vehicleTypes, getVehicleTypeById };
