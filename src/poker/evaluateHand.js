import { HAND_LABEL, HAND_PRIORITY, HAND_TYPE } from "./evaluationTypes.js";

/**
 * @typedef {"H"|"D"|"C"|"S"} Suit
 * @typedef {"A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K"} Rank
 * @typedef {{ rank: Rank, suit: Suit }} Card
 *
 * @typedef {object} HandEval
 * @property {keyof typeof HAND_TYPE} type
 * @property {string} label
 * @property {number} priority Higher is stronger
 * @property {boolean} isScoring Pair+ (high card is non-scoring)
 * @property {object} meta
 * @property {boolean} meta.isFlush
 * @property {boolean} meta.isStraight
 * @property {number[]} meta.sortedValuesDesc Values with A as 14
 * @property {number[]|null} meta.straightValuesAsc If straight, the 5 ascending values (wheel uses [1,2,3,4,5])
 * @property {Record<number, number>} meta.valueCounts Map value->count (A=14)
 */

const RANK_TO_VALUE = /** @type {const} */ ({
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  10: 10,
  9: 9,
  8: 8,
  7: 7,
  6: 6,
  5: 5,
  4: 4,
  3: 3,
  2: 2
});

/**
 * @typedef {{ gutterball?: boolean }} EvaluateHandOpts
 */

/**
 * Evaluate a 5-card poker hand.
 * Detection order matches product requirements.
 * @param {Card[]} cards
 * @param {EvaluateHandOpts} [opts]
 * @returns {HandEval}
 */
export function evaluateHand(cards, opts = {}) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error("evaluateHand expects exactly 5 cards");
  }
  const gutterball = !!opts.gutterball;

  const values = cards.map((c) => {
    const v = RANK_TO_VALUE[c.rank];
    if (!v) throw new Error(`Unknown rank: ${String(c.rank)}`);
    return v;
  });

  /** @type {Record<number, number>} */
  const valueCounts = {};
  for (const v of values) valueCounts[v] = (valueCounts[v] ?? 0) + 1;

  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniqValues = Array.from(new Set(values));
  const sortedUniqAsc = uniqValues.slice().sort((a, b) => a - b);

  /** Five distinct ascending values spanning 6 ranks with exactly one single-rank skip (e.g. 5-6-8-9-10). */
  const isGutterPattern = (asc5) => {
    if (!asc5 || asc5.length !== 5) return false;
    if (asc5[4] - asc5[0] !== 5) return false;
    let gapOfTwo = 0;
    for (let i = 0; i < 4; i++) {
      const d = asc5[i + 1] - asc5[i];
      if (d > 2) return false;
      if (d === 2) gapOfTwo += 1;
    }
    return gapOfTwo === 1;
  };

  /** @type {number[]|null} */
  let straightValuesAsc = null;
  const isStraight = (() => {
    if (uniqValues.length !== 5) return false; // duplicates cannot be straight

    // Normal straight (A high as 14)
    const min = sortedUniqAsc[0];
    const max = sortedUniqAsc[4];
    const isConsecutive = max - min === 4 && sortedUniqAsc.every((v, i) => v === min + i);
    if (isConsecutive) {
      straightValuesAsc = sortedUniqAsc;
      return true;
    }

    // Wheel straight A-2-3-4-5 (treat Ace as 1)
    const wheel = [2, 3, 4, 5, 14];
    const isWheel = sortedUniqAsc.every((v, i) => v === wheel[i]);
    if (isWheel) {
      straightValuesAsc = [1, 2, 3, 4, 5];
      return true;
    }

    // Gutterball: one rank may be missing within a 6-rank window (e.g. 5-7-8-9-10 skips 6).
    if (gutterball && isGutterPattern(sortedUniqAsc)) {
      straightValuesAsc = sortedUniqAsc;
      return true;
    }

    // Gutterball with Ace as 1 (e.g. A-2-4-5-6 skips 3; ace-high sort would miss this).
    if (gutterball && uniqValues.includes(14)) {
      const altAsc = Array.from(new Set(values.map((v) => (v === 14 ? 1 : v)))).sort((a, b) => a - b);
      if (altAsc.length === 5 && isGutterPattern(altAsc)) {
        straightValuesAsc = altAsc;
        return true;
      }
    }

    return false;
  })();

  const sortedValuesDesc = values.slice().sort((a, b) => b - a);

  const countsDesc = Object.entries(valueCounts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const hasNKind = (n) => countsDesc.some((x) => x.count === n);
  const numPairs = countsDesc.filter((x) => x.count === 2).length;

  /** @type {keyof typeof HAND_TYPE} */
  let type = HAND_TYPE.HIGH_CARD;

  // 1. Royal Flush
  if (isFlush && isStraight && straightValuesAsc && straightValuesAsc.join(",") === "10,11,12,13,14") {
    type = HAND_TYPE.ROYAL_FLUSH;
  }
  // 2. Straight Flush
  else if (isFlush && isStraight) {
    type = HAND_TYPE.STRAIGHT_FLUSH;
  }
  // 3. Four of a Kind
  else if (hasNKind(4)) {
    type = HAND_TYPE.FOUR_OF_A_KIND;
  }
  // 4. Full House
  else if (hasNKind(3) && hasNKind(2)) {
    type = HAND_TYPE.FULL_HOUSE;
  }
  // 5. Flush
  else if (isFlush) {
    type = HAND_TYPE.FLUSH;
  }
  // 6. Straight
  else if (isStraight) {
    type = HAND_TYPE.STRAIGHT;
  }
  // 7. Three of a Kind
  else if (hasNKind(3)) {
    type = HAND_TYPE.THREE_OF_A_KIND;
  }
  // 8. Two Pair
  else if (numPairs === 2) {
    type = HAND_TYPE.TWO_PAIR;
  }
  // 9. Pair
  else if (numPairs === 1) {
    type = HAND_TYPE.PAIR;
  }
  // 10. High Card
  else {
    type = HAND_TYPE.HIGH_CARD;
  }

  return {
    type,
    label: HAND_LABEL[type],
    priority: HAND_PRIORITY[type],
    isScoring: type !== HAND_TYPE.HIGH_CARD,
    meta: {
      isFlush,
      isStraight,
      sortedValuesDesc,
      straightValuesAsc,
      valueCounts
    }
  };
}

