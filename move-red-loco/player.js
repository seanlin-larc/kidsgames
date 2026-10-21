import { enterGame, withTimeout } from "../shared/gate.js";
import { TIERS } from "./puzzle-data.js";
import { normalizeLibraryPuzzle } from "./library-data.js";
import { validatePuzzle } from "./solver.js";
import { createAttempt, layoutKey } from "./player-state.js";
import { createProgressStore } from "./progress-store.js";
import { LIBRARY_ENABLED } from "./library-config.js";

const $ = id => document.getElementById(id);
const directions = {right:"→",left:"←",up:"↑",down:"↓"};
const media = matchMedia("(prefers-color-scheme: dark)");
function theme(mode, save = false) {
  document.documentElement.dataset.themeSetting = mode;
  const dark = mode === "dark" || (mode === "auto" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("themeBtn").textContent = "Appearance: " + mode[0].toUpperCase() + mode.slice(1);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#101c30" : "#e5eef7";
  if (save) try {
    if (mode === "auto") localStorage.removeItem("mrl-theme");
    else localStorage.setItem("mrl-theme", mode);
  } catch (_) { /* Appearance remains usable without storage. */ }
}
theme(document.documentElement.dataset.themeSetting || "auto");
$("themeBtn").onclick = () => theme(({light:"dark",dark:"auto",auto:"light"})[document.documentElement.dataset.themeSetting], true);
media.addEventListener("change", () => theme(document.documentElement.dataset.themeSetting));

const context = await enterGame({bar:$("playerBar")});
if (context) await initialize(context);

async function initialize(context) {
  const uid = context.player.uid;
  $("workshop").hidden = !["SL", "CJ"].includes(context.player.code);
  if (matchMedia("(max-width: 700px)").matches) $("movePanel").open = false;
  const progress = createProgressStore({storage:localStorage, uid, cloud:() => import("./player-firestore.js")});
  const cacheKey = "mrl-library-v1:" + uid;
  let puzzles = [], selected = null, current = null, attempt = null, selectedPiece = null;
  let drag = null, replaying = false, replayGeneration = 0, recorded = false, storageError = "";
  const status = text => { $("status").textContent = text; };
  const online = () => navigator.onLine !== false;

  function progressMessage(error = "") {
    $("progressStatus").textContent = storageError || (error ? "Progress sync is unavailable. " : "") +
      (progress.pending ? progress.pending + " solved puzzle" + (progress.pending === 1 ? "" : "s") + " waiting to sync. Keep this device's site data." :
        error ? "Saved progress on this device remains available." : "");
  }
  async function syncProgress() {
    if (!online()) return progressMessage();
    try { await withTimeout(progress.sync(), 15000); progressMessage(); }
    catch (error) { progressMessage(error.message); }
    renderChoices();
  }
  function recordCompletion() {
    if (!attempt.won || recorded) return;
    recorded = true;
    try {
      progress.complete({puzzleId:current.id, layoutKey:current.layoutKey, moves:attempt.moves, solvedAt:Date.now()});
      storageError = "";
    } catch (error) { storageError = "Could not save progress on this device: " + error.message; }
    progressMessage();
    void syncProgress();
  }
  function renderChoices() {
    const groups = $("puzzleTiers"); groups.replaceChildren();
    for (const tier of TIERS) {
      const section = document.createElement("section"); section.className = "tier-group";
      const heading = document.createElement("h3"); heading.textContent = tier; section.append(heading);
      const entries = puzzles.filter(p => p.difficulty === tier);
      if (!entries.length) {
        const empty = document.createElement("p"); empty.className = "quiet"; empty.textContent = "No saved puzzles in this tier."; section.append(empty);
      }
      const grid = document.createElement("div"); grid.className = "puzzle-grid";
      for (const puzzle of entries) {
        const solved = progress.has(puzzle.id, puzzle.layoutKey);
        const button = document.createElement("button"); button.type = "button";
        button.className = "puzzle-choice" + (solved ? " solved" : ""); button.dataset.puzzleId = puzzle.id;
        button.setAttribute("aria-pressed", String(selected?.id === puzzle.id));
        const title = document.createElement("span"); title.textContent = puzzle.title;
        const detail = document.createElement("small");
        detail.textContent = puzzle.problem ? "Needs a workshop correction" : solved ? "✓ Solved" : "Not solved yet";
        button.append(title, detail);
        button.onclick = () => {
          selected = puzzle; renderChoices();
          $("libraryStatus").textContent = puzzle.problem ? "Cannot play this puzzle yet: " + puzzle.problem : "Selected: " + puzzle.title;
          groups.querySelector('[data-puzzle-id="' + puzzle.id + '"]')?.focus({preventScroll:true});
        };
        grid.append(button);
      }
      section.append(grid); groups.append(section);
    }
    $("play").disabled = !selected || !!selected.problem;
  }
  async function loadLibrary() {
    $("refresh").disabled = true; $("play").disabled = true;
    $("libraryStatus").textContent = "Loading the family puzzle library…";
    try {
      let entries, message = "";
      if (online() && LIBRARY_ENABLED) {
        try {
          entries = await withTimeout(import("./library-firestore.js").then(store => store.listPuzzles()), 15000);
          try { localStorage.setItem(cacheKey, JSON.stringify(entries)); }
          catch (_) { message = "Puzzles loaded. This device could not retain an offline copy."; }
        } catch (error) { message = "Could not refresh the library. Showing this device's saved copy."; }
      }
      if (!entries) {
        const cached = localStorage.getItem(cacheKey);
        if (!cached) throw Error(online() ? "The puzzle library could not load. Try Refresh puzzles when the connection is available." : "No puzzle library is saved on this device. Connect to load it first.");
        entries = JSON.parse(cached);
        if (!Array.isArray(entries)) throw Error("The saved library is unreadable. Connect and refresh puzzles.");
        message ||= "Offline library: puzzles saved on this device.";
      }
      const checked = entries.map(normalizeLibraryPuzzle).sort((a,b) => TIERS.indexOf(a.difficulty) - TIERS.indexOf(b.difficulty) || a.title.localeCompare(b.title, undefined, {numeric:true}) || a.id.localeCompare(b.id));
      puzzles = await Promise.all(checked.map(async p => ({...p, layoutKey:await layoutKey(p), problem:validatePuzzle(p.pieces,p.exitRow).join(" ")})));
      selected = puzzles.find(p => p.id === selected?.id) || null;
      $("libraryStatus").textContent = puzzles.length ? message || "Every saved puzzle is listed below." : "No puzzles have been saved yet.";
    } catch (error) { $("libraryStatus").textContent = error.message; }
    finally { $("refresh").disabled = false; renderChoices(); }
  }
  function renderBoard(pieces, locked = false) {
    const board = $("board"); board.replaceChildren();
    for (const piece of pieces) {
      const button = document.createElement("button"); button.type = "button";
      button.className = "piece" + (piece.id === "red" ? " red" : ""); button.dataset.pieceId = piece.id;
      Object.assign(button.style, {left:piece.x / 7 * 100 + "%", top:piece.y / 7 * 100 + "%", width:piece.w / 7 * 100 + "%", height:piece.h / 7 * 100 + "%"});
      if (piece.id !== "red") button.style.backgroundColor = "hsl(" + piece.hue + " 67% 73%)";
      button.textContent = piece.label || piece.id; button.disabled = locked;
      button.setAttribute("aria-pressed", String(selectedPiece === piece.id));
      button.setAttribute("aria-label", (piece.id === "red" ? "Red locomotive" : "Piece " + piece.label) + ", column " + (piece.x+1) + ", row " + (piece.y+1));
      board.append(button);
    }
  }
  function renderMoves(history, active = -1) {
    const list = $("moveList"); list.replaceChildren();
    history.forEach((move, index) => {
      const item = document.createElement("li");
      item.textContent = move.label + " " + directions[move.direction] + " " + move.cells;
      item.setAttribute("aria-label", "Move " + (index+1) + ": " + move.label + " " + move.direction + " " + move.cells + (move.cells === 1 ? " cell" : " cells"));
      if (index === active) item.className = "active";
      list.append(item);
    });
    $("noMoves").hidden = history.length > 0;
    if (active >= 0) {
      const item = list.children[active], panel = $("movePanel");
      if (item) panel.scrollTop += item.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom;
    }
    else if (history.length) $("movePanel").scrollTop = $("movePanel").scrollHeight;
  }
  function render() {
    if (!attempt) return;
    renderBoard(attempt.pieces, attempt.won || replaying);
    for (const [id, row] of [["upperExit", 2], ["lowerExit", 3]]) {
      $(id).textContent = row === current.exitRow ? "→" : "×";
      $(id).classList.toggle("active", row === current.exitRow);
      $(id).setAttribute("aria-label", row === current.exitRow ? "Designated open exit" : "Closed exit");
    }
    $("moveCount").textContent = "Moves: " + attempt.moves;
    $("undo").disabled = replaying || !attempt.canUndo; $("redo").disabled = replaying || !attempt.canRedo;
    $("restart").disabled = replaying;
    $("completion").hidden = !attempt.won;
    $("completionMessage").textContent = "Solved in " + attempt.moves + (attempt.moves === 1 ? " move!" : " moves!");
    $("replay").disabled = replaying || !attempt.history.length;
    $("again").disabled = replaying;
    renderMoves(attempt.history);
  }
  function finish() {
    if (attempt.won) selectedPiece = null;
    recordCompletion(); render();
    if (attempt.won) {
      status("Congratulations! The exit path is clear.");
      $("completionTitle").focus({preventScroll:true});
      $("completion").scrollIntoView({block:"nearest"});
    }
  }
  function showSelector() {
    replayGeneration++; replaying = false; drag = null;
    if (attempt) render();
    $("playing").hidden = true; $("selector").hidden = false; $("resume").hidden = !attempt;
    renderChoices(); $("selectorTitle").focus(); void syncProgress();
  }
  function showPlaying() { $("selector").hidden = true; $("playing").hidden = false; render(); $("puzzleHeading").focus(); }
  $("play").onclick = () => {
    if (!selected || selected.problem) return;
    if (attempt && !attempt.won && attempt.moves && !confirm("Leave this attempt and start the selected puzzle?")) return;
    current = structuredClone(selected); attempt = createAttempt(current); selectedPiece = null; recorded = false;
    $("tier").textContent = current.difficulty; $("puzzleHeading").textContent = current.title;
    status("Slide the pieces to clear the red locomotive's exit path."); showPlaying(); finish();
  };
  $("choose").onclick = showSelector; $("another").onclick = showSelector; $("resume").onclick = showPlaying;
  $("refresh").onclick = () => { void loadLibrary(); void syncProgress(); };
  function restart() {
    if (!attempt || replaying) return;
    if (!attempt.won && attempt.moves && !confirm("Restart this puzzle and clear this attempt's moves?")) return;
    attempt.restart(); selectedPiece = null; recorded = false; status("Puzzle restarted."); finish();
  }
  $("restart").onclick = restart; $("again").onclick = restart;
  function historyAction(action) {
    if (!attempt || replaying || !attempt[action]()) return;
    finish(); if (!attempt.won) status(action === "undo" ? "Move undone." : "Move restored.");
  }
  $("undo").onclick = () => historyAction("undo"); $("redo").onclick = () => historyAction("redo");
  function slide(id, dx, dy) {
    if (!attempt || replaying) return;
    const moved = attempt.slide(id, dx, dy);
    finish();
    if (!attempt.won) {
      status(moved ? "Moves: " + attempt.moves : "That slide is blocked. Trains move along their own axis.");
      $("board").querySelector('[data-piece-id="' + id + '"]')?.focus({preventScroll:true});
    }
  }
  $("board").addEventListener("pointerdown", event => {
    const piece = event.target.closest("[data-piece-id]");
    if (!piece || !attempt || attempt.won || replaying || event.button !== 0 || drag) return;
    event.preventDefault(); selectedPiece = piece.dataset.pieceId;
    drag = {id:selectedPiece, pointer:event.pointerId, x:event.clientX, y:event.clientY, size:$("board").getBoundingClientRect().width / 7};
    $("board").setPointerCapture(event.pointerId); renderBoard(attempt.pieces);
  });
  $("board").addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const piece = attempt.pieces.find(p => p.id === drag.id);
    let x = event.clientX-drag.x, y = event.clientY-drag.y;
    if (piece.axis === "h") y = 0;
    else if (piece.axis === "v") x = 0;
    else if (Math.abs(x) >= Math.abs(y)) y = 0; else x = 0;
    $("board").querySelector('[data-piece-id="' + drag.id + '"]').style.transform = "translate(" + x + "px," + y + "px)";
  });
  $("board").addEventListener("pointerup", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const start = drag; drag = null;
    const piece = attempt.pieces.find(p => p.id === start.id);
    let dx = Math.round((event.clientX-start.x)/start.size), dy = Math.round((event.clientY-start.y)/start.size);
    if (piece.axis === "h") dy = 0; else if (piece.axis === "v") dx = 0;
    else if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
    if (dx || dy) slide(start.id, dx, dy);
    else { render(); $("board").querySelector('[data-piece-id="' + start.id + '"]')?.focus({preventScroll:true}); }
  });
  $("board").addEventListener("pointercancel", () => { drag = null; render(); });
  $("board").addEventListener("focusin", event => {
    const piece = event.target.closest("[data-piece-id]");
    if (!piece) return;
    selectedPiece = piece.dataset.pieceId;
    $("board").querySelectorAll(".piece").forEach(button => button.setAttribute("aria-pressed", String(button === piece)));
  });
  document.addEventListener("keydown", event => {
    if (!attempt || $("playing").hidden || replaying || drag || event.altKey) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "z") { event.preventDefault(); historyAction(event.shiftKey ? "redo" : "undo"); return; }
    if (command && event.key.toLowerCase() === "y") { event.preventDefault(); historyAction("redo"); return; }
    const vector = {ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (vector && selectedPiece && $("board").contains(document.activeElement) && !command) { event.preventDefault(); slide(selectedPiece, ...vector); }
  });
  $("replay").onclick = async () => {
    if (!attempt?.won || replaying || !attempt.history.length) return;
    const generation = ++replayGeneration, history = attempt.history;
    replaying = true; selectedPiece = null; render();
    renderBoard(history[0].before, true); $("moveCount").textContent = "Moves: 0";
    status("Replaying your moves…");
    for (let index = 0; index < history.length; index++) {
      await new Promise(resolve => setTimeout(resolve, 550));
      if (generation !== replayGeneration) return;
      renderBoard(history[index].after, true); renderMoves(history, index); $("moveCount").textContent = "Moves: " + (index+1);
    }
    replaying = false; render(); status("Replay finished. Your final position is restored.");
  };
  window.addEventListener("online", () => { void syncProgress(); void loadLibrary(); });
  window.addEventListener("offline", () => progressMessage());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void syncProgress(); });
  window.addEventListener("storage", event => { if (event.key === cacheKey) void loadLibrary(); });
  await loadLibrary(); void syncProgress();
}
