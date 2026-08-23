# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page calculator (Ukrainian UI) that estimates the total landed cost of importing a used
car from US auctions (Copart / IAAI) to Ukraine, and compares it against the Ukrainian market
price. Frontend is **Vue 2 loaded from a CDN** (`vue.js`, not a build step). An optional Node
server (`server.js`) serves the static files and logs every lookup to SQLite.

## Commands

```bash
DB_PATH=/tmp/x.db PORT=5599 npm start   # інша база й порт — для перевірок, робочу БД не чіпає
npm start            # Node server on 127.0.0.1:5500 — static files + /api SQLite logging. Needs Node 24+ (node:sqlite).
#                      Localhost only on purpose: it serves config.js (AUTO.RIA key, proxy URL) and an
#                      unauthenticated /api. HOST=0.0.0.0 npm start to expose it deliberately.
npm run start:py     # python3 static server on :5500 — NO API/DB logging (parsing/lookup still work, just not persisted)
npm test             # jest (jsdom)
npx jest -t "name"   # run a single test by name
npm run lint         # eslint assets/js (lint:fix to autofix)
npm run stylelint    # css     | npm run htmlhint = html | npm run format = prettier
make lint            # runs lint-js + lint-css + lint-html together
```

`make start` is **not** the same as `npm start` — the Makefile target runs the python static
server (no DB). Use `npm start` when you need the SQLite logging / `/api` endpoints.

You can also open the pages via VS Code Live Server (:5501). Every page resolves its API base by
**trying same-origin first and falling back to `http://localhost:5500`**, remembering whichever
answered (`apiBase()` / `apiFetch()` in the calculator, a small `apiFetch` in each companion page);
the Node server sends permissive CORS for `/api/*`. The old rule was `port === "5500" ? "" :
"http://localhost:5500"`, so serving the app on any other `PORT` left every `/api` call pointing at
a port nothing was listening on.

## Configuration (required for the two integrations)

`config.js` is **gitignored**. Copy `config.example.js` → `config.js` and fill in:

- `CONFIG.proxyUrl` — a CORS proxy (Cloudflare Worker) used **only** to scrape Copart/IAAI lot HTML.
- `CONFIG.autoRiaToken` — developers.ria.com API key for the Ukrainian market price lookup.

Without `config.js`, auction parsing and market lookup silently no-op.

## Architecture

### Module loading is via `window` globals, not ES imports

Every file in `assets/js/` is included as a separate `<script type="module">` in `index.html`
in a fixed order, but they communicate through `window.*` globals (each file does both
`window.foo = ...` and `export const foo = window.foo`). `app.js` is the entry point: it reads
the `window` globals and constructs the `new Vue({...})` instance, mounted on `#shippingApp`.
The same global constants (`window.autoLocation`, `window.engineType`, `window.currentYear`,
`window.calculateCopartFee`, …) are referenced directly throughout the methods.

### All methods live in one place — `methods/market.methods.js`

This is the biggest gotcha. `market.methods.js` defines `window.__createAllMethods()` which
returns **every** method on the app (UI, fees, customs math, market lookup, auction parsing).
`ui.methods.js` and `fees.methods.js` each **pick a subset by name** (`window.uiMethodNames` /
`window.feesMethodNames`, both fed through `window.pickMethods`), and `createMarketMethods()`
takes **everything else** — the complement, no list of its own. `app.js` merges all three.

Consequence: to add or change any method, edit `market.methods.js`; a new one lands on the Vue
instance automatically (in the market set). Until 2026-08-23 all three files had explicit lists,
so a method missing from every list silently did not exist on the instance and the template blew
up with «is not a function» only in the browser. `__tests__/methods-wiring.test.js` now guards
both halves: the three sets must partition the methods exactly, and every call in an `index.html`
Vue expression must resolve on the vm.

### Services are thin delegators

`services/auction-parser.service.js` and `services/market-lookup.service.js` don't hold logic.
In `app.js` `mounted()`, the real method is stashed (e.g. `vm.__rawParseAuctionLot`) and the
public method is swapped for a service call that delegates back to it. The actual parsing /
lookup code is in `market.methods.js`.

### State / computed / watchers

Editing ACV, the repair estimate or the risk coefficient does **not** rewrite the hammer price.
Until 2026-08-23 all three watchers called `recalcMaxBid()` (`autoPrice := maxBid()`), so
correcting the repair figure — the most common manual edit there is — threw away the bid the user
had just typed, and with `autoPrice == maxBid()` the total equals the limit by construction, which
turned «Вигода угоди» into the tautology `(ACV − repair) × (1 − risk)`. `recalcMaxBid()` is now
only reachable from the «⤒ у ціну» button next to the max-bid row.

`core/state.js` → Vue `data()` (defaults like price, ports, customs). `core/computed.js` →
only `filteredLocations`. `core/watchers.js` → watchers. UI state persists to localStorage under
key `carCalcData` via `saveToLocalStorage()`; restored in `mounted()` via
`applyPersistedState()`.

**Only the user's choices are persisted, never the reference tables.** `storage.service.js`
holds the shape (`pickPersistedState` / `applyPersistedState`), validates every stored id
against the live constants, and migrates pre-v2 payloads. Do not go back to storing whole
`autoPricing` / `autoShipping` / `customs` objects: that wrote 62 KB on every keystroke and,
worse, restored a frozen copy of `location.options` over the fresh one, so shipping-rate
updates never reached anyone who had opened the page before.

### IAAI JSON: field names are not what they look like

The lot JSON keeps "no data" as a single space (`" "`), and the useful value is often under a
different key than the obvious one: `ODOValue`/`ODOUoM` (not `Odometer`), `ExteriorColor` (not
`Color`), `PrimaryDamageDesc` (not `PrimaryDamage`), `DriveLineTypeDesc`, `SalvageId` for the lot
number. Until 2026-08-22 the parser read the obvious names, so odometer/color/damage/drive went
into the DB empty **and** `carrierInfo.mileage` was never set — the AUTO.RIA lookup silently
dropped its mileage filter. Use `pickAttr(...candidates)` (first non-blank, trimmed) and
`parseOdometer(attrs)` for anything read out of `attributes`.

`lot_number` is `attrs.SalvageId` — the number IAAI puts in the lot URL
(`/VehicleDetail/<SalvageId>~US`), which is what `canonicalLotUrl` rebuilds from. It is **not**
`inventoryView.itemId` (what the parser used before 2026-08-22) and not `StockNumber`; for many
lots all three differ, so the wrong one both breaks the rebuilt link and forks the
`(auction, lot_number)` dedup key on re-parse. `scripts/backfill-lot-fields.mjs` renumbers old
rows.

`inventoryView` carries **three** key/value lists, and until 2026-08-23 the parser read only the
first: `saleInformation` (where and when it sells), `vehicleInformation` (`TitleSaleDoc` —
«SALVAGE (Missouri)», «Wait Title» — plus `Wheel`, `StartCode`, `KeySlashFob`) and
`vehicleDescription` (`ManufacturedIn`, `Options`, `RestraintSystem` — the airbag inventory that,
next to `AirbagState: Deployed`, is the repair estimate). `lotKeyValues(nd, branch)` reads any of
them. `auctionInformation.biddingInformation.whoCanBuy` lists the IAA licence categories allowed to
bid — empty on 22 of 24 stored lots, and when it is not empty a broker without that licence cannot
bid at all.

A scan of the 25 stored `raw_json` payloads (2026-08-23) turned up more fields the parser was
walking past, all filled on 23–24 of 24 lots: `StartsDesc` («Starts» — *not* the same as
`RunAndDrive`; «starts but does not drive» is a different repair bill), `CatalyticConverter`
(«Present» — a missing one is $500–2000), `CATIndicator`/`CATText` (a flood/hail catastrophe unit,
usually a hard no for import), `KeyFOB` (separate from `Keys`), `TitleNotes` («SALVAGE HISTORY»),
and `HybridIndicator` — an explicit flag that beats reading the fuel string. All of them now land
in `lots`, in the calculator's «Стан лота» block and in the `lots.html` modal.
`CATText` is boilerplate present on every lot page, so it is stored only when the flag is set.

`attrs.State`/`City` is where the car physically **is**; `attrs.BranchState` is the selling
branch. For offsite lots (`OffsiteSaleInd === "True"`) they differ by whole states, and the
inland leg is priced from the car — so location matching uses `State` first, and matches the
locations table by **branch name**, not city (the table is named after branches: `NY LONG ISLAND

- NY (IAAI)`).

### The VIN is masked at the source; the full one comes off a photo

`attributes.VIN` is `WP1AA2A53RL******` — the last 6 characters of the serial are never sent.
This is **not** a login gate: verified 2026-08-23 on lot 46293657 that a logged-in session
(`auctionInformation.userLoginStatus: true`) has no unmasked 17-character VIN anywhere in the
DOM either, so forwarding a session cookie through the proxy buys nothing. Nor is it derivable —
the check digit sits at position 9, inside the visible part.

The one free source is the factory plate, which IAAI photographs and labels itself. The labels
are in the page **HTML**, not the lot JSON: a hidden `<input id="imageCaptions">` holding one
comma-separated list in image order (`Passenger Front Image,…,Manufacturer VIN Plate,Engine
photo,…`). `parseAuctionLot` lifts it into `nd.imageCaptions` **before** `applyLotJson`, so it
lands in `raw_json` and a lot replayed from the DB still knows which photo to open;
`collectLotMedia` hangs it on each image as `caption`, and `vinPlateImage()` picks the plate.

The mask stays in `lots.vin`, the VIN read off the plate lives in `lots.vin_full`, and every page
shows `vin_full || vin`. `vin_full` is deliberately **absent from the lot UPSERT** — parsing can
never produce it, so a re-parse has no way to clobber it; it is written only by
`PUT /api/lots/:id/vin`, which checks the 17-character shape and that every non-`*` position
matches the auction's mask. The client adds the ISO 3779 check digit (`vinCheckDigitOk`), which
is the only check that can catch a typo in the hand-copied tail — the mask hides exactly those
characters. `saveVinFull` accepts either all 17 or just the missing tail.

On page load the DB — not localStorage — is the source of truth for the VIN: `refreshLotFromDb()`
(called from `mounted()` when there is no `?lot=`) re-reads the lot row by `lotId`, or by
`(auction, lot_number)` from `GET /api/lots` when the id is missing, and takes `vin_full` and the
id from it. Before that, a typed VIN survived only until F5: `currentLot` has no watcher, and both
the `PUT …/vin` response and the `POST /api/lots` response (which carries the id and any known
`vin_full`) land *after* `applyLotJson` has already called `saveToLocalStorage()`. Those two
callbacks now save explicitly as well.

`scripts/vin-plate.mjs` does the same for lots already in the DB: `--refetch` re-reads each lot
page for its captions (stored in `lots.image_captions`, since old `raw_json` predates this) and
prints the plate-photo URL, `--set <id> <VIN|tail>` writes one. Of the 25 stored lots only 7 were
still live on 2026-08-23 — the other 18 return «not available», and their VINs stay masked
permanently. Two BMWs (lots 10 and 26) share the mask `3MW5U9J07M8******` and turned out to be
different cars (`B59684` vs `B56090`), which the UI could not distinguish before.

### The US departure port is derived, not chosen

`location.toPort` is all `-1`, so the "cheapest port" branch in `onLocationChange()` never fires.
The port now comes from `portByState` (`constants/ports.js`) and sets `currentCoast()`, i.e. the
ocean-freight rate. A manual pick in the UI sets `shippingPortManual` and is not overwritten by a
later location change. See `docs/shipping-rates-baseline.md`.

The **destination** port is a real choice, but only between Gdansk (default) and Klaipeda.
Odesa was dropped on 2026-08-23: container lines have not taken cargo into Ukrainian ports since
2022, so it priced a shipment that cannot happen — and being first in the list, it was the
default. Its rates ($2500/3000/2700, undated, from commit `33b5526`) survive only as a record in
the baseline doc. Both remaining routes currently total the same to the border (east 2050, west
2700, gulf 2150 = freight + truck to the border), so the pick moves no number today; it will the
moment either rate is re-measured. A stored `destinationPort: "odessa"` fails `hasId` in
`applyPersistedState` and silently falls back to the default.

### Re-pricing a saved lot without scraping

`parseAuctionLot` only fetches the page and digs out the embedded JSON; everything that fills the
form lives in `applyLotJson(nd, url, {save})`. The same JSON is already in `lots.raw_json`, so
`/index.html?lot=<id>` (the "🧮 Порахувати в калькуляторі" button in the lots.html modal) calls
`loadSavedLot(id)` → `applyLotJson(..., {save: false})` and re-prices a lot whose auction page may
already be gone. `save: false` matters — otherwise loading from the DB would write straight back
to it. `loadSavedLot` must also **set the auction from the stored row**: `collectLotData` and
`matchAuctionLocation` both read `autoPricing.auctions.selected`, and until 2026-08-23 that was
whatever was left in localStorage (Copart by default) — so an IAAI lot opened from `lots.html` was
priced on Copart's fee schedule, matched against Copart branches (a different inland rate), linked
to copart.com, and its next price search failed to find the lot by `(auction, lot_number)` and was
stored with no `lot_id` at all.

### The deal verdict is a Ukrainian-side subtraction; `repairCost` is a US number

`total()` = everything it takes to put the car on Ukrainian plates, customs cleared — the
«Фінальна ціна авто на українських номерах» line. The headline verdict is

- `marketPriceDifference()` = AUTO.RIA price − `total()`
- `maxBidForMarket()` solves `totalForPrice(bid) ≤ AUTO.RIA price × riskCoefficient`

Both sides of that subtraction are Ukrainian: what the car sells for here, and what it cost to
get it here. **`repairCost` is deliberately not in either.** It is filled from the auction's own
estimate — a US insurer's cost to restore the car at US labour rates with OEM parts — and it has
no bearing on what the same repair costs in Ukraine. On a real lot (Audi S5 2024, IAAI) that
estimate is $38,711 against a $49,150 Ukrainian market price, so subtracting it turned a
$25,961 margin into −$12,750 and marked the lot as a loss. Between 2026-08-23 and the fix on the
same day the repair *was* subtracted, and every salvage lot in the app read as hopeless.

The ACV-side metrics stay, clearly labelled as US reference figures and out of the verdict path:

- `cleanValue()` = `ACV − repair`, `benefit()` = `cleanValue() − total()` — «Вигода за ACV (США)»
- `maxBid()` solves `totalForPrice(bid) ≤ (ACV − repair) × riskCoefficient`

Both ceilings go through `solveMaxBid(target, extraCost)`; `extraCost` is now always 0, kept
because a *Ukrainian* repair estimate is exactly what would go there if one is ever added — and
that, not the auction's figure, is the honest way to net out the repair.

In the DB the two halves stay separate: `searches.total_cost` is the landed cost,
`searches.repair_cost` is the auction's repair estimate at search time (stored, not used in the
verdict), and `diff` is market − `total_cost`. In `GET /api/lots` the joined column is aliased
`search_repair_cost`, because `lots.repair_cost` (the auction's own estimate) is already in that
row. Rows written before the fix carry the old `diff`, so `lots.html`, `searches.html` and
`stats.html` **recompute it** from the stored `market_price − total_cost` instead of trusting the
column — which also re-derives the deal pill's category, so old cards stop showing a stale verdict.

The verdict is also **never** taken from the market cache. `writeMarketCache` still stores
`marketCategory`, but the cache-hit branch of `lookupUkrainianPrice` now passes `null` to
`applyMarketResult` and recomputes: the cache key is model/year/mileage/gearbox, not the lot, so
the stored category belonged to a car bought at a different price — which is how «✅ Вигідна»
ended up sitting next to a negative «Різниця» computed on the same screen.

### Two external integrations

1. **Auction parsing** (`parseAuctionLot`): fetches the Copart/IAAI lot page through
   `CONFIG.proxyUrl` (needed to get past Cloudflare/bot blocking), extracts the embedded JSON
   (`<script id="ProductDetailsVM">` or `__NEXT_DATA__`), fills the form (year, engine, fuel,
   body type, location, ACV, repair cost, etc.), and POSTs the full lot to `/api/lots`.
   `resetLotData()` runs first so fields from a previous lot never leak into a new one.
2. **AUTO.RIA market price** (`lookupUkrainianPrice`): calls `developers.ria.com` **directly**
   (CORS-allowed — do NOT route through the proxy). Resolves brand/model from cached dictionaries,
   then does tiered narrowing on `average_price` (≤3 calls, stop at first `total>=5`). **The free
   API tier is hourly rate-limited — caching in localStorage is mandatory.** The cache key must
   list every parameter that reaches the query (`getMarketCacheKey`: make/model/year/fuel/volume/
   kWh + a 10 000-km mileage bucket + gearbox) — mileage and gearbox are real filters, so a key
   without them served one price to two cars of the same model-year. A **cache hit still writes a
   row to `searches`** (`buildSearchPayload` builds the same row for both paths, with `кеш` appended
   to `filters_json`): the key is keyed on the model, not the lot, so the second lot of the same
   model-year used to read the price from cache, log nothing, and show up on `lots.html` with no
   deal pill at all. The cache therefore stores `prices` / `percentiles` too — enough to replay a
   full row for the histogram — but not `classifieds`, which is the heavy part of the response.
   See the `autoria-api` skill before touching this code.

   The lookup **runs by itself** — `maybeLookupUkrainianPrice()` after `applyLotJson` (once the
   lot POST resolves, so the `searches` row still finds its `lot_id`) and after `loadSavedLot`.
   The button beside «Ціна на українському ринку» is now the manual re-run. Guards keep it off the
   hourly limit: no API key, no make/model, a lookup already running, or a price already found for
   this exact car (`marketTarget === marketSignature()`) all skip it — and the lookup itself reads
   the cache before the network, so re-opening the same car costs nothing.

### Persistence (server.js + SQLite at `data/searches.db`)

Two tables: `searches` (one row per market lookup, with heavy `*_json` columns for prices /
percentiles / classifieds) and `lots` (full parsed lot incl. HD photo URLs, 360°, videos, and
`raw_json`). `lots` is deduped by a unique `(auction, lot_number)` index and UPSERTed, so
re-parsing the same lot updates rather than duplicates — with `COALESCE(excluded.col, col)`, so a
re-parse that comes back thinner than the first one does not blank the columns it could not fill
(`ts` and `offsite` are always sent, so they overwrite outright). A search links to its lot via `lot_id`.
Schema migrations are done with try/catch `ALTER TABLE ADD COLUMN`. Every `db.prepare(...)` must
come **after** the `CREATE TABLE` it names — `lotIdLookupStmt` sat above `CREATE TABLE lots` until
2026-08-23, so the server threw «no such table: lots» on any empty database and only ever worked
because `data/searches.db` ships in the repo. `DB_PATH` overrides the database file, which is how
`__tests__/server.test.js` drives the real server against a throwaway copy. `GET /api/lots` also
LEFT JOINs the most recent search per lot (`market_price` / `total_cost` / `diff` / `category`),
which is what the deal pill on each card shows. Companion pages read these:
`lots.html`, `searches.html`, and `stats.html` (draws distribution charts from the stored
`prices_json` / `percentiles_json` — never re-calls the rate-limited API just to render a chart).

**Never delete `data/searches.db`, and persist every field the RIA API returns** (these are
standing project rules — see memory). The same goes for the lot JSON: `raw_json` holds the whole
payload, so a parser fix can be replayed over past lots instead of re-scraping —
`node scripts/backfill-lot-fields.mjs --dry` shows what would change, without `--dry` writes it.
`scripts/vin-plate.mjs` is the companion for the two columns that cannot come from `raw_json`
(`vin_full`, `image_captions`) — see the VIN section above.
It loads the real `market.methods.js` (through the jest ESM transform), so there is no second
copy of the mapping to keep in sync, and it only fills columns that are currently NULL/empty.

## Tests

Tests run the **real** source. `__tests__/helpers/load-calculator.js` executes the files in
`assets/js/` in the same order as the `<script type="module">` tags in `index.html`, so they
populate a jsdom `window` exactly as in the browser; `test/esm-to-cjs-transform.cjs` is a tiny
jest transformer that strips the `export` lines (the real contract between files is `window.*`,
not the exports). `createVm(overrides)` then assembles a Vue-like instance from
`createInitialState()` + the three `*.methods.js` pickers + `createComputed()`.

`createVm` **binds every method to the vm and keeps a `_data`**, because Vue 2 does. This is not
cosmetic: `totalForPrice()` depends on it, and two bugs have already slipped through by working
in an unbound harness and looping the real page.

Before this, the test file kept its own copies of `inRange` / `calculateCopartFee` and a
hand-written `mockVm`, and had silently drifted from the source (it asserted a $59 gate fee that
does not exist and skipped a whole price branch that does).

## Rates and constants are dated, not guessed

A lot URL that is not `http(s)://…` is not stored: `collectLotData` takes the URL the parse
actually started from (not the live `auctionUrl`, which the paste-to-parse handler can change
mid-fetch), falls back to a canonical `auction + lotNumber` link, and `server.js` re-checks it.
A pasted blob of page text once ended up in `lots.url` and made the "↗ Сторінка лоту" button a
dead relative link.

`docs/*-baseline.md` is the source of truth for every rate in the code — customs, shipping,
pension fee, auction fees. Each records the value, the date it was checked, the primary source
and what is still unverified. **Read the relevant baseline before touching a number**, and when
re-measuring add a new column rather than overwriting the old one. Constants that turned out to
be undated 2021 leftovers are called out as such; do not present them as current.

## Linting nuance

ESLint treats `assets/js/constants/*.js` and `server.js` as `sourceType: script`; everything else
as `module`. Browser globals used across files are whitelisted in `.eslintrc.js` `globals` — add
new cross-file globals there or eslint will flag them as undefined.

## Git

Current branch is `main`; **PRs target `master`**.
