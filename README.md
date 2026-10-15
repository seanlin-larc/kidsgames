# Kids Games

Brain-teasing games and puzzles for kids. Each game is a static web page. GitHub Pages hosts the site.

- Site: https://seanlin-larc.github.io/kidsgames/
- Minesweeper: https://seanlin-larc.github.io/kidsgames/minesweeper/

## Folder structure

```
kidsgames/
├── index.html         Game menu (entry point)
├── README.md
├── .nojekyll          Tells GitHub Pages not to run Jekyll
├── shared/            (Optional) Only when two or more games reuse code
└── minesweeper/
    └── index.html     The game
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

## Publish

GitHub Pages settings: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
Changes go live 1–2 minutes after a push.

## Test locally

Open `index.html` in a browser. No build step is necessary.
