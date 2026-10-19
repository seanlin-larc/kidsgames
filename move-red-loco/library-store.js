import { FORMAT, normalizePuzzleData } from "./puzzle-data.js";
import { PUZZLE_FORMAT, normalizeLibraryPuzzle, normalizeArchive, validPuzzleId, MAX_ARCHIVE_PUZZLES } from "./library-data.js";

const conflict = () => Object.assign(new Error("This puzzle changed on another device. Open the library again before saving."), {code:"app/conflict"});

// Adapter injection keeps transaction behavior testable without account credentials.
export function createLibraryStore(adapter) {
  async function player(creator = false) {
    const p = await adapter.player();
    if (!p || (creator && p.code !== "SL")) throw Object.assign(new Error("Only SL can save or restore puzzles."),{code:"permission-denied"});
    return p;
  }
  function content(title, layout) {
    if (typeof title !== "string" || !title.trim() || title.length > 80) throw Error("Enter a puzzle name (1–80 characters).");
    const clean = normalizePuzzleData(layout);
    // Validate complete archive fidelity without generating or changing existing appearance fields.
    const checked = normalizeLibraryPuzzle({id:"validation",title:title.trim(),...clean,
      format:PUZZLE_FORMAT,revision:1,createdAt:"2000-01-01T00:00:00.000Z",updatedAt:"2000-01-01T00:00:00.000Z"});
    return {format:PUZZLE_FORMAT,title:checked.title,difficulty:checked.difficulty,exitRow:checked.exitRow,pieces:checked.pieces};
  }
  async function listPuzzles() {
    await player();
    const records = await adapter.listFromServer();
    return records.map(normalizeLibraryPuzzle).sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  }
  async function savePuzzle({id,title,layout,expectedRevision = 0}) {
    const p = await player(true);
    if (!validPuzzleId(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        expectedRevision >= Number.MAX_SAFE_INTEGER - 1) throw Error("Invalid puzzle ID or revision.");
    const data = content(title, layout);
    return adapter.transact(async tx => {
      const old = await tx.get(id);
      if ((old?.revision ?? 0) !== expectedRevision) throw conflict();
      const revision = expectedRevision + 1;
      tx.set(id,{...data,revision,createdAt:old?.createdAt ?? adapter.timestamp(),
        updatedAt:adapter.timestamp(),createdBy:old?.createdBy ?? p.uid,updatedBy:p.uid});
      return {id,revision};
    });
  }
  async function restorePuzzles(plan) {
    const p = await player(true);
    if (!plan || !Array.isArray(plan.entries) || plan.entries.length > MAX_ARCHIVE_PUZZLES) throw Error("Invalid restore plan.");
    // Normalize the entire plan before the first transaction write.
    const entries = plan.entries.map(entry => {
      if (!Number.isSafeInteger(entry.expectedRevision) || entry.expectedRevision < 0 ||
          entry.expectedRevision >= Number.MAX_SAFE_INTEGER - 1) throw Error("Invalid restore revision.");
      return {puzzle:normalizeLibraryPuzzle(entry.puzzle),expectedRevision:entry.expectedRevision};
    });
    normalizeArchive({format:"move-red-loco-archive-v1",schemaVersion:1,exportedAt:new Date().toISOString(),
      puzzleCount:entries.length,puzzles:entries.map(e=>e.puzzle)});
    if (!entries.length) return {restored:0};
    return adapter.transact(async tx => {
      const previous = [];
      // Firestore requires all reads before any transaction writes.
      for (const entry of entries) {
        const old = await tx.get(entry.puzzle.id);
        if ((old?.revision ?? 0) !== entry.expectedRevision) throw conflict();
        previous.push(old);
      }
      entries.forEach((entry,index) => {
        const old = previous[index], puzzle = entry.puzzle;
        const data = content(puzzle.title,{...puzzle,format:FORMAT});
        tx.set(puzzle.id,{...data,revision:entry.expectedRevision+1,
          createdAt:old?.createdAt ?? adapter.timestamp(),updatedAt:adapter.timestamp(),
          createdBy:old?.createdBy ?? p.uid,updatedBy:p.uid});
      });
      return {restored:entries.length};
    });
  }
  return {listPuzzles,savePuzzle,restorePuzzles};
}
