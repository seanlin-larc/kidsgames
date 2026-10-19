// Pure one-axis movement for Build/Play workshop preview.
// A slide of any positive distance is one move. The UI completes a clear exit path automatically.
export function attemptSlide(pieces, id, dx, dy, exitRow) {
  const piece = pieces.find(p => p.id === id);
  if (!piece || !Number.isInteger(dx) || !Number.isInteger(dy) ||
      (dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) {
    return { status: "blocked" };
  }
  if ((dx && piece.axis === "v") || (dy && piece.axis === "h")) {
    return { status: "blocked" };
  }
  const vx = Math.sign(dx), vy = Math.sign(dy);
  const count = Math.abs(dx || dy);
  let x = piece.x, y = piece.y;
  for (let i = 0; i < count; i++) {
    const nx = x + vx, ny = y + vy;
    if (id === "red" && vx === 1 && y === exitRow && nx + piece.w > 7) {
      return { status: "won" };
    }
    if (nx < 0 || ny < 0 || nx + piece.w > 7 || ny + piece.h > 7) break;
    const collides = pieces.some(other => other.id !== id &&
      nx < other.x + other.w && nx + piece.w > other.x &&
      ny < other.y + other.h && ny + piece.h > other.y);
    if (collides) break;
    x = nx; y = ny;
  }
  return x === piece.x && y === piece.y
    ? { status: "blocked" }
    : { status: "moved", x, y };
}

export function attemptExit(pieces, exitRow) {
  const red = pieces.find(p => p.id === "red");
  if (!red || red.y !== exitRow) return { status: "blocked" };
  const distance = 8 - red.x - red.w;
  const result = attemptSlide(pieces, "red", distance, 0, exitRow);
  return result.status === "won" ? result : { status: "blocked" };
}

