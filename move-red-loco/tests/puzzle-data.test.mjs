import test from "node:test";
import assert from "node:assert/strict";
import { normalizePuzzleData, nextPieceId, writeDraft } from "../puzzle-data.js";
import { solvePuzzle } from "../solver.js";
import { attemptSlide, attemptExit } from "../play-rules.js";

const red = {id:"red",type:"red",x:0,y:2,w:2,h:1,axis:"h",label:"X"};
const blocker = {id:"v2-1",type:"v2",x:3,y:1,w:1,h:2,axis:"v",label:"A",hue:120};
const draft = (pieces = [red,blocker], extra = {}) => ({format:"move-red-loco-editor-v1",difficulty:"Starter",exitRow:2,pieces:structuredClone(pieces),...extra});

test("JSON roundtrip preserves rotated pieces and puzzle metadata", () => {
  const rotated = {...blocker,id:"h2-4",type:"h2"};
  const input = draft([red,rotated],{difficulty:"Pro"});
  assert.deepEqual(normalizePuzzleData(JSON.parse(JSON.stringify(input))),input);
});
test("legacy tiers and missing exit remain compatible", () => {
  for (const [old,now] of Object.entries({Medium:"Amateur",Intermediate:"Amateur",Hard:"Pro",Crazy:"Freak"})) {
    const input = draft([{...red,y:3}],{difficulty:old});
    delete input.exitRow;
    const clean = normalizePuzzleData(input);
    assert.equal(clean.difficulty,now);
    assert.equal(clean.exitRow,3);
  }
});
test("drafts may be empty or lack red, labels, and colors", () => {
  assert.equal(normalizePuzzleData(draft([])).pieces.length,0);
  const piece = {...blocker}; delete piece.label; delete piece.hue;
  assert.deepEqual(normalizePuzzleData(draft([piece])).pieces,[piece]);
});
test("normalization strips account data and aligns an explicit valid exit to red", () => {
  const clean = normalizePuzzleData({...draft(),uid:"private",savedAt:"device-only",nextId:999,exitRow:3});
  assert.deepEqual(Object.keys(clean).sort(),["difficulty","exitRow","format","pieces"]);
  assert.equal(clean.exitRow,2);
});
for (const [name,input] of [
  ["null document",null], ["array document",[]], ["null block",draft([null])],
  ["prototype type",draft([{...blocker,type:"__proto__"}])],
  ["duplicate IDs",draft([red,red])], ["off-board block",draft([{...red,x:6}])],
  ["overlap",draft([red,{...blocker,x:1}])], ["invalid gate",draft([red],{exitRow:4})],
  ["invalid shape",draft([{...blocker,w:2,h:2}])], ["invalid axis",draft([{...blocker,axis:"both"}])],
  ["invalid hue",draft([{...blocker,hue:0}])], ["unsafe ID",draft([{...blocker,id:"v2-9007199254740992"}])],
  ["wrong red ID",draft([{...red,id:"h2-1"}])], ["wrong red row",draft([{...red,y:0}])]
]) test("rejects " + name, () => assert.throws(()=>normalizePuzzleData(input)));
test("next ID ignores saved counters and large numeric suffixes", () => {
  const clean = normalizePuzzleData(draft([{...blocker,id:"v2-9007199254740990"}],{nextId:"Infinity"}));
  assert.equal(nextPieceId(clean.pieces),1);
  assert.equal(nextPieceId([red,blocker]),2);
});

function storage(failAt = -1, silent = false, existing = true) {
  const values = new Map(existing ? [["draft:starter","old-tier"],["draft","old-latest"]] : []);
  let calls = 0;
  return {values,getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k),setItem(k,v){
    if (++calls === failAt) { if (silent) return; throw Error("Quota exceeded"); }
    values.set(k,v);
  }};
}
test("Save writes identical tier and latest data", () => {
  const s=storage(); writeDraft(s,"draft",draft());
  assert.equal(s.getItem("draft"),s.getItem("draft:starter"));
  assert.deepEqual(JSON.parse(s.getItem("draft")),draft());
});
for (const step of [1,2]) for (const silent of [false,true]) for (const existing of [false,true]) {
  test(`Save failure at write ${step}, silent=${silent}, existing=${existing} restores both slots`,()=>{
    const s=storage(step,silent,existing),before=new Map(s.values);
    assert.throws(()=>writeDraft(s,"draft",draft()),/Previous saves were kept/);
    assert.deepEqual(s.values,before);
  });
}
test("unrecoverable storage errors do not claim old saves were kept",()=>{
  const s={getItem:()=>"old",setItem(){throw Error("unavailable");},removeItem(){throw Error("unavailable");}};
  assert.throws(()=>writeDraft(s,"draft",draft()),/could not be fully restored/);
});
test("a clear initial board solves in zero moves",()=>{
  const result=solvePuzzle([red],2);
  assert.equal(result.steps,0); assert.deepEqual(result.solution,[]);
});
test("one blocker slide clears the path with no synthetic exit move",()=>{
  const result=solvePuzzle([red,blocker],2);
  assert.equal(result.steps,1); assert.equal(result.solution.length,1);
  assert.equal(result.solution[0].id,blocker.id);
  assert.notEqual(result.solution[0].direction,"exit");
  const moved=attemptSlide([red,blocker],blocker.id,0,2,2);
  assert.deepEqual(moved,{status:"moved",x:3,y:3});
  assert.equal(attemptExit([red,{...blocker,...moved}],2).status,"won");
});
test("right-edge blockers and inactive gates cannot complete a puzzle",()=>{
  assert.equal(attemptExit([red,{...blocker,x:6}],2).status,"blocked");
  assert.equal(attemptExit([red],3).status,"blocked");
  assert.equal(solvePuzzle([red],3).status,"unsolvable");
});
test("no-op, wrong-axis, and blocked slides remain blocked",()=>{
  assert.equal(attemptSlide([red,blocker],red.id,0,0,2).status,"blocked");
  assert.equal(attemptSlide([red,blocker],blocker.id,1,0,2).status,"blocked");
  assert.equal(attemptSlide([red,{...blocker,x:2}],red.id,1,0,2).status,"blocked");
});
