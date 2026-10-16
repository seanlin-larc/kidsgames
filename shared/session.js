// Device-side session data for Kids Games. This file has no Firebase code, so it works offline.
//
// localStorage keys (all start with "kg-"):
//   kg-checkout  { uid, code, start, until, seen }  one check-out for this device (48 hours)
//   kg-lock      { CODE: { fails, until, at } }      wrong-PIN counter and lock for each player
//   kg-outbox    [ record, ... ]                     finished games that are not yet in Firestore
//
// All of these are on this device only. A user who clears the site data or uses another
// browser removes them. They stop mistakes and casual tries; they are not a hard guard.

// The five players. To add a player: make the account in Firebase Authentication
// (<code>@kidsgames.invalid), add a players/{uid} document with the code, and add one line here.
export const PLAYERS = [
  { code: "SL", email: "sl@kidsgames.invalid" },
  { code: "CJ", email: "cj@kidsgames.invalid" },
  { code: "YC", email: "yc@kidsgames.invalid" },
  { code: "JY", email: "jy@kidsgames.invalid" },
  { code: "Guest", email: "guest@kidsgames.invalid" }
];

export const CHECKOUT_HOURS = 48;   // offline play after a check-out
export const LOCK_FAILS = 10;       // wrong PINs in a row before a lock
export const LOCK_MINUTES = 30;     // length of the lock
const CLOCK_BACK_MS = 5 * 60 * 1000; // a device clock that moves back more than this ends a check-out
const OUTBOX_MAX = 500;

const KEY = { checkout: "kg-checkout", lock: "kg-lock", outbox: "kg-outbox" };

function read(key, empty) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? empty : v; }
  catch (e) { return empty; }
}
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }

/* ---------- check-out (play offline for 48 hours) ---------- */

// Returns the check-out of this device, or null if there is none or it ended.
export function getCheckout() {
  const c = read(KEY.checkout, null);
  if (!c || typeof c.uid !== "string" || typeof c.until !== "number") return null;
  const now = Date.now();
  if (now >= c.until || now < (c.seen || 0) - CLOCK_BACK_MS) { remove(KEY.checkout); return null; }
  if (now > c.seen) { c.seen = now; write(KEY.checkout, c); }
  return c;
}

// Starts (or renews) a check-out for the signed-in player. Call only after an online sign-in check.
export function checkOut(player) {
  const now = Date.now();
  const c = { uid: player.uid, code: player.code, start: now, until: now + CHECKOUT_HOURS * 3600 * 1000, seen: now };
  write(KEY.checkout, c);
  return c;
}

export function endCheckout() { remove(KEY.checkout); }

/* ---------- sign-in lock: 10 wrong PINs in a row -> 30 minutes ---------- */

// Returns { locked, until, left } for one player. "left" = wrong PINs left before the lock.
export function lockState(code) {
  const all = read(KEY.lock, {});
  const s = all[code];
  const now = Date.now();
  if (!s) return { locked: false, until: 0, left: LOCK_FAILS };
  if (s.until) {
    // Locked until "until". A device clock that is set back (now < at) keeps the lock.
    if (now < s.until || now < s.at) return { locked: true, until: Math.max(s.until, now + 60000), left: 0 };
    delete all[code];
    write(KEY.lock, all);
    return { locked: false, until: 0, left: LOCK_FAILS };
  }
  return { locked: false, until: 0, left: Math.max(0, LOCK_FAILS - (s.fails || 0)) };
}

// Counts one wrong PIN. Returns the new lockState.
export function recordFail(code) {
  const all = read(KEY.lock, {});
  const s = all[code] || { fails: 0 };
  s.fails = (s.fails || 0) + 1;
  if (s.fails >= LOCK_FAILS) {
    const now = Date.now();
    all[code] = { fails: 0, at: now, until: now + LOCK_MINUTES * 60 * 1000 };
  } else {
    all[code] = s;
  }
  write(KEY.lock, all);
  return lockState(code);
}

// A correct PIN clears the counter.
export function recordSuccess(code) {
  const all = read(KEY.lock, {});
  if (all[code]) { delete all[code]; write(KEY.lock, all); }
}

/* ---------- outbox: finished games wait here until they are in Firestore ---------- */

function newId() {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => abc[b % abc.length]).join("");
}

// Adds a record. The record id is also its Firestore document id, so a second send cannot make a copy.
export function queue(record) {
  const box = read(KEY.outbox, []);
  const r = Object.assign({ id: newId(), playedAt: Date.now(), denied: 0 }, record);
  box.push(r);
  if (box.length > OUTBOX_MAX) box.splice(0, box.length - OUTBOX_MAX);
  write(KEY.outbox, box);
  return r;
}

export function outbox() { return read(KEY.outbox, []); }
export function inOutbox(id) { return outbox().some(r => r.id === id); }
export function pendingCount(uid) { return outbox().filter(r => !uid || r.uid === uid).length; }

export function outboxRemove(id) { write(KEY.outbox, outbox().filter(r => r.id !== id)); }

export function outboxDenied(id) {
  const box = outbox();
  const r = box.find(x => x.id === id);
  if (r) { r.denied = (r.denied || 0) + 1; write(KEY.outbox, box); return r.denied; }
  return 0;
}

/* ---------- service worker: keeps the pages on the device for offline play ---------- */

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url))
    .catch(e => console.warn("[kidsgames] Service worker not registered:", e));
}
