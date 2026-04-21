import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHand } from "./evaluateHand.js";
import { HAND_TYPE } from "./evaluationTypes.js";

/** @param {string} rank @param {"H"|"D"|"C"|"S"} suit */
function c(rank, suit) {
  return { rank, suit };
}

test("detects pair", () => {
  const r = evaluateHand([c("A", "H"), c("A", "D"), c("5", "S"), c("9", "C"), c("K", "H")]);
  assert.equal(r.type, HAND_TYPE.PAIR);
});

test("detects two pair", () => {
  const r = evaluateHand([c("A", "H"), c("A", "D"), c("5", "S"), c("5", "C"), c("K", "H")]);
  assert.equal(r.type, HAND_TYPE.TWO_PAIR);
});

test("detects three of a kind", () => {
  const r = evaluateHand([c("7", "H"), c("7", "D"), c("7", "S"), c("9", "C"), c("K", "H")]);
  assert.equal(r.type, HAND_TYPE.THREE_OF_A_KIND);
});

test("detects straight (A low)", () => {
  const r = evaluateHand([c("A", "H"), c("2", "D"), c("3", "S"), c("4", "C"), c("5", "H")]);
  assert.equal(r.type, HAND_TYPE.STRAIGHT);
  assert.deepEqual(r.meta.straightValuesAsc, [1, 2, 3, 4, 5]);
});

test("detects straight (broadway)", () => {
  const r = evaluateHand([c("10", "H"), c("J", "D"), c("Q", "S"), c("K", "C"), c("A", "H")]);
  assert.equal(r.type, HAND_TYPE.STRAIGHT);
  assert.deepEqual(r.meta.straightValuesAsc, [10, 11, 12, 13, 14]);
});

test("duplicates cannot be a straight", () => {
  const r = evaluateHand([c("2", "H"), c("3", "D"), c("4", "S"), c("4", "C"), c("5", "H")]);
  assert.notEqual(r.type, HAND_TYPE.STRAIGHT);
});

test("detects flush", () => {
  const r = evaluateHand([c("2", "H"), c("7", "H"), c("9", "H"), c("J", "H"), c("A", "H")]);
  assert.equal(r.type, HAND_TYPE.FLUSH);
});

test("detects full house", () => {
  const r = evaluateHand([c("K", "H"), c("K", "D"), c("K", "S"), c("9", "C"), c("9", "H")]);
  assert.equal(r.type, HAND_TYPE.FULL_HOUSE);
});

test("detects four of a kind", () => {
  const r = evaluateHand([c("9", "H"), c("9", "D"), c("9", "S"), c("9", "C"), c("A", "H")]);
  assert.equal(r.type, HAND_TYPE.FOUR_OF_A_KIND);
});

test("detects straight flush", () => {
  const r = evaluateHand([c("6", "S"), c("7", "S"), c("8", "S"), c("9", "S"), c("10", "S")]);
  assert.equal(r.type, HAND_TYPE.STRAIGHT_FLUSH);
});

test("detects royal flush", () => {
  const r = evaluateHand([c("10", "S"), c("J", "S"), c("Q", "S"), c("K", "S"), c("A", "S")]);
  assert.equal(r.type, HAND_TYPE.ROYAL_FLUSH);
});

