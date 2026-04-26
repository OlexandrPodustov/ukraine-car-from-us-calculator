function createStorageService() {
  var KEY = "carCalcData";
  return {
    load: function () {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    save: function (data) {
      localStorage.setItem(KEY, JSON.stringify(data));
    }
  };
}
