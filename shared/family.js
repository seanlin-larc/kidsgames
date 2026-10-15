// Family sign-in and shared records for all Kids Games pages.
//
// How it works:
// - Each player (SL, CJ, YC, JY) has one Firebase Email/Password account.
//   The 6-digit PIN is the password. Firebase checks the PIN on its server;
//   no PIN or PIN hash is in this public code.
// - Firebase keeps the sign-in for the whole site (seanlin-larc.github.io),
//   so every game page knows who is playing.
// - Firestore document players/{uid} holds the player code, for example { code: "SL" }.
//   The security rules allow reads and writes only for those four accounts.
//
// Import from a game folder:  import * as family from "../shared/family.js";
// Import from the menu:       import * as family from "./shared/family.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

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

// The four players. To add a player: make the account in Firebase Authentication,
// add a players/{uid} document with the code, and add one line here.
export const PLAYERS = [
  { code: "SL", email: "sl@kidsgame.invalid" },
  { code: "CJ", email: "cj@kidsgame.invalid" },
  { code: "YC", email: "yc@kidsgame.invalid" },
  { code: "JY", email: "jy@kidsgame.invalid" }
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Resolves once Firebase has restored any saved sign-in (first auth state event).
const authReady = new Promise(resolve => {
  const stop = onAuthStateChanged(auth, user => { stop(); resolve(user); });
});

let cachedPlayer = null;

// Returns { uid, code } for the signed-in player, or null if nobody is signed in.
// Throws if the account is signed in but has no players/{uid} document.
export async function currentPlayer() {
  const user = await authReady.then(() => auth.currentUser);
  if (!user) return null;
  if (cachedPlayer && cachedPlayer.uid === user.uid) return cachedPlayer;
  const snap = await getDoc(doc(db, "players", user.uid));
  if (!snap.exists() || typeof snap.data().code !== "string") {
    throw new Error("no-player-record");
  }
  cachedPlayer = { uid: user.uid, code: snap.data().code };
  return cachedPlayer;
}

// Signs in with the player code and PIN. Returns { uid, code }.
// Errors keep the Firebase error code in error.code, for example "auth/invalid-credential".
export async function signIn(code, pin) {
  const p = PLAYERS.find(x => x.code === code);
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

// Sends the page to the menu when nobody is signed in. Returns the player otherwise.
export async function requirePlayer(menuUrl = "../") {
  const player = await currentPlayer().catch(() => null);
  if (!player) { location.replace(menuUrl); return null; }
  return player;
}

// Saves one finished game: games/{game}/{level}/{auto id}. Returns the new document id.
export async function saveRecord(game, level, time) {
  const player = await currentPlayer();
  if (!player) throw new Error("not-signed-in");
  const ref = await addDoc(collection(db, "games", game, level), {
    player: player.code,
    time: time,
    date: serverTimestamp(),
    uid: player.uid
  });
  return ref.id;
}

// Returns the fastest records for one level: [{ id, player, time, date }], fastest first.
export async function topTimes(game, level, n = 10) {
  const snap = await getDocs(query(collection(db, "games", game, level), orderBy("time"), limit(n)));
  return snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, player: x.player, time: x.time, date: x.date ? x.date.toDate() : null };
  });
}
