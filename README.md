# Kids Games

Brain-teasing games and puzzles for kids. Each game is a static web page. GitHub Pages hosts the site.

- Site: https://seanlin-larc.github.io/kidsgames/
- Minesweeper: https://seanlin-larc.github.io/kidsgames/minesweeper/
- Word Guess: https://seanlin-larc.github.io/kidsgames/word-guess/

## Folder structure

```
kidsgames/
├── index.html         Welcome page: player picker + PIN, then the game menu
├── sw.js              Service worker: keeps the pages on the device for offline play
├── README.md
├── .nojekyll          Tells GitHub Pages not to run Jekyll
├── shared/
│   ├── gate.js        Sign-in gate + player bar (offline icon, check-out, sign-out) for every page
│   ├── session.js     Device data, no Firebase: players, check-out, PIN lock, outbox
│   └── family.js      Firebase: sign-in, send the outbox, family top 10
├── firebase/
│   └── firestore.rules  Firestore security rules (copy into the Firebase console)
├── minesweeper/
│   └── index.html     The game
└── word-guess/
    ├── index.html     The game
    ├── words.js       Word lists (made by build-words.py, do not edit by hand)
    ├── build-words.py Makes words.js from public word-frequency data
    └── blocklist.txt  Words never used as answers or accepted as guesses
```

## Rules for a new game

1. Make one folder for each game. Use lowercase letters and hyphens, for example `word-ladder/`.
2. Name the main file of the game `index.html`.
3. Keep all files for the game inside its folder.
4. Use relative links only. Use `href="../"` to go back to the menu. Do not use `href="/..."`.
5. Do not start a file or folder name with an underscore (`_`).
6. Give each game a unique prefix for `localStorage` keys. All games on this site share one browser storage area.
7. Add the game to the list in the root `index.html`.
8. Add the game folder (and any extra files) to `PRECACHE` in `sw.js`, so it works offline after a check-out.
   Change `CACHE` (for example `kidsgames-v2`) when you change that list.
9. Use the sign-in gate (see "Family sign-in" below). Play only when signed in.

## Storage-key prefixes in use

| Game        | Prefix |
|-------------|--------|
| minesweeper | `ms-` (data in `ms-v2`) |
| word-guess  | `wg-` (data in `wg-v1`, colour theme in `wg-theme`) |
| site (shared) | `kg-` (`kg-lastPlayer`, `kg-checkout`, `kg-lock`, `kg-outbox`) |

## Publish

GitHub Pages settings: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
Changes go live 1–2 minutes after a push.

## Family sign-in

- Players: SL, CJ, YC, JY, Guest. Accounts: `<code>@kidsgames.invalid` (Firebase Email/Password).
  The 6-digit PIN is the password. Firebase checks the PIN. No PIN is in this code.
- **Play only when signed in.** Online: Firebase checks the sign-in. Offline: play only with a
  check-out on that device.
- **PIN lock:** 10 wrong PINs in a row for one player on one device lock that player for 30 minutes
  on that device (`kg-lock`). This check is in the page only; it is not a server check.
- **Check-out:** the "📥 Check out" button (online only) lets the signed-in player play offline on
  that device for 48 hours (`kg-checkout`). Sign-out ends it. A device clock set back ends it.
- **Results:** every finished game goes into the device outbox (`kg-outbox`), then to Firestore when
  online. Each record id is also its Firestore document id, so a record sent twice is not copied.
  Wins also go to the family top 10, `games/{game}/{level}`. All finished games go to `results`.
- **Player bar** on every page: player code, ⚠️ Offline icon (with the number of results to send),
  check-out button, sign-out button.

How a game uses it:

```html
<body class="kg-wait">           <!-- hide the game until the sign-in check; add CSS: .kg-wait #game{visibility:hidden} -->
<span id="who">Checking sign-in…</span>
<script type="module">
const gate = await import('../shared/gate.js');
const ctx = await gate.enterGame({ bar: document.getElementById('who') });  // null -> sent to the menu
// ctx.player.code, ctx.online(), ctx.saveWin(game, level, time), ctx.logResult(game, level, won, score),
// ctx.topTimes(game, level)
</script>
```

- A game that adds new Firestore records needs a matching block in `firebase/firestore.rules`.

## Test locally

Run a local web server in the repo folder, then open `http://localhost:8000/`:

```
python -m http.server 8000
```

Opening `index.html` from disk (`file://`) does not work: browsers block module scripts there,
and the Firebase API key accepts only `seanlin-larc.github.io` and `localhost:8000`.
