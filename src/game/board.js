import { evaluateHand } from "../poker/evaluateHand.js";
import { HAND_PRIORITY, HAND_TYPE } from "../poker/evaluationTypes.js";

export const BOARD_SIZE = 5;

/**
 * @typedef {{ id: string, rank: any, suit: any }} Card
 * @typedef {(Card|null)[][]} Board
 * @typedef {{ r:number, c:number }} Pos
 *
 * @typedef {object} LineScore
 * @property {"row"|"col"} kind
 * @property {number} index
 * @property {import("../poker/evaluationTypes.js").HAND_TYPE[keyof import("../poker/evaluationTypes.js").HAND_TYPE] | string} type
 * @property {string} label
 * @property {Pos[]} cells
 * @property {number} baseScore
 */

export function createEmptyBoard() {
  /** @type {Board} */
  const b = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));
  return b;
}

/**
 * @param {Board} board
 * @returns {Board}
 */
export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/**
 * @param {Board} board
 * @returns {boolean}
 */
export function inBoundsBoard(board) {
  return board.length === BOARD_SIZE && board.every((r) => r.length === BOARD_SIZE);
}

/**
 * Deal a full board from a deck (no duplicates).
 * @param {{ draw(): any }} deck
 * @returns {Board}
 */
export function dealBoard(deck) {
  const b = createEmptyBoard();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      b[r][c] = deck.draw();
    }
  }
  return b;
}

export function posKey(p) {
  return `${p.r},${p.c}`;
}

export function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * Swap two positions in-place.
 * @param {Board} board
 * @param {Pos} a
 * @param {Pos} b
 */
export function swapCells(board, a, b) {
  const tmp = board[a.r][a.c];
  board[a.r][a.c] = board[b.r][b.c];
  board[b.r][b.c] = tmp;
}

/**
 * Returns line scores (rows+cols) that are scoring (Pair+).
 * @param {Board} board
 * @param {(type:string)=>number} baseScoreForType
 * @param {{ minType?: keyof typeof HAND_TYPE }} [opts]
 * @returns {LineScore[]}
 */
export function findScoringLines(board, baseScoreForType, opts = {}) {
  if (!inBoundsBoard(board)) throw new Error("Invalid board");

  const minType = opts.minType ?? HAND_TYPE.PAIR;
  const minPriority = HAND_PRIORITY[minType] ?? HAND_PRIORITY[HAND_TYPE.PAIR];

  /** @type {LineScore[]} */
  const lines = [];

  // Rows
  for (let r = 0; r < BOARD_SIZE; r++) {
    const cards = board[r].slice();
    if (cards.some((x) => !x)) continue;
    const evald = evaluateHand(/** @type {Card[]} */ (cards));
    if (!evald.isScoring) continue;
    if (evald.priority < minPriority) continue;
    lines.push({
      kind: "row",
      index: r,
      type: evald.type,
      label: evald.label,
      baseScore: baseScoreForType(evald.type),
      cells: Array.from({ length: BOARD_SIZE }, (_, c) => ({ r, c }))
    });
  }

  // Cols
  for (let c = 0; c < BOARD_SIZE; c++) {
    const cards = [];
    for (let r = 0; r < BOARD_SIZE; r++) cards.push(board[r][c]);
    if (cards.some((x) => !x)) continue;
    const evald = evaluateHand(/** @type {Card[]} */ (cards));
    if (!evald.isScoring) continue;
    if (evald.priority < minPriority) continue;
    lines.push({
      kind: "col",
      index: c,
      type: evald.type,
      label: evald.label,
      baseScore: baseScoreForType(evald.type),
      cells: Array.from({ length: BOARD_SIZE }, (_, r) => ({ r, c }))
    });
  }

  return lines;
}

/**
 * @param {LineScore[]} lines
 * @returns {Set<string>} set of "r,c"
 */
export function cellsToClear(lines) {
  const s = new Set();
  for (const line of lines) for (const p of line.cells) s.add(posKey(p));
  return s;
}

/**
 * Resolve any currently-scoring lines until the board is stable.
 * This is used during board generation so the player doesn't start in an
 * auto-clearing state, without requiring an astronomically rare "no pair anywhere"
 * random deal.
 *
 * @param {Board} board
 * @param {{ draw(): any, recycle(cards:any[]): void }} deck
 * @param {(type:string)=>number} baseScoreForType
 * @param {{ minType?: keyof typeof HAND_TYPE }} [opts]
 * @param {number} maxSteps safety cap
 * @returns {{ steps: number, clearedLines: number, stable: boolean }}
 */
export function stabilizeBoard(board, deck, baseScoreForType, opts = {}, maxSteps = 60) {
  let steps = 0;
  let clearedLines = 0;

  for (let i = 0; i < maxSteps; i++) {
    const lines = findScoringLines(board, baseScoreForType, opts);
    if (lines.length === 0) return { steps, clearedLines, stable: true };

    clearedLines += lines.length;
    const clearSet = cellsToClear(lines);
    const removed = [];
    for (const key of clearSet) {
      const [r, c] = key.split(",").map(Number);
      const card = board[r][c];
      if (card) removed.push(card);
      board[r][c] = null;
    }
    if (removed.length) deck.recycle(removed);
    applyGravity(board);
    refill(board, deck);
    steps++;
  }

  return { steps, clearedLines, stable: false };
}

/**
 * Applies gravity vertically so cards fall down, nulls rise.
 * @param {Board} board
 * @returns {Map<string, number>} map card.id -> dropRows
 */
export function applyGravity(board) {
  /** @type {Map<string, number>} */
  const drops = new Map();

  for (let c = 0; c < BOARD_SIZE; c++) {
    const stack = [];
    /** @type {Map<string, number>} */
    const oldRowById = new Map();
    for (let r = BOARD_SIZE - 1; r >= 0; r--) {
      const card = board[r][c];
      if (card) {
        stack.push(card);
        oldRowById.set(card.id, r);
      }
    }
    for (let r = BOARD_SIZE - 1; r >= 0; r--) {
      const card = stack[BOARD_SIZE - 1 - r] ?? null;
      board[r][c] = card;
      if (card) {
        const oldR = oldRowById.get(card.id);
        if (oldR != null) {
          const drop = r - oldR;
          if (drop > 0) drops.set(card.id, drop);
        }
      }
    }
  }

  return drops;
}

/**
 * Fill nulls from top with the next cards in the deck queue.
 * @param {Board} board
 * @param {{ draw(): any }} deck
 * @returns {Pos[]} positions that were filled (for animation)
 */
export function refill(board, deck) {
  /** @type {Pos[]} */
  const filled = [];
  for (let c = 0; c < BOARD_SIZE; c++) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (board[r][c]) continue;
      board[r][c] = deck.draw();
      filled.push({ r, c });
    }
  }
  return filled;
}

/**
 * Returns true if board currently has any scoring lines.
 * @param {Board} board
 * @param {(type:string)=>number} baseScoreForType
 * @param {{ minType?: keyof typeof HAND_TYPE }} [opts]
 */
export function hasAnyScoringLine(board, baseScoreForType, opts = {}) {
  return findScoringLines(board, baseScoreForType, opts).length > 0;
}

/**
 * Checks if there exists an adjacent swap that would create at least one scoring line.
 * This is a brute-force check on a 5x5 grid (fast enough).
 * @param {Board} board
 * @param {(type:string)=>number} baseScoreForType
 * @param {{ minType?: keyof typeof HAND_TYPE }} [opts]
 */
export function hasAnyScoringSwap(board, baseScoreForType, opts = {}) {
  const dirs = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 }
  ];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (const d of dirs) {
        const r2 = r + d.dr;
        const c2 = c + d.dc;
        if (r2 >= BOARD_SIZE || c2 >= BOARD_SIZE) continue;
        swapCells(board, { r, c }, { r: r2, c: c2 });
        const scoring = hasAnyScoringLine(board, baseScoreForType, opts);
        swapCells(board, { r, c }, { r: r2, c: c2 });
        if (scoring) return true;
      }
    }
  }
  return false;
}

/**
 * Checks if there exists ANY swap (any two positions) that would create a scoring line.
 * @param {Board} board
 * @param {(type:string)=>number} baseScoreForType
 * @param {{ minType?: keyof typeof HAND_TYPE }} [opts]
 */
export function hasAnyScoringSwapAnywhere(board, baseScoreForType, opts = {}) {
  const positions = [];
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) positions.push({ r, c });

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      swapCells(board, a, b);
      const scoring = findScoringLines(board, baseScoreForType, opts).length > 0;
      swapCells(board, a, b);
      if (scoring) return true;
    }
  }
  return false;
}

/**
 * Find one adjacent swap that would create a scoring line.
 * @param {Board} board
 * @param {(type:string)=>number} baseScoreForType
 * @param {{ minType?: keyof typeof HAND_TYPE }} [opts]
 * @returns {{ a: Pos, b: Pos } | null}
 */
export function findOneScoringSwap(board, baseScoreForType, opts = {}) {
  const candidates = [];
  const dirs = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 }
  ];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (const d of dirs) {
        const r2 = r + d.dr;
        const c2 = c + d.dc;
        if (r2 >= BOARD_SIZE || c2 >= BOARD_SIZE) continue;
        swapCells(board, { r, c }, { r: r2, c: c2 });
        const scoring = findScoringLines(board, baseScoreForType, opts).length > 0;
        swapCells(board, { r, c }, { r: r2, c: c2 });
        if (scoring) candidates.push({ a: { r, c }, b: { r: r2, c: c2 } });
      }
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

