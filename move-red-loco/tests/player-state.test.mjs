import test from "node:test";
import assert from "node:assert/strict";
import { createAttempt, layoutKey } from "../player-state.js";
import { createProgressStore } from "../progress-store.js";

const red = {id:"red",type:"red",x:0,y:2,w:2,h:1,axis:"h",label:"X"};
const blocker = {id:"v2-1",type:"v2",x:3,y:1,w:1,h:2,axis:"v",label:"A",hue:120};
const puzzle = (extra = {}) => ({id:"puzzle-1",format:"move-red-loco-puzzle-v1",title:"Puzzle 1",difficulty:"Beginner",exitRow:2,pieces:structuredClone([red,blocker]),revision:1,createdAt:"2026-10-20T00:00:00.000Z",updatedAt:"2026-10-20T00:00:00.000Z",...extra});
function memory() { const data = new Map(); return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)}; }
const completion = (extra = {}) => ({puzzleId:"puzzle-1",layoutKey:"a".repeat(64),moves:2,solvedAt:Date.now(),...extra});

test("play history supports undo, redo, branching, restart and immutable starting layout", () => {
  const input = puzzle(), game = createAttempt(input);
  assert.equal(game.slide("red",0,1),false);
  assert.equal(game.moves,0);
  assert.equal(game.slide("red",1,0),true);
  assert.equal(game.moves,1);
  assert.equal(game.undo(),true); assert.deepEqual(game.pieces,input.pieces);
  assert.equal(game.redo(),true); assert.equal(game.pieces[0].x,1);
  game.undo(); game.slide("v2-1",0,1);
  assert.equal(game.canRedo,false); assert.equal(game.history.length,1);
  assert.equal(game.won,false); game.slide("v2-1",0,1);
  assert.equal(game.won,true); assert.equal(game.moves,2);
  assert.equal(game.slide("red",1,0),false); assert.equal(game.undo(),false);
  assert.equal(game.history[1].direction,"down");
  game.restart(); assert.equal(game.moves,0); assert.equal(game.won,false);
  assert.deepEqual(game.pieces,input.pieces); assert.deepEqual(input,puzzle());
});
test("zero-move puzzles complete, and incomplete layouts cannot start", () => {
  assert.equal(createAttempt(puzzle({pieces:[red]})).won,true);
  assert.throws(()=>createAttempt(puzzle({pieces:[]})),/red locomotive/i);
});
test("progress follows geometry through renames, colours, labels and IDs; layout changes require a new solve", async () => {
  const original = puzzle(), key = await layoutKey(original);
  assert.match(key,/^[a-f0-9]{64}$/);
  const renamed = puzzle({title:"Renamed",revision:2,difficulty:"Freak",pieces:[{...blocker,id:"v2-9",label:"B",hue:240},red]});
  assert.equal(await layoutKey(renamed),key);
  assert.notEqual(await layoutKey(puzzle({pieces:[red,{...blocker,y:2}]})),key);
});
test("offline completions survive reopening, sync once, and stay isolated by account", async () => {
  const storage = memory(), remote = new Map(), writes = [];
  const cloud = async()=>({listCompletions:async uid=>remote.get(uid)||[],saveCompletion:async(uid,r)=>{writes.push([uid,r]);remote.set(uid,[r]);}});
  let store = createProgressStore({storage,uid:"SL",cloud});
  store.complete(completion()); store.complete(completion({moves:1}));
  assert.equal(store.pending,1);
  assert.equal(createProgressStore({storage,uid:"CJ",cloud}).has("puzzle-1","a".repeat(64)),false);
  store = createProgressStore({storage,uid:"SL",cloud}); assert.equal(store.pending,1);
  await store.sync(); await store.sync();
  assert.equal(writes.length,1); assert.equal(store.pending,0);
  const otherDevice = createProgressStore({storage:memory(),uid:"SL",cloud}); await otherDevice.sync();
  assert.equal(otherDevice.has("puzzle-1","a".repeat(64)),true);
});
test("failed sync retains pending completions and a later retry sends them", async () => {
  let fail = true;
  const store = createProgressStore({storage:memory(),uid:"CJ",cloud:async()=>({listCompletions:async()=>[],saveCompletion:async()=>{if(fail)throw Error("offline");}})});
  store.complete(completion()); await assert.rejects(store.sync(),/offline/); assert.equal(store.pending,1);
  fail=false; await store.sync(); assert.equal(store.pending,0);
});
test("a completion arriving during sync is sent before sync completes", async () => {
  const sent=[]; let release;
  const wait = new Promise(resolve=>{release=resolve;});
  const store = createProgressStore({storage:memory(),uid:"CJ",cloud:async()=>({listCompletions:async()=>[],saveCompletion:async(uid,r)=>{sent.push(r.puzzleId);await wait;}})});
  store.complete(completion()); const syncing=store.sync();
  await new Promise(resolve=>setImmediate(resolve));
  store.complete(completion({puzzleId:"puzzle-2"})); release(); await syncing;
  assert.deepEqual(sent,["puzzle-1","puzzle-2"]); assert.equal(store.pending,0);
});
test("silent device write failures are reported and malformed completions are rejected", () => {
  const store=createProgressStore({storage:{getItem:()=>null,setItem:()=>{}},uid:"CJ",cloud:async()=>null});
  assert.throws(()=>store.complete(completion()),/could not retain/);
  assert.throws(()=>store.complete(completion({moves:-1})),/Invalid/);
  assert.throws(()=>store.complete(completion({layoutKey:"bad"})),/Invalid/);
});
test("sequential completions in two open tabs preserve both pending records", async () => {
  const storage=memory(), sent=[];
  const cloud=async()=>({listCompletions:async()=>[],saveCompletion:async(uid,r)=>{sent.push(r.puzzleId);}});
  const first=createProgressStore({storage,uid:"CJ",cloud});
  const second=createProgressStore({storage,uid:"CJ",cloud});
  first.complete(completion()); second.complete(completion({puzzleId:"puzzle-2"}));
  await first.sync(); await second.sync();
  assert.deepEqual(sent,["puzzle-1","puzzle-2"]);
  assert.equal(first.has("puzzle-2","a".repeat(64)),true);
});
