/** @typedef {"H"|"D"|"C"|"S"} Suit */
/** @typedef {"A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K"} Rank */
/** @typedef {{ id: string, rank: Rank, suit: Suit }} Card */

export const SUITS = /** @type {const} */ (["H", "D", "C", "S"]);
export const RANKS = /** @type {const} */ (["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);

const SUIT_TO_SYMBOL = /** @type {const} */ ({
  H: "♥",
  D: "♦",
  C: "♣",
  S: "♠"
});

export function suitSymbol(suit) {
  return SUIT_TO_SYMBOL[suit] ?? "?";
}

export function isRedSuit(suit) {
  return suit === "H" || suit === "D";
}

