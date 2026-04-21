# Poker Bejeweled (Offline Prototype)

Desktop-first offline prototype: swap cards on a **5x5 grid**, score **rows + columns** as poker hands, clear **Pair+**, then **cascade** (gravity + refill) with a combo multiplier.

## Setup

Requires **Node.js 20+** (for `node --test`).

```bash
npm install
```

## Run (dev server)

```bash
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`).

## Tests (poker evaluator)

```bash
npm test
```

## Controls

- Click a card to select it
- Click any other card to swap
- If the swap produces **no scoring hand on the first evaluation**, it is reverted

## Scoring

Hands supported (and scored): Pair, Two Pair, Trips, Straight, Flush, Full House, Quads, Straight Flush, Royal Flush.

Combo multiplier: first clear step \(x1\), second \(x2\), etc.

## Project structure

- `src/poker/`: isolated 5-card hand evaluator + tests
- `src/game/`: board state, swap rules, gravity/refill, fairness checks
- `src/render/`: DOM rendering helpers + light UI effects

