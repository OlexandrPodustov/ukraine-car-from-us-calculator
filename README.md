# ukraine-car-from-us-calculator

tool to calculate car from us price

http://calc.pp.ua

## Як запустити

```bash
npm start          # Node-сервер на :5500 — статика + /api з логуванням у SQLite. Потрібен Node 24+ (node:sqlite)
```

Це **єдиний** варіант, який піднімає `/api`. Сторінки `lots.html`, `searches.html` і `stats.html`
читають дані саме звідти, тому без нього вони показують `Помилка: Failed to fetch (сервер запущено?)`.

Альтернативи — тільки статика, **без** `/api` (калькулятор рахує, але нічого не зберігається,
а сторінки збережених лотів/пошуків не працюють):

```bash
npm run start:py   # python3 -m http.server 5500
make start         # теж python-сервер — не плутати з `npm start`
```

Перевірити, що API живий:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5500/api/lots   # має бути 200
```

Можна також відкривати сторінки через VS Code Live Server (:5501) — `apiBase()` сам націлює
запити на :5500, а Node віддає CORS для `/api/*`. Але `npm start` при цьому має працювати паралельно.

Для парсингу лотів і запиту ціни AUTO.RIA потрібен `config.js` (gitignored):
скопіюй `config.example.js` → `config.js` і заповни `proxyUrl` та `autoRiaToken`.

## Структура

assets/js/
├── app.js ← точка входу (Vue instance)
├── services/
│ ├── storage.service.js ← localStorage persist (лише вибір, не довідники)
│ ├── rates.service.js ← курси НБУ (EUR/USD і USD/UAH)
│ ├── auction-parser.service.js ← парсинг IAAI/Copart лотів
│ └── market-lookup.service.js ← пошук ціни на укр. ринку
├── core/
│ ├── state.js ← data()
│ ├── computed.js ← computed properties
│ └── watchers.js ← watch
└── methods/
├── ui.methods.js ← UI логіка (локація, dropdown)
├── fees.methods.js ← розрахунок всіх зборів
└── market.methods.js ← аналіз угоди (ACV, benefit, maxBid)

## Ставки й константи

Кожна ставка в коді має датований зріз у `docs/`:

| Файл                              | Що покриває                       |
| --------------------------------- | --------------------------------- |
| `docs/customs-rates-baseline.md`  | мито, акциз, ПДВ, митна вартість  |
| `docs/pension-fee-baseline.md`    | збір до Пенсійного фонду (3/4/5%) |
| `docs/auction-fees-baseline.md`   | збори Copart / IAAI               |
| `docs/shipping-rates-baseline.md` | автовоз по США, океанський фрахт  |

Перед тим як міняти будь-яке число — прочитай відповідний baseline. При новому
вимірі додавай **нову колонку**, а не перезаписуй стару: цінність саме в дельті.
