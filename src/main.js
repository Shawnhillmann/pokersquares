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
import { HAND_PRIORITY, HAND_TYPE } from "./poker/evaluationTypes.js";
import { evaluateHand } from "./poker/evaluateHand.js";
import { cardBaseValue, handMultiplier } from "./game/scoring.js";
import { sfx } from "./audio/sfx.js";

const ui = {
  board: /** @type {HTMLElement} */ (document.getElementById("board")),
  lineLayer: /** @type {HTMLElement} */ (document.getElementById("lineLayer")),
  toast: /** @type {HTMLElement} */ (document.getElementById("toast")),
  newGameBtn: /** @type {HTMLButtonElement} */ (document.getElementById("newGameBtn")),
  hintBtn: /** @type {HTMLButtonElement} */ (document.getElementById("hintBtn")),
  helpBtn: /** @type {HTMLButtonElement} */ (document.getElementById("helpBtn")),
  toggleChartBtn: /** @type {HTMLButtonElement} */ (document.getElementById("toggleChartBtn")),
  toggleChartBtn2: /** @type {HTMLButtonElement} */ (document.getElementById("toggleChartBtn2")),
  handChart: /** @type {HTMLElement} */ (document.getElementById("handChart")),
  rulesPanel: /** @type {HTMLElement} */ (document.getElementById("rulesPanel")),
  runEndModal: /** @type {HTMLElement} */ (document.getElementById("runEndModal")),
  runEndReason: /** @type {HTMLElement|null} */ (document.getElementById("runEndReason")),
  finalScoreValue: /** @type {HTMLElement} */ (document.getElementById("finalScoreValue")),
  finalMovesValue: /** @type {HTMLElement} */ (document.getElementById("finalMovesValue")),
  restartBtn: /** @type {HTMLButtonElement} */ (document.getElementById("restartBtn")),
  totalScoreBig: /** @type {HTMLElement} */ (document.getElementById("totalScoreBig")),
  howToPlayPanel: /** @type {HTMLElement} */ (document.getElementById("howToPlayPanel")),
  creditDock: /** @type {HTMLElement|null} */ (document.getElementById("creditDock")),
  toggleHowToBtn: /** @type {HTMLButtonElement|null} */ (document.getElementById("toggleHowToBtn"))
};

const state = createGameState({ seed: null });
newGame(state);
state.credits = 500;

let successfulMoves = 0;

const SCORE_OPTS = { minType: HAND_TYPE.TWO_PAIR };

const STARTING_POINTS = 500;
const SWAP_COST = 100;
const HINT_COST = 300;

function clampNonNegative(n) {
  return Math.max(0, Math.floor(n));
}

/** @typedef {"bankrupt"} RunEndKind */

const RUN_END_COPY = /** @type {const} */ ({
  bankrupt: "Not enough credits to swap."
});

/**
 * @param {RunEndKind} kind
 */
function endRun(kind) {
  state.busy = true;
  state.selected = null;
  ui.finalScoreValue.textContent = state.credits.toLocaleString();
  ui.finalMovesValue.textContent = successfulMoves.toLocaleString();
  const line = RUN_END_COPY[kind];
  if (ui.runEndReason) ui.runEndReason.textContent = line;
  ui.runEndModal.removeAttribute("hidden");
  showToast(ui.toast, line);
}

/**
 * Spend credits for attempting a swap.
 * We apply the cost immediately, but only end the run when the move produces no credits
 * (or after cascades resolve), so the player isn't "killed" mid-resolution.
 */
function canAffordSwap() {
  return state.credits >= SWAP_COST;
}

function spendSwapCost() {
  if (!canAffordSwap()) return false;
  state.credits = clampNonNegative(state.credits - SWAP_COST);
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

let isChartHidden = false;
function setChartHidden(hidden) {
  isChartHidden = hidden;
  if (ui.handChart) {
    ui.handChart.classList.toggle("is-collapsed", hidden);
    ui.handChart.setAttribute("aria-hidden", hidden ? "true" : "false");
  }
  if (ui.toggleChartBtn) ui.toggleChartBtn.textContent = hidden ? "Show hands" : "Hide hands";
  if (ui.toggleChartBtn2) ui.toggleChartBtn2.textContent = hidden ? "Show" : "Hide";
  if (!hidden && MOBILE_MQ.matches && ui.handChart) {
    requestAnimationFrame(() => {
      ui.handChart.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }
}

function updateHud() {
  const target = Math.max(0, Math.floor(state.credits));
  animateCreditsTo(target);
}

let creditsDisplayValue = Math.max(0, Math.floor(state.credits));
let creditsAnimRaf = /** @type {number|null} */ (null);
let creditsAnimTo = creditsDisplayValue;

function setCreditsInstant(n) {
  const v = Math.max(0, Math.floor(n));
  if (creditsAnimRaf != null) cancelAnimationFrame(creditsAnimRaf);
  creditsAnimRaf = null;
  creditsAnimTo = v;
  creditsDisplayValue = v;
  ui.totalScoreBig.textContent = v.toLocaleString();
}

/**
 * Animate TOTAL CREDITS value to the next target.
 * @param {number} to
 */
function animateCreditsTo(to) {
  // If this is the first render, snap.
  if (!ui.totalScoreBig.textContent || ui.totalScoreBig.textContent.trim() === "0") {
    creditsDisplayValue = to;
    creditsAnimTo = to;
    ui.totalScoreBig.textContent = to.toLocaleString();
    return;
  }

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
    ui.totalScoreBig.textContent = v.toLocaleString();
    if (p < 1) creditsAnimRaf = requestAnimationFrame(tick);
    else {
      creditsAnimRaf = null;
      creditsDisplayValue = currentTo;
      ui.totalScoreBig.textContent = currentTo.toLocaleString();
    }
  };

  creditsAnimRaf = requestAnimationFrame(tick);
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
  updateHud();
  positionScoreFeed();
}

function positionScoreFeed() {
  /* Credits + how-to live in document flow; nothing to position. */
}

const MOBILE_MQ = window.matchMedia("(max-width: 720px)");

let isHowToHidden = false;

function setHowToHidden(hidden) {
  isHowToHidden = hidden;
  if (ui.creditDock) {
    ui.creditDock.classList.toggle("is-howto-collapsed", hidden);
    if (hidden) ui.creditDock.setAttribute("aria-hidden", "true");
    else ui.creditDock.removeAttribute("aria-hidden");
  }
  if (ui.toggleHowToBtn) {
    ui.toggleHowToBtn.textContent = hidden ? "Show tips" : "Hide tips";
    ui.toggleHowToBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
  }
}

function syncHowToPanelForViewport() {
  if (MOBILE_MQ.matches) setHowToHidden(false);
}

function syncMobileViewportClass() {
  document.documentElement.classList.toggle("is-mobile", MOBILE_MQ.matches);
  syncHowToPanelForViewport();
  positionScoreFeed();
}

if (MOBILE_MQ.matches) setChartHidden(true);

ui.toggleHowToBtn?.addEventListener("click", () => {
  if (MOBILE_MQ.matches) return;
  setHowToHidden(!isHowToHidden);
});

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
  successfulMoves = 0;
  ui.runEndModal.setAttribute("hidden", "");
  newGame(state);
  // Keep main/gameState.js in sync for the starting bankroll.
  state.credits = STARTING_POINTS;
  showToast(ui.toast, "New deal");
  rerender();
  showCenterTip("Swap any 2 cards to make vertical or horizontal poker hands");
  checkCantAffordSwapAndEnd();
});

for (const btn of [ui.toggleChartBtn, ui.toggleChartBtn2]) {
  if (!btn) continue;
  btn.addEventListener("click", () => setChartHidden(!isChartHidden));
}

ui.restartBtn.addEventListener("click", () => {
  successfulMoves = 0;
  ui.runEndModal.setAttribute("hidden", "");
  newGame(state);
  state.credits = STARTING_POINTS;
  rerender();
  showCenterTip("Swap any 2 cards to make vertical or horizontal poker hands");
  checkCantAffordSwapAndEnd();
});

ui.hintBtn.addEventListener("click", async () => {
  if (state.busy) return;

  // Hints cost credits (discourage spam).
  state.credits = clampNonNegative(state.credits - HINT_COST);
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
  viewFx.hint = new Set([`${move.a.r},${move.a.c}`, `${move.b.r},${move.b.c}`]);
  rerender();
  setTimeout(() => {
    if (state.busy) return;
    viewFx.hint = null;
    rerender();
  }, 1500);
});

ui.helpBtn.addEventListener("click", () => {
  const isHidden = ui.rulesPanel.hasAttribute("hidden");
  if (isHidden) ui.rulesPanel.removeAttribute("hidden");
  else ui.rulesPanel.setAttribute("hidden", "");
});

function getCellPosFromEl(el) {
  const r = Number(el?.dataset?.r);
  const c = Number(el?.dataset?.c);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return { r, c };
}

function cellAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el ? el.closest?.(".cell") : null;
  return /** @type {HTMLElement|null} */ (cell);
}

// Drag-to-swap support (mouse + touch via Pointer Events).
let dragPointerId = /** @type {number|null} */ (null);
let dragStartPos = /** @type {{r:number,c:number}|null} */ (null);
let dragStartX = 0;
let dragStartY = 0;
let dragIsActive = false;

ui.board.addEventListener("pointerdown", (e) => {
  if (state.busy) return;
  if (e.button != null && e.button !== 0) return;
  const target = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target : null);
  const cell = target ? target.closest(".cell") : null;
  if (!cell) return;
  // Avoid starting a drag when clicking UI overlays.
  if (!(cell instanceof HTMLElement)) return;

  dragPointerId = e.pointerId;
  dragStartPos = getCellPosFromEl(cell);
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragIsActive = false;

  try {
    cell.setPointerCapture(e.pointerId);
  } catch {
    // ignore
  }
});

ui.board.addEventListener("pointermove", (e) => {
  if (dragPointerId == null || e.pointerId !== dragPointerId) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  const dist = Math.hypot(dx, dy);
  if (!dragIsActive && dist < 8) return;
  dragIsActive = true;

  const start = dragStartPos;
  if (!start) return;
  const cell = /** @type {HTMLElement|null} */ (ui.board.querySelector(`.cell[data-r="${start.r}"][data-c="${start.c}"]`));
  if (!cell) return;
  const face = /** @type {HTMLElement|null} */ (cell.querySelector(".cardFace"));
  if (!face) return;

  cell.classList.add("is-dragging");
  face.style.transform = `translate(${dx}px, ${dy}px)`;
});

async function finishDrag(e) {
  if (dragPointerId == null || e.pointerId !== dragPointerId) return;
  const start = dragStartPos;
  dragPointerId = null;
  dragStartPos = null;

  if (!start) return;
  const startCell = /** @type {HTMLElement|null} */ (ui.board.querySelector(`.cell[data-r="${start.r}"][data-c="${start.c}"]`));
  const startFace = startCell ? startCell.querySelector(".cardFace") : null;
  if (startCell) startCell.classList.remove("is-dragging");
  if (startFace instanceof HTMLElement) startFace.style.transform = "";

  // If it wasn't really a drag, let normal click handler run.
  if (!dragIsActive) return;
  dragIsActive = false;

  const over = cellAtPoint(e.clientX, e.clientY);
  const endPos = over ? getCellPosFromEl(over) : null;
  if (!endPos) return;
  if (endPos.r === start.r && endPos.c === start.c) return;

  // Perform a swap like the normal tap flow.
  await onDragSwap(start, endPos);
}

ui.board.addEventListener("pointerup", (e) => finishDrag(e));
ui.board.addEventListener("pointercancel", (e) => finishDrag(e));

async function onDragSwap(a, b) {
  if (state.busy) return;
  dismissCenterTip();
  if (checkCantAffordSwapAndEnd()) return;
  if (!spendSwapCost()) {
    endRun("bankrupt");
    rerender();
    return;
  }
  state.busy = true;
  await swapWithFlipAnimation(a, b);
  sfx.swapSuccess();
  successfulMoves += 1;
  await resolveCascades();
  if (checkCantAffordSwapAndEnd()) return;
  state.busy = false;
  rerender();
}

function isMobileLayout() {
  return document.documentElement.classList.contains("is-mobile");
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
  const msCap = isMobileLayout() ? 520 : 640;
  const ms = Math.max(200, Math.min(msCap, 200 + dist * (isMobileLayout() ? 42 : 55)));

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
  const msCap = isMobileLayout() ? 520 : 640;
  const ms = Math.max(200, Math.min(msCap, 200 + dist * (isMobileLayout() ? 42 : 55)));

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
    setTimeout(finish, ms + 120);
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
  pop.textContent = opts.variant === "zero" ? "0" : `+${value}`;

  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
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

function handRarityFontPx(type) {
  switch (type) {
    case HAND_TYPE.TWO_PAIR:
      return 22;
    case HAND_TYPE.THREE_OF_A_KIND:
      return 24;
    case HAND_TYPE.STRAIGHT:
      return 26;
    case HAND_TYPE.FLUSH:
      return 28;
    case HAND_TYPE.FULL_HOUSE:
      return 30;
    case HAND_TYPE.FOUR_OF_A_KIND:
      return 34;
    case HAND_TYPE.STRAIGHT_FLUSH:
      return 40;
    case HAND_TYPE.ROYAL_FLUSH:
      return 56;
    default:
      return 22;
  }
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

function showHandBurst({ label, type, credits }) {
  const host = ui.board.parentElement;
  if (!host) return;
  const rect = ui.board.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const n = document.createElement("div");
  n.className = "handBurst";
  if (type === HAND_TYPE.ROYAL_FLUSH) n.classList.add("handBurst--royal");
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  const labelPx = handRarityFontPx(type);
  const amt = Math.max(0, Math.floor(Number(credits) || 0));
  n.innerHTML = `<div class="handBurst__label" style="font-size:${labelPx}px">${label}</div><div class="handBurst__credits">+${amt.toLocaleString()}</div>`;
  host.append(n);
  requestAnimationFrame(() => n.classList.add("is-showing"));

  if (type === HAND_TYPE.ROYAL_FLUSH) burstRoyalGold(x, y, 1.2);
  else if (type === HAND_TYPE.STRAIGHT_FLUSH) burstRoyalGold(x, y, 0.35);
  else if ((HAND_PRIORITY[type] ?? 0) >= (HAND_PRIORITY[HAND_TYPE.FULL_HOUSE] ?? 6)) burstGoldWin(x, y, 0.9);
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

function showBigWin(amount) {
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
  // Index matches tier: [2500–4999), default, [5000–10000), 10000+
  const phrases = ["NICE WIN!", "GOOD RUN!", "MONSTER WIN!", "JACKPOT!"];
  const phraseIdx = to >= 10000 ? 3 : to >= 5000 ? 2 : to >= 2500 ? 0 : 1;
  n.innerHTML = `<div class="bigWinBurst__title">${phrases[phraseIdx]}</div><div class="bigWinBurst__value">+0</div>`;
  host.append(n);
  requestAnimationFrame(() => n.classList.add("is-showing"));

  const valueEl = n.querySelector(".bigWinBurst__value");
  const duration = 1900; // slower count-up
  const start = performance.now();
  const from = Math.max(0, Math.floor(to * (0.72 + Math.random() * 0.18)));
  if (valueEl) valueEl.textContent = `+${from.toLocaleString()}`;

  const tick = (t) => {
    const p = Math.min(1, (t - start) / duration);
    // Ease out so it feels like a jackpot meter.
    const e = 1 - Math.pow(1 - p, 2.35);
    const v = Math.floor(from + (to - from) * e);
    if (valueEl) valueEl.textContent = `+${v.toLocaleString()}`;
    if (p < 1) requestAnimationFrame(tick);
    else if (valueEl) valueEl.textContent = `+${to.toLocaleString()}`;
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
  const cards = line.cells.map((p) => board[p.r][p.c]).filter(Boolean);
  if (cards.length !== 5) {
    return { contrib: new Set(), dim: new Set(), contribCells: [] };
  }

  const evald = evaluateHand(cards);
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

  for (const p of line.cells) {
    const card = board[p.r][p.c];
    const k = `${p.r},${p.c}`;
    if (!card) continue;
    const v = rankToValue14(card.rank);
    const isContrib = values == null ? true : values.has(v);
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
  let pipSum = 0;
  for (const p of contribCells) {
    const card = board[p.r][p.c];
    if (!card) continue;
    pipSum += cardBaseValue(card.rank);
  }
  return pipSum * handMultiplier(line.type);
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
      const lines = findScoringLines(board, baseScoreForType, SCORE_OPTS);
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
 * @param {{ kind:"row"|"col", cells:{r:number,c:number}[] }} line
 */
async function pulseScoredLine(line, combo, contribCells, dimCells, onTotal, handBurstEl) {
  // DOM nodes exist only after a render.
  const ordered = contribCells; // only scoring cards
  /** @type {HTMLElement[]} */
  const valuePops = [];
  let running = 0;
  let i = 0;
  const dimKeySet = new Set(dimCells.map((p) => `${p.r},${p.c}`));

  if (handBurstEl) valuePops.push(handBurstEl);

  // Kickers: show grey 0 popups and keep them dimmed.
  for (const p of dimCells) {
    const pop = showCardValuePopup(p, 0, { variant: "zero" });
    if (pop) valuePops.push(pop);
  }

  for (const p of ordered) {
    const el = ui.board.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
    if (!el) continue;
    // Per-card value popup when it enlarges.
    const card = state.board[p.r]?.[p.c];
    if (card) {
      const v = cardBaseValue(card.rank);
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
    await sleep(60);
    i++;
  }
  // small tail so last pulse reads
  await sleep(60);

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
  // If a drag gesture just occurred, ignore the synthetic click.
  if (dragIsActive) return;
  dismissCenterTip();
  if (checkCantAffordSwapAndEnd()) return;
  // First interaction unlocks audio on most browsers.
  sfx.unlock();
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
  // End only if the player can no longer afford a swap.
  if (checkCantAffordSwapAndEnd()) return;
  state.busy = false;
  rerender();
}

async function resolveCascades() {
  // We keep a step counter for runaway protection, but scoring no longer uses it.
  state.comboStep = 0;
  state.lastHands = [];
  let gainedTotal = 0;
  // The single “breather” between a cascade landing and the next scoring check.
  // Tweak this number to change how fast scoring starts after a fill.
  const CASCADE_EVAL_DELAY_MS = 26;

  const MAX_COMBO = 80;
  while (state.comboStep < MAX_COMBO) {
    if (!state.deck) throw new Error("Deck not initialized");
    const lines = findScoringLines(state.board, baseScoreForType, SCORE_OPTS);
    if (lines.length === 0) break;
    if (state.comboStep >= MAX_COMBO - 1) {
      // Extremely unlikely, but prevents runaway auto-resolve.
      regenerateBoardForFairness(state, { maxAttempts: 2500 });
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
      const hm = handMultiplier(line.type);
      let pipSum = 0;
      for (const p of contribCells) {
        const card = state.board[p.r][p.c];
        if (card) pipSum += cardBaseValue(card.rank);
      }
      const lineScore = pipSum * hm;
      const gained = lineScore;

      const handBurstEl = showHandBurst({ label: line.label, type: line.type, credits: gained });
      // Ensure the line highlight is visible before the sequential grow starts.
      await sleep(45);
      await pulseScoredLine(line, 1, contribCells, dimCells, () => {}, handBurstEl);

      state.credits += gained;
      gainedTotal += gained;

      sfx.scoreHand(line.type, 1);
      rerender();

      viewFx.dim = null;

      // Delay between popups for multiple lines (and to let the popup breathe).
      await sleep(120);
    }

    // Now clear everything that scored this evaluation in one removal step.
    // (Cards can belong to both a scoring row and column; removed once.)
    viewFx.scoring = null;
    viewFx.scoredLines = null;
    viewFx.dim = null;
    viewFx.clearing = clearSetAll;
    rerender();
    await sleep(120);

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

    await sleep(70);

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
  }

  state.comboStep = 0;
  if (gainedTotal > 0 && gainedTotal >= 1000) showBigWin(gainedTotal);
}

syncMobileViewportClass();
MOBILE_MQ.addEventListener("change", () => {
  syncMobileViewportClass();
});
window.addEventListener("resize", () => positionScoreFeed());
rerender();

