import { validatePuzzle } from "./solver.js";
import { attemptSlide, attemptExit } from "./play-rules.js";
import { enterGame } from "../shared/gate.js";
import { TEMPLATES, TIERS, normalizePuzzleData, nextPieceId, validBlockHue, writeDraft } from "./puzzle-data.js";
import { LIBRARY_ENABLED } from "./library-config.js";
import { makeArchive, normalizeLibraryPuzzle, planLibraryImport, validPuzzleId, MAX_ARCHIVE_BYTES } from "./library-data.js";

// Device-wide appearance preference; independent of puzzle save and current player.
// Auto follows the OS theme immediately and reacts to subsequent OS changes.
const THEME_STORAGE_KEY = "mrl-theme";
// Cycle in the requested order: Light → Dark → Auto → Light.
const THEME_NEXT = Object.freeze({light:"dark",dark:"auto",auto:"light"});
const THEME_ICONS = Object.freeze({auto:"◐",dark:"☾",light:"☀"});
const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
function applyTheme(preference, persist = false) {
  const mode = Object.hasOwn(THEME_NEXT, preference) ? preference : "auto";
  const effective = mode === "auto" ? (systemTheme?.matches ? "dark" : "light") : mode;
  document.documentElement.dataset.themeSetting = mode;
  document.documentElement.dataset.theme = effective;
  const button = document.getElementById("themeBtn");
  button.querySelector(".theme-symbol").textContent = THEME_ICONS[mode];
  button.querySelector(".theme-name").textContent = mode[0].toUpperCase() + mode.slice(1);
  button.dataset.appearance = mode;
  const description = mode === "auto" ? "Auto (device currently " + effective + ")" : mode;
  button.title = "Appearance: " + description + ". Choose " + THEME_NEXT[mode] + ".";
  button.setAttribute("aria-label",button.title);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",
    effective === "light" ? "#e5eef7" : "#101c30");
  if (persist) {
    try {
      if (mode === "auto") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (_) { /* Storage can be unavailable in restricted/private sessions. */ }
  }
}
const currentTheme = document.documentElement.dataset.themeSetting || "auto";
applyTheme(currentTheme);
document.getElementById("themeBtn").addEventListener("click", () => {
  applyTheme(THEME_NEXT[document.documentElement.dataset.themeSetting] || "auto", true);
});
const onSystemThemeChange = () => {
  if (document.documentElement.dataset.themeSetting === "auto") applyTheme("auto");
};
if (systemTheme) {
  if (typeof systemTheme.addEventListener === "function") {
    systemTheme.addEventListener("change", onSystemThemeChange);
  } else if (typeof systemTheme.addListener === "function") {
    systemTheme.addListener(onSystemThemeChange);
  }
}

const board = document.getElementById("board");
const $ = id => document.getElementById(id);
function migrateTierSlots(key) {
  // Keep old slots untouched for safety; only create the replacement when absent.
  const oldSlots = {medium:"Amateur",intermediate:"Amateur",hard:"Pro",crazy:"Freak"};
  for (const [oldName, newTier] of Object.entries(oldSlots)) {
    const newKey = key + ":" + newTier.toLowerCase();
    if (localStorage.getItem(newKey) !== null) continue;
    const old = localStorage.getItem(key + ":" + oldName);
    if (!old) continue;
    try {
      const data = JSON.parse(old);
      const draft = preparePuzzleData({...data, difficulty:newTier});
      localStorage.setItem(newKey, JSON.stringify({...draft, nextId:nextPieceId(draft.pieces), savedAt:data.savedAt}));
    } catch (_) {
      // A malformed legacy slot must not stop login or overwrite another draft.
    }
  }
}
const LABEL_GROUPS = Object.freeze({
  red:"X", h2:"ABCDEFGHIJKL", v2:"ABCDEFGHIJKL",
  h3:"OPQRS", v3:"OPQRS", platform:"UV"
});
const labelGroup = type => ["h2","v2"].includes(type) ? "short" :
  ["h3","v3"].includes(type) ? "long" : type;
function nextPieceLabel(type, list = pieces) {
  if (type === "red") return "X";
  const pool = LABEL_GROUPS[type];
  const used = new Set(list.filter(p => labelGroup(p.type) === labelGroup(type)).map(p => p.label));
  return [...pool].find(letter => !used.has(letter)) || null;
}
function repairPieceLabels(list) {
  const used = {short:new Set(),long:new Set(),platform:new Set(),red:new Set()};
  for (const p of list) {
    const group = labelGroup(p.type), pool = LABEL_GROUPS[p.type];
    if (!pool) throw Error("Unknown piece type.");
    if (typeof p.label !== "string" || p.label.length !== 1 || !pool.includes(p.label) || used[group].has(p.label)) p.label = [...pool].find(x => !used[group].has(x));
    if (!p.label) throw Error("Too many pieces of type " + group + " (label slots exhausted).");
    used[group].add(p.label);
  }
  return list;
}
// Red is always reserved for X. All other new blocks use a non-red hue.
// Exclude the 30-degree range centered on 0°/360° (345° through 15°).
const MIN_BLOCK_HUE = 16, MAX_BLOCK_HUE = 344;
function randomBlockHue(list = pieces) {
  const used = list.filter(p => p.type !== "red" && validBlockHue(p.hue)).map(p => p.hue);
  let bestHue = MIN_BLOCK_HUE, bestDistance = -1;
  for (let attempt = 0; attempt < 32; attempt++) {
    const hue = MIN_BLOCK_HUE + Math.floor(Math.random() * (MAX_BLOCK_HUE - MIN_BLOCK_HUE + 1));
    const minDistance = used.length ?
      Math.min(...used.map(other => Math.min(Math.abs(hue-other), 360-Math.abs(hue-other)))) : 180;
    if (minDistance > bestDistance) { bestHue = hue; bestDistance = minDistance; }
    if (minDistance >= 30) break;
  }
  return bestHue;
}
function colorizePieces(list) {
  // Upgrade old saved puzzles without colors; never recolor a valid saved hue.
  for (const p of list) {
    if (p.type === "red") { delete p.hue; continue; }
    if (!validBlockHue(p.hue)) p.hue = randomBlockHue(list);
  }
  return list;
}
function paintPiece(el, type, hue) {
  if (type !== "red" && validBlockHue(hue)) {
    // Fixed saturation/lightness keep dark lettering readable across all hues.
    el.style.backgroundColor = "hsl(" + hue + " 67% 73%)";
  }
}
const portraitPhone = () => window.matchMedia("(max-width: 600px) and (orientation: portrait)").matches;
let pieces = [], nextId = 1, difficulty = "Starter", exitRow = 2; // Upper exit selected by default
let selectedTemplate = null, selectedHue = null, selectedId = null, undoStack = [], redoStack = [];
let pointerDrag = null, dragPreview = null, worker = null, testRequest = 0;
let storageKey = null, playerContext = null;
let libraryId = null, libraryRevision = 0, libraryBusy = false, libraryEntries = [], importPlan = null;
const knownLibraryRevisions = new Map();
let mode = "build", playStart = null, playMoves = 0, playWon = false;
let playHistory = [], replaying = false, replayGeneration = 0;
let mobileHold = null;
const clone = data => JSON.parse(JSON.stringify(data));
const cellSize = () => board.getBoundingClientRect().width / 7;
const byId = id => pieces.find(p => p.id === id);
const status = message => { $("status").textContent = message; };
const boardRect = () => board.getBoundingClientRect();
const insideBoard = (x,y) => { const r = boardRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };

function pointToCell(clientX, clientY) {
  const r = boardRect(), size = r.width / 7;
  return { x: Math.floor((clientX - r.left) / size), y: Math.floor((clientY - r.top) / size) };
}
function fits(testPiece, exceptId = null) {
  if (testPiece.x < 0 || testPiece.y < 0 ||
      testPiece.x + testPiece.w > 7 || testPiece.y + testPiece.h > 7) return false;
  return !pieces.some(p => p.id !== exceptId &&
    testPiece.x < p.x + p.w && testPiece.x + testPiece.w > p.x &&
    testPiece.y < p.y + p.h && testPiece.y + testPiece.h > p.y);
}
function snapshot() { return { pieces:clone(pieces), nextId, difficulty, exitRow,
  libraryId,libraryRevision,title:$("puzzleTitle").value }; }
function applySnapshot(s) {
  pieces = clone(s.pieces); nextId = s.nextId; difficulty = s.difficulty; exitRow = s.exitRow;
  libraryId=s.libraryId??null; libraryRevision=knownLibraryRevisions.get(libraryId)??s.libraryRevision??0;
  $("puzzleTitle").value=s.title||"Untitled puzzle";
  selectedId = null; selectedTemplate = null; selectedHue = null; invalidateTest(); render();
}
function recordEdit() {
  undoStack.push(snapshot());
  if (undoStack.length > 75) undoStack.shift();
  redoStack = [];
}
function modified(message) { invalidateTest(); render(); status(message + " · Unsaved changes."); }
function invalidateTest() {
  testRequest++;
  if (worker) { worker.terminate(); worker = null; }
  $("testResult").textContent = "";
  $("testResult").className = "";
  $("test").disabled = false;
  clearHover();
}
function selectTemplate(type, hue = null) {
  if (mode !== "build" || libraryBusy) return;
  $("mobilePicker").hidden = true;
  selectedTemplate = selectedTemplate === type ? null : type;
  selectedHue = selectedTemplate === null || type === "red" ? null :
    (validBlockHue(hue) ? hue : randomBlockHue());
  selectedId = null;
  render();
  status(selectedTemplate ? "Selected " + TEMPLATES[type].name + ". Drag it to the board or tap a cell." : "No module selected.");
}
function selectPiece(id) {
  selectedId = id;
  selectedTemplate = null;
  selectedHue = null;
  render();
  status("Selected " + byId(id)?.id + ". Drag to reposition, use arrow keys, or remove.");
}
function addTemplate(type, x, y, hue = selectedHue) {
  if (mode !== "build" || libraryBusy) return;
  const t = TEMPLATES[type];
  if (!t) return;
  if (type === "red" && byId("red")) return status("Only one red locomotive is allowed.");
  const label = nextPieceLabel(type);
  if (!label) return status("No available labels for this block type. Remove an existing one first.");
  if (type === "red" && ![2,3].includes(y)) return status("The red locomotive can only be placed in board row 3 or 4.");
  nextId = nextPieceId(pieces);
  const p = { id:type === "red" ? "red" : type + "-" + nextId, type, x, y, w:t.w, h:t.h, axis:t.axis, label };
  if (type !== "red") p.hue = validBlockHue(hue) ? hue : randomBlockHue();
  if (!fits(p)) return status("This module does not fit. Choose an empty area.");
  recordEdit();
  if (type !== "red") nextId++;
  pieces.push(p);
  if (type === "red") exitRow = y;
  selectedTemplate = null;
  selectedHue = null;
  selectedId = p.id;
  modified("Added " + t.name);
}
function movePiece(id, x, y) {
  if (mode !== "build" || libraryBusy) return;
  const p = byId(id);
  if (!p || (p.x === x && p.y === y)) return;
  if (p.type === "red" && ![2,3].includes(y)) return status("Red locomotive must stay on exit row 3 or 4.");
  if (!fits({ ...p, x, y }, id)) return status("Blocked placement. Modules cannot overlap or leave the board.");
  recordEdit();
  p.x = x; p.y = y;
  if (p.type === "red") exitRow = y;
  modified("Moved " + (p.label || p.id));
}
function rotateSelected() {
  if (mode !== "build" || libraryBusy) return;
  const p = byId(selectedId);
  if (!p) return;
  if (p.type === "red" || p.type === "platform") return status("This module has no alternate orientation.");
  const rotated = { ...p, w:p.h, h:p.w, axis:p.axis === "h" ? "v" : "h" };
  if (!fits(rotated, p.id)) return status("Rotation is blocked at this location.");
  recordEdit();
  Object.assign(p, { w:rotated.w, h:rotated.h, axis:rotated.axis });
  modified("Rotated " + p.id);
}
function removeSelected() {
  if (mode !== "build" || libraryBusy) return;
  if (!selectedId) return;
  const id = selectedId;
  recordEdit();
  pieces = pieces.filter(p => p.id !== id);
  selectedId = null;
  modified("Removed " + id);
}
function undo() {
  if (mode !== "build" || libraryBusy) return;
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  applySnapshot(undoStack.pop());
  status("Undo completed.");
}
function redo() {
  if (mode !== "build" || libraryBusy) return;
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  applySnapshot(redoStack.pop());
  status("Redo completed.");
}


function renderMoveLog(activeIndex = -1, follow = false) {
  const panel = $("moveLog"), list = $("moveLogList");
  panel.hidden = mode !== "play";
  if (panel.hidden) return;
  const oldScroll = panel.scrollTop;
  list.replaceChildren();
  $("moveLogEmpty").hidden = playHistory.length !== 0;
  const symbols = {right:"→",left:"←",up:"↑",down:"↓",exit:"⇥"};
  playHistory.forEach((move, index) => {
    const el = document.createElement("li");
    const no = String(index + 1).padStart(2, "0");
    const label = (playStart?.pieces.find(p=>p.id===move.id) ||
      pieces.find(p=>p.id===move.id))?.label || move.id;
    el.textContent = no + " " + label + symbols[move.direction] +
      (move.direction === "exit" ? "" : move.cells);
    el.title = "Move " + (index + 1) + ": " + move.description;
    el.setAttribute("aria-label", el.title);
    if (activeIndex === index) el.classList.add("replay-current");
    list.appendChild(el);
  });
  if (follow) panel.scrollTop = panel.scrollHeight;
  else if (activeIndex >= 0) {
    // Entries are now in the right sidebar, not half a spreadsheet cell.
    const entryHeight = list.firstElementChild?.getBoundingClientRect().height || 38;
    const top = entryHeight * activeIndex, bottom = top + entryHeight;
    panel.scrollTop = bottom > oldScroll + panel.clientHeight ?
      bottom - panel.clientHeight : top < oldScroll ? top : oldScroll;
  } else panel.scrollTop = oldScroll;
}
function recordPlayMove(id, direction, cells, won) {
  const piece = byId(id);
  const title = piece ? (piece.label || id) + " (" + (TEMPLATES[piece.type]?.name || id) + ")" : id;
  const verb = {right:"right",left:"left",up:"up",down:"down",exit:"out"}[direction];
  playHistory.push({
    id, direction, cells, won, after:clone(pieces),
    description:title + " " + verb + " " + cells + (cells === 1 ? " cell" : " cells")
  });
  playMoves = playHistory.length;
}
function finishPlayIfClear() {
  if (mode !== "play" || replaying || playWon || attemptExit(pieces, exitRow).status !== "won") return false;
  playWon = true;
  selectedId = null;
  if (playHistory.length) playHistory[playHistory.length - 1].won = true;
  const message = "Solved in " + playMoves + " moves!";
  status("Congratulations! " + message);
  showNotice("Congratulations!", message);
  return true;
}
function slidePlayable(id, dx, dy) {
  if (mode !== "play" || playWon || replaying) return;
  const piece = byId(id);
  if (!piece) return;
  const oldX = piece.x, oldY = piece.y;
  const result = attemptSlide(pieces, id, dx, dy, exitRow);
  if (result.status === "blocked") {
    status("That slide is blocked. Trains move on their own axis; platforms move one axis per slide.");
    return;
  }
  if (result.status === "won") {
    recordPlayMove(id, "exit", 8 - oldX - piece.w, true);
    finishPlayIfClear();
    render();
    renderMoveLog(-1, true);
    return;
  }
  piece.x = result.x;
  piece.y = result.y;
  const direction = result.x > oldX ? "right" : result.x < oldX ? "left" :
    result.y > oldY ? "down" : "up";
  const cells = Math.abs(result.x - oldX) + Math.abs(result.y - oldY);
  recordPlayMove(id, direction, cells, false);
  const solved = finishPlayIfClear();
  render();
  renderMoveLog(-1, true);
  if (!solved) status("Play preview: " + playMoves + " moves. Clear the path to the active exit.");
}
function exitPlayable() {
  if (mode !== "play" || playWon || replaying) return;
  const result = attemptExit(pieces, exitRow);
  if (result.status === "won") slidePlayable("red", 8 - byId("red").x - byId("red").w, 0);
  else status("The red locomotive must have an empty path to the selected exit.");
}
async function replayMoves() {
  if (mode !== "play" || replaying || !playStart || !playHistory.length) return;
  if (pointerDrag) finishDrag();
  $("noticeCard").close();
  const generation = ++replayGeneration;
  replaying = true;
  selectedId = null;
  pieces = clone(playStart.pieces);
  playMoves = 0;
  playWon = false;
  render();
  status("Replaying " + playHistory.length + " recorded moves.");
  for (let i = 0; i < playHistory.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 550));
    if (mode !== "play" || generation !== replayGeneration) return;
    pieces = clone(playHistory[i].after);
    playMoves = i + 1;
    playWon = playHistory[i].won;
    render();
    renderMoveLog(i);
  }
  if (mode !== "play" || generation !== replayGeneration) return;
  replaying = false;
  render();
  renderMoveLog(-1, true);
  status("Replay finished: " + playHistory.length +
    " moves shown. The final play position is restored.");
}
function setMode(next) {
  if (next === mode || libraryBusy) return;
  cancelMobileHold();
  closeMobilePicker();
  ++replayGeneration;
  replaying = false;
  if (pointerDrag) finishDrag();
  closeSaveMenu();
  $("noticeCard").close();
  if (next === "play") {
    const errors = validatePuzzle(pieces, exitRow);
    if (errors.length) {
      status("Complete the puzzle before Play: " + errors.join(" "));
      return;
    }
    playStart = snapshot();
    pieces = clone(pieces);
    playMoves = 0;
    playWon = false;
    playHistory = [];
    selectedId = null;
    selectedTemplate = null;
    mode = "play";
    invalidateTest();
    const solved = finishPlayIfClear();
    render();
    if (!solved) status("Play: clear the red locomotive's path to the active exit. Each slide counts as one move.");
  } else {
    mode = "build";
    if (playStart) applySnapshot(playStart);
    playStart = null;
    playWon = false;
    playMoves = 0;
    playHistory = [];
    render();
    status("Returned to Build. Your original puzzle is restored; preview moves were not saved.");
  }
}
$("buildMode").addEventListener("click", () => setMode("build"));
$("playMode").addEventListener("click", () => setMode("play"));
$("replay").addEventListener("click", () => { void replayMoves(); });

function makePiece(p) {
  const t = TEMPLATES[p.type] || TEMPLATES.h2;
  const el = document.createElement("div");
  el.className = "piece " + t.color + (p.id === selectedId ? " selected" : "");
  paintPiece(el, p.type, p.hue);
  el.style.left = (p.x / 7 * 100) + "%";
  el.style.top = (p.y / 7 * 100) + "%";
  el.style.width = (p.w / 7 * 100) + "%";
  el.style.height = (p.h / 7 * 100) + "%";
  el.dataset.pieceId = p.id;
  el.setAttribute("role", "gridcell");
  el.setAttribute("aria-label", t.name + " at column " + (p.x + 1) + " row " + (p.y + 1));
  const label = document.createElement("span");
  label.className = "piece-label";
  label.textContent = p.label || (p.type === "red" ? "X" : t.label);
  el.appendChild(label);
  return el;
}
function render() {
  board.querySelectorAll(".piece").forEach(el => el.remove());
  for (const p of pieces) board.appendChild(makePiece(p));
  document.querySelectorAll(".palette-card").forEach(el => {
    const active = el.dataset.template === selectedTemplate;
    el.classList.toggle("active", active);
    el.setAttribute("aria-pressed", String(active));
  });
  document.querySelector(".sheet").dataset.mode = mode;
  $("mobileMoves").hidden = mode !== "play" || !portraitPhone();
  if (mode !== "play") {
    document.querySelector(".sheet").dataset.mobileLog = "closed";
    $("mobileMoves").setAttribute("aria-expanded","false");
  }
  $("buildMode").setAttribute("aria-pressed", String(mode === "build"));
  $("playMode").setAttribute("aria-pressed", String(mode === "play"));
  $("playInfo").textContent = mode === "build" ? "Build mode" : replaying ? "Replaying…" : playWon ? "Solved!" : "Playing";
  $("replay").disabled = mode !== "play" || replaying || playHistory.length === 0;
  document.querySelector(".play-actions").hidden = mode !== "play";
  if (mode === "play") {
    $("moveCount").textContent = playMoves + " moves";
  }
  renderMoveLog();
  document.querySelectorAll(".palette-card").forEach(el => {
    el.setAttribute("aria-disabled", String(mode === "play"));
    el.tabIndex = mode === "play" ? -1 : 0;
    const type = el.dataset.template, group = labelGroup(type);
    const total = LABEL_GROUPS[type].length;
    const remaining = Math.max(0,total-pieces.filter(p=>labelGroup(p.type)===group).length);
    el.querySelector(".remaining").textContent = remaining + "/" + total + " Remaining";
  });
  document.querySelectorAll(".exit-gate").forEach(el => {
    const active = Number(el.dataset.exitRow) === exitRow;
    el.setAttribute("aria-pressed", String(active));
    el.querySelector(".arrow").textContent = active ? "→" : "×";
    el.title = active ? "Active exit" : "Select " + (Number(el.dataset.exitRow) === 2 ? "upper" : "lower") + " exit";
  });
  $("undo").disabled = libraryBusy || mode === "play" || !undoStack.length;
  $("redo").disabled = libraryBusy || mode === "play" || !redoStack.length;
  $("save").disabled = libraryBusy || mode === "play";
  $("test").disabled = mode === "build" && !!worker;
  document.querySelectorAll("#saveMenu button,.extras button,.details button").forEach(el => {
    el.disabled = libraryBusy || mode === "play" || (el.id === "remove" && !selectedId) ||
      (el.id === "test" && !!worker) ||
      (el.id === "rotate" && (!selectedId || ["red","platform"].includes(byId(selectedId)?.type))) ||
      (el.id === "clearSelection" && !selectedId && !selectedTemplate);
  });
  $("puzzleNameLabel").hidden = !LIBRARY_ENABLED;
  $("librarySetup").hidden = LIBRARY_ENABLED;
  $("manageLibrary").hidden = !LIBRARY_ENABLED || !["SL", "CJ"].includes(playerContext?.player.code) || mode !== "build";
  $("manageLibrary").disabled = libraryBusy;
  document.querySelectorAll("#manageLibraryCard button,#restoreCard button").forEach(el=>el.disabled=libraryBusy);
  $("puzzleTitle").disabled = libraryBusy || mode === "play";
  $("buildMode").disabled = libraryBusy; $("playMode").disabled = libraryBusy;
  document.querySelectorAll(".exit-gate").forEach(el => {
    el.disabled = libraryBusy || (mode === "play" && Number(el.dataset.exitRow) !== exitRow);
    el.setAttribute("aria-label", mode === "play" ?
      (Number(el.dataset.exitRow) === exitRow ? "Try exiting through this gate" : "Closed exit") :
      "Select " + (Number(el.dataset.exitRow) === 2 ? "upper" : "lower") + " exit");
  });
  updateFloatingTemplate();
  const p = byId(selectedId);
  $("selectedInfo").textContent = mode === "play" ? "Play preview — editing tools are disabled." :
    p ? (p.label || p.id) + " · " + TEMPLATES[p.type].name + " at " + String.fromCharCode(65+p.x) + (p.y+1) : selectedTemplate
    ? "Module selected: " + TEMPLATES[selectedTemplate].name : "Select a train to move, rotate or remove it.";
}
function clearHover() { board.querySelectorAll(".tile").forEach(tile => tile.classList.remove("drop-ok","drop-no")); }
function highlightFootprint(p, valid) {
  clearHover();
  for (let yy = p.y; yy < p.y+p.h; yy++) for (let xx=p.x;xx<p.x+p.w;xx++) {
    const el = board.querySelector('.tile[data-x="' + xx + '"][data-y="' + yy + '"]');
    if (el) el.classList.add(valid ? "drop-ok" : "drop-no");
  }
}

function updateFloatingTemplate() {
  const el = $("floatingTemplate");
  const type = selectedTemplate;
  const visible = mode === "build" && portraitPhone() && !!type;
  el.hidden = !visible;
  if (!visible) return;
  const t = TEMPLATES[type];
  const letter = nextPieceLabel(type);
  el.className = "piece floating-template " + t.color;
  el.style.backgroundColor = "";
  paintPiece(el, type, selectedHue);
  el.style.width = t.w * cellSize() + "px";
  el.style.height = t.h * cellSize() + "px";
  el.querySelector(".piece-label").textContent = letter || "—";
  el.setAttribute("aria-label", letter ?
    "Drag " + letter + " into position, or tap an empty cell." :
    "No more labels available for this block type.");
}
function closeMobilePicker() {
  $("mobilePicker").hidden = true;
}
function cancelMobileHold() {
  const hold = mobileHold;
  if (!hold) return;
  clearTimeout(hold.timer);
  document.removeEventListener("pointermove", mobileHoldMove);
  document.removeEventListener("pointerup", mobileHoldUp);
  document.removeEventListener("pointercancel", mobileHoldCancel);
  mobileHold = null;
}
function mobileHoldMove(event) {
  const h = mobileHold;
  if (!h || event.pointerId !== h.pointerId) return;
  if (Math.hypot(event.clientX-h.x,event.clientY-h.y)>10) cancelMobileHold();
}
function mobileHoldUp(event) {
  const h = mobileHold;
  if (!h || event.pointerId !== h.pointerId) return;
  const opened = h.opened;
  cancelMobileHold();
  if (opened || mode !== "build") return;
  if (selectedTemplate) {
    const place = templateAnchor(event.clientX,event.clientY,selectedTemplate);
    addTemplate(selectedTemplate,place.x,place.y);
  } else if (selectedId) {
    const p = byId(selectedId);
    if (!p) return;
    const place = {x:Math.round((event.clientX-boardRect().left)/cellSize()-p.w/2),
      y:Math.round((event.clientY-boardRect().top)/cellSize()-p.h/2)};
    movePiece(selectedId,place.x,place.y);
  } else status("Long-press an empty board cell to choose a new block.");
}
function mobileHoldCancel(event) {
  if (mobileHold && event.pointerId === mobileHold.pointerId) cancelMobileHold();
}
function startMobileHold(event) {
  cancelMobileHold();
  const h = {pointerId:event.pointerId,x:event.clientX,y:event.clientY,opened:false,timer:null};
  mobileHold = h;
  h.timer = setTimeout(()=>{
    if (mobileHold !== h || mode !== "build") return;
    h.opened = true;
    selectedTemplate = null;
    selectedHue = null;
    selectedId = null;
    $("mobilePicker").hidden = false;
    render();
    status("Pick a block, then drag the floating block or tap the board.");
  },480);
  document.addEventListener("pointermove",mobileHoldMove);
  document.addEventListener("pointerup",mobileHoldUp);
  document.addEventListener("pointercancel",mobileHoldCancel);
}
$("closeMobilePicker").addEventListener("click",closeMobilePicker);
document.querySelectorAll("[data-mobile-template]").forEach(btn=>btn.addEventListener("click",()=>{
  if (!portraitPhone() || mode !== "build") return;
  const type = btn.dataset.mobileTemplate;
  if (type === "red" && byId("red")) {
    closeMobilePicker(); status("Only one red locomotive can be on the board.");return;
  }
  if (!nextPieceLabel(type)) {
    closeMobilePicker();status("All labels for that block type are already used.");return;
  }
  selectedTemplate = type;
  selectedHue = type === "red" ? null : randomBlockHue();
  selectedId = null;
  closeMobilePicker();
  render();
  status("Drag the floating " + (nextPieceLabel(type)||type) + " or tap an empty board cell.");
}));
$("floatingTemplate").addEventListener("pointerdown", event=>{
  if (mode !== "build" || !portraitPhone()) return;
  $("floatingTemplate").hidden = true;
  beginDrag(event,{kind:"palette",type:selectedTemplate,mobileFloating:true});
});
$("mobileMoves").addEventListener("click",()=>{
  if (mode !== "play" || !portraitPhone()) return;
  const sheet=document.querySelector(".sheet");
  sheet.dataset.mobileLog=sheet.dataset.mobileLog==="open"?"closed":"open";
  $("mobileMoves").setAttribute("aria-expanded",String(sheet.dataset.mobileLog==="open"));
});
document.addEventListener("pointerdown",event=>{
  const sheet=document.querySelector(".sheet");
  if (portraitPhone() && sheet.dataset.mobileLog==="open" &&
      !event.target.closest(".right-panel") && !event.target.closest("#mobileMoves") &&
      !event.target.closest("#test")) {
    sheet.dataset.mobileLog="closed";
    $("mobileMoves").setAttribute("aria-expanded","false");
  }
});

function templateAnchor(clientX, clientY, type) {
  const t = TEMPLATES[type], r = boardRect(), size = cellSize();
  // Center of dragged block follows the pointer, including even-width blocks.
  return { x:Math.round((clientX-r.left)/size - t.w/2),
    y:Math.round((clientY-r.top)/size - t.h/2) };
}
function beginDrag(event, data) {
  if (libraryBusy || event.button !== 0 || pointerDrag || (mode === "play" && data.kind !== "play")) return;
  if (data.kind === "palette" && data.type !== "red" && !validBlockHue(data.hue)) {
    data.hue = data.mobileFloating && validBlockHue(selectedHue) ? selectedHue : randomBlockHue();
  }
  event.preventDefault();
  // The board stays mounted when the selected piece is re-rendered; capture its pointer for touch reliability.
  if (data.kind === "board" || data.kind === "play") {
    try { board.setPointerCapture(event.pointerId); } catch (_) {}
  }
  pointerDrag = { ...data, pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, moved:false, proposed:null };
  document.addEventListener("pointermove", dragMove);
  document.addEventListener("pointerup", dragEnd);
  document.addEventListener("pointercancel", dragCancel);
}
function createPreview(type, piece = null, hue = null) {
  const t = TEMPLATES[type];
  const w = piece?.w || t.w, h = piece?.h || t.h;
  dragPreview = document.createElement("div");
  dragPreview.className = "piece dragging " + t.color;
  paintPiece(dragPreview, type, piece?.hue ?? hue);
  const label = document.createElement("span");
  label.className = "piece-label";
  label.textContent = piece?.label || nextPieceLabel(type) || t.label;
  dragPreview.appendChild(label);
  dragPreview.style.position = "fixed";
  dragPreview.style.zIndex = "1000";
  dragPreview.style.pointerEvents = "none";
  dragPreview.style.width = (w * cellSize()) + "px";
  dragPreview.style.height = (h * cellSize()) + "px";
  document.body.appendChild(dragPreview);
}
function dragMove(event) {
  const d = pointerDrag;
  if (!d || event.pointerId !== d.pointerId) return;
  const dist = Math.hypot(event.clientX-d.startX, event.clientY-d.startY);
  if (dist > 6) d.moved = true;
  if (!d.moved) return;
  if (d.kind === "palette") {
    if (!dragPreview) createPreview(d.type, null, d.hue);
    dragPreview.style.left = (event.clientX - TEMPLATES[d.type].w * cellSize()/2) + "px";
    dragPreview.style.top = (event.clientY - TEMPLATES[d.type].h * cellSize()/2) + "px";
    if (insideBoard(event.clientX,event.clientY)) {
      const pos = templateAnchor(event.clientX,event.clientY,d.type);
      d.proposed = pos;
      const t = TEMPLATES[d.type];
      const valid = fits({ ...t, ...pos }) && (d.type !== "red" || (![2,3].includes(pos.y) ? false : !byId("red")));
      highlightFootprint({ ...t, ...pos }, valid);
    } else { d.proposed = null; clearHover(); }
  } else if (d.kind === "play") {
    const size = cellSize(), piece = byId(d.id);
    if (!piece || playWon) return;
    let dx = Math.round((event.clientX - d.startX) / size);
    let dy = Math.round((event.clientY - d.startY) / size);
    if (piece.axis === "h") dy = 0;
    else if (piece.axis === "v") dx = 0;
    else if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
    d.proposed = {dx,dy};
    const outcome = attemptSlide(pieces,d.id,dx,dy,exitRow);
    if (outcome.status === "moved") highlightFootprint({ ...piece, x:outcome.x,y:outcome.y },true);
    else clearHover();
  } else {
    const size = cellSize(), r = boardRect();
    const piece = byId(d.id);
    if (!piece) return;
    d.proposed = {
      x:Math.round((event.clientX-r.left)/size - piece.w/2),
      y:Math.round((event.clientY-r.top)/size - piece.h/2)
    };
    const valid = fits({ ...piece, ...d.proposed }, d.id) &&
      (piece.type !== "red" || [2,3].includes(d.proposed.y));
    if (!dragPreview) createPreview(piece.type,piece);
    dragPreview.style.left = (event.clientX - piece.w * size/2) + "px";
    dragPreview.style.top = (event.clientY - piece.h * size/2) + "px";
    highlightFootprint({ ...piece, ...d.proposed }, valid);
    const original = board.querySelector('.piece[data-piece-id="' + d.id + '"]');
    if (original) {
      original.classList.toggle("invalid", !valid);
      original.classList.add("dragging");
    }
  }
}
function finishDrag() {
  document.removeEventListener("pointermove",dragMove);
  document.removeEventListener("pointerup",dragEnd);
  document.removeEventListener("pointercancel",dragCancel);
  if (dragPreview) { dragPreview.remove(); dragPreview = null; }
  clearHover();
  board.querySelectorAll(".piece.invalid,.piece.dragging").forEach(el=>el.classList.remove("invalid","dragging"));
  pointerDrag = null;
}
function dragEnd(event) {
  const d = pointerDrag;
  if (!d || event.pointerId !== d.pointerId) return;
  finishDrag();
  if (d.kind === "palette") {
    if (!d.moved && !d.mobileFloating) selectTemplate(d.type, d.hue);
    else if (d.proposed && insideBoard(event.clientX,event.clientY)) addTemplate(d.type,d.proposed.x,d.proposed.y,d.hue);
    if (d.mobileFloating && !insideBoard(event.clientX,event.clientY)) {
      selectedTemplate = null; selectedHue = null; render();status("Discarded the floating block.");
    } else if (d.mobileFloating) updateFloatingTemplate();
  } else if (d.kind === "play") {
    if (d.moved && d.proposed) slidePlayable(d.id,d.proposed.dx,d.proposed.dy);
  } else if (d.moved && mode === "build" && portraitPhone() && !insideBoard(event.clientX,event.clientY)) {
    selectedId = d.id; removeSelected();
  } else if (d.moved && d.proposed) movePiece(d.id,d.proposed.x,d.proposed.y);
}
function dragCancel() { finishDrag(); }

for (let y=0;y<7;y++) for (let x=0;x<7;x++) {
  const cell = document.createElement("div");
  cell.className = "tile";
  cell.dataset.x = x; cell.dataset.y = y;
  cell.setAttribute("role","gridcell");
  cell.setAttribute("aria-label","Column " + String.fromCharCode(65+x) + ", row " + (y+1));
  board.appendChild(cell);
}
document.querySelectorAll(".palette-card").forEach(el=>{
  el.addEventListener("pointerdown", e=>{if(mode==="build")beginDrag(e,{kind:"palette",type:el.dataset.template});});
  el.addEventListener("keydown", e=>{
    if (e.key==="Enter" || e.key===" ") { e.preventDefault(); selectTemplate(el.dataset.template); }
  });
});
board.addEventListener("pointerdown", event=>{
  if (event.button !== 0 || libraryBusy) return;
  const pieceEl = event.target.closest(".piece");
  if (pieceEl) {
    const p = byId(pieceEl.dataset.pieceId);
    if (!p || (mode === "play" && (playWon || replaying))) return;
    if (mode === "play") {
      selectedId = p.id; selectedTemplate = null; render();
      beginDrag(event,{kind:"play",id:p.id,originX:p.x,originY:p.y});
    } else {
      selectPiece(p.id);
      beginDrag(event,{kind:"board",id:p.id,originX:p.x,originY:p.y});
    }
  } else {
    if (mode === "play") return;
    if (portraitPhone()) { startMobileHold(event); return; }
    if (selectedTemplate) {
      const pos = templateAnchor(event.clientX,event.clientY,selectedTemplate);
      addTemplate(selectedTemplate,pos.x,pos.y);
    } else if (selectedId) {
      const cell = pointToCell(event.clientX,event.clientY);
      movePiece(selectedId,cell.x,cell.y);
    }
    board.focus({ preventScroll:true });
  }
});
document.querySelectorAll(".exit-gate").forEach(btn=>btn.addEventListener("click",()=>{
  if (libraryBusy) return;
  const row = Number(btn.dataset.exitRow);
  if (mode === "play") {
    if (row === exitRow) exitPlayable();
    return;
  }
  if (![2,3].includes(row) || row === exitRow) return;
  const red = byId("red");
  if (red && !fits({...red,y:row},red.id)) {
    status("Cannot switch exits: clear room to move X to the selected exit row.");
    return;
  }
  recordEdit();
  if (red) red.y = row;
  exitRow = row;
  modified("Selected the " + (row === 2 ? "upper" : "lower") + " exit" + (red ? "; X moved into alignment" : ""));
}));
$("undo").addEventListener("click",undo);
$("redo").addEventListener("click",redo);
$("rotate").addEventListener("click",rotateSelected);
$("remove").addEventListener("click",removeSelected);
$("clearSelection").addEventListener("click",()=>{ if(mode!=="build")return; selectedId=null; selectedTemplate=null; render();status("Selection cleared."); });
document.addEventListener("keydown", e=>{
  if ($("noticeCard").open || $("manageLibraryCard").open || $("restoreCard").open || libraryBusy) return;
  const tag = e.target?.tagName;
  if (["INPUT","TEXTAREA","SELECT"].includes(tag)) return;
  if (e.key === "Escape" && !$("saveMenu").hidden) { closeSaveMenu(); e.preventDefault(); return; }
  if (mode === "play") {
    if (e.key === "Escape") { selectedId = null; render(); return; }
    const dirs = { ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1] };
    if (dirs[e.key] && selectedId && !playWon && !replaying) {
      e.preventDefault(); slidePlayable(selectedId,...dirs[e.key]);
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="z") {
    e.preventDefault(); if(e.shiftKey) redo(); else undo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="y") { e.preventDefault(); redo(); return; }
  if (e.key==="Escape") { selectedId=null; selectedTemplate=null; render();return; }
  if (e.key==="Delete" || e.key==="Backspace") { if (selectedId) {e.preventDefault();removeSelected();}return; }
  if (e.key.toLowerCase()==="r" && !e.ctrlKey && !e.metaKey) { if (selectedId) {e.preventDefault();rotateSelected();}return; }
  const dirs = { ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1] };
  if (dirs[e.key] && selectedId) {
    e.preventDefault();
    const p = byId(selectedId), [dx,dy] = dirs[e.key];
    if (p) movePiece(p.id,p.x+dx,p.y+dy);
  }
});

$("showMoves").addEventListener("click",()=>{
  if (mode === "play") {
    if (portraitPhone()) {
      const sheet = document.querySelector(".sheet");
      sheet.dataset.mobileLog = sheet.dataset.mobileLog === "open" ? "closed" : "open";
      $("mobileMoves").setAttribute("aria-expanded",String(sheet.dataset.mobileLog === "open"));
    }
    const log = $("moveLog");
    log.scrollTop = log.scrollHeight;
    if (!portraitPhone()) log.focus({ preventScroll:true });
    return;
  }
});
$("test").addEventListener("click",()=>{
  if (mode !== "build" || libraryBusy) return;
  const errors = validatePuzzle(pieces, exitRow);
  if (errors.length) {
    $("testResult").textContent = "Invalid layout";
    $("testResult").className = "bad";
    status("Cannot test: " + errors.join(" "));
    return;
  }
  invalidateTest();
  const id = ++testRequest;
  $("testResult").textContent = "Searching…";
  $("testResult").className = "busy";
  $("test").disabled = true;
  status("Searching for the shortest solution. Each slide counts as one move.");
  worker = new Worker("./solver-worker.js",{type:"module"});
  worker.onmessage = event=>{
    if (id !== testRequest || event.data.requestId !== id) return;
    if (event.data.type === "progress") {
      status("Searching… " + event.data.progress.visited.toLocaleString() + " states found.");
      return;
    }
    const result = event.data.result;
    worker?.terminate(); worker=null; $("test").disabled=false;
    if (result.status==="solved") {
      $("testResult").textContent = "Solvable — " + result.steps + " moves";
      $("testResult").className = "ok";
      status("Solvable in " + result.steps + " moves (optimal). Searched " + result.visited.toLocaleString() + " states.");
    } else if (result.status==="unsolvable") {
      $("testResult").textContent="Unsolvable";
      $("testResult").className="bad";
      status("Unsolvable: every reachable board state was checked (" + result.visited.toLocaleString() + ").");
    } else if (result.status==="limit") {
      $("testResult").textContent="Inconclusive";
      $("testResult").className="busy";
      status("Inconclusive. Search reached " + result.maxStates.toLocaleString() + " explored states. This does not prove unsolvability.");
    } else {
      $("testResult").textContent="Test error";
      $("testResult").className="bad";
      status("Test error: " + (result.message || (result.errors||[]).join("; ")));
    }
  };
  worker.onerror = error=>{
    if (id!==testRequest) return;
    worker?.terminate();worker=null;$("test").disabled=false;
    $("testResult").textContent="Test error";$("testResult").className="bad";
    status("Solver could not start: " + error.message);
  };
  worker.postMessage({requestId:id,pieces:clone(pieces),exitRow});
});

// Validation finishes before editor state, history, or saved slots change.
function preparePuzzleData(data) {
  const clean = normalizePuzzleData(data);
  clean.pieces = colorizePieces(repairPieceLabels(clean.pieces));
  return clean;
}
function documentData() {
  return preparePuzzleData({ format:"move-red-loco-editor-v1", difficulty, exitRow, pieces });
}
function showNotice(title, message) {
  $("noticeTitle").textContent = title;
  $("noticeMessage").textContent = message;
  if (!$("noticeCard").open) $("noticeCard").showModal();
}
$("closeNotice").addEventListener("click", () => $("noticeCard").close());
function requireCreator(save = false) {
  if (["SL", "CJ"].includes(playerContext?.player.code)) return true;
  closeSaveMenu();
  showNotice("Save puzzle layout", save ? "Only SL or CJ can save a puzzle layout." : "Only SL or CJ can export or import puzzle files.");
  return false;
}
function closeSaveMenu() {
  $("saveMenu").hidden = true;
  $("save").setAttribute("aria-expanded","false");
}
$("save").addEventListener("click",()=>{
  if (mode !== "build" || !requireCreator(true)) return;
  const willOpen = $("saveMenu").hidden;
  $("saveMenu").hidden = !willOpen;
  $("save").setAttribute("aria-expanded",String(willOpen));
});
document.addEventListener("pointerdown", event=>{
  if (!event.target.closest("#saveBox")) closeSaveMenu();
});
document.querySelectorAll("[data-save-tier]").forEach(btn=>btn.addEventListener("click",async()=>{
  if (mode !== "build" || libraryBusy || !requireCreator(true) || !storageKey) return;
  const tier = btn.dataset.saveTier;
  if (!TIERS.includes(tier)) return;
  try {
    const pendingId = LIBRARY_ENABLED ? (libraryId || crypto.randomUUID()) : libraryId;
    const draft = { ...documentData(), difficulty:tier, nextId:nextPieceId(pieces), savedAt:new Date().toISOString(),
      title:$("puzzleTitle").value,libraryId:pendingId,libraryRevision };
    writeDraft(localStorage, storageKey, draft);
    libraryId=pendingId;
    if (difficulty !== tier) { recordEdit(); difficulty = tier; }
    closeSaveMenu(); render();
    status("Saved as " + tier + " on this device. Export JSON for a portable copy.");
    if (LIBRARY_ENABLED) {
      if (!online()) { status("Saved on this device. Connect to the internet and Save again to save in the family library."); return; }
      await libraryTask(async()=>{
        const store=await cloudStore();
        const saved=await store.savePuzzle({id:libraryId,title:draft.title,layout:draft,expectedRevision:libraryRevision});
        libraryRevision=saved.revision;
        knownLibraryRevisions.set(libraryId,libraryRevision);
        try { writeDraft(localStorage,storageKey,{...draft,libraryRevision}); }
        catch (_) {
          status("Saved in the family library. The device copy could not be updated.");
          showNotice("Puzzle saved", "Saved in the family library:\n" + draft.title + "\n\nThe device copy could not be updated.");
          return;
        }
        status("Saved in the family library: " + draft.title + ".");
        showNotice("Puzzle saved", "Saved in the family library:\n" + draft.title);
      });
    }
  } catch(error) {
    closeSaveMenu(); status("Could not save locally: " + error.message);
  }
}));
$("export").addEventListener("click",()=>{
  if (mode !== "build" || !requireCreator()) return;
  try {
    const data = JSON.stringify({...documentData(),title:$("puzzleTitle").value.trim() || "Untitled puzzle"},null,2)+"\n";
    const blob = new Blob([data],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download="move-red-loco-" + difficulty.toLowerCase() + ".json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status("Exported puzzle JSON. Saved files contain no account data.");
  } catch(error) { status("Could not export JSON: " + error.message); }
});
$("import").addEventListener("click",()=>{if(mode==="build")$("importFile").click();});
$("importFile").addEventListener("change",async event=>{
  if (mode !== "build" || libraryBusy) return;
  const file=event.target.files?.[0];
  event.target.value="";
  if (!file) return;
  try {
    if (file.size > 100000) throw Error("File is too large.");
    const imported = JSON.parse(await file.text());
    const draft = preparePuzzleData(imported);
    draft.title = typeof imported.title === "string" && imported.title.trim().length <= 80 ? imported.title.trim() || "Imported puzzle" : "Imported puzzle";
    // File reading is asynchronous. A mode change must not replace a running preview.
    if (mode !== "build" || libraryBusy) return;
    if (pieces.length && !confirm("Replace the current layout with this imported puzzle? Unsaved changes will be replaced.")) return;
    recordEdit();
    pieces=draft.pieces; difficulty=draft.difficulty; exitRow=draft.exitRow;
    libraryId=null; libraryRevision=0; $("puzzleTitle").value=typeof draft.title === "string" ? draft.title : "Imported puzzle";
    nextId=nextPieceId(pieces);
    selectedId=null;selectedTemplate=null;selectedHue=null;
    modified("Imported " + pieces.length + " modules");
  } catch(error) { status("Import rejected: " + error.message); }
});

function online() {
  return navigator.onLine !== false && (playerContext?.online ? playerContext.online() : playerContext?.mode !== "checkout");
}
async function cloudStore() {
  if (!LIBRARY_ENABLED) throw Error("The cloud library is not available yet.");
  if (!online()) throw Error("Connect to the internet for this action.");
  return import("./library-firestore.js");
}
async function libraryTask(work) {
  if (libraryBusy) return;
  cancelMobileHold(); closeMobilePicker(); closeSaveMenu();
  if (pointerDrag) finishDrag();
  libraryBusy=true; render();
  try { return await work(); }
  catch(error) {
    const message=error.code==="permission-denied" ?
      "Firebase refused this action. Check your sign-in and permissions." : error.message;
    status("Library action did not finish: " + message);
    showNotice("Puzzle library",message);
  } finally { libraryBusy=false; render(); }
}
function cacheLibrary(entries) {
  try {localStorage.setItem("mrl-library-v1:"+playerContext.player.uid,JSON.stringify(entries));} catch (_) {}
}
async function readLibrary() {
  if (online()) {
    const entries=await (await cloudStore()).listPuzzles();
    cacheLibrary(entries);
    return entries;
  }
  const data=JSON.parse(localStorage.getItem("mrl-library-v1:"+playerContext.player.uid)||"[]");
  if (!Array.isArray(data)) throw Error("The device library copy is invalid. Connect to refresh it.");
  return data.map(normalizeLibraryPuzzle);
}
function downloadJSON(data,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
let actionPuzzle=null, actionTrigger=null, actionPosition=null;
function closePuzzleActions(focus=false) {
  const trigger=actionTrigger;
  if ($("puzzleActions").matches(":popover-open")) $("puzzleActions").hidePopover();
  trigger?.setAttribute("aria-expanded","false");
  actionPuzzle=null;actionTrigger=null;actionPosition=null;
  if(focus)trigger?.focus();
}
function openPuzzleActions(trigger,puzzle) {
  if(libraryBusy)return;
  const wasOpen=actionTrigger===trigger && $("puzzleActions").matches(":popover-open");
  closePuzzleActions();
  if(wasOpen)return;
  actionPuzzle=puzzle;actionTrigger=trigger;
  const menu=$("puzzleActions");
  menu.setAttribute("aria-label","Actions for "+puzzle.title);
  menu.showPopover();trigger.setAttribute("aria-expanded","true");
  const rect=trigger.getBoundingClientRect();
  actionPosition={x:rect.x,y:rect.y};
  const top=rect.bottom+4+menu.offsetHeight<=innerHeight-8 ? rect.bottom+4 : rect.top-menu.offsetHeight-4;
  menu.style.top=Math.max(8,top)+"px";
  menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,rect.right-menu.offsetWidth))+"px";
  menu.querySelector("button").focus();
}
$("puzzleActions").addEventListener("toggle",event=>{
  // Ignore an earlier close event if another trigger has already reopened the menu.
  if(event.newState==="closed" && !$("puzzleActions").matches(":popover-open"))closePuzzleActions();
});
$("puzzleActions").addEventListener("keydown",event=>{
  const buttons=[...$("puzzleActions").querySelectorAll("button")];
  const current=buttons.indexOf(document.activeElement);
  if(event.key==="Escape"){event.preventDefault();closePuzzleActions(true);return;}
  const next=event.key==="ArrowDown" ? (current+1)%buttons.length :
    event.key==="ArrowUp" ? (current+buttons.length-1)%buttons.length :
    event.key==="Home" ? 0 : event.key==="End" ? buttons.length-1 : null;
  if(next!==null){event.preventDefault();buttons[next].focus();}
});
$("puzzleActions").addEventListener("click",event=>{
  const button=event.target.closest("[data-library-action]");
  if(!button || !actionPuzzle || libraryBusy)return;
  const puzzle=actionPuzzle;
  closePuzzleActions(true);
  if(button.dataset.libraryAction==="edit")editLibraryPuzzle(puzzle);
  if(button.dataset.libraryAction==="rename")void renameLibraryPuzzle(puzzle);
  if(button.dataset.libraryAction==="delete")void deleteLibraryPuzzle(puzzle);
});
$("manageLibraryList").addEventListener("scroll",()=>{
  // A trigger may scroll into view just before opening. Ignore that queued scroll event.
  const rect=actionTrigger?.getBoundingClientRect();
  if(rect && actionPosition && (rect.x!==actionPosition.x || rect.y!==actionPosition.y))closePuzzleActions();
});
window.addEventListener("resize",()=>closePuzzleActions());
$("manageLibraryCard").addEventListener("close",()=>closePuzzleActions());
function renderManagedLibrary(message) {
  closePuzzleActions();
  const list=$("manageLibraryList");list.replaceChildren();
  for (const [index,tier] of TIERS.entries()) {
    const section=document.createElement("section"), heading=document.createElement("h3");
    section.className="manage-tier";section.dataset.tier=tier;
    heading.id="manage-tier-"+index;heading.textContent=tier;
    section.setAttribute("aria-labelledby",heading.id);section.appendChild(heading);
    const grid=document.createElement("ul");grid.className="manage-grid";
    const entries=libraryEntries.filter(puzzle=>puzzle.difficulty===tier)
      .sort((a,b)=>a.title.localeCompare(b.title,undefined,{numeric:true})||a.id.localeCompare(b.id));
    if (!entries.length) {
      const empty=document.createElement("div");empty.className="manage-empty";
      empty.textContent="No saved puzzles in this tier.";section.appendChild(empty);
    }
    for (const puzzle of entries) {
      const row=document.createElement("li"), entry=document.createElement("div");
      entry.className="manage-entry";
      const title=document.createElement("strong"), details=document.createElement("small");
      title.textContent=puzzle.title;
      details.textContent="Updated "+new Date(puzzle.updatedAt).toLocaleString();
      entry.append(title,details);
      const actions=document.createElement("div");actions.className="manage-actions";
      const menu=document.createElement("button");
      menu.type="button";menu.className="action library-menu";menu.textContent="⋯";
      menu.dataset.puzzleId=puzzle.id;menu.setAttribute("aria-label","Actions for "+puzzle.title);
      menu.setAttribute("aria-haspopup","menu");menu.setAttribute("aria-expanded","false");
      menu.setAttribute("aria-controls","puzzleActions");
      menu.addEventListener("click",()=>openPuzzleActions(menu,puzzle));
      actions.append(menu);row.append(entry,actions);grid.appendChild(row);
    }
    section.appendChild(grid);list.appendChild(section);
  }
  $("manageLibraryMessage").textContent=(message ? message+"\n" : "")+
    (libraryEntries.length ? "Select ⋯ beside a puzzle to edit, rename, or delete it." : "No puzzles have been saved yet.");
}
async function renameLibraryPuzzle(puzzle) {
  if (libraryBusy || mode!=="build" || !["SL", "CJ"].includes(playerContext?.player.code)) return;
  const entered=prompt("Rename puzzle (1–80 characters):",puzzle.title);
  if (entered===null || entered.trim()===puzzle.title) return;
  const renamed=await libraryTask(async()=>{
    const store=await cloudStore();
    const result=await store.renamePuzzle({id:puzzle.id,title:entered,expectedRevision:puzzle.revision});
    // A metadata-only change must not authorize overwriting an unseen layout revision.
    if (knownLibraryRevisions.get(puzzle.id)===puzzle.revision) knownLibraryRevisions.set(puzzle.id,result.revision);
    for (const snapshot of [...undoStack,...redoStack]) {
      if (snapshot.libraryId===puzzle.id && snapshot.libraryRevision===puzzle.revision && snapshot.title?.trim()===puzzle.title) snapshot.title=result.title;
    }
    if (libraryId===puzzle.id && libraryRevision===puzzle.revision) {
      libraryRevision=result.revision;
      if ($("puzzleTitle").value.trim()===puzzle.title) $("puzzleTitle").value=result.title;
    }
    libraryEntries=libraryEntries.map(entry=>entry.id===puzzle.id ? {...entry,title:result.title,revision:result.revision} : entry);
    let refreshMessage="";
    try { libraryEntries=await store.listPuzzles(); }
    catch (_) { refreshMessage=" The name was saved. Reopen Manage library to refresh its update time."; }
    cacheLibrary(libraryEntries);
    const message='Renamed puzzle to "'+result.title+'".'+refreshMessage;
    renderManagedLibrary(message);status(message);
    return true;
  });
  if (renamed) $("manageLibraryList").querySelector('.library-menu[data-puzzle-id="'+puzzle.id+'"]')?.focus();
}
async function deleteLibraryPuzzle(puzzle) {
  if (libraryBusy || mode!=="build" || !["SL", "CJ"].includes(playerContext?.player.code)) return;
  if (!confirm('Delete "'+puzzle.title+'" from the family library? This cannot be undone.')) return;
  const deleted=await libraryTask(async()=>{
    await (await cloudStore()).deletePuzzle({id:puzzle.id,expectedRevision:puzzle.revision});
    // Preserve the editor's identity and revision: Save must not silently recreate a deleted puzzle.
    libraryEntries=libraryEntries.filter(entry=>entry.id!==puzzle.id);
    cacheLibrary(libraryEntries);
    const message='Deleted "'+puzzle.title+'" from the family library.';
    renderManagedLibrary(message);status(message);
    return true;
  });
  if (deleted) ($("manageLibraryList").querySelector("button")||$("closeManageLibrary")).focus();
}
$("manageLibrary").addEventListener("click",()=>{
  if (!LIBRARY_ENABLED || mode!=="build" || libraryBusy || !["SL", "CJ"].includes(playerContext?.player.code)) return;
  void libraryTask(async()=>{
    libraryEntries=await readLibrary();
    renderManagedLibrary(online()?undefined:"Offline: showing this device’s saved library copy.");$("manageLibraryCard").showModal();
  });
});
$("closeManageLibrary").addEventListener("click",()=>{if(!libraryBusy)$("manageLibraryCard").close();});
$("manageLibraryCard").addEventListener("cancel",event=>{if(libraryBusy)event.preventDefault();});
function editLibraryPuzzle(puzzle) {
  if (libraryBusy || mode!=="build" || !["SL", "CJ"].includes(playerContext?.player.code)) return;
  if (pieces.length && !confirm("Replace the current layout with this saved puzzle? Unsaved changes will be replaced.")) return;
  const draft=preparePuzzleData({...puzzle,format:"move-red-loco-editor-v1"});
  recordEdit();pieces=draft.pieces;difficulty=draft.difficulty;exitRow=draft.exitRow;
  nextId=nextPieceId(pieces);libraryId=puzzle.id;libraryRevision=puzzle.revision;
  knownLibraryRevisions.set(libraryId,libraryRevision);
  $("puzzleTitle").value=puzzle.title;selectedId=null;selectedTemplate=null;selectedHue=null;
  $("manageLibraryCard").close();invalidateTest();render();status("Opened "+puzzle.title+" from the family library.");
}
$("newPuzzle").addEventListener("click",()=>{
  if (mode!=="build" || libraryBusy) return;
  if (pieces.length && !confirm("Start a new puzzle? Unsaved changes to this layout will be replaced.")) return;
  recordEdit();pieces=[];nextId=1;exitRow=2;difficulty="Starter";
  libraryId=null;libraryRevision=0;$("puzzleTitle").value="Untitled puzzle";
  selectedId=null;selectedTemplate=null;selectedHue=null;modified("Started a new puzzle");
});
$("downloadArchive").addEventListener("click",()=>{
  if (mode!=="build" || !requireCreator()) return;
  void libraryTask(async()=>{
    // The archive always comes from a fresh server query, never from the device cache.
    const records=await (await cloudStore()).listPuzzles();
    const archive=makeArchive(records);
    downloadJSON(archive,"move-red-loco-archive-"+archive.exportedAt.slice(0,10)+".json");
    cacheLibrary(records);status("Downloaded an archive of "+records.length+" puzzles from Firestore.");
  });
});
$("restoreArchive").addEventListener("click",()=>{
  if (LIBRARY_ENABLED && mode==="build" && !libraryBusy && requireCreator()) $("archiveFile").click();
});
$("archiveFile").addEventListener("change",async event=>{
  const file=event.target.files?.[0];event.target.value="";
  if (!file || mode!=="build" || libraryBusy || !requireCreator()) return;
  await libraryTask(async()=>{
    await cloudStore();
    if (file.size>MAX_ARCHIVE_BYTES) throw Error("Import exceeds 2 MB.");
    importPlan=null;
    const data=JSON.parse(await file.text());
    const plan=planLibraryImport(data);
    importPlan=plan;
    $("restoreSummary").textContent="Add "+plan.entries.length+" puzzles as new copies. Existing puzzles will be kept.";
    $("importPreview").replaceChildren();
    for (const {puzzle} of plan.entries) {
      const item=document.createElement("li");item.textContent=puzzle.title+" · "+puzzle.difficulty;
      $("importPreview").appendChild(item);
    }
    $("restoreCard").showModal();
  });
});
$("cancelRestore").addEventListener("click",()=>{if(!libraryBusy){$("restoreCard").close();importPlan=null;}});
$("restoreCard").addEventListener("cancel",event=>{if(libraryBusy)event.preventDefault();else importPlan=null;});
$("confirmRestore").addEventListener("click",async()=>{
  if (libraryBusy || !importPlan || !requireCreator()) return;
  await libraryTask(async()=>{
    const plan=importPlan;
    const store=await cloudStore();
    const result=await store.restorePuzzles(plan);
    importPlan=null;$("restoreCard").close();
    let message="Imported "+result.restored+" puzzles as new copies. Existing puzzles were kept.";
    try {libraryEntries=await store.listPuzzles();cacheLibrary(libraryEntries);}
    catch (_) {message+=" Import succeeded. Reopen Manage library to refresh the list.";}
    renderManagedLibrary(message);status(message);
  });
});

const ctx = await enterGame({ bar:$("playerBar") });
if (ctx) {
  playerContext = ctx;
  storageKey = "mrl-editor-v1:" + ctx.player.uid;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved !== null) {
      const draft = preparePuzzleData(saved);
      pieces=draft.pieces; difficulty=draft.difficulty; exitRow=draft.exitRow;
      if (validPuzzleId(saved.libraryId) && Number.isSafeInteger(saved.libraryRevision) && saved.libraryRevision>=0) {
        libraryId=saved.libraryId; libraryRevision=saved.libraryRevision;
        knownLibraryRevisions.set(libraryId,libraryRevision);
      }
      $("puzzleTitle").value=typeof saved.title==="string" && saved.title.length<=80 ? saved.title : "Untitled puzzle";
      nextId=nextPieceId(pieces);
      status("Restored locally saved draft for " + ctx.player.code + ".");
      // SL and CJ may persist migrations. Other players can still read their old drafts.
      if (["SL", "CJ"].includes(ctx.player.code) &&
          (saved.difficulty !== difficulty || saved.exitRow !== exitRow ||
           JSON.stringify(saved.pieces) !== JSON.stringify(pieces))) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({...draft, nextId, savedAt:saved.savedAt,
            title:$("puzzleTitle").value,libraryId,libraryRevision}));
        } catch (_) { status("Draft restored. The device could not save its updated format."); }
      }
    }
  } catch(error) { status("Could not restore saved draft. The saved data was kept. Import a valid JSON file."); }
  if (["SL", "CJ"].includes(ctx.player.code)) {
    try { migrateTierSlots(storageKey); } catch (_) { /* Keep valid drafts usable if device storage is unavailable. */ }
  }
  render();
}
