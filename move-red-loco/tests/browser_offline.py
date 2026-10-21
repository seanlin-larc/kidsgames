"""Verify real service-worker caching with networking disabled and a simulated offline check-out.

Requires the static server at localhost:8000. No live Firebase account is used.
"""
import time
from playwright.sync_api import sync_playwright, expect
from browser import ORIGIN, RED, BLOCKER


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context = browser.new_context()
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(ORIGIN + "/")
    page.evaluate("navigator.serviceWorker.ready.then(()=>navigator.serviceWorker.controller || new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})))")
    cache_name = page.evaluate("caches.keys().then(names=>names.find(name=>name==='kidsgames-v19'))")
    assert cache_name == "kidsgames-v19"
    paths = ["play.html", "player.css", "player.js", "player-state.js", "progress-store.js", "player-firestore.js"]
    for path in paths:
        assert page.evaluate("async path=>!!(await (await caches.open('kidsgames-v19')).match('/move-red-loco/'+path))", path), path
    now = int(time.time() * 1000)
    puzzle = dict(id="offline-puzzle", title="Offline puzzle", format="move-red-loco-puzzle-v1",
                  difficulty="Beginner", pieces=[RED, BLOCKER], exitRow=2, revision=1,
                  createdAt="2026-10-20T00:00:00.000Z", updatedAt="2026-10-20T00:00:00.000Z")
    page.evaluate("""async data=>{
      localStorage.setItem('kg-checkout',JSON.stringify(data.checkout));
      localStorage.setItem('mrl-library-v1:offline-test',JSON.stringify([data.puzzle]));
      // Simulate unavailable Firebase inside this disposable browser cache only.
      const cache=await caches.open('kidsgames-v19');
      await cache.put('/shared/family.js',new Response("throw Error('Firebase unavailable in offline test');",{headers:{'Content-Type':'text/javascript'}}));
    }""", dict(checkout=dict(uid="offline-test", code="CJ", start=now, until=now + 48 * 3600 * 1000, seen=now), puzzle=puzzle))
    context.set_offline(True)
    page.goto(ORIGIN + "/move-red-loco/play.html")
    expect(page.locator("#libraryStatus")).to_contain_text("Offline library")
    page.locator('[data-puzzle-id="offline-puzzle"]').click()
    page.locator("#play").click()
    page.locator('[data-piece-id="v2-1"]').focus()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    expect(page.locator("#completionMessage")).to_have_text("Solved in 2 moves!")
    expect(page.locator("#progressStatus")).to_contain_text("waiting to sync")
    page.reload()
    expect(page.locator('[data-puzzle-id="offline-puzzle"]')).to_have_class("puzzle-choice solved")
    assert not errors, errors
    context.close()
    browser.close()
    print("PASS: new player assets load from the real service worker with networking disabled; simulated check-out permits play; solved status survives offline reload")
