import { validatePuzzle } from "./solver.js";
import { attemptSlide, attemptExit } from "./play-rules.js";
import { enterGame } from "../shared/gate.js";

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
const TEMPLATES = Object.freeze({
  red:      { type:"red",      w:2, h:1, axis:"h",    color:"red",    label:"RED", name:"Red locomotive" },
  h2:       { type:"h2",       w:2, h:1, axis:"h",    color:"blue",   label:"H2",  name:"Short train" },
  v2:       { type:"v2",       w:1, h:2, axis:"v",    color:"green",  label:"V2",  name:"Vertical train" },
  h3:       { type:"h3",       w:3, h:1, axis:"h",    color:"gold",   label:"H3",  name:"Long train" },
  v3:       { type:"v3",       w:1, h:3, axis:"v",    color:"purple", label:"V3",  name:"Tall train" },
  platform: { type:"platform", w:2, h:2, axis:"both", color:"slate", label:"P",   name:"Square platform" }
});
const TIERS = ["Beginner","Medium","Hard","Crazy"];
const normalizeTier = tier => tier === "Intermediate" ? "Medium" : tier;
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
    if (!pool.includes(p.label) || used[group].has(p.label)) p.label = [...pool].find(x => !used[group].has(x));
    if (!p.label) throw Error("Too many pieces of type " + group + " (label slots exhausted).");
    used[group].add(p.label);
  }
  return list;
}
const portraitPhone = () => window.matchMedia("(max-width: 600px) and (orientation: portrait)").matches;
let pieces = [], nextId = 1, difficulty = "Beginner", exitRow = 2; // J5 selected by default
let selectedTemplate = null, selectedId = null, undoStack = [], redoStack = [];
let pointerDrag = null, dragPreview = null, worker = null, testRequest = 0;
let storageKey = null;
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
function snapshot() { return { pieces:clone(pieces), nextId, difficulty, exitRow }; }
function applySnapshot(s) {
  pieces = clone(s.pieces); nextId = s.nextId; difficulty = s.difficulty; exitRow = s.exitRow;
  selectedId = null; selectedTemplate = null; invalidateTest(); render();
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
  $("testResult").textContent = "—";
  $("testResult").className = "";
  $("test").disabled = false;
  clearHover();
}
function selectTemplate(type) {
  if (mode !== "build") return;
  $("mobilePicker").hidden = true;
  selectedTemplate = selectedTemplate === type ? null : type;
  selectedId = null;
  render();
  status(selectedTemplate ? "Selected " + TEMPLATES[type].name + ". Drag it to the board or tap a cell." : "No module selected.");
}
function selectPiece(id) {
  selectedId = id;
  selectedTemplate = null;
  render();
  status("Selected " + byId(id)?.id + ". Drag to reposition, use arrow keys, or remove.");
}
function addTemplate(type, x, y) {
  if (mode !== "build") return;
  const t = TEMPLATES[type];
  if (!t) return;
  if (type === "red" && byId("red")) return status("Only one red locomotive is allowed.");
  const label = nextPieceLabel(type);
  if (!label) return status("No available labels for this block type. Remove an existing one first.");
  if (type === "red" && ![2,3].includes(y)) return status("The red locomotive can only be placed in board row 3 or 4.");
  const p = { id:type === "red" ? "red" : type + "-" + nextId, type, x, y, w:t.w, h:t.h, axis:t.axis, label };
  if (!fits(p)) return status("This module does not fit. Choose an empty area.");
  recordEdit();
  if (type !== "red") nextId++;
  pieces.push(p);
  if (type === "red") exitRow = y;
  selectedTemplate = null;
  selectedId = p.id;
  modified("Added " + t.name);
}
function movePiece(id, x, y) {
  if (mode !== "build") return;
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
  if (mode !== "build") return;
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
  if (mode !== "build") return;
  if (!selectedId) return;
  const id = selectedId;
  recordEdit();
  pieces = pieces.filter(p => p.id !== id);
  selectedId = null;
  modified("Removed " + id);
}
function undo() {
  if (mode !== "build") return;
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  applySnapshot(undoStack.pop());
  status("Undo completed.");
}
function redo() {
  if (mode !== "build") return;
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
    const label = move.id === "red" ? "R" :
      move.id.startsWith("platform") ? "P" : move.id.split("-")[0].toUpperCase();
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
  const title = piece ? TEMPLATES[piece.type]?.name || id : id;
  const verb = {right:"right",left:"left",up:"up",down:"down",exit:"out"}[direction];
  playHistory.push({
    id, direction, cells, won, after:clone(pieces),
    description:title + " " + verb + " " + cells + (cells === 1 ? " cell" : " cells")
  });
  playMoves = playHistory.length;
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
    playWon = true;
    selectedId = null;
    recordPlayMove(id, "exit", 8 - oldX - piece.w, true);
    render();
    renderMoveLog(-1, true);
    status("The red locomotive escaped through J" + (exitRow + 3) +
      " in " + playMoves + " moves. Replay to review your moves.");
    return;
  }
  piece.x = result.x;
  piece.y = result.y;
  const direction = result.x > oldX ? "right" : result.x < oldX ? "left" :
    result.y > oldY ? "down" : "up";
  const cells = Math.abs(result.x - oldX) + Math.abs(result.y - oldY);
  recordPlayMove(id, direction, cells, false);
  render();
  renderMoveLog(-1, true);
  status("Play preview: " + playMoves + " moves. Use the active exit when the path is clear.");
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
  if (next === mode) return;
  ++replayGeneration;
  replaying = false;
  if (pointerDrag) finishDrag();
  closeSaveMenu();
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
    render();
    status("Play: each legal slide counts as one move. Use Replay to review recorded moves.");
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
  if (mode !== "play") document.querySelector(".sheet").dataset.mobileLog = "closed";
  $("buildMode").setAttribute("aria-pressed", String(mode === "build"));
  $("playMode").setAttribute("aria-pressed", String(mode === "play"));
  $("playInfo").textContent = mode === "build" ? "Build mode" : replaying ? "Replaying…" : playWon ? "Solved!" : "Playing";
  $("replay").disabled = mode !== "play" || replaying || playHistory.length === 0;
  $("test").textContent = mode === "play" ? "Moves" : "Test";
  if (mode === "play") {
    $("testResult").textContent = String(playMoves);
    $("testResult").className = "ok";
  }
  renderMoveLog();
  document.querySelectorAll(".palette-card").forEach(el => {
    el.setAttribute("aria-disabled", String(mode === "play"));
    el.tabIndex = mode === "play" ? -1 : 0;
  });
  document.querySelectorAll(".exit-gate").forEach(el => {
    const active = Number(el.dataset.exitRow) === exitRow;
    el.setAttribute("aria-pressed", String(active));
    el.querySelector(".arrow").textContent = active ? "→" : "×";
    el.title = active ? "Active exit J" + (exitRow + 3) : "Select exit J" + (Number(el.dataset.exitRow) + 3);
  });
  $("reset").disabled = mode === "play";
  $("undo").disabled = mode === "play" || !undoStack.length;
  $("redo").disabled = mode === "play" || !redoStack.length;
  $("save").disabled = mode === "play";
  $("test").disabled = mode === "build" && !!worker;
  document.querySelectorAll("#saveMenu button,.extras button,.details button").forEach(el => {
    el.disabled = mode === "play" || (el.id === "remove" && !selectedId) ||
      (el.id === "rotate" && (!selectedId || ["red","platform"].includes(byId(selectedId)?.type))) ||
      (el.id === "clearSelection" && !selectedId && !selectedTemplate);
  });
  document.querySelectorAll(".exit-gate").forEach(el => {
    el.disabled = mode === "play" && Number(el.dataset.exitRow) !== exitRow;
    el.setAttribute("aria-label", mode === "play" ?
      (Number(el.dataset.exitRow) === exitRow ? "Try exiting through this gate" : "Closed exit") :
      "Select exit J" + (Number(el.dataset.exitRow) + 3));
  });
  updateFloatingTemplate();
  const p = byId(selectedId);
  $("selectedInfo").textContent = mode === "play" ? "Play preview — editing tools are disabled." :
    p ? TEMPLATES[p.type].name + " (" + p.id + ") at " + String.fromCharCode(65+p.x) + (p.y+1) : selectedTemplate
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
function templateAnchor(clientX, clientY, type) {
  const t = TEMPLATES[type], r = boardRect(), size = cellSize();
  // Center of dragged block follows the pointer, including even-width blocks.
  return { x:Math.round((clientX-r.left)/size - t.w/2),
    y:Math.round((clientY-r.top)/size - t.h/2) };
}
function beginDrag(event, data) {
  if (event.button !== 0 || pointerDrag || (mode === "play" && data.kind !== "play")) return;
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
function createPreview(type) {
  const t = TEMPLATES[type];
  dragPreview = document.createElement("div");
  dragPreview.className = "piece dragging " + t.color;
  const label = document.createElement("span");
  label.className = "piece-label";
  label.textContent = nextPieceLabel(type) || t.label;
  dragPreview.appendChild(label);
  dragPreview.style.position = "fixed";
  dragPreview.style.zIndex = "1000";
  dragPreview.style.pointerEvents = "none";
  dragPreview.style.width = (t.w * cellSize()) + "px";
  dragPreview.style.height = (t.h * cellSize()) + "px";
  document.body.appendChild(dragPreview);
}
function dragMove(event) {
  const d = pointerDrag;
  if (!d || event.pointerId !== d.pointerId) return;
  const dist = Math.hypot(event.clientX-d.startX, event.clientY-d.startY);
  if (dist > 6) d.moved = true;
  if (!d.moved) return;
  if (d.kind === "palette") {
    if (!dragPreview) createPreview(d.type);
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
    highlightFootprint({ ...piece, ...d.proposed }, valid);
    const original = board.querySelector('.piece[data-piece-id="' + d.id + '"]');
    if (original) original.classList.toggle("invalid", !valid);
  }
}
function finishDrag() {
  document.removeEventListener("pointermove",dragMove);
  document.removeEventListener("pointerup",dragEnd);
  document.removeEventListener("pointercancel",dragCancel);
  if (dragPreview) { dragPreview.remove(); dragPreview = null; }
  clearHover();
  board.querySelectorAll(".piece.invalid").forEach(el=>el.classList.remove("invalid"));
  pointerDrag = null;
}
function dragEnd(event) {
  const d = pointerDrag;
  if (!d || event.pointerId !== d.pointerId) return;
  finishDrag();
  if (d.kind === "palette") {
    if (!d.moved) selectTemplate(d.type);
    else if (d.proposed && insideBoard(event.clientX,event.clientY)) addTemplate(d.type,d.proposed.x,d.proposed.y);
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
  if (event.button !== 0) return;
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
  const row = Number(btn.dataset.exitRow);
  if (mode === "play") {
    if (row === exitRow) exitPlayable();
    return;
  }
  if (![2,3].includes(row) || row === exitRow) return;
  recordEdit();
  exitRow = row;
  modified("Active exit is now J" + (row + 3) + ". Only one exit is open");
}));
$("reset").addEventListener("click",()=>{
  if (mode !== "build" || !pieces.length) return;
  if (!confirm("Remove every module from this puzzle? You can still Undo.")) return;
  recordEdit(); pieces=[]; selectedId=null; selectedTemplate=null;
  modified("Cleared the board");
});
$("undo").addEventListener("click",undo);
$("redo").addEventListener("click",redo);
$("rotate").addEventListener("click",rotateSelected);
$("remove").addEventListener("click",removeSelected);
$("clearSelection").addEventListener("click",()=>{ if(mode!=="build")return; selectedId=null; selectedTemplate=null; render();status("Selection cleared."); });
document.addEventListener("keydown", e=>{
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

$("test").addEventListener("click",()=>{
  if (mode === "play") {
    const log = $("moveLog");
    log.scrollTop = log.scrollHeight;
    log.focus({ preventScroll:true });
    return;
  }
  if (mode !== "build") return;
  const errors = validatePuzzle(pieces, exitRow);
  if (errors.length) {
    $("testResult").textContent = "!";
    $("testResult").className = "bad";
    status("Cannot test: " + errors.join(" "));
    return;
  }
  invalidateTest();
  const id = ++testRequest;
  $("testResult").textContent = "…";
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
      $("testResult").textContent = result.steps + " steps";
      $("testResult").className = "ok";
      status("Solvable in " + result.steps + " moves (optimal). Searched " + result.visited.toLocaleString() + " states.");
    } else if (result.status==="unsolvable") {
      $("testResult").textContent="X";
      $("testResult").className="bad";
      status("Unsolvable: every reachable board state was checked (" + result.visited.toLocaleString() + ").");
    } else if (result.status==="limit") {
      $("testResult").textContent="?";
      $("testResult").className="busy";
      status("Inconclusive. Search reached " + result.maxStates.toLocaleString() + " explored states. This does not prove unsolvability.");
    } else {
      $("testResult").textContent="!";
      $("testResult").className="bad";
      status("Test error: " + (result.message || (result.errors||[]).join("; ")));
    }
  };
  worker.onerror = error=>{
    if (id!==testRequest) return;
    worker?.terminate();worker=null;$("test").disabled=false;
    $("testResult").textContent="!";$("testResult").className="bad";
    status("Solver could not start: " + error.message);
  };
  worker.postMessage({requestId:id,pieces:clone(pieces),exitRow});
});

function documentData() {
  return { format:"move-red-loco-editor-v1", difficulty, exitRow, pieces:clone(pieces) };
}
function closeSaveMenu() {
  $("saveMenu").hidden = true;
  $("save").setAttribute("aria-expanded","false");
}
$("save").addEventListener("click",()=>{
  if (mode !== "build") return;
  const willOpen = $("saveMenu").hidden;
  $("saveMenu").hidden = !willOpen;
  $("save").setAttribute("aria-expanded",String(willOpen));
});
document.addEventListener("pointerdown", event=>{
  if (!event.target.closest("#saveBox")) closeSaveMenu();
});
document.querySelectorAll("[data-save-tier]").forEach(btn=>btn.addEventListener("click",()=>{
  if (mode !== "build" || !storageKey) return;
  const tier = btn.dataset.saveTier;
  if (!TIERS.includes(tier)) return;
  try {
    const draft = { ...documentData(), difficulty:tier, nextId, savedAt:new Date().toISOString() };
    // Each tier has its own saved slot, as well as the latest working draft.
    localStorage.setItem(storageKey + ":" + tier.toLowerCase(),JSON.stringify(draft));
    localStorage.setItem(storageKey,JSON.stringify(draft));
    if (difficulty !== tier) { recordEdit(); difficulty = tier; }
    closeSaveMenu(); render();
    status("Saved as " + tier + " on this device. Export JSON for a portable copy.");
  } catch(error) {
    closeSaveMenu(); status("Could not save locally: " + error.message);
  }
}));
$("export").addEventListener("click",()=>{
  if (mode !== "build") return;
  const data = JSON.stringify(documentData(),null,2)+"\n";
  const blob = new Blob([data],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="move-red-loco-" + difficulty.toLowerCase() + ".json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  status("Exported puzzle JSON. Saved files contain no account data.");
});
$("import").addEventListener("click",()=>{if(mode==="build")$("importFile").click();});
$("importFile").addEventListener("change",async event=>{
  if (mode !== "build") return;
  const file=event.target.files?.[0];
  event.target.value="";
  if (!file) return;
  try {
    if (file.size > 100000) throw Error("File is too large.");
    const data=JSON.parse(await file.text());
    if (data.format!=="move-red-loco-editor-v1" || !TIERS.includes(normalizeTier(data.difficulty)) ||
        !Array.isArray(data.pieces) || data.pieces.length>35) throw Error("Not a supported puzzle file.");
    if (data.exitRow !== undefined && ![2,3].includes(data.exitRow)) throw Error("Exit must be J5 or J6.");
    const ids=new Set(), imported=[];
    for (const p of data.pieces) {
      const t=TEMPLATES[p.type];
      if (!t || typeof p.id!=="string" || p.id.length>45 || ids.has(p.id) ||
          (p.type==="red" ? p.id!=="red" : !/^(h2|v2|h3|v3|platform)-[0-9]+$/.test(p.id)) ||
          ![p.x,p.y,p.w,p.h].every(Number.isInteger) || p.w<1 || p.h<1 ||
          ((p.w===t.w && p.h===t.h) ? p.axis!==t.axis :
           (p.type==="red" || p.type==="platform" || p.w!==t.h || p.h!==t.w || p.axis!==(t.axis==="h"?"v":"h")))) {
        throw Error("Invalid module in the file.");
      }
      ids.add(p.id);
      imported.push({id:p.id,type:p.type,x:p.x,y:p.y,w:p.w,h:p.h,axis:p.axis,
        label:typeof p.label === "string" ? p.label : undefined});
    }
    // A draft may lack its red locomotive, but it must still fit and have no overlaps.
    for (let i=0;i<imported.length;i++) {
      const p=imported[i];
      if (p.x<0||p.y<0||p.x+p.w>7||p.y+p.h>7 ||
          imported.slice(0,i).some(q=>p.x<q.x+q.w&&p.x+p.w>q.x&&p.y<q.y+q.h&&p.y+p.h>q.y)) {
        throw Error("The file contains overlapping or off-board modules.");
      }
    }
    recordEdit();
    repairPieceLabels(imported);
    pieces=imported; difficulty=normalizeTier(data.difficulty);
    // A red locomotive always determines which exit is open.
    exitRow = imported.find(p => p.id==="red")?.y ?? data.exitRow ?? 2;
    nextId=Math.max(1,...pieces.map(p=>Number(p.id.match(/[0-9]+$/)?.[0]||0)+1));
    selectedId=null;selectedTemplate=null;
    modified("Imported " + pieces.length + " modules");
  } catch(error) { status("Import rejected: " + error.message); }
});

const ctx = await enterGame({ bar:$("playerBar") });
if (ctx) {
  storageKey = "mrl-editor-v1:" + ctx.player.uid;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.format==="move-red-loco-editor-v1" && Array.isArray(saved.pieces) && TIERS.includes(normalizeTier(saved.difficulty))) {
      // Use the same constrained import validation for saved drafts at the next explicit import.
      // Local drafts contain only this editor's own schema.
      pieces=repairPieceLabels(saved.pieces); difficulty=normalizeTier(saved.difficulty);
      // Legacy drafts always align the gate to the locomotive when present.
      exitRow = pieces.find(p=>p.id==="red" && [2,3].includes(p.y))?.y ??
        ([2,3].includes(saved.exitRow) ? saved.exitRow : 2);
      nextId=saved.nextId || 1;
      status("Restored locally saved draft for " + ctx.player.code + ".");
    }
  } catch(error) { status("Could not restore saved draft."); }
  render();
}
