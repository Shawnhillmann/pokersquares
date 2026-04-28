import { createGameState, newGame, baseScoreForType, regenerateBoardForFairness } from "./game/gameState.js";
import {
  applyGravity,
  cellsToClear,
  findScoringLines,
  refill,
  swapCells
} from "./game/board.js";
import { renderBoard, renderScoredLines, showToast } from "./render/renderBoard.js";
import { el, sleep } from "./render/dom.js";
import { HAND_LABEL, HAND_PRIORITY, HAND_TYPE } from "./poker/evaluationTypes.js";
import { evaluateHand } from "./poker/evaluateHand.js";
import { evaluateHandWild } from "./poker/evaluateHandWild.js";
import { cardBaseValue, handMultiplier } from "./game/scoring.js";
import { sfx } from "./audio/sfx.js";
import { music } from "./audio/music.js";

const ui = {
  board: /** @type {HTMLElement} */ (document.getElementById("board")),
  lineLayer: /** @type {HTMLElement} */ (document.getElementById("lineLayer")),
  toast: /** @type {HTMLElement} */ (document.getElementById("toast")),
  newGameBtn: /** @type {HTMLButtonElement} */ (document.getElementById("newGameBtn")),
  hintBtn: /** @type {HTMLButtonElement} */ (document.getElementById("hintBtn")),
  helpBtn: /** @type {HTMLButtonElement} */ (document.getElementById("helpBtn")),
  settingsBtn: /** @type {HTMLButtonElement|null} */ (document.getElementById("settingsBtn")),
  handChart: /** @type {HTMLElement} */ (document.getElementById("handChart")),
  rulesPanel: /** @type {HTMLElement} */ (document.getElementById("rulesPanel")),
  runEndModal: /** @type {HTMLElement} */ (document.getElementById("runEndModal")),
  runEndTitle: /** @type {HTMLElement|null} */ (document.getElementById("runEndTitle")),
  runEndReason: /** @type {HTMLElement|null} */ (document.getElementById("runEndReason")),
  finalScoreValue: /** @type {HTMLElement} */ (document.getElementById("finalScoreValue")),
  finalPeakCreditsValue: /** @type {HTMLElement|null} */ (document.getElementById("finalPeakCreditsValue")),
  finalPeakGoalValue: /** @type {HTMLElement|null} */ (document.getElementById("finalPeakGoalValue")),
  finalMovesValue: /** @type {HTMLElement} */ (document.getElementById("finalMovesValue")),
  restartBtn: /** @type {HTMLButtonElement} */ (document.getElementById("restartBtn")),
  goalBar: /** @type {HTMLElement|null} */ (document.getElementById("goalBar")),
  goalCurrent: /** @type {HTMLElement|null} */ (document.getElementById("goalCurrent")),
  goalTarget: /** @type {HTMLElement|null} */ (document.getElementById("goalTarget")),
  goalFill: /** @type {HTMLElement|null} */ (document.getElementById("goalFill")),
  goalReward: /** @type {HTMLElement|null} */ (document.getElementById("goalReward")),
  goalLabelTitle: /** @type {HTMLElement|null} */ (document.getElementById("goalLabelTitle")),
  lastSwapLine: /** @type {HTMLElement|null} */ (document.getElementById("lastSwapLine")),
  swapCostLine: /** @type {HTMLElement|null} */ (document.getElementById("swapCostLine")),
  howToSwapCost: /** @type {HTMLElement|null} */ (document.getElementById("howToSwapCost")),
  howToHintCost: /** @type {HTMLElement|null} */ (document.getElementById("howToHintCost")),
  rewardsTrackerBody: /** @type {HTMLElement|null} */ (document.getElementById("rewardsTrackerBody")),
  howToPlayPanel: /** @type {HTMLElement} */ (document.getElementById("howToPlayPanel")),
  creditDock: /** @type {HTMLElement|null} */ (document.getElementById("creditDock")),
  settingsModal: /** @type {HTMLElement|null} */ (document.getElementById("settingsModal")),
  settingsCloseBtn: /** @type {HTMLButtonElement|null} */ (document.getElementById("settingsCloseBtn")),
  settingsSfx: /** @type {HTMLInputElement|null} */ (document.getElementById("settingsSfx")),
  settingsMusic: /** @type {HTMLInputElement|null} */ (document.getElementById("settingsMusic")),
  settingsSfxVol: /** @type {HTMLInputElement|null} */ (document.getElementById("settingsSfxVol")),
  settingsSfxVolValue: /** @type {HTMLElement|null} */ (document.getElementById("settingsSfxVolValue")),
  settingsMusicVol: /** @type {HTMLInputElement|null} */ (document.getElementById("settingsMusicVol")),
  settingsMusicVolValue: /** @type {HTMLElement|null} */ (document.getElementById("settingsMusicVolValue")),
  settingsTheme: /** @type {HTMLSelectElement|null} */ (document.getElementById("settingsTheme")),
  settingsCrt: /** @type {HTMLInputElement|null} */ (document.getElementById("settingsCrt")),
  settingsCrtStrength: /** @type {HTMLInputElement|null} */ (document.getElementById("settingsCrtStrength")),
  settingsCrtStrengthValue: /** @type {HTMLElement|null} */ (document.getElementById("settingsCrtStrengthValue")),
  settingsCrtStrengthRow: /** @type {HTMLElement|null} */ (document.getElementById("settingsCrtStrengthRow")),
  settingsFullscreen: /** @type {HTMLInputElement|null} */ (document.getElementById("settingsFullscreen")),
  settingsNextTrackBtn: /** @type {HTMLButtonElement|null} */ (document.getElementById("settingsNextTrackBtn")),
  settingsTrackLabel: /** @type {HTMLElement|null} */ (document.getElementById("settingsTrackLabel"))
  ,orientationBlock: /** @type {HTMLElement|null} */ (document.getElementById("orientationBlock"))
};

const RUN_STORAGE_KEY = "speed_poker_run_v1";

const state = createGameState({ seed: null });
newGame(state);
state.credits = 500;

let successfulMoves = 0;

const SCORE_OPTS = { minType: HAND_TYPE.TWO_PAIR };

const GOAL_TARGETS = /** @type {const} */ ([
  1000, 2000, 4000, 8000, 12500, 20000, 30000, 50000, 75000, 100000
]);

function goalTargetForIndex(idx) {
  const i = Math.max(1, Math.floor(idx));
  if (i <= GOAL_TARGETS.length) return GOAL_TARGETS[i - 1];
  const base10 = GOAL_TARGETS[GOAL_TARGETS.length - 1]; // Goal 10
  // Goal 11–20: +100% each goal (x2 compounding). Goal 11 = 200,000.
  if (i <= 20) {
    const steps = i - 10;
    return Math.max(1, Math.round(base10 * Math.pow(2, steps)));
  }
  // Goal 21+: +200% each goal (x3 compounding).
  const base20 = Math.max(1, Math.round(base10 * Math.pow(2, 10))); // Goal 20
  const steps = i - 20;
  return Math.max(1, Math.round(base20 * Math.pow(3, steps)));
}

const STARTING_POINTS = 500;

const rewards = {
  randomHints: false, // selected: Random Hints
  /** Times Combo Bonus picked; each adds +50% to cascade combo line scores. */
  comboBonusStacks: 0,
  /** Times Hand Multiplier picked; each adds +25% to all hand scores. */
  handMultiplierStacks: 0,
  /** Times Swap Coupon picked; each reduces swap cost by 15%. */
  swapCouponStacks: 0,
  /** Times Premium Hands picked; each adds +50% to premium hand types. */
  premiumHandsStacks: 0,
  /** Times Low Hands picked; each adds +50% to low-range hand types. */
  lowRangeStacks: 0,
  /** Times Bolder Faces picked; each triples face card value again. */
  boldFacesStacks: 0,
  /** Times Bigger Numbers picked; each triples number card (and ace) value again. */
  biggerNumbersStacks: 0,
  /** Times Pocket Rockets picked; each makes Aces worth 10x card value (stackable multiplier). */
  pocketRocketsStacks: 0,
  /** Times Lucky River picked; each adds +5% proc chance to x10 a scored hand. */
  luckyRiverStacks: 0,
  /** One-time: flushes/straights can be made with 4 cards (incl. straight/royal flush). */
  closeEnough: false,
  jokerWildcard: false, // Goal 3
  diagonalsScored: false, // Goal 4
  extraJoker: false, // Goal 5
  /** Times Double Card Values was picked; each pick doubles pip values again. */
  doubleCardValueStacks: 0,
  /** One-time: two pair lines do not clear (straight+ still does). */
  noClearTwoPair: false,
  /** One-time: three of a kind lines do not clear (straight+ still does). */
  noClearTrips: false,
  /** One-time: kickers count toward the line score (normally off for 2-pair/trips/quads). */
  kickersCount: false,
  /** One-time: each hand type multiplier gains +1 per time that hand was scored this run. */
  ladderUp: false
};

let randomHintChance = 0;
/** Times Random Hints reward was chosen (for run summary). */
let randomHintsPickCount = 0;
let lastPickedRewardName = "____";
let jokerCount = 0;
/** Per-run count of how many times each hand type scored. */
let handTypePlayCounts = /** @type {Record<string, number>} */ (Object.create(null));

function getHandTypePlayCount(type) {
  const v = handTypePlayCounts?.[String(type)];
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function incHandTypePlayCount(type) {
  const t = String(type);
  handTypePlayCounts[t] = getHandTypePlayCount(t) + 1;
}

function effectiveHandMultiplier(type) {
  const base = handMultiplier(type);
  if (!rewards.ladderUp) return base;
  return base + getHandTypePlayCount(type);
}

function clearSavedRun() {
  try {
    localStorage.removeItem(RUN_STORAGE_KEY);
  } catch {
    // ignored
  }
}

function snapshotRun() {
  const deckSnap = /** @type {any} */ (state.deck)?.snapshot?.() ?? null;
  return {
    v: 1,
    t: Date.now(),
    credits: Math.max(0, Math.floor(state.credits || 0)),
    board: state.board,
    deck: deckSnap,
    goalIndex,
    goalTarget,
    successfulMoves,
    peakCreditsThisRun,
    peakGoalClearedThisRun,
    pendingRewardPicks: 0,
    clearedGoalsForRewardPick: [],
    randomHintChance,
    randomHintsPickCount,
    lastPickedRewardName,
    jokerCount,
    handTypePlayCounts,
    rewards: { ...rewards }
  };
}

let runSaveTimer = /** @type {number|null} */ (null);
function scheduleSaveRun() {
  if (runSaveTimer != null) return;
  runSaveTimer = window.setTimeout(() => {
    runSaveTimer = null;
    try {
      localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(snapshotRun()));
    } catch {
      // ignored
    }
  }, 60);
}

function tryRestoreRun() {
  try {
    const raw = localStorage.getItem(RUN_STORAGE_KEY);
    if (!raw) return false;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return false;
    if (!Array.isArray(v.board) || v.board.length !== 5) return false;

    // Restore core run state.
    state.board = v.board;
    state.credits = Math.max(0, Math.floor(v.credits || 0));
    successfulMoves = Math.max(0, Math.floor(v.successfulMoves || 0));
    peakCreditsThisRun = Math.max(0, Math.floor(v.peakCreditsThisRun || state.credits));
    peakGoalClearedThisRun = Math.max(0, Math.floor(v.peakGoalClearedThisRun || 0));
    goalIndex = Math.max(1, Math.floor(v.goalIndex || 1));
    goalTarget = Math.max(1, Math.floor(v.goalTarget || goalTargetForIndex(goalIndex)));

    randomHintChance = Math.max(0, Math.min(0.9, Number(v.randomHintChance) || 0));
    randomHintsPickCount = Math.max(0, Math.floor(v.randomHintsPickCount || 0));
    lastPickedRewardName = String(v.lastPickedRewardName || "____");
    jokerCount = Math.max(0, Math.floor(v.jokerCount || 0));
    if (v.handTypePlayCounts && typeof v.handTypePlayCounts === "object") {
      /** @type {Record<string, number>} */
      const next = Object.create(null);
      for (const [k, n] of Object.entries(v.handTypePlayCounts)) {
        const num = Number(n);
        if (Number.isFinite(num) && num >= 0) next[String(k)] = Math.floor(num);
      }
      handTypePlayCounts = next;
    } else {
      handTypePlayCounts = Object.create(null);
    }

    if (v.rewards && typeof v.rewards === "object") {
      for (const k of Object.keys(rewards)) {
        // @ts-ignore
        if (typeof v.rewards[k] === typeof rewards[k]) {
          // @ts-ignore
          rewards[k] = v.rewards[k];
        }
      }
    }

    // Restore the remaining draw pool so cascades continue naturally.
    if (Array.isArray(v.deck) && state.deck && /** @type {any} */ (state.deck).restore) {
      /** @type {any} */ (state.deck).restore(v.deck);
    }

    // Ensure we resume in a stable, interactive state.
    state.busy = false;
    state.comboStep = 0;
    state.selected = null;
    return true;
  } catch {
    return false;
  }
}

function hintCost() {
  // Always 20% of the current goal target.
  return Math.max(1, Math.round(goalTarget * 0.2));
}

function swapCost() {
  // Always 7.5% of the current goal target.
  const base = Math.max(1, Math.round(goalTarget * 0.075));
  const stacks = Math.max(0, Math.floor(rewards.swapCouponStacks || 0));
  // Apply coupons after the per-goal cost is computed.
  const mult = stacks <= 0 ? 1 : Math.pow(0.9, stacks);
  return Math.max(1, Math.round(base * mult));
}

function fmtShort(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 1000) return v.toLocaleString();
  const UNITS = [
    { v: 1e12, s: "t" },
    { v: 1e9, s: "b" },
    { v: 1e6, s: "m" },
    { v: 1e3, s: "k" }
  ];
  for (const u of UNITS) {
    if (v >= u.v) {
      const x = v / u.v;
      const oneDec = Math.round(x * 10) / 10;
      const s = oneDec % 1 === 0 ? String(Math.round(oneDec)) : oneDec.toFixed(1);
      return `${s}${u.s}`;
    }
  }
  return v.toLocaleString();
}

function fmtBonusXFromPct(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p) || p === 0) return "0x";
  const x = Math.round((p / 100) * 100) / 100; // 2 decimals max
  const s = Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(x);
  return `${s}x`;
}

function cardScoreValue(card) {
  if (!card) return 0;
  const isJoker = String(card.rank) === "JOKER";
  const isAce = String(card.rank) === "A";
  const isFace = String(card.rank) === "J" || String(card.rank) === "Q" || String(card.rank) === "K";
  const isNumberLike = !isJoker && !isFace; // includes A
  const aceStacks = Math.max(0, Math.floor(rewards.pocketRocketsStacks || 0));
  const aceMult = aceStacks <= 0 ? 1 : Math.pow(10, aceStacks);
  const faceStacks = Math.max(0, Math.floor(rewards.boldFacesStacks || 0));
  const faceMult = faceStacks <= 0 ? 1 : Math.pow(3, faceStacks);
  const numStacks = Math.max(0, Math.floor(rewards.biggerNumbersStacks || 0));
  const numMult = numStacks <= 0 ? 1 : Math.pow(3, numStacks);
  const baseUnmult = rewards.jokerWildcard && isJoker ? 10 : cardBaseValue(String(card.rank));
  let base = baseUnmult;
  if (isAce) base *= aceMult;
  if (isFace || isJoker) base *= faceMult;
  if (isNumberLike) base *= numMult;
  const stacks = Math.max(0, Math.floor(rewards.doubleCardValueStacks || 0));
  const mult = stacks <= 0 ? 1 : Math.pow(2, stacks);
  return base * mult;
}

function scoringOpts() {
  const useWildEval = rewards.jokerWildcard || rewards.extraJoker;
  const baseEval = useWildEval
    ? (cards) => evaluateHandWild(cards, { jokerWild: true })
    : evaluateHand;
  return {
    ...SCORE_OPTS,
    includeDiagonals: rewards.diagonalsScored,
    evaluateHand: (cards) => {
      const base = baseEval(cards);
      if (!rewards.closeEnough) return base;
      const upgraded = upgradeEvalForCloseEnough(base, cards, useWildEval);
      return upgraded;
    }
  };
}

/**
 * Upgrade hand eval when Close Enough is active (4-card straights/flushes).
 * Only affects Straight / Flush / Straight Flush / Royal Flush.
 * @param {any} baseEval
 * @param {{rank:any,suit:any}[]} cards
 * @param {boolean} jokerWild
 */
function upgradeEvalForCloseEnough(baseEval, cards, jokerWild) {
  const baseType = String(baseEval?.type || "");
  // If we're already at/above straight, Close Enough can't improve except for SF/Royal via 4-card logic,
  // but those will also be >= straight anyway. We'll still compute the best and compare priority.

  const SUITS = ["H", "D", "C", "S"];
  const RANK_TO_VALUE = {
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
  };

  /** @type {{ idx:number, v:number, s:string }[]} */
  const fixed = [];
  /** @type {number[]} */
  const wildIdxs = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = String(c.rank);
    if (jokerWild && r === "JOKER") wildIdxs.push(i);
    else {
      const v = RANK_TO_VALUE[r];
      if (!v) continue;
      fixed.push({ idx: i, v, s: String(c.suit) });
    }
  }

  const best = (() => {
    // Royal Flush (4 of 5 ranks) in one suit.
    for (const s of SUITS) {
      const royal = pickRoyal4IdxsInSuit(s);
      if (royal) return { type: HAND_TYPE.ROYAL_FLUSH, idxs: royal };
    }

    // Straight Flush (4-card straight) in one suit.
    for (const s of SUITS) {
      const sf = pickStraight4IdxsInSuit(s);
      if (sf) return { type: HAND_TYPE.STRAIGHT_FLUSH, idxs: sf };
    }

    // Flush (4 cards same suit).
    for (const s of SUITS) {
      const fl = pickFlush4IdxsInSuit(s);
      if (fl) return { type: HAND_TYPE.FLUSH, idxs: fl };
    }

    // Straight (4-card straight).
    const st = pickStraight4IdxsAllSuits();
    if (st) return { type: HAND_TYPE.STRAIGHT, idxs: st };

    return null;
  })();

  if (!best) return baseEval;
  const bestP = HAND_PRIORITY[best.type] ?? 0;
  const baseP = HAND_PRIORITY[baseType] ?? (baseEval?.priority ?? 0);
  if (bestP <= baseP) return baseEval;

  return {
    ...baseEval,
    type: best.type,
    label: HAND_LABEL[best.type] ?? String(best.type),
    priority: bestP,
    isScoring: best.type !== HAND_TYPE.HIGH_CARD,
    meta: {
      ...(baseEval?.meta || {}),
      isFlush:
        best.type === HAND_TYPE.FLUSH ||
        best.type === HAND_TYPE.STRAIGHT_FLUSH ||
        best.type === HAND_TYPE.ROYAL_FLUSH,
      isStraight:
        best.type === HAND_TYPE.STRAIGHT ||
        best.type === HAND_TYPE.STRAIGHT_FLUSH ||
        best.type === HAND_TYPE.ROYAL_FLUSH,
      // Close Enough: which 4 cards are the actual hand (5th is a kicker unless Good Kickers).
      closeEnoughIdxs: Array.isArray(best.idxs) ? best.idxs.slice(0, 4) : null
    }
  };

  /**
   * @param {Set<number>} vals
   * @param {number} wilds
   */
  function straight4Possible(vals, wilds) {
    // 4-card sequences: hi..hi-3, plus A234 special.
    /** @type {number[][]} */
    const seqs = [];
    seqs.push([14, 2, 3, 4]); // A234
    for (let hi = 14; hi >= 5; hi--) {
      seqs.push([hi, hi - 1, hi - 2, hi - 3]);
    }
    for (const seq of seqs) {
      let have = 0;
      for (const v of seq) if (vals.has(v)) have += 1;
      if (have + wilds >= 4) return true;
    }
    return false;
  }

  function pickFlush4IdxsInSuit(s) {
    const inSuit = fixed.filter((c) => c.s === s).map((c) => c.idx);
    if (inSuit.length + wildIdxs.length < 4) return null;
    const idxs = [];
    for (const i of inSuit) {
      idxs.push(i);
      if (idxs.length >= 4) break;
    }
    for (const i of wildIdxs) {
      if (idxs.length >= 4) break;
      idxs.push(i);
    }
    return idxs.length === 4 ? idxs : null;
  }

  function pickRoyal4IdxsInSuit(s) {
    const royalSet = new Set([10, 11, 12, 13, 14]);
    const byV = new Map();
    for (const c of fixed) {
      if (c.s !== s) continue;
      if (!royalSet.has(c.v)) continue;
      const arr = byV.get(c.v);
      if (arr) arr.push(c.idx);
      else byV.set(c.v, [c.idx]);
    }
    let have = 0;
    for (const v of royalSet) if (byV.has(v)) have += 1;
    if (have + wildIdxs.length < 4) return null;
    const idxs = [];
    for (const v of [10, 11, 12, 13, 14]) {
      const arr = byV.get(v);
      if (arr && arr.length) idxs.push(arr[0]);
      if (idxs.length >= 4) break;
    }
    for (const wi of wildIdxs) {
      if (idxs.length >= 4) break;
      idxs.push(wi);
    }
    return idxs.length === 4 ? idxs : null;
  }

  function pickStraight4IdxsFromFixed(valsSet, fixedCandidates) {
    // 4-card sequences: hi..hi-3, plus A234 special.
    /** @type {number[][]} */
    const seqs = [];
    seqs.push([14, 2, 3, 4]); // A234
    for (let hi = 14; hi >= 5; hi--) seqs.push([hi, hi - 1, hi - 2, hi - 3]);

    const byV = new Map();
    for (const c of fixedCandidates) {
      const arr = byV.get(c.v);
      if (arr) arr.push(c.idx);
      else byV.set(c.v, [c.idx]);
    }

    for (const seq of seqs) {
      let have = 0;
      for (const v of seq) if (valsSet.has(v)) have += 1;
      if (have + wildIdxs.length < 4) continue;
      const idxs = [];
      for (const v of seq) {
        const arr = byV.get(v);
        if (arr && arr.length) idxs.push(arr[0]);
        if (idxs.length >= 4) break;
      }
      for (const wi of wildIdxs) {
        if (idxs.length >= 4) break;
        idxs.push(wi);
      }
      if (idxs.length === 4) return idxs;
    }
    return null;
  }

  function pickStraight4IdxsInSuit(s) {
    const fixedCandidates = fixed.filter((c) => c.s === s);
    const valsSet = new Set(fixedCandidates.map((c) => c.v));
    if (!straight4Possible(valsSet, wildIdxs.length)) return null;
    return pickStraight4IdxsFromFixed(valsSet, fixedCandidates);
  }

  function pickStraight4IdxsAllSuits() {
    const valsSet = new Set(fixed.map((c) => c.v));
    if (!straight4Possible(valsSet, wildIdxs.length)) return null;
    return pickStraight4IdxsFromFixed(valsSet, fixed);
  }
}

function handScoreMultForReward(handType) {
  const t = String(handType);
  const premium =
    t === HAND_TYPE.FOUR_OF_A_KIND ||
    t === HAND_TYPE.STRAIGHT_FLUSH ||
    t === HAND_TYPE.FIVE_OF_A_KIND ||
    t === HAND_TYPE.ROYAL_FLUSH;
  const lowHands =
    t === HAND_TYPE.FULL_HOUSE ||
    t === HAND_TYPE.FLUSH ||
    t === HAND_TYPE.STRAIGHT ||
    t === HAND_TYPE.THREE_OF_A_KIND ||
    t === HAND_TYPE.TWO_PAIR;
  const premStacks = Math.max(0, Math.floor(rewards.premiumHandsStacks || 0));
  const lowStacks = Math.max(0, Math.floor(rewards.lowRangeStacks || 0));
  const premMult = premium && premStacks > 0 ? Math.pow(3, premStacks) : 1;
  const lowMult = lowHands && lowStacks > 0 ? Math.pow(6, lowStacks) : 1;
  return premMult * lowMult;
}

/** Options for `findScoringLines` / board regeneration (includes hand types that never clear). */
function boardLineOpts() {
  /** @type {Set<string>} */
  const suppressClearTypes = new Set();
  if (rewards.noClearTwoPair) suppressClearTypes.add(HAND_TYPE.TWO_PAIR);
  if (rewards.noClearTrips) suppressClearTypes.add(HAND_TYPE.THREE_OF_A_KIND);
  return { ...scoringOpts(), suppressClearTypes };
}

function comboSpeed(comboStep) {
  const step = Math.max(1, Math.floor(comboStep || 1));
  const speed = 1 + (step - 1) * 0.03;
  return Math.min(2.2, speed); // cap so it doesn't get silly late-game
}

function comboDelayMs(baseMs, comboStep) {
  return Math.max(0, Math.round(baseMs / comboSpeed(comboStep)));
}

function clampNonNegative(n) {
  return Math.max(0, Math.floor(n));
}

/** @typedef {"bankrupt"|"win"} RunEndKind */

const RUN_END_COPY = /** @type {const} */ ({
  bankrupt: "Not enough credits to swap.",
  win: "You made it to Goal 31. Unreal run."
});

/**
 * @param {RunEndKind} kind
 */
function endRun(kind) {
  state.busy = true;
  state.selected = null;
  if (ui.runEndTitle) ui.runEndTitle.textContent = kind === "win" ? "You win" : "Run ended";
  if (ui.finalPeakCreditsValue) ui.finalPeakCreditsValue.textContent = peakCreditsThisRun.toLocaleString();
  if (ui.finalPeakGoalValue) {
    ui.finalPeakGoalValue.textContent = peakGoalClearedThisRun <= 0 ? "None" : `Goal ${peakGoalClearedThisRun}`;
  }
  ui.finalScoreValue.textContent = state.credits.toLocaleString();
  ui.finalMovesValue.textContent = successfulMoves.toLocaleString();
  const line = RUN_END_COPY[kind];
  if (ui.runEndReason) ui.runEndReason.textContent = line;
  ui.runEndModal.removeAttribute("hidden");
  showToast(ui.toast, line);
  if (kind === "win") sfx.youWin();
  else sfx.gameOver();
}

/**
 * Spend credits for attempting a swap.
 * We apply the cost immediately, but only end the run when the move produces no credits
 * (or after cascades resolve), so the player isn't "killed" mid-resolution.
 */
function canAffordSwap() {
  return state.credits >= swapCost();
}

function spendSwapCost() {
  if (!canAffordSwap()) return false;
  state.credits = clampNonNegative(state.credits - swapCost());
  rerender();
  // Swap costs should feel instant (rewards can animate).
  setCreditsInstant(state.credits);
  return true;
}

function checkCantAffordSwapAndEnd() {
  if (canAffordSwap()) return false;
  endRun("bankrupt");
  return true;
}

// Removed: "no moves / no two-pair possible" game-over.

/** @type {{ clearing:Set<string>|null, scoredLines: any[]|null, scoring:Set<string>|null, dim:Set<string>|null, dropRowsById: Map<string,number>|null, dropMsById: Map<string,number>|null, hint:Set<string>|null, dropMode: "gravity"|"refill"|null }} */
const viewFx = {
  clearing: null,
  scoredLines: null,
  scoring: null,
  dim: null,
  dropRowsById: null,
  dropMsById: null,
  hint: null,
  dropMode: null
};

// Poker hand chart is always visible now (no hide control).

/** Best credits reached this run (authoritative bankroll, not mid-animation display). */
let peakCreditsThisRun = 0;
/** Highest numbered goal cleared this run (1–5); 0 if none yet. */
let peakGoalClearedThisRun = 0;
/** Combined credits gained from the most recent swap (incl. combo/cascades). */
let lastSwapTotal = 0;
function setLastSwapTotal(v) {
  lastSwapTotal = Math.max(0, Math.floor(Number(v) || 0));
  if (!ui.lastSwapLine) return;
  ui.lastSwapLine.textContent = `Last Swap Total: ${lastSwapTotal > 0 ? fmtShort(lastSwapTotal) : "-"}`;
}

function updateHud() {
  const credits = Math.max(0, Math.floor(state.credits));
  peakCreditsThisRun = Math.max(peakCreditsThisRun, credits);
  updateGoalHud(credits);
  ui.hintBtn.textContent = `Hint - ${fmtShort(hintCost())} Credits`;
  const sc = fmtShort(swapCost());
  if (ui.swapCostLine) ui.swapCostLine.textContent = `Swap cost: ${sc} credits`;
  if (ui.howToSwapCost) ui.howToSwapCost.textContent = sc;
  if (ui.howToHintCost) ui.howToHintCost.textContent = fmtShort(hintCost());
  updateRewardsTracker();
  scheduleSaveRun();
}

function updateRewardsTracker() {
  const b = ui.rewardsTrackerBody;
  if (!b) return;
  b.replaceChildren();
  /** @type {Record<string, string>} */
  const descByLabel = {
    "Pocket Rockets": "Aces are worth 10x more card value per stack.",
    Jokers: "Adds Joker cards to your deck (max 2). Jokers count as any rank for hand evaluation.",
    Diagonals: "Diagonals can be scored as poker hands.",
    "Close Enough":
      "Flushes and straights can be made with only 4 cards (includes straight flushes and royal flush).",
    "Combo Chain": "Each consecutive scored hand in a combo receives a 0.25x bonus per stack.",
    "Hand Multiplier": "Each stack adds +0.25x to all hand multipliers.",
    "Premium Hands": "Each stack makes Four of a Kind+ hands worth 3x.",
    "Low Hands": "Each stack makes Full House and lower hands worth 6x.",
    "Bolder Faces": "Each stack makes face cards (J/Q/K) and Jokers worth 3x more card value.",
    "Bigger Numbers": "Each stack makes number cards (and Aces) worth 3x more card value.",
    "2X Card Values": "Each stack doubles every card’s value again.",
    "Lucky River": "Each stack adds +5% chance for scored hands to pay 10x.",
    "Random Hints": "Grants a chance for free hints to appear.",
    "Swap Coupons": "Each stack reduces swap cost by 10% (applied after goal scaling).",
    "Trips Disabled": "Three of a kind lines no longer clear.",
    "Two Pair Disabled": "Two pair lines no longer clear.",
    "Good Kickers": "Kicker cards add to scores for hands like trips and two pair.",
    "Ladder Up": "One-time. Each time you score a hand type, its multiplier increases by +1x for the rest of the run."
  };

  const showTooltip = (label, ev) => {
    const desc = descByLabel[label];
    if (!desc) return;
    hideTooltip();
    const t = document.createElement("div");
    t.className = "trackerTooltip";
    t.innerHTML = `<div class="trackerTooltip__title">${label}</div><div class="trackerTooltip__desc">${desc}</div>`;
    document.body.append(t);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 10;

    const rect = ev?.currentTarget?.getBoundingClientRect?.();
    const x0 = rect ? rect.left + rect.width / 2 : vw / 2;
    const y0 = rect ? rect.top : vh / 2;

    // Position above the row, clamped to viewport.
    const br = t.getBoundingClientRect();
    const x = Math.max(pad + br.width / 2, Math.min(vw - pad - br.width / 2, x0));
    const y = Math.max(pad + br.height, Math.min(vh - pad, y0));
    t.style.left = `${Math.round(x)}px`;
    t.style.top = `${Math.round(y)}px`;

    // @ts-ignore
    window.__rewardsTooltipEl = t;
  };

  const hideTooltip = () => {
    // @ts-ignore
    const t = window.__rewardsTooltipEl;
    if (t && t.remove) t.remove();
    // @ts-ignore
    window.__rewardsTooltipEl = null;
  };

  const hoverCapable =
    window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const isTooltipOpenFor = (label) => {
    // @ts-ignore
    const t = window.__rewardsTooltipEl;
    // @ts-ignore
    return !!t && t.__trackerLabel === label;
  };

  const showTooltipForRow = (label, ev) => {
    showTooltip(label, ev);
    // Tag so we can toggle per-row on mobile.
    // @ts-ignore
    const t = window.__rewardsTooltipEl;
    if (t) {
      // @ts-ignore
      t.__trackerLabel = label;
    }
  };

  const addRow = (label, value) => {
    const row = document.createElement("div");
    row.className = "trackerRow";
    const k = document.createElement("span");
    k.className = "trackerRow__k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "trackerRow__v";
    v.textContent = value;
    row.append(k, v);
    if (descByLabel[label]) {
      row.classList.add("is-clickable");
      if (hoverCapable) {
        row.addEventListener("pointerenter", (ev) => showTooltipForRow(label, ev));
        row.addEventListener("pointerleave", () => hideTooltip());
      } else {
        row.addEventListener("pointerdown", (ev) => {
          // Touch-friendly: tap toggles; don't instantly hide on pointerleave.
          ev.preventDefault();
          ev.stopPropagation();
          if (isTooltipOpenFor(label)) hideTooltip();
          else showTooltipForRow(label, ev);
        });
      }
    }
    b.append(row);
  };

  // Touch: tap outside to dismiss.
  // @ts-ignore
  if (!window.__rewardsTooltipDismissWired) {
    // @ts-ignore
    window.__rewardsTooltipDismissWired = true;
    document.addEventListener(
      "pointerdown",
      (ev) => {
        // @ts-ignore
        const t = window.__rewardsTooltipEl;
        if (!t) return;
        const target = /** @type {any} */ (ev.target);
        if (target && (target.closest?.(".trackerRow") || target.closest?.(".trackerTooltip"))) return;
        hideTooltip();
      },
      { capture: true }
    );
    window.addEventListener("scroll", hideTooltip, { passive: true });
    window.addEventListener("resize", hideTooltip, { passive: true });
  }
  // Order matches requested "build" readability.
  if (rewards.pocketRocketsStacks > 0) {
    addRow("Pocket Rockets", `Aces ${fmtShort(Math.pow(10, rewards.pocketRocketsStacks))}x · ${rewards.pocketRocketsStacks}×`);
  } else addRow("Pocket Rockets", "Off");

  if (rewards.jokerWildcard || jokerCount > 0) addRow("Jokers", `${jokerCount} / 2 in deck`);
  else addRow("Jokers", "Off");

  addRow("Diagonals", rewards.diagonalsScored ? "On" : "Off");

  addRow("Close Enough", rewards.closeEnough ? "On" : "Off");

  if (rewards.comboBonusStacks > 0) {
    const per = 25 * rewards.comboBonusStacks;
    addRow("Combo Chain", `+${fmtBonusXFromPct(per)} per chain step · ${rewards.comboBonusStacks}×`);
  } else addRow("Combo Chain", "Off");

  if (rewards.handMultiplierStacks > 0) {
    const pct = 25 * rewards.handMultiplierStacks;
    addRow("Hand Multiplier", `+${fmtBonusXFromPct(pct)} all hands · ${rewards.handMultiplierStacks}×`);
  } else addRow("Hand Multiplier", "Off");

  if (rewards.premiumHandsStacks > 0) {
    addRow("Premium Hands", `${fmtShort(Math.pow(3, rewards.premiumHandsStacks))}x · ${rewards.premiumHandsStacks}×`);
  } else addRow("Premium Hands", "Off");

  if (rewards.lowRangeStacks > 0) {
    addRow("Low Hands", `${fmtShort(Math.pow(6, rewards.lowRangeStacks))}x · ${rewards.lowRangeStacks}×`);
  } else addRow("Low Hands", "Off");

  if (rewards.boldFacesStacks > 0) {
    addRow("Bolder Faces", `x${Math.pow(3, rewards.boldFacesStacks)} · ${rewards.boldFacesStacks}×`);
  } else addRow("Bolder Faces", "Off");

  if (rewards.biggerNumbersStacks > 0) {
    addRow("Bigger Numbers", `x${Math.pow(3, rewards.biggerNumbersStacks)} · ${rewards.biggerNumbersStacks}×`);
  } else addRow("Bigger Numbers", "Off");

  if (rewards.doubleCardValueStacks > 0) {
    addRow("2X Card Values", `x${Math.pow(2, rewards.doubleCardValueStacks)} · ${rewards.doubleCardValueStacks}× picked`);
  } else addRow("2X Card Values", "Off");

  if (rewards.luckyRiverStacks > 0) {
    addRow("Lucky River", `10x @ ${5 * rewards.luckyRiverStacks}% · ${rewards.luckyRiverStacks}×`);
  } else addRow("Lucky River", "Off");

  if (rewards.randomHints) {
    addRow("Random Hints", `${Math.round(randomHintChance * 100)}% roll · ${randomHintsPickCount} picked`);
  } else addRow("Random Hints", "Off");

  if (rewards.swapCouponStacks > 0) {
    addRow("Swap Coupons", `-${10 * rewards.swapCouponStacks}% · ${rewards.swapCouponStacks}×`);
  } else addRow("Swap Coupons", "Off");

  addRow("Trips Disabled", rewards.noClearTrips ? "On" : "Off");
  addRow("Two Pair Disabled", rewards.noClearTwoPair ? "On" : "Off");

  addRow("Good Kickers", rewards.kickersCount ? "On" : "Off");
  addRow("Ladder Up", rewards.ladderUp ? "On" : "Off");
}

let creditsDisplayValue = Math.max(0, Math.floor(state.credits));
let creditsAnimRaf = /** @type {number|null} */ (null);
let creditsAnimTo = creditsDisplayValue;
let lastGoalTextCredits = -1;
let goalSequenceActive = false;

function setCreditsInstant(n) {
  const v = Math.max(0, Math.floor(n));
  if (creditsAnimRaf != null) cancelAnimationFrame(creditsAnimRaf);
  creditsAnimRaf = null;
  creditsAnimTo = v;
  creditsDisplayValue = v;
}

/**
 * Animate TOTAL CREDITS value to the next target.
 * @param {number} to
 */
function animateCreditsTo(to) {
  if (creditsAnimRaf != null) cancelAnimationFrame(creditsAnimRaf);
  const from = creditsDisplayValue;
  creditsAnimTo = to;
  const start = performance.now();
  const duration = 360;

  const tick = (t) => {
    // If something else updated the target mid-flight, keep animating toward the latest.
    const currentTo = creditsAnimTo;
    const p = Math.min(1, (t - start) / duration);
    const e = 1 - Math.pow(1 - p, 2.2);
    const v = Math.floor(from + (currentTo - from) * e);
    creditsDisplayValue = v;
    updateGoalText(v);
    if (p < 1) creditsAnimRaf = requestAnimationFrame(tick);
    else {
      creditsAnimRaf = null;
      creditsDisplayValue = currentTo;
      updateGoalText(currentTo);
    }
  };

  creditsAnimRaf = requestAnimationFrame(tick);
}

/**
 * @param {number} to
 * @param {number} duration
 */
function animateCreditsToAsync(to, duration = 360) {
  return new Promise((resolve) => {
    if (creditsAnimRaf != null) cancelAnimationFrame(creditsAnimRaf);
    const from = creditsDisplayValue;
    creditsAnimTo = to;
    const start = performance.now();

    const tick = (t) => {
      const currentTo = creditsAnimTo;
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 2.2);
      const v = Math.floor(from + (currentTo - from) * e);
      creditsDisplayValue = v;
      updateGoalText(v);
      if (p < 1) creditsAnimRaf = requestAnimationFrame(tick);
      else {
        creditsAnimRaf = null;
        creditsDisplayValue = currentTo;
        updateGoalText(currentTo);
        resolve();
      }
    };

    creditsAnimRaf = requestAnimationFrame(tick);
  });
}

let goalIndex = 1;
let goalTarget = goalTargetForIndex(1);
let pendingRewardPicks = 0;
/** FIFO of goal numbers that granted a reward pick (for messaging). */
const clearedGoalsForRewardPick = [];

function updateGoalTitleLabel() {
  if (!ui.goalLabelTitle) return;
  ui.goalLabelTitle.textContent = `Goal ${goalIndex}`;
}

function updateGoalHud(credits) {
  // Animate rewards upward, but snap costs downward.
  if (!goalSequenceActive) {
    if (credits >= creditsDisplayValue) animateCreditsTo(credits);
    else setCreditsInstant(credits);
  } else {
    // While we're sequencing multi-goal hits, the sequence controls credit animation.
    setCreditsInstant(creditsDisplayValue);
  }

  if (ui.goalTarget) {
    ui.goalTarget.textContent = goalTarget.toLocaleString();
  }
  updateGoalText(creditsDisplayValue);
  updateRewardLabel();
  updateGoalTitleLabel();
  if (ui.goalFill) {
    const p = Math.max(0, Math.min(1, creditsDisplayValue / goalTarget));
    ui.goalFill.style.width = `${Math.round(p * 1000) / 10}%`;
  }
  if (ui.goalBar) {
    const track = ui.goalBar.querySelector(".goalBlock__track");
    if (track) {
      track.setAttribute("aria-valuemax", String(goalTarget));
      track.setAttribute("aria-valuenow", String(Math.max(0, Math.min(goalTarget, creditsDisplayValue))));
    }
  }
}

function updateGoalText(n) {
  const v = Math.max(0, Math.floor(n));
  if (v === lastGoalTextCredits) return;
  lastGoalTextCredits = v;
  if (ui.goalCurrent) ui.goalCurrent.textContent = v.toLocaleString();
}

function bumpGoalCelebration(isWin = false) {
  if (!ui.goalBar) return;
  const block = ui.goalBar.querySelector(".goalBlock");
  if (!block) return;
  block.classList.remove("is-goal-passed", "is-goal-win");
  // eslint-disable-next-line no-unused-expressions
  block.offsetHeight;
  block.classList.add(isWin ? "is-goal-win" : "is-goal-passed");
  setTimeout(() => block.classList.remove("is-goal-passed", "is-goal-win"), isWin ? 900 : 520);
}

function rewardNameForGoal(g) {
  switch (g) {
    case 1:
      return "Random Hints";
    case 2:
      return "Combo Bonus";
    case 3:
      return "Joker Card";
    case 4:
      return "Diagonals";
    case 5:
      return "Joker Card";
    default:
      return "Endless";
  }
}

function updateRewardLabel() {
  if (!ui.goalReward) return;
  ui.goalReward.textContent = "Choose 1 of 3";
}

function unlockRewardForGoal(g) {
  // Deprecated: rewards are chosen via the roguelike picker now.
}

function rerender() {
  renderBoard(
    ui.board,
    state.board,
    {
      selected: state.selected,
      clearing: viewFx.clearing,
      scoring: viewFx.scoring,
      dim: viewFx.dim,
      hint: viewFx.hint,
      dropRowsById: viewFx.dropRowsById ?? undefined,
      dropMsById: viewFx.dropMsById ?? undefined,
      dropMode: viewFx.dropMode ?? undefined
    },
    (pos) => onCellClick(pos)
  );
  renderScoredLines(
    ui.lineLayer,
    viewFx.scoredLines
      ? viewFx.scoredLines.map((l) => ({ kind: l.kind, index: l.index, label: l.label }))
      : null
  );
  // Pause any purely-visual idle animations during gameplay activity.
  const busy = !!(
    state.busy ||
    pendingRewardPicks > 0 ||
    viewFx.scoring ||
    viewFx.clearing ||
    (viewFx.dropRowsById && viewFx.dropRowsById.size) ||
    (viewFx.scoredLines && viewFx.scoredLines.length)
  );
  ui.board.classList.toggle("is-busy", busy);
  if (busy) markActivity();
  updateHud();
  positionScoreFeed();
}

function positionScoreFeed() {
  /* Credits + how-to live in document flow; nothing to position. */
}

const MOBILE_MQ = window.matchMedia("(max-width: 720px)");

function syncMobileViewportClass() {
  document.documentElement.classList.toggle("is-mobile", MOBILE_MQ.matches);
  positionScoreFeed();
}

// Idle breathing: only enable after 10s of no player/game activity; disable immediately on any activity.
let idleBreathTimer = /** @type {number|null} */ (null);
let lastActivityAt = Date.now();
const IDLE_BREATH_MS = 10_000;

function markActivity() {
  lastActivityAt = Date.now();
  ui.board.classList.remove("is-idle");
  if (idleBreathTimer != null) clearTimeout(idleBreathTimer);
  idleBreathTimer = window.setTimeout(() => {
    idleBreathTimer = null;
    const now = Date.now();
    const enoughIdle = now - lastActivityAt >= IDLE_BREATH_MS;
    const busy = ui.board.classList.contains("is-busy");
    if (enoughIdle && !busy && document.visibilityState === "visible") {
      ui.board.classList.add("is-idle");
    } else {
      markActivity();
    }
  }, IDLE_BREATH_MS + 20);
}

document.addEventListener("pointerdown", markActivity, { passive: true });
document.addEventListener("keydown", markActivity);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") ui.board.classList.remove("is-idle");
  markActivity();
});

function formatHandChartMult(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  const rounded = Math.round(v * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

function syncHandChartScores() {
  if (!ui.handChart) return;
  const stacks = Math.max(0, Math.floor(rewards.handMultiplierStacks || 0));
  const mult = 1 + 0.25 * stacks;
  ui.handChart.querySelectorAll(".handRow__tag--score").forEach((el) => {
    // @ts-ignore
    if (!el.dataset.base) {
      const txt = String(el.textContent || "").trim();
      // Accept both legacy "x100" and preferred "100x" formats.
      const m = txt.match(/(?:^x\s*([0-9]+(?:\.[0-9]+)?)$)|(?:^([0-9]+(?:\.[0-9]+)?)\s*x$)/i);
      // @ts-ignore
      el.dataset.base = m ? String(m[1] || m[2] || "1") : "1";
    }
    // @ts-ignore
    const base = Number(el.dataset.base || "1") || 1;
    let baseShown = base;
    if (rewards.ladderUp) {
      const row = /** @type {HTMLElement|null} */ (el.closest(".handRow"));
      const nameEl = row?.querySelector(".handRow__name");
      const nm = String(nameEl?.textContent || "").trim();
      /** @type {string|null} */
      let t = null;
      if (nm === "Two Pair") t = HAND_TYPE.TWO_PAIR;
      else if (nm === "Three of a Kind") t = HAND_TYPE.THREE_OF_A_KIND;
      else if (nm === "Straight") t = HAND_TYPE.STRAIGHT;
      else if (nm === "Flush") t = HAND_TYPE.FLUSH;
      else if (nm === "Full House") t = HAND_TYPE.FULL_HOUSE;
      else if (nm === "Four of a Kind") t = HAND_TYPE.FOUR_OF_A_KIND;
      else if (nm === "Straight Flush") t = HAND_TYPE.STRAIGHT_FLUSH;
      else if (nm === "Five of a Kind") t = HAND_TYPE.FIVE_OF_A_KIND;
      else if (nm === "Royal Flush") t = HAND_TYPE.ROYAL_FLUSH;
      if (t) baseShown = base + getHandTypePlayCount(t);
    }
    const shown = formatHandChartMult(baseShown * mult);
    el.textContent = `${shown}x`;
  });
}

const SETTINGS_STORAGE_KEY = "speed_poker_settings_v1";
const settings = {
  sfx: true,
  music: false,
  sfxVol: 1,
  musicVol: 0.22,
  musicTrack: 1,
  theme: "purple",
  crt: true,
  crtStrength: 0.72,
  fullscreen: false
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (v && typeof v === "object") {
      if (typeof v.sfx === "boolean") settings.sfx = v.sfx;
      if (typeof v.music === "boolean") settings.music = v.music;
      if (typeof v.sfxVol === "number") settings.sfxVol = Math.max(0, Math.min(1, v.sfxVol));
      if (typeof v.musicVol === "number") settings.musicVol = Math.max(0, Math.min(1, v.musicVol));
      if (typeof v.musicTrack === "number") settings.musicTrack = Math.max(1, Math.floor(v.musicTrack));
      if (typeof v.theme === "string") settings.theme = v.theme;
      if (typeof v.crt === "boolean") settings.crt = v.crt;
      if (typeof v.crtStrength === "number") settings.crtStrength = Math.max(0, Math.min(1, v.crtStrength));
      if (typeof v.fullscreen === "boolean") settings.fullscreen = v.fullscreen;
    }
  } catch {
    // ignored
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignored
  }
}

function syncSettingsUi() {
  if (ui.settingsSfx) ui.settingsSfx.checked = !!settings.sfx;
  if (ui.settingsMusic) ui.settingsMusic.checked = !!settings.music;
  if (ui.settingsSfxVol) ui.settingsSfxVol.value = String(Math.round(settings.sfxVol * 100));
  if (ui.settingsMusicVol) ui.settingsMusicVol.value = String(Math.round(settings.musicVol * 100));
  if (ui.settingsSfxVolValue) ui.settingsSfxVolValue.textContent = `${Math.round(settings.sfxVol * 100)}%`;
  if (ui.settingsMusicVolValue) ui.settingsMusicVolValue.textContent = `${Math.round(settings.musicVol * 100)}%`;
  if (ui.settingsTheme) ui.settingsTheme.value = settings.theme || "green";
  if (ui.settingsCrt) ui.settingsCrt.checked = !!settings.crt;
  if (ui.settingsCrtStrength) ui.settingsCrtStrength.value = String(Math.round((settings.crtStrength ?? 0.72) * 100));
  if (ui.settingsCrtStrengthValue) ui.settingsCrtStrengthValue.textContent = `${Math.round((settings.crtStrength ?? 0.72) * 100)}%`;
  if (ui.settingsCrtStrengthRow) ui.settingsCrtStrengthRow.style.display = settings.crt ? "" : "none";
  if (ui.settingsFullscreen) ui.settingsFullscreen.checked = document.fullscreenElement != null;
  if (ui.settingsTrackLabel) ui.settingsTrackLabel.textContent = `Track ${settings.musicTrack}`;
}

function applySettings() {
  sfx.setEnabled(!!settings.sfx);
  sfx.setVolume(settings.sfxVol);
  music.setEnabled(!!settings.music);
  music.setVolume(settings.musicVol);
  music.setTrackIndex(settings.musicTrack);
  document.documentElement.dataset.theme = settings.theme || "purple";
  document.documentElement.dataset.crt = settings.crt ? "1" : "0";
  document.documentElement.style.setProperty("--crt-strength", String(settings.crtStrength ?? 0.72));
}

function openSettings() {
  if (!ui.settingsModal) return;
  syncSettingsUi();
  ui.settingsModal.removeAttribute("hidden");
}

function closeSettings() {
  if (!ui.settingsModal) return;
  ui.settingsModal.setAttribute("hidden", "");
}

ui.settingsBtn?.addEventListener("click", () => {
  // User gesture: allow audio to start if toggles are enabled.
  sfx.unlock();
  music.unlock();
  openSettings();
});

ui.settingsCloseBtn?.addEventListener("click", () => closeSettings());
ui.settingsModal?.addEventListener("click", (ev) => {
  // Click outside the card closes.
  if (ev.target && (ev.target.classList?.contains("modal") || ev.target.classList?.contains("modal__backdrop"))) {
    closeSettings();
  }
});

const pct01 = (x) => Math.max(0, Math.min(1, Number(x) / 100));

function onSettingsSfxVolChange() {
  if (!ui.settingsSfxVol) return;
  settings.sfxVol = pct01(ui.settingsSfxVol.value);
  if (ui.settingsSfxVolValue) ui.settingsSfxVolValue.textContent = `${Math.round(settings.sfxVol * 100)}%`;
  sfx.setVolume(settings.sfxVol);
  saveSettings();
}

ui.settingsSfxVol?.addEventListener("input", onSettingsSfxVolChange);
ui.settingsSfxVol?.addEventListener("change", onSettingsSfxVolChange);

function onSettingsMusicVolChange() {
  if (!ui.settingsMusicVol) return;
  settings.musicVol = pct01(ui.settingsMusicVol.value);
  if (ui.settingsMusicVolValue) ui.settingsMusicVolValue.textContent = `${Math.round(settings.musicVol * 100)}%`;
  music.setVolume(settings.musicVol);
  // User gesture path: wire Web Audio (iOS) and try to start music if enabled.
  void music.unlock();
  saveSettings();
}

ui.settingsMusicVol?.addEventListener("input", onSettingsMusicVolChange);
ui.settingsMusicVol?.addEventListener("change", onSettingsMusicVolChange);

ui.settingsTheme?.addEventListener("change", () => {
  if (!ui.settingsTheme) return;
  settings.theme = String(ui.settingsTheme.value || "green");
  applySettings();
  saveSettings();
});

ui.settingsCrt?.addEventListener("change", () => {
  if (!ui.settingsCrt) return;
  settings.crt = !!ui.settingsCrt.checked;
  if (ui.settingsCrtStrengthRow) ui.settingsCrtStrengthRow.style.display = settings.crt ? "" : "none";
  applySettings();
  saveSettings();
});

function onSettingsCrtStrengthChange() {
  if (!ui.settingsCrtStrength) return;
  settings.crtStrength = pct01(ui.settingsCrtStrength.value);
  if (ui.settingsCrtStrengthValue) ui.settingsCrtStrengthValue.textContent = `${Math.round(settings.crtStrength * 100)}%`;
  applySettings();
  saveSettings();
}

ui.settingsCrtStrength?.addEventListener("input", onSettingsCrtStrengthChange);
ui.settingsCrtStrength?.addEventListener("change", onSettingsCrtStrengthChange);

ui.settingsFullscreen?.addEventListener("change", async () => {
  if (!ui.settingsFullscreen) return;
  const want = !!ui.settingsFullscreen.checked;
  settings.fullscreen = want;
  saveSettings();
  try {
    if (want) {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } else {
      if (document.fullscreenElement) await document.exitFullscreen();
    }
  } catch {
    // ignored (browser may deny)
  } finally {
    if (ui.settingsFullscreen) ui.settingsFullscreen.checked = document.fullscreenElement != null;
  }
});

document.addEventListener("fullscreenchange", () => {
  if (ui.settingsFullscreen) ui.settingsFullscreen.checked = document.fullscreenElement != null;
});

ui.settingsNextTrackBtn?.addEventListener("click", async () => {
  // User gesture path: allow audio to start if enabled.
  music.unlock();
  const next = await music.nextTrack();
  settings.musicTrack = next;
  if (ui.settingsTrackLabel) ui.settingsTrackLabel.textContent = `Track ${settings.musicTrack}`;
  saveSettings();
});

for (const [el, key] of [
  [ui.settingsSfx, "sfx"],
  [ui.settingsMusic, "music"]
]) {
  if (!el) continue;
  el.addEventListener("change", () => {
    // @ts-ignore
    settings[key] = !!el.checked;
    saveSettings();
    applySettings();
    // User gesture: resume Web Audio / playback after enabled state is current.
    sfx.unlock();
    void music.unlock();
  });
}

/**
 * Pick a random screen position that avoids the board rect.
 * Returns coords for a fixed element with translate(-50%, -50%).
 * @param {DOMRect} boardRect
 * @returns {{ x:number, y:number }}
 */
function randomPopupPosition(boardRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 16; // minimum distance from board
  const ring = 160; // how far popups may drift away from board
  const safe = 36; // keep away from screen edges

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => a + Math.random() * (b - a);

  // Prefer left/right; occasionally top/bottom.
  const sides = ["left", "right", "left", "right", "top", "bottom"];
  const side = sides[Math.floor(Math.random() * sides.length)];

  const byMin = clamp(boardRect.top + 30, safe, vh - safe - 120);
  const byMax = clamp(boardRect.bottom - 30, byMin + 20, vh - safe - 80);
  const bxMin = clamp(boardRect.left + 80, safe + 80, vw - safe - 80);
  const bxMax = clamp(boardRect.right - 80, bxMin + 20, vw - safe - 80);

  if (side === "left") {
    const x = clamp(rand(boardRect.left - pad, boardRect.left - pad - ring), safe + 80, vw - safe - 80);
    const y = rand(byMin, byMax);
    return { x, y };
  }
  if (side === "right") {
    const x = clamp(rand(boardRect.right + pad, boardRect.right + pad + ring), safe + 80, vw - safe - 80);
    const y = rand(byMin, byMax);
    return { x, y };
  }
  if (side === "top") {
    const x = rand(bxMin, bxMax);
    const y = clamp(rand(boardRect.top - pad, boardRect.top - pad - ring), safe + 70, vh - safe - 70);
    return { x, y };
  }
  // bottom
  const x = rand(bxMin, bxMax);
  const y = clamp(rand(boardRect.bottom + pad, boardRect.bottom + pad + ring), safe + 70, vh - safe - 70);
  return { x, y };
}

ui.newGameBtn.addEventListener("click", () => {
  if (state.busy) return;
  clearSavedRun();
  successfulMoves = 0;
  ui.runEndModal.setAttribute("hidden", "");
  setLastSwapTotal(0);
  goalSequenceActive = false;
  newGame(state);
  goalIndex = 1;
  goalTarget = goalTargetForIndex(1);
  rewards.randomHints = false;
  randomHintChance = 0;
  randomHintsPickCount = 0;
  lastPickedRewardName = "____";
  jokerCount = 0;
  rewards.comboBonusStacks = 0;
  rewards.handMultiplierStacks = 0;
  rewards.swapCouponStacks = 0;
  rewards.premiumHandsStacks = 0;
  rewards.lowRangeStacks = 0;
  rewards.boldFacesStacks = 0;
  rewards.biggerNumbersStacks = 0;
  rewards.pocketRocketsStacks = 0;
  rewards.luckyRiverStacks = 0;
  rewards.closeEnough = false;
  rewards.jokerWildcard = false;
  rewards.diagonalsScored = false;
  rewards.extraJoker = false;
  rewards.doubleCardValueStacks = 0;
  rewards.noClearTwoPair = false;
  rewards.noClearTrips = false;
  rewards.kickersCount = false;
  rewards.ladderUp = false;
  handTypePlayCounts = Object.create(null);
  pendingRewardPicks = 0;
  peakGoalClearedThisRun = 0;
  // Keep main/gameState.js in sync for the starting bankroll.
  state.credits = STARTING_POINTS;
  peakCreditsThisRun = STARTING_POINTS;
  // Hard reset progress/credit animation state so the goal bar can't carry over.
  setCreditsInstant(state.credits);
  lastGoalTextCredits = -1;
  ui.goalBar?.querySelector(".goalBlock")?.classList.remove("is-goal-passed", "is-goal-win");
  showToast(ui.toast, "New deal");
  rerender();
  syncHandChartScores();
  if (settings.music) {
    void music.randomTrack?.().then((idx) => {
      if (typeof idx === "number") settings.musicTrack = idx;
      if (ui.settingsTrackLabel) ui.settingsTrackLabel.textContent = `Track ${settings.musicTrack}`;
      saveSettings();
    });
  }
  showCenterTip(
    "Swap cards to make either horizontal or vertical poker hands<br />and&nbsp;earn rewards."
  );
  checkCantAffordSwapAndEnd();
  scheduleSaveRun();
});

ui.restartBtn.addEventListener("click", () => {
  successfulMoves = 0;
  ui.runEndModal.setAttribute("hidden", "");
  clearSavedRun();
  setLastSwapTotal(0);
  goalSequenceActive = false;
  newGame(state);
  goalIndex = 1;
  goalTarget = goalTargetForIndex(1);
  rewards.randomHints = false;
  randomHintChance = 0;
  randomHintsPickCount = 0;
  lastPickedRewardName = "____";
  jokerCount = 0;
  rewards.comboBonusStacks = 0;
  rewards.handMultiplierStacks = 0;
  rewards.swapCouponStacks = 0;
  rewards.premiumHandsStacks = 0;
  rewards.lowRangeStacks = 0;
  rewards.boldFacesStacks = 0;
  rewards.biggerNumbersStacks = 0;
  rewards.pocketRocketsStacks = 0;
  rewards.luckyRiverStacks = 0;
  rewards.closeEnough = false;
  rewards.jokerWildcard = false;
  rewards.diagonalsScored = false;
  rewards.extraJoker = false;
  rewards.doubleCardValueStacks = 0;
  rewards.noClearTwoPair = false;
  rewards.noClearTrips = false;
  rewards.kickersCount = false;
  rewards.ladderUp = false;
  handTypePlayCounts = Object.create(null);
  pendingRewardPicks = 0;
  peakGoalClearedThisRun = 0;
  state.credits = STARTING_POINTS;
  peakCreditsThisRun = STARTING_POINTS;
  // Hard reset progress/credit animation state so the goal bar can't carry over.
  setCreditsInstant(state.credits);
  lastGoalTextCredits = -1;
  ui.goalBar?.querySelector(".goalBlock")?.classList.remove("is-goal-passed", "is-goal-win");
  rerender();
  syncHandChartScores();
  if (settings.music) {
    void music.randomTrack?.().then((idx) => {
      if (typeof idx === "number") settings.musicTrack = idx;
      if (ui.settingsTrackLabel) ui.settingsTrackLabel.textContent = `Track ${settings.musicTrack}`;
      saveSettings();
    });
  }
  showCenterTip(
    "Swap cards to make either horizontal or vertical poker hands<br />and&nbsp;earn rewards."
  );
  checkCantAffordSwapAndEnd();
  scheduleSaveRun();
});

ui.hintBtn.addEventListener("click", async () => {
  if (state.busy) return;
  if (orientationBlocked) return;
  dismissCenterTip();
  dismissRewardBursts();

  // Hints cost credits (discourage spam).
  state.credits = clampNonNegative(state.credits - hintCost());
  rerender();
  sfx.hintPurchase();
  if (checkCantAffordSwapAndEnd()) return;

  viewFx.hint = null;
  rerender();
  await sleep(0);

  const move = findBestScoringSwap(state.board);
  if (!move) {
    showToast(ui.toast, "No scoring hint found");
    return;
  }
  showHintHighlightForMove(move);
});

ui.helpBtn.addEventListener("click", () => {
  const isHidden = ui.rulesPanel.hasAttribute("hidden");
  if (isHidden) ui.rulesPanel.removeAttribute("hidden");
  else ui.rulesPanel.setAttribute("hidden", "");
});

// Mobile browsers (especially iOS) may suspend audio when backgrounded.
// Try to re-unlock/resume audio when the tab becomes active again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sfx.unlock();
});
window.addEventListener("focus", () => sfx.unlock());
window.addEventListener("pageshow", () => sfx.unlock());

// Apply persisted settings at startup.
loadSettings();
applySettings();
syncHandChartScores();

// Warm the browser cache for face-card SVGs (helps on slow mobile connections).
/** @type {HTMLImageElement[]} */
const faceArtPreloads = [];
function preloadFaceArtSvgs() {
  const ranks = ["J", "Q", "K"];
  const suits = ["S", "H", "D", "C"];
  for (const r of ranks) {
    for (const s of suits) {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = `/images/faces/${r}${s}.svg`;
      faceArtPreloads.push(img);
    }
  }
  const joker = new Image();
  joker.decoding = "async";
  joker.loading = "eager";
  joker.src = `/images/faces/Joker.svg`;
  faceArtPreloads.push(joker);
}
preloadFaceArtSvgs();

// Restore saved run state (board/credits/goals/rewards) after deck exists.
const restoredRun = tryRestoreRun();

function isMobileLayout() {
  return document.documentElement.classList.contains("is-mobile");
}

let orientationBlocked = false;
function syncOrientationBlock() {
  if (!ui.orientationBlock) return;
  if (!isMobileLayout()) {
    orientationBlocked = false;
    ui.orientationBlock.setAttribute("hidden", "");
    return;
  }
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  orientationBlocked = landscape;
  if (landscape) ui.orientationBlock.removeAttribute("hidden");
  else ui.orientationBlock.setAttribute("hidden", "");
}

/**
 * Animate a successful swap before committing state.
 * Uses measured layout distances — `getComputedStyle(--cell)` is often `min(...)` which
 * `parseFloat` cannot read, which previously fell back to 96px and made mobile swaps fly past.
 * @param {{r:number,c:number}} a
 * @param {{r:number,c:number}} b
 */
function animateSwapSuccess(a, b) {
  const aEl = ui.board.querySelector(`.cell[data-r="${a.r}"][data-c="${a.c}"]`);
  const bEl = ui.board.querySelector(`.cell[data-r="${b.r}"][data-c="${b.c}"]`);
  if (!aEl || !bEl) return;

  // Defensive: ensure no "fail" classes ever leak into Speed Poker.
  aEl.classList.remove("is-invalid", "is-swap-try", "is-fail-pulse");
  bEl.classList.remove("is-invalid", "is-swap-try", "is-fail-pulse");

  const ar = aEl.getBoundingClientRect();
  const br = bEl.getBoundingClientRect();
  const tx = br.left - ar.left;
  const ty = br.top - ar.top;

  const dist = Math.abs(b.c - a.c) + Math.abs(b.r - a.r);
  const msCap = isMobileLayout() ? 400 : 460;
  const msBase = 130;
  const ms = Math.max(msBase, Math.min(msCap, msBase + dist * (isMobileLayout() ? 26 : 34)));

  aEl.style.setProperty("--swap-tx", `${tx}px`);
  aEl.style.setProperty("--swap-ty", `${ty}px`);
  bEl.style.setProperty("--swap-tx", `${-tx}px`);
  bEl.style.setProperty("--swap-ty", `${-ty}px`);
  aEl.style.setProperty("--swap-ms", `${ms}ms`);
  bEl.style.setProperty("--swap-ms", `${ms}ms`);

  aEl.classList.remove("is-swap-success");
  bEl.classList.remove("is-swap-success");
  // eslint-disable-next-line no-unused-expressions
  aEl.offsetHeight;
  // eslint-disable-next-line no-unused-expressions
  bEl.offsetHeight;
  aEl.classList.add("is-swap-success");
  bEl.classList.add("is-swap-success");
  return ms;
}

/**
 * Commit the swap immediately, then animate the cells from their old positions to their new ones (FLIP).
 * This prevents the post-animation "snap" that happens when we re-render after a keyframed swap.
 * @param {{r:number,c:number}} a
 * @param {{r:number,c:number}} b
 */
async function swapWithFlipAnimation(a, b) {
  const aEl = ui.board.querySelector(`.cell[data-r="${a.r}"][data-c="${a.c}"]`);
  const bEl = ui.board.querySelector(`.cell[data-r="${b.r}"][data-c="${b.c}"]`);

  // If we can't find elements (rare), just commit the swap.
  if (!aEl || !bEl) {
    swapCells(state.board, a, b);
    rerender();
    return;
  }

  // Measure starting positions.
  const aFrom = aEl.getBoundingClientRect();
  const bFrom = bEl.getBoundingClientRect();

  // Wind-up: a short "pull toward each other" before the swap (Bejeweled-ish).
  {
    const dx = bFrom.left - aFrom.left;
    const dy = bFrom.top - aFrom.top;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const dist = Math.abs(b.c - a.c) + Math.abs(b.r - a.r);
    const windupPx = Math.min(18, 6 + dist * (isMobileLayout() ? 4 : 5));
    const windMs = isMobileLayout() ? 55 : 65;

    aEl.style.setProperty("--windup-ms", `${windMs}ms`);
    bEl.style.setProperty("--windup-ms", `${windMs}ms`);
    aEl.style.setProperty("--windup-tx", `${ux * windupPx}px`);
    aEl.style.setProperty("--windup-ty", `${uy * windupPx}px`);
    bEl.style.setProperty("--windup-tx", `${-ux * windupPx}px`);
    bEl.style.setProperty("--windup-ty", `${-uy * windupPx}px`);

    aEl.classList.add("is-swap-windup");
    bEl.classList.add("is-swap-windup");
    // eslint-disable-next-line no-unused-expressions
    aEl.offsetHeight;

    await new Promise((resolve) => {
      let remaining = 2;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const onEnd = (ev) => {
        if (ev.propertyName !== "transform") return;
        remaining -= 1;
        if (remaining <= 0) finish();
      };
      aEl.addEventListener("transitionend", onEnd, { once: true });
      bEl.addEventListener("transitionend", onEnd, { once: true });
      setTimeout(finish, windMs + 45);
    });

    aEl.classList.remove("is-swap-windup");
    bEl.classList.remove("is-swap-windup");
    aEl.style.removeProperty("--windup-tx");
    aEl.style.removeProperty("--windup-ty");
    bEl.style.removeProperty("--windup-tx");
    bEl.style.removeProperty("--windup-ty");
    aEl.style.removeProperty("--windup-ms");
    bEl.style.removeProperty("--windup-ms");
  }

  // Commit state + rerender to final layout immediately.
  swapCells(state.board, a, b);
  rerender();

  // Re-select after render (cells are reused but be safe).
  const aEl2 = ui.board.querySelector(`.cell[data-r="${a.r}"][data-c="${a.c}"]`);
  const bEl2 = ui.board.querySelector(`.cell[data-r="${b.r}"][data-c="${b.c}"]`);
  if (!aEl2 || !bEl2) return;

  // Clear any leftover swap animation classes.
  aEl2.classList.remove("is-swap-success");
  bEl2.classList.remove("is-swap-success");

  const aTo = aEl2.getBoundingClientRect();
  const bTo = bEl2.getBoundingClientRect();

  const aDx = aFrom.left - aTo.left;
  const aDy = aFrom.top - aTo.top;
  const bDx = bFrom.left - bTo.left;
  const bDy = bFrom.top - bTo.top;

  const dist = Math.abs(b.c - a.c) + Math.abs(b.r - a.r);
  const msCap = isMobileLayout() ? 400 : 460;
  const msBase = 130;
  const ms = Math.max(msBase, Math.min(msCap, msBase + dist * (isMobileLayout() ? 26 : 34)));

  aEl2.style.setProperty("--swap-ms", `${ms}ms`);
  bEl2.style.setProperty("--swap-ms", `${ms}ms`);

  // Invert: keep them visually where they started.
  aEl2.classList.add("is-swap-flip");
  bEl2.classList.add("is-swap-flip");
  aEl2.style.transform = `translate(${aDx}px, ${aDy}px)`;
  bEl2.style.transform = `translate(${bDx}px, ${bDy}px)`;

  // Force the inverted transform to apply, then play to 0.
  // eslint-disable-next-line no-unused-expressions
  aEl2.offsetHeight;

  await new Promise((resolve) => {
    let remaining = 2;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const onEnd = (ev) => {
      if (ev.propertyName !== "transform") return;
      remaining -= 1;
      if (remaining <= 0) finish();
    };
    aEl2.addEventListener("transitionend", onEnd, { once: true });
    bEl2.addEventListener("transitionend", onEnd, { once: true });
    setTimeout(finish, ms + 60);
    requestAnimationFrame(() => {
      aEl2.style.transform = "";
      bEl2.style.transform = "";
    });
  });

  // Clean up.
  aEl2.classList.remove("is-swap-flip");
  bEl2.classList.remove("is-swap-flip");
  aEl2.style.removeProperty("transform");
  bEl2.style.removeProperty("transform");
}

/**
 * Fixed credits popup position: center-right of the board.
 * @param {DOMRect} boardRect
 * @returns {{ x:number, y:number }}
 */
function scoreFeedPosition(boardRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safe = 24;
  const x = Math.min(vw - safe - 160, boardRect.right + 190);
  const y = Math.max(safe + 80, Math.min(vh - safe - 80, boardRect.top + boardRect.height / 2));
  return { x, y };
}

/**
 * Small per-card value popup (green) during sequential grow.
 * @param {{r:number,c:number}} p
 * @param {number} value
 */
function showCardValuePopup(p, value, opts = {}) {
  const cell = ui.board.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
  if (!cell) return;
  const host = ui.board.parentElement;
  if (!host) return;

  const rect = cell.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "pipPopup";
  if (opts.variant === "zero") pop.classList.add("pipPopup--zero");
  const abs = Math.max(0, Math.floor(Number(value) || 0));
  const fmtK = (n) => {
    if (n < 1000) return String(n);
    const k = n / 1000;
    const s = (Math.round(k * 10) / 10).toFixed(1);
    return `${s}k`;
  };
  const shown = opts.variant === "zero" ? "0" : `+${fmtK(abs)}`;
  pop.textContent = shown;
  if (abs >= 100) pop.classList.add("pipPopup--3d");
  if (abs >= 1000) pop.classList.add("pipPopup--k");

  // Use integer pixel centers to avoid occasional sub-pixel drift on some devices/zooms.
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;

  host.append(pop);
  requestAnimationFrame(() => pop.classList.add("is-showing"));
  return pop;
}

/**
 * Localized combo particles near the scored cards.
 * Only used for combo cascades (x2+).
 * @param {{r:number,c:number}[]} cells
 * @param {number} combo
 */
function burstComboSparks(cells, combo) {
  if (combo <= 1) return;
  const host = ui.board.parentElement;
  if (!host) return;
  const count = Math.min(28, 8 + combo * 4);
  for (let i = 0; i < count; i++) {
    const p = cells[Math.floor(Math.random() * cells.length)];
    const cellEl = ui.board.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
    if (!cellEl) continue;
    const rect = cellEl.getBoundingClientRect();
    const x = rect.left + rect.width * (0.25 + Math.random() * 0.5);
    const y = rect.top + rect.height * (0.25 + Math.random() * 0.5);

    const n = document.createElement("div");
    n.className = "comboSpark";
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    n.style.setProperty("--dx", `${(Math.random() * 2 - 1) * (30 + combo * 4)}px`);
    n.style.setProperty("--dy", `${-20 - Math.random() * (40 + combo * 3)}px`);
    n.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 220}deg`);
    n.style.setProperty("--hue", Math.random() < 0.7 ? "46" : "155");
    host.append(n);
    setTimeout(() => n.remove(), 520);
  }
}

function handBurstTier(type) {
  const p = HAND_PRIORITY[type] ?? 0;
  const fullHouseP = HAND_PRIORITY[HAND_TYPE.FULL_HOUSE] ?? 6;
  const fourP = HAND_PRIORITY[HAND_TYPE.FOUR_OF_A_KIND] ?? 7;
  const sfP = HAND_PRIORITY[HAND_TYPE.STRAIGHT_FLUSH] ?? 8;
  const royalP = HAND_PRIORITY[HAND_TYPE.ROYAL_FLUSH] ?? 9;
  if (p >= royalP) return "royal";
  if (p >= sfP) return "legendary";
  if (p >= fourP) return "epic";
  if (p >= fullHouseP) return "rare";
  return "common";
}

function burstRoyalGold(x, y, intensity = 1) {
  const host = ui.board.parentElement;
  if (!host) return;
  const count = Math.floor(42 + intensity * 24);
  for (let i = 0; i < count; i++) {
    const n = document.createElement("div");
    n.className = "royalSpark";
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    const ang = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 80;
    const dx = Math.cos(ang) * r * (0.7 + Math.random() * 0.6);
    const dy = Math.sin(ang) * r * (0.7 + Math.random() * 0.6) - (20 + Math.random() * 40);
    n.style.setProperty("--dx", `${dx}px`);
    n.style.setProperty("--dy", `${dy}px`);
    n.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 260}deg`);
    host.append(n);
    setTimeout(() => n.remove(), 720);
  }
}

function burstGoldWin(x, y, intensity = 1) {
  const host = ui.board.parentElement;
  if (!host) return;
  const count = Math.floor(28 + intensity * 18);
  for (let i = 0; i < count; i++) {
    const n = document.createElement("div");
    n.className = "goldSpark";
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    const ang = Math.random() * Math.PI * 2;
    const r = 26 + Math.random() * 72;
    const dx = Math.cos(ang) * r * (0.75 + Math.random() * 0.65);
    const dy = Math.sin(ang) * r * (0.75 + Math.random() * 0.65) - (18 + Math.random() * 38);
    n.style.setProperty("--dx", `${dx}px`);
    n.style.setProperty("--dy", `${dy}px`);
    n.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 260}deg`);
    host.append(n);
    setTimeout(() => n.remove(), 760);
  }
}

function showHandBurst({ label, type, credits, chainPct = 0, luckyMult = 0 }) {
  const host = ui.board.parentElement;
  if (!host) return;
  const rect = ui.board.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const n = document.createElement("div");
  n.className = "handBurst";
  const tier = handBurstTier(type);
  n.classList.add(`handBurst--${tier}`);
  if (luckyMult > 0) n.classList.add("is-lucky");
  if (chainPct > 0) n.classList.add("has-chain");
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  const amt = Math.max(0, Math.floor(Number(credits) || 0));
  const chain =
    chainPct > 0
      ? `<span class="handBurst__chain" aria-label="Combo Chain bonus">+${fmtBonusXFromPct(chainPct)}</span>`
      : "";

  const shown = fmtShort(amt);
  const len = shown.length;
  if (len >= 9) n.classList.add("handBurst--n3");
  else if (len >= 7) n.classList.add("handBurst--n2");
  else if (len >= 5) n.classList.add("handBurst--n1");

  n.innerHTML =
    `<div class="handBurst__label"><span class="handBurst__labelText">${label}</span></div>` +
    `<div class="handBurst__credits"><div class="handBurst__amt">+${shown}</div>${chain}</div>`;
  host.append(n);
  requestAnimationFrame(() => n.classList.add("is-showing"));

  if (tier === "royal") burstRoyalGold(x, y, 1.2);
  else if (tier === "legendary") burstRoyalGold(x, y, 0.35);
  else if (tier === "epic" || tier === "rare") burstGoldWin(x, y, 0.9);
  return n;
}

/**
 * Center tip prompt (new game helper).
 * @param {string} text
 */
function showCenterTip(text) {
  const host = ui.board.parentElement;
  if (!host) return;
  if (host.__centerTipEl) {
    // @ts-ignore
    host.__centerTipEl.remove();
    // @ts-ignore
    host.__centerTipEl = null;
  }
  const rect = ui.board.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const n = document.createElement("div");
  n.className = "handBurst handBurst--tip";
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  n.innerHTML = `<div class="handBurst__label">${text}</div>`;
  host.append(n);
  requestAnimationFrame(() => n.classList.add("is-showing"));
  // Allow tap/click to dismiss.
  n.addEventListener("pointerdown", () => dismissCenterTip(), { passive: true });
  // Persist until first interaction with the board.
  // @ts-ignore
  host.__centerTipEl = n;
}

function dismissCenterTip() {
  const host = ui.board.parentElement;
  if (!host) return;
  // @ts-ignore
  const n = host.__centerTipEl;
  if (!n) return;
  // @ts-ignore
  host.__centerTipEl = null;
  n.classList.add("is-fading");
  setTimeout(() => n.remove(), 260);
}

function dismissRewardBursts() {
  rewardBurstQueue.length = 0;
  rewardBurstShowing = false;
  document.querySelectorAll(".handBurst--reward").forEach((n) => n.remove());
}

function ensureJokersInDeckAfterRegenerate() {
  if (!state.deck?.addJoker) return;
  const want = Math.max(0, Math.min(2, Math.floor(jokerCount || 0)));
  for (let i = 0; i < want; i++) state.deck.addJoker();
}

/** @type {{ title:string, desc:string }[]} */
const rewardBurstQueue = [];
let rewardBurstShowing = false;

const REWARD_DEFS = /** @type {const} */ ([
  {
    id: "luckyRiver",
    name: "Lucky River",
    desc: "Scored hands have a 5% chance to 10x their reward (Stackable).",
    stack: { kind: "stackable" }
  },
  {
    id: "randomHints",
    name: "Random Hints",
    desc: "10% chance a free hint appears randomly",
    stack: { kind: "stackable" }
  },
  {
    id: "swapCoupon",
    name: "Swap Coupons",
    desc: "Swaps cost 10% less (Stackable)",
    stack: { kind: "stackable" }
  },
  {
    id: "comboBonus",
    name: "Combo Chain",
    desc: "Each consecutive scored hand in a combo receives a 0.25x bonus (Stackable)",
    stack: { kind: "stackable" }
  },
  {
    id: "premiumHands",
    name: "Premium Hands",
    desc: "Four of a Kind+ hands are worth 3x (Stackable).",
    stack: { kind: "stackable" }
  },
  {
    id: "lowRange",
    name: "Low Hands",
    desc: "Full House and lower hands are worth 6x (Stackable).",
    stack: { kind: "stackable" }
  },
  {
    id: "boldFaces",
    name: "Bolder Faces",
    desc: "Face cards (J/Q/K) and Jokers are worth 3x more (Stackable)",
    stack: { kind: "stackable" }
  },
  {
    id: "biggerNumbers",
    name: "Bigger Numbers",
    desc: "Number cards (and aces) are worth 3x more (Stackable)",
    stack: { kind: "stackable" }
  },
  {
    id: "pocketRockets",
    name: "Pocket Rockets",
    desc: "Aces are worth 10x card value (Stackable)",
    stack: { kind: "stackable" }
  },
  {
    id: "handMultiplier",
    name: "Hand Multiplier",
    desc: "Increases all hand type scores by 0.25x (Stackable)",
    stack: { kind: "stackable" }
  },
  {
    id: "jokerCard",
    name: "Joker Card",
    desc: "Counts as any card.",
    stack: { kind: "stackable", max: 2 }
  },
  {
    id: "doubleCardValues",
    name: "2X Card Values",
    desc: "Doubles the value of every card for scoring (Stackable).",
    stack: { kind: "stackable" }
  },
  {
    id: "diagonals",
    name: "Diagonals",
    desc: "Diagonals can now be scored as well.",
    stack: { kind: "unique" }
  },
  {
    id: "closeEnough",
    name: "Close Enough",
    desc: "Flushes and straights can be made with only 4 cards (includes straight flushes and royal flush).",
    stack: { kind: "unique" }
  },
  {
    id: "noClearTwoPair",
    name: "Two Pair Disabled",
    desc: "Two pair no longer clears a line, enabling higher scoring hands.",
    stack: { kind: "unique" }
  },
  {
    id: "noClearTrips",
    name: "Trips Disabled",
    desc: "Three of a kind no longer clears a line, enabling higher scoring hands.",
    stack: { kind: "unique" }
  },
  {
    id: "kickersCount",
    name: "Good Kickers",
    desc: "Kicker cards now add to scoring for hands like trips and two pair.",
    stack: { kind: "unique" }
  },
  {
    id: "ladderUp",
    name: "Ladder Up",
    desc: "One-time: each hand type gains +1x multiplier per time it has been scored this run.",
    stack: { kind: "unique" }
  }
]);

function canOfferReward(id) {
  if (id === "diagonals") return !rewards.diagonalsScored;
  if (id === "closeEnough") return !rewards.closeEnough;
  if (id === "noClearTwoPair") return !rewards.noClearTwoPair;
  if (id === "noClearTrips") return !rewards.noClearTrips;
  if (id === "kickersCount") return !rewards.kickersCount;
  if (id === "ladderUp") return !rewards.ladderUp;
  if (id === "jokerCard") return jokerCount < 2;
  return true;
}

function applyReward(id) {
  if (id === "randomHints") {
    rewards.randomHints = true;
    // First pick sets it to 10%, then +10% per additional pick.
    randomHintChance = Math.min(0.9, Math.max(0.1, (randomHintChance || 0) + 0.1));
    randomHintsPickCount += 1;
    lastPickedRewardName = "Random Hints";
    enqueueRewardBurst("Random Hints", `Chance: ${Math.round(randomHintChance * 100)}%`);
    return;
  }
  if (id === "swapCoupon") {
    rewards.swapCouponStacks += 1;
    lastPickedRewardName = "Swap Coupons";
    const pct = Math.round(10 * rewards.swapCouponStacks);
    const stacks = rewards.swapCouponStacks;
    enqueueRewardBurst(
      "Swap Coupons",
      `Swaps cost -${pct}% (${stacks} stack${stacks === 1 ? "" : "s"})`
    );
    return;
  }
  if (id === "comboBonus") {
    rewards.comboBonusStacks += 1;
    lastPickedRewardName = "Combo Chain";
    const pct = 25 * rewards.comboBonusStacks;
    const stacks = rewards.comboBonusStacks;
    enqueueRewardBurst(
      "Combo Chain",
      `+${fmtBonusXFromPct(pct)} per chain step (${stacks} stack${stacks === 1 ? "" : "s"})`
    );
    return;
  }
  if (id === "premiumHands") {
    rewards.premiumHandsStacks += 1;
    lastPickedRewardName = "Premium Hands";
    const stacks = rewards.premiumHandsStacks;
    enqueueRewardBurst(
      "Premium Hands",
      `Four of a Kind+ is now ${Math.pow(3, stacks)}x (${stacks} stack${stacks === 1 ? "" : "s"})`
    );
    return;
  }
  if (id === "lowRange") {
    rewards.lowRangeStacks += 1;
    lastPickedRewardName = "Low Hands";
    const stacks = rewards.lowRangeStacks;
    enqueueRewardBurst(
      "Low Hands",
      `Full House and lower is now ${Math.pow(6, stacks)}x (${stacks} stack${stacks === 1 ? "" : "s"})`
    );
    return;
  }
  if (id === "boldFaces") {
    rewards.boldFacesStacks += 1;
    lastPickedRewardName = "Bolder Faces";
    const stacks = rewards.boldFacesStacks;
    enqueueRewardBurst(
      "Bolder Faces",
      `Face cards and Jokers are now x${Math.pow(3, stacks)} value (${stacks} stack${stacks === 1 ? "" : "s"})`
    );
    return;
  }
  if (id === "biggerNumbers") {
    rewards.biggerNumbersStacks += 1;
    lastPickedRewardName = "Bigger Numbers";
    const stacks = rewards.biggerNumbersStacks;
    enqueueRewardBurst(
      "Bigger Numbers",
      `Number cards are now x${Math.pow(3, stacks)} value (${stacks} stack${stacks === 1 ? "" : "s"})`
    );
    return;
  }
  if (id === "pocketRockets") {
    rewards.pocketRocketsStacks += 1;
    lastPickedRewardName = "Pocket Rockets";
    const stacks = rewards.pocketRocketsStacks;
    enqueueRewardBurst(
      "Pocket Rockets",
      `Aces are now ${Math.pow(10, stacks)}x value (${stacks} stack${stacks === 1 ? "" : "s"})`
    );
    return;
  }
  if (id === "handMultiplier") {
    rewards.handMultiplierStacks += 1;
    lastPickedRewardName = "Hand Multiplier";
    const pct = 25 * rewards.handMultiplierStacks;
    enqueueRewardBurst("Hand Multiplier", `+${fmtBonusXFromPct(pct)} to all hand scores`);
    syncHandChartScores();
    return;
  }
  if (id === "ladderUp") {
    rewards.ladderUp = true;
    lastPickedRewardName = "Ladder Up";
    enqueueRewardBurst("Ladder Up", "Hand multipliers now grow as you repeat them");
    syncHandChartScores();
    scheduleSaveRun();
    return;
  }
  if (id === "jokerCard") {
    rewards.jokerWildcard = true;
    // Every pick adds a Joker to the deck.
    if (jokerCount < 2) {
      state.deck?.addJoker?.();
      jokerCount += 1;
    }
    lastPickedRewardName = "Joker Card";
    enqueueRewardBurst("Joker Card", `${jokerCount}/2 Jokers in the deck`);
    return;
  }
  if (id === "diagonals") {
    rewards.diagonalsScored = true;
    lastPickedRewardName = "Diagonals";
    enqueueRewardBurst("Diagonals", "Diagonals can now be scored as well.");
    return;
  }
  if (id === "closeEnough") {
    rewards.closeEnough = true;
    lastPickedRewardName = "Close Enough";
    enqueueRewardBurst("Close Enough", "Straights and flushes now need only 4 cards");
    return;
  }
  if (id === "doubleCardValues") {
    rewards.doubleCardValueStacks += 1;
    lastPickedRewardName = "2X Card Values";
    const mult = Math.pow(2, rewards.doubleCardValueStacks);
    enqueueRewardBurst("2X Card Values", `Card values are now x${mult}`);
    return;
  }
  if (id === "luckyRiver") {
    rewards.luckyRiverStacks += 1;
    lastPickedRewardName = "Lucky River";
    const stacks = rewards.luckyRiverStacks;
    const pct = Math.min(95, 5 * stacks);
    enqueueRewardBurst("Lucky River", `${pct}% chance to 10x scored hands`);
    return;
  }
  if (id === "noClearTwoPair") {
    rewards.noClearTwoPair = true;
    lastPickedRewardName = "Two Pair Disabled";
    enqueueRewardBurst("Two Pair Disabled", "Two pair lines no longer clear");
    return;
  }
  if (id === "noClearTrips") {
    rewards.noClearTrips = true;
    lastPickedRewardName = "Trips Disabled";
    enqueueRewardBurst("Trips Disabled", "Three of a kind lines no longer clear");
    return;
  }
  if (id === "kickersCount") {
    rewards.kickersCount = true;
    lastPickedRewardName = "Good Kickers";
    enqueueRewardBurst("Good Kickers", "Kickers now add to scores");
    return;
  }
}

function pickRewardOptions3() {
  const pool = REWARD_DEFS.filter((r) => canOfferReward(r.id));
  /** @type {typeof REWARD_DEFS[number][]} */
  const chosen = [];
  const used = new Set();
  const desired = Math.min(3, Math.max(1, pool.length));
  while (chosen.length < desired && pool.length) {
    const idx = state.rng.int(pool.length);
    const r = pool[idx];
    if (used.has(r.id)) continue;
    used.add(r.id);
    chosen.push(r);
  }
  // If we ran out (because pool < 3), pad with stackables that are still allowed (respects Joker max, etc.).
  const repeatables = REWARD_DEFS.filter((r) => r.stack.kind === "stackable" && canOfferReward(r.id));
  while (chosen.length < 3 && repeatables.length) {
    const r = repeatables[state.rng.int(repeatables.length)];
    chosen.push(r);
  }
  return chosen.slice(0, 3);
}

/**
 * @param {typeof REWARD_DEFS[number]} o
 */
function rewardPickDescHtml(o) {
  if (o.id === "jokerCard") {
    return `${o.desc} You have <strong>${jokerCount}</strong> of <strong>2</strong> in the deck.`;
  }
  return o.desc;
}

/**
 * @param {typeof REWARD_DEFS[number]} o
 */
function rewardStackTagHtml(o) {
  const stackable = o.stack.kind === "stackable";
  const maxSuffix =
    stackable && "max" in o.stack && o.stack.max != null ? ` · max ${o.stack.max}` : "";
  const label = stackable ? `Stackable${maxSuffix}` : "One-time";
  const mod = stackable ? "rewardPick__stackTag--stackable" : "rewardPick__stackTag--once";
  return `<span class="rewardPick__stackTag ${mod}">${label}</span>`;
}

function showRewardPickModal(clearedGoal) {
  return new Promise((resolve) => {
    const opts = pickRewardOptions3();
    const swapNotice = `
      <div class="swapNotice__line1">Goal <span class="swapNotice__goal">${clearedGoal}</span> Cleared</div>
      <div class="swapNotice__line2">Swaps Now Cost <span class="swapNotice__cost">${fmtShort(swapCost())}</span>, Hints Now Cost <span class="swapNotice__cost">${fmtShort(hintCost())}</span></div>
    `;
    const overlay = document.createElement("div");
    overlay.className = "rewardPickOverlay";
    overlay.innerHTML = `
      <div class="rewardPickOverlay__backdrop"></div>
      <div class="rewardPickOverlay__card" role="dialog" aria-modal="true">
        <div class="rewardPickOverlay__swapNotice">${swapNotice}</div>
        <div class="rewardPickOverlay__title">Choose a Reward</div>
        <div class="rewardPickOverlay__choices">
          ${opts
            .map(
              (o) => `
            <button class="rewardPick" type="button" data-id="${o.id}">
              <div class="rewardPick__head">
                <div class="rewardPick__name">${o.name}</div>
                ${rewardStackTagHtml(o)}
              </div>
              <div class="rewardPick__desc">${rewardPickDescHtml(o)}</div>
            </button>
          `
            )
            .join("")}
        </div>
      </div>
    `;
    document.body.append(overlay);

    // Sound: same as a goal clear when the reward picker appears.
    sfx.goalReached(clearedGoal);

    const onPick = (id) => {
      // Sound: same as goal clear when selecting a reward.
      sfx.goalReached(clearedGoal);
      overlay.remove();
      resolve(String(id));
    };
    overlay.querySelectorAll(".rewardPick").forEach((btn) => {
      btn.addEventListener("click", () => {
        // @ts-ignore
        onPick(btn.dataset.id);
      });
    });
  });
}

async function processGoalReachedSequence(completedGoalIndex, completedGoalTarget) {
  if (goalSequenceActive) return false;
  const completed = Math.max(1, Math.floor(completedGoalIndex || goalIndex));
  const completedTarget = Math.max(1, Math.floor(completedGoalTarget || goalTarget));
  const credits = Math.max(0, Math.floor(state.credits));
  if (credits < completedTarget) return false;
  goalSequenceActive = true;
  try {
    // Fill to the current goal, then pause for the reward pick.
    state.credits = completedTarget;
    await animateCreditsToAsync(completedTarget, 420);
    peakGoalClearedThisRun = Math.max(peakGoalClearedThisRun, completed);
    bumpGoalCelebration();

    if (completed === 11) {
      enqueueRewardBurst("Heating up!", "You're 1/3 there. Goals will be harder now.");
    } else if (completed === 21) {
      enqueueRewardBurst("Final Stretch!", "Can you make it to 31?");
    }

    if (completed >= 31) {
      // Winning run: no more goals/rewards.
      peakGoalClearedThisRun = Math.max(peakGoalClearedThisRun, 31);
      endRun("win");
      rerender();
      return true;
    }

    // Advance to the next goal *before* showing the picker so swap/hint costs reflect the new goal.
    goalIndex = completed + 1;
    goalTarget = goalTargetForIndex(goalIndex);
    updateRewardLabel();
    updateGoalTitleLabel();
    if (ui.goalTarget) ui.goalTarget.textContent = goalTarget.toLocaleString();

    const picked = await showRewardPickModal(completed);
    applyReward(picked);
    rerender();

    // Keep credits at the completed goal while selecting the new goal reward.
    state.credits = completedTarget;
    setCreditsInstant(completedTarget);
    return true;
  } finally {
    goalSequenceActive = false;
  }
}

async function playRewardBurst({ title, desc }) {
  const host = ui.board.parentElement;
  if (!host) return;
  const rect = ui.board.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Run reward notifications should always sit above the centered hand-score burst,
  // and never be clipped off-screen.
  const x = centerX;

  // Gold particle pop on reward.
  const n = document.createElement("div");
  n.className = "handBurst handBurst--reward";
  n.style.left = `${x}px`;
  n.style.top = `${centerY}px`; // temporary; we'll measure and reposition
  n.innerHTML = `<div class="handBurst__label">${title}</div><div class="handBurst__credits">${desc}</div>`;
  host.append(n);
  // Measure after insert so we can guarantee visibility + placement.
  const br = n.getBoundingClientRect();
  const halfH = br.height / 2;
  const padTop = 14;
  const minY = rect.top + padTop + halfH;
  const maxY = centerY - 10 - halfH; // keep a little gap above hand-score burst center
  const targetY = centerY - Math.min(180, rect.height * 0.22);
  const y = Math.max(minY, Math.min(maxY, targetY));
  n.style.top = `${y}px`;

  burstGoldWin(x, y, 0.85);
  requestAnimationFrame(() => n.classList.add("is-showing"));
  const showMs = 3000;
  await sleep(showMs - 220);
  n.classList.add("is-fading");
  await sleep(260);
  n.remove();
}

function enqueueRewardBurst(title, desc) {
  rewardBurstQueue.push({ title, desc });
  if (rewardBurstShowing) return;
  rewardBurstShowing = true;
  (async () => {
    try {
      while (rewardBurstQueue.length) {
        const next = rewardBurstQueue.shift();
        if (!next) break;
        // Don't show reward bursts while the win overlay is active; queue will resume after.
        await playRewardBurst(next);
      }
    } finally {
      rewardBurstShowing = false;
    }
  })();
}

function showHintHighlightForMove(move) {
  viewFx.hint = new Set([`${move.a.r},${move.a.c}`, `${move.b.r},${move.b.c}`]);
  rerender();
}

function maybeTriggerRandomHint() {
  if (!rewards.randomHints) return;
  if (state.busy) return;
  // Disable during cascades/combos.
  if (state.comboStep > 0) return;
  // While a reward picker is pending, don't fire random hints.
  if (pendingRewardPicks > 0) return;
  if (viewFx.hint) return;
  if (Math.random() >= randomHintChance) return;

  const move = findBestScoringSwap(state.board);
  if (!move) return;
  enqueueRewardBurst("Free Hint!", `${Math.round(randomHintChance * 100)}% random hint chance`);
  showHintHighlightForMove(move);
}

function showBigWin(amount, goalAtStart) {
  const host = ui.board.parentElement;
  if (!host) return;
  const rect = ui.board.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const n = document.createElement("div");
  n.className = "bigWinBurst";
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  const to = Math.max(0, Math.floor(amount));
  const goal = Math.max(1, Math.floor(goalAtStart || goalTarget));
  const pct = to / goal;
  const phrase =
    pct >= 1
      ? "STACKED!"
      : pct >= 0.75
        ? "MONSTER HIT!"
        : pct >= 0.5
          ? "GOOD RUN!"
          : "NICE HAND!";
  n.innerHTML = `<div class="bigWinBurst__title">${phrase}</div><div class="bigWinBurst__value">+0</div>`;
  host.append(n);
  requestAnimationFrame(() => n.classList.add("is-showing"));

  const valueEl = n.querySelector(".bigWinBurst__value");
  const duration = 1900; // slower count-up
  const start = performance.now();
  const from = Math.max(0, Math.floor(to * (0.72 + Math.random() * 0.18)));
  if (valueEl) valueEl.textContent = `+${fmtShort(from)}`;

  const tick = (t) => {
    const p = Math.min(1, (t - start) / duration);
    // Ease out so it feels like a jackpot meter.
    const e = 1 - Math.pow(1 - p, 2.35);
    const v = Math.floor(from + (to - from) * e);
    if (valueEl) valueEl.textContent = `+${fmtShort(v)}`;
    if (p < 1) requestAnimationFrame(tick);
    else if (valueEl) valueEl.textContent = `+${fmtShort(to)}`;
  };
  requestAnimationFrame(tick);

  // Hold briefly, then fade away.
  setTimeout(() => {
    n.classList.add("is-fading");
    setTimeout(() => n.remove(), 260);
  }, duration + 900);
}

function rankToValue14(rank) {
  if (rank === "A") return 14;
  if (rank === "K") return 13;
  if (rank === "Q") return 12;
  if (rank === "J") return 11;
  if (rank === "10") return 10;
  return Number(rank);
}

/**
 * Determine which cards actually contribute to scoring for this hand type.
 * - Two Pair: only the 4 paired cards
 * - Trips: only the 3-of-kind cards
 * - Quads: only the 4-of-kind cards
 * - Full house / straights / flushes: all 5 cards
 *
 * @param {{ type:string, label:string, cells:{r:number,c:number}[] }} line
 */
function getContributionMaskForBoard(board, line) {
  const cards = line.cells.map((p) => board[p.r][p.c]);
  const present = cards.filter(Boolean);
  if (present.length !== 5) {
    return { contrib: new Set(), dim: new Set(), contribCells: [] };
  }

  const evald = scoringOpts().evaluateHand(present);
  const vc = evald.meta.valueCounts;

  /** @type {Set<number>|null} */
  let values = null;
  if (evald.type === HAND_TYPE.TWO_PAIR) {
    values = new Set(Object.entries(vc).filter(([, n]) => n === 2).map(([v]) => Number(v)));
  } else if (evald.type === HAND_TYPE.THREE_OF_A_KIND) {
    values = new Set(Object.entries(vc).filter(([, n]) => n === 3).map(([v]) => Number(v)));
  } else if (evald.type === HAND_TYPE.FOUR_OF_A_KIND) {
    values = new Set(Object.entries(vc).filter(([, n]) => n === 4).map(([v]) => Number(v)));
  } else {
    // Straights/flushes/full house/straight flush/royal flush -> all 5 contribute
    values = null;
  }

  const contrib = new Set();
  const dim = new Set();
  /** @type {{r:number,c:number}[]} */
  const contribCells = [];
  /** @type {{r:number,c:number}[]} */
  const dimCells = [];

  const addPicked = (p) => {
    const k = `${p.r},${p.c}`;
    if (contrib.has(k)) return;
    contrib.add(k);
    contribCells.push(p);
  };

  // Close Enough: if we upgraded a straight/flush via 4 cards, treat the 5th as a kicker
  // unless the player has "Good Kickers".
  if (!rewards.kickersCount && evald?.meta?.closeEnoughIdxs && Array.isArray(evald.meta.closeEnoughIdxs)) {
    const pick = new Set(evald.meta.closeEnoughIdxs.map((i) => Number(i)).filter((i) => i >= 0 && i < 5));
    if (pick.size > 0) {
      for (let i = 0; i < line.cells.length; i++) {
        const p = line.cells[i];
        if (pick.has(i)) addPicked(p);
      }
      for (let i = 0; i < line.cells.length; i++) {
        const p = line.cells[i];
        const k = `${p.r},${p.c}`;
        if (contrib.has(k)) continue;
        if (!board[p.r][p.c]) continue;
        dim.add(k);
        dimCells.push(p);
      }
      return { contrib, dim, contribCells, dimCells };
    }
  }

  // Wildcards: keep kickers excluded unless the player has "Kickers Count".
  // We always include Joker cards as contributors, then fill contributing ranks up to the target size.
  if ((rewards.jokerWildcard || rewards.extraJoker) && !rewards.kickersCount) {
    const target =
      evald.type === HAND_TYPE.TWO_PAIR
        ? 4
        : evald.type === HAND_TYPE.THREE_OF_A_KIND
          ? 3
          : evald.type === HAND_TYPE.FOUR_OF_A_KIND
            ? 4
            : 5;

    /** @type {{ p:{r:number,c:number}, card:any, v:number }[]} */
    const fixed = [];
    /** @type {{ p:{r:number,c:number}, card:any }[]} */
    const jokers = [];
    for (const p of line.cells) {
      const card = board[p.r][p.c];
      if (!card) continue;
      if (String(card.rank) === "JOKER") jokers.push({ p, card });
      else fixed.push({ p, card, v: rankToValue14(card.rank) });
    }

    /** @type {Map<number, { items: typeof fixed }>} */
    const byV = new Map();
    for (const it of fixed) {
      const arr = byV.get(it.v);
      if (arr) arr.items.push(it);
      else byV.set(it.v, { items: [it] });
    }

    /** @type {Set<string>} */
    const pickedKeys = new Set();
    const addPicked2 = (p) => {
      const k = `${p.r},${p.c}`;
      if (pickedKeys.has(k)) return;
      pickedKeys.add(k);
      addPicked(p);
    };

    // Always count jokers as contributing cards.
    for (const j of jokers) {
      if (contribCells.length >= target) break;
      addPicked2(j.p);
    }

    // Add the main group ranks first (pairs/trips/quads) if they exist among fixed cards.
    if (values && values.size) {
      for (const v of values) {
        const group = byV.get(v);
        if (!group) continue;
        for (const it of group.items) {
          if (contribCells.length >= target) break;
          addPicked2(it.p);
        }
        if (contribCells.length >= target) break;
      }
    }

    // If we're still short (because wildcards filled missing ranks), fill with the strongest remaining fixed cards,
    // preferring larger groups, then higher ranks.
    if (contribCells.length < target) {
      const remaining = fixed
        .filter((it) => !pickedKeys.has(`${it.p.r},${it.p.c}`))
        .sort((a, b) => {
          const ca = byV.get(a.v)?.items.length ?? 1;
          const cb = byV.get(b.v)?.items.length ?? 1;
          return cb - ca || b.v - a.v;
        });
      for (const it of remaining) {
        if (contribCells.length >= target) break;
        addPicked2(it.p);
      }
    }

    // Everything else is a kicker/dim card.
    for (const p of line.cells) {
      const k = `${p.r},${p.c}`;
      if (contrib.has(k)) continue;
      if (!board[p.r][p.c]) continue;
      dim.add(k);
      dimCells.push(p);
    }

    return { contrib, dim, contribCells, dimCells };
  }

  for (const p of line.cells) {
    const card = board[p.r][p.c];
    const k = `${p.r},${p.c}`;
    if (!card) continue;
    const v = rankToValue14(card.rank);
    const isContrib = rewards.kickersCount ? true : values == null ? true : values.has(v);
    if (isContrib) {
      contrib.add(k);
      contribCells.push(p);
    } else {
      dim.add(k);
      dimCells.push(p);
    }
  }

  return { contrib, dim, contribCells, dimCells };
}

function getContributionMask(line) {
  return getContributionMaskForBoard(state.board, line);
}

function computeImmediateLineScoreForBoard(board, line) {
  const { contribCells } = getContributionMaskForBoard(board, line);
  const ordered = orderCellsForLine(line, contribCells);
  let pipSum = 0;
  for (const p of ordered) {
    const card = board[p.r][p.c];
    if (!card) continue;
    pipSum += cardScoreValue(card);
  }
  const hm = effectiveHandMultiplier(line.type);
  const rewardMult = 1 + 0.25 * Math.max(0, Math.floor(rewards.handMultiplierStacks || 0));
  return pipSum * hm * rewardMult * handScoreMultForReward(line.type);
}

/**
 * Ensure per-card calculations run in a readable direction:
 * - row: left -> right
 * - col: top -> bottom
 * - diagonals: left -> right
 *
 * @param {{ kind:"row"|"col"|"diagDown"|"diagUp" }} line
 * @param {{r:number,c:number}[]} cells
 */
function orderCellsForLine(line, cells) {
  const kind = line?.kind;
  const arr = cells.slice();
  if (kind === "col") return arr.sort((a, b) => a.r - b.r || a.c - b.c);
  // row + both diagonals: left -> right
  return arr.sort((a, b) => a.c - b.c || a.r - b.r);
}

function findBestScoringSwap(board) {
  /** @type {{r:number,c:number}[]} */
  const positions = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) positions.push({ r, c });

  let best = null;
  let bestScore = -1;
  let bestPriority = -1;

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      swapCells(board, a, b);
      const lines = findScoringLines(board, baseScoreForType, boardLineOpts());
      let total = 0;
      let maxP = -1;
      for (const ln of lines) {
        total += computeImmediateLineScoreForBoard(board, ln);
        maxP = Math.max(maxP, HAND_PRIORITY[ln.type] ?? 0);
      }
      swapCells(board, a, b);

      if (lines.length === 0) continue;
      if (total > bestScore || (total === bestScore && maxP > bestPriority)) {
        bestScore = total;
        bestPriority = maxP;
        best = { a, b };
      }
    }
  }
  return best;
}

function showRightFeedMessage(text) {
  const host = ui.board.parentElement;
  if (!host) return;
  const rect = ui.board.getBoundingClientRect();
  const pos = scoreFeedPosition(rect);
  const p = document.createElement("div");
  p.className = "scorePopup";
  p.style.left = `${pos.x}px`;
  p.style.top = `${pos.y}px`;
  p.style.transform = "translate(-50%, -50%)";
  p.innerHTML = `<div class="scorePopup__hand">${text}</div>`;
  host.append(p);
  requestAnimationFrame(() => p.classList.add("is-showing"));
  setTimeout(() => p.remove(), 900);
}

function nextFrame() {
  return new Promise((res) => requestAnimationFrame(() => res()));
}

async function kickDropAnimation() {
  // Two frames ensures the "from" transform is painted before we remove it.
  await nextFrame();
  await nextFrame();
  const dropping = /** @type {HTMLElement[]} */ ([...ui.board.querySelectorAll(".cell.is-dropping")]);
  if (dropping.length === 0) {
    viewFx.dropRowsById = null;
    viewFx.dropMsById = null;
    return;
  }

  // Removing the class starts the CSS transform transition back to 0.
  for (const n of dropping) n.classList.remove("is-dropping");

  // Wait for the *actual* transition end so scoring checks start immediately
  // after the drop finishes (no extra hidden delay).
  const maxMs = Math.max(
    0,
    ...dropping.map((n) => {
      const ms = parseFloat(getComputedStyle(n).getPropertyValue("--drop-ms"));
      return Number.isFinite(ms) ? ms : 0;
    })
  );

  await new Promise((resolve) => {
    let remaining = dropping.length;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const onEnd = (ev) => {
      if (ev.propertyName !== "transform") return;
      remaining -= 1;
      if (remaining <= 0) finish();
    };
    for (const n of dropping) n.addEventListener("transitionend", onEnd, { once: true });
    // Safety: if an event is missed, don't hang.
    setTimeout(finish, maxMs + 80);
  });

  viewFx.dropRowsById = null;
  viewFx.dropMsById = null;
}

/**
 * Sequentially pulse the cards in a scored line.
 * Row pulses left->right, column pulses top->bottom.
 * Diagonals pulse left->right.
 * @param {{ kind:"row"|"col"|"diagDown"|"diagUp", cells:{r:number,c:number}[] }} line
 */
async function pulseScoredLine(line, combo, contribCells, dimCells, onTotal, handBurstEl) {
  // DOM nodes exist only after a render.
  const ordered = orderCellsForLine(line, contribCells); // only scoring cards
  const orderedDim = orderCellsForLine(line, dimCells);
  /** @type {HTMLElement[]} */
  const valuePops = [];
  let running = 0;
  let i = 0;
  const dimKeySet = new Set(dimCells.map((p) => `${p.r},${p.c}`));

  if (handBurstEl) valuePops.push(handBurstEl);

  // Kickers: show grey 0 popups and keep them dimmed.
  for (const p of orderedDim) {
    const pop = showCardValuePopup(p, 0, { variant: "zero" });
    if (pop) valuePops.push(pop);
  }

  for (const p of ordered) {
    const el = ui.board.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
    if (!el) continue;
    el.style.setProperty("--combo-speed", String(comboSpeed(combo)));
    // Per-card value popup when it enlarges.
    const card = state.board[p.r]?.[p.c];
    if (card) {
      const v = cardScoreValue(card);
      running += v;
      onTotal(running);
      const pop = showCardValuePopup(p, v);
      if (pop) valuePops.push(pop);
    }
    const face = el.querySelector(".cardFace");
    el.classList.add("is-seq-grown");
    el.classList.remove("is-seq-grow");
    el.classList.remove("is-border-pop");
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight;
    el.classList.add("is-seq-grow");
    // Ensure the browser starts the CSS animation, then play the tick.
    await nextFrame();
    // Keep the animation beat unchanged, but don't tick for dimmed kickers.
    if (!dimKeySet.has(`${p.r},${p.c}`)) sfx.cardFlipTick(i, combo);

    // When grow finishes, trigger border pop exactly on the same beat.
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.classList.remove("is-seq-grow"); // keep grown state, drop animation class
        el.classList.remove("is-border-pop");
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        el.classList.add("is-border-pop");
        resolve();
      };

      // Fallback in case animationend doesn't fire (rare).
      const fallback = setTimeout(finish, 220);

      if (!face) {
        clearTimeout(fallback);
        finish();
        return;
      }

      const onEnd = (ev) => {
        if (ev.animationName !== "seqGrow") return;
        face.removeEventListener("animationend", onEnd);
        clearTimeout(fallback);
        finish();
      };
      face.addEventListener("animationend", onEnd, { once: false });
    });

    // Delay between cards (now aligned to the end of each grow).
    await sleep(comboDelayMs(60, combo));
    i++;
  }
  // small tail so last pulse reads
  await sleep(comboDelayMs(60, combo));

  // Combo-only localized particles near the scored cards.
  burstComboSparks(ordered, 1);

  // Fade all card-value popups together after the whole line scan finishes.
  for (const n of valuePops) n.classList.add("is-fading");
  setTimeout(() => valuePops.forEach((n) => n.remove()), 260);
}

/**
 * @param {{r:number,c:number}} pos
 */
async function onCellClick(pos) {
  if (state.busy) return;
  if (orientationBlocked) return;
  dismissCenterTip();
  dismissRewardBursts();
  if (checkCantAffordSwapAndEnd()) return;
  // First interaction unlocks audio on most browsers.
  sfx.unlock();
  music.unlock();
  sfx.cardFlipTick(0, 1);
  // Any interaction clears hint.
  if (viewFx.hint) {
    viewFx.hint = null;
    rerender();
  }

  if (!state.selected) {
    state.selected = pos;
    rerender();
    return;
  }

  const a = state.selected;
  const b = pos;
  state.selected = null;

  if (a.r === b.r && a.c === b.c) {
    rerender();
    return;
  }

  // Every attempted swap costs credits (stakes).
  if (!spendSwapCost()) {
    endRun("bankrupt");
    rerender();
    return;
  }

  // Allow any swap (including setup swaps that don't score immediately).
  state.busy = true;

  // Commit the swap immediately and animate to the new positions (FLIP),
  // which avoids the post-animation snap/jitter.
  await swapWithFlipAnimation(a, b);
  sfx.swapSuccess();
  successfulMoves += 1;
  await resolveCascades();
  // Show combined total for the swap (including combo/cascade lines).
  setLastSwapTotal(lastSwapTotal);
  // End only if the player can no longer afford a swap.
  if (checkCantAffordSwapAndEnd()) return;
  state.busy = false;
  rerender();
  maybeTriggerRandomHint();
}

async function resolveCascades() {
  // We keep a step counter for runaway protection, but scoring no longer uses it.
  state.comboStep = 0;
  state.lastHands = [];
  let gainedTotal = 0;
  // Track per-swap total separately; reset each swap.
  let swapTotal = 0;
  const goalAtComboStart = goalTarget;
  let stopAfterGoalClear = false;
  let goalClearedThisResolve = false;
  let goalClearedIndex = 0;
  let goalClearedTarget = 0;
  // The single “breather” between a cascade landing and the next scoring check.
  // Tweak this number to change how fast scoring starts after a fill.
  const CASCADE_EVAL_DELAY_MS = 26;

  const MAX_COMBO = 80;
  while (state.comboStep < MAX_COMBO) {
    if (!state.deck) throw new Error("Deck not initialized");
    const lines = findScoringLines(state.board, baseScoreForType, boardLineOpts());
    if (lines.length === 0) break;
    if (state.comboStep >= MAX_COMBO - 1) {
      // Extremely unlikely, but prevents runaway auto-resolve.
      regenerateBoardForFairness(state, { maxAttempts: 2500, lineClearOpts: boardLineOpts() });
      ensureJokersInDeckAfterRegenerate();
      showToast(ui.toast, "Fresh deal (runaway cascade)");
      break;
    }

    // Process scored lines one at a time so each increments the combo.
    // (Rows/cols can score simultaneously; we serialize their scoring feedback.)
    lines.sort((a, b) => (HAND_PRIORITY[b.type] ?? 0) - (HAND_PRIORITY[a.type] ?? 0));

    const clearSetAll = cellsToClear(lines);

    for (const line of lines) {
      if (state.comboStep >= MAX_COMBO) break;
      state.comboStep += 1;

      state.lastHands = [line.label];
      const { contrib, dim, contribCells, dimCells } = getContributionMask(line);
      viewFx.scoring = contrib;
      viewFx.dim = dim;
      viewFx.clearing = null;
      viewFx.scoredLines = [line];

      rerender();
      const hm = effectiveHandMultiplier(line.type);
      let pipSum = 0;
      for (const p of orderCellsForLine(line, contribCells)) {
        const card = state.board[p.r][p.c];
        if (card) pipSum += cardScoreValue(card);
      }
      const lineScore = pipSum * hm;
      const rewardMult = 1 + 0.25 * Math.max(0, Math.floor(rewards.handMultiplierStacks || 0));
      const chainStacks = Math.max(0, Math.floor(rewards.comboBonusStacks || 0));
      const chainStep = Math.max(0, (state.comboStep || 1) - 1);
      const comboMult = chainStacks > 0 && chainStep > 0 ? 1 + 0.25 * chainStacks * chainStep : 1;
      let gained = Math.floor(lineScore * comboMult * rewardMult * handScoreMultForReward(line.type));
      const lrStacks = Math.max(0, Math.floor(rewards.luckyRiverStacks || 0));
      const lrChance = lrStacks <= 0 ? 0 : Math.min(0.95, 0.05 * lrStacks);
      const lrRoll = lrChance > 0 ? state.rng.int(1_000_000) / 1_000_000 : 1;
      const luckyTriggered = lrChance > 0 && lrRoll < lrChance;
      if (luckyTriggered) {
        gained *= 10;
        sfx.luckyRiver?.();
      }
      const chainPct = chainStacks > 0 ? 25 * chainStacks * chainStep : 0;
      const handBurstEl = showHandBurst({
        label: line.label,
        type: line.type,
        credits: gained,
        chainPct,
        luckyMult: luckyTriggered ? 10 : 0
      });
      // Ensure the line highlight is visible before the sequential grow starts.
      await sleep(comboDelayMs(45, state.comboStep));
      await pulseScoredLine(line, state.comboStep, contribCells, dimCells, () => {}, handBurstEl);

      // Goals cannot be exceeded: cap the credits gain at the remaining amount to the current goal.
      const remainingToGoal = Math.max(0, Math.floor(goalTarget) - Math.floor(state.credits));
      const applied = Math.min(gained, remainingToGoal);
      const goalIndexBefore = goalIndex;
      state.credits += applied;
      gainedTotal += applied;
      swapTotal += applied;

      sfx.scoreHand(line.type, state.comboStep);
      // Track plays for Ladder Up (counts accrue all run; effect only visible when reward is active).
      incHandTypePlayCount(line.type);
      if (rewards.ladderUp) syncHandChartScores();
      rerender();
      scheduleSaveRun();

      // If this line reached the goal, stop after fully resolving clears/refill.
      if (Math.max(0, Math.floor(state.credits)) >= goalTarget) {
        stopAfterGoalClear = true;
        goalClearedThisResolve = true;
        goalClearedIndex = goalIndex;
        goalClearedTarget = goalTarget;
      }

      viewFx.dim = null;

      // Delay between popups for multiple lines (and to let the popup breathe).
      await sleep(comboDelayMs(120, state.comboStep));
    }

    // Now clear everything that scored this evaluation in one removal step.
    // (Cards can belong to both a scoring row and column; removed once.)
    viewFx.scoring = null;
    viewFx.scoredLines = null;
    viewFx.dim = null;
    viewFx.clearing = clearSetAll;
    rerender();
    await sleep(comboDelayMs(120, state.comboStep));

    // Remove any persisted "grown" state after we've transitioned into clearing.
    ui.board
      .querySelectorAll(".cell.is-seq-grown, .cell.is-border-pop")
      .forEach((n) => n.classList.remove("is-seq-grown", "is-border-pop"));

    // Remove
    const removed = [];
    for (const key of clearSetAll) {
      const [r, c] = key.split(",").map(Number);
      const card = state.board[r][c];
      if (card) removed.push(card);
      state.board[r][c] = null;
    }
    if (removed.length) state.deck.recycle(removed);
    viewFx.clearing = null;
    rerender();

    await sleep(comboDelayMs(70, state.comboStep));

    // Fall + refill (two phase): existing cards fall first, then new cards deal in a column at a time.
    viewFx.dropMode = "gravity";
    const drops = applyGravity(state.board);
    viewFx.dropRowsById = drops;
    // Make gravity land as a unified "batch" (avoids the look of rows settling one-by-one).
    const maxDrop = Math.max(0, ...drops.values());
    const gravityMs = Math.min(360, 160 + maxDrop * 38);
    viewFx.dropMsById = new Map([...drops.keys()].map((id) => [id, gravityMs]));
    rerender();
    sfx.shuffle();
    await kickDropAnimation();
    await sleep(CASCADE_EVAL_DELAY_MS);

    // Deal-in: fill all empty cells in ONE batch so rows don't appear left->right.
    // IMPORTANT: only animate the *new* cards during refill; re-animating settled cards causes jitter.
    viewFx.dropMode = "refill";
    const REFILL_SPAWN_PAD = 2; // extra height above the board for deal-in feel
    /** @type {Map<string, number>} */
    const dropsNew = new Map();
    let maxRefillDrop = 0;
    for (let rr = 0; rr < 5; rr++) {
      for (let cc = 0; cc < 5; cc++) {
        if (state.board[rr][cc]) continue;
        const card = state.deck.draw();
        state.board[rr][cc] = card;
        const dropRows = rr + 1 + REFILL_SPAWN_PAD;
        dropsNew.set(card.id, dropRows);
        maxRefillDrop = Math.max(maxRefillDrop, dropRows);
      }
    }
    if (dropsNew.size > 0) {
      const refillMs = Math.min(440, 210 + maxRefillDrop * 34);
      viewFx.dropRowsById = dropsNew;
      viewFx.dropMsById = new Map([...dropsNew.keys()].map((id) => [id, refillMs]));
      rerender();
      sfx.shuffle();
      await kickDropAnimation();
      await sleep(CASCADE_EVAL_DELAY_MS);
    }

    viewFx.dropMode = null;
    viewFx.dropMsById = null;
    // Tight: allow microtask/paint, then evaluate next cascade.
    await sleep(0);

    // (Reward picks are now handled inside `processGoalOvershootSequence`.)
    if (stopAfterGoalClear) {
      // Important: stopping cascades for clarity should not leave a scoring line on the board,
      // otherwise it looks like a bug (e.g., visible two pair that "doesn't clear").
      // Re-deal a fair stable board and keep the run stats/rewards/credits.
      regenerateBoardForFairness(state, { maxAttempts: 2500, lineClearOpts: boardLineOpts() });
      ensureJokersInDeckAfterRegenerate();
      state.selected = null;
      viewFx.scoring = null;
      viewFx.scoredLines = null;
      viewFx.dim = null;
      viewFx.clearing = null;
      viewFx.hint = null;
      rerender();
      showToast(ui.toast, "Fresh deal");

      if (goalClearedIndex > 0) {
        // Show rewards only after the scored line fully resolves (clear → refill).
        setLastSwapTotal(0); // reset to "-" for the new goal, per UX request
        await processGoalReachedSequence(goalClearedIndex, goalClearedTarget);
      }
      break;
    }
  }

  // Only publish swap total when the swap completes without goal clear.
  if (!goalClearedThisResolve) setLastSwapTotal(swapTotal);

  state.comboStep = 0;
  // Special-case: Goal 1 big wins are too frequent; only show 75%+ tier there.
  const showBigWinThreshold = goalIndex === 1 ? 0.75 : 0.25;
  if (!goalClearedThisResolve && gainedTotal > 0 && gainedTotal >= goalAtComboStart * showBigWinThreshold) {
    showBigWin(gainedTotal, goalAtComboStart);
  }
}

syncMobileViewportClass();
MOBILE_MQ.addEventListener("change", () => {
  syncMobileViewportClass();
  syncOrientationBlock();
});
window.addEventListener("resize", () => {
  positionScoreFeed();
  syncOrientationBlock();
});
markActivity();
rerender();

// Block play in mobile landscape.
syncOrientationBlock();

// First-time load helper: only show the tip when we are not restoring an in-progress run.
if (!restoredRun) {
  showCenterTip("Swap cards to make either horizontal or vertical poker hands<br />and&nbsp;earn rewards.");
}

