/**
 * @jest-environment node
 *
 * Розбір аукціонної історії за VIN (saleshistory.org).
 *
 * Фікстури — це збережені цілком реальні сторінки лота Audi S5 Sportback
 * (VIN WAUC4CF56RA030212), а не обрізаний фрагмент: рівно так само
 * __tests__/fixtures/iaai-lot-46380419.json тримає весь JSON лота. Розмітка
 * чужого сайту зміниться без попередження, і саме цей тест має про це сказати.
 */
const fs = require("node:fs");
const path = require("node:path");
const vh = require("../lib/vin-history.js");

const VIN = "WAUC4CF56RA030212";
const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

const detailHtml = fixture("saleshistory-detail-" + VIN + ".html");
const searchHtml = fixture("saleshistory-search-" + VIN + ".html");

describe("детальна сторінка", () => {
  const d = vh.parseDetail(detailHtml, VIN);

  it("дістає ставку, дату продажу і номер лота", () => {
    expect(d.soldPrice).toBe(20000);
    expect(d.saleDate).toBe("2025-07-15");
    expect(d.saleTime).toBe("19:00:00");
    expect(d.lotNumber).toBe("51505035");
  });

  it("дістає стан авто", () => {
    expect(d.primaryDamage).toBe("FRONT END");
    expect(d.secondaryDamage).toBe("SIDE");
    expect(d.odometer).toBe(19186);
    expect(d.odometerBrand).toBe("A");
    expect(d.keys).toBe("YES");
    expect(d.documents).toBe("CA SC");
  });

  it("дістає ACV і кошторис ремонту США", () => {
    expect(d.acv).toBe(49620);
    expect(d.usRepairCost).toBe(32804);
  });

  it("дістає техніку — значення бувають загорнуті в <a>", () => {
    expect(d.year).toBe(2024);
    expect(d.make).toBe("AUDI");
    expect(d.model).toBe("S5/RS5");
    expect(d.engine).toBe("3.0L 6");
    expect(d.transmission).toBe("AUTOMATIC");
    expect(d.color).toBe("RED");
    expect(d.drive).toBe("All wheel drive");
    expect(d.fuel).toBe("GAS");
  });

  it("розбирає локацію на штат і індекс", () => {
    expect(d.location).toBe("CA - VAN NUYS VAN NUYS (91405 1509)");
    expect(d.locationState).toBe("CA");
    expect(d.locationZip).toBe("91405");
  });

  it("бере аукціон із сайдбара, а не з бейджа видачі", () => {
    // На цьому ж авто бейдж пошуку каже IAAI, а сайдбар, текст огляду й
    // префікс теки фото (c51505035) — copart. Джерело правди — сайдбар,
    // тека його підтверджує незалежно.
    expect(d.auction).toBe("copart");
    expect(d.auctionFromUploads).toBe("copart");
    expect(vh.parseSearchResults(searchHtml)[0].auctionBadge).toBe("iaai");
  });

  it("збирає всі фото без дублів", () => {
    expect(d.images).toHaveLength(16);
    expect(new Set(d.images).size).toBe(16);
    d.images.forEach((u) =>
      expect(u).toMatch(/^https:\/\/saleshistory\.org\//),
    );
  });
});

describe("видача пошуку", () => {
  const cards = vh.parseSearchResults(searchHtml);

  it("дає детермінований лінк на деталі за VIN", () => {
    expect(cards).toHaveLength(1);
    expect(cards[0].detailUrl).toBe(
      "https://" + VIN.toLowerCase() + ".saleshistory.org/",
    );
    expect(vh.detailUrl(VIN)).toBe(cards[0].detailUrl);
  });

  it("повертає порожній список, коли VIN не знайдено", () => {
    expect(vh.parseSearchResults("<html><body>nothing</body></html>")).toEqual(
      [],
    );
  });
});

describe("допоміжні розбори", () => {
  it("тримає пробіг у милях і знімає позначку одометра", () => {
    expect(vh.parseMileage("19186 (A)")).toEqual({
      odometer: 19186,
      odometerBrand: "A",
    });
    expect(vh.parseMileage("")).toEqual({
      odometer: null,
      odometerBrand: null,
    });
  });

  it("не вигадує штат там, де його нема", () => {
    expect(vh.parseLocation("Newburgh")).toEqual({
      location: "Newburgh",
      state: null,
      zip: null,
    });
  });
});

describe("fetchVinHistory", () => {
  const fakeFetch = (pages) => (url) => {
    const body = pages[url];
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      text: () => Promise.resolve(body),
    });
  };

  it("не кидає помилку, коли VIN просто не в базі — це теж спостереження", async () => {
    const res = await vh.fetchVinHistory(VIN, {
      fetch: fakeFetch({
        ["https://saleshistory.org/search/?vin=" + VIN]: "<html></html>",
      }),
    });
    expect(res.found).toBe(false);
    expect(res.vin).toBe(VIN);
  });

  it("фіксує розбіжність бейджа й сторінки в notes, а не мовчки обирає одне", async () => {
    const res = await vh.fetchVinHistory(VIN, {
      fetch: fakeFetch({
        ["https://saleshistory.org/search/?vin=" + VIN]: searchHtml,
        ["https://" + VIN.toLowerCase() + ".saleshistory.org/"]: detailHtml,
      }),
    });
    expect(res.found).toBe(true);
    expect(res.auction).toBe("copart");
    expect(res.notes.join(" ")).toMatch(/бейдж пошуку каже iaai/);
  });

  it("відхиляє VIN неправильної форми", async () => {
    await expect(vh.fetchVinHistory("NOPE")).rejects.toThrow(/17 символів/);
  });
});
