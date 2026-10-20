import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp,
  setDoc, Timestamp, updateDoc } from 'firebase/firestore';

let env;
const projectId = 'demo-kidsgames';
const data = (overrides = {}) => ({
  format: 'move-red-loco-puzzle-v1', title: 'First train', difficulty: 'Starter',
  exitRow: 2, pieces: [], revision: 1, createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(), createdBy: 'sean', updatedBy: 'sean', ...overrides
});
const ref = (db, id = 'first-train') => doc(db, 'puzzleLibrary', id);
const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'players', 'sean'), { code: 'SL' });
    await setDoc(doc(ctx.firestore(), 'players', 'child'), { code: 'CJ' });
  });
});
after(async () => { await env?.cleanup(); });

test('only SL can create; family can read and list; outsiders cannot read', async () => {
  await assertSucceeds(setDoc(ref(dbFor('sean')), data()));
  await assertSucceeds(getDoc(ref(dbFor('child'))));
  assert.equal((await assertSucceeds(getDocs(collection(dbFor('child'), 'puzzleLibrary')))).size, 1);
  for (const uid of [null, 'outsider', 'child']) {
    await assertFails(setDoc(ref(dbFor(uid), 'blocked'), data({ createdBy: uid, updatedBy: uid })));
  }
  for (const uid of [null, 'outsider']) {
    await assertFails(getDoc(ref(dbFor(uid))));
    await assertFails(getDocs(collection(dbFor(uid), 'puzzleLibrary')));
  }
});

test('SL update requires next revision and preserves creation identity and date', async () => {
  const r = ref(dbFor('sean'));
  await assertSucceeds(setDoc(r, data()));
  for (const patch of [
    { revision: 1 }, { revision: 3 }, { createdBy: 'child' },
    { createdAt: Timestamp.fromMillis(0) }, { updatedBy: 'child' },
    { updatedAt: Timestamp.fromMillis(0) }
  ]) {
    await assertFails(updateDoc(r, { revision: 2, updatedAt: serverTimestamp(), updatedBy: 'sean', ...patch }));
  }
  await assertSucceeds(updateDoc(r, { title: 'Changed', revision: 2, updatedAt: serverTimestamp(), updatedBy: 'sean' }));
  await assertFails(updateDoc(ref(dbFor('child')), { revision: 3, updatedAt: serverTimestamp(), updatedBy: 'child' }));
});

test('only SL can delete library puzzles; other puzzles and statistics stay intact', async () => {
  const db = dbFor('sean');
  await assertSucceeds(setDoc(ref(db), data()));
  await assertSucceeds(setDoc(ref(db, 'keep-this'), data()));
  for (const uid of [null, 'outsider', 'child']) {
    await assertFails(deleteDoc(ref(dbFor(uid))));
  }
  assert.equal((await getDoc(ref(db))).exists(), true);
  await assertSucceeds(deleteDoc(ref(db)));
  assert.equal((await getDoc(ref(db))).exists(), false);
  assert.equal((await getDoc(ref(db, 'keep-this'))).exists(), true);
});

test('create rejects forged metadata, unsupported shape, and invalid document ids', async () => {
  const db = dbFor('sean');
  const invalid = [
    { revision: 2 }, { revision: 1.5 }, { revision: 9007199254740991 },
    { format: 'other' }, { title: '' }, { title: 'x'.repeat(81) },
    { difficulty: 'Expert' }, { exitRow: 4 }, { exitRow: 2.5 },
    { pieces: {} }, { pieces: Array(36).fill({}) },
    { createdBy: 'child' }, { updatedBy: 'child' },
    { createdAt: Timestamp.fromMillis(0) }, { updatedAt: Timestamp.fromMillis(0) },
    { extraField: true }
  ];
  for (const patch of invalid) await assertFails(setDoc(ref(db), data(patch)));
  const missing = data(); delete missing.title;
  await assertFails(setDoc(ref(db), missing));
  for (const id of ['Bad-ID', '-start', 'x'.repeat(65), 'has space', 'has_underscore']) {
    await assertFails(setDoc(ref(db, id), data()));
  }
  await assertSucceeds(setDoc(ref(db, 'x'.repeat(64)), data()));
});

test('200-document SL restore transaction fits the security-rule access budget', async () => {
  const db = dbFor('sean');
  await assertSucceeds(runTransaction(db, async tx => {
    const refs = Array.from({ length: 200 }, (_, i) => ref(db, `puzzle-${i}`));
    for (const r of refs) await tx.get(r);
    for (const r of refs) tx.set(r, data());
  }));
  assert.equal((await getDocs(collection(db, 'puzzleLibrary'))).size, 200);
});

test('existing player mapping is immutable from browsers', async () => {
  for (const uid of ['sean', 'child', 'outsider', null]) {
    await assertFails(setDoc(doc(dbFor(uid), 'players', uid || 'new'), { code: 'SL' }));
  }
});

test('existing statistics rules still allow valid family records and reject mutations', async () => {
  const db = dbFor('child');
  const result = doc(db, 'results', 'word-one');
  const base = { uid: 'child', player: 'CJ', playedAt: Timestamp.now(), date: serverTimestamp() };
  await assertSucceeds(setDoc(result, { ...base, game: 'word-guess', level: 'easy', won: true, score: 4 }));
  await assertSucceeds(getDoc(doc(dbFor('sean'), 'results', 'word-one')));
  await assertFails(updateDoc(result, { score: 1 }));
  await assertFails(deleteDoc(result));
  await assertFails(setDoc(doc(db, 'results', 'forged'), { ...base, player: 'SL', game: 'word-guess', level: 'easy', won: true, score: 4 }));
  await assertFails(setDoc(doc(dbFor('outsider'), 'results', 'outsider'), { ...base, uid: 'outsider', game: 'word-guess', level: 'easy', won: true, score: 4 }));
  const win = doc(db, 'games', 'minesweeper', 'l8', 'win-one');
  await assertSucceeds(setDoc(win, { ...base, time: 2 }));
  await assertFails(setDoc(doc(db, 'games', 'minesweeper', 'l8', 'too-fast'), { ...base, time: 1 }));
  await assertFails(updateDoc(win, { time: 3 }));
  await assertFails(deleteDoc(win));
});
