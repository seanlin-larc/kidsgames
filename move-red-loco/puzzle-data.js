// Shared validation for JSON files, device saves, and restored drafts.
export const FORMAT = "move-red-loco-editor-v1";
export const TEMPLATES = Object.freeze({
  red:      { type:"red",      w:2, h:1, axis:"h",    color:"red",    label:"RED", name:"Red locomotive" },
  h2:       { type:"h2",       w:2, h:1, axis:"h",    color:"blue",   label:"H2",  name:"Short train" },
  v2:       { type:"v2",       w:1, h:2, axis:"v",    color:"green",  label:"V2",  name:"Vertical train" },
  h3:       { type:"h3",       w:3, h:1, axis:"h",    color:"gold",   label:"H3",  name:"Long train" },
  v3:       { type:"v3",       w:1, h:3, axis:"v",    color:"purple", label:"V3",  name:"Tall train" },
  platform: { type:"platform", w:2, h:2, axis:"both", color:"slate", label:"P",   name:"Square platform" }
});
export const TIERS = Object.freeze(["Starter","Beginner","Amateur","Pro","Freak"]);
const LEGACY_TIERS = Object.freeze({ Intermediate:"Amateur", Medium:"Amateur", Hard:"Pro", Crazy:"Freak" });
export const normalizeTier = tier => Object.hasOwn(LEGACY_TIERS, tier) ? LEGACY_TIERS[tier] : tier;
export const validBlockHue = hue => Number.isInteger(hue) && hue >= 16 && hue <= 344;

// Missing red is allowed in a draft. Play and Test validate complete puzzles separately.
export function normalizePuzzleData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || data.format !== FORMAT ||
      !TIERS.includes(normalizeTier(data.difficulty)) || !Array.isArray(data.pieces) || data.pieces.length > 35) {
    throw Error("Not a supported puzzle file.");
  }
  if (data.exitRow !== undefined && ![2,3].includes(data.exitRow)) {
    throw Error("Select the upper or lower exit.");
  }
  const ids = new Set(), pieces = [];
  for (const p of data.pieces) {
    if (!p || typeof p !== "object" || !Object.hasOwn(TEMPLATES, p.type)) throw Error("Invalid puzzle block.");
    const t = TEMPLATES[p.type];
    const suffix = typeof p.id === "string" && p.id.match(/^(?:h2|v2|h3|v3|platform)-([0-9]+)$/)?.[1];
    const number = Number(suffix);
    if (typeof p.id !== "string" || p.id.length > 45 || ids.has(p.id) ||
        (p.type === "red" ? p.id !== "red" : !suffix || !Number.isSafeInteger(number) || number < 1 || number >= Number.MAX_SAFE_INTEGER) ||
        ![p.x,p.y,p.w,p.h].every(Number.isInteger) ||
        ((p.w === t.w && p.h === t.h) ? p.axis !== t.axis :
         (p.type === "red" || p.type === "platform" || p.w !== t.h || p.h !== t.w || p.axis !== (t.axis === "h" ? "v" : "h")))) {
      throw Error("Invalid puzzle block.");
    }
    if (p.type !== "red" && p.hue !== undefined && !validBlockHue(p.hue)) throw Error("Block hue must be 16–344°.");
    if (p.x < 0 || p.y < 0 || p.x + p.w > 7 || p.y + p.h > 7 ||
        (p.type === "red" && ![2,3].includes(p.y)) ||
        pieces.some(q => p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y)) {
      throw Error("Puzzle blocks overlap or leave the board.");
    }
    ids.add(p.id);
    pieces.push({ id:p.id, type:p.type, x:p.x, y:p.y, w:p.w, h:p.h, axis:p.axis,
      ...(typeof p.label === "string" ? { label:p.label } : {}),
      ...(p.type !== "red" && p.hue !== undefined ? { hue:p.hue } : {}) });
  }
  // Preserve the established legacy import policy: X determines the active exit.
  return { format:FORMAT, difficulty:normalizeTier(data.difficulty),
    exitRow:pieces.find(p => p.id === "red")?.y ?? data.exitRow ?? 2, pieces };
}

export function nextPieceId(pieces) {
  // Find an unused small suffix instead of trusting saved counters or adding to large IDs.
  const used = new Set(pieces.filter(p => p.id !== "red").map(p => Number(p.id.match(/([0-9]+)$/)[1])));
  let next = 1;
  while (used.has(next)) next++;
  return next;
}

// localStorage has no multi-key transaction. Restore both prior values after a failed write.
export function writeDraft(storage, key, draft) {
  const data = JSON.stringify(draft);
  const keys = [key + ":" + draft.difficulty.toLowerCase(), key];
  const before = keys.map(k => storage.getItem(k));
  try {
    for (const k of keys) storage.setItem(k, data);
    if (keys.some(k => storage.getItem(k) !== data)) throw Error("The device did not retain the save.");
  } catch (error) {
    let restored = true;
    keys.forEach((k, i) => {
      try {
        if (before[i] === null) storage.removeItem(k);
        else storage.setItem(k, before[i]);
        if (storage.getItem(k) !== before[i]) restored = false;
      } catch (_) { restored = false; }
    });
    throw Error(restored ? "Save failed. Previous saves were kept." : "Save failed. Previous saves could not be fully restored.", { cause:error });
  }
}
