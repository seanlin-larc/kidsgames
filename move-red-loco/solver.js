// Move The Red Locomotive: deterministic layout validator and shortest-slide solver.
// One translation of any distance along a valid axis = one move; exiting = one move.
// Each puzzle selects exactly one right-side gate: J5 (board row 3) or J6 (row 4).
export const BOARD_SIZE = 7;
export const EXIT_ROWS = [2, 3];
export const MAX_STATES = 200000;

export function validatePuzzle(pieces, exitRow) {
  const errors = [];
  if (!EXIT_ROWS.includes(exitRow)) errors.push("Select exactly one exit: J5 or J6.");
  const occupancy = Array(49).fill(null);
  if (!Array.isArray(pieces)) return ["Puzzle data is not an array."];
  const seen = new Set();
  let redCount = 0;
  for (const p of pieces) {
    if (!p || typeof p.id !== "string" || !p.id || seen.has(p.id)) {
      errors.push("Every piece needs a unique ID.");
      continue;
    }
    seen.add(p.id);
    if (![p.x, p.y, p.w, p.h].every(Number.isInteger) ||
        p.x < 0 || p.y < 0 || p.w < 1 || p.h < 1 ||
        p.x + p.w > 7 || p.y + p.h > 7) {
      errors.push(p.id + " is outside the board.");
      continue;
    }
    if (!["h", "v", "both"].includes(p.axis)) errors.push(p.id + " has an invalid movement axis.");
    if (p.axis === "h" && p.h !== 1) errors.push(p.id + " must be horizontal.");
    if (p.axis === "v" && p.w !== 1) errors.push(p.id + " must be vertical.");
    if (p.axis === "both" && (p.w !== 2 || p.h !== 2)) errors.push(p.id + " must be a 2×2 platform.");
    if (p.id === "red") {
      redCount++;
      if (p.w !== 2 || p.h !== 1 || p.axis !== "h" || !EXIT_ROWS.includes(p.y)) {
        errors.push("The red locomotive must be horizontal on exit row 3 or 4.");
      }
    }
    for (let yy = p.y; yy < p.y + p.h; yy++) {
      for (let xx = p.x; xx < p.x + p.w; xx++) {
        const index = yy * 7 + xx;
        if (occupancy[index]) errors.push(p.id + " overlaps " + occupancy[index] + ".");
        occupancy[index] = p.id;
      }
    }
  }
  if (redCount !== 1) errors.push("Place exactly one red locomotive.");
  return [...new Set(errors)];
}

export function solvePuzzle(pieces, exitRow, maxStates = MAX_STATES, onProgress = () => {}) {
  const errors = validatePuzzle(pieces, exitRow);
  if (errors.length) return { status: "invalid", errors };
  const models = pieces.map(p => ({ id: p.id, w: p.w, h: p.h, axis: p.axis }));
  const start = pieces.map(p => p.y * 7 + p.x);
  const redIndex = models.findIndex(p => p.id === "red");
  const keyOf = pos => pos.join(",");
  const queue = [{ positions: start, depth: 0, parent: -1, move: null }];
  const visited = new Set([keyOf(start)]);
  const occupancy = new Uint8Array(49);

  for (let head = 0; head < queue.length; head++) {
    if (head >= maxStates) return { status: "limit", visited: visited.size, maxStates };
    const node = queue[head], positions = node.positions;
    occupancy.fill(0);
    for (let i = 0; i < models.length; i++) {
      const p = models[i], x = positions[i] % 7, y = Math.floor(positions[i] / 7);
      for (let yy = y; yy < y + p.h; yy++) {
        for (let xx = x; xx < x + p.w; xx++) occupancy[yy * 7 + xx] = i + 1;
      }
    }

    // The locomotive may exit in one horizontal move when the entire right corridor is clear.
    const rx = positions[redIndex] % 7, ry = Math.floor(positions[redIndex] / 7);
    if (ry === exitRow) {
      let clear = true;
      for (let x = rx + models[redIndex].w; x < 7; x++) {
        if (occupancy[ry * 7 + x]) { clear = false; break; }
      }
      if (clear) {
        const solution = [{ id: "red", direction: "exit", cells: 7 - rx - models[redIndex].w + 1 }];
        let at = head;
        while (queue[at].parent !== -1) {
          solution.push(queue[at].move);
          at = queue[at].parent;
        }
        solution.reverse();
        return { status: "solved", steps: solution.length, visited: visited.size, solution };
      }
    }

    for (let i = 0; i < models.length; i++) {
      const p = models[i], x0 = positions[i] % 7, y0 = Math.floor(positions[i] / 7);
      const dirs = p.axis === "both" ? [[1,0],[-1,0],[0,1],[0,-1]]
        : p.axis === "h" ? [[1,0],[-1,0]] : [[0,1],[0,-1]];
      for (const [dx, dy] of dirs) {
        for (let distance = 1; distance < 7; distance++) {
          const x = x0 + dx * distance, y = y0 + dy * distance;
          if (x < 0 || y < 0 || x + p.w > 7 || y + p.h > 7) break;
          let blocked = false;
          for (let yy = y; yy < y + p.h && !blocked; yy++) {
            for (let xx = x; xx < x + p.w; xx++) {
              const occupant = occupancy[yy * 7 + xx];
              if (occupant && occupant !== i + 1) { blocked = true; break; }
            }
          }
          if (blocked) break;
          const next = positions.slice();
          next[i] = y * 7 + x;
          const key = keyOf(next);
          if (visited.has(key)) continue;
          visited.add(key);
          queue.push({
            positions: next, depth: node.depth + 1, parent: head,
            move: { id: p.id, direction: dx ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"), cells: distance }
          });
        }
      }
    }
    if (head && head % 10000 === 0) onProgress({ visited: visited.size, expanded: head });
  }
  return { status: "unsolvable", visited: visited.size };
}
