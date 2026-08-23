window.createInitialState = function () {
  return {
    // Дефолти на випадок, коли API НБУ недоступне; реальні курси підтягує
    // rates.service.js. Зріз курсів — 2026-08-17 (див. docs/*-baseline.md).
    eurUsd: 1.1,
    usdUah: 44.7,
    // Прожитковий мінімум для працездатних осіб, грн. До нього прив'язані
    // пороги пенсійного збору (165 / 290 ПМ). Оновлюється раз на рік
    // законом про держбюджет — див. docs/pension-fee-baseline.md.
    subsistenceMinUah: 3328,
    // Ставки фрахту [порт призначення][узбережжя США]. Редаговані в UI через
    // oceanFreightOverride — ставки експедиторів різняться в рази, тож
    // захардкоджені значення тут лише як стартова точка.
    oceanFreightRates: window.oceanFreightRates,
    // Ручна ставка фрахту; 0/порожньо → береться з oceanFreightRates.
    oceanFreightOverride: 0,
    autoPricing: {
      autoPrice: 4000,
      auctions: {
        selected: window.auctions[0].id,
        options: window.auctions,
      },
    },
    auctionUrl: "",
    auctionStatus: "", // '', 'loading', 'ok', 'warn', 'error'
    auctionMsg: "",
    // Ідентичність розпарсеного лота — щоб прив'язати пошук ціни до лота в БД
    // і показати VIN у шапці калькулятора.
    currentLot: { auction: "", lotNumber: "", vin: "" },
    // Стан авто зі зчитаного лота. Показується поруч із полем «Вартість
    // ремонту»: саме з цих полів (біжить / ключі / подушки / тип збитку /
    // grade) і оцінюють, скільки закладати на ремонт.
    lotCondition: {
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
    },
    acv: 0,
    repairCost: 0,
    buyNowPrice: 0,
    riskCoefficient: 0.5,
    locationSearch: "",
    locationDropOpen: false,
    autoShipping: {
      location: {
        selected: window.autoLocation[0].id,
        options: window.autoLocation,
      },
      shippingPort: window.shippingPorts[0].id,
      // Довідник для селекта порту відправлення. Не персиститься (у
      // localStorage летить лише сам id — див. storage.service.js).
      shippingPortOptions: window.shippingPorts,
      // true — порт відправлення обрав користувач вручну; інакше він
      // виводиться зі штату локації при кожній її зміні.
      shippingPortManual: false,
      destinationPort: {
        selected: window.destinationPorts[0].id,
        options: window.destinationPorts,
      },
      vehicleType: window.vehicleType[0].id,
    },
    customs: {
      engineVolume: "2.0",
      // always a string value, so convert it for calculations
      engineVolumeOpts: window.engineVolumes,
      manufactureYear: window.currentYear,
      manYearOptions: window.manYearOptions,
      engineType: window.engineType.Petrol,
      batteryKwh: 77,
      // Ukrainian market comparison
      ukrainianMarketPrice: 0,
      marketCategory: "", // 'underpriced', 'fair', 'overpriced'
      carrierInfo: {
        make: "",
        model: "",
        color: "",
        transmission: "",
        mileage: 0,
      },
    },
    // Повідомлення про невдалий запис у локальну БД (сервер не запущено).
    // Не персиститься: при наступному записі має перевірятись наново.
    dbMsg: "",
    marketStatus: "", // '', 'loading', 'ok', 'warn', 'error'
    marketMsg: "",
    // Підпис авто (марка|модель|рік), до якого належить знайдена ринкова ціна.
    // Якщо він розійшовся з поточним авто — ціна застаріла і її треба прибрати.
    marketTarget: "",
    // Фіксовані збори, однакові для будь-якого авто. Тут вони задані один
    // раз: і `total()`, і таблиця витрат в index.html читають цей масив.
    // Раніше кожне з цих чисел існувало у двох копіях — літералом у `total()`
    // і текстом у шаблоні, — тож таблиця й підсумок могли розійтися; а поруч
    // лежали ще сім полів (portExpeditor/portBrokerFee/…), яких не читав
    // ніхто, і вони показували зовсім інші суми.
    //
    // ⚠️ Джерело сум невідоме, значення успадковані з коміту 2021-07-28 —
    // див. docs/shipping-rates-baseline.md, розділ «Аудит провенансу».
    fixedFees: [
      { key: "broker", label: "Брокер/експедитор", amount: 550 },
      { key: "parking", label: "Парковка в порту", amount: 44 },
      { key: "toHome", label: "Доставка по Україні", amount: 250 },
      { key: "cert", label: "Сертифікація", amount: 250 },
    ],
  };
};
export const createInitialState = window.createInitialState;
