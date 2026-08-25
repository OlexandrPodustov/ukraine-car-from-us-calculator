#!/usr/bin/env node
/**
 * Кошторис ремонту в цінах України за фото лота — з командного рядка.
 *
 *   node scripts/damage-estimate.mjs --lot 42            # один лот
 *   node scripts/damage-estimate.mjs --lot 42 --force    # перерахувати
 *   node scripts/damage-estimate.mjs --all --dry         # що б порахувалось
 *   node scripts/damage-estimate.mjs --photos 42         # лише завантажити фото
 *
 * Той самий `lib/damage-vision.js`, що й у `/api/lots/:id/damage`, тож CLI і
 * сервер пишуть однакові рядки — як `scripts/resale.mjs` і `/api/resales`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vision = require(path.join(ROOT, "lib", "damage-vision.js"));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};

const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "searches.db");
const db = new DatabaseSync(DB_PATH);

const photosOnly = val("--photos");
const lotId = val("--lot") || photosOnly;
const dry = has("--dry");
const force = has("--force");

let lots;
if (lotId) {
  lots = db.prepare("SELECT * FROM lots WHERE id = ?").all(Number(lotId));
} else if (has("--all")) {
  lots = db
    .prepare(
      "SELECT * FROM lots WHERE images_json IS NOT NULL AND images_json <> '' " +
        (force ? "" : "AND (damage_json IS NULL OR damage_json = '') ") +
        "ORDER BY id DESC",
    )
    .all();
} else {
  console.error("Вкажи --lot <id>, --photos <id> або --all");
  process.exit(1);
}
if (!lots.length) {
  console.error("Лотів не знайдено");
  process.exit(1);
}

const usd = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

for (const lot of lots) {
  const name = `#${lot.id} ${lot.year} ${lot.make} ${lot.model} (${lot.auction} ${lot.lot_number})`;
  console.log("\n" + name);
  console.log(
    "  пошкодження за аукціоном:",
    lot.primary_damage || "—",
    "/",
    lot.secondary_damage || "—",
  );

  const photos = await vision.downloadLotPhotos(lot, { dry });
  const got = photos.filter((p) => p.bytes > 0).length;
  console.log(`  фото: ${photos.length} у лоті, ${got} на диску`);
  if (photosOnly) continue;

  if (dry) {
    console.log("  --dry: модель не викликається");
    continue;
  }

  try {
    const out = await vision.assessDamage(lot, { photos });
    const a = out.assessment;
    console.log("  ", a.summary);
    for (const it of a.items) {
      console.log(
        "   ",
        (it.part || "").padEnd(34).slice(0, 34),
        (it.action || "").padEnd(8),
        usd(it.totalUsd).padStart(8),
        it.confidence === "low" ? "⚠ низька певність" : "",
      );
    }
    console.log(
      "    ─ деталі",
      usd(a.partsTotalUsd),
      "| роботи",
      usd(a.labourTotalUsd),
      "| фарбування",
      usd(a.paintTotalUsd),
      "| запас",
      usd(a.contingencyUsd),
    );
    console.log(
      "    РАЗОМ:",
      usd(a.totalUsd),
      a.drift ? `(модель дала ${usd(a.totalUsd + a.drift)})` : "",
    );
    if (a.unknowns.length)
      console.log("    поза довідником:", a.unknowns.join("; "));

    db.prepare(
      "UPDATE lots SET ua_repair_cost = ?, ua_repair_source = 'vision', " +
        "damage_json = ?, damage_model = ?, damage_ts = ?, " +
        "damage_photo_count = ? WHERE id = ?",
    ).run(
      Math.round(a.totalUsd),
      JSON.stringify(a),
      out.model,
      new Date().toISOString(),
      out.photoCount,
      lot.id,
    );
    console.log("    записано в", DB_PATH);
  } catch (e) {
    console.error("    ✗", e.message);
  }
}
