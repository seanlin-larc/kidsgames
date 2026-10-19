"""Browser checks with a simulated player gate; no Firebase account or PIN is used.

Run: python move-red-loco/tests/browser.py
Requires Playwright, Chromium, and permission to launch the browser.
"""
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT.parent / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
ORIGIN = "http://localhost:8000"
RED = dict(id="red", type="red", x=0, y=2, w=2, h=1, axis="h", label="X")
BLOCKER = dict(id="v2-1", type="v2", x=3, y=1, w=1, h=2, axis="v", label="A", hue=120)


def puzzle(pieces=None, **changes):
    return dict(format="move-red-loco-editor-v1", difficulty="Starter", exitRow=2,
                pieces=json.loads(json.dumps(pieces if pieces is not None else [RED, BLOCKER])), **changes)


def route_files(route):
    path = urlparse(route.request.url).path
    if path == "/shared/gate.js":
        route.fulfill(content_type="text/javascript", body="""
const player={uid:'uid-'+window.testPlayer,code:window.testPlayer};
export async function access(){return {mode:'online',player};}
export function mountBar(el){el.textContent='Playing as '+player.code; return {player};}
export async function enterGame({bar}){document.body.classList.remove('kg-wait');return mountBar(bar);}
""")
        return
    target = (ROOT / path.lstrip("/")).resolve()
    if not target.is_relative_to(ROOT):
        route.abort()
        return
    if target.is_dir():
        target /= "index.html"
    if target.is_file():
        route.fulfill(body=target.read_bytes(), content_type=mimetypes.guess_type(str(target))[0] or "text/plain")
    else:
        route.fulfill(status=404, body="Not found")


def load(browser, code="SL", saved=None, viewport=None):
    context = browser.new_context(viewport=viewport or dict(width=1200, height=900),
                                  service_workers="block", accept_downloads=True)
    context.route(ORIGIN + "/**", route_files)
    key = "mrl-editor-v1:uid-" + code
    seed = json.dumps(saved)
    context.add_init_script(f"""
window.testPlayer={json.dumps(code)};
if (!sessionStorage.getItem('seeded')) {{
  if ({str(saved is not None).lower()}) localStorage.setItem({json.dumps(key)}, JSON.stringify({seed}));
  sessionStorage.setItem('seeded','1');
}}
""")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(ORIGIN + "/move-red-loco/")
    expect(page.locator("#playerBar")).to_contain_text(code)
    return context, page, key, errors


def import_json(page, data):
    page.locator("#importFile").set_input_files(dict(name="puzzle.json", mimeType="application/json",
                                                    buffer=json.dumps(data).encode()))


def storage(page):
    return page.evaluate("Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('mrl-editor-'))) ")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context, page, key, errors = load(browser, saved=puzzle())
    # Save and export preserve the same layout, tier, labels, colors, and active exit.
    page.locator("#save").click()
    page.get_by_role("button", name="Save as Pro", exact=True).click()
    saved = page.evaluate("key=>JSON.parse(localStorage.getItem(key))", key)
    tier = page.evaluate("key=>JSON.parse(localStorage.getItem(key+':pro'))", key)
    assert saved == tier and saved["difficulty"] == "Pro"
    with page.expect_download() as downloaded:
        page.locator("#export").click()
    destination = ARTIFACTS / downloaded.value.suggested_filename
    downloaded.value.save_as(destination)
    exported = json.loads(destination.read_text())
    assert exported == {k: saved[k] for k in ["format", "difficulty", "exitRow", "pieces"]}
    assert set(exported) == {"format", "difficulty", "exitRow", "pieces"}
    page.reload()
    expect(page.locator("#status")).to_contain_text("Restored")
    assert page.locator("#board .piece").count() == 2
    import_json(page, exported)
    expect(page.locator("#status")).to_contain_text("Imported 2")

    before = page.locator("#board").inner_html()
    import_json(page, puzzle([RED, {**BLOCKER, "x": 1}]))
    expect(page.locator("#status")).to_contain_text("Import rejected")
    assert page.locator("#board").inner_html() == before
    assert page.evaluate("key=>JSON.parse(localStorage.getItem(key))", key) == saved

    # Actual worker goal matches Play: one blocker slide, no added exit move.
    page.locator("#test").click()
    expect(page.locator("#testResult")).to_have_text("1 steps")
    page.locator("#playMode").click()
    page.locator('[data-piece-id="red"]').click()
    page.keyboard.press("ArrowUp")  # Illegal axis; no count or completion.
    expect(page.locator("#testResult")).to_have_text("0")
    block = page.locator('[data-piece-id="v2-1"]').bounding_box()
    size = page.locator("#board").bounding_box()["width"] / 7
    x, y = block["x"] + block["width"] / 2, block["y"] + block["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y + 2 * size, steps=8)
    page.mouse.up()
    expect(page.locator("#noticeCard")).to_be_visible()
    expect(page.locator("#noticeTitle")).to_have_text("Congratulations!")
    expect(page.locator("#noticeMessage")).to_have_text("Solved in 1 moves!")
    expect(page.locator("#moveLogList li")).to_have_count(1)
    assert "⇥" not in page.locator("#moveLogList").inner_text()
    page.screenshot(path=str(ARTIFACTS / "completion-desktop.png"))
    page.locator("#closeNotice").click()
    page.locator("#replay").click()
    expect(page.locator("#status")).to_contain_text("Replay finished")
    expect(page.locator("#playInfo")).to_have_text("Solved!")
    expect(page.locator("#noticeCard")).not_to_be_visible()
    expect(page.locator("#testResult")).to_have_text("1")
    page.locator("#buildMode").click()
    assert page.locator('[data-piece-id="v2-1"]').evaluate("el=>el.style.top") == "14.2857%"
    page.screenshot(path=str(ARTIFACTS / "builder-desktop.png"))
    page.locator("#themeBtn").click()
    page.locator("#themeBtn").click()
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")
    page.screenshot(path=str(ARTIFACTS / "builder-dark.png"))
    assert page.locator(".gate-text").count() == 0
    assert "J5" not in page.locator("body").inner_text() and "J6" not in page.locator("body").inner_text()
    assert page.locator(".tile").first.evaluate("el=>getComputedStyle(el,'::after').content") == "none"
    assert page.locator("#board .tile").count() == 49
    assert not errors, errors
    context.close()
    print("PASS: SL Save/export/reload/import, rejection without mutation, worker, drag completion, Replay, board styling")

    # All other players get the same card; direct Save-tier events cannot bypass it.
    for code in ["CJ", "YC", "JY", "Guest"]:
        legacy = puzzle()
        del legacy["pieces"][1]["hue"]
        context, page, key, errors = load(browser, code=code, saved=legacy)
        original = storage(page)
        for selector in ["#save", '[data-save-tier="Freak"]', "#export"]:
            page.locator(selector).dispatch_event("click")
            expect(page.locator("#noticeMessage")).to_have_text("Only SL can save a puzzle layout.")
            page.locator("#closeNotice").click()
            assert storage(page) == original
        assert not errors, errors
        context.close()
    print("PASS: CJ, YC, JY, Guest cannot Save, directly invoke tier saves, Export, or persist migrations")

    context, page, key, errors = load(browser, saved=puzzle([RED]), viewport=dict(width=390, height=844))
    page.locator("#playMode").click()
    expect(page.locator("#noticeMessage")).to_have_text("Solved in 0 moves!")
    page.screenshot(path=str(ARTIFACTS / "completion-phone.png"))
    page.keyboard.press("Escape")
    expect(page.locator("#noticeCard")).not_to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    assert not errors, errors
    context.close()
    print("PASS: initially clear board, zero moves, phone dialog and no horizontal overflow")

    broken = puzzle([None])
    context, page, key, errors = load(browser, saved=broken)
    expect(page.locator("#status")).to_contain_text("Could not restore")
    assert page.locator("#board .piece").count() == 0
    assert page.evaluate("key=>JSON.parse(localStorage.getItem(key))", key) == broken
    assert not errors, errors
    context.close()
    print("PASS: malformed device save remains untouched without partial restoration")

    context, page, key, errors = load(browser, saved=puzzle())
    page.evaluate("""() => {
      const original=Storage.prototype.setItem; let calls=0;
      Storage.prototype.setItem=function(k,v){if(++calls===2)throw Error('Quota');return original.call(this,k,v);};
    }""")
    original = storage(page)
    page.locator("#save").click()
    page.get_by_role("button", name="Save as Freak", exact=True).click()
    expect(page.locator("#status")).to_contain_text("Previous saves were kept")
    assert storage(page) == original
    assert not errors, errors
    page.goto(ORIGIN + "/")
    link = page.get_by_role("link", name="Move The Red Locomotive", exact=False)
    expect(link).to_have_attribute("href", "move-red-loco/")
    link.click()
    expect(page.locator("#board")).to_be_visible()
    context.close()
    print("PASS: browser storage rollback and signed-in homepage navigation")
    browser.close()
