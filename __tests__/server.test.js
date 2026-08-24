/**
 * @jest-environment node
 *
 * API локального сервера. Досі не було покрито взагалі, хоча саме тут живуть
 * найтихіші поламки: розбіжність між списком колонок і списком «?», UPSERT,
 * що затирає вже збережене, і колонки з однаковими іменами з двох таблиць.
 *
 * Сервер піднімається окремим процесом на власній БД (DB_PATH) — робоча
 * data/searches.db у тестах не відкривається взагалі.
 */
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = 5400 + (process.pid % 120);
const BASE = "http://127.0.0.1:" + PORT;

let child;
let tmpDir;

function waitForServer(deadlineMs) {
  const until = Date.now() + deadlineMs;
  return new Promise((resolve, reject) => {
    (function ping() {
      fetch(BASE + "/api/lots")
        .then(resolve)
        .catch(() => {
          if (Date.now() > until)
            return reject(new Error("сервер не піднявся"));
          setTimeout(ping, 100);
        });
    })();
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "carcalc-srv-"));
  child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DB_PATH: path.join(tmpDir, "test.db"),
    }),
    stdio: "ignore",
  });
  await waitForServer(15000);
}, 20000);

afterAll(() => {
  if (child) child.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Сирий GET без нормалізації шляху — саме так виглядає спроба вийти з теки.
function rawGetStatus(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method: "GET", path: rawPath },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function postJson(route, body) {
  return fetch(BASE + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FULL_LOT = {
  auction: "iaai",
  lotNumber: "11112222",
  url: "https://www.iaai.com/VehicleDetail/11112222~US",
  vin: "TESTVIN1111222233",
  year: 2021,
  make: "BMW",
  model: "M340I",
  color: "Blue",
  odometer: 41000,
  primaryDamage: "FRONT END",
  titleCode: "SV",
  starts: "Starts",
  catalyticConverter: "Present",
  catIndicator: 0,
  keyFob: "True",
  titleNotes: "SALVAGE HISTORY",
  hybrid: 0,
  repairCost: 9000,
  images: [{ hd: "https://x/hd", thumb: "https://x/th" }],
  raw: { inventoryView: { attributes: { SalvageId: "11112222" } } },
};

async function lotByNumber(n) {
  const rows = await (await fetch(BASE + "/api/lots")).json();
  return rows.find((r) => r.lot_number === n);
}

describe("POST /api/lots", () => {
  it("зберігає лот разом із полями стану, доданими 2026-08-23", async () => {
    expect((await postJson("/api/lots", FULL_LOT)).status).toBe(201);
    const row = await lotByNumber("11112222");
    expect(row).toMatchObject({
      make: "BMW",
      starts: "Starts",
      catalytic_converter: "Present",
      key_fob: "True",
      title_notes: "SALVAGE HISTORY",
      cat_indicator: 0,
      hybrid: 0,
    });
  });

  it("повторний, бідніший парсинг не стирає вже збережене", async () => {
    await postJson("/api/lots", FULL_LOT);
    await postJson("/api/lots", {
      auction: "iaai",
      lotNumber: "11112222",
      year: 2021,
      make: "BMW",
    });
    const row = await lotByNumber("11112222");
    expect(row.vin).toBe("TESTVIN1111222233");
    expect(row.color).toBe("Blue");
    expect(row.odometer).toBe(41000);
    expect(row.starts).toBe("Starts");
  });

  it("не дублює лот — (аукціон, номер) унікальні", async () => {
    await postJson("/api/lots", FULL_LOT);
    const rows = await (await fetch(BASE + "/api/lots")).json();
    expect(rows.filter((r) => r.lot_number === "11112222")).toHaveLength(1);
  });

  it("не пише в url нічого, крім http(s)-посилання", async () => {
    await postJson(
      "/api/lots",
      Object.assign({}, FULL_LOT, {
        lotNumber: "33334444",
        url: "скопійований зі сторінки текст",
      }),
    );
    const row = await lotByNumber("33334444");
    // Замість сміття — канонічне посилання, зібране з аукціону й номера лота.
    expect(row.url).toBe("https://www.iaai.com/VehicleDetail/33334444~US");
  });
});

describe("POST /api/searches", () => {
  it("прив'язується до лота за (аукціон, номер) і віддає його id", async () => {
    await postJson("/api/lots", FULL_LOT);
    const lot = await lotByNumber("11112222");
    const res = await postJson("/api/searches", {
      auction: "iaai",
      lotNumber: "11112222",
      make: "BMW",
      model: "M340I",
      year: 2021,
      marketPrice: 40000,
      sampleCount: 9,
      totalCost: 26000,
      repairCost: 9000,
      diff: 5000,
      category: "underpriced",
      prices: [39000, 41000],
      percentiles: { "50.0": 40000 },
      filtersApplied: ["3 Series", "кеш"],
    });
    expect(res.status).toBe(201);
    expect((await res.json()).lotId).toBe(lot.id);
  });

  it("кошт ремонту зберігається окремо від розмитненого кошту", async () => {
    const rows = await (await fetch(BASE + "/api/searches")).json();
    const row = rows.find((r) => r.lot_number === "11112222");
    expect(row.total_cost).toBe(26000);
    expect(row.repair_cost).toBe(9000);
    expect(row.diff).toBe(5000);
  });

  it("у списку лотів кошт ремонту з пошуку не затирає оцінку аукціону", async () => {
    // В обох таблицях є колонка repair_cost: у lots це оцінка IAAI, у searches
    // — те, що користувач заклав. Без псевдоніма одна затирала б іншу.
    const row = await lotByNumber("11112222");
    expect(row.repair_cost).toBe(9000);
    expect(row.search_repair_cost).toBe(9000);
    expect(row.total_cost).toBe(26000);
  });

  it("повний запис віддає масиви для графіків", async () => {
    const rows = await (await fetch(BASE + "/api/searches")).json();
    const id = rows.find((r) => r.lot_number === "11112222").id;
    const full = await (await fetch(BASE + "/api/searches/" + id)).json();
    expect(full.prices).toEqual([39000, 41000]);
    expect(full.percentiles).toEqual({ "50.0": 40000 });
    expect(full.filters).toContain("кеш");
    expect(full.prices_json).toBeUndefined();
  });
});

describe("статика", () => {
  it("віддає сторінку калькулятора", async () => {
    const res = await fetch(BASE + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("не випускає за межі теки проєкту", async () => {
    // fetch() нормалізує «..» ще до відправки, тож перевіряти треба сирим
    // запитом. Голий startsWith(ROOT) пропускав сусідню теку з таким самим
    // префіксом імені («…-calculator-private»).
    for (const p of [
      "/../../../../etc/hosts",
      "/../ukraine-car-from-us-calculator-private/secret.txt",
    ]) {
      expect(await rawGetStatus(p)).toBe(403);
    }
  });
});

describe("/api/resales", () => {
  // Мінімальний рядок у тій самій формі, яку віддає POST /api/resales/lookup.
  // Сам lookup сюди не тягнемо: він ходить у мережу (AUTO.RIA + saleshistory),
  // а тест має бути детермінованим і не палити годинний ліміт RIA.
  const ROW = {
    ts: "2026-08-24T10:00:00.000Z",
    vin: "WAUC4CF56RA030212",
    ria_auto_id: 40023169,
    ria_url: "https://auto.ria.com/auto_audi_s5_sportback_40023169.html",
    ria_price_usd: 43300,
    ria_city: "Луцьк",
    ria_add_date: "2026-08-14 02:01:51",
    ria_active: 1,
    auction: "copart",
    lot_number: "51505035",
    sold_price: 20000,
    sale_date: "2025-07-15",
    acv: 49620,
    us_repair_cost: 32804,
    landed_cost: 37018,
    max_bid_for_market: 19854,
    risk_coefficient: 0.85,
  };

  function putJson(route, body) {
    return fetch(BASE + route, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  let id;

  it("зберігає спостереження і рахує валову", async () => {
    const res = await postJson("/api/resales", ROW);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    id = body.id;

    const row = await (await fetch(BASE + "/api/resales/" + id)).json();
    expect(row.sold_price).toBe(20000);
    expect(row.gross_profit).toBe(43300 - 37018);
    // Кошторис ремонту США лежить у рядку, але у вердикт не входить —
    // те саме правило, що для searches.repair_cost.
    expect(row.us_repair_cost).toBe(32804);
    expect(row.net_profit).toBe(row.gross_profit);
    expect(row.ua_repair_source).toBe("none");
  });

  it("відхиляє VIN неправильної форми", async () => {
    const res = await postJson("/api/resales", { ...ROW, vin: "SHORT" });
    expect(res.status).toBe(400);
  });

  it("повторний POST оновлює рядок, а не дублює його", async () => {
    const before = (await (await fetch(BASE + "/api/resales")).json()).length;
    const res = await postJson("/api/resales", {
      ...ROW,
      ria_price_usd: 39900,
    });
    expect(res.status).toBe(201);
    const after = await (await fetch(BASE + "/api/resales")).json();
    expect(after.length).toBe(before);
    const row = after.find((r) => r.id === id);
    expect(row.ria_price_usd).toBe(39900);
    // Похідні мають перерахуватись від нової ціни, а не лишитись від старої.
    expect(row.gross_profit).toBe(39900 - 37018);
  });

  it("зміна ціни ДОПИСУЄ зріз, а не перезаписує попередній", async () => {
    // Уся цінність таблиці — в дельті: авто стояло за $43 300, впало до
    // $39 900. Перезапис знищив би саме це.
    const row = await (await fetch(BASE + "/api/resales/" + id)).json();
    expect(row.priceHistory.length).toBe(2);
    expect(row.priceHistory.map((p) => p.price_usd)).toEqual([43300, 39900]);
  });

  it("бідніший повторний POST не затирає вже збережене", async () => {
    await postJson("/api/resales", {
      vin: ROW.vin,
      ria_auto_id: ROW.ria_auto_id,
      ria_price_usd: 39900,
    });
    const row = await (await fetch(BASE + "/api/resales/" + id)).json();
    expect(row.sold_price).toBe(20000);
    expect(row.landed_cost).toBe(37018);
    expect(row.sale_date).toBe("2025-07-15");
  });

  it("PUT ставить ремонт в Україні і перераховує чисту та маржу", async () => {
    const res = await putJson("/api/resales/" + id, {
      uaRepairCost: 9000,
      overheadCost: 500,
    });
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.ua_repair_cost).toBe(9000);
    expect(row.ua_repair_source).toBe("manual");
    expect(row.net_profit).toBe(39900 - 37018 - 9000 - 500);
    expect(row.margin_pct).toBeCloseTo(
      (39900 - 37018 - 9000 - 500) / (37018 + 9000 + 500),
      6,
    );
  });

  it("PUT з нулем повертає рядок у стан «ремонт невідомий»", async () => {
    const row = await (
      await putJson("/api/resales/" + id, { uaRepairCost: 0 })
    ).json();
    expect(row.ua_repair_cost).toBe(0);
    expect(row.ua_repair_source).toBe("none");
    expect(row.net_profit).toBe(row.gross_profit - 500);
  });

  it("список не тягне важкі *_json", async () => {
    const rows = await (await fetch(BASE + "/api/resales")).json();
    expect(rows[0].history_json).toBeUndefined();
    expect(rows[0].ria_json).toBeUndefined();
    expect(rows[0].landed_breakdown_json).toBeUndefined();
    expect(rows[0].vin).toBe(ROW.vin);
  });

  it("404 на невідомий id", async () => {
    const res = await fetch(BASE + "/api/resales/999999");
    expect(res.status).toBe(404);
  });
});
