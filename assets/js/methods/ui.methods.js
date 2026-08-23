// Усі методи визначені в market.methods.js (див. CLAUDE.md); ці три файли лише
// розкладають їх по темах. Хелпер спільний і живе тут, бо ui.methods.js
// підключається першим із трьох.
window.pickMethods = function (names) {
  var all = window.__createAllMethods();
  var out = {};
  names.forEach(function (k) {
    if (all[k]) out[k] = all[k];
  });
  return out;
};

// Список експортується у window, щоб createMarketMethods() міг забрати
// ВСЕ ІНШЕ. Доки цей набір був третім явним переліком, новий метод не
// потрапляв на інстанс Vue взагалі, поки хтось не згадає дописати його ім'я.
window.uiMethodNames = [
  "saveToLocalStorage",
  "getCurrentLocation",
  "getCurrentPort",
  "onLocationBlur",
  "locationState",
  "onDeparturePortChange",
  "onLocationChange",
  "selectLocation",
  "getVal",
  "parseDollars",
];

window.createUiMethods = function () {
  return window.pickMethods(window.uiMethodNames);
};
export const createUiMethods = window.createUiMethods;
