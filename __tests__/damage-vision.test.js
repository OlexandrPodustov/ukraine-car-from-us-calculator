/**
 * lib/damage-vision.js — усе, що можна перевірити без мережі й без моделі:
 * підготовка фото і арифметика кошторису.
 */
const path = require("path");
const vision = require(path.join(__dirname, "..", "lib", "damage-vision.js"));

describe("Підготовка фото лота", () => {
  const lot = {
    auction: "iaai",
    lot_number: "46133472",
    images_json: JSON.stringify([
      {
        hd: "https://vis.iaai.com/resizer?imageKeys=X~I1&width=2576&height=1932",
        w: 2576,
        h: 1932,
      },
      {
        hd: "https://vis.iaai.com/resizer?imageKeys=X~I2&width=2576&height=1932",
        w: 2576,
        h: 1932,
      },
      {
        hd: "https://vis.iaai.com/resizer?imageKeys=X~I3&width=2576&height=1932",
        w: 2576,
        h: 1932,
      },
    ]),
    image_captions: JSON.stringify(["Passenger Front Image", "Damage photo"]),
  };

  test("підписів менше, ніж фото — решта порожні, а не зсунуті", () => {
    // На реальному лоті 42 підписів 13 на 17 знімків. Якби зайві індекси
    // зсували список, «Manufacturer VIN Plate» поїхав би на чужий кадр.
    const t = vision.photoTargets(lot);
    expect(t.map((x) => x.caption)).toEqual([
      "Passenger Front Image",
      "Damage photo",
      "",
    ]);
    expect(t.map((x) => x.index)).toEqual([0, 1, 2]);
  });

  test("розмір переписується в query, а imageKeys лишається недоторканим", () => {
    // imageKeys — ключ ВИХІДНОГО файлу; підміниш RW/H усередині, і резайзер
    // віддасть 404. Керують лише width/height.
    const url = vision.resizeUrl(
      "https://vis.iaai.com/resizer?imageKeys=X~RW2576~H1932~TH0&width=2576&height=1932",
      1400,
      2576,
      1932,
    );
    expect(url).toContain("imageKeys=X~RW2576~H1932~TH0");
    expect(url).toContain("width=1400");
    expect(url).toContain("height=1050");
  });

  test("прямий .jpg без параметрів (Copart) лишається як є", () => {
    const url = "https://cs.copart.com/v1/AUTH_svc/lot/1.jpg";
    expect(vision.resizeUrl(url, 1400)).toBe(url);
  });

  test("порожній лот не валить перелік", () => {
    expect(vision.photoTargets({})).toEqual([]);
    expect(vision.photoTargets({ images_json: "не json" })).toEqual([]);
  });
});

describe("Факти лота для промпту", () => {
  test("порожні поля не потрапляють у промпт", () => {
    const text = vision.lotFacts({
      year: 2023,
      make: "AUDI",
      model: "S5 SPORTBACK",
      primary_damage: "FRONT END",
      secondary_damage: null,
      color: "",
      airbags: "Intact",
    });
    expect(text).toContain("FRONT END");
    expect(text).toContain("Подушки: Intact");
    expect(text).not.toContain("Додаткове пошкодження");
    expect(text).not.toContain("Колір");
  });
});

describe("Арифметика кошторису", () => {
  const items = [
    {
      part: "Капот",
      action: "replace",
      partCostUsd: 515,
      labourCostUsd: 56,
      paintCostUsd: 101,
      totalUsd: 672,
    },
    {
      part: "Фара права",
      action: "replace",
      partCostUsd: 626,
      labourCostUsd: 34,
      paintCostUsd: 0,
      totalUsd: 660,
    },
  ];

  test("підсумки перераховуються з позицій, а не приймаються на віру", () => {
    // Підсумок, що не сходиться з рядками, — найгірша помилка тут: виглядає
    // як зважена цифра, а не спирається на жоден рядок.
    const out = vision.reconcile({
      items,
      contingencyUsd: 200,
      totalUsd: 9999,
    });
    expect(out.partsTotalUsd).toBe(1141);
    expect(out.labourTotalUsd).toBe(90);
    expect(out.paintTotalUsd).toBe(101);
    expect(out.totalUsd).toBe(1141 + 90 + 101 + 200);
    expect(out.drift).toBe(9999 - out.totalUsd);
  });

  test("кошторис без позицій дає нуль, а не NaN", () => {
    const out = vision.reconcile({ items: [], contingencyUsd: 0, totalUsd: 0 });
    expect(out.totalUsd).toBe(0);
    expect(out.drift).toBe(0);
  });
});

describe("Довідник цін", () => {
  test("датований і має курс", () => {
    const book = vision.loadPriceBook();
    expect(book.asof).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(book.usdUah).toBeGreaterThan(20);
  });

  test("незміряні позиції лежать окремо від зміряних", () => {
    // Інакше estimate подавався б як measured — і через рік ніхто не
    // відрізнив би зважену ціну від вигаданої.
    const book = vision.loadPriceBook();
    expect(Object.keys(book.parts.measured).length).toBeGreaterThan(0);
    Object.values(book.parts.estimated).forEach((v) => {
      expect(v.note || "").toMatch(/estimate/i);
    });
  });
});
