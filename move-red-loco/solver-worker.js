import { solvePuzzle } from "./solver.js";

self.addEventListener("message", event => {
  const { requestId, pieces } = event.data;
  try {
    const result = solvePuzzle(pieces, undefined, progress => {
      self.postMessage({ requestId, type: "progress", progress });
    });
    self.postMessage({ requestId, type: "complete", result });
  } catch (error) {
    self.postMessage({ requestId, type: "complete", result: { status: "error", message: String(error) } });
  }
});
