"""Player-page checks with simulated account and Firebase SDK responses, never production data."""
import json
from playwright.sync_api import sync_playwright, expect
from browser import ORIGIN, ARTIFACTS, route_files, RED, BLOCKER

WHEN = "2026-10-20T00:00:00.000Z"


def library_puzzle(id="puzzle-1", title="Puzzle 1", **changes):
    return dict(id=id, title=title, format="move-red-loco-puzzle-v1", difficulty="Beginner",
                pieces=[RED, BLOCKER], exitRow=2, revision=1, createdAt=WHEN, updatedAt=WHEN, **changes)


SDK = """
const read=key=>JSON.parse(localStorage.getItem(key)||'{}');
const denied=()=>Object.assign(Error('Permission denied'),{code:'permission-denied'});
const date=value=>({toDate:()=>new Date(value),toMillis:()=>new Date(value).getTime()});
export const collection=(db,...parts)=>({path:parts.join('/')});
export const doc=(db,...parts)=>({path:parts.join('/')});
export const serverTimestamp=()=>({_serverTimestamp:true});
export async function runTransaction(){throw Error("Transactions are unused in player-page checks");}
export const Timestamp={fromMillis:value=>date(value)};
export async function getDocsFromServer(ref){
 if(window.testCloudOffline)throw Error('Offline');
 if(ref.path==='puzzleLibrary'){
  if(window.testLibraryDenied)throw denied();
  return {docs:Object.values(read('test-puzzles')).map(p=>({id:p.id,data:()=>({...p,createdAt:date(p.createdAt),updatedAt:date(p.updatedAt)})}))};
 }
 if(window.testProgressDenied)throw denied();
 if(ref.path!=='puzzleProgress/uid-'+window.testPlayer+'/solved')throw denied();
 return {docs:Object.entries(read('test-server-records')).filter(([id])=>id.startsWith(ref.path+'/')).map(([id,r])=>({id,data:()=>({...r,playedAt:date(r.playedAt)})}))};
}
export async function setDoc(ref,r){
 if(window.testCloudOffline)throw Error('Offline');
 if(window.testProgressDenied||r.uid!=='uid-'+window.testPlayer)throw denied();
 const all=read('test-server-records');
 if(all[ref.path])throw denied();
 all[ref.path]={...r,playedAt:r.playedAt.toMillis(),date:Date.now()};
 localStorage.setItem('test-server-records',JSON.stringify(all));
 window.testWrites=(window.testWrites||0)+1;
}
export async function getDoc(ref){
 const data=read('test-server-records')[ref.path];return {exists:()=>!!data,data:()=>data};
}
"""


def load(browser, code="SL", viewport=None, offline=False, server=None):
    context = browser.new_context(viewport=viewport or dict(width=1200, height=900),
                                  has_touch=viewport is not None, service_workers="block")
    context.route(ORIGIN + "/**", route_files)
    context.route("**/shared/gate.js", lambda route: route.fulfill(content_type="text/javascript", body="""
export async function enterGame({bar}){bar.textContent='Playing as '+window.testPlayer;document.body.classList.remove('kg-wait');return {player:{uid:'uid-'+window.testPlayer,code:window.testPlayer}};}
export const withTimeout=promise=>promise;
"""))
    context.route("**/shared/family.js", lambda route: route.fulfill(content_type="text/javascript", body="export const db={};export async function currentPlayer(){return {uid:'uid-'+window.testPlayer,code:window.testPlayer};}"))
    context.route("https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js", lambda route: route.fulfill(content_type="text/javascript", body=SDK))
    puzzles = [library_puzzle(), library_puzzle("puzzle-10", "Puzzle 10"),
               {**library_puzzle("clear", "Clear start"), "difficulty": "Starter", "pieces": [RED]},
               {**library_puzzle("incomplete", "Workshop draft"), "difficulty": "Pro", "pieces": []}]
    context.add_init_script(f"""
window.testPlayer={json.dumps(code)};
window.testNetworkOnline={json.dumps(not offline)};
Object.defineProperty(navigator,'onLine',{{get:()=>window.testNetworkOnline}});
if(!sessionStorage.getItem('seeded')){{
localStorage.setItem('test-puzzles',JSON.stringify({json.dumps({p['id']: p for p in puzzles})}));
localStorage.setItem('test-server-records',JSON.stringify({json.dumps(server or {})}));
localStorage.setItem('mrl-library-v1:uid-'+window.testPlayer,JSON.stringify({json.dumps(puzzles)}));
sessionStorage.setItem('seeded','1');
}}
""")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(ORIGIN + "/move-red-loco/play.html")
    expect(page.locator(".puzzle-choice")).to_have_count(4)
    return context, page, errors


def start(page, id="puzzle-1"):
    page.locator(f'[data-puzzle-id="{id}"]').click()
    page.locator("#play").click()
    expect(page.locator("#playing")).to_be_visible()


def move(page, id, key):
    page.locator(f'[data-piece-id="{id}"]').focus()
    page.keyboard.press(key)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context, page, errors = load(browser)
    expect(page.locator("#workshop")).to_be_visible()
    expect(page.locator("#play")).to_be_disabled()
    assert page.locator(".tier-group h3").all_text_contents() == ["Starter", "Beginner", "Amateur", "Pro", "Freak"]
    page.locator('[data-puzzle-id="incomplete"]').click()
    expect(page.locator("#play")).to_be_disabled()
    expect(page.locator("#libraryStatus")).to_contain_text("Cannot play")
    start(page)
    expect(page.locator("#puzzleHeading")).to_have_text("Puzzle 1")
    expect(page.locator("#upperExit")).to_have_class("exit active")
    move(page, "red", "ArrowUp")
    expect(page.locator("#moveCount")).to_have_text("Moves: 0")
    move(page, "red", "ArrowRight")
    expect(page.locator("#moveCount")).to_have_text("Moves: 1")
    page.locator("#undo").click()
    expect(page.locator("#moveCount")).to_have_text("Moves: 0")
    page.locator("#redo").click()
    expect(page.locator("#moveCount")).to_have_text("Moves: 1")
    page.locator("#choose").click()
    page.locator("#resume").click()
    expect(page.locator("#moveCount")).to_have_text("Moves: 1")
    page.once("dialog", lambda dialog: dialog.dismiss())
    page.locator("#restart").click()
    expect(page.locator("#moveCount")).to_have_text("Moves: 1")
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#restart").click()
    expect(page.locator("#moveCount")).to_have_text("Moves: 0")
    move(page, "red", "ArrowRight")
    page.locator("#undo").click()
    move(page, "v2-1", "ArrowDown")
    expect(page.locator("#redo")).to_be_disabled()
    page.locator("#choose").click()
    page.locator('[data-puzzle-id="puzzle-10"]').click()
    page.once("dialog", lambda dialog: dialog.dismiss())
    page.locator("#play").click()
    expect(page.locator("#selector")).to_be_visible()
    page.locator("#resume").click()
    expect(page.locator("#puzzleHeading")).to_have_text("Puzzle 1")
    move(page, "v2-1", "ArrowDown")
    expect(page.locator("#completion")).to_be_visible()
    expect(page.locator("#completionMessage")).to_have_text("Solved in 2 moves!")
    expect(page.locator("#moveList li")).to_have_count(2)
    expect(page.locator("#undo")).to_be_disabled()
    expect(page.locator("#progressStatus")).to_be_empty()
    page.wait_for_function("window.testWrites===1")
    final_board = page.locator("#board .piece").evaluate_all("pieces=>pieces.map(p=>[p.dataset.pieceId,p.style.left,p.style.top,p.textContent])")
    page.locator("#replay").click()
    expect(page.locator("#status")).to_contain_text("Replay finished")
    assert page.locator("#board .piece").evaluate_all("pieces=>pieces.map(p=>[p.dataset.pieceId,p.style.left,p.style.top,p.textContent])") == final_board
    assert page.evaluate("window.testWrites") == 1
    page.screenshot(path=str(ARTIFACTS / "player-completed-desktop.png"), full_page=True)
    page.locator("#another").click()
    expect(page.locator('[data-puzzle-id="puzzle-1"]')).to_have_class("puzzle-choice solved")
    page.evaluate("const p=JSON.parse(localStorage.getItem('test-puzzles'));p['puzzle-1'].title='Renamed puzzle';p['puzzle-1'].revision++;localStorage.setItem('test-puzzles',JSON.stringify(p))")
    page.locator("#refresh").click()
    expect(page.locator('[data-puzzle-id="puzzle-1"]')).to_contain_text("Renamed puzzle")
    expect(page.locator('[data-puzzle-id="puzzle-1"]')).to_have_class("puzzle-choice solved")
    server = page.evaluate("JSON.parse(localStorage.getItem('test-server-records'))")
    page.evaluate("const p=JSON.parse(localStorage.getItem('test-puzzles'));p['puzzle-1'].pieces[1].y=2;localStorage.setItem('test-puzzles',JSON.stringify(p))")
    page.locator("#refresh").click()
    expect(page.locator('[data-puzzle-id="puzzle-1"]')).to_have_class("puzzle-choice")
    assert not errors, errors
    context.close()
    print("PASS: all saved puzzles, incomplete-layout message, controls, branch history, confirmations, completion, replay, rename and layout identity")

    context, page, errors = load(browser, server=server)
    expect(page.locator('[data-puzzle-id="puzzle-1"]')).to_have_class("puzzle-choice solved")
    start(page, "clear")
    expect(page.locator("#completionMessage")).to_have_text("Solved in 0 moves!")
    expect(page.locator("#replay")).to_be_disabled()
    page.locator("#again").click()
    expect(page.locator("#completionMessage")).to_have_text("Solved in 0 moves!")
    page.wait_for_function("Object.keys(JSON.parse(localStorage.getItem('test-server-records'))).length===2")
    assert page.evaluate("window.testWrites") == 1
    assert not errors, errors
    context.close()
    print("PASS: another device loads cloud progress, zero-move completion, Play Again does not duplicate progress")

    context, page, errors = load(browser, code="CJ", viewport=dict(width=390, height=844), offline=True)
    expect(page.locator("#workshop")).to_be_visible()
    expect(page.locator("#libraryStatus")).to_contain_text("Offline library")
    start(page)
    piece = page.locator('[data-piece-id="v2-1"]')
    box = piece.bounding_box()
    size = page.locator("#board").bounding_box()["width"] / 7
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    client = context.new_cdp_session(page)
    client.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [dict(x=x, y=y)]})
    client.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [dict(x=x, y=y + 2 * size)]})
    client.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    expect(page.locator("#completionMessage")).to_have_text("Solved in 1 move!")
    expect(page.locator("#progressStatus")).to_contain_text("waiting to sync")
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    page.locator("#movePanel summary").click()
    expect(page.locator("#moveList li")).to_have_count(1)
    page.screenshot(path=str(ARTIFACTS / "player-completed-phone.png"), full_page=True)
    page.reload()
    expect(page.locator('[data-puzzle-id="puzzle-1"]')).to_have_class("puzzle-choice solved")
    page.evaluate("window.testNetworkOnline=true;window.dispatchEvent(new Event('online'))")
    page.wait_for_function("window.testWrites===1")
    expect(page.locator("#progressStatus")).to_be_empty()
    assert not errors, errors
    context.close()
    print("PASS: phone touch slide, expandable moves, no overflow, offline progress survives reload and syncs on reconnect")

    context, page, errors = load(browser, code="CJ")
    page.evaluate("window.testProgressDenied=true")
    start(page, "clear")
    expect(page.locator("#progressStatus")).to_contain_text("waiting to sync")
    expect(page.locator("#progressStatus")).to_contain_text("unavailable")
    assert page.evaluate("window.testWrites||0") == 0
    page.locator("#another").click()
    expect(page.locator('[data-puzzle-id="clear"]')).to_have_class("puzzle-choice solved")
    page.evaluate("window.testProgressDenied=false")
    page.locator("#refresh").click()
    page.wait_for_function("window.testWrites===1")
    expect(page.locator("#progressStatus")).to_be_empty()
    for expected in ["light", "dark", "auto"]:
        page.locator("#themeBtn").click()
        expect(page.locator("html")).to_have_attribute("data-theme-setting", expected)
    page.screenshot(path=str(ARTIFACTS / "player-selector.png"), full_page=True)
    assert not errors, errors
    context.close()
    print("PASS: denied progress remains pending and retries after access returns; shared Light/Dark/Auto preference")

    for code in ["YC", "JY", "Guest"]:
        context, page, errors = load(browser, code=code, server=server)
        expect(page.locator("#workshop")).not_to_be_visible()
        expect(page.locator('[data-puzzle-id="puzzle-1"]')).to_have_class("puzzle-choice")
        assert not errors, errors
        context.close()
    print("PASS: Workshop visibility and progress isolation for YC, JY and Guest")
    context, page, errors = load(browser, viewport=dict(width=1200, height=600))
    start(page)
    page.locator("#choose").click()
    expect(page.locator("#resume")).to_be_visible()
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-puzzles'));
      for(let n=1;n<=60;n++)records['layout-'+n]={...records['puzzle-1'],id:'layout-'+n,title:'Layout '+String(n).padStart(2,'0')};
      localStorage.setItem('test-puzzles',JSON.stringify(records));
    }""")
    page.locator("#refresh").click()
    expect(page.locator(".puzzle-choice")).to_have_count(64)
    controls=[page.locator('#'+id).bounding_box() for id in ["play","refresh","resume","workshop"]]
    assert max(box["y"] for box in controls)-min(box["y"] for box in controls) < 1
    assert all(a["x"]+a["width"] <= b["x"] for a,b in zip(controls,controls[1:]))
    assert page.locator("#puzzleTiers").evaluate("el=>el.scrollHeight>el.clientHeight")
    heading_y=page.locator(".selector-heading").bounding_box()["y"]
    page.locator("#puzzleTiers").hover()
    page.mouse.wheel(0,5000)
    page.wait_for_function("document.getElementById('puzzleTiers').scrollTop>0")
    assert abs(page.locator(".selector-heading").bounding_box()["y"]-heading_y)<1
    assert page.evaluate("window.scrollY===0 && document.documentElement.scrollHeight<=innerHeight+1")
    target=page.locator('[data-puzzle-id="layout-60"]')
    target.scroll_into_view_if_needed()
    scroll_before=page.locator("#puzzleTiers").evaluate("el=>el.scrollTop")
    target.click()
    expect(page.locator('[data-puzzle-id="layout-60"]')).to_have_attribute("aria-pressed","true")
    assert abs(page.locator("#puzzleTiers").evaluate("el=>el.scrollTop")-scroll_before)<2
    expect(page.locator("#play")).to_be_in_viewport()
    page.screenshot(path=str(ARTIFACTS / "selector-top-controls-desktop.png"))
    for width,height in [(930,650),(700,500),(390,700),(844,390)]:
        page.set_viewport_size(dict(width=width,height=height))
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        for id in ["play","refresh","resume","workshop"]:
            expect(page.locator('#'+id)).to_be_in_viewport()
        assert page.locator("#puzzleTiers").evaluate("el=>el.clientHeight>=86 && el.scrollHeight>el.clientHeight"), (width,height)
    page.set_viewport_size(dict(width=390,height=700))
    rows=[round(page.locator('#'+id).bounding_box()["y"]) for id in ["play","refresh","resume","workshop"]]
    assert len(set(rows))>1
    page.locator("#puzzleTiers").focus()
    page.keyboard.press("End")
    page.wait_for_function("document.getElementById('puzzleTiers').scrollTop>0")
    page.screenshot(path=str(ARTIFACTS / "selector-top-controls-phone.png"))
    page.locator("#play").click()
    expect(page.locator("#puzzleHeading")).to_have_text("Layout 60")
    expect(page.locator("#board")).to_be_visible()
    assert not errors,errors
    context.close()
    print("PASS: selector buttons precede Workshop, wrap without overflow, and stay visible while tiles scroll; selection retains scroll; keyboard scrolling and Play work")
    browser.close()
