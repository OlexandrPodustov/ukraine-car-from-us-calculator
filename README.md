# ukraine-car-from-us-calculator

tool to calculate car from us price

http://calc.pp.ua

assets/js/
├── app.js ← точка входу (Vue instance)
├── services/
│ ├── storage.service.js ← localStorage persist
│ ├── rates.service.js ← курс НБУ
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
