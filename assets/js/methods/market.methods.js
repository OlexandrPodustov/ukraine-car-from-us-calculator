window.__createAllMethods = function () {
  return {
    saveToLocalStorage: function () {
      var dataToSave = {
        autoPricing: this.autoPricing,
        autoShipping: this.autoShipping,
        customs: this.customs,
        locationSearch: this.locationSearch,
        auctionUrl: this.auctionUrl,
        auctionStatus: this.auctionStatus,
        auctionMsg: this.auctionMsg,
        acv: this.acv,
        repairCost: this.repairCost,
        buyNowPrice: this.buyNowPrice,
        riskCoefficient: this.riskCoefficient,
        marketStatus: this.marketStatus,
        marketMsg: this.marketMsg,
        ukrainianMarketPrice: this.customs.ukrainianMarketPrice,
        marketCategory: this.customs.marketCategory,
      };
      localStorage.setItem("carCalcData", JSON.stringify(dataToSave));
      // console.log('[LocalStorage] Дані збережені');
    },
    parseAuctionLot: async function () {
      var vm = this;
      var url = (vm.auctionUrl || "").trim();
      console.log("[parseAuctionLot] Натиснуто кнопку Заповнити. URL:", url);
      if (!url) {
        vm.auctionStatus = "error";
        vm.auctionMsg = "⚠ Будь ласка, введіть посилання на лот Copart або IAAI";
        return;
      }

      var isIaai = /iaai\.com/i.test(url);
      var isCopart = /copart\.com/i.test(url);
      if (!isIaai && !isCopart) {
        vm.auctionStatus = "error";
        vm.auctionMsg = "⚠ Підтримується лише iaai.com та copart.com";
        return;
      }
      vm.auctionStatus = "loading";
      vm.auctionMsg = "⏳ Завантаження сторінки лоту…";
      vm.autoPricing.auctions.selected = isIaai ? "iaai" : "copart";

      // ── Fetch HTML ─────────────────────────────────────────────
      var html = "";
      var proxies = [
        typeof CONFIG !== "undefined" ? CONFIG.proxyUrl : null,
      ].filter(Boolean); // прибирає null якщо config.js відсутній
      // console.log('[proxies length] ###' + proxies.length);

      for (var pi = 0; pi < proxies.length && !html; pi++) {
        try {
          var ctrl = new AbortController();
          var tid = setTimeout(function () {
            ctrl.abort();
          }, 13000);
          var fullUrl = proxies[pi] + encodeURIComponent(url);
          // console.log('[proxy] ###' + pi + ' fetching:', fullUrl);

          var resp = await fetch(fullUrl, { signal: ctrl.signal });
          clearTimeout(tid);

          if (resp.ok) {
            var txt = await resp.text();
            console.log("[proxy] ###" + pi + " body length:", txt.length);

            var isCfBlocked = /just a moment|enable js|cloudflare/i.test(
              txt.slice(0, 3000),
            );
            console.log(
              "[proxy] ###" + pi + " cloudflare blocked:",
              isCfBlocked,
            );

            if (txt && txt.length > 2000 && !isCfBlocked) {
              html = txt;
              console.log("[proxy] ###" + pi + " ✅ accepted");
            } else {
              console.warn(
                "[proxy] ###" + pi + " ❌ rejected — length:",
                txt.length,
                "| cf blocked:",
                isCfBlocked,
              );
            }
          } else {
            console.warn("[proxy] ###" + pi + " ❌ HTTP error:", resp.status);
          }
        } catch (e) {
          console.warn("[proxy] #" + pi + " ❌ exception:", e.message);
        }
      }

      if (!html) {
        vm.auctionStatus = "error";
        vm.auctionMsg =
          "❌ Не вдалося завантажити сторінку (Cloudflare/бот-захист).";
        return;
      }

      // ── Parse JSON ────────────────────────────────
      try {
        var nextMatch =
          html.match(
            /<script[^>]+id="ProductDetailsVM"[^>]*>([\s\S]*?)<\/script>/,
          ) ||
          html.match(
            /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
          );

        if (!nextMatch) {
          vm.auctionStatus = "error";
          vm.auctionMsg =
            "❌ JSON не знайдено на сторінці. Структура змінилась?";
          return;
        }

        var nd;
        try {
          nd = JSON.parse(nextMatch[1]);
        } catch (e) {
          vm.auctionStatus = "error";
          vm.auctionMsg = "❌ Помилка парсингу JSON: " + e.message;
          return;
        }

        // Навігація по дереву до потрібних об'єктів
        var attrs = (nd.inventoryView || {}).attributes || {};
        var saleValues =
          ((nd.inventoryView || {}).saleInformation || {})["$values"] || [];
        var bidInfo = (nd.auctionInformation || {}).biddingInformation || {};

        console.log(
          "[parse] attrs.Year:",
          attrs.Year,
          "| attrs.FuelTypeCode:",
          attrs.FuelTypeCode,
          "| attrs.DisplLiters:",
          attrs.DisplLiters,
          "| attrs.BranchState:",
          attrs.BranchState,
          "| attrs.BodyStyleName:",
          attrs.BodyStyleName,
          "| attrs.Segment:",
          attrs.Segment,
        );
        console.log("[parse] saleValues:", saleValues);

        var acvVal = vm.parseDollars(vm.getVal(saleValues, "ActualCashValue"));
        var rcVal = vm.parseDollars(
          vm.getVal(saleValues, "EstimatedRepairCost"),
        );
        var bnp =
          vm.parseDollars(vm.getVal(saleValues, "BuyNowPrice")) ||
          parseInt(attrs.BuyNowAmount || 0);
        var minBid = parseInt(attrs.MinimumBidAmount || 0);

        var filled = [];

        if (acvVal >= 500) {
          vm.acv = acvVal;
          filled.push("ACV $" + acvVal);
        }
        if (rcVal > 0) {
          vm.repairCost = rcVal;
          filled.push("ремонт $" + rcVal);
        } else {
          vm.repairCost = 0;
        }
        if (bnp > 0) {
          vm.buyNowPrice = bnp;
          filled.push("BuyNow $" + bnp);
        }
        if (minBid > 0) {
          vm.autoPricing.autoPrice = minBid;
          filled.push("мін.ставка $" + minBid);
        }

        // ── Рік ────────────────────────────────────────────────────
        var year = parseInt(attrs.Year || bidInfo.year);
        if (year && window.manYearOptions.indexOf(year) !== -1) {
          vm.customs.manufactureYear = year;
          filled.push("рік " + year);
        }

        // ── Тип пального ───────────────────────────────────────────
        var fuelRaw = (
          attrs.FuelTypeCode ||
          attrs.FuelTypeDesc ||
          ""
        ).toLowerCase();
        if (/gasoline|gas/.test(fuelRaw)) {
          vm.customs.engineType = "petrol";
          filled.push("бензин");
        } else if (/diesel/.test(fuelRaw)) {
          vm.customs.engineType = "diesel";
          filled.push("дизель");
        } else if (/electric|ev/.test(fuelRaw)) {
          vm.customs.engineType = "electric";
          filled.push("електро");
        }

        // ── Об'єм двигуна ──────────────────────────────────────────
        // attrs.DisplLiters = "4.0L"
        if (!vm.isElectricEngine()) {
          var displStr = (attrs.DisplLiters || "").replace(/L$/i, "").trim();
          var displ = parseFloat(displStr);
          if (!displ) {
            // fallback: attrs.EngineSize = "4.0L V-8 ..."
            var engM = (attrs.EngineSize || "").match(/([0-9]\.[0-9])\s*L/i);
            if (engM) displ = parseFloat(engM[1]);
          }
          if (displ >= 0.6 && displ <= 6.6) {
            var dr = Math.round(displ * 10) / 10;
            var dc = vm.customs.engineVolumeOpts.reduce(function (a, b) {
              return Math.abs(+b - dr) < Math.abs(+a - dr) ? b : a;
            });
            vm.customs.engineVolume = dc;
            filled.push(dc + "л");
          }
        }

        // ── Тип авто ───────────────────────────────────────────────
        var bodyStyle = (
          attrs.BodyStyleName ||
          attrs.Segment ||
          ""
        ).toLowerCase();
        if (/pickup|truck/.test(bodyStyle)) {
          vm.autoShipping.vehicleType = "pikap";
          filled.push("пікап");
        } else if (/sport utility|suv|crossover/.test(bodyStyle)) {
          vm.autoShipping.vehicleType = "suv";
          filled.push("кросовер");
        } else if (bodyStyle) {
          vm.autoShipping.vehicleType = "sedan";
          filled.push("седан");
        }

        var priceFound = false;
        if (!priceFound) {
          var fallbackPrice =
            parseInt(attrs.MinimumBidAmount) || parseInt(bidInfo.buyNowAmount);
          if (fallbackPrice >= 500) {
            vm.autoPricing.autoPrice = fallbackPrice;
            filled.push("ціна $" + fallbackPrice);
          }
        }

        // ── Локація — BranchState + BranchName ─────────────────────
        // attrs.BranchState = "OR", attrs.Name/City = "Portland"
        // attrs.BranchName = "Portland (OR)"
        var stateCode = (attrs.BranchState || "").trim().toUpperCase();
        var cityName = (attrs.City || attrs.Name || "").trim().toUpperCase();
        var auctionKey = vm.autoPricing.auctions.selected.toUpperCase(); // "IAAI"

        var locFound = null;
        if (stateCode && cityName) {
          // Спробуй точний збіг: штат + місто + тип аукціону
          locFound = window.autoLocation.filter(function (l) {
            var n = l.name.toUpperCase();
            return (
              n.startsWith(stateCode + " ") &&
              n.indexOf(cityName) !== -1 &&
              n.indexOf(auctionKey) !== -1
            );
          })[0];
        }
        if (!locFound && stateCode) {
          // Fallback: просто штат + тип аукціону
          locFound = window.autoLocation.filter(function (l) {
            var n = l.name.toUpperCase();
            return (
              n.startsWith(stateCode + " ") && n.indexOf(auctionKey) !== -1
            );
          })[0];
        }
        if (locFound) {
          vm.autoShipping.location.selected = locFound.id;
          vm.locationSearch = locFound.name;
          vm.$nextTick(function () {
            vm.onLocationChange();
          });
          filled.push("локація " + stateCode);
        }

        // ── Make/Model + mileage для подальшого пошуку в UA ───────
        vm.customs.carrierInfo.make = (attrs.Make || "").trim();
        vm.customs.carrierInfo.model = (attrs.Model || "").trim();
        vm.customs.carrierInfo.color = (
          attrs.Color ||
          attrs.PrimaryDamage ||
          ""
        ).trim();
        vm.customs.carrierInfo.transmission = (attrs.Transmission || "").trim();
        var odo = parseInt(
          (attrs.Odometer || attrs.OdometerKM || attrs.OdometerMiles || "")
            .toString()
            .replace(/[^0-9]/g, ""),
        );
        if (!isNaN(odo) && odo > 0) vm.customs.carrierInfo.mileage = odo;

        // ── Make/Model для інформації ──────────────────────────────
        var carLabel = [attrs.Year, attrs.Make, attrs.Model]
          .filter(Boolean)
          .join(" ");
        if (carLabel) filled.push(carLabel);

        vm.auctionStatus = filled.length ? "ok" : "warn";
        vm.auctionMsg = filled.length
          ? "✅ " + filled.join(" · ")
          : "⚠ Дані з JSON не розпізнано. Заповніть вручну.";
      } catch (parseErr) {
        console.error("[parse] error:", parseErr);
        vm.auctionStatus = "error";
        vm.auctionMsg = "❌ Помилка парсингу: " + parseErr.message;
      }
    },
    marketPriceDifference: function () {
      return Math.round(
        (this.customs.ukrainianMarketPrice || 0) - this.total(),
      );
    },
    getMarketCacheKey: function (target) {
      return [
        "ukr_market_cache_v1",
        (target.make || "").toLowerCase(),
        (target.model || "").toLowerCase(),
        target.year || "",
        (target.engineType || "").toLowerCase(),
        target.engineVolume || "",
        target.batteryKwh || "",
      ].join("|");
    },
    getMarketCategoryByDiff: function (diff, totalCost) {
      if (!totalCost) return "fair";
      var ratio = diff / totalCost;
      if (Math.abs(ratio) <= 0.05) return "fair";
      return diff > 0 ? "underpriced" : "overpriced";
    },
    normalizeMarketTarget: function () {
      var make = ((this.customs.carrierInfo || {}).make || "").trim();
      var model = ((this.customs.carrierInfo || {}).model || "").trim();
      var year = parseInt(this.customs.manufactureYear || 0);
      var engineType = (this.customs.engineType || "").toLowerCase();
      var engineVolume = parseFloat(this.customs.engineVolume || 0);
      var batteryKwh = parseInt(this.customs.batteryKwh || 0);
      var mileage = parseInt((this.customs.carrierInfo || {}).mileage || 0);
      return {
        make: make,
        model: model,
        year: isNaN(year) ? 0 : year,
        engineType: engineType,
        engineVolume: isNaN(engineVolume) ? 0 : engineVolume,
        batteryKwh: isNaN(batteryKwh) ? 0 : batteryKwh,
        mileage: isNaN(mileage) ? 0 : mileage,
      };
    },
    readMarketCache: function (cacheKey) {
      try {
        var raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        var data = JSON.parse(raw);
        var ttlMs = 12 * 60 * 60 * 1000;
        if (
          !data ||
          !data.ts ||
          !data.medianPrice ||
          Date.now() - data.ts > ttlMs
        )
          return null;
        return data;
      } catch (e) {
        return null;
      }
    },
    writeMarketCache: function (cacheKey, payload) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(payload));
      } catch (e) {
        // ignore
      }
    },
    riaApiKey: function () {
      return typeof CONFIG !== "undefined" && CONFIG.autoRiaToken
        ? CONFIG.autoRiaToken
        : "";
    },
    riaFetchJson: async function (path) {
      // path = "/auto/..." з query-рядком, але БЕЗ api_key
      var key = this.riaApiKey();
      if (!key)
        throw new Error(
          "Не задано CONFIG.autoRiaToken для доступу до API AUTO.RIA",
        );
      var sep = path.indexOf("?") === -1 ? "?" : "&";
      var url =
        "https://developers.ria.com" +
        path +
        sep +
        "api_key=" +
        encodeURIComponent(key);
      var ctrl = new AbortController();
      var timeoutId = setTimeout(function () {
        ctrl.abort();
      }, 15000);
      try {
        var resp = await fetch(url, { signal: ctrl.signal });
        if (resp.status === 429)
          throw new Error("Перевищено ліміт запитів API AUTO.RIA (429).");
        if (resp.status === 400) {
          var errBody = null;
          try {
            errBody = await resp.json();
          } catch (e) {
            /* ignore */
          }
          var msg =
            errBody && errBody.message ? errBody.message : "Недостатньо даних";
          var e400 = new Error(msg);
          e400.notEnoughData = /not enough data/i.test(msg);
          throw e400;
        }
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return await resp.json();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    // ── Статичні довідники: кеш назавжди (марки/моделі майже не змінюються) ──
    readStaticCache: function (key) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    writeStaticCache: function (key, data) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {
        /* ignore */
      }
    },
    getRiaMarks: async function () {
      var KEY = "ria_marks_v1_cat1";
      var cached = this.readStaticCache(KEY);
      if (cached && cached.length) return cached;
      var data = await this.riaFetchJson("/auto/categories/1/marks");
      var list = Array.isArray(data) ? data : data.marks || [];
      if (list.length) this.writeStaticCache(KEY, list);
      return list;
    },
    getRiaModels: async function (markaId) {
      var KEY = "ria_models_v1_" + markaId;
      var cached = this.readStaticCache(KEY);
      if (cached && cached.length) return cached;
      var data = await this.riaFetchJson(
        "/auto/categories/1/marks/" + markaId + "/models",
      );
      var list = Array.isArray(data) ? data : data.models || [];
      if (list.length) this.writeStaticCache(KEY, list);
      return list;
    },
    normalizeName: function (s) {
      return (s || "")
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9а-яіїєґ]+/gi, " ")
        .trim();
    },
    // Підбір {value,name} зі списку довідника за назвою (марка/модель).
    // Трим-назви (напр. "M340I") часто не мають точної моделі в API —
    // тоді повертаємо null, і викликач відкочується на марку+рік.
    matchByName: function (list, query) {
      var q = this.normalizeName(query);
      if (!q || !list || !list.length) return null;
      var i, n;
      // 1) точний збіг назви
      for (i = 0; i < list.length; i++) {
        if (this.normalizeName(list[i].name) === q) return list[i];
      }
      // 2) одна назва містить іншу як ціле слово (виграє найдовша)
      var best = null,
        bestLen = 0;
      for (i = 0; i < list.length; i++) {
        n = this.normalizeName(list[i].name);
        if (!n) continue;
        if (
          (" " + q + " ").indexOf(" " + n + " ") !== -1 ||
          (" " + n + " ").indexOf(" " + q + " ") !== -1
        ) {
          if (n.length > bestLen) {
            best = list[i];
            bestLen = n.length;
          }
        }
      }
      return best;
    },
    applyMarketResult: function (price, category) {
      this.customs.ukrainianMarketPrice = price;
      var diff = this.marketPriceDifference();
      var cat = category || this.getMarketCategoryByDiff(diff, this.total());
      this.customs.marketCategory = cat;
      return cat;
    },
    // Лог результату пошуку в локальну SQLite (через server.js).
    // Fire-and-forget: якщо сервера нема (статика/python) — тихо ігнорується.
    logSearch: function (payload) {
      try {
        fetch("/api/searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(function () {});
      } catch (e) {
        /* ignore */
      }
    },
    lookupUkrainianPrice: async function () {
      var vm = this;
      vm.marketStatus = "loading";
      vm.marketMsg = "⏳ Пошук схожих авто на AUTO.RIA...";

      try {
        if (!vm.riaApiKey()) {
          vm.marketStatus = "error";
          vm.marketMsg =
            "❌ Не задано API-ключ AUTO.RIA (CONFIG.autoRiaToken).";
          return;
        }

        var target = vm.normalizeMarketTarget();
        if (!target.make || !target.model) {
          vm.marketStatus = "warn";
          vm.marketMsg =
            '⚠ Недостатньо даних: потрібні make/model з лоту. Спочатку натисніть "Зчитати".';
          return;
        }

        var cacheKey = vm.getMarketCacheKey(target);
        var cached = vm.readMarketCache(cacheKey);
        if (cached) {
          vm.applyMarketResult(cached.medianPrice, cached.marketCategory);
          vm.marketStatus = "ok";
          vm.marketMsg =
            "✅ Використано кеш AUTO.RIA: " +
            cached.sampleCount +
            " оголошень, ціна $" +
            cached.medianPrice;
          return;
        }

        // 1) Резолв марки (довідник кешується назавжди)
        var marks = await vm.getRiaMarks();
        var mark = vm.matchByName(marks, target.make);
        if (!mark) {
          vm.marketStatus = "warn";
          vm.marketMsg =
            "⚠ Марку «" + target.make + "» не знайдено в довіднику AUTO.RIA.";
          return;
        }

        // 2) Резолв моделі (best-effort; для тримів може лишитись null)
        var models = await vm.getRiaModels(mark.value);
        var model = vm.matchByName(models, target.model);

        // 3) average_price (кешуємо результат)
        var path =
          "/auto/average_price?main_category=1&marka_id=" + mark.value;
        if (model) path += "&model_id=" + model.value;
        if (target.year) {
          path +=
            "&yers%5B0%5D.gte=" +
            (target.year - 1) +
            "&yers%5B0%5D.lte=" +
            (target.year + 1);
        }

        var data;
        try {
          data = await vm.riaFetchJson(path);
        } catch (e) {
          if (e && e.notEnoughData) {
            vm.marketStatus = "warn";
            vm.marketMsg =
              "⚠ На AUTO.RIA замало даних для оцінки по цьому авто.";
            return;
          }
          throw e;
        }

        var price = Math.round(
          data.interQuartileMean ||
            data.arithmeticMean ||
            (data.percentiles && data.percentiles["50.0"]) ||
            0,
        );
        var total = data.total || 0;
        if (!price) {
          vm.marketStatus = "warn";
          vm.marketMsg = "⚠ Не вдалося обчислити ринкову ціну AUTO.RIA.";
          return;
        }

        var category = vm.applyMarketResult(price, null);
        vm.marketStatus = total < 5 ? "warn" : "ok";
        var modelNote = model
          ? ""
          : " (по марці+рік, модель «" + target.model + "» не зматчилась)";
        vm.marketMsg =
          (total < 5 ? "⚠ Мало даних: " : "✅ ") +
          "оцінка по " +
          total +
          " оголошеннях, медіана/IQ-середнє $" +
          price +
          modelNote;

        vm.writeMarketCache(cacheKey, {
          ts: Date.now(),
          medianPrice: price,
          sampleCount: total,
          marketCategory: category,
        });
        vm.saveToLocalStorage();

        vm.logSearch({
          make: target.make,
          model: target.model,
          year: target.year,
          engineType: target.engineType,
          engineVolume: target.engineVolume,
          markaId: mark.value,
          modelId: model ? model.value : null,
          modelMatched: !!model,
          marketPrice: price,
          sampleCount: total,
          arithmeticMean: Math.round(data.arithmeticMean || 0),
          iqMean: Math.round(data.interQuartileMean || 0),
          median: Math.round(
            (data.percentiles && data.percentiles["50.0"]) || 0,
          ),
          totalCost: vm.total(),
          diff: vm.marketPriceDifference(),
          category: category,
          prices: Array.isArray(data.prices) ? data.prices : [],
          percentiles: data.percentiles || null,
        });
      } catch (err) {
        vm.marketStatus = "error";
        vm.marketMsg =
          "❌ Помилка пошуку ціни на AUTO.RIA: " +
          (err && err.message ? err.message : "невідома помилка");
      }
    },

    auctionFee: function () {
      if (this.autoPricing.auctions.selected === window.auctions[0].id) {
        if (this.autoPricing.autoPrice < 2000) {
          return window.calculateCopartFee(this.autoPricing.autoPrice);
        }
        if (
          this.autoPricing.autoPrice >= 8000 &&
          this.autoPricing.autoPrice < 10000
        ) {
          return window.calculateCopartFee(this.autoPricing.autoPrice) + 25;
        }
        if (this.autoPricing.autoPrice >= 15000) {
          return window.calculateCopartFee(this.autoPricing.autoPrice) + 203;
        }
        return window.calculateCopartFee(this.autoPricing.autoPrice) + 15;
      } else if (this.autoPricing.auctions.selected === window.auctions[1].id) {
        return window.calculateIaaIFee(this.autoPricing.autoPrice) + 15;
      }
    },

    commissionBank: function () {
      var askss = Math.ceil((this.totalShippingFee() / 100) * 0.5);
      return Math.ceil(
        ((this.autoPricing.autoPrice + this.auctionFee()) / 100) * 0.5 +
          30 +
          askss,
      );
    },

    anzFee: function () {
      return this.autoPricing.autoPrice < 25000 ? 300 : 300;
    },

    strahovka: function () {
      var strah = Math.ceil(
        ((this.autoPricing.autoPrice + this.auctionFee()) / 100) * 2,
      );
      if (strah < 100) {
        strah = 100;
        return strah;
      } else {
        return strah;
      }
    },

    totalAutoFee: function () {
      return Math.round(
        this.autoPricing.autoPrice + this.auctionFee() + this.anzFee(),
      );
    },

    getCurrentLocation: function () {
      return window.autoLocation.filter(
        (loc) => loc.id === this.autoShipping.location.selected,
      )[0];
    },

    getCurrentPort: function () {
      var portid = this.autoShipping.shippingPort;
      return window.shippingPorts.filter(function (port) {
        return port.id === portid;
      })[0];
    },
    poshlina: function () {
      return (this.autoPricing.autoPrice + this.auctionFee() + 1000) * 10;
    },

    onLocationBlur: function () {
      var vm = this;
      setTimeout(function () {
        vm.locationDropOpen = false;
      }, 150);
    },
    onLocationChange: function () {
      var ports = this.shippingAllowedPorts();
      var location = this.getCurrentLocation();

      if (!ports || !ports.length) {
        if (window.shippingPorts && window.shippingPorts.length) {
          this.autoShipping.shippingPort = window.shippingPorts[0].id;
        }
        return;
      }

      var optimal = ports.reduce(function (acc, cur) {
        return location.toPort[cur.id] < location.toPort[acc.id] ? cur : acc;
      });

      this.autoShipping.shippingPort = optimal.id;
    },

    selectLocation: function (opt) {
      this.autoShipping.location.selected = opt.id;
      this.locationSearch = opt.name;
      this.locationDropOpen = false;
      this.onLocationChange();
    },
    mreo: function () {
      //  console.log(this.autoPricing.autoPrice)
      //  console.log(this.auctionFee())
      var mreo_tmp = 0;
      if (this.autoPricing.autoPrice < 13300) {
        mreo_tmp = Math.ceil(
          ((this.autoPricing.autoPrice + this.auctionFee() + 1000) / 100) * 3 +
            25,
        );
      } else if (
        this.autoPricing.autoPrice >= 13300 &&
        this.autoPricing.autoPrice < 23500
      ) {
        mreo_tmp = Math.ceil(
          ((this.autoPricing.autoPrice + this.auctionFee() + 1000) / 100) * 4 +
            25,
        );
      } else if (this.autoPricing.autoPrice >= 23500) {
        mreo_tmp = Math.ceil(
          ((this.autoPricing.autoPrice + this.auctionFee() + 1000) / 100) * 5 +
            25,
        );
      }
      return mreo_tmp;
    },

    shippingAllowedPorts: function () {
      var loc = this.getCurrentLocation();

      return window.shippingPorts.filter(function (port) {
        return loc.toPort[port.id] > 0;
      });
    },

    transportFee: function (port) {
      return this.getCurrentLocation().toPort[port.id];
    },

    freightFee: function (destination) {
      return this.getCurrentPort().toPort[destination.id];
    },

    totalShippingFee: function () {
      var location = this.getCurrentLocation();
      var dostavka = location[this.autoPricing.auctions.selected] || 1100;

      var freightFee =
        this.getCurrentPort().toPort[
          this.autoShipping.destinationPort.selected
        ];
      var vtFee =
        this.autoShipping.vehicleType == window.vehicleType[1].id
          ? 0
          : this.autoShipping.vehicleType == window.vehicleType[2].id
            ? 300
            : 0;

      // Океанський фрахт SUV → Одеса (2026)
      var locName = (
        this.getCurrentLocation() ? this.getCurrentLocation().name : ""
      ).toUpperCase();
      var isWest = /^(CA|WA|OR)\s/.test(locName);
      var isGulf = /^(TX|FL|LA|MS|AL)\s/.test(locName);
      var oceanKey = isWest ? "west" : isGulf ? "gulf" : "east";
      return freightFee + dostavka + vtFee + this.oceanFreight[oceanKey];
    },

    isElectricEngine: function () {
      return this.customs.engineType === "electric";
    },

    akcis: function () {
      /* eslint-disable no-redeclare */
      var engineVolumeNum = Number.parseFloat(this.customs.engineVolume) || 0;
      var age = window.currentYear - this.customs.manufactureYear;

      if (
        this.customs.engineType === window.engineType.Petrol ||
        window.engineType.Petrol3
      ) {
        var base = engineVolumeNum < 3.0 ? 56 : 112;

        var akcis = base * engineVolumeNum * (age > 0 ? age : 1);

        // eur to usd
        // akcis + nds + poshlina
      } else if (
        this.customs.engineType === window.engineType.Diesel ||
        window.engineType.Diesel3
      ) {
        var base = engineVolumeNum < 3.5 ? 84 : 150;

        var akcis = base * engineVolumeNum * (age > 0 ? age : 1);
        akcis = akcis * 1.13;
        // eur to usd
        // akcis + nds + poshlina
        var res = akcis + this.totalAutoFee() * 0.2 + this.totalAutoFee() * 0.1;
        return Math.round(res);
      }
    },

    totalCustomsFee: function () {
      var engineVolumeNum = Number.parseFloat(this.customs.engineVolume);

      var age = window.currentYear - this.customs.manufactureYear;

      if (this.customs.engineType === window.engineType.Petrol) {
        var base = engineVolumeNum < 3.2 ? 60 : 120;

        var akcis = base * engineVolumeNum * (age > 0 ? age : 1);

        // eur to usd
        // akcis + nds + poshlina
        var poshlina =
          ((this.autoPricing.autoPrice + this.auctionFee() + 1000) / 100) * 10;
        var nds =
          ((this.autoPricing.autoPrice +
            this.auctionFee() +
            1000 +
            poshlina +
            akcis) /
            100) *
          20;

        var res = akcis + nds + poshlina; // + 150
        //  console.log("posl: " + poshlina + " | nds: " + nds + " | akcis: " + akcis);
        return Math.round(res);
      } else if (this.customs.engineType === window.engineType.Diesel) {
        var base = engineVolumeNum < 3.5 ? 90 : 180;

        var akcis = base * engineVolumeNum * (age > 0 ? age : 1);

        // eur to usd
        // akcis + nds + poshlina
        var poshlina =
          ((this.autoPricing.autoPrice + this.auctionFee() + 1000) / 100) * 10;
        var nds =
          ((this.autoPricing.autoPrice +
            this.auctionFee() +
            1000 +
            poshlina +
            akcis) /
            100) *
          20;

        var res = akcis + nds + poshlina; // + 150
        return Math.round(res);
      } else {
        // electric — повна формула (акциз НБУ + ПДВ 20%)
        var excisEur = 1.0 * this.customs.batteryKwh * Math.max(age, 1);
        var excisUsd = excisEur * this.eurUsd;
        var duty = 0;
        var customsBase = this.autoPricing.autoPrice + this.auctionFee() + 1000;
        var vat = (customsBase + duty + excisUsd) * 0.2;
        var pension = customsBase * 0.01;
        return Math.round(duty + excisUsd + vat + pension);
      }
    },

    pensionFee() {
      var price = this.totalAutoFee();
      var result = price > 10000 ? price * 0.05 : price * 0.03;

      return Math.round(result);
    },

    totalCost: function () {
      return (
        this.totalShippingFee() +
        this.totalAutoFee() +
        this.totalCustomsFee() +
        this.portExpeditor +
        this.portBrokerFee +
        this.portParking +
        this.legalCert +
        this.legalRegistration +
        this.pensionFee()
      );
    },

    cleanValue: function () {
      return Math.round(this.acv - this.repairCost);
    },
    benefit: function () {
      return Math.round(this.cleanValue() - this.total());
    },
    maxBid: function () {
      return Math.round((this.acv - this.repairCost) * this.riskCoefficient);
    },
    getVal: function (arr, keyName) {
      var item = arr.find(function (x) {
        return x && x.key === keyName;
      });
      return item ? item.value || "" : "";
    },
    parseDollars: function (str) {
      var n = parseInt((str || "").replace(/[^0-9]/g, ""));
      return isNaN(n) ? 0 : n;
    },
    recalcMaxBid: function () {
      this.autoPricing.autoPrice = this.maxBid();
      this.saveToLocalStorage();
    },

    total: function () {
      let inPortParking = 44;
      //calc
      // Vue викликає методи з шаблону при кожному ререндері, а ререндер відбувається при будь-якій зміні даних
      // console.log(`total ${this.autoPricing.autoPrice} + ${this.auctionFee()} + ${this.commissionBank()} + ${this.strahovka()} + ${this.totalShippingFee()} + ${this.totalCustomsFee()} + ${550} + ${inPortParking} + ${250} + ${250} + ${this.mreo()} + ${this.anzFee()}`)
      return Math.floor(
        this.autoPricing.autoPrice +
          this.auctionFee() +
          this.commissionBank() +
          this.strahovka() +
          this.totalShippingFee() +
          this.totalCustomsFee() +
          550 +
          inPortParking +
          250 +
          250 +
          this.mreo() +
          this.anzFee(),
      );
    },
  };
};
export function createMarketMethods() {
  var all = __createAllMethods();
  var pick = [
    "parseAuctionLot",
    "marketPriceDifference",
    "getMarketCacheKey",
    "getMarketCategoryByDiff",
    "normalizeMarketTarget",
    "readMarketCache",
    "writeMarketCache",
    "riaApiKey",
    "riaFetchJson",
    "readStaticCache",
    "writeStaticCache",
    "getRiaMarks",
    "getRiaModels",
    "normalizeName",
    "matchByName",
    "applyMarketResult",
    "logSearch",
    "lookupUkrainianPrice",
  ];
  var out = {};
  pick.forEach(function (k) {
    if (all[k]) out[k] = all[k];
  });
  return out;
}
window.createMarketMethods = createMarketMethods;
