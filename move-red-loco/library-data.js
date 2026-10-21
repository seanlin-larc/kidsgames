import { FORMAT, normalizePuzzleData, validBlockHue } from "./puzzle-data.js";

export const PUZZLE_FORMAT = "move-red-loco-puzzle-v1";
export const ARCHIVE_FORMAT = "move-red-loco-archive-v1";
export const MAX_ARCHIVE_PUZZLES = 200;
export const MAX_ARCHIVE_BYTES = 2_000_000;
export const validPuzzleId = id => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
const revisionOk = n => Number.isSafeInteger(n) && n >= 1 && n < Number.MAX_SAFE_INTEGER;
const isDate = value => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const copy = value => JSON.parse(JSON.stringify(value));

// Canonical cloud data must retain the exact labels, colors, and exit through an archive roundtrip.
export function normalizeLibraryPuzzle(value) {
  if (!value || typeof value !== "object" || value.format !== PUZZLE_FORMAT || !validPuzzleId(value.id) ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 80 ||
      !revisionOk(value.revision) || !isDate(value.createdAt) || !isDate(value.updatedAt) ||
      value.updatedAt < value.createdAt) throw Error("Invalid library puzzle metadata.");
  const layout = normalizePuzzleData({...value, format:FORMAT});
  if (layout.exitRow !== value.exitRow || layout.difficulty !== value.difficulty) {
    throw Error("Puzzle exit or difficulty is inconsistent.");
  }
  const pools = {red:"X",h2:"ABCDEFGHIJKL",v2:"ABCDEFGHIJKL",h3:"OPQRS",v3:"OPQRS",platform:"UV"};
  const labels = new Set();
  for (const p of layout.pieces) {
    if (typeof p.label !== "string" || p.label.length !== 1 || !pools[p.type].includes(p.label) || labels.has(p.label) ||
        (p.type !== "red" && !validBlockHue(p.hue))) throw Error("Puzzle letters or colors are invalid.");
    labels.add(p.label);
  }
  return {id:value.id,format:PUZZLE_FORMAT,title:value.title,
    difficulty:layout.difficulty,exitRow:layout.exitRow,pieces:layout.pieces,
    revision:value.revision,createdAt:value.createdAt,updatedAt:value.updatedAt};
}

export function makeArchive(puzzles, exportedAt = new Date().toISOString()) {
  return normalizeArchive({format:ARCHIVE_FORMAT,schemaVersion:1,exportedAt,puzzleCount:puzzles.length,puzzles});
}

export function normalizeArchive(value) {
  if (!value || typeof value !== "object" || value.format !== ARCHIVE_FORMAT || value.schemaVersion !== 1 ||
      !isDate(value.exportedAt) || !Array.isArray(value.puzzles) || value.puzzles.length > MAX_ARCHIVE_PUZZLES ||
      value.puzzleCount !== value.puzzles.length) throw Error("Not a supported puzzle archive (maximum 200 puzzles).");
  const ids = new Set();
  const puzzles = value.puzzles.map(p => {
    const clean = normalizeLibraryPuzzle(p);
    if (ids.has(clean.id)) throw Error("Archive contains duplicate puzzle IDs.");
    ids.add(clean.id);
    return clean;
  });
  const archive = {format:ARCHIVE_FORMAT,schemaVersion:1,exportedAt:value.exportedAt,puzzleCount:puzzles.length,puzzles};
  if (new TextEncoder().encode(JSON.stringify(archive)).length > MAX_ARCHIVE_BYTES) throw Error("Archive exceeds 2 MB.");
  return archive;
}

export function planRestore(archive, current, overwrite = false) {
  const clean = normalizeArchive(archive);
  const existing = new Map(current.map(p => {
    const normalized = normalizeLibraryPuzzle(p);
    return [normalized.id, normalized];
  }));
  const entries = [], skipped = [];
  for (const puzzle of clean.puzzles) {
    const old = existing.get(puzzle.id);
    if (old && !overwrite) skipped.push(puzzle.id);
    else entries.push({puzzle:copy(puzzle),expectedRevision:old?.revision ?? 0});
  }
  return {entries,skipped};
}

// Import adds copies only. IDs from a file never authorize replacing saved puzzles.
// Accept our single-layout export, a library puzzle, an archive, or an array of puzzles.
export function planLibraryImport(value, createId = () => crypto.randomUUID(), now = new Date().toISOString()) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_ARCHIVE_BYTES) throw Error("Import exceeds 2 MB.");
  const records = value?.format === ARCHIVE_FORMAT ? normalizeArchive(value).puzzles :
    Array.isArray(value) ? value : [value];
  if (!records.length || records.length > MAX_ARCHIVE_PUZZLES) throw Error("Import between 1 and 200 puzzles.");
  const puzzles = records.map(record => {
    if (record?.format === PUZZLE_FORMAT) return normalizeLibraryPuzzle(record);
    if (record?.format !== FORMAT) throw Error("Not a supported puzzle file or archive.");
    return normalizeLibraryPuzzle({...record,id:"import-validation",format:PUZZLE_FORMAT,
      title:record.title ?? "Imported puzzle",revision:1,createdAt:now,updatedAt:now});
  });
  const ids = new Set();
  const entries = puzzles.map(puzzle => {
    const id = createId();
    if (!validPuzzleId(id) || ids.has(id)) throw Error("Could not allocate unique puzzle IDs. Try importing again.");
    ids.add(id);
    return {puzzle:{...puzzle,id,revision:1,createdAt:now,updatedAt:now},expectedRevision:0};
  });
  return {entries,skipped:[]};
}
