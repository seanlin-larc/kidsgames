# Kids Games

Brain-teasing games and puzzles for kids. Each game is a static web page. GitHub Pages hosts the site.

- Site: https://seanlin-larc.github.io/kidsgames/
- Minesweeper: https://seanlin-larc.github.io/kidsgames/minesweeper/
- Word Guess: https://seanlin-larc.github.io/kidsgames/word-guess/

## Folder structure

```
kidsgames/
├── index.html         Welcome page: player picker + PIN, then the game menu
├── README.md
├── .nojekyll          Tells GitHub Pages not to run Jekyll
├── shared/
│   └── family.js      Family sign-in (Firebase) and shared records, used by every page
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

## Storage-key prefixes in use

| Game        | Prefix |
|-------------|--------|
| minesweeper | `ms-` (data in `ms-v2`) |
| word-guess  | `wg-` (data in `wg-v1`) |
| welcome page | `kg-` (`kg-lastPlayer`) |

## Publish

GitHub Pages settings: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
Changes go live 1–2 minutes after a push.

## Family sign-in

- The welcome page asks who is playing (SL, CJ, YC, JY) and for a 6-digit PIN.
- Firebase Authentication checks the PIN. No PIN is in this code.
- Each game imports `../shared/family.js`. `currentPlayer()` gives the signed-in player.
  `saveRecord(game, level, time)` and `topTimes(game, level)` use Firestore `games/{game}/{level}`.
- A game that adds Firestore records needs a matching block in `firebase/firestore.rules`.

## Test locally

Run a local web server in the repo folder, then open `http://localhost:8000/`:

```
python -m http.server 8000
```

Opening `index.html` from disk (`file://`) does not work: browsers block module scripts there,
and the Firebase API key accepts only `seanlin-larc.github.io` and `localhost:8000`.
