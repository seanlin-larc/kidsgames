"""Browser checks for the Word Guess dictionary card, with a simulated player gate and a
stub WordWeb page; no Firebase account, PIN or internet connection is used.

Run: python word-guess/tests/browser.py
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
WORDWEB = "https://www.wordwebonline.com/"
PHONE = dict(width=375, height=667)
# Same layout as WordWeb's pages: the search box is 16-62 px from the top.
STUB = """<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<body style="margin:0"><div style="padding:16px 16px 32px"><input name="w" style="height:46px;width:90%;margin:0"></div>
<div id="def" style="padding:0 16px">Stub entry</div><div style="height:2000px"></div>
<script>document.body.dataset.ran = '1'</script>"""


def route_files(route):
    path = urlparse(route.request.url).path
    if path == "/shared/gate.js":
        route.fulfill(content_type="text/javascript", body="""
const player={uid:'uid-'+window.testPlayer,code:window.testPlayer};
export async function enterGame({bar}){document.body.classList.remove('kg-wait');bar.textContent='Playing as '+player.code;
  return {player, online:()=>navigator.onLine!==false, logResult(){}};}
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


def load(browser, game, viewport=PHONE, theme=None):
    context = browser.new_context(viewport=viewport, service_workers="block")
    context.route(ORIGIN + "/**", route_files)
    looked_up = []
    def wordweb(route):
        looked_up.append(route.request.url)
        route.fulfill(content_type="text/html", body=STUB)
    context.route(WORDWEB + "**", wordweb)
    data = {"players": {"SL": {"games": {"practice5": game}, "stats": {}}}, "last": {"len": 5, "mode": "practice"}}
    context.add_init_script(f"""
window.testPlayer='SL';
if (!sessionStorage.getItem('seeded')) {{
  localStorage.setItem('wg-v1', {json.dumps(json.dumps(data))});
  {f"localStorage.setItem('wg-theme', '{theme}');" if theme else ""}
  sessionStorage.setItem('seeded','1');
}}
""")
    page = context.new_page()
    errors = []
    # Playwright's own scripts also run in the sandboxed dictionary frame, where storage is blocked.
    page.on("pageerror", lambda error: "is sandboxed" in str(error) or errors.append(str(error)))
    page.goto(ORIGIN + "/word-guess/")
    expect(page.locator("#who")).to_contain_text("SL")
    return context, page, looked_up, errors


def frame_src(page):
    return page.locator("#dictFrame").get_attribute("src")


def run_checks():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        game = dict(answer="abbey", shown=[], guesses=["boxes", "crane", "qwert"], done=False, won=False)
        context, page, looked_up, errors = load(browser, game)
        books = page.locator("#board .book:not(.off)")
        expect(books).to_have_count(3)

        # An inflected guess opens its base word in a card on the same page, not in a new tab.
        books.nth(0).click()
        expect(page.locator("#dictDlg")).to_be_visible()
        expect(page.locator("#dictTitle")).to_have_text("📖 boxes")
        assert frame_src(page) == WORDWEB + "en/BOX"
        expect(page.locator("#dictMsg")).to_be_hidden()
        assert len(context.pages) == 1
        assert page.locator("#dictFrame").get_attribute("sandbox") == ""
        frame = page.frame_locator("#dictFrame")
        expect(frame.locator("#def")).to_have_text("Stub entry")
        assert frame.locator("body").get_attribute("data-ran") is None  # WordWeb scripts do not run
        print("PASS: book button opens the base word in a card, sandboxed, with no new tab")

        # WordWeb's search box (16-62 px from the top of its page) is above the visible card area.
        card = page.locator(".dict").bounding_box()
        box = frame.locator("input").bounding_box()
        assert box["y"] + box["height"] <= card["y"], (box, card)
        dialog = page.locator("#dictDlg").bounding_box()
        assert dialog["x"] >= 0 and dialog["y"] >= 0
        assert dialog["x"] + dialog["width"] <= PHONE["width"] and dialog["y"] + dialog["height"] <= PHONE["height"]
        assert page.evaluate("document.documentElement.scrollWidth") <= PHONE["width"]
        page.screenshot(path=str(ARTIFACTS / "word-guess-dictionary-phone.png"))
        print("PASS: search box hidden; card fits a 375 x 667 screen with no sideways scrolling")

        # Close with the button, Esc, or a tap outside the card. Closing clears the frame.
        page.locator("#dictClose").click()
        expect(page.locator("#dictDlg")).to_be_hidden()
        expect(page.locator("#dictFrame")).to_have_attribute("src", "about:blank")
        books.nth(1).click()
        expect(page.locator("#dictTitle")).to_have_text("📖 crane")
        assert frame_src(page) == WORDWEB + "en/CRANE"
        page.keyboard.press("Escape")
        expect(page.locator("#dictDlg")).to_be_hidden()
        books.nth(2).click()
        assert frame_src(page) == WORDWEB + "en/QWERT"  # unknown word: WordWeb shows its home page
        page.mouse.click(3, 3)
        expect(page.locator("#dictDlg")).to_be_hidden()
        expect(page.locator("#dictFrame")).to_have_attribute("src", "about:blank")
        assert looked_up == [WORDWEB + "en/BOX", WORDWEB + "en/CRANE", WORDWEB + "en/QWERT"], looked_up
        print("PASS: Close, Esc and tap outside close the card; addresses use uppercase entry words")

        # Offline: a message, and no request to WordWeb.
        context.set_offline(True)
        books.nth(1).click()
        expect(page.locator("#dictMsg")).to_be_visible()
        expect(page.locator("#dictMsg")).to_contain_text("needs the internet")
        expect(page.locator("#dictFrame")).to_have_attribute("src", "about:blank")
        assert len(looked_up) == 3
        page.locator("#dictClose").click()
        context.set_offline(False)
        assert not errors, errors
        context.close()
        print("PASS: offline shows a message and does not load WordWeb")

        # The end panel's book button opens the answer; the card frame follows the dark theme.
        playing = dict(answer="abbey", shown=[], guesses=["crane"], done=False, won=False)
        context, page, looked_up, errors = load(browser, playing, theme="dark")
        for key in "abbey":  # finish the game on the on-page keyboard
            page.locator(f'#kb button[data-k="{key}"]').click()
        page.locator('#kb button[data-act="enter"]').click()
        page.locator("#endWord .book").click()
        expect(page.locator("#dictTitle")).to_have_text("📖 abbey")
        assert frame_src(page) == WORDWEB + "en/ABBEY"
        expect(page.locator("#dictMsg")).to_be_hidden()
        page.screenshot(path=str(ARTIFACTS / "word-guess-dictionary-dark.png"))
        assert not errors, errors
        context.close()
        print("PASS: end panel book button opens the answer in the card (dark theme)")
        browser.close()


if __name__ == "__main__":
    run_checks()
