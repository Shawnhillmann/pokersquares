import { HAND_LABEL, HAND_PRIORITY, HAND_TYPE } from "./evaluationTypes.js";

/**
 * @typedef {"H"|"D"|"C"|"S"|"X"} Suit
 * @typedef {"A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K"|"JOKER"} Rank
 * @typedef {{ rank: Rank, suit: Suit }} Card
 */

const SUITS = /** @type {const} */ (["H", "D", "C", "S"]);
const RANKS = /** @type {const} */ (["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]);

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

function straightSeqs() {
  /** @type {number[][]} */
  const seqs = [];
  // A2345 wheel as [1,2,3,4,5] but we match ranks by values (Ace=14) specially.
  seqs.push([14, 5, 4, 3, 2]); // sentinel; handled via set
  for (let hi = 14; hi >= 5; hi--) {
    seqs.push([hi, hi - 1, hi - 2, hi - 3, hi - 4]);
  }
  return seqs;
}

/** 5-rank sets that are "6 consecutive ranks minus one" (Gutterball straight). Ace in ace-low gutters is stored as 14. */
const GUTTER_STRAIGHT_SETS = (() => {
  /** @type {Set<number>[]} */
  const sets = [];
  for (let low = 2; low <= 9; low++) {
    const w = [low, low + 1, low + 2, low + 3, low + 4, low + 5];
    for (let omit = 0; omit < 6; omit++) {
      sets.push(new Set(w.filter((_, i) => i !== omit)));
    }
  }
  // Logical ranks 1–6 with one omitted; Ace as rank 1 is card value 14.
  const aceLowWindow = [1, 2, 3, 4, 5, 6];
  for (let omit = 0; omit < 6; omit++) {
    const vals = aceLowWindow.filter((_, i) => i !== omit).map((v) => (v === 1 ? 14 : v));
    sets.push(new Set(vals));
  }
  return sets;
})();

/**
 * @param {Card[]} cards
 * @param {{ jokerWild:boolean, gutterball?:boolean }} opts
 */
export function evaluateHandWild(cards, opts) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error("evaluateHandWild expects exactly 5 cards");
  }

  const jokerWild = !!opts.jokerWild;
  const gutterball = !!opts.gutterball;

  let wild = 0;
  /** @type {Card[]} */
  const fixed = [];

  for (const c of cards) {
    const r = String(c.rank);
    if (jokerWild && r === "JOKER") wild += 1;
    else fixed.push(/** @type {Card} */ (c));
  }

  /** @type {Record<number, number>} */
  const valueCounts = {};
  /** @type {Record<string, number>} */
  const suitCounts = { H: 0, D: 0, C: 0, S: 0 };
  /** @type {number[]} */
  const fixedVals = [];
  /** @type {string[]} */
  const fixedSuits = [];

  for (const c of fixed) {
    const v = RANK_TO_VALUE[String(c.rank)];
    if (!v) return fallbackHigh();
    fixedVals.push(v);
    fixedSuits.push(String(c.suit));
    valueCounts[v] = (valueCounts[v] ?? 0) + 1;
    if (suitCounts[String(c.suit)] != null) suitCounts[String(c.suit)] += 1;
  }

  const hasDupFixed = new Set(fixedVals).size !== fixedVals.length;

  const best = (() => {
    // 0) Five of a Kind (wildcards enabled)
    // Any rank that can reach 5 using wilds.
    for (const r of RANKS) {
      const v = RANK_TO_VALUE[r];
      const have = valueCounts[v] ?? 0;
      if (have + wild >= 5) return HAND_TYPE.FIVE_OF_A_KIND;
    }

    // 1) Royal Flush
    for (const s of SUITS) {
      if (fixedSuits.some((x) => x !== s)) continue;
      const need = new Set([10, 11, 12, 13, 14]);
      for (const v of fixedVals) need.delete(v);
      if (need.size <= wild) return HAND_TYPE.ROYAL_FLUSH;
    }

    // 2) Straight Flush
    for (const s of SUITS) {
      if (fixedSuits.some((x) => x !== s)) continue;
      if (hasDupFixed) continue;
      for (const seq of straightSeqs()) {
        const set = new Set(seq[0] === 14 && seq[1] === 5 ? [14, 2, 3, 4, 5] : seq);
        if (fixedVals.some((v) => !set.has(v))) continue;
        const missing = 5 - fixedVals.length;
        if (missing <= wild) return HAND_TYPE.STRAIGHT_FLUSH;
      }
      if (gutterball) {
        for (const set of GUTTER_STRAIGHT_SETS) {
          if (fixedVals.some((v) => !set.has(v))) continue;
          const need = [...set].filter((v) => !fixedVals.includes(v)).length;
          if (need <= wild) return HAND_TYPE.STRAIGHT_FLUSH;
        }
      }
    }

    // 3) Quads
    for (const r of RANKS) {
      const v = RANK_TO_VALUE[r];
      const have = valueCounts[v] ?? 0;
      if (have + wild >= 4) return HAND_TYPE.FOUR_OF_A_KIND;
    }

    // 4) Full House
    for (const r3 of RANKS) {
      const v3 = RANK_TO_VALUE[r3];
      const have3 = valueCounts[v3] ?? 0;
      const need3 = Math.max(0, 3 - have3);
      if (need3 > wild) continue;
      const w2 = wild - need3;
      for (const r2 of RANKS) {
        const v2 = RANK_TO_VALUE[r2];
        if (v2 === v3) continue;
        const have2 = valueCounts[v2] ?? 0;
        const need2 = Math.max(0, 2 - have2);
        if (need2 <= w2) return HAND_TYPE.FULL_HOUSE;
      }
    }

    // 5) Flush
    for (const s of SUITS) {
      if (fixedSuits.some((x) => x !== s)) continue;
      if (fixedVals.length + wild >= 5) return HAND_TYPE.FLUSH;
    }

    // 6) Straight
    if (!hasDupFixed) {
      for (const seq of straightSeqs()) {
        const set = new Set(seq[0] === 14 && seq[1] === 5 ? [14, 2, 3, 4, 5] : seq);
        if (fixedVals.some((v) => !set.has(v))) continue;
        const missing = 5 - fixedVals.length;
        if (missing <= wild) return HAND_TYPE.STRAIGHT;
      }
      if (gutterball) {
        for (const set of GUTTER_STRAIGHT_SETS) {
          if (fixedVals.some((v) => !set.has(v))) continue;
          const need = [...set].filter((v) => !fixedVals.includes(v)).length;
          if (need <= wild) return HAND_TYPE.STRAIGHT;
        }
      }
    }

    // 7) Trips
    for (const r of RANKS) {
      const v = RANK_TO_VALUE[r];
      const have = valueCounts[v] ?? 0;
      if (have + wild >= 3) return HAND_TYPE.THREE_OF_A_KIND;
    }

    // 8) Two Pair
    for (let i = 0; i < RANKS.length; i++) {
      for (let j = i + 1; j < RANKS.length; j++) {
        const v1 = RANK_TO_VALUE[RANKS[i]];
        const v2 = RANK_TO_VALUE[RANKS[j]];
        const need1 = Math.max(0, 2 - (valueCounts[v1] ?? 0));
        const need2 = Math.max(0, 2 - (valueCounts[v2] ?? 0));
        if (need1 + need2 <= wild) return HAND_TYPE.TWO_PAIR;
      }
    }

    // 9) Pair
    for (const r of RANKS) {
      const v = RANK_TO_VALUE[r];
      const have = valueCounts[v] ?? 0;
      if (have + wild >= 2) return HAND_TYPE.PAIR;
    }

    return HAND_TYPE.HIGH_CARD;
  })();

  return {
    type: best,
    label: HAND_LABEL[best] ?? String(best),
    priority: HAND_PRIORITY[best] ?? 0,
    isScoring: best !== HAND_TYPE.HIGH_CARD,
    meta: {
      isFlush:
        best === HAND_TYPE.FLUSH || best === HAND_TYPE.STRAIGHT_FLUSH || best === HAND_TYPE.ROYAL_FLUSH,
      isStraight:
        best === HAND_TYPE.STRAIGHT || best === HAND_TYPE.STRAIGHT_FLUSH || best === HAND_TYPE.ROYAL_FLUSH,
      sortedValuesDesc: fixedVals.slice().sort((a, b) => b - a),
      straightValuesAsc: null,
      valueCounts
    }
  };

  function fallbackHigh() {
    return {
      type: HAND_TYPE.HIGH_CARD,
      label: HAND_LABEL[HAND_TYPE.HIGH_CARD],
      priority: HAND_PRIORITY[HAND_TYPE.HIGH_CARD],
      isScoring: false,
      meta: {
        isFlush: false,
        isStraight: false,
        sortedValuesDesc: [],
        straightValuesAsc: null,
        valueCounts: {}
      }
    };
  }
}

