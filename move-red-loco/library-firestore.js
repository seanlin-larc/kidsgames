import { collection, doc, getDocsFromServer, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { db, currentPlayer } from "../shared/family.js";
import { createLibraryStore } from "./library-store.js";

const reference = id => doc(db,"puzzleLibrary",id);
const store = createLibraryStore({
  player:currentPlayer,
  timestamp:serverTimestamp,
  async listFromServer() {
    const snapshot = await getDocsFromServer(collection(db,"puzzleLibrary"));
    return snapshot.docs.map(d => {
      const data = d.data();
      return {...data,id:d.id,createdAt:data.createdAt?.toDate().toISOString(),updatedAt:data.updatedAt?.toDate().toISOString()};
    });
  },
  transact:work => runTransaction(db, transaction => work({
    async get(id) {const snap=await transaction.get(reference(id));return snap.exists()?snap.data():null;},
    set:(id,data)=>transaction.set(reference(id),data)
  }))
});
export const {listPuzzles,savePuzzle,restorePuzzles} = store;
