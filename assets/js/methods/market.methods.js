// Незв'язані методи для пробних розрахунків (див. totalForPrice). Vue 2
// прив'язує кожен метод до інстансу через bind, тому «підмінити» this у
// vm.total() неможливо — потрібні саме сирі функції.
var rawMethodsCache = null;

window.__createAllMethods = function () {
  return {
    // Зріз формує storage.service.js — там же задокументовано, чому в
    // localStorage не потрапляють довідники (списки локацій/портів/років).
    saveToLocalStorage: function () {
      localStorage.setItem(
        "carCalcData",
        JSON.stringify(window.pickPersistedState(this)),
      );
    },
    parseAuctionLot: async function () {
      var vm = this;
      var url = (vm.auctionUrl || "").trim();
      console.log("[parseAuctionLot] Натиснуто кнопку Заповнити. URL:", url);
      if (!url) {
        vm.auctionStatus = "error";
        vm.auctionMsg =
          "⚠ Будь ласка, введіть посилання на лот Copart або IAAI";
        return;
      }

      var isIaai = /iaai\.com/i.test(url);
      var isCopart = /copart\.com/i.test(url);
      if (!isIaai && !isCopart) {
        vm.auctionStatus = "error";
        vm.auctionMsg = "⚠ Підтримується лише iaai.com та copart.com";
        return;
      }
      // Два парсинги одночасно писали б в один і той самий vm (і в БД) —
      // paste запускає парсинг, а проксі відповідає до 13 с.
      if (vm.auctionStatus === "loading") {
        console.warn("[parseAuctionLot] Уже триває парсинг — пропускаю");
        return;
      }
      vm.auctionStatus = "loading";
      vm.auctionMsg = "⏳ Завантаження сторінки лоту…";
      vm.autoPricing.auctions.selected = isIaai ? "iaai" : "copart";

      // Скидаємо всі дані попереднього лоту — щоб поля, яких нема на новій
      // сторінці, не «прилипали» від попереднього авто.
      vm.resetLotData();

      // ── Fetch HTML ─────────────────────────────────────────────
      var html = "";
      var proxies = [
        typeof CONFIG !== "undefined" ? CONFIG.proxyUrl : null,
      ].filter(Boolean); // прибирає null якщо config.js відсутній
      // console.log('[proxies length] ###' + proxies.length);

      for (var pi = 0; pi < proxies.length && !html; pi++) {
        // let, а не var: колбек таймера замикається саме на своєму ctrl.
        // З var усі ітерації ділили б одну змінну, і таймер першої проксі
        // обірвав би запит наступної.
        let ctrl = new AbortController();
        // Таймер знімається у finally: при винятку в fetch (обрив, CORS) він
        // раніше лишався жити й через 13 с смикав abort() уже нікому.
        let tid = setTimeout(function () {
          ctrl.abort();
        }, 13000);
        try {
          var fullUrl = proxies[pi] + encodeURIComponent(url);
          // console.log('[proxy] ###' + pi + ' fetching:', fullUrl);

          var resp = await fetch(fullUrl, { signal: ctrl.signal });

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
        } finally {
          clearTimeout(tid);
        }
      }

      if (!html) {
        vm.auctionStatus = "error";
        vm.auctionMsg =
          "❌ Не вдалося завантажити сторінку (Cloudflare/бот-захист).";
        return;
      }

      // ── Parse JSON ────────────────────────────────
      var nextMatch =
        html.match(
          /<script[^>]+id="ProductDetailsVM"[^>]*>([\s\S]*?)<\/script>/,
        ) ||
        html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

      if (!nextMatch) {
        vm.auctionStatus = "error";
        vm.auctionMsg = "❌ JSON не знайдено на сторінці. Структура змінилась?";
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

      vm.applyLotJson(nd, url, { save: true });
    },

    // Заповнює форму з JSON лота. Винесено з parseAuctionLot окремо, бо той
    // самий JSON уже лежить у БД (`raw_json`): збережений лот можна перерахувати
    // без повторного скрейпу через проксі — сторінка лоту може бути вже знята
    // з торгів або закрита Cloudflare.
    //
    // `opts.save === false` — не писати лот у БД (він звідти ж і прийшов).
    applyLotJson: function (nd, url, opts) {
      var vm = this;
      var save = !opts || opts.save !== false;
      // Скидаємо все з попереднього лота і тут теж: parseAuctionLot робить це
      // до фетчу (щоб екран очистився одразу), а завантаження збереженого
      // лота приходить сюди навпростець.
      vm.resetLotData();
      try {
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
        // Порядок перевірок важливий: IAAI пише гібриди як «HYBRID»,
        // «GAS/ELECTRIC», «PLUG-IN HYBRID». «GAS/ELECTRIC» містить і gas, і
        // electric, тож без окремої гілки лот міг стати то бензиновим (за
        // збігом правильно), то електричним (акциз за неіснуючу батарею).
        var fuelRaw = (
          attrs.FuelTypeCode ||
          attrs.FuelTypeDesc ||
          ""
        ).toLowerCase();
        // HybridIndicator — явне поле IAAI; розбір назви палива лишається
        // запасним варіантом (Copart і старі лоти його не мають).
        var hybridFlag = vm.pickAttr(attrs.HybridIndicator);
        var isHybrid = hybridFlag
          ? hybridFlag === "True"
          : /hybrid|hev|gas\s*\/\s*electric|electric\s*\/\s*gas/.test(fuelRaw);
        vm.customs.isHybrid = isHybrid;
        if (isHybrid) {
          // Для митниці гібрид — це його ДВЗ (ПКУ 215.3.5-1), тож ставимо
          // бензин/дизель за об'ємом. Для AUTO.RIA це окремий сегмент —
          // туди прапорець isHybrid іде фільтром «Гібрид».
          vm.customs.engineType = /diesel/.test(fuelRaw) ? "diesel" : "petrol";
          filled.push("гібрид (акциз за ДВЗ)");
        } else if (/electric|^ev$|\bev\b/.test(fuelRaw)) {
          vm.customs.engineType = "electric";
          filled.push("електро");
        } else if (/diesel/.test(fuelRaw)) {
          vm.customs.engineType = "diesel";
          filled.push("дизель");
        } else if (/gasoline|gas/.test(fuelRaw)) {
          vm.customs.engineType = "petrol";
          filled.push("бензин");
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

        // Стартова ціна: мінімальна ставка вже підставлена вище, тому тут
        // лишається тільки Buy Now з auctionInformation. Раніше ця гілка
        // сиділа під `if (!priceFound)` з priceFound, що завжди був false, і
        // вдруге писала ту саму MinimumBidAmount — у статусі виходило
        // «мін.ставка $X · ціна $X».
        if (!(minBid > 0)) {
          var fallbackPrice = parseInt(bidInfo.buyNowAmount);
          if (fallbackPrice >= 500) {
            vm.autoPricing.autoPrice = fallbackPrice;
            filled.push("ціна $" + fallbackPrice);
          }
        }

        // ── Локація ────────────────────────────────────────────────
        // attrs.State/City — де авто СТОЇТЬ, attrs.BranchState — де філія.
        // Для offsite-лотів вони різні (Porsche 46380419: авто в Yonkers NY,
        // філія «Dream Rides» IL), а інланд-фрахт рахується від авто.
        var locFound = vm.matchAuctionLocation(attrs);
        if (locFound) {
          vm.autoShipping.location.selected = locFound.id;
          vm.locationSearch = locFound.name;
          vm.$nextTick(function () {
            vm.onLocationChange();
          });
          filled.push(
            "локація " +
              locFound.name +
              (vm.locationMatchIsWeak(attrs, locFound)
                ? " ⚠ (підібрано лише за штатом — звірте філію)"
                : ""),
          );
        }
        // Offsite: філія і місце зберігання різні — попереджаємо, бо саме
        // звідси рахується доставка до порту.
        if (vm.pickAttr(attrs.OffsiteSaleInd, attrs.IsOffsite) === "True") {
          filled.push(
            "⚠ offsite (" +
              vm.pickAttr(attrs.City, attrs.Name) +
              ", " +
              vm.pickAttr(attrs.State, attrs.BranchState) +
              ") — перевірте локацію",
          );
        }

        // ── Make/Model + mileage для подальшого пошуку в UA ───────
        vm.customs.carrierInfo.make = vm.pickAttr(attrs.Make);
        vm.customs.carrierInfo.model = vm.pickAttr(attrs.Model);
        vm.customs.carrierInfo.color = vm.pickAttr(
          attrs.ExteriorColor,
          attrs.Color,
        );
        vm.customs.carrierInfo.transmission = vm.pickAttr(
          attrs.TransmissionDesc,
          attrs.Transmission,
        );
        // Пробіг — це фільтр raceInt для AUTO.RIA. Раніше читався неіснуючий
        // attrs.Odometer, тож для жодного лоту IAAI не заповнювався, і
        // медіана рахувалась по авто з будь-яким пробігом.
        var odo = vm.parseOdometer(attrs);
        if (odo > 0) {
          vm.customs.carrierInfo.mileage = odo;
          filled.push("пробіг " + odo.toLocaleString("en-US") + " mi");
        }

        // ── Make/Model для інформації ──────────────────────────────
        var carLabel = [attrs.Year, attrs.Make, attrs.Model]
          .filter(Boolean)
          .join(" ");
        if (carLabel) filled.push(carLabel);

        vm.auctionStatus = filled.length ? "ok" : "warn";
        if (!filled.length) {
          // Розбір заточений під структуру IAAI (inventoryView.attributes).
          // Copart віддає __NEXT_DATA__ з іншим деревом — ключі в консоль,
          // щоб було з чого починати, якщо доведеться його підтримати.
          console.warn(
            "[parse] структуру не розпізнано; ключі JSON:",
            Object.keys(nd || {}),
          );
        }
        vm.auctionMsg = filled.length
          ? "✅ " + filled.join(" · ")
          : "⚠ Структура сторінки (" +
            (vm.autoPricing.auctions.selected || "?").toUpperCase() +
            ") не розпізнана — заповніть поля вручну.";

        // Зберігаємо ВЕСЬ лот (включно з HD-фото/відео) у локальну БД.
        // url береться з локальної змінної, а не з vm.auctionUrl: парсинг
        // асинхронний (проксі ~13 с), і якщо за цей час у поле щось вставили
        // (а paste ще й перезапускає парсинг), у БД потрапляв уже новий текст.
        var lotData = vm.collectLotData(nd, attrs, saleValues, url);
        vm.currentLot = {
          auction: lotData.auction || "",
          lotNumber: lotData.lotNumber || "",
          vin: lotData.vin || "",
        };
        vm.lotCondition = {
          damage: lotData.primaryDamage || "",
          secondaryDamage: lotData.secondaryDamage || "",
          lossType: lotData.lossType || "",
          runAndDrive: lotData.runAndDrive || "",
          keys: lotData.hasKeys || "",
          airbags: lotData.airbags || "",
          grade: lotData.vehicleGrade || "",
          odometer: lotData.odometer || 0,
          odometerBrand: lotData.odometerBrand || "",
          titleCode: lotData.titleCode || "",
          starts: lotData.starts || "",
          catalyticConverter: lotData.catalyticConverter || "",
          cat: lotData.catIndicator ? "True" : "",
          keyFob: lotData.keyFob || "",
          titleNotes: lotData.titleNotes || "",
          titleSaleDoc: lotData.titleSaleDoc || "",
          wheels: lotData.wheels || "",
          whoCanBuy: lotData.whoCanBuy || "",
        };
        if (save) vm.logLot(lotData);

        // Персистимо зчитані поля (рік/марку/модель/двигун…) у localStorage,
        // щоб після перезавантаження сторінки вони не повертались до старих
        // значень — інакше наступний пошук ціни піде по неправильному року.
        vm.saveToLocalStorage();
      } catch (parseErr) {
        console.error("[parse] error:", parseErr);
        vm.auctionStatus = "error";
        vm.auctionMsg = "❌ Помилка парсингу: " + parseErr.message;
      }
    },
    // Відкриття калькулятора з ?lot=<id> — заповнити форму зі збереженого
    // лота (кнопка «Порахувати» на lots.html). Жодних звернень до аукціону:
    // весь JSON уже в БД.
    loadSavedLot: async function (id) {
      var vm = this;
      vm.auctionStatus = "loading";
      vm.auctionMsg = "⏳ Завантаження збереженого лота №" + id + "…";
      try {
        var res = await vm.apiFetch("/api/lots/" + id);
        var row = await res.json();
        if (!row || !row.raw) {
          vm.auctionStatus = "error";
          vm.auctionMsg = "❌ У збереженого лота немає сирого JSON.";
          return false;
        }
        vm.auctionUrl = vm.sanitizeLotUrl(row.url);
        // Аукціон беремо з рядка БД. Без цього збережений лот розбирався під
        // тим аукціоном, який лишився в сховищі (за замовчуванням Copart):
        // сітка зборів, локація й наземне плече бралися чужі, посилання
        // «сторінка лоту» вело на copart.com, а наступний пошук ціни не
        // знаходив лот за парою (аукціон, номер) і лишався без прив'язки.
        if (
          row.auction &&
          window.getAuctionById(row.auction).id === row.auction
        )
          vm.autoPricing.auctions.selected = row.auction;
        vm.applyLotJson(row.raw, row.url, { save: false });
        return true;
      } catch (e) {
        vm.auctionStatus = "error";
        vm.auctionMsg =
          "❌ Не вдалося завантажити лот із БД (" +
          e.message +
          "). Запущено `npm start`?";
        return false;
      }
    },
    // Вставка в поле запускає парсинг автоматично — але лише якщо вставили
    // саме посилання на лот. Інакше вставка чогось стороннього (наприклад,
    // скопійованого тексту сторінки) підмінювала статус і сам URL лоту.
    onAuctionUrlPaste: function () {
      var v = (this.auctionUrl || "").trim();
      if (!/^https?:\/\/[^\s]*(iaai|copart)\.com/i.test(v)) return;
      this.parseAuctionLot();
    },
    // Рядки для блоку «Стан лота» — порожні поля просто не показуємо.
    lotConditionRows: function () {
      var c = this.lotCondition || {};
      function yesNo(v, yes, no) {
        if (v === "True") return yes;
        if (v === "False") return no;
        return "";
      }
      return [
        {
          label: "Пошкодження",
          value: [c.damage, c.secondaryDamage].filter(Boolean).join(" + "),
        },
        { label: "Тип збитку", value: c.lossType },
        // Стихійне лихо (повінь/град) окремим рядком: для імпорту це
        // найчастіше стоп, а не знижка.
        {
          label: "CAT-лот",
          value: c.cat === "True" ? "⚠ так (стихійне лихо)" : "",
        },
        { label: "Заводиться/їде", value: yesNo(c.runAndDrive, "так", "ні") },
        {
          label: "Заводиться",
          value: /start/i.test(c.starts || "") ? "так" : c.starts,
        },
        { label: "Ключі", value: yesNo(c.keys, "є", "нема") },
        { label: "Брелок", value: yesNo(c.keyFob, "є", "нема") },
        {
          label: "Каталізатор",
          value:
            c.catalyticConverter === "Present"
              ? "на місці"
              : c.catalyticConverter,
        },
        {
          label: "Подушки",
          value:
            c.airbags === "Intact"
              ? "цілі"
              : c.airbags === "Deployed"
                ? "спрацювали"
                : c.airbags,
        },
        { label: "Grade", value: c.grade },
        {
          label: "Пробіг",
          value: c.odometer
            ? c.odometer.toLocaleString("en-US") +
              " mi" +
              (c.odometerBrand ? " (" + c.odometerBrand + ")" : "")
            : "",
        },
        { label: "Колеса", value: c.wheels },
        { label: "Тайтл", value: c.titleCode },
        { label: "Документ на авто", value: c.titleSaleDoc },
        { label: "Примітка до тайтла", value: c.titleNotes },
        // Порожній список = обмежень немає; показуємо лише коли вони є.
        { label: "Купувати може", value: c.whoCanBuy },
      ].filter(function (r) {
        return r.value;
      });
    },
    // Скільки грошей реально вкладено в авто: розмитнений кошт ПЛЮС ремонт.
    // Для салведж-лота це різні речі — total() доводить розбите авто до
    // України, а продати його можна лише полагодженим.
    totalWithRepair: function () {
      var repair = Number(this.repairCost) || 0;
      return this.total() + (repair > 0 ? repair : 0);
    },
    // Ринкова ціна на AUTO.RIA — це ціна ЦІЛОГО авто, тож віднімати від неї
    // треба весь вкладений кошт разом із ремонтом. Раніше тут стояв
    // total() без ремонту: на типовому салведжі ($9k ремонту) різниця
    // виходила втричі оптимістичнішою за реальну, і кожен лот виглядав
    // вигідним. `benefit()` рахував це правильно з самого початку
    // (ACV − ремонт − total), тож дві головні цифри на екрані ще й
    // суперечили одна одній.
    marketPriceDifference: function () {
      return Math.round(
        (this.customs.ukrainianMarketPrice || 0) - this.totalWithRepair(),
      );
    },
    // Ключ кешу мусить містити ВСЕ, що впливає на запит до RIA. Пробіг і
    // коробка потрапляють у фільтри (raceInt, gear_id), тож без них два лоти
    // однієї моделі й року — скажімо, M340i з 40k і зі 100k миль — читали б
    // одну й ту саму ціну з кешу. Пробіг округлюємо до 10 тис. км: діапазон
    // запиту й так ±30 тис., дрібніші відмінності лише дробили б кеш, а він
    // тут обов'язковий (безкоштовний тариф API лімітований погодинно).
    getMarketCacheKey: function (target) {
      var km = target.mileage
        ? Math.round((target.mileage * 1.60934) / 10000)
        : "";
      return [
        "ukr_market_cache_v2",
        (target.make || "").toLowerCase(),
        (target.model || "").toLowerCase(),
        target.year || "",
        (target.engineType || "").toLowerCase(),
        target.isHybrid ? "hybrid" : "",
        target.engineVolume || "",
        target.batteryKwh || "",
        km,
        (target.transmission || "").toLowerCase().slice(0, 4),
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
      var isHybrid = this.customs.isHybrid === true;
      var mileage = parseInt((this.customs.carrierInfo || {}).mileage || 0);
      var transmission = ((this.customs.carrierInfo || {}).transmission || "")
        .toString()
        .trim();
      return {
        make: make,
        model: model,
        year: isNaN(year) ? 0 : year,
        engineType: engineType,
        isHybrid: isHybrid,
        engineVolume: isNaN(engineVolume) ? 0 : engineVolume,
        batteryKwh: isNaN(batteryKwh) ? 0 : batteryKwh,
        mileage: isNaN(mileage) ? 0 : mileage,
        transmission: transmission,
      };
    },
    // Записи попередньої версії ключа (без пробігу) вже ніколи не збігуться —
    // прибираємо їх, щоб не займали місце в localStorage.
    purgeLegacyMarketCache: function () {
      try {
        var doomed = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("ukr_market_cache_v1|") === 0) doomed.push(k);
        }
        doomed.forEach(function (k) {
          localStorage.removeItem(k);
        });
        return doomed.length;
      } catch (e) {
        return 0;
      }
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
        // Два РІЗНІ стани, які легко переплутати:
        // 429 «Переліміт погодинного обмеження» — минає з наступною годиною;
        // 403 (у curl — 200 з полем error «У Вашому пакеті закінчились запити»)
        // — вичерпаний пакет тарифу, сам по собі за годину НЕ відновиться.
        if (resp.status === 429) {
          var eHour = new Error(
            "Погодинний ліміт AUTO.RIA (429) — спробуй за годину.",
          );
          eHour.rateLimited = true;
          throw eHour;
        }
        if (resp.status === 403) {
          var eQuota = new Error(
            "AUTO.RIA (403): пакет неактивний — вичерпано або сплив термін дії. " +
              "Продовж безкоштовний пакет у кабінеті developers.ria.com.",
          );
          eQuota.rateLimited = true;
          eQuota.quotaDrained = true;
          throw eQuota;
        }
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
        var body = await resp.json();
        // Вичерпаний пакет запитів приходить як HTTP 200 з полем error —
        // без цієї перевірки він виглядав би як порожня вибірка.
        if (body && body.error) {
          var eLimit = new Error("AUTO.RIA: " + body.error);
          eLimit.rateLimited = true;
          eLimit.quotaDrained = !/погодин/i.test(body.error);
          throw eLimit;
        }
        return body;
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
    getRiaFuels: async function () {
      var KEY = "ria_fuels_v1";
      var cached = this.readStaticCache(KEY);
      if (cached && cached.length) return cached;
      var data = await this.riaFetchJson("/auto/type");
      var list = Array.isArray(data) ? data : data.types || [];
      if (list.length) this.writeStaticCache(KEY, list);
      return list;
    },
    getRiaGearboxes: async function () {
      var KEY = "ria_gearboxes_v1";
      var cached = this.readStaticCache(KEY);
      if (cached && cached.length) return cached;
      var data = await this.riaFetchJson("/auto/categories/1/gearboxes");
      var list = Array.isArray(data) ? data : data.gearboxes || [];
      if (list.length) this.writeStaticCache(KEY, list);
      return list;
    },
    // Резолв моделі: спершу точний/підрядковий збіг; якщо нема (трим на кшталт
    // M340I) — евристика по марці до базової моделі. Повертає {model, base}.
    resolveBaseModel: function (make, model, models) {
      var direct = this.matchByName(models, model);
      if (direct) return { model: direct, base: false };
      var mk = (make || "").toLowerCase();
      var m = (model || "").toUpperCase().replace(/\s+/g, "");
      // BMW: числові трими (M340I, 330I, 540I, 320D) → "{N} Series".
      // Додавати правила інших брендів за потреби.
      if (mk === "bmw") {
        var mm = m.match(/^[A-Z]?(\d)\d\d/);
        if (mm) {
          var series = this.matchByName(models, mm[1] + " Series");
          if (series) return { model: series, base: true };
        }
      }
      return { model: null, base: false };
    },
    // Будує робочі фільтри average_price (перевірено емпірично, що діють лише
    // fuel_id, gear_id, raceInt — body/drive/engineVolume/custom RIA ігнорує).
    buildRiaFilters: async function (target) {
      var vm = this;
      var f = {
        fuel: "",
        gear: "",
        mileage: "",
        fuelLabel: "",
        gearLabel: "",
        mileageLabel: "",
      };
      // Гібрид перебиває тип ДВЗ: на AUTO.RIA це окремий fuel_id, і
      // бензиновий Camry з гібридним у ціні розходяться відчутно. До появи
      // прапорця гілка «hybrid» тут була недосяжна — engineType може бути
      // лише petrol/diesel/electric.
      var fuelKw = target.isHybrid
        ? "Гібрид"
        : {
            petrol: "Бензин",
            diesel: "Дизель",
            electric: "Електро",
          }[target.engineType];
      if (fuelKw) {
        var fm = vm.matchByName(await vm.getRiaFuels(), fuelKw);
        if (fm) {
          f.fuel = "&fuel_id%5B0%5D=" + fm.value;
          f.fuelLabel = fuelKw.toLowerCase();
        }
      }
      var tx = (target.transmission || "").toLowerCase();
      var gearKw = /auto|автомат|типтрон/.test(tx)
        ? "Автомат"
        : /manual|механ/.test(tx)
          ? "Ручна"
          : "";
      if (gearKw) {
        var gm = vm.matchByName(await vm.getRiaGearboxes(), gearKw);
        if (gm) {
          f.gear = "&gear_id%5B0%5D=" + gm.value;
          f.gearLabel = gearKw === "Ручна" ? "механіка" : "автомат";
        }
      }
      // Пробіг лота в милях → км, діапазон ±30 тис. км (raceInt у тис. км).
      if (target.mileage > 0) {
        var km = Math.round((target.mileage * 1.60934) / 1000);
        var lo = Math.max(0, km - 30);
        f.mileage = "&raceInt%5B0%5D=" + lo + "&raceInt%5B1%5D=" + (km + 30);
        f.mileageLabel = "пробіг ~" + km + "k км";
      }
      return f;
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
    // Скидає всі поля, що заповнюються з лоту, до чистих значень за
    // замовчуванням. Викликається на початку parseAuctionLot, щоб дані одного
    // лоту ніколи не переносились на інший.
    resetLotData: function () {
      this.currentLot = { auction: "", lotNumber: "", vin: "" };
      this.lotCondition = {
        damage: "",
        secondaryDamage: "",
        lossType: "",
        runAndDrive: "",
        keys: "",
        airbags: "",
        grade: "",
        odometer: 0,
        odometerBrand: "",
        titleCode: "",
        starts: "",
        catalyticConverter: "",
        cat: "",
        keyFob: "",
        titleNotes: "",
        titleSaleDoc: "",
        wheels: "",
        whoCanBuy: "",
      };
      this.acv = 0;
      this.repairCost = 0;
      this.buyNowPrice = 0;
      this.autoPricing.autoPrice = 0;
      this.customs.manufactureYear = window.currentYear;
      this.customs.engineType = window.engineType.Petrol;
      this.customs.isHybrid = false;
      this.customs.engineVolume = "2.0";
      this.autoShipping.vehicleType = window.vehicleType[0].id;
      this.autoShipping.location.selected = window.autoLocation[0].id;
      this.locationSearch = "";
      this.customs.carrierInfo.make = "";
      this.customs.carrierInfo.model = "";
      this.customs.carrierInfo.color = "";
      this.customs.carrierInfo.transmission = "";
      this.customs.carrierInfo.mileage = 0;
      // Ринкова ціна завжди стосується конкретного авто — новий лот починає
      // з чистого блоку, інакше на екрані лишається ціна попереднього авто.
      this.clearMarketResult();
    },
    // Підпис авто, до якого належить знайдена ринкова ціна (марка|модель|рік).
    marketSignature: function () {
      var ci = this.customs.carrierInfo || {};
      return [
        (ci.make || "").trim().toLowerCase(),
        (ci.model || "").trim().toLowerCase(),
        parseInt(this.customs.manufactureYear || 0) || "",
      ].join("|");
    },
    clearMarketResult: function () {
      this.customs.ukrainianMarketPrice = 0;
      this.customs.marketCategory = "";
      this.marketTarget = "";
      this.marketStatus = "";
      this.marketMsg = "";
    },
    // Викликається з watcher-а customs: якщо марка/модель/рік змінились після
    // пошуку — знайдена ціна більше не стосується цього авто, прибираємо її.
    syncMarketFreshness: function () {
      if (!this.marketTarget) return;
      if (this.marketTarget === this.marketSignature()) return;
      this.clearMarketResult();
      this.marketStatus = "warn";
      this.marketMsg =
        "⚠ Дані авто змінились — ринкову ціну скинуто, натисніть пошук ще раз.";
    },
    applyMarketResult: function (price, category) {
      this.marketTarget = this.marketSignature();
      this.customs.ukrainianMarketPrice = price;
      var diff = this.marketPriceDifference();
      var cat =
        category || this.getMarketCategoryByDiff(diff, this.totalWithRepair());
      this.customs.marketCategory = cat;
      return cat;
    },
    // Один формат рядка searches для обох шляхів — свіжого запиту й
    // влучання в кеш. Доки він існував лише всередині гілки запиту, кеш не
    // писав у БД нічого.
    buildSearchPayload: function (target, r) {
      return {
        auction: this.currentLot.auction,
        lotNumber: this.currentLot.lotNumber,
        make: target.make,
        model: target.model,
        year: target.year,
        engineType: target.engineType,
        engineVolume: target.engineVolume,
        markaId: r.markaId,
        modelId: r.modelId,
        modelMatched: r.modelMatched,
        marketPrice: r.price,
        sampleCount: r.total,
        arithmeticMean: r.arithmeticMean || 0,
        iqMean: r.iqMean || 0,
        median: r.median || 0,
        // total_cost — розмитнений кошт БЕЗ ремонту, repair_cost окремо:
        // так у БД видно обидві складові, а diff (ринок − усе разом)
        // лишається тим самим числом, що й на екрані.
        totalCost: this.total(),
        repairCost: Number(this.repairCost) || 0,
        diff: this.marketPriceDifference(),
        category: r.category,
        prices: r.prices || [],
        percentiles: r.percentiles || null,
        classifieds: r.classifieds || [],
        filtersApplied: r.filtersApplied || [],
      };
    },

    // Лог результату пошуку в локальну SQLite (через server.js).
    logSearch: function (payload) {
      return this.postToApi("/api/searches", payload, "Пошук");
    },
    // Один шлях запису в SQLite для лотів і пошуків. Раніше обидва були
    // fire-and-forget із порожнім catch: якщо піднято статику (`npm run
    // start:py` чи Live Server без `npm start`), сторінка поводилась так само,
    // як при робочому сервері, а в БД не з'являлось нічого — і це помічалось
    // лише на lots.html, через дні.
    postToApi: function (route, payload, what) {
      var vm = this;
      return vm
        .apiFetch(route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        .then(function () {
          vm.dbMsg = "";
          return true;
        })
        .catch(function (e) {
          console.warn("[api]", route, e.message);
          vm.dbMsg =
            "⚠ " +
            what +
            " не збережено в БД (" +
            e.message +
            "). Запусти `npm start` — статичний сервер /api не має.";
          return false;
        });
    },
    // Бази API у порядку спроби. Сторінку віддає або сам node-сервер — тоді
    // працює відносний шлях, і байдуже, на якому він порту, — або Live Server
    // чи file://, і тоді потрібна абсолютна адреса :5500 (CORS для /api там
    // дозволено). Раніше тут стояло `port === "5500" ? "" : ":5500"`, тож
    // будь-який інший PORT робив усі /api-виклики мертвими: сторінка з :8080
    // стукала в :5500, де ніхто не слухає.
    apiBaseCandidates: function () {
      var list = location.protocol === "file:" ? [] : [""];
      if (list.indexOf("http://localhost:5500") === -1)
        list.push("http://localhost:5500");
      return list;
    },

    // Остання база, що спрацювала. Далі всі виклики йдуть одразу в неї.
    apiBase: function () {
      return window.__apiBaseResolved != null
        ? window.__apiBaseResolved
        : this.apiBaseCandidates()[0];
    },

    // fetch, що перебирає кандидатів, поки хтось не відповість, і запам'ятовує
    // переможця. Ціна помилки — один зайвий запит на першому виклику.
    apiFetch: async function (route, init) {
      var bases =
        window.__apiBaseResolved != null
          ? [window.__apiBaseResolved]
          : this.apiBaseCandidates();
      var lastErr = null;
      for (var i = 0; i < bases.length; i++) {
        try {
          var resp = await fetch(bases[i] + route, init);
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          window.__apiBaseResolved = bases[i];
          return resp;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error("API недоступне");
    },
    // Лог повного лота (всі поля + HD-фото/відео + сирий JSON) у SQLite.
    logLot: function (payload) {
      return this.postToApi("/api/lots", payload, "Лот");
    },
    // Слова з назви філії лота, за якими шукається рядок довідника.
    // Виділено окремо, щоб matchAuctionLocation і locationMatchIsWeak
    // токенізували однаково.
    locationHintWords: function (attrs) {
      var a = attrs || {};
      var stateCode = this.pickAttr(a.State, a.BranchState).toUpperCase();
      return this.pickAttr(a.BranchName, a.Name, a.City)
        .toUpperCase()
        .replace(/\([^)]*\)/g, " ") // «Long Island (NY)» → «Long Island»
        .split(/[^A-Z0-9]+/)
        .filter(function (w) {
          return w.length > 2 && w !== stateCode;
        });
    },

    // true, якщо з назвою філії не збіглося жодне слово і локація взята
    // просто як перша в штаті. Наземне плече до порту в межах одного штату
    // різниться до $375 (найгірше — IL: $1500…$1875), тож мовчки підставляти
    // сусідню філію не можна: цифра виглядає так само впевнено, як зматчена.
    locationMatchIsWeak: function (attrs, loc) {
      if (!loc) return false;
      var name = (loc.name || "").toUpperCase();
      return !this.locationHintWords(attrs).some(function (w) {
        return name.indexOf(w) !== -1;
      });
    },

    // Довідник локацій названий по філіях («NY LONG ISLAND - NY (IAAI)»),
    // а не по містах, тож збіг шукаємо саме по BranchName («Long Island (NY)»)
    // з відкатом на місто; серед кандидатів того ж штату виграє той, у кого
    // більше спільних слів.
    matchAuctionLocation: function (attrs) {
      var a = attrs || {};
      var stateCode = this.pickAttr(a.State, a.BranchState).toUpperCase();
      if (!stateCode) return null;
      var auctionKey = this.autoPricing.auctions.selected.toUpperCase();

      var inState = window.autoLocation.filter(function (l) {
        var n = l.name.toUpperCase();
        return n.indexOf(stateCode + " ") === 0 && n.indexOf(auctionKey) !== -1;
      });
      if (!inState.length) return null;

      var hintWords = this.locationHintWords(a);

      var best = null,
        bestScore = 0;
      inState.forEach(function (l) {
        var n = l.name.toUpperCase();
        var score = hintWords.reduce(function (acc, w) {
          return acc + (n.indexOf(w) !== -1 ? 1 : 0);
        }, 0);
        if (score > bestScore) {
          bestScore = score;
          best = l;
        }
      });
      return best || inState[0];
    },
    // IAAI віддає порожні поля як " " (пробіл), а потрібне значення часто
    // лежить під іншим ім'ям (ODOValue, а не Odometer; PrimaryDamageDesc, а не
    // PrimaryDamage). Беремо перше непорожнє з переліку кандидатів.
    pickAttr: function () {
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        if (v === null || v === undefined) continue;
        v = String(v).trim();
        if (v) return v;
      }
      return "";
    },
    // IAAI: ODOValue + ODOUoM ("mi"/"km"); Copart/старий код: Odometer.
    // Повертає пробіг у МИЛЯХ (км конвертуються), бо саме в милях його
    // показує аукціон і саме з миль рахується фільтр пробігу для AUTO.RIA.
    parseOdometer: function (a) {
      var attrs = a || {};
      var raw = this.pickAttr(
        attrs.ODOValue,
        attrs.Odometer,
        attrs.OdometerMiles,
      );
      var n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
      if (!n || isNaN(n)) {
        var km = parseInt(
          this.pickAttr(attrs.OdometerKM).replace(/[^0-9]/g, ""),
          10,
        );
        return km ? Math.round(km / 1.60934) : null;
      }
      var uom = this.pickAttr(attrs.ODOUoM).toLowerCase();
      return uom === "km" ? Math.round(n / 1.60934) : n;
    },
    // Приймає лише http(s)-посилання. У БД одного разу вже потрапив
    // скопійований зі сторінки текст замість URL — і кнопка «Сторінка лоту»
    // перетворилась на битий відносний лінк.
    sanitizeLotUrl: function (url) {
      var v = (url == null ? "" : String(url)).trim();
      if (!/^https?:\/\/[^\s]+$/i.test(v)) return "";
      return v;
    },
    // Запасний варіант, якщо URL загубився: сторінку лоту завжди можна
    // зібрати з аукціону та номера лоту.
    canonicalLotUrl: function (auction, lotNumber) {
      var n = (lotNumber == null ? "" : String(lotNumber)).trim();
      if (!/^[0-9]{4,12}$/.test(n)) return "";
      if (auction === "iaai")
        return "https://www.iaai.com/VehicleDetail/" + n + "~US";
      if (auction === "copart") return "https://www.copart.com/lot/" + n;
      return "";
    },
    // Витягує HD-фото, 360° та відео з JSON лота (IAAI; Copart — best-effort).
    collectLotMedia: function (nd) {
      var images = [],
        videos = [],
        image360 = "";
      var iv = nd.inventoryView || {};
      var id = iv.imageDimensions || {};
      var keys = (id.keys && id.keys["$values"]) || [];
      keys.forEach(function (o) {
        if (!o || !o.k) return;
        var base = "https://vis.iaai.com/resizer?imageKeys=" + o.k;
        images.push({
          hd: base + "&width=" + (o.w || 1280) + "&height=" + (o.h || 960),
          thumb: base + "&width=" + (o.tw || 188) + "&height=" + (o.th || 141),
          w: o.w || 0,
          h: o.h || 0,
        });
      });
      if (id.image360Ind && id.image360Url) image360 = id.image360Url;
      if (id.vrdUrl) videos.push({ type: "engine", url: id.vrdUrl });
      // Copart / generic fallback: масиви готових посилань
      var inv = nd.inventory || {};
      var hd =
        inv.hdImageLinks && (inv.hdImageLinks["$values"] || inv.hdImageLinks);
      if (Array.isArray(hd)) {
        hd.forEach(function (u) {
          if (typeof u === "string")
            images.push({ hd: u, thumb: u, w: 0, h: 0 });
        });
      }
      return { images: images, image360: image360, videos: videos };
    },
    // inventoryView несе ТРИ списки key/value, а парсер читав лише перший:
    //   saleInformation    — де і коли продають (ACV, ремонт, філія, лейн);
    //   vehicleInformation — стан (тайтл із штатом, колеса, старт, ключі);
    //   vehicleDescription — опис і комплектація (де вироблено, опції,
    //                        перелік подушок).
    lotKeyValues: function (nd, branch) {
      return ((nd.inventoryView || {})[branch] || {})["$values"] || [];
    },

    // Категорії ліцензій IAA, яким дозволено купувати лот (DEA — дилер,
    // EXP — експортер тощо). Порожньо = обмежень немає; так у 22 з 24
    // збережених лотів. Якщо список є, а потрібної ліцензії в брокера немає,
    // ставку просто не приймуть — це рішення «дивитись чи ні», а не деталь.
    lotWhoCanBuy: function (nd) {
      var w =
        (((nd.auctionInformation || {}).biddingInformation || {}).whoCanBuy ||
          {})["$values"] || [];
      return w
        .filter(Boolean)
        .join(",")
        .split(",")
        .map(function (x) {
          return x.trim();
        })
        .filter(Boolean)
        .join(", ");
    },

    // Збирає повний набір даних про лот для збереження в БД.
    collectLotData: function (nd, attrs, saleValues, lotUrl) {
      var vm = this;
      var inv = nd.inventory || {};
      var a = attrs || {};
      var media = vm.collectLotMedia(nd);
      var vehInfo = vm.lotKeyValues(nd, "vehicleInformation");
      var vehDesc = vm.lotKeyValues(nd, "vehicleDescription");
      function sv(key) {
        return vm.getVal(saleValues, key);
      }
      function viv(key) {
        return vm.getVal(vehInfo, key);
      }
      function vdv(key) {
        return vm.getVal(vehDesc, key);
      }
      function s(v) {
        return (v == null ? "" : v).toString().trim();
      }
      var p = vm.pickAttr;
      var auction = vm.autoPricing.auctions.selected;
      var lotNumber = s(
        a.SalvageId ||
          a.StockNo ||
          (nd.inventoryView || {}).itemId ||
          inv.salvageId ||
          "",
      );
      return {
        url:
          vm.sanitizeLotUrl(lotUrl) ||
          vm.sanitizeLotUrl(vm.auctionUrl) ||
          vm.canonicalLotUrl(auction, lotNumber),
        auction: auction,
        lotNumber: lotNumber,
        vin: p(a.VIN, inv.vin),
        year: parseInt(a.Year || inv.year || 0) || null,
        make: p(a.Make, inv.make),
        model: p(a.Model, inv.model),
        series: p(a.Series, inv.series),
        bodyStyle: p(a.BodyStyleName, inv.bodyStyleName, a.Segment),
        fuel: p(a.FuelTypeDesc, a.FuelTypeCode, inv.fuelTypeDesc),
        engine: p(a.EngineSize, inv.engineSize, a.DisplLiters),
        cylinders: p(a.CylindersDesc, a.Cylinders, inv.cylindersDesc),
        drive: p(a.DriveLineTypeDesc, a.DriveLineType, inv.driveLineTypeDesc),
        transmission: p(
          a.TransmissionDesc,
          a.Transmission,
          inv.transmissionDesc,
        ),
        color: p(a.ExteriorColor, a.Color, inv.colorDesc),
        interiorColor: p(a.InteriorColor),
        odometer: vm.parseOdometer(a),
        odometerBrand: p(a.ODOBrand),
        primaryDamage: p(
          a.PrimaryDamageDesc,
          a.PrimaryDamage,
          inv.primaryDamageDesc,
        ),
        secondaryDamage: p(
          a.SecondaryDamageDesc,
          a.SecondaryDamage,
          inv.secondaryDamageDesc,
        ),
        lossType: p(a.LossTypeDesc),
        runAndDrive: p(a.RunAndDrive),
        hasKeys: p(a.Keys),
        airbags: p(a.AirbagState),
        vehicleGrade: p(a.VehicleGrade),
        // Заводиться (StartsDesc «Starts») — це НЕ те саме, що RunAndDrive:
        // «заводиться, але не їде» — інший обсяг ремонту.
        starts: p(a.StartsDesc, a.StartsCode),
        // Каталізатор: у салведжа його часто вже немає, а це $500–2000.
        catalyticConverter: p(a.CatalyticConverter),
        // CAT-лот — авто зі стихійного лиха (повінь/град). Для імпорту це
        // здебільшого стоп-сигнал, а в JSON лежить окремим прапорцем.
        catIndicator: p(a.CATIndicator) === "True" ? 1 : 0,
        // Посилання на пояснення CAT є на КОЖНІЙ сторінці лота, незалежно від
        // прапорця, — зберігаємо його лише там, де воно щось означає.
        catText: p(a.CATIndicator) === "True" ? p(a.CATText) : "",
        keyFob: p(a.KeyFOB),
        titleNotes: p(a.TitleNotes, sv("Notes")),
        // IAAI має явний прапорець гібрида — надійніше за розбір назви палива.
        hybrid: p(a.HybridIndicator) === "True" ? 1 : 0,
        // «SALVAGE (Missouri)», «REBUILDABLE (Florida)», «Wait Title» — стан
        // документа зі штатом. TitleCode («SAL», «OTH») цього не показує, а
        // «Wait Title» означає, що тайтла ще нема на руках: відправка чекає.
        titleSaleDoc: p(viv("TitleSaleDoc")),
        // «Spare Tire Missing,Alloy Wheels» — запаска й тип дисків.
        wheels: p(viv("Wheel")),
        manufacturedIn: p(vdv("ManufacturedIn")),
        options: p(vdv("Options")),
        // Перелік подушок. Разом з AirbagState=Deployed це і є оцінка
        // «скільки подушок міняти».
        restraintSystem: p(vdv("RestraintSystem")),
        whoCanBuy: vm.lotWhoCanBuy(nd),
        titleBrand: p(a.TitleBrand, inv.titleBrand),
        // Тип документа (BillOfSale / Certificate of Title…) і його код —
        // окремо від бренду тайтла: для імпорту це різні речі.
        titleType: p(a.Title),
        titleCode: p(a.TitleCode),
        titleState: p(a.TitleState, inv.certState),
        vehicleCity: p(a.City),
        vehicleState: p(a.State, a.BranchState),
        vehicleZip: p(a.Zip),
        offsite: p(a.OffsiteSaleInd, a.IsOffsite) === "True" ? 1 : 0,
        acv: vm.parseDollars(sv("ActualCashValue")) || null,
        repairCost:
          vm.parseDollars(sv("EstimatedRepairCost")) ||
          vm.parseDollars(a.EstRepairCost) ||
          null,
        buyNowPrice:
          vm.parseDollars(sv("BuyNowPrice")) ||
          parseInt(a.BuyNowAmount || 0) ||
          null,
        minBid: parseInt(a.MinimumBidAmount || 0) || null,
        sellingBranch: p(sv("SellingBranch"), a.BranchName),
        branchState: p(a.BranchState),
        saleLane: p(sv("Lane"), a.Lane),
        saleDate: s(sv("AuctionDateTime")),
        images: media.images,
        image360: media.image360,
        videos: media.videos,
        raw: nd,
      };
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

        // Назва авто в кожному повідомленні — щоб було видно, до якого саме
        // авто належить ціна (і одразу помітно, якщо вона від іншого лоту).
        var carLabel = [target.make, target.model, target.year]
          .filter(Boolean)
          .join(" ");

        var cacheKey = vm.getMarketCacheKey(target);
        var cached = vm.readMarketCache(cacheKey);
        if (cached) {
          var cachedCategory = vm.applyMarketResult(
            cached.medianPrice,
            cached.marketCategory,
          );
          vm.marketStatus = "ok";
          vm.marketMsg =
            "✅ " +
            carLabel +
            " — кеш AUTO.RIA: " +
            cached.sampleCount +
            " оголошень, ціна $" +
            cached.medianPrice;
          // Влучання в кеш теж має лишати рядок у БД. Ключ кешу — це модель,
          // рік, пробіг і коробка, а не лот: другий лот тієї самої моделі
          // читав ціну з кешу, не писав нічого в searches — і на lots.html
          // лишався взагалі без плашки угоди, ніби його ніхто не оцінював.
          vm.logSearch(
            vm.buildSearchPayload(target, {
              price: cached.medianPrice,
              total: cached.sampleCount,
              category: cachedCategory,
              markaId: cached.markaId || null,
              modelId: cached.modelId || null,
              modelMatched: cached.modelMatched === true,
              prices: cached.prices || [],
              percentiles: cached.percentiles || null,
              classifieds: [],
              filtersApplied: (cached.filtersApplied || []).concat("кеш"),
            }),
          );
          vm.saveToLocalStorage();
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

        // 2) Резолв моделі: точний збіг або базова модель для тримів
        var models = await vm.getRiaModels(mark.value);
        var resolved = vm.resolveBaseModel(target.make, target.model, models);
        var model = resolved.model;

        // 3) Прогресивне звуження: від точного (фільтри) до широкого (марка+рік).
        //    Зупиняємось на першому тирі з total >= MIN; максимум 3 запити.
        var basePath =
          "/auto/average_price?main_category=1&marka_id=" + mark.value;
        if (model) basePath += "&model_id=" + model.value;
        if (target.year) {
          basePath +=
            "&yers%5B0%5D.gte=" +
            (target.year - 1) +
            "&yers%5B0%5D.lte=" +
            (target.year + 1);
        }

        var filt = await vm.buildRiaFilters(target);
        var tiers = [
          {
            suffix: filt.fuel + filt.gear + filt.mileage,
            labels: [filt.fuelLabel, filt.gearLabel, filt.mileageLabel],
          },
          { suffix: filt.fuel, labels: [filt.fuelLabel] },
          { suffix: "", labels: [] },
        ];
        var MIN = 5;
        var data = null,
          usedLabels = [],
          lastSuffix = null;
        for (var ti = 0; ti < tiers.length; ti++) {
          if (tiers[ti].suffix === lastSuffix) continue;
          lastSuffix = tiers[ti].suffix;
          var d;
          try {
            d = await vm.riaFetchJson(basePath + tiers[ti].suffix);
          } catch (e) {
            if (e && e.notEnoughData) continue;
            throw e;
          }
          // Найкращий (з найбільшою вибіркою) — на випадок, якщо жоден тир
          // не дотягне до MIN.
          if (!data || (d.total || 0) > (data.total || 0)) {
            data = d;
            usedLabels = tiers[ti].labels.filter(Boolean);
          }
          if ((d.total || 0) >= MIN) {
            data = d;
            usedLabels = tiers[ti].labels.filter(Boolean);
            break;
          }
        }

        if (!data) {
          vm.marketStatus = "warn";
          vm.marketMsg = "⚠ На AUTO.RIA замало даних для оцінки по цьому авто.";
          return;
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
        vm.marketStatus = total < MIN ? "warn" : "ok";

        var modelLabel = model
          ? model.name + (resolved.base ? " (баз.)" : "")
          : "марка+рік";
        var appliedLabels = [modelLabel].concat(usedLabels);
        vm.marketMsg =
          (total < MIN ? "⚠ Мало даних: " : "✅ ") +
          carLabel +
          " → " +
          appliedLabels.join(" · ") +
          " — n=" +
          total +
          ", медіана/IQ $" +
          price +
          (model ? "" : " (модель «" + target.model + "» не зматчилась)");

        // У кеш кладемо не лише ціну, а й розподіл: із нього наступне
        // влучання відтворює повноцінний рядок у searches (гістограма на
        // stats.html будується саме з prices/percentiles). Оголошення
        // (classifieds) не кешуємо — це найважча частина відповіді, а для
        // графіка вона не потрібна.
        vm.writeMarketCache(cacheKey, {
          ts: Date.now(),
          medianPrice: price,
          sampleCount: total,
          marketCategory: category,
          markaId: mark.value,
          modelId: model ? model.value : null,
          modelMatched: !!model && !resolved.base,
          arithmeticMean: Math.round(data.arithmeticMean || 0),
          iqMean: Math.round(data.interQuartileMean || 0),
          median: Math.round(
            (data.percentiles && data.percentiles["50.0"]) || 0,
          ),
          prices: Array.isArray(data.prices) ? data.prices : [],
          percentiles: data.percentiles || null,
          filtersApplied: appliedLabels,
        });
        vm.saveToLocalStorage();

        vm.logSearch(
          vm.buildSearchPayload(target, {
            price: price,
            total: total,
            category: category,
            markaId: mark.value,
            modelId: model ? model.value : null,
            modelMatched: !!model && !resolved.base,
            arithmeticMean: Math.round(data.arithmeticMean || 0),
            iqMean: Math.round(data.interQuartileMean || 0),
            median: Math.round(
              (data.percentiles && data.percentiles["50.0"]) || 0,
            ),
            prices: Array.isArray(data.prices) ? data.prices : [],
            percentiles: data.percentiles || null,
            classifieds: Array.isArray(data.classifieds)
              ? data.classifieds
              : [],
            filtersApplied: appliedLabels,
          }),
        );
      } catch (err) {
        if (err && err.rateLimited) {
          vm.marketStatus = "warn";
          vm.marketMsg = (err.quotaDrained ? "🚫 " : "⏳ ") + err.message;
          return;
        }
        vm.marketStatus = "error";
        vm.marketMsg =
          "❌ Помилка пошуку ціни на AUTO.RIA: " +
          (err && err.message ? err.message : "невідома помилка");
      }
    },

    // Сітка збору живе разом з аукціоном у constants/auctions.js.
    auctionFee: function () {
      return window
        .getAuctionById(this.autoPricing.auctions.selected)
        .buyerFee(this.autoPricing.autoPrice);
    },

    // Комісія банку: 0.5% від оплати аукціону + $30 + 0.5% від доставки.
    // ⚠️ Джерело формули не встановлене, число успадковане з коміту
    // 2021-07-28 — див. docs/shipping-rates-baseline.md, «Догляд провенансу».
    commissionBank: function () {
      var askss = Math.ceil((this.totalShippingFee() / 100) * 0.5);
      return Math.ceil(
        ((this.autoPricing.autoPrice + this.auctionFee()) / 100) * 0.5 +
          30 +
          askss,
      );
    },

    // Збір брокера/АНЗ. Обидві гілки колишнього тернарника давали 300,
    // тобто ставка плоска; джерело числа не встановлене (коміт 2021 р.).
    anzFee: function () {
      return 300;
    },

    // Страхування вантажу: 2% від ціни з молотка + збору, мінімум $100.
    // ⚠️ Ставка теж із коміту 2021-07-28, без джерела.
    strahovka: function () {
      var strah = Math.ceil(
        ((this.autoPricing.autoPrice + this.auctionFee()) / 100) * 2,
      );
      return strah < 100 ? 100 : strah;
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
    onLocationBlur: function () {
      var vm = this;
      setTimeout(function () {
        vm.locationDropOpen = false;
      }, 150);
    },
    // Штат локації = перший токен її назви («CA ACE CARSON - CA (IAAI)»).
    locationState: function () {
      var loc = this.getCurrentLocation();
      var m = ((loc && loc.name) || "").match(/^([A-Z]{2})\b/);
      return m ? m[1] : "";
    },
    // Ручний вибір порту в селекті. Прапорець потрібен, щоб зміна локації
    // потім не перезатирала вибір користувача (і щоб при завантаженні
    // сторінки порт виводився з локації, а не брався зі старого сховища).
    onDeparturePortChange: function () {
      this.autoShipping.shippingPortManual = true;
      this.saveToLocalStorage();
    },
    onLocationChange: function () {
      var ports = this.shippingAllowedPorts();
      var location = this.getCurrentLocation();

      // toPort у довіднику суцільно -1, тож ця гілка зараз не спрацьовує
      // ніколи; лишена на випадок, якщо таблицю відстаней колись заповнять.
      if (ports && ports.length) {
        var optimal = ports.reduce(function (acc, cur) {
          return location.toPort[cur.id] < location.toPort[acc.id] ? cur : acc;
        });
        this.autoShipping.shippingPort = optimal.id;
        return;
      }

      // Без таблиці відстаней порт визначає штат. Раніше тут беззастережно
      // ставився shippingPorts[0] (Нью-Йорк), тому авто з Каліфорнії
      // рахувалось за східним фрахтом.
      if (this.autoShipping.shippingPortManual) return;
      this.autoShipping.shippingPort = window.portForState(
        this.locationState(),
      );
    },

    selectLocation: function (opt) {
      this.autoShipping.location.selected = opt.id;
      this.locationSearch = opt.name;
      this.locationDropOpen = false;
      this.onLocationChange();
    },
    // Збір на обов'язкове державне пенсійне страхування при ПЕРШІЙ реєстрації
    // легкового авто. Ставки й пороги — docs/pension-fee-baseline.md.
    //
    // Пороги задані в гривнях як кратні прожиткового мінімуму для працездатних
    // осіб (165 і 290 ПМ), тому базу переводимо в гривні за курсом НБУ, а не
    // порівнюємо з доларовими константами: раніше тут стояли $13 300 / $23 500
    // з коміту 2021 року, які ні до чого не прив'язані й давно розійшлися з
    // законом.
    pensionFeeRate: function () {
      var thresholds = [165, 290].map(
        function (multiple) {
          return multiple * this.subsistenceMinUah;
        }.bind(this),
      );
      var baseUah = this.customsBase() * this.usdUah;
      if (baseUah <= thresholds[0]) return 0.03;
      if (baseUah <= thresholds[1]) return 0.04;
      return 0.05;
    },

    // Історична назва методу — в шаблоні він виводиться рядком «МРЕО».
    mreo: function () {
      // Авто виключно на електротязі від збору звільнені.
      if (this.isElectricEngine()) return 0;
      return Math.ceil(this.customsBase() * this.pensionFeeRate());
    },

    shippingAllowedPorts: function () {
      var loc = this.getCurrentLocation();

      return window.shippingPorts.filter(function (port) {
        return loc.toPort[port.id] > 0;
      });
    },

    // Обраний порт призначення (Одеса / Клайпеда / Гданськ).
    currentDestination: function () {
      var id = this.autoShipping.destinationPort.selected;
      return (
        window.destinationPorts.filter(function (p) {
          return p.id === id;
        })[0] || window.destinationPorts[0]
      );
    },

    // Узбережжя США беремо з порту відправлення, а не з назви локації аукціону:
    // авто з внутрішнього штату може виїжджати через будь-який порт.
    currentCoast: function () {
      var port = this.getCurrentPort();
      return (port && port.coast) || "east";
    },

    // Табличний фрахт для поточної пари (узбережжя → порт призначення).
    baseOceanFreight: function () {
      var rates = this.oceanFreightRates[this.currentDestination().id] || {};
      return rates[this.currentCoast()] || 0;
    },

    // Фактичний фрахт: ручна ставка має пріоритет над табличною.
    oceanFreightFee: function () {
      var override = Number.parseInt(this.oceanFreightOverride);
      return !isNaN(override) && override > 0
        ? override
        : this.baseOceanFreight();
    },

    // Наземна доставка від аукціону до порту США.
    //
    // Запасне значення — найдорожча ставка довідника, а не колишні $1100:
    // ті $1100 лежали НИЖЧЕ за всю таблицю ($1150–2300), тобто локація без
    // ставки мовчки виходила дешевшою за будь-яку відому. Зараз ставку мають
    // усі 354 локації, тож гілка не спрацьовує — але як спрацює, це буде
    // видно в консолі, а помилка піде в бік обережності.
    inlandUsFee: function () {
      var location = this.getCurrentLocation();
      var rate = location && location[this.autoPricing.auctions.selected];
      if (rate > 0) return rate;
      console.warn(
        "[inland] немає ставки для локації:",
        (location && location.name) || "(не обрано)",
      );
      return window.maxInlandRate;
    },

    // Надбавка за габарит. Сама ставка живе поруч із типом кузова
    // (constants/vehicle.js): доти вона була числом тут, а тип вибирався за
    // індексом `vehicleType[2]` — переставили б рядки в довіднику, і надбавку
    // почав би отримувати не той кузов.
    oversizeFee: function () {
      var type = window.getVehicleTypeById(this.autoShipping.vehicleType);
      return (type && type.oversizeFee) || 0;
    },

    // Автовоз від порту призначення до кордону України (0 для Одеси).
    toUkraineFee: function () {
      return this.currentDestination().toUkraine || 0;
    },

    // Розклад доставки по пунктах. Єдине джерело правди: totalShippingFee()
    // просто підсумовує ці рядки, тож UI і сума не можуть розійтися.
    shippingBreakdown: function () {
      var port = this.getCurrentPort();
      var dest = this.currentDestination();
      var rows = [
        {
          key: "inland",
          label: "Аукціон → порт " + (port ? port.name : "США"),
          amount: this.inlandUsFee(),
        },
        {
          key: "ocean",
          label: "Океанський фрахт → " + dest.name,
          amount: this.oceanFreightFee(),
        },
      ];
      if (this.oversizeFee()) {
        rows.push({
          key: "oversize",
          label: "Надбавка за габарит (пікап/вантажівка)",
          amount: this.oversizeFee(),
        });
      }
      if (this.toUkraineFee()) {
        rows.push({
          key: "toUkraine",
          label: "Автовоз " + dest.name + " → кордон України",
          amount: this.toUkraineFee(),
        });
      }
      return rows;
    },

    totalShippingFee: function () {
      return this.shippingBreakdown().reduce(function (sum, row) {
        return sum + row.amount;
      }, 0);
    },

    isElectricEngine: function () {
      return this.customs.engineType === window.engineType.Electric;
    },

    // ── Митні платежі ─────────────────────────────────────────────────────
    // Ставки та формули звірені з ПКУ; джерела й дата — docs/customs-rates-baseline.md

    // Коефіцієнт віку для акцизу, ПКУ 215.3.5-1:
    // «кількість повних календарних років з року, НАСТУПНОГО за роком
    // виробництва, до року визначення ставки податку».
    //
    // Обидва краї включно: авто 2012 р. у 2026-му — це роки 2013…2026, тобто
    // 14, а не 13. Для нових і тих, що використовувались до одного повного
    // року, коефіцієнт = 1; понад п'ятнадцять повних років — рівно 15.
    ageCoefficient: function () {
      var years = window.currentYear - this.customs.manufactureYear;
      if (years < 1) return 1;
      return years > 15 ? 15 : years;
    },

    // Митна вартість — база для мита й ПДВ (CIF).
    // За МКУ це ціна угоди плюс усі витрати ДО перетину митного кордону
    // України: транспортування та страхування.
    //
    // totalShippingFee() підходить точно, бо доводить авто саме до кордону:
    // для Одеси це порт (плече «порт → кордон» = 0, бо порт уже в Україні),
    // для Клайпеди/Гданська — включно з автовозом до кордону.
    // Витрати вже в межах України (доставка по країні, МРЕО, сертифікація)
    // до митної вартості НЕ входять і сюди не потрапляють.
    //
    // Раніше тут стояло «+1000» — плоский проксі доставки, який занижував
    // базу в 3–4 рази, а отже й мито з ПДВ.
    customsBase: function () {
      return (
        this.autoPricing.autoPrice +
        this.auctionFee() +
        this.totalShippingFee() +
        this.strahovka()
      );
    },

    // Базова ставка акцизу, €/л. ПКУ 215.3.5-1: бензин 50 (100 понад 3.0 л),
    // дизель 75 (150 понад 3.5 л). Винесено окремо, щоб і сума, і підпис у
    // розкладі бралися з одного числа.
    exciseRatePerLitre: function () {
      var volume = Number.parseFloat(this.customs.engineVolume) || 0;
      return this.customs.engineType === window.engineType.Diesel
        ? volume <= 3.5
          ? 75
          : 150
        : volume <= 3.0
          ? 50
          : 100;
    },

    // Акциз у ЄВРО — ставки в ПКУ задані саме в євро.
    // ДВЗ: ставка за літр × об'єм × коефіцієнт віку.
    // Електро: 1 €/кВт·год БЕЗ коефіцієнта віку (окрема норма).
    exciseEur: function () {
      if (this.isElectricEngine()) {
        return 1.0 * (Number.parseInt(this.customs.batteryKwh) || 0);
      }
      var volume = Number.parseFloat(this.customs.engineVolume) || 0;
      return this.exciseRatePerLitre() * volume * this.ageCoefficient();
    },

    // Формула акцизу словами — щоб у розкладі було видно, звідки взялась сума
    // (ставка, об'єм і коефіцієнт віку разом дають розкид у рази).
    exciseFormula: function () {
      if (this.isElectricEngine()) {
        return (
          "€1/кВт·год × " + (Number.parseInt(this.customs.batteryKwh) || 0)
        );
      }
      var volume = Number.parseFloat(this.customs.engineVolume) || 0;
      return (
        "€" +
        this.exciseRatePerLitre() +
        "/л × " +
        volume +
        " л × " +
        this.ageCoefficient()
      );
    },

    // Акциз у доларах. Курс євро тягнеться з НБУ (rates.service.js).
    exciseUsd: function () {
      return this.exciseEur() * this.eurUsd;
    },

    // Ввізне мито: 10% для ДВЗ, 0% для електромобілів.
    importDuty: function () {
      return this.isElectricEngine() ? 0 : this.customsBase() * 0.1;
    },

    // ПДВ 20% від (митна вартість + мито + акциз).
    // Для електро нульова ставка скасована з 01.01.2026.
    vatFee: function () {
      return (this.customsBase() + this.importDuty() + this.exciseUsd()) * 0.2;
    },

    // Розклад митних платежів. Той самий принцип, що й shippingBreakdown():
    // totalCustomsFee() підсумовує саме ці рядки, тож таблиця й підсумок не
    // можуть розійтися. До цього «Митні платежі» стояли в UI одним числом —
    // найбільша стаття витрат після самого авто, і без жодного натяку, чому
    // вона така: мито, акциз і ПДВ реагують на різні поля форми.
    customsBreakdown: function () {
      return [
        {
          key: "duty",
          label: this.isElectricEngine()
            ? "Ввізне мито (0% для електро)"
            : "Ввізне мито 10%",
          amount: Math.round(this.importDuty()),
        },
        {
          key: "excise",
          label: "Акциз (" + this.exciseFormula() + ")",
          amount: Math.round(this.exciseUsd()),
        },
        {
          key: "vat",
          label: "ПДВ 20% (вартість + мито + акциз)",
          amount: Math.round(this.vatFee()),
        },
      ];
    },

    // Збір до Пенсійного фонду сюди НЕ входить — він рахується окремо в
    // mreo() і додається в total(). Не дублювати.
    totalCustomsFee: function () {
      return this.customsBreakdown().reduce(function (sum, row) {
        return sum + row.amount;
      }, 0);
    },

    cleanValue: function () {
      return Math.round(this.acv - this.repairCost);
    },
    benefit: function () {
      return Math.round(this.cleanValue() - this.total());
    },
    // Підсумок для іншої ціни авто, БЕЗ мутації реактивного стану: Object.create
    // віддає об'єкт, який делегує все до vm і перекриває лише autoPrice.
    // Пряме присвоєння сюди не годиться — maxBid() викликається з шаблону, і
    // зміна autoPrice запустила б новий ререндер, тобто нескінченний цикл.
    // Підсумок для іншої ціни авто, без жодного дотику до реактивного стану.
    //
    // Vue 2 прив'язує методи до інстансу (`bind(vm)`), тож усі спроби
    // підставити інший `this` — Object.create, call, apply — на vm.total()
    // не діють: усередині все одно буде справжній vm. А писати ціну в стан
    // під час рендеру не можна: це нескінченний цикл ререндерів.
    // Тому будуємо окремий об'єкт із СИРИХ (незв'язаних) методів і копії даних.
    totalForPrice: function (price) {
      if (!rawMethodsCache) rawMethodsCache = window.__createAllMethods();

      var data = this._data || this;
      var probe = Object.create(rawMethodsCache);
      Object.keys(data).forEach(function (key) {
        // Тільки дані. Методи мусять лишитись сирими з прототипу — інакше
        // probe.total() виявиться прив'язаним до справжнього vm.
        if (typeof data[key] !== "function") probe[key] = data[key];
      });
      probe.autoPricing = Object.assign({}, this.autoPricing, {
        autoPrice: price,
      });
      return probe.total();
    },

    // Максимальна ставка — найбільша ціна з молотка, за якої ПОВНІ витрати на
    // авто «під ключ» ще вкладаються в (ACV − ремонт) × коефіцієнт ризику.
    //
    // Раніше тут було просто (ACV − ремонт) × коефіцієнт, тобто збори,
    // доставка й розмитнення не віднімались зовсім — хоча підпис у шапці
    // обіцяє «− інші витрати». На типовому лоті це завищувало ставку вдвічі.
    //
    // total() зростає з ціною монотонно, але сходинками (тарифні сітки
    // аукціонів), тож розв'язуємо бінарним пошуком, а не аналітично.
    maxBid: function () {
      return this.solveMaxBid(this.cleanValue() * this.riskCoefficient, 0);
    },

    // Та сама задача, але стеля — не американський ACV, а ціна, за яку авто
    // піде на українському ринку. Для перепродажу саме вона й вирішує:
    // ACV — це оцінка страховика в США, і на типовому лоті вона на тисячі
    // доларів вища за те, скільки за таке авто дадуть тут.
    //
    // Ремонт входить у витрати окремим доданком: ринкова ціна — це ціна
    // ЦІЛОГО авто, а totalForPrice() доводить до України розбите.
    maxBidForMarket: function () {
      var market = this.customs.ukrainianMarketPrice || 0;
      if (!(market > 0)) return 0;
      var repair = Number(this.repairCost) || 0;
      return this.solveMaxBid(
        market * this.riskCoefficient,
        repair > 0 ? repair : 0,
      );
    },

    // Найбільша ціна з молотка, за якої totalForPrice(ціна) + extraCost ще
    // вкладається в target. total() зростає з ціною монотонно, але сходинками
    // (тарифні сітки аукціонів), тож розв'язуємо бінарним пошуком.
    solveMaxBid: function (target, extraCost) {
      var extra = extraCost || 0;
      if (!(target > 0)) return 0;
      // Навіть за нульової ставки супутні витрати можуть перевищити ліміт —
      // тоді лот не проходить ні за якою ціною.
      if (this.totalForPrice(0) + extra > target) return 0;

      var lo = 0;
      var hi = target;
      for (var i = 0; i < 40; i++) {
        var mid = (lo + hi) / 2;
        if (this.totalForPrice(mid) + extra <= target) lo = mid;
        else hi = mid;
      }
      return Math.floor(lo);
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

    // Сума фіксованих зборів (брокер, парковка, доставка по Україні,
    // сертифікація). Джерело правди — `fixedFees` у state.js, звідки ці ж
    // рядки виводяться в таблицю витрат.
    fixedFeesTotal: function () {
      return this.fixedFees.reduce(function (sum, fee) {
        return sum + fee.amount;
      }, 0);
    },
    total: function () {
      return Math.floor(
        this.autoPricing.autoPrice +
          this.auctionFee() +
          this.commissionBank() +
          this.strahovka() +
          this.totalShippingFee() +
          this.totalCustomsFee() +
          this.fixedFeesTotal() +
          this.mreo() +
          this.anzFee(),
      );
    },
  };
};
// Ринкові/парсерні методи — це ВСЕ, чого не забрали ui і fees. Явного
// переліку тут більше немає навмисно: доки він був, новий метод, доданий у
// __createAllMethods(), просто не з'являвся на інстансі Vue, поки хтось не
// згадає дописати його ім'я в один із трьох списків, — а шаблон при цьому
// падав на «is not a function» лише в рантаймі.
export function createMarketMethods() {
  var all = window.__createAllMethods();
  var taken = (window.uiMethodNames || []).concat(window.feesMethodNames || []);
  var out = {};
  Object.keys(all).forEach(function (k) {
    if (taken.indexOf(k) === -1) out[k] = all[k];
  });
  return out;
}
window.createMarketMethods = createMarketMethods;
