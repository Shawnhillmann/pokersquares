import { BOARD_SIZE } from "../game/board.js";
import { el } from "./dom.js";
import { isRedSuit, suitSymbol } from "../game/cards.js";

/**
 * Render board as a 5x5 CSS grid. Each cell is a button (keyboard focusable).
 * Cards are rendered with rank + suit symbol.
 *
 * For simplicity (prototype), we re-render the grid when state changes, but we
 * preserve per-card DOM nodes keyed by card.id to allow smooth transitions.
 */

/**
 * @typedef {{ id: string, rank: any, suit: any }} Card
 * @typedef {(Card|null)[][]} Board
 */

/**
 * @param {HTMLElement} root
 * @param {Board} board
 * @param {{ selected: {r:number,c:number}|null, clearing:Set<string>|null, scoring:Set<string>|null, dim:Set<string>|null, hint:Set<string>|null, dropRowsById?: Map<string,number>, dropMsById?: Map<string,number>, dropMode?: "gravity"|"refill" }} view
 * @param {(pos:{r:number,c:number})=>void} onCellClick
 */
export function renderBoard(root, board, view, onCellClick) {
  root.style.setProperty("--board-size", String(BOARD_SIZE));

  const ART_RANKS = new Set(["A", "J", "Q", "K"]);
  const CORNER_SUIT_RANKS = new Set(["J", "Q", "K"]);
  const cells = /** @type {HTMLButtonElement[]} */ (root.__cells ?? []);
  /** @type {{ id: string, el: HTMLElement }[]} */
  const breathCandidates = [];

  // Build fixed 5x5 button grid once; update in place to avoid image flicker on mobile Safari.
  if (cells.length !== BOARD_SIZE * BOARD_SIZE) {
    root.innerHTML = "";
    cells.length = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = /** @type {HTMLButtonElement} */ (el("button", "cell"));
        cell.type = "button";
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.addEventListener("click", () => onCellClick({ r, c }));
        root.append(cell);
        cells.push(cell);
      }
    }
    // @ts-ignore - stash on DOM node for reuse
    root.__cells = cells;
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const card = board[r][c];
      const cell = cells[r * BOARD_SIZE + c];
      cell.className = "cell";

      const selected = view.selected && view.selected.r === r && view.selected.c === c;
      if (selected) cell.classList.add("is-selected");
      if (view.hint && view.hint.has(`${r},${c}`)) cell.classList.add("is-hint");
      if (view.dim && view.dim.has(`${r},${c}`)) cell.classList.add("is-dim");
      if (view.clearing && view.clearing.has(`${r},${c}`)) cell.classList.add("is-clearing");

      if (!card) {
        cell.classList.add("is-empty");
        cell.removeAttribute("data-card-id");
        cell.style.removeProperty("--drop-rows");
        // Remove card shell (and any cached refs) when empty.
        const oldShell = /** @type {HTMLElement|null} */ (cell.__shell ?? cell.querySelector(".cardShell"));
        if (oldShell) oldShell.remove();
        // @ts-ignore
        cell.__shell = null;
        // @ts-ignore
        cell.__breath = null;
        // @ts-ignore
        cell.__face = null;
        // @ts-ignore
        cell.__corner = null;
        // @ts-ignore
        cell.__rank = null;
        // @ts-ignore
        cell.__cornerSuit = null;
        // @ts-ignore
        cell.__pip = null;
        // @ts-ignore
        cell.__faceImg = null;
      } else {
        cell.dataset.cardId = card.id;
        const dropRows = view.dropRowsById?.get(card.id) ?? 0;
        if (dropRows > 0) {
          cell.classList.add("is-dropping");
          cell.style.setProperty("--drop-rows", String(dropRows));
          const overrideMs = view.dropMsById?.get(card.id);
          const ms =
            typeof overrideMs === "number"
              ? overrideMs
              : Math.min(380, 150 + dropRows * 45);
          cell.style.setProperty("--drop-ms", `${ms}ms`);
        } else {
          cell.style.removeProperty("--drop-rows");
          cell.style.removeProperty("--drop-ms");
        }
        // Build shell/breath/face DOM once per cell; update in place to prevent SVG flicker.
        let shell = /** @type {HTMLElement|null} */ (cell.__shell ?? cell.querySelector(".cardShell"));
        let breath = /** @type {HTMLElement|null} */ (cell.__breath ?? cell.querySelector(".cardBreath"));
        let face = /** @type {HTMLElement|null} */ (cell.__face ?? cell.querySelector(".cardFace"));
        if (!shell || !breath || !face) {
          shell = el("div", "cardShell");
          breath = el("div", "cardBreath");
          face = el("div", "cardFace");
          breath.append(face);
          shell.append(breath);
          cell.append(shell);
          // @ts-ignore
          cell.__shell = shell;
          // @ts-ignore
          cell.__breath = breath;
          // @ts-ignore
          cell.__face = face;

          const corner = el("div", "cardCorner");
          const rankEl = el("div", "cardRank", "");
          corner.append(rankEl);

          const cornerSuit = el("div", "cardCornerSuit", "");
          corner.append(cornerSuit);

          const pipDiv = el("div", "cardPip", "");
          const img = /** @type {HTMLImageElement} */ (document.createElement("img"));
          img.className = "cardPip cardPip--faceArt";
          img.alt = "";
          img.draggable = false;
          img.decoding = "async";
          img.loading = "eager";
          img.addEventListener(
            "error",
            () => {
              // If a face SVG is missing, flip to text pip for this cell.
              // @ts-ignore
              cell.__pip = "pip";
              face.classList.remove("cardFace--faceArt", "cardFace--aceArt", "cardFace--jokerArt");
              if (img.parentElement) img.remove();
              if (!pipDiv.parentElement) face.append(corner, pipDiv);
            },
            { once: false }
          );

          face.append(corner, pipDiv);

          // @ts-ignore
          cell.__corner = corner;
          // @ts-ignore
          cell.__rank = rankEl;
          // @ts-ignore
          cell.__cornerSuit = cornerSuit;
          // @ts-ignore
          cell.__pipDiv = pipDiv;
          // @ts-ignore
          cell.__faceImg = img;
          // @ts-ignore
          cell.__pip = "pip";
        }

        // @ts-ignore
        const corner = cell.__corner;
        // @ts-ignore
        const rankEl = cell.__rank;
        // @ts-ignore
        const cornerSuit = cell.__cornerSuit;
        // @ts-ignore
        const pipDiv = cell.__pipDiv;
        // @ts-ignore
        const img = cell.__faceImg;

        face.className = "cardFace";
        const rankText = String(card.rank);
        const suit = String(card.suit);
        const isJoker = rankText === "JOKER";

        // Idle "breathing" animation lives on the breath wrapper only, so it never conflicts
        // with gameplay transforms (swap/cascade/scoring) on other nodes.
        // Keep per-card delay stable by deriving it from card.id.
        if (breath) {
          // We'll pick up to 7 cards total to breathe after the grid is updated.
          breath.classList.remove("can-breathe");
          breathCandidates.push({ id: card.id, el: breath });
          // @ts-ignore
          const prevFor = breath.dataset.breathForId;
          if (prevFor !== card.id) {
            // Hash card.id into a stable negative delay range [-5s, 0s).
            let h = 0;
            for (let i = 0; i < card.id.length; i++) h = (h * 31 + card.id.charCodeAt(i)) | 0;
            const ms = Math.abs(h) % 5000;
            breath.style.setProperty("--breath-delay", `${-ms}ms`);
            // @ts-ignore
            breath.dataset.breathForId = card.id;
          }
        }

        // Joker should be image-only (no corner label).
        rankEl.textContent = isJoker ? "" : rankText;
        rankEl.classList.toggle("cardRank--ten", rankText === "10");
        const isJokerArt = isJoker;
        const isArt =
          (rankText === "J" || rankText === "Q" || rankText === "K" || isJokerArt) &&
          (isJokerArt || ["S", "H", "D", "C"].includes(suit));
        if (isArt) {
          cornerSuit.textContent =
            isJokerArt ? "" : CORNER_SUIT_RANKS.has(rankText) ? suitSymbol(card.suit) : "";
          face.classList.add(
            isJokerArt ? "cardFace--jokerArt" : "cardFace--faceArt"
          );
          const nextSrc = isJokerArt ? `/images/faces/Joker.svg` : `/images/faces/${rankText}${String(card.suit)}.svg`;
          // Only touch src if it actually changes (avoids iOS SVG repaint).
          const absoluteNext = `${location.origin}${nextSrc}`;
          if (img.src !== absoluteNext) img.src = nextSrc;

          // Ensure img is the active pip node.
          // @ts-ignore
          if (cell.__pip !== "img") {
            // Remove text pip if present, insert img.
            if (pipDiv.parentElement) pipDiv.remove();
            if (!img.parentElement) face.append(corner, img);
            // @ts-ignore
            cell.__pip = "img";
          }
        } else {
          cornerSuit.textContent = "";
          // Text suit pip.
          pipDiv.textContent = suitSymbol(card.suit);
          // @ts-ignore
          if (cell.__pip !== "pip") {
            if (img.parentElement) img.remove();
            if (!pipDiv.parentElement) face.append(corner, pipDiv);
            // @ts-ignore
            cell.__pip = "pip";
          }
        }

        if (!isJoker && isRedSuit(card.suit)) face.classList.add("is-red");
      }
    }
  }

  // Choose a stable "random" subset of cards (max 7) to breathe.
  // Deterministic per board state: we hash card.id, then pick the 7 lowest.
  const MAX_BREATH = 7;
  if (breathCandidates.length > 0) {
    const scored = breathCandidates
      .map((c) => {
        let h = 0;
        for (let i = 0; i < c.id.length; i++) h = (h * 31 + c.id.charCodeAt(i)) | 0;
        return { el: c.el, score: h >>> 0 };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_BREATH);
    for (const s of scored) s.el.classList.add("can-breathe");
  }
}

/**
 * Draw overlay lines for scored rows/cols.
 * @param {HTMLElement} layer
 * @param {{ kind:"row"|"col"|"diagDown"|"diagUp", index:number, label:string }[]|null} scoredLines
 */
export function renderScoredLines(layer, scoredLines) {
  layer.innerHTML = "";
  if (!scoredLines || scoredLines.length === 0) return;

  for (const l of scoredLines) {
    const line = el("div", `scoreLine scoreLine--${l.kind}`);
    if (l.kind === "row" || l.kind === "col") line.style.setProperty("--i", String(l.index));
    line.title = l.label;
    layer.append(line);
  }
}

/**
 * @param {HTMLElement} toast
 * @param {string} text
 */
export function showToast(toast, text) {
  toast.textContent = text;
  toast.classList.remove("is-showing");
  // force reflow
  // eslint-disable-next-line no-unused-expressions
  toast.offsetHeight;
  toast.classList.add("is-showing");
}

