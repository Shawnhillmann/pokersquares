import { createRng } from "../utils/rng.js";
import { HAND_BASE_SCORE } from "../poker/evaluationTypes.js";
import { HAND_TYPE } from "../poker/evaluationTypes.js";
import { createDeck } from "./deck.js";
import { BOARD_SIZE, cloneBoard, dealBoard, hasAnyScoringSwapAnywhere, stabilizeBoard } from "./board.js";

/**
 * @typedef {{ id: string, rank: any, suit: any }} Card
 * @typedef {(Card|null)[][]} Board
 */

export function baseScoreForType(type) {
  return HAND_BASE_SCORE[type] ?? 0;
}

/**
 * @typedef {object} GameState
 * @property {Board} board
 * @property {{ draw(): any, recycle(cards:any[]): void, size(): number } | null} deck
 * @property {number} credits
 * @property {number} comboStep 0 when idle; during cascade starts at 1
 * @property {string[]} lastHands
 * @property {{ next():number, int(maxExclusive:number):number }} rng
 * @property {number|null} seed
 * @property {boolean} busy
 * @property {{ r:number, c:number }|null} selected
 * @property {boolean} debug
 */

/**
 * @param {{ seed?: number|null }} opts
 * @returns {GameState}
 */
export function createGameState(opts = {}) {
  const seed = opts.seed ?? null;
  return {
    board: Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null)),
    deck: null,
    credits: 0,
    comboStep: 0,
    lastHands: [],
    rng: createRng(seed),
    seed,
    busy: false,
    selected: null,
    debug: false
  };
}

/**
 * Generate a fresh board that:
 * - does not start with scoring hands
 * - has at least one scoring swap
 * Prototype-friendly brute force: regenerate until constraints met.
 * @param {GameState} s
 */
export function newGame(s) {
  // Starting bankroll (tuned in main.js via move costs + scoring).
  s.credits = 1000;
  s.comboStep = 0;
  s.lastHands = [];
  s.selected = null;
  s.busy = false;
  s.rng = createRng(s.seed);

  regenerateBoardForFairness(s, { maxAttempts: 5000 });
}

/**
 * Regenerate the board until:
 * - no scoring lines exist
 * - at least one swap (any two cards) would create a scoring line
 *
 * Used for initial deal and to prevent "dead" boards after cascades.
 * Keeps credits/combo untouched (caller decides).
 *
 * @param {GameState} s
 * @param {{ maxAttempts?: number }} opts
 * @returns {boolean} whether strict constraints were satisfied
 */
export function regenerateBoardForFairness(s, opts = {}) {
  const scoreOpts = { minType: HAND_TYPE.TWO_PAIR };
  const maxAttempts = opts.maxAttempts ?? 2000;
  for (let i = 0; i < maxAttempts; i++) {
    const deck = createDeck(s.rng);
    const b = dealBoard(deck);
    const settled = stabilizeBoard(b, deck, baseScoreForType, scoreOpts, 80);
    if (!settled.stable) continue;
    if (!hasAnyScoringSwapAnywhere(b, baseScoreForType, scoreOpts)) continue;
    s.board = cloneBoard(b);
    s.deck = deck;
    return true;
  }

  // If we couldn't find a fair board quickly, keep trying longer.
  // (A swapless start feels broken, so we prefer spending extra time here.)
  const extendedAttempts = Math.max(2000, maxAttempts * 5);
  for (let i = 0; i < extendedAttempts; i++) {
    const deck = createDeck(s.rng);
    const b = dealBoard(deck);
    const settled = stabilizeBoard(b, deck, baseScoreForType, scoreOpts, 120);
    if (!settled.stable) continue;
    if (!hasAnyScoringSwapAnywhere(b, baseScoreForType, scoreOpts)) continue;
    s.board = cloneBoard(b);
    s.deck = deck;
    return true;
  }

  // Absolute last resort: still return a stable board, but ensure deck exists.
  // The UI will treat "no moves" as run end.
  {
    const deck = createDeck(s.rng);
    const b = dealBoard(deck);
    stabilizeBoard(b, deck, baseScoreForType, scoreOpts, 200);
    s.board = cloneBoard(b);
    s.deck = deck;
    return false;
  }
}

