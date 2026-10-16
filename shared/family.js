// Family sign-in and shared records (Firebase) for all Kids Games pages.
//
// How it works:
// - Each player (SL, CJ, YC, JY, Guest) has one Firebase Email/Password account,
//   <code>@kidsgames.invalid. The 6-digit PIN is the password. Firebase checks the PIN
//   on its server; no PIN or PIN hash is in this public code.
// - Firebase keeps the sign-in for the whole site (seanlin-larc.github.io),
//   so every game page knows who is playing.
// - Firestore document players/{uid} holds the player code, for example { code: "SL" }.
//   The security rules allow reads and writes only for accounts with that document.
// - Finished games go into the device outbox first (session.js), then to Firestore.
//   The record id is the Firestore document id, so a record sent twice is not copied.
//
// Pages do not import this file directly. They use ./gate.js, which loads this file
// and works offline when this file or Firebase cannot load.

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import * as S from "./session.js";

export { PLAYERS } from "./session.js";

// Web app config. This is not a secret: it only names the Firebase project.
// Access is controlled by the Firestore security rules.
const firebaseConfig = {
  apiKey: "AIzaSyAeOHHmomoHuUlMu8vHHv7J_nQgztTmEmQ",
  authDomain: "kidsgame-7a262.firebaseapp.com",
  projectId: "kidsgame-7a262",
  storageBucket: "kidsgame-7a262.firebasestorage.app",
  messagingSenderId: "594803942218",
  appId: "1:594803942218:web:e141e745d88090f79997b3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Resolves once Firebase has restored any saved sign-in (first auth state event).
// This needs no network.
const authReady = new Promise(resolve => {
  const stop = onAuthStateChanged(auth, user => { stop(); resolve(user); });
});

let cachedPlayer = null;

// The uid of the signed-in account on this device, or null. Works offline.
export async function authUid() {
  await authReady;
  return auth.currentUser ? auth.currentUser.uid : null;
}

// Returns { uid, code } for the signed-in player, or null if nobody is signed in.
// Needs the network the first time on each page (it reads players/{uid}).
// Throws "no-player-record" if the account has no players/{uid} document.
export async function currentPlayer() {
  await authReady;
  const user = auth.currentUser;
  if (!user) return null;
  if (cachedPlayer && cachedPlayer.uid === user.uid) return cachedPlayer;
  let snap;
  try { snap = await getDoc(doc(db, "players", user.uid)); }
  catch (e) {
    // The rules refuse the read when the account has no players/{uid} document,
    // and Firebase refuses a session of a deleted account. Both mean: not a family player.
    if (e && (e.code === "permission-denied" || /^auth\/(user-token-expired|user-not-found|user-disabled|invalid-user-token)$/.test(e.code || ""))) {
      throw new Error("no-player-record");
    }
    throw e;
  }
  if (!snap.exists() || typeof snap.data().code !== "string") {
    throw new Error("no-player-record");
  }
  cachedPlayer = { uid: user.uid, code: snap.data().code };
  return cachedPlayer;
}

// Signs in with the player code and PIN. Returns { uid, code }.
// Errors keep the Firebase error code in error.code, for example "auth/invalid-credential".
export async function signIn(code, pin) {
  const p = S.PLAYERS.find(x => x.code === code);
  if (!p) throw Object.assign(new Error("Unknown player"), { code: "app/unknown-player" });
  await authReady;
  cachedPlayer = null;
  await signInWithEmailAndPassword(auth, p.email, pin);
  return currentPlayer();
}

export async function signOutPlayer() {
  cachedPlayer = null;
  await signOut(auth);
}

/* ---------- send the outbox to Firestore ---------- */

const DROP_AFTER_DENIED = 20;   // a record the rules refuse this many times is removed

function target(r) {
  const base = { player: r.player, uid: r.uid, playedAt: Timestamp.fromMillis(r.playedAt), date: serverTimestamp() };
  if (r.kind === "win") {
    // Family top 10: games/{game}/{level}/{id}
    return { ref: doc(db, "games", r.game, r.level, r.id), data: Object.assign(base, { time: r.time }) };
  }
  // Every finished game, won or lost: results/{id}
  return {
    ref: doc(db, "results", r.id),
    data: Object.assign(base, { game: r.game, level: r.level, won: r.won, score: r.score })
  };
}

function timeout(promise, ms) {
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("timeout"), { code: "app/timeout" })), ms))]);
}

async function flushOnce() {
  const player = await currentPlayer();
  if (!player) return 0;
  let sent = 0;
  for (const r of S.outbox().filter(x => x.uid === player.uid)) {
    const t = target(r);
    try {
      await timeout(setDoc(t.ref, t.data), 10000);
      S.outboxRemove(r.id);
      sent++;
    } catch (e) {
      if (e && e.code === "permission-denied") {
        // Already sent (an update is refused), or refused by the rules.
        const there = await timeout(getDoc(t.ref), 10000).then(s => s.exists()).catch(() => false);
        if (there) { S.outboxRemove(r.id); sent++; continue; }
        console.warn("[kidsgames] Record refused by the rules:", r, e);
        if (S.outboxDenied(r.id) >= DROP_AFTER_DENIED) S.outboxRemove(r.id);
        continue;
      }
      console.warn("[kidsgames] Outbox send stopped (offline?):", e && e.code, e);
      break;
    }
  }
  return sent;
}

let flushing = null, again = false;

// Sends the records of the signed-in player. Safe to call often. Resolves to the number sent.
export function flushOutbox() {
  if (flushing) { again = true; return flushing; }
  flushing = (async () => {
    let total = 0;
    do { again = false; total += await flushOnce(); } while (again);
    return total;
  })().finally(() => { flushing = null; });
  return flushing;
}

// Returns the fastest records for one level: [{ id, player, time, date }], fastest first.
// "date" is the play date (playedAt), or the save date for older records.
export async function topTimes(game, level, n = 10) {
  const snap = await getDocs(query(collection(db, "games", game, level), orderBy("time"), limit(n)));
  return snap.docs.map(d => {
    const x = d.data();
    const when = x.playedAt || x.date;
    return { id: d.id, player: x.player, time: x.time, date: when ? when.toDate() : null };
  });
}
