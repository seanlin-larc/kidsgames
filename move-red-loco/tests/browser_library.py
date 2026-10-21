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
 if(window.testCloudDenied)throw Object.assign(Error('Denied'),{code:'permission-denied'});
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
    expect(page.locator("#libraryTools")).to_be_visible()
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


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox"])
    context,page,errors=load(browser)
    page.locator("#puzzleTitle").fill("First family puzzle")
    save(page)
    expect(page.locator("#status")).to_contain_text("Saved in the family library")
    records=cloud(page)
    assert len(records)==1
    saved_id=next(iter(records))
    assert records[saved_id]["revision"]==1
    save(page)
    expect(page.locator("#status")).to_contain_text("Saved in the family library")
    assert len(cloud(page))==1 and cloud(page)[saved_id]["revision"]==2

    with page.expect_download() as downloaded:
        page.locator("#downloadArchive").click()
    path=ARTIFACTS / downloaded.value.suggested_filename
    downloaded.value.save_as(path)
    archive=json.loads(path.read_text())
    assert archive["puzzleCount"]==1 and archive["puzzles"][0]["id"]==saved_id
    assert "createdBy" not in archive["puzzles"][0] and "updatedBy" not in archive["puzzles"][0]
    assert "uid-SL" not in path.read_text()
    print("PASS: real cloud adapter with simulated SDK saves stable IDs and downloads server archive without account fields")

    second={**archive["puzzles"][0],"id":"restored-puzzle","title":"Restored puzzle"}
    restore={**archive,"puzzleCount":2,"puzzles":[archive["puzzles"][0],second]}
    send_archive(page,restore)
    expect(page.locator("#restoreSummary")).to_have_text("1 new puzzles. 0 existing puzzles to replace. 1 existing puzzles to keep.")
    page.locator("#confirmRestore").click()
    expect(page.locator("#status")).to_contain_text("Restored 1 puzzles")
    assert len(cloud(page))==2 and cloud(page)[saved_id]["revision"]==2
    assert cloud(page)["restored-puzzle"]["revision"]==1

    restore["puzzles"][0]["title"]="Archive replacement"
    send_archive(page,restore)
    expect(page.locator("#restoreCard")).to_be_visible()
    page.locator("#overwriteExisting").check()
    expect(page.locator("#restoreSummary")).to_contain_text("2 existing puzzles to replace")
    page.screenshot(path=str(ARTIFACTS / "restore-preview.png"))
    page.locator("#confirmRestore").click()
    expect(page.locator("#status")).to_contain_text("Restored 2 puzzles")
    assert cloud(page)[saved_id]["revision"]==3
    save(page)
    expect(page.locator("#noticeMessage")).to_contain_text("changed on another device")
    assert len(cloud(page))==2
    page.locator("#closeNotice").click()
    print("PASS: restore skips existing by default, requires explicit replacement, and stale loaded layout cannot create a duplicate")

    page.locator("#openLibrary").click()
    expect(page.locator("#libraryCard")).to_be_visible()
    page.locator("#librarySelect").select_option(saved_id)
    page.locator("#loadPuzzle").click()
    expect(page.locator("#puzzleTitle")).to_have_value("Archive replacement")
    page.locator('[data-piece-id="v2-1"]').click()
    page.keyboard.press("ArrowUp")
    save(page)
    expect(page.locator("#status")).to_contain_text("Saved in the family library")
    assert cloud(page)[saved_id]["revision"]==4
    page.locator("#undo").click()
    save(page)
    expect(page.locator("#status")).to_contain_text("Saved in the family library")
    assert cloud(page)[saved_id]["revision"]==5
    print("PASS: library load and Undo after Save preserve current concurrency revision")

    # A slow save freezes every layout mutation path until the awaited write completes.
    before=page.locator("#board").inner_html()
    page.evaluate("window.testCloudDelay=600")
    save(page, acknowledge=False)
    expect(page.locator("#save")).to_be_disabled()
    expect(page.locator("#noticeCard")).not_to_be_visible()
    page.locator('.exit-gate[data-exit-row="3"]').dispatch_event("click")
    page.locator("#item-h3").dispatch_event("keydown",dict(key="Enter"))
    page.locator('#board .tile[data-x="0"][data-y="0"]').dispatch_event("pointerdown",dict(button=0))
    page.keyboard.press("ArrowDown")
    expect(page.locator("#status")).to_contain_text("Saved in the family library")
    expect(page.locator("#noticeTitle")).to_have_text("Puzzle saved")
    expect(page.locator("#noticeMessage")).to_have_text("Saved in the family library:\nArchive replacement")
    page.screenshot(path=str(ARTIFACTS / "cloud-save-confirmation.png"))
    page.locator("#closeNotice").click()
    assert page.locator("#board").inner_html()==before
    page.evaluate("window.testCloudDelay=0")
    print("PASS: delayed cloud Save blocks exit, palette, board, and keyboard edits")

    before=cloud(page)
    broken={**archive,"puzzleCount":2,"puzzles":[archive["puzzles"][0],archive["puzzles"][0]]}
    send_archive(page,broken)
    expect(page.locator("#noticeMessage")).to_contain_text("duplicate")
    assert cloud(page)==before
    page.locator("#closeNotice").click()
    page.evaluate("window.testCloudFailure=true")
    save(page)
    expect(page.locator("#noticeMessage")).to_have_text("Network interrupted")
    assert cloud(page)==before
    assert page.evaluate("JSON.parse(localStorage.getItem('mrl-editor-v1:uid-SL')).title")=="Archive replacement"
    page.locator("#closeNotice").click()
    page.evaluate("window.testCloudFailure=false")
    context.set_offline(True)
    save(page, acknowledge=False)
    expect(page.locator("#status")).to_contain_text("Saved on this device")
    expect(page.locator("#noticeCard")).not_to_be_visible()
    assert cloud(page)==before
    page.locator("#downloadArchive").click()
    expect(page.locator("#noticeMessage")).to_contain_text("Connect to the internet")
    page.locator("#closeNotice").click()
    page.locator("#openLibrary").click()
    expect(page.locator("#libraryMessage")).to_contain_text("Offline")
    page.locator("#closeLibrary").click()
    assert not errors,errors
    context.close()
    print("PASS: invalid archive, failed cloud write, offline local Save, online-only archive, and offline library cache")

    # A confirmed cloud write still gets a truthful confirmation if the later device copy fails.
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
    save(page, acknowledge=False)
    expect(page.locator("#noticeTitle")).to_have_text("Puzzle saved")
    expect(page.locator("#noticeMessage")).to_contain_text("The device copy could not be updated.")
    assert len(cloud(page))==1
    assert not errors,errors
    context.close()
    print("PASS: cloud confirmation remains accurate when the later device copy fails")

    context,page,errors=load(browser,code="CJ",viewport=dict(width=390,height=844))
    expect(page.locator("#manageLibrary")).to_be_visible()
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryCard")).to_be_visible()
    page.locator("#closeManageLibrary").click()
    page.locator("#downloadArchive").click()
    expect(page.locator("#noticeMessage")).to_have_text("Only SL can export or restore puzzle files.")
    page.locator("#closeNotice").click()
    page.locator("#restoreArchive").click()
    expect(page.locator("#noticeMessage")).to_have_text("Only SL can export or restore puzzle files.")
    page.locator("#closeNotice").click()
    page.locator("#openLibrary").click()
    expect(page.locator("#libraryMessage")).to_have_text("No puzzles have been saved yet.")
    page.locator("#closeLibrary").click()
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    page.locator("#puzzleTitle").fill("CJ saved puzzle")
    save(page)
    assert len(cloud(page)) == 1
    assert next(iter(cloud(page).values()))["createdBy"] == "uid-CJ"
    page.locator("#export").click()
    expect(page.locator("#noticeMessage")).to_have_text("Only SL can export or restore puzzle files.")
    page.locator("#closeNotice").click()
    page.locator("#manageLibrary").click()
    page.locator(".library-delete").click()
    expect(page.locator("#manageLibraryList li")).to_have_count(0)
    assert len(cloud(page)) == 0
    page.locator("#closeManageLibrary").click()
    page.screenshot(path=str(ARTIFACTS / "library-phone.png"))
    assert not errors,errors
    context.close()
    print("PASS: CJ saves and confirms deletion on phone; archive controls remain SL-only")

    context,page,errors=load(browser,code="YC")
    expect(page.locator("#manageLibrary")).not_to_be_visible()
    page.locator("#manageLibrary").dispatch_event("click")
    expect(page.locator("#manageLibraryCard")).not_to_be_visible()
    assert not errors,errors
    context.close()
    print("PASS: YC cannot open library deletion controls")

    context,page,errors=load(browser)
    page.locator("#puzzleTitle").fill("Duplicate puzzle")
    save(page)
    saved_id=next(iter(cloud(page)))
    page.evaluate("""() => {
      const records=JSON.parse(localStorage.getItem('test-cloud-puzzles'));
      records['duplicate-puzzle']={...Object.values(records)[0]};
      localStorage.setItem('test-cloud-puzzles',JSON.stringify(records));
    }""")
    board_before=page.locator("#board").inner_html()
    draft_before=page.evaluate("localStorage.getItem('mrl-editor-v1:uid-SL')")
    expect(page.locator(".left-panel #manageLibrary")).to_be_visible()
    page.locator("#manageLibrary").click()
    expect(page.locator("#manageLibraryList li")).to_have_count(2)
    page.screenshot(path=str(ARTIFACTS / "manage-library-desktop.png"))
    page.remove_listener("dialog", accept_dialog)
    confirmations=[]
    def cancel_delete(dialog):
        confirmations.append(dialog.message)
        dialog.dismiss()
    page.once("dialog",cancel_delete)
    page.locator('[data-puzzle-id="duplicate-puzzle"]').click()
    assert len(confirmations)==1 and 'Delete "Duplicate puzzle"' in confirmations[0]
    assert len(cloud(page))==2
    expect(page.locator("#manageLibraryList li")).to_have_count(2)
    page.evaluate("window.testCloudDelay=600")
    page.once("dialog",lambda dialog: dialog.accept())
    page.locator('[data-puzzle-id="duplicate-puzzle"]').click()
    expect(page.locator("#closeManageLibrary")).to_be_disabled()
    expect(page.locator(".library-delete").first).to_be_disabled()
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
        page.locator(".library-delete").click()
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
    page.locator(".library-delete").click()
    expect(page.locator("#noticeMessage")).to_contain_text("changed or was deleted")
    assert len(cloud(page))==1
    page.locator("#closeNotice").click()
    page.locator("#closeManageLibrary").click()
    page.locator("#manageLibrary").click()
    page.once("dialog",lambda dialog: dialog.accept())
    page.locator(".library-delete").click()
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
    expect(page.locator("#noticeMessage")).to_contain_text("Connect to the internet")
    page.locator("#closeNotice").click()
    page.locator("#openLibrary").click()
    expect(page.locator("#librarySelect option")).to_have_count(0)
    assert not errors,errors
    context.close()
    print("PASS: interrupted, denied, stale, and offline deletion preserve data; empty library and stale Save do not recreate deleted puzzles")

    context,page,errors=load(browser,viewport=dict(width=390,height=844))
    page.locator("#puzzleTitle").fill("A duplicate puzzle with a long name for the phone screen")
    save(page)
    page.locator("#manageLibrary").tap()
    expect(page.locator("#manageLibraryList li")).to_have_count(1)
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    assert page.locator("#manageLibraryList").evaluate("el=>el.scrollWidth<=el.clientWidth")
    page.screenshot(path=str(ARTIFACTS / "manage-library-phone.png"))
    page.locator(".library-delete").tap()
    expect(page.locator("#manageLibraryList li")).to_have_count(0)
    assert cloud(page)=={}
    assert not errors,errors
    context.close()
    print("PASS: phone touch deletion and long puzzle names fit the management card")
    browser.close()
