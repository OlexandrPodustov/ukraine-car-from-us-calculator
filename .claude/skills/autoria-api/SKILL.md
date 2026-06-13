---
name: autoria-api
description: Reference for the official developers.ria.com (AUTO.RIA) REST API — endpoints, params, free-tier limits, and the mandatory caching strategy used to avoid burning the rate limit. Use when working on the Ukrainian market-price lookup feature.
---

# AUTO.RIA developers API

Official REST API for AUTO.RIA car listings. Used by this calculator to look up the
Ukrainian market price for a given lot (make / model / year) — replacing the old,
broken HTML-scraping approach.

- **Base URL:** `https://developers.ria.com`
- **Auth:** query param `?api_key=...`. The key lives in `config.js` as `CONFIG.autoRiaToken`
  (gitignored; `config.example.js` has the placeholder).
- **CORS:** the API returns `access-control-allow-origin: *`, so call it **directly from the
  browser — do NOT route through `CONFIG.proxyUrl`** (the proxy is only for HTML scraping of
  auction sites). Avoiding the proxy keeps latency low.
- **Docs:** <https://github.com/ria-com/auto-ria-rest-api> (markdown — readable, unlike the
  JS-rendered <https://docs-developers.ria.com>). Used-cars parameter conventions:
  <https://docs-developers.ria.com/en/used-cars/parameters/how_to_work_with_parameters>.

## Parameter syntax convention (used-cars search / average_price)

Filters use an **indexed array + range** notation in the query string:

- **Range** on a field: `field[0].gte` / `field[0].lte` (≥ / ≤). e.g. year:
  `yers[0].gte=2024&yers[0].lte=2026`. Brackets must be URL-encoded → send
  `yers%5B0%5D.gte=...` (verified working — returned 474 listings).
- **Multiple values** of one field: repeat with incrementing index — `field[0]`, `field[1]`,
  `field[2]` (e.g. several fuel/gearbox/body ids). Multi-value of the same field = OR logic.
- Single scalar filters (`marka_id`, `model_id`, `main_category`, `city_id`) are passed plain,
  no index.

This convention is already applied in `lookupUkrainianPrice` (`market.methods.js`) for the year
range; extend the same `field[i].gte/lte` / `field[i]` pattern when adding mileage, fuel, body,
or gearbox filters.

## ⚠️ Free tier is rate-limited — CACHE AGGRESSIVELY

The free subscription has a limited request quota. Exceeding it returns HTTP `429`
`OVER_RATE_LIMIT`. The quota number is not published ("contact us"). Treat every request as
precious. **Never call an endpoint twice for data you already have.**

Caching rules (all in `localStorage`):

| Data | Volatility | Cache TTL | Key |
|------|-----------|-----------|-----|
| marks list (`/categories/1/marks`) | static | **forever** (no TTL) | `ria_marks_v1_cat1` |
| models per mark (`.../marks/:id/models`) | static | **forever** | `ria_models_v1_:markaId` |
| `average_price` result | slow-moving | 12–24 h | `ukr_market_cache_v1\|make\|model\|year\|...` |

- The marks list (391 brands) and per-brand model lists essentially never change → fetch
  **once ever**, store, reuse across sessions. A repeated `/categories/1/marks` call (as
  happened during debugging) is pure waste.
- Resolve `marka_id` / `model_id` from the cached lists in memory; only hit the network for
  `average_price`, and cache that too.
- Always read cache → return early on hit, before any `fetch`.

## Endpoints

### Marks (brands) — `marka_id`
```
GET /auto/categories/1/marks?api_key=KEY
```
Response: `[{ "name": "BMW", "value": 9 }, ...]` (`value` = `marka_id`). Category `1` = passenger cars.

### Models per mark — `model_id`
```
GET /auto/categories/1/marks/:markaId/models?api_key=KEY
```
Response: `[{ "name": "3 Series", "value": 3219 }, ...]` (`value` = `model_id`).

> **Trim vs model gotcha:** the lot model from the auction parser is often a *trim*
> (e.g. `M340I`), but the API only lists *base models* (`3 Series` = 3219). A literal string
> match fails. Resolution strategy: exact name → substring/token match → if still unresolved,
> fall back to `marka_id` + year only (broader, less accurate) and warn the user the match was
> brand-level. Never silently return a wrong-model price.

### Average price — the main endpoint
```
GET /auto/average_price?api_key=KEY&main_category=1&marka_id=9&model_id=3219&yers[0].gte=2024&yers[0].lte=2026
```
Params: `marka_id`, `model_id`, `yers[0].gte` / `yers[0].lte` (year range), `raceInt`
(mileage range, thousands km), `fuel_id`, `gear_id`, `city_id`.

Response:
```json
{
  "total": 474,
  "arithmeticMean": 83247.36,
  "interQuartileMean": 75137.35,
  "percentiles": { "1.0":..., "25.0":47000, "50.0":71252.85, "75.0":114700, "95.0":..., "99.0":... },
  "prices": [ ... up to 1000 ... ],
  "classifieds": [ ...auto ids... ]
}
```
- Use **`interQuartileMean`** as the headline market price (drops top/bottom outliers).
  `percentiles["50.0"]` is the median; `total` is the sample size — show it for confidence.
- **Persist for charts, don't re-fetch:** each lookup stores the full `prices[]` array and
  `percentiles` object to SQLite (`server.js`, columns `prices_json` / `percentiles_json`).
  The stats page (`stats.html`, via `GET /api/searches/:id`) draws the distribution from that
  stored data — never call `average_price` again just to render a chart.
- **Empty/low data:** HTTP `400` with `{ "message": "Not Enough Data" }`. Handle as a warning,
  not a crash.

### Search (ids only) — usually not needed for pricing
```
GET /auto/search?api_key=KEY&category_id=1&marka_id=..&model_id=..&s_yers=..&po_yers=..&currency=1&countpage=100&page=0
```
Returns `result.search_result.ids` (max 100) + `count`. `average_price` already aggregates
prices, so prefer it over fetching individual listings via `/auto/info?auto_id=`.

## Errors
- `429` `OVER_RATE_LIMIT` — quota exceeded. Back off; do not retry in a loop.
- `400` `Not Enough Data` — too few listings for the filter; relax filter or warn user.

## Known IDs (handy during dev — don't re-fetch to discover these)
- Category passenger cars: `1`
- BMW `marka_id` = `9`; BMW "3 Series" `model_id` = `3219`
