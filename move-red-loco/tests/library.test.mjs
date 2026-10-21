import test from "node:test";
import assert from "node:assert/strict";
import {makeArchive,normalizeArchive,normalizeLibraryPuzzle,planRestore,PUZZLE_FORMAT,MAX_ARCHIVE_PUZZLES} from "../library-data.js";
import {createLibraryStore} from "../library-store.js";

const when="2026-10-18T00:00:00.000Z";
const red={id:"red",type:"red",x:0,y:2,w:2,h:1,axis:"h",label:"X"};
const car={id:"h2-1",type:"h2",x:3,y:1,w:1,h:2,axis:"v",label:"A",hue:120};
const puzzle=(id="puzzle-1",extra={})=>({id,format:PUZZLE_FORMAT,title:"First puzzle",difficulty:"Starter",exitRow:2,
  pieces:structuredClone([red,car]),revision:1,createdAt:when,updatedAt:when,...extra});
const layout=p=>({...p,format:"move-red-loco-editor-v1"});

function setup(records=[],code="SL") {
  const docs=new Map(records.map(p=>[p.id,{...p,createdBy:"original-sl",updatedBy:"original-sl"}]));
  let reads=0,writes=0,fail=false;
  const store=createLibraryStore({
    player:async()=>code?{uid:"uid-"+code,code}:null,timestamp:()=>when,
    listFromServer:async()=>{reads++;return [...docs].map(([id,p])=>({...p,id}));},
    async transact(work) {
      const staged=[];
      const result=await work({get:async id=>docs.get(id)||null,set:(id,data)=>staged.push([id,data]),delete:id=>staged.push([id,null])});
      if(fail)throw Error("Network interrupted");
      for(const [id,data] of staged){if(data===null)docs.delete(id);else docs.set(id,data);writes++;}
      return result;
    }
  });
  return {store,docs,get reads(){return reads;},get writes(){return writes;},fail(){fail=true;}};
}

test("archive roundtrip preserves IDs, rotated blocks, labels, colors, revisions, and dates",()=>{
  const records=[puzzle(),puzzle("puzzle-2",{title:"Second puzzle",revision:5})];
  const archive=makeArchive(records,when);
  assert.deepEqual(normalizeArchive(JSON.parse(JSON.stringify(archive))),archive);
  assert.deepEqual(archive.puzzles,records);
  assert.equal(archive.puzzleCount,2);
});
test("archive strips account fields and statistics",()=>{
  const archive=makeArchive([puzzle("puzzle-1",{createdBy:"private-uid",updatedBy:"private-uid",results:[1,2]})],when);
  assert.equal(JSON.stringify(archive).includes("private-uid"),false);
  assert.equal("results" in archive.puzzles[0],false);
});
for(const [name,change] of [
  ["duplicate IDs",a=>a.puzzles.push(a.puzzles[0])],
  ["wrong count",a=>a.puzzleCount++],
  ["invalid format",a=>a.format="unknown"],
  ["future schema",a=>a.schemaVersion=2],
  ["bad date",a=>a.exportedAt="not a date"],
  ["exit mismatch",a=>a.puzzles[0].exitRow=3],
  ["missing color",a=>delete a.puzzles[0].pieces[1].hue],
  ["missing letter",a=>delete a.puzzles[0].pieces[1].label],
  ["invalid layout",a=>a.puzzles[0].pieces[1].x=1],
  ["invalid revision",a=>a.puzzles[0].revision=0]
]) test("archive rejects "+name,()=>{
  const archive=makeArchive([puzzle()],when);change(archive);
  assert.throws(()=>normalizeArchive(archive));
});
test("archive rejects duplicate IDs even with a corrected count",()=>{
  const a=makeArchive([puzzle()],when);a.puzzles.push(puzzle());a.puzzleCount=2;
  assert.throws(()=>normalizeArchive(a),/duplicate/);
});
test("archive accepts an empty library and enforces the atomic restore limit",()=>{
  assert.equal(makeArchive([],when).puzzleCount,0);
  assert.throws(()=>makeArchive(Array.from({length:MAX_ARCHIVE_PUZZLES+1},(_,i)=>puzzle("p-"+i)),when),/maximum 200/);
});
test("restore defaults to skipping IDs already in the library",()=>{
  const a=makeArchive([puzzle(),puzzle("puzzle-2")],when);
  const plan=planRestore(a,[puzzle()]);
  assert.deepEqual(plan.skipped,["puzzle-1"]);
  assert.equal(plan.entries.length,1);assert.equal(plan.entries[0].expectedRevision,0);
});
test("overwrite plan captures server revisions rather than old archive revisions",()=>{
  const plan=planRestore(makeArchive([puzzle()],when),[puzzle("puzzle-1",{revision:8})],true);
  assert.equal(plan.entries[0].expectedRevision,8);
  assert.equal(plan.entries[0].puzzle.revision,1);
});
test("cloud save creates a stable ID and update retains creation metadata",async()=>{
  const s=setup();
  assert.deepEqual(await s.store.savePuzzle({id:"puzzle-1",title:"First puzzle",layout:layout(puzzle())}),{id:"puzzle-1",revision:1});
  s.docs.get("puzzle-1").createdBy="first-creator";
  await s.store.savePuzzle({id:"puzzle-1",title:"New name",layout:layout(puzzle()),expectedRevision:1});
  assert.equal(s.docs.size,1);assert.equal(s.docs.get("puzzle-1").revision,2);
  assert.equal(s.docs.get("puzzle-1").createdBy,"first-creator");
  assert.equal(s.docs.get("puzzle-1").updatedBy,"uid-SL");
});
test("stale saves and duplicate creates fail without writes",async()=>{
  const s=setup([puzzle("puzzle-1",{revision:3})]);
  for(const expectedRevision of [0,2])await assert.rejects(s.store.savePuzzle({id:"puzzle-1",title:"New name",layout:layout(puzzle()),expectedRevision}),/another device/);
  assert.equal(s.writes,0);assert.equal(s.docs.get("puzzle-1").revision,3);
});
for(const code of ["YC","JY","Guest",null])test("cloud mutations refuse "+code,async()=>{
  const s=setup([],code),plan=planRestore(makeArchive([puzzle()],when),[]);
  await assert.rejects(s.store.savePuzzle({id:"puzzle-1",title:"New",layout:layout(puzzle())}),/Only SL/);
  await assert.rejects(s.store.restorePuzzles(plan),/Only SL/);
  await assert.rejects(s.store.deletePuzzle({id:"puzzle-1",expectedRevision:1}),/Only SL/);
  assert.equal(s.writes,0);
});
test("server list is fresh and returns no account data",async()=>{
  const s=setup([puzzle()]);const result=await s.store.listPuzzles();
  assert.equal(s.reads,1);assert.equal("createdBy" in result[0],false);
  assert.equal("updatedBy" in result[0],false);
});
test("restore creates missing IDs and leaves unrelated puzzles untouched",async()=>{
  const s=setup([puzzle("unrelated")]);
  const plan=planRestore(makeArchive([puzzle()],when),await s.store.listPuzzles());
  assert.deepEqual(await s.store.restorePuzzles(plan),{restored:1});
  assert.equal(s.docs.size,2);assert.equal(s.docs.get("puzzle-1").revision,1);
});
test("explicit overwrite updates content with current revision and creation identity",async()=>{
  const s=setup([puzzle("puzzle-1",{revision:5,title:"Current"})]);
  const plan=planRestore(makeArchive([puzzle("puzzle-1",{title:"Archive"})],when),await s.store.listPuzzles(),true);
  await s.store.restorePuzzles(plan);
  assert.equal(s.docs.get("puzzle-1").revision,6);
  assert.equal(s.docs.get("puzzle-1").title,"Archive");
  assert.equal(s.docs.get("puzzle-1").createdBy,"original-sl");
});
test("restore conflict aborts all writes even when another ID was new",async()=>{
  const s=setup([puzzle()]);
  const plan=planRestore(makeArchive([puzzle("new-puzzle"),puzzle()],when),await s.store.listPuzzles(),true);
  s.docs.get("puzzle-1").revision=2;
  await assert.rejects(s.store.restorePuzzles(plan),/another device/);
  assert.equal(s.writes,0);assert.equal(s.docs.has("new-puzzle"),false);
});
test("invalid later entry aborts before any transaction write",async()=>{
  const s=setup(),plan=planRestore(makeArchive([puzzle(),puzzle("puzzle-2")],when),[]);
  plan.entries[1].puzzle.pieces[0].x=6;
  await assert.rejects(s.store.restorePuzzles(plan));
  assert.equal(s.writes,0);assert.equal(s.docs.size,0);
});
test("network failure never reports successful save or partial restoration",async()=>{
  const s=setup();s.fail();
  await assert.rejects(s.store.savePuzzle({id:"puzzle-1",title:"New",layout:layout(puzzle())}),/Network/);
  await assert.rejects(s.store.restorePuzzles(planRestore(makeArchive([puzzle()],when),[])),/Network/);
  assert.equal(s.docs.size,0);
});
test("a 200-puzzle archive restores atomically in the adapter",async()=>{
  const s=setup();
  const a=makeArchive(Array.from({length:200},(_,i)=>puzzle("p-"+i)),when);
  await s.store.restorePuzzles(planRestore(a,[]));
  assert.equal(s.writes,200);assert.equal(s.docs.size,200);
});
test("SL deletion removes only the selected puzzle and stale saves cannot recreate it",async()=>{
  const s=setup([puzzle(),puzzle("duplicate")]);
  assert.deepEqual(await s.store.deletePuzzle({id:"duplicate",expectedRevision:1}),{id:"duplicate"});
  assert.equal(s.docs.has("duplicate"),false);
  assert.equal(s.docs.has("puzzle-1"),true);
  assert.equal(s.writes,1);
  await assert.rejects(s.store.savePuzzle({id:"duplicate",title:"Old layout",layout:layout(puzzle()),expectedRevision:1}),/another device/);
  assert.equal(s.docs.has("duplicate"),false);
});
test("deletion rejects changed and already deleted puzzles without writes",async()=>{
  const s=setup([puzzle("puzzle-1",{revision:2})]);
  for(const id of ["puzzle-1","missing"]) {
    await assert.rejects(s.store.deletePuzzle({id,expectedRevision:1}),/changed or was deleted/);
  }
  assert.equal(s.docs.size,1);assert.equal(s.writes,0);
});
test("deletion validates identity and revision before touching the library",async()=>{
  const s=setup([puzzle()]);
  for(const value of [
    {id:"../puzzle-1",expectedRevision:1},
    ...[undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER].map(expectedRevision=>({id:"puzzle-1",expectedRevision}))
  ]) await assert.rejects(s.store.deletePuzzle(value),/Invalid puzzle ID or revision/);
  assert.equal(s.docs.size,1);assert.equal(s.writes,0);
});
test("interrupted deletion retains every puzzle",async()=>{
  const s=setup([puzzle(),puzzle("duplicate")]);s.fail();
  await assert.rejects(s.store.deletePuzzle({id:"duplicate",expectedRevision:1}),/Network/);
  assert.equal(s.docs.size,2);assert.equal(s.writes,0);
});

test("CJ can create, update and delete puzzles while archive restore remains restricted",async()=>{
  const s=setup([],"CJ");
  await s.store.savePuzzle({id:"puzzle-1",title:"CJ puzzle",layout:layout(puzzle())});
  assert.equal(s.docs.get("puzzle-1").createdBy,"uid-CJ");
  await s.store.savePuzzle({id:"puzzle-1",title:"CJ update",layout:layout(puzzle()),expectedRevision:1});
  assert.equal(s.docs.get("puzzle-1").revision,2);
  await assert.rejects(s.store.savePuzzle({id:"puzzle-1",title:"Stale",layout:layout(puzzle()),expectedRevision:1}),/changed/);
  await assert.rejects(s.store.deletePuzzle({id:"puzzle-1",expectedRevision:1}),/changed or was deleted/);
  await s.store.deletePuzzle({id:"puzzle-1",expectedRevision:2});
  assert.equal(s.docs.has("puzzle-1"),false);
  await assert.rejects(s.store.restorePuzzles(planRestore(makeArchive([puzzle()],when),[])),/Only SL/);
});
