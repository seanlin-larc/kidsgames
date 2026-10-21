"""Cloud UI checks with a simulated gate and Firestore SDK; no live account is used."""
import json
from playwright.sync_api import sync_playwright, expect
from browser import ORIGIN, ARTIFACTS, route_files, puzzle

SDK = """
const read=()=>JSON.parse(localStorage.getItem('test-cloud-puzzles')||'{}');
const timestamp=value=>({toDate:()=>new Date(value)});
const fromWire=data=>({...data,createdAt:timestamp(data.createdAt),updatedAt:timestamp(data.updatedAt)});
const toWire=data=>({...data,
 createdAt:data.createdAt._serverTimestamp?new Date().toISOString():data.createdAt.toDate().toISOString(),
 updatedAt:data.updatedAt._serverTimestamp?new Date().toISOString():data.updatedAt.toDate().toISOString()});
export const doc=(db,...parts)=>({id:parts.at(-1)});
export const collection=(db,name)=>({name});
export const serverTimestamp=()=>({_serverTimestamp:true});
export async function getDocsFromServer(){
 if(window.testCloudDenied||window.testCloudReadDenied)throw Object.assign(Error('Denied'),{code:'permission-denied'});
 return {docs:Object.entries(read()).map(([id,data])=>({id,data:()=>fromWire(data)}))};
}
export async function runTransaction(db,work){
 if(!['SL','CJ'].includes(window.testPlayer)||window.testCloudDenied)throw Object.assign(Error('Denied'),{code:'permission-denied'});
 const staged=[];
 const result=await work({
  get:async ref=>{const data=read()[ref.id];return {exists:()=>!!data,data:()=>fromWire(data)};},
  set:(ref,data)=>staged.push([ref.id,toWire(data)]),
  delete:ref=>staged.push([ref.id,null])
 });
 if(window.testCloudDelay)await new Promise(resolve=>setTimeout(resolve,window.testCloudDelay));
 if(window.testCloudFailure)throw Error('Network interrupted');
 const all=read();for(const [id,data]of staged){if(data===null)delete all[id];else all[id]=data;}
 localStorage.setItem('test-cloud-puzzles',JSON.stringify(all));
 return result;
}
"""


def accept_dialog(dialog):
    dialog.accept()


def load(browser, code="SL", viewport=None):
    context = browser.new_context(viewport=viewport or dict(width=1200, height=900), has_touch=viewport is not None,
                                  service_workers="block", accept_downloads=True)
    context.route(ORIGIN + "/**", route_files)
    context.route("**/library-config.js", lambda route: route.fulfill(content_type="text/javascript", body="export const LIBRARY_ENABLED=true;"))
    context.route("**/shared/family.js", lambda route: route.fulfill(content_type="text/javascript", body="export const db={};export async function currentPlayer(){return {uid:'uid-'+window.testPlayer,code:window.testPlayer};}"))
    context.route("https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js", lambda route: route.fulfill(content_type="text/javascript", body=SDK))
    context.add_init_script(f"""
window.testPlayer={json.dumps(code)};
if(!sessionStorage.getItem('seeded')){{
 localStorage.setItem('mrl-editor-v1:uid-'+window.testPlayer,JSON.stringify({json.dumps(puzzle())}));
 sessionStorage.setItem('seeded','1');
}}
""")
    page=context.new_page()
    errors=[]
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", accept_dialog)
    page.goto(ORIGIN+"/move-red-loco/")
    expect(page.locator("#playerBar")).to_contain_text(code)
    return context,page,errors


def save(page, acknowledge=True):
    page.locator("#save").click()
    page.get_by_role("button",name="Save as Starter",exact=True).click()
    if acknowledge:
        expect(page.locator("#noticeCard")).to_be_visible()
        if page.locator("#noticeTitle").inner_text()=="Puzzle saved":
            expect(page.locator("#noticeMessage")).to_contain_text("Saved in the family library:")
            page.locator("#closeNotice").click()


def cloud(page):
    return page.evaluate("JSON.parse(localStorage.getItem('test-cloud-puzzles')||'{}')")


def send_archive(page, archive):
    page.locator("#archiveFile").set_input_files(dict(name="archive.json",mimeType="application/json",buffer=json.dumps(archive).encode()))


def action(page, name, puzzle_id=None, touch=False):
    trigger = page.locator('.library-menu[data-puzzle-id="'+puzzle_id+'"]') if puzzle_id else page.locator(".library-menu").first
    if not page.locator("#puzzleActions").evaluate("el=>el.matches(':popover-open')"):
        trigger.tap() if touch else trigger.click()
    option = page.locator('[data-library-action="'+name+'"]')
    expect(option).to_be_visible()
    option.tap() if touch else option.click()


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox"])
    for code in ["SL","CJ"]:
        context,page,errors=load(browser,code=code)
        # The middle block editor is unchanged; shared inventory counts follow actual pieces.
        assert page.locator(".details button").all_text_contents()==["Rotate (R)","Remove (Delete)","Deselect (Esc)"]
        expect(page.locator("#item-red .remaining")).to_have_text("0/1 Remaining")
        for selector in ["#item-h2","#item-v2"]:
            expect(page.locator(selector+" .remaining")).to_have_text("11/12 Remaining")
        expect(page.locator("#item-h3 .remaining")).to_have_text("5/5 Remaining")
        expect(page.locator("#item-platform .remaining")).to_have_text("2/2 Remaining")
        assert page.locator("#item-h2 .remaining").evaluate("el=>getComputedStyle(el).fontSize")==page.locator("#item-h2 .dimension").evaluate("el=>getComputedStyle(el).fontSize")
        assert page.locator(".left-panel #test,.left-panel #testResult,#reset,#openLibrary").count()==0
        expect(page.locator("#testResult")).to_have_text("")
        page.locator("#test").click()
        expect(page.locator("#testResult")).to_have_text("Solvable — 1 moves")
        page.locator('[data-piece-id="v2-1"]').click()
        page.locator("#rotate").click()
        expect(page.locator("#item-h2 .remaining")).to_have_text("11/12 Remaining")
        page.locator("#remove").click()
        expect(page.locator("#item-v2 .remaining")).to_have_text("12/12 Remaining")
        expect(page.locator("#testResult")).to_have_text("")
        page.locator("#undo").click()
        expect(page.locator("#item-v2 .remaining")).to_have_text("11/12 Remaining")
        page.locator("#undo").click()
        page.locator("#puzzleTitle").fill(code+" family puzzle")
        save(page)
        records=cloud(page);saved_id=next(iter(records));original=records[saved_id]
        assert original["createdBy"]=="uid-"+code
        with page.expect_download() as downloaded:
            page.locator("#export").click()
        layout_path=ARTIFACTS/(code+"-layout.json");downloaded.value.save_as(layout_path)
        layout=json.loads(layout_path.read_text())
        assert layout["title"]==code+" family puzzle"
        page.locator("#manageLibrary").click()
        with page.expect_download() as downloaded:
            page.locator("#downloadArchive").click()
        path=ARTIFACTS/(code+"-library.json");downloaded.value.save_as(path)
        archive=json.loads(path.read_text())
        assert archive["puzzleCount"]==1 and archive["puzzles"][0]["id"]==saved_id
        assert "createdBy" not in path.read_text() and "uid-" not in path.read_text()
        board_before=page.locator("#board").inner_html()
        send_archive(page,archive)
        expect(page.locator("#restoreSummary")).to_have_text("Add 1 puzzles as new copies. Existing puzzles will be kept.")
        expect(page.locator("#importPreview li")).to_have_text(code+" family puzzle · Starter")
        assert cloud(page)==records
        page.locator("#cancelRestore").click()
        assert cloud(page)==records
        send_archive(page,archive)
        page.evaluate("window.testCloudDelay=500")
        page.locator("#confirmRestore").click()
        expect(page.locator("#confirmRestore")).to_be_disabled()
        expect(page.locator("#cancelRestore")).to_be_disabled()
        page.keyboard.press("Escape")
        expect(page.locator("#restoreCard")).to_be_visible()
        expect(page.locator("#manageLibraryMessage")).to_contain_text("Imported 1 puzzles as new copies")
        records=cloud(page)
        assert len(records)==2 and records[saved_id]==original
        imported_id=next(i for i in records if i!=saved_id)
        assert records[imported_id]["createdBy"]=="uid-"+code
        assert page.locator("#board").inner_html()==board_before
        page.evaluate("window.testCloudDelay=0")
        # Single layout JSON imports into the library too, retaining its name.
        send_archive(page,layout)
        page.locator("#confirmRestore").click()
        expect(page.locator("#manageLibraryList li")).to_have_count(3)
        assert len(cloud(page))==3
        # A malformed later entry cannot add an earlier valid entry.
        before=cloud(page)
        send_archive(page,[archive["puzzles"][0],{**layout,"pieces":[None]}])
        expect(page.locator("#noticeMessage")).to_contain_text("Invalid puzzle block")
        page.locator("#closeNotice").click()
        assert cloud(page)==before
        for flag,expected in [("testCloudFailure","Network interrupted"),("testCloudDenied","Firebase refused")]:
            send_archive(page,archive)
            page.evaluate(f"window.{flag}=true")
            page.locator("#confirmRestore").click()
            expect(page.locator("#noticeMessage")).to_contain_text(expected)
            assert cloud(page)==before
            page.locator("#closeNotice").click()
            page.locator("#cancelRestore").click()
            page.evaluate(f"window.{flag}=false")
        # Edit targets the saved identity, so a later Save updates rather than duplicates it.
        action(page,"edit",saved_id)
        expect(page.locator("#manageLibraryCard")).not_to_be_visible()
        page.locator("#puzzleTitle").fill(code+" edited")
        save(page)
        assert len(cloud(page))==3 and cloud(page)[saved_id]["revision"]==2
        page.locator("#newPuzzle").click()
        expect(page.locator("#board .piece")).to_have_count(0)
        expect(page.locator("#item-red .remaining")).to_have_text("1/1 Remaining")
        expect(page.locator("#item-v2 .remaining")).to_have_text("12/12 Remaining")
        page.locator("#undo").click()
        expect(page.locator("#puzzleTitle")).to_have_value(code+" edited")
        save(page)
        assert len(cloud(page))==3 and cloud(page)[saved_id]["revision"]==3
        page.locator("#manageLibrary").click()
        context.set_offline(True)
        page.locator("#downloadArchive").click()
        expect(page.locator("#noticeMessage")).to_contain_text("Connect to the internet")
        page.locator("#closeNotice").click()
        page.locator("#closeManageLibrary").click()
        page.locator("#manageLibrary").click()
        expect(page.locator("#manageLibraryMessage")).to_contain_text("Offline")
        expect(page.locator("#manageLibraryList li")).to_have_count(3)
        assert not errors,errors
        context.close()
        print("PASS: "+code+" inventory, unchanged middle tools, Test Layout, JSON export, import preview/cancel/atomic copies, invalid/failed imports, Edit/Save identity, New/Reset/Undo, offline cache")

    context,page,errors=load(browser,code="YC")
    expect(page.locator("#manageLibrary")).not_to_be_visible()
    page.locator("#manageLibrary").dispatch_event("click")
    expect(page.locator("#manageLibraryCard")).not_to_be_visible()
    send_archive(page,archive)
    assert cloud(page)=={}
    assert not errors,errors
    context.close()
    print("PASS: YC cannot open Manage library or import cloud puzzles directly")

    context,page,errors=load(browser)
    page.locator("#puzzleTitle").fill("Duplicate puzzle")
    save(page)
    saved_id=next(iter(cloud(page)))
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-cloud-puzzles'));
      records['duplicate-puzzle']={...Object.values(records)[0],difficulty:'Pro'};
      localStorage.setItem('test-cloud-puzzles',JSON.stringify(records));
    }""")
    board_before=page.locator("#board").inner_html()
    draft_before=page.evaluate("localStorage.getItem('mrl-editor-v1:uid-SL')")
    expect(page.locator(".left-panel #manageLibrary")).to_be_visible()
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryList li")).to_have_count(2)
    assert page.locator("#manageLibraryList h3").all_text_contents() == ["Starter", "Beginner", "Amateur", "Pro", "Freak"]
    expect(page.locator('[data-tier="Starter"] li')).to_have_count(1)
    expect(page.locator('[data-tier="Pro"] li')).to_have_count(1)
    expect(page.locator(".manage-empty")).to_have_count(3)
    assert page.locator("#manageLibraryCard").bounding_box()["width"] >= 800
    page.screenshot(path=str(ARTIFACTS / "manage-library-desktop.png"))
    page.emulate_media(color_scheme="dark")
    expect(page.locator("html")).to_have_attribute("data-theme","dark")
    page.screenshot(path=str(ARTIFACTS / "manage-library-dark.png"))
    page.emulate_media(color_scheme="light")
    page.remove_listener("dialog", accept_dialog)
    confirmations=[]
    def cancel_delete(dialog):
        confirmations.append(dialog.message)
        dialog.dismiss()
    page.once("dialog",cancel_delete)
    action(page,"delete","duplicate-puzzle")
    assert len(confirmations)==1 and 'Delete "Duplicate puzzle"' in confirmations[0]
    assert len(cloud(page))==2
    expect(page.locator("#manageLibraryList li")).to_have_count(2)
    page.evaluate("window.testCloudDelay=600")
    page.once("dialog",lambda dialog: dialog.accept())
    action(page,"delete","duplicate-puzzle")
    expect(page.locator("#closeManageLibrary")).to_be_disabled()
    expect(page.locator(".library-menu").first).to_be_disabled()
    page.keyboard.press("Escape")
    expect(page.locator("#manageLibraryCard")).to_be_visible()
    expect(page.locator("#manageLibraryList li")).to_have_count(1)
    expect(page.locator("#manageLibraryMessage")).to_contain_text('Deleted "Duplicate puzzle"')
    assert list(cloud(page))==[saved_id]
    assert page.locator("#board").inner_html()==board_before
    assert page.evaluate("localStorage.getItem('mrl-editor-v1:uid-SL')")==draft_before
    cached=page.evaluate("JSON.parse(localStorage.getItem('mrl-library-v1:uid-SL'))")
    assert [p['id'] for p in cached]==[saved_id]
    page.evaluate("window.testCloudDelay=0")
    print("PASS: Manage library confirms each deletion, cancellation preserves both duplicates, busy controls prevent repeated deletion, and cache updates")

    for flag, expected in [("testCloudFailure","Network interrupted"),("testCloudDenied","Firebase refused")]:
        before=cloud(page)
        page.evaluate(f"window.{flag}=true")
        page.once("dialog",lambda dialog: dialog.accept())
        action(page,"delete")
        expect(page.locator("#noticeMessage")).to_contain_text(expected)
        assert cloud(page)==before
        expect(page.locator("#manageLibraryList li")).to_have_count(1)
        page.locator("#closeNotice").click()
        page.evaluate(f"window.{flag}=false")
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-cloud-puzzles'));
      Object.values(records)[0].revision++;
      localStorage.setItem('test-cloud-puzzles',JSON.stringify(records));
    }""")
    page.once("dialog",lambda dialog: dialog.accept())
    action(page,"delete")
    expect(page.locator("#noticeMessage")).to_contain_text("changed or was deleted")
    assert len(cloud(page))==1
    page.locator("#closeNotice").click()
    page.locator("#closeManageLibrary").click()
    page.locator("#manageLibrary").click()
    page.once("dialog",lambda dialog: dialog.accept())
    action(page,"delete")
    expect(page.locator("#manageLibraryList li")).to_have_count(0)
    expect(page.locator("#manageLibraryMessage")).to_contain_text("No puzzles have been saved yet")
    assert cloud(page)=={}
    page.locator("#closeManageLibrary").click()
    save(page)
    expect(page.locator("#noticeMessage")).to_contain_text("changed on another device")
    assert cloud(page)=={}
    page.locator("#closeNotice").click()
    context.set_offline(True)
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryMessage")).to_contain_text("Offline")
    expect(page.locator("#manageLibraryList li")).to_have_count(0)
    assert not errors,errors
    context.close()
    print("PASS: interrupted, denied, stale, and offline deletion preserve data; empty library and stale Save do not recreate deleted puzzles")

    context,page,errors=load(browser,viewport=dict(width=390,height=844))
    page.locator("#puzzleTitle").fill("A duplicate puzzle with a long name for the phone screen")
    save(page)
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-cloud-puzzles'));
      records['second-puzzle']={...Object.values(records)[0],title:'Puzzle 2'};
      localStorage.setItem('test-cloud-puzzles',JSON.stringify(records));
    }""")
    page.locator("#manageLibrary").tap()
    expect(page.locator("#manageLibraryList li")).to_have_count(2)
    tiles=page.locator("#manageLibraryList li")
    first,second=tiles.nth(0).bounding_box(),tiles.nth(1).bounding_box()
    assert abs(first["y"]-second["y"]) < 1 and second["x"] > first["x"]
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    assert page.locator("#manageLibraryList").evaluate("el=>el.scrollWidth<=el.clientWidth")
    page.screenshot(path=str(ARTIFACTS / "manage-library-phone.png"))
    action(page,"delete",touch=True)
    expect(page.locator("#manageLibraryList li")).to_have_count(1)
    action(page,"delete",touch=True)
    expect(page.locator("#manageLibraryList li")).to_have_count(0)
    assert cloud(page)=={}
    assert not errors,errors
    context.close()
    print("PASS: phone touch deletion and long puzzle names fit the management card")
    context,page,errors=load(browser,code="CJ")
    page.locator("#puzzleTitle").fill("Puzzle 2")
    save(page)
    saved_id=next(iter(cloud(page)))
    before=cloud(page)[saved_id]
    page.locator('[data-piece-id="v2-1"]').click()
    page.keyboard.press("ArrowDown")
    board_before=page.locator("#board").inner_html()
    draft_before=page.evaluate("localStorage.getItem('mrl-editor-v1:uid-CJ')")
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryCard")).to_be_visible()
    expect(page.locator(".library-menu")).to_be_visible()
    page.remove_listener("dialog",accept_dialog)
    def cancel_rename(dialog):
        assert dialog.default_value == "Puzzle 2"
        dialog.dismiss()
    page.once("dialog",cancel_rename)
    action(page,"rename")
    assert cloud(page)[saved_id] == before
    for invalid in ["   ","x"*81]:
        page.once("dialog",lambda dialog,value=invalid: dialog.accept(value))
        action(page,"rename")
        expect(page.locator("#noticeCard")).to_be_visible()
        expect(page.locator("#noticeMessage")).to_contain_text("Enter a puzzle name")
        page.locator("#closeNotice").click()
        assert cloud(page)[saved_id] == before
    page.evaluate("window.testCloudDelay=600")
    page.once("dialog",lambda dialog: dialog.accept("  Puzzle 10  "))
    action(page,"rename")
    expect(page.locator(".library-menu")).to_be_disabled()
    expect(page.locator(".library-menu")).to_be_disabled()
    expect(page.locator("#closeManageLibrary")).to_be_disabled()
    expect(page.locator("#manageLibraryMessage")).to_contain_text('Renamed puzzle to "Puzzle 10"')
    after=cloud(page)[saved_id]
    assert after["title"] == "Puzzle 10" and after["revision"] == 2
    assert after["updatedBy"] == "uid-CJ"
    for key in ["pieces","difficulty","exitRow","format","createdAt","createdBy"]:
        assert after[key] == before[key]
    assert page.locator("#board").inner_html() == board_before
    assert page.evaluate("localStorage.getItem('mrl-editor-v1:uid-CJ')") == draft_before
    expect(page.locator("#puzzleTitle")).to_have_value("Puzzle 10")
    page.evaluate("window.testCloudDelay=0")
    cached=page.evaluate("JSON.parse(localStorage.getItem('mrl-library-v1:uid-CJ'))")
    assert cached[0]["title"] == "Puzzle 10" and cached[0]["revision"] == 2
    page.once("dialog",lambda dialog: dialog.accept("Puzzle 10"))
    action(page,"rename")
    assert cloud(page)[saved_id]["revision"] == 2
    page.locator("#closeManageLibrary").click()
    context.set_offline(True)
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryList strong")).to_have_text("Puzzle 10")
    page.locator("#closeManageLibrary").click()
    context.set_offline(False)
    page.locator("#undo").click()
    expect(page.locator("#puzzleTitle")).to_have_value("Puzzle 10")
    save(page)
    assert cloud(page)[saved_id]["revision"] == 3 and cloud(page)[saved_id]["title"] == "Puzzle 10"
    print("PASS: CJ rename prompt, cancel, name validation, busy controls, metadata-only update, cache, preserved draft, and subsequent Save")

    # Seeing a newer library layout must not advance the loaded editor's stale base revision.
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-cloud-puzzles'));
      Object.values(records)[0].revision=4;Object.values(records)[0].pieces[1].y=2;
      localStorage.setItem('test-cloud-puzzles',JSON.stringify(records));
    }""")
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryCard")).to_be_visible()
    page.once("dialog",lambda dialog: dialog.accept("Remote layout name"))
    action(page,"rename")
    expect(page.locator("#manageLibraryMessage")).to_contain_text('Renamed puzzle to "Remote layout name"')
    page.locator("#closeManageLibrary").click()
    save(page,acknowledge=False)
    expect(page.locator("#noticeCard")).to_be_visible()
    expect(page.locator("#noticeMessage")).to_contain_text("changed on another device")
    assert cloud(page)[saved_id]["revision"] == 5 and cloud(page)[saved_id]["pieces"][1]["y"] == 2
    page.locator("#closeNotice").click()
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryCard")).to_be_visible()
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-cloud-puzzles'));
      Object.values(records)[0].revision=6;Object.values(records)[0].title='Other device name';
      localStorage.setItem('test-cloud-puzzles',JSON.stringify(records));
    }""")
    page.once("dialog",lambda dialog: dialog.accept("Stale rename"))
    action(page,"rename")
    expect(page.locator("#noticeCard")).to_be_visible()
    expect(page.locator("#noticeMessage")).to_contain_text("changed on another device")
    assert cloud(page)[saved_id]["title"] == "Other device name"
    page.locator("#closeNotice").click()
    page.locator("#closeManageLibrary").click()
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryCard")).to_be_visible()
    for flag,expected in [("testCloudFailure","Network interrupted"),("testCloudDenied","Firebase refused")]:
        before=cloud(page)
        page.evaluate(f"window.{flag}=true")
        page.once("dialog",lambda dialog: dialog.accept("Failed rename"))
        action(page,"rename")
        expect(page.locator("#noticeCard")).to_be_visible()
        expect(page.locator("#noticeMessage")).to_contain_text(expected)
        assert cloud(page) == before
        page.locator("#closeNotice").click()
        page.evaluate(f"window.{flag}=false")
    context.set_offline(True)
    page.once("dialog",lambda dialog: dialog.accept("Offline rename"))
    action(page,"rename")
    expect(page.locator("#noticeCard")).to_be_visible()
    expect(page.locator("#noticeMessage")).to_contain_text("Connect to the internet")
    assert cloud(page)[saved_id]["title"] == "Other device name"
    page.locator("#closeNotice").click()
    context.set_offline(False)
    page.evaluate("window.testCloudReadDenied=true")
    page.once("dialog",lambda dialog: dialog.accept("Saved despite refresh failure"))
    action(page,"rename")
    expect(page.locator("#manageLibraryMessage")).to_contain_text("The name was saved")
    assert cloud(page)[saved_id]["title"] == "Saved despite refresh failure"
    assert not errors,errors
    context.close()
    print("PASS: rename preserves unseen layout conflicts; stale, offline and failed writes do not rename; refresh failure does not hide confirmed success")

    context,page,errors=load(browser,code="SL",viewport=dict(width=390,height=844))
    page.locator("#puzzleTitle").fill("Phone puzzle")
    save(page)
    page.locator("#manageLibrary").tap()
    menu=page.locator(".library-menu").bounding_box()
    assert menu["width"] >= 44 and menu["height"] >= 44
    page.remove_listener("dialog",accept_dialog)
    page.once("dialog",lambda dialog: dialog.accept("Renamed on phone"))
    action(page,"rename",touch=True)
    expect(page.locator("#manageLibraryList strong")).to_have_text("Renamed on phone")
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    page.screenshot(path=str(ARTIFACTS / "manage-library-rename-phone.png"))
    assert not errors,errors
    context.close()
    print("PASS: SL touch menu offers rename, large touch targets, and no phone overflow")
    # Retain Save regressions while library controls move into the management card.
    context,page,errors=load(browser)
    page.locator("#puzzleTitle").fill("Slow save")
    before=page.locator("#board").inner_html()
    page.evaluate("window.testCloudDelay=600")
    save(page,acknowledge=False)
    expect(page.locator("#save")).to_be_disabled()
    expect(page.locator("#test")).to_be_disabled()
    page.locator('.exit-gate[data-exit-row="3"]').dispatch_event("click")
    page.locator("#item-h3").dispatch_event("keydown",dict(key="Enter"))
    page.locator('#board .tile[data-x="0"][data-y="0"]').dispatch_event("pointerdown",dict(button=0))
    page.keyboard.press("ArrowDown")
    expect(page.locator("#noticeTitle")).to_have_text("Puzzle saved")
    expect(page.locator("#noticeMessage")).to_have_text("Saved in the family library:\nSlow save")
    page.locator("#closeNotice").click()
    assert page.locator("#board").inner_html()==before
    page.evaluate("window.testCloudDelay=0")
    records=cloud(page)
    context.set_offline(True)
    page.locator("#puzzleTitle").fill("Offline draft")
    save(page,acknowledge=False)
    expect(page.locator("#status")).to_contain_text("Saved on this device")
    expect(page.locator("#noticeCard")).not_to_be_visible()
    assert cloud(page)==records
    assert page.evaluate("JSON.parse(localStorage.getItem('mrl-editor-v1:uid-SL')).title")=="Offline draft"
    assert not errors,errors
    context.close()
    print("PASS: slow cloud Save blocks layout edits and Test Layout; offline Save preserves a draft without claiming cloud success")

    context,page,errors=load(browser)
    page.evaluate("""() => {
      const original=Storage.prototype.setItem;
      let cloudCommitted=false;
      Storage.prototype.setItem=function(key,value){
        if(cloudCommitted && key.startsWith('mrl-editor-'))throw Error('Device storage unavailable');
        const result=original.call(this,key,value);
        if(key==='test-cloud-puzzles')cloudCommitted=true;
        return result;
      };
    }""")
    save(page,acknowledge=False)
    expect(page.locator("#noticeTitle")).to_have_text("Puzzle saved")
    expect(page.locator("#noticeMessage")).to_contain_text("The device copy could not be updated.")
    assert len(cloud(page))==1
    assert not errors,errors
    context.close()
    print("PASS: cloud Save confirmation stays accurate when the later device write fails")

    # Short windows keep library actions visible and menu options escape the tile scroll area.
    context,page,errors=load(browser,code="CJ")
    page.locator("#puzzleTitle").fill("Original")
    save(page)
    original=cloud(page);saved_id=next(iter(original))
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-cloud-puzzles'));
      const first=Object.values(records)[0];
      for(let i=1;i<=60;i++)records['copy-'+i]={...first,title:'Puzzle '+i};
      localStorage.setItem('test-cloud-puzzles',JSON.stringify(records));
    }""")
    page.locator("#manageLibrary").click()
    for width,height in [(1200,650),(700,500),(390,700),(844,390)]:
        page.set_viewport_size(dict(width=width,height=height))
        expect(page.locator("#manageLibraryCard")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        for selector in ["#closeManageLibrary","#downloadArchive","#restoreArchive"]:
            box=page.locator(selector).bounding_box()
            assert box and box["y"]>=0 and box["y"]+box["height"]<=height
        grid=page.locator("#manageLibraryList")
        assert grid.evaluate("el=>el.scrollHeight>el.clientHeight && el.scrollWidth<=el.clientWidth")
        grid.evaluate("el=>el.scrollTop=el.scrollHeight")
        trigger=page.locator(".library-menu").last
        trigger.click()
        menu=page.locator("#puzzleActions")
        expect(menu).to_be_visible()
        box=menu.bounding_box()
        assert box["y"]>=0 and box["y"]+box["height"]<=height
        page.keyboard.press("ArrowDown")
        expect(page.locator('[data-library-action="rename"]')).to_be_focused()
        page.keyboard.press("Escape")
        expect(menu).not_to_be_visible()
        expect(trigger).to_be_focused()
        expect(page.locator("#manageLibraryCard")).to_be_visible()
        page.screenshot(path=str(ARTIFACTS/f"workshop-library-{width}x{height}.png"))
    page.set_viewport_size(dict(width=1200,height=900))
    # Cancel Edit, reset, and single-layout import without changing the draft.
    page.remove_listener("dialog",accept_dialog)
    board_before=page.locator("#board").inner_html()
    page.once("dialog",lambda dialog:dialog.dismiss())
    action(page,"edit",saved_id)
    expect(page.locator("#manageLibraryCard")).to_be_visible()
    assert page.locator("#board").inner_html()==board_before
    page.locator("#closeManageLibrary").click()
    page.once("dialog",lambda dialog:dialog.dismiss())
    page.locator("#newPuzzle").click()
    assert page.locator("#board").inner_html()==board_before
    page.once("dialog",lambda dialog:dialog.dismiss())
    page.locator("#importFile").set_input_files(dict(name="layout.json",mimeType="application/json",buffer=json.dumps(puzzle([])).encode()))
    expect(page.locator("#status")).not_to_contain_text("Imported 0")
    assert page.locator("#board").inner_html()==board_before
    page.on("dialog",accept_dialog)
    page.locator("#newPuzzle").click()
    expect(page.locator("#board .piece")).to_have_count(0)
    page.locator("#puzzleTitle").fill("Separate blank puzzle")
    save(page)
    records=cloud(page)
    assert len(records)==62 and records[saved_id]==original[saved_id]
    # Verify the requested three-row layout, including an initially blank full-width output.
    for width,height in [(1200,900),(700,800),(390,844)]:
        page.set_viewport_size(dict(width=width,height=height))
        reset=page.locator("#newPuzzle").bounding_box();test=page.locator("#test").bounding_box()
        result=page.locator("#testResult").bounding_box();export=page.locator("#export").bounding_box()
        imported=page.locator("#import").bounding_box()
        assert abs(reset['y']-test['y'])<1 and reset['x']<test['x']
        assert result['y']>=reset['y']+reset['height'] and result['width']>=reset['width']+test['width']
        assert export['y']>=result['y']+result['height'] and abs(export['y']-imported['y'])<1
        page.screenshot(path=str(ARTIFACTS/f"workshop-actions-{width}x{height}.png"))
    assert not errors,errors
    context.close()
    print("PASS: responsive library scrolling, visible header actions, keyboard menu, cancelled Edit/reset/import, new puzzle identity, three-row layout actions")
    browser.close()
