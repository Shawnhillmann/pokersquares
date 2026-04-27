import { HAND_TYPE } from "../poker/evaluationTypes.js";

/**
 * Base card value used for scoring:
 * - 2..9 = face value
 * - 10/J/Q/K = 10
 * - A = 11
 * @param {string} rank
 */
export function cardBaseValue(rank) {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J" || rank === "10") return 10;
  const n = Number(rank);
  if (Number.isFinite(n) && n >= 2 && n <= 9) return n;
  return 0;
}

// Hand-type multipliers (tuned for prototype feel; easy to tweak).
export const HAND_MULT = /** @type {const} */ ({
  [HAND_TYPE.TWO_PAIR]: 2,
  [HAND_TYPE.THREE_OF_A_KIND]: 3,
  [HAND_TYPE.STRAIGHT]: 10,
  [HAND_TYPE.FLUSH]: 10,
  [HAND_TYPE.FULL_HOUSE]: 20,
  [HAND_TYPE.FOUR_OF_A_KIND]: 40,
  [HAND_TYPE.FIVE_OF_A_KIND]: 80,
  [HAND_TYPE.STRAIGHT_FLUSH]: 50,
  [HAND_TYPE.ROYAL_FLUSH]: 100
});

/**
 * @param {string} handType
 */
export function handMultiplier(handType) {
  return HAND_MULT[handType] ?? 0;
}

