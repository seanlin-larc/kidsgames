import { validPuzzleId } from "./library-data.js";

export const completionId = record => record.puzzleId + "-" + record.layoutKey;
export function validCompletion(r) {
  return r && validPuzzleId(r.puzzleId) && /^[a-f0-9]{64}$/.test(r.layoutKey) &&
    Number.isInteger(r.moves) && r.moves >= 0 && r.moves < 100000 &&
    Number.isFinite(r.solvedAt) && r.solvedAt > 0;
}

// Each account keeps its own durable pending records; only confirmed writes clear them.
export function createProgressStore({storage, uid, cloud}) {
  const key = "mrl-progress-v1:" + uid;
  let records = {};
  function absorbSaved() {
    try {
      const saved = JSON.parse(storage.getItem(key) || "[]");
      if (Array.isArray(saved)) for (const r of saved) if (validCompletion(r)) {
        const id = completionId(r), existing = records[id];
        if (!existing || (existing.pending && r.pending === false)) records[id] = r;
      }
    } catch (_) { /* An unreadable copy must not block play. */ }
  }
  absorbSaved();
  function persist() {
    // Preserve completions saved by another open tab before replacing the local copy.
    absorbSaved();
    const value = JSON.stringify(Object.values(records));
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) throw Error("This device could not retain your progress. Keep this page open and reconnect.");
  }
  let syncing = null;
  return {
    has(puzzleId, layoutKey) { absorbSaved(); return Object.hasOwn(records, completionId({puzzleId,layoutKey})); },
    get pending() { absorbSaved(); return Object.values(records).filter(r => r.pending).length; },
    complete(record) {
      absorbSaved();
      if (!validCompletion(record)) throw Error("Invalid completion record.");
      const id = completionId(record);
      if (!records[id]) records[id] = {...record, pending:true};
      persist();
    },
    sync() {
      if (syncing) return syncing;
      syncing = (async () => {
        const adapter = await cloud();
        const remote = await adapter.listCompletions(uid);
        for (const r of remote) if (validCompletion(r)) records[completionId(r)] = {...r, pending:false};
        persist();
        // Read pending records after the request: a puzzle may finish during the download.
        let r;
        while ((r = Object.values(records).find(r => r.pending))) {
          await adapter.saveCompletion(uid, r);
          records[completionId(r)] = {...r, pending:false};
          persist();
        }
      })().finally(() => { syncing = null; });
      return syncing;
    }
  };
}
