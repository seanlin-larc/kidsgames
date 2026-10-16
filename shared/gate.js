// Sign-in gate and player bar for every Kids Games page.
//
// Rules (Sean, 2026-10-15):
// - Play only when signed in. Online: Firebase checks the sign-in.
// - Offline: play only with a check-out on this device (48 hours, made while online).
// - Finished games are kept on the device and sent to Firestore when online.
// - Every game shows the player, an offline warning icon, a check-out button and a sign-out button.
//
// Use in a game:
//   const gate = await import("../shared/gate.js");
//   const ctx = await gate.enterGame({ bar: document.getElementById("who") });
//   if (ctx) { ... ctx.player.code, ctx.saveWin(game, level, time), ctx.logResult(game, level, won, score) }
// enterGame sends the page to the menu when nobody may play, and then returns null.

import * as S from "./session.js";

S.registerServiceWorker();

const FAMILY_URL = new URL("./family.js", import.meta.url).href;
const MENU_URL = new URL("../", import.meta.url).href;

export function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("timeout"), { code: "app/timeout" })), ms))]);
}

let familyPromise = null;
export function loadFamily() {
  if (!familyPromise) {
    familyPromise = withTimeout(import(FAMILY_URL), 10000).catch(e => {
      console.warn("[kidsgames] Firebase did not load:", e);
      familyPromise = null;           // try again next time
      return null;
    });
  }
  return familyPromise;
}

// Finds out who may play on this page.
// Returns { mode, family, player, checkout }:
//   mode "online"     signed in, checked with Firebase
//   mode "checkout"   offline, with a check-out on this device
//   mode "signed-out" nobody is signed in
//   mode "offline"    no network (or Firebase blocked) and no check-out
export async function access() {
  const family = await loadFamily();
  let err = null;
  if (family) {
    try {
      const player = await withTimeout(family.currentPlayer(), 7000);
      if (!player) { S.endCheckout(); return { mode: "signed-out", family }; }
      const c = S.getCheckout();
      if (c && c.uid !== player.uid) S.endCheckout();
      family.flushOutbox().catch(() => {});
      return { mode: "online", family, player, checkout: S.getCheckout() };
    } catch (e) { err = e; }
    if (err && err.message === "no-player-record") {
      await family.signOutPlayer().catch(() => {});
      S.endCheckout();
      return { mode: "signed-out", family, error: err };
    }
  }
  // Offline (or Firebase blocked). A check-out lets the same account play.
  const c = S.getCheckout();
  if (c) {
    let uid = null;
    if (family) uid = await withTimeout(family.authUid(), 3000).catch(() => c.uid);
    if (!family || uid === c.uid) return { mode: "checkout", family, player: { uid: c.uid, code: c.code }, checkout: c };
    S.endCheckout();                 // the device is no longer signed in to that account
  }
  return { mode: "offline", family, error: err };
}

/* ---------- player bar ---------- */

const CSS = `
.kg-bar{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;vertical-align:middle}
.kg-bar b{font-weight:700}
.kg-bar button{font:inherit;font-size:.85rem;line-height:1.2;padding:4px 9px;border-radius:7px;border:1px solid currentColor;
  background:transparent;color:inherit;cursor:pointer}
.kg-bar button:disabled{opacity:.55;cursor:default}
.kg-bar .kg-off{font-size:.85rem;font-weight:700;padding:2px 7px;border-radius:7px;background:#b45309;color:#fff;cursor:help}
.kg-bar .kg-off[hidden]{display:none}
`;

function fmtTime(ms) {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// Draws the bar into "el" and keeps it up to date. Returns the ctx object used by the page.
export function mountBar(el, state, opts = {}) {
  if (!document.getElementById("kg-bar-css")) {
    const st = document.createElement("style");
    st.id = "kg-bar-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const menu = opts.menu || MENU_URL;
  el.textContent = "";
  const bar = document.createElement("span");
  bar.className = "kg-bar";
  bar.innerHTML = '<span>Playing as <b></b></span>' +
    '<span class="kg-off" role="img" hidden>⚠️ Offline</span>' +
    '<button type="button" data-act="checkout"></button>' +
    '<button type="button" data-act="signout">Sign out</button>';
  el.appendChild(bar);
  const codeEl = bar.querySelector("b"), offEl = bar.querySelector(".kg-off");
  const outBtn = bar.querySelector('[data-act="checkout"]'), signBtn = bar.querySelector('[data-act="signout"]');
  codeEl.textContent = state.player.code;

  const ctx = {
    get player() { return state.player; },
    get mode() { return state.mode; },
    online: () => state.mode === "online" && navigator.onLine !== false,

    // Saves a win for the family top 10. Resolves to the record id once it is in Firestore, else null.
    async saveWin(game, level, time) {
      const r = S.queue({ kind: "win", game, level, time, uid: state.player.uid, player: state.player.code });
      await send();
      draw();
      return S.inOutbox(r.id) ? null : r.id;
    },
    // Logs every finished game (won or lost). score = seconds (Minesweeper) or guesses (Word Guess).
    async logResult(game, level, won, score) {
      S.queue({ kind: "result", game, level, won: !!won, score, uid: state.player.uid, player: state.player.code });
      await send();
      draw();
    },
    async topTimes(game, level, n = 10) {
      if (state.mode !== "online" || !state.family) throw Object.assign(new Error("offline"), { code: "app/offline" });
      return withTimeout(state.family.topTimes(game, level, n), 8000);
    },
    refresh: () => draw()
  };

  async function send() {
    if (state.mode !== "online" || !state.family) return;
    try { await withTimeout(state.family.flushOutbox(), 15000); } catch (e) { /* stays in the outbox */ }
  }

  function draw() {
    const c = S.getCheckout();
    const off = state.mode !== "online" || navigator.onLine === false;
    const waiting = S.pendingCount(state.player.uid);
    offEl.hidden = !off;
    offEl.textContent = "⚠️ Offline" + (waiting ? " · " + waiting + " to send" : "");
    offEl.title = "No internet. Results are kept on this device and sent when you are online." +
      (c ? " Check-out ends " + fmtTime(c.until) + "." : "");
    offEl.setAttribute("aria-label", offEl.title);
    if (c) {
      outBtn.textContent = "✅ Checked out to " + fmtTime(c.until);
      outBtn.title = state.mode === "online" ? "Tap to end the check-out" : "You can play offline until this time";
    } else {
      outBtn.textContent = "📥 Check out";
      outBtn.title = "Play without internet on this device for " + S.CHECKOUT_HOURS + " hours";
    }
    outBtn.disabled = state.mode !== "online";
  }

  outBtn.addEventListener("click", () => {
    if (state.mode !== "online") return;
    if (S.getCheckout()) {
      if (!confirm("End the check-out on this device? You then need internet to play.")) return;
      S.endCheckout();
    } else {
      S.checkOut(state.player);
    }
    draw();
  });

  signBtn.addEventListener("click", async () => {
    const waiting = S.pendingCount(state.player.uid);
    const notes = [];
    if (state.mode !== "online") notes.push("You are offline. You need internet to sign in again.");
    if (S.getCheckout()) notes.push("This also ends the check-out.");
    if (waiting) notes.push(waiting + " result(s) are not sent yet. They stay on this device and are sent at your next sign-in.");
    if (notes.length && !confirm(notes.join("\n") + "\n\nSign out?")) return;
    signBtn.disabled = true;
    S.endCheckout();
    if (state.family) await withTimeout(state.family.signOutPlayer(), 4000).catch(e => console.warn("[kidsgames]", e));
    if (opts.onSignOut) opts.onSignOut(); else location.href = menu;
  });

  // Network changes: check the sign-in again when the device comes online.
  async function recheck() {
    if (navigator.onLine === false) { draw(); return; }
    const fresh = await access();
    if (fresh.mode === "online" && fresh.player.uid === state.player.uid) {
      Object.assign(state, fresh);
      await send();
    } else if (fresh.mode === "signed-out") {
      location.href = menu;
      return;
    }
    draw();
  }
  window.addEventListener("online", recheck);
  window.addEventListener("offline", () => draw());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) draw(); });

  // Offline play ends when the check-out ends.
  setInterval(() => {
    if (state.mode === "checkout" && !S.getCheckout()) {
      alert("The check-out has ended. You need internet to play.");
      location.href = menu;
    }
    draw();
  }, 60000);

  draw();
  return ctx;
}

// The gate for a game page. Returns the ctx, or null after it sends the page to the menu.
export async function enterGame({ bar, menu = MENU_URL }) {
  const state = await access();
  if (state.mode !== "online" && state.mode !== "checkout") {
    location.replace(menu);
    return null;
  }
  document.body.classList.remove("kg-wait");
  return mountBar(bar, state, { menu });
}
