# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page calculator (Ukrainian UI) that estimates the total landed cost of importing a used
car from US auctions (Copart / IAAI) to Ukraine, and compares it against the Ukrainian market
price. Frontend is **Vue 2 loaded from a CDN** (`vue.js`, not a build step). An optional Node
server (`server.js`) serves the static files and logs every lookup to SQLite.

## Commands

```bash
npm start            # Node server on :5500 — static files + /api SQLite logging. Needs Node 24+ (node:sqlite).
npm run start:py     # python3 static server on :5500 — NO API/DB logging (parsing/lookup still work, just not persisted)
npm test             # jest (jsdom)
npx jest -t "name"   # run a single test by name
npm run lint         # eslint assets/js (lint:fix to autofix)
npm run stylelint    # css     | npm run htmlhint = html | npm run format = prettier
make lint            # runs lint-js + lint-css + lint-html together
```

`make start` is **not** the same as `npm start` — the Makefile target runs the python static
server (no DB). Use `npm start` when you need the SQLite logging / `/api` endpoints.

You can also open the pages via VS Code Live Server (:5501); API calls auto-target :5500 (see
`apiBase()`), and the Node server sends permissive CORS for `/api/*`.

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
`ui.methods.js`, `fees.methods.js`, and `createMarketMethods()` each call `__createAllMethods()`
and **pick a subset by name** into their own object. `app.js` merges all three.

Consequence: to add or change any method, edit `market.methods.js`. A new method will **not**
appear on the Vue instance until you also add its name to the corresponding `pick` array in one
of the three `*.methods.js` files.

### Services are thin delegators

`services/auction-parser.service.js` and `services/market-lookup.service.js` don't hold logic.
In `app.js` `mounted()`, the real method is stashed (e.g. `vm.__rawParseAuctionLot`) and the
public method is swapped for a service call that delegates back to it. The actual parsing /
lookup code is in `market.methods.js`.

### State / computed / watchers

`core/state.js` → Vue `data()` (defaults like price, ports, customs). `core/computed.js` →
only `filteredLocations`. `core/watchers.js` → watchers. UI state persists to localStorage under
key `carCalcData` via `saveToLocalStorage()`; restored in `mounted()`.

### Two external integrations

1. **Auction parsing** (`parseAuctionLot`): fetches the Copart/IAAI lot page through
   `CONFIG.proxyUrl` (needed to get past Cloudflare/bot blocking), extracts the embedded JSON
   (`<script id="ProductDetailsVM">` or `__NEXT_DATA__`), fills the form (year, engine, fuel,
   body type, location, ACV, repair cost, etc.), and POSTs the full lot to `/api/lots`.
   `resetLotData()` runs first so fields from a previous lot never leak into a new one.
2. **AUTO.RIA market price** (`lookupUkrainianPrice`): calls `developers.ria.com` **directly**
   (CORS-allowed — do NOT route through the proxy). Resolves brand/model from cached dictionaries,
   then does tiered narrowing on `average_price` (≤3 calls, stop at first `total>=5`). **The free
   API tier is hourly rate-limited — caching in localStorage is mandatory.** See the
   `autoria-api` skill before touching this code.

### Persistence (server.js + SQLite at `data/searches.db`)

Two tables: `searches` (one row per market lookup, with heavy `*_json` columns for prices /
percentiles / classifieds) and `lots` (full parsed lot incl. HD photo URLs, 360°, videos, and
`raw_json`). `lots` is deduped by a unique `(auction, lot_number)` index and UPSERTed, so
re-parsing the same lot updates rather than duplicates. A search links to its lot via `lot_id`.
Schema migrations are done with try/catch `ALTER TABLE ADD COLUMN`. Companion pages read these:
`lots.html`, `searches.html`, and `stats.html` (draws distribution charts from the stored
`prices_json` / `percentiles_json` — never re-calls the rate-limited API just to render a chart).

**Never delete `data/searches.db`, and persist every field the RIA API returns** (these are
standing project rules — see memory).

## Tests

`__tests__/calculator.test.js` runs under jsdom but **re-declares** the functions it tests
(`inRange`, `calculateCopartFee`) and a `mockVm` inline rather than importing from source — the
source relies on browser `window` globals that don't exist under Node. So tests can silently
drift from the real implementation; keep them in sync by hand when changing fee logic.

## Linting nuance

ESLint treats `assets/js/constants/*.js` and `server.js` as `sourceType: script`; everything else
as `module`. Browser globals used across files are whitelisted in `.eslintrc.js` `globals` — add
new cross-file globals there or eslint will flag them as undefined.

## Git

Current branch is `main`; **PRs target `master`**.
