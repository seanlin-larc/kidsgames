// Tests for the KidsChinese block of firebase/firestore.rules (collection "chinese").
// KidsChinese (repo seanlin-larc/KidsChinese) uses this Firebase project and these accounts.
// Run in the firebase/ folder: npm install, then npm test (needs Java 11 or later).
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, Timestamp, writeBatch } from 'firebase/firestore';

let env;

// uid-<who>. players/{uid} documents are made in beforeEach for YC, JY, SL, CJ, Guest.
// OTHER has no players document. FAKE has YC's email, but its players document says JY.
const ACCOUNTS = {
  YC: 'yc@kidsgames.invalid', JY: 'jy@kidsgames.invalid', SL: 'sl@kidsgames.invalid',
  CJ: 'cj@kidsgames.invalid', Guest: 'guest@kidsgames.invalid', OTHER: 'other@example.com', FAKE: 'yc@kidsgames.invalid',
};

// A Firestore client signed in as this account (null = signed out).
function db(who) {
  if (!who) return env.unauthenticatedContext().firestore();
  return env.authenticatedContext('uid-' + who, { email: ACCOUNTS[who] }).firestore();
}

const card = (o = {}) => ({ box: 1, due: '2026-11-24', seen: 1, right: 1, updatedAt: serverTimestamp(), ...o });
const summary = (o = {}) => ({
  stars: 3, streak: { count: 1, last: '2026-11-23' }, daily: { date: '2026-11-23', count: 3 }, updatedAt: serverTimestamp(), ...o,
});
const prefs = (o = {}) => ({
  showPinyin: true, showEnglish: true, sessionSize: 10, speechRate: 0.8, avatar: '🐼', updatedAt: serverTimestamp(), ...o,
});
const level = (by, o = {}) => ({ level: 2, updatedAt: serverTimestamp(), updatedBy: by, ...o });

const cardRef = (d, code, id = 'animals:老虎') => doc(d, 'chinese', code, 'cards', id);
const sumRef = (d, code) => doc(d, 'chinese', code, 'data', 'summary');
const prefsRef = (d, code) => doc(d, 'chinese', code, 'data', 'prefs');
const levelRef = (d, code) => doc(d, 'chinese', code);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kidsgames',
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  // Some data for YC and JY, written with the rules turned off.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    for (const code of ['YC', 'JY', 'SL', 'CJ', 'Guest']) await setDoc(doc(d, 'players', 'uid-' + code), { code });
    await setDoc(doc(d, 'players', 'uid-FAKE'), { code: 'JY' });
    for (const code of ['YC', 'JY']) {
      await setDoc(levelRef(d, code), { level: 1, updatedAt: Timestamp.now(), updatedBy: 'SL' });
      await setDoc(cardRef(d, code), { box: 2, due: '2026-11-26', seen: 2, right: 2, updatedAt: Timestamp.now() });
      await setDoc(cardRef(d, code, 'family:爸爸'), { box: 1, due: '2026-11-24', seen: 1, right: 1, updatedAt: Timestamp.now() });
      await setDoc(sumRef(d, code), { stars: 5, streak: { count: 2, last: '2026-11-22' }, daily: { date: '2026-11-22', count: 5 }, updatedAt: Timestamp.now() });
      await setDoc(prefsRef(d, code), { showPinyin: true, showEnglish: true, sessionSize: 10, speechRate: 0.8, avatar: '🐯', updatedAt: Timestamp.now() });
    }
  });
});
after(async () => { await env?.cleanup(); });

test('KidsChinese: a learner reads own data only', async () => {
  for (const [me, other] of [['YC', 'JY'], ['JY', 'YC']]) {
    await assertSucceeds(getDoc(levelRef(db(me), me)));
    await assertSucceeds(getDoc(sumRef(db(me), me)));
    await assertSucceeds(getDoc(prefsRef(db(me), me)));
    await assertSucceeds(getDocs(collection(db(me), 'chinese', me, 'cards')));
    await assertFails(getDoc(levelRef(db(me), other)));
    await assertFails(getDoc(sumRef(db(me), other)));
    await assertFails(getDoc(prefsRef(db(me), other)));
    await assertFails(getDocs(collection(db(me), 'chinese', other, 'cards')));
  }
});

test('KidsChinese: parents read every learner; outsiders read nothing', async () => {
  for (const p of ['SL', 'CJ']) {
    for (const code of ['YC', 'JY']) {
      await assertSucceeds(getDoc(levelRef(db(p), code)));
      await assertSucceeds(getDoc(sumRef(db(p), code)));
      await assertSucceeds(getDocs(collection(db(p), 'chinese', code, 'cards')));
    }
  }
  for (const who of [null, 'OTHER', 'Guest']) {
    await assertFails(getDoc(levelRef(db(who), 'YC')));
    await assertFails(getDoc(sumRef(db(who), 'YC')));
    await assertFails(getDocs(collection(db(who), 'chinese', 'YC', 'cards')));
  }
  // FAKE has YC's email, but players/{uid} says JY: the players document decides.
  await assertFails(getDoc(sumRef(db('FAKE'), 'YC')));
  await assertSucceeds(getDoc(sumRef(db('FAKE'), 'JY')));
  // Listing all learners is not allowed for anyone.
  await assertFails(getDocs(collection(db('YC'), 'chinese')));
});

test('KidsChinese: a learner saves own answers and summary in one batch', async () => {
  const d = db('YC');
  const b = writeBatch(d);
  b.set(cardRef(d, 'YC', 'food:蘋果'), card());
  b.set(sumRef(d, 'YC'), summary());
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(cardRef(d, 'YC'), card({ box: 3, due: '2026-11-30', seen: 3, right: 3 })));
  await assertSucceeds(setDoc(cardRef(d, 'YC'), card({ box: 1, due: null, seen: 4, right: 3 })));
});

test('KidsChinese: a learner cannot write the other learner, and parents cannot write answers', async () => {
  await assertFails(setDoc(cardRef(db('YC'), 'JY'), card()));
  await assertFails(setDoc(sumRef(db('YC'), 'JY'), summary()));
  await assertFails(setDoc(prefsRef(db('JY'), 'YC'), prefs()));
  for (const p of ['SL', 'CJ']) {
    await assertFails(setDoc(cardRef(db(p), 'YC'), card()));
    await assertFails(setDoc(sumRef(db(p), 'YC'), summary()));
  }
  for (const who of [null, 'OTHER', 'Guest']) {
    await assertFails(setDoc(cardRef(db(who), 'YC'), card()));
  }
  // Only YC and JY are learners; Guest is not.
  await assertFails(setDoc(cardRef(db('SL'), 'SL'), card()));
  await assertFails(setDoc(cardRef(db('Guest'), 'Guest'), card()));
  await assertFails(setDoc(prefsRef(db('Guest'), 'YC'), prefs()));
  await assertFails(setDoc(levelRef(db('SL'), 'SL'), level('SL')));
});

test('KidsChinese: card data must have the right shape', async () => {
  const d = db('YC');
  for (const bad of [
    { box: 6 }, { box: -1 }, { box: 1.5 }, { due: '24/11/2026' }, { due: 5 },
    { seen: -1 }, { right: 2, seen: 1 }, { seen: '1' }, { updatedAt: Timestamp.fromMillis(0) },
    { extra: true },
  ]) {
    await assertFails(setDoc(cardRef(d, 'YC'), card(bad)));
  }
  const { right, ...noRight } = card();
  await assertFails(setDoc(cardRef(d, 'YC'), noRight));
  await assertFails(setDoc(cardRef(d, 'YC', 'x'.repeat(65)), card()));
});

test('KidsChinese: summary data must have the right shape', async () => {
  const d = db('JY');
  for (const bad of [
    { stars: -1 }, { stars: 'many' }, { stars: 1.5 },
    { streak: { count: 1 } }, { streak: { count: 1, last: 'yesterday' } }, { streak: { count: 1, last: null, x: 1 } },
    { daily: { date: '2026-11-23' } }, { daily: { date: '2026-11-23', count: -2 } },
    { updatedAt: Timestamp.fromMillis(0) }, { level: 3 },
  ]) {
    await assertFails(setDoc(sumRef(d, 'JY'), summary(bad)));
  }
  await assertSucceeds(setDoc(sumRef(d, 'JY'), summary({ streak: { count: 0, last: null }, daily: { date: null, count: 0 } })));
});

test('KidsChinese: only a parent sets the level, with a valid value and own code', async () => {
  await assertSucceeds(setDoc(levelRef(db('SL'), 'YC'), level('SL', { level: 3 })));
  await assertSucceeds(setDoc(levelRef(db('CJ'), 'JY'), level('CJ', { level: 1 })));
  await assertSucceeds(setDoc(levelRef(db('CJ'), 'JY'), level('CJ', { level: 2 })));
  // A learner cannot change any level, own or other.
  await assertFails(setDoc(levelRef(db('YC'), 'YC'), level('SL', { level: 3 })));
  await assertFails(updateDoc(levelRef(db('JY'), 'JY'), { level: 3 }));
  await assertFails(setDoc(levelRef(db('JY'), 'YC'), level('SL')));
  await assertFails(setDoc(levelRef(db('Guest'), 'YC'), level('Guest')));
  // Bad values.
  for (const bad of [{ level: 0 }, { level: 4 }, { level: '2' }, { updatedBy: 'CJ' }, { updatedAt: Timestamp.fromMillis(0) }, { extra: 1 }]) {
    await assertFails(setDoc(levelRef(db('SL'), 'YC'), level('SL', bad)));
  }
  // Nobody deletes the level document.
  await assertFails(deleteDoc(levelRef(db('SL'), 'YC')));
});

test('KidsChinese: only a parent resets progress (deletes cards and summary)', async () => {
  await assertFails(deleteDoc(cardRef(db('YC'), 'YC')));
  await assertFails(deleteDoc(sumRef(db('YC'), 'YC')));
  await assertFails(deleteDoc(cardRef(db('JY'), 'YC')));
  await assertFails(deleteDoc(cardRef(db('OTHER'), 'YC')));
  await assertFails(deleteDoc(cardRef(db('Guest'), 'YC')));
  const d = db('CJ');
  const snap = await assertSucceeds(getDocs(collection(d, 'chinese', 'YC', 'cards')));
  const b = writeBatch(d);
  snap.docs.forEach((x) => b.delete(x.ref));
  b.delete(sumRef(d, 'YC'));
  await assertSucceeds(b.commit());
  // Preferences stay; nobody deletes them.
  await assertFails(deleteDoc(prefsRef(db('SL'), 'YC')));
  // After a reset the learner starts again.
  await assertSucceeds(setDoc(sumRef(db('YC'), 'YC'), summary({ stars: 1 })));
});

test('KidsChinese: preferences: the learner or a parent, with valid values', async () => {
  await assertSucceeds(setDoc(prefsRef(db('YC'), 'YC'), prefs({ avatar: '🦊', sessionSize: 15 })));
  await assertSucceeds(setDoc(prefsRef(db('SL'), 'JY'), prefs({ showEnglish: false })));
  for (const bad of [
    { sessionSize: 7 }, { speechRate: 3 }, { speechRate: '0.8' }, { showPinyin: 'yes' },
    { avatar: 'x'.repeat(17) }, { level: 3 }, { updatedAt: Timestamp.fromMillis(0) },
  ]) {
    await assertFails(setDoc(prefsRef(db('YC'), 'YC'), prefs(bad)));
  }
});
