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
 * @param {{ selected: {r:number,c:number}|null, clearing:Set<string>|null, scoring:Set<string>|null, dim:Set<string>|null, hint:Set<string>|null, dropRowsById?: Map<string,number> }} view
 * @param {(pos:{r:number,c:number})=>void} onCellClick
 */
export function renderBoard(root, board, view, onCellClick) {
  root.style.setProperty("--board-size", String(BOARD_SIZE));

  const FACE_RANKS = new Set(["J", "Q", "K"]);
  const cells = /** @type {HTMLButtonElement[]} */ (root.__cells ?? []);

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
        const oldFace = cell.querySelector(".cardFace");
        if (oldFace) oldFace.remove();
      } else {
        cell.dataset.cardId = card.id;
        const dropRows = view.dropRowsById?.get(card.id) ?? 0;
        if (dropRows > 0) {
          cell.classList.add("is-dropping");
          cell.style.setProperty("--drop-rows", String(dropRows));
        } else {
          cell.style.removeProperty("--drop-rows");
        }
        let face = /** @type {HTMLElement|null} */ (cell.querySelector(".cardFace"));
        if (!face) {
          face = el("div", "cardFace");
          cell.append(face);
        } else {
          face.className = "cardFace";
          face.innerHTML = "";
        }

        const rankText = String(card.rank);
        const corner = el("div", "cardCorner");
        const rank = el("div", "cardRank", rankText);
        if (rankText === "10") rank.classList.add("cardRank--ten");
        corner.append(rank);

        /** @type {HTMLElement} */
        let pip;
        if (FACE_RANKS.has(rankText) && ["S", "H", "D", "C"].includes(String(card.suit))) {
          const cornerSuit = el("div", "cardCornerSuit", suitSymbol(card.suit));
          corner.append(cornerSuit);
          face.classList.add("cardFace--faceArt");
          const img = /** @type {HTMLImageElement} */ (
            face.querySelector("img.cardPip--faceArt") ?? document.createElement("img")
          );
          img.className = "cardPip cardPip--faceArt";
          const nextSrc = `/images/faces/${rankText}${String(card.suit)}.svg`;
          if (img.src !== `${location.origin}${nextSrc}`) img.src = nextSrc;
          img.alt = "";
          img.draggable = false;
          img.onerror = () => {
            const fallback = el("div", "cardPip", suitSymbol(card.suit));
            img.replaceWith(fallback);
          };
          pip = img;
          /* SVG: portrait only; HTML supplies corner rank + suit */
          face.append(corner, pip);
        } else {
          pip = el("div", "cardPip", suitSymbol(card.suit));
          face.append(corner, pip);
        }
        if (isRedSuit(card.suit)) face.classList.add("is-red");
      }
    }
  }
}

/**
 * Draw overlay lines for scored rows/cols.
 * @param {HTMLElement} layer
 * @param {{ kind:"row"|"col", index:number, label:string }[]|null} scoredLines
 */
export function renderScoredLines(layer, scoredLines) {
  layer.innerHTML = "";
  if (!scoredLines || scoredLines.length === 0) return;

  for (const l of scoredLines) {
    const line = el("div", `scoreLine scoreLine--${l.kind}`);
    line.style.setProperty("--i", String(l.index));
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

