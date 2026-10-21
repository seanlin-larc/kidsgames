import { normalizeLibraryPuzzle } from "./library-data.js";
import { validatePuzzle } from "./solver.js";
import { attemptSlide, attemptExit } from "./play-rules.js";

const copy = value => structuredClone(value);

// Names, tiers, piece IDs, letters and colours do not change the movement challenge.
export async function layoutKey(puzzle) {
  const shapes = puzzle.pieces.map(p => [p.id === "red" ? "red" : "block", p.x, p.y, p.w, p.h, p.axis]);
  shapes.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  const bytes = new TextEncoder().encode(JSON.stringify([puzzle.exitRow, shapes]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
}

export function createAttempt(value) {
  const puzzle = normalizeLibraryPuzzle(value);
  const errors = validatePuzzle(puzzle.pieces, puzzle.exitRow);
  if (errors.length) throw Error(errors.join(" "));
  let pieces, history, cursor;
  const won = () => attemptExit(pieces, puzzle.exitRow).status === "won";
  function restart() { pieces = copy(puzzle.pieces); history = []; cursor = 0; }
  restart();
  return {
    get pieces() { return copy(pieces); },
    get moves() { return cursor; },
    get won() { return won(); },
    get canUndo() { return cursor > 0 && !won(); },
    get canRedo() { return cursor < history.length && !won(); },
    get history() { return copy(history.slice(0, cursor)); },
    restart,
    slide(id, dx, dy) {
      if (won()) return false;
      const before = copy(pieces), piece = pieces.find(p => p.id === id);
      const result = attemptSlide(pieces, id, dx, dy, puzzle.exitRow);
      if (!piece || result.status !== "moved") return false;
      const x = result.x - piece.x, y = result.y - piece.y;
      piece.x = result.x; piece.y = result.y;
      const direction = x > 0 ? "right" : x < 0 ? "left" : y > 0 ? "down" : "up";
      history = history.slice(0, cursor);
      history.push({ id, label:piece.label || id, direction, cells:Math.abs(x || y), before, after:copy(pieces) });
      cursor++;
      return true;
    },
    undo() { if (!this.canUndo) return false; pieces = copy(history[--cursor].before); return true; },
    redo() { if (!this.canRedo) return false; pieces = copy(history[cursor++].after); return true; }
  };
}
