import { collection, doc, getDoc, getDocsFromServer, setDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { db } from "../shared/family.js";
import { completionId, validCompletion } from "./progress-store.js";

export async function listCompletions(uid) {
  const snapshot = await getDocsFromServer(collection(db, "puzzleProgress", uid, "solved"));
  return snapshot.docs.map(item => {
    const data = item.data();
    return {...data, solvedAt:data.playedAt?.toMillis()};
  }).filter(validCompletion);
}

export async function saveCompletion(uid, record) {
  if (!validCompletion(record)) throw Error("Invalid completion record.");
  const ref = doc(db, "puzzleProgress", uid, "solved", completionId(record));
  try {
    await setDoc(ref, {uid, puzzleId:record.puzzleId, layoutKey:record.layoutKey, moves:record.moves,
      playedAt:Timestamp.fromMillis(record.solvedAt), date:serverTimestamp()});
  } catch (error) {
    // Completions are immutable. Another device or a retried write may already have saved it.
    if (error.code !== "permission-denied") throw error;
    const existing = await getDoc(ref);
    if (!existing.exists() || existing.data().uid !== uid || existing.data().puzzleId !== record.puzzleId ||
        existing.data().layoutKey !== record.layoutKey) throw error;
  }
}
