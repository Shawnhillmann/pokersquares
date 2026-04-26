import { RANKS, SUITS } from "./cards.js";

/**
 * @typedef {{ id: string, rank: any, suit: any }} Card
 */

/**
 * @param {{ int(maxExclusive:number): number }} rng
 * @param {any[]} arr
 */
function shuffleInPlace(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

/**
 * Create a 52-card cycling deck:
 * - draw from the front
 * - recycle cleared cards to the bottom
 *
 * This guarantees no duplicates on the board at the same time, and cleared cards
 * won't reappear until the remaining cards cycle through.
 *
 * @param {{ int(maxExclusive:number): number }} rng
 */
export function createDeck(rng) {
  /** @type {Card[]} */
  const queue = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      queue.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  shuffleInPlace(rng, queue);

  return {
    /**
     * @returns {Card}
     */
    draw() {
      const c = queue.shift();
      if (!c) throw new Error("Deck underflow");
      return c;
    },
    /**
     * @param {Card[]} cards
     */
    recycle(cards) {
      // Recycle cards back into the draw pool, but keep the pool well-shuffled so
      // cascades don't feel "chunky" (e.g., many of the same rank reappearing in a row).
      for (const c of cards) queue.push(c);
      shuffleInPlace(rng, queue);
    },
    addJoker() {
      // Add exactly one Joker to the cycling deck.
      // Id is unique so it won't collide with standard cards.
      const id = `JOKER-${Math.random().toString(16).slice(2)}`;
      queue.push({ id, rank: "JOKER", suit: "X" });
      shuffleInPlace(rng, queue);
    },
    size() {
      return queue.length;
    }
  };
}

