# Move The Red Locomotive

**Status (2026-10-16): Puzzle Workshop prototype for testing. The playable game is not implemented.**

- [Open the Puzzle Workshop](https://seanlin-larc.github.io/kidsgames/move-red-loco/)
- [Design plan and notes](https://github.com/seanlin-larc/notes-with-llm/blob/main/projects/kidsgame/2026-10-15_move-red-locomotive-plan.md)

This is an **original puzzle editor**, inspired by the mechanical idea of Railroad RushHour. Do not copy commercial challenge arrangements or artwork into published levels.

## Workshop — first draft

The interface uses a responsive 11-column sheet with up to 2560 px width and at least 30 rows:

- A1: shared offline warning; H1: shared check-out; J1: shared sign-out.
- C2: Reset; E2: Undo; G2: Redo; I2: Save.
- D3: Beginner; F3: Intermediate; H3: Hard; J3: Crazy.
- C4–I10: 7×7 board; J6 and J7 are selectable exit gates. Exactly **one gate is open** per puzzle (J6 by default).
- I11: Test; J11: result (X = exhaustively unsolvable, number = optimal sliding moves; ? = search limit; ! = invalid).
- Below row 13: reusable red locomotive, short/long horizontal and vertical trains, and 2×2 platform modules. Modules have one empty grid column and row between cards.

**Mouse or touch:** drag a module from the tray onto the board, or select a module and tap a board cell. Drag a placed piece to reposition it. Template copies are unlimited except the single red locomotive. Overlaps and out-of-board positions are blocked.

**Keyboard:** use Tab and Enter to select a palette module. Use arrow keys to reposition a selected piece, R to rotate a non-red train, Delete to remove, Escape to deselect, Ctrl/Cmd+Z to undo, and Ctrl/Cmd+Shift+Z to redo.

**Save:** writes a per-player draft to `localStorage` using `mrl-editor-v1:<uid>`. It restores on the next visit to the same browser and player. The selected exit is stored in the draft and in exported JSON. Import JSON restores it; older drafts without an exit default to the red locomotive's row, or J6 if no red locomotive exists. **No cloud puzzle saving or Firestore writes are implemented.**

**Test:** deterministic breadth-first search in a Web Worker. Only the **selected exit** is usable. Each straight slide counts as one move, regardless of distance. Exiting counts as one move. Platforms can slide horizontally or vertically. The worker stops after 200,000 expanded states and reports an **inconclusive** result rather than a false "X".

**Exit rule (2026-10-16):** choose **J6** (board row 3, zero-based 2) or **J7** (board row 4, zero-based 3). The unselected exit is closed. The red locomotive must be a 2×1 horizontal piece on either of those rows. If it occupies the other exit's row, the solver reports X (unreachable exit). Exact physical gate geometry remains provisional.

## Test instructions

1. Open the site while online and sign in on the homepage first. Then open the workshop URL above.
2. Choose **J6** or **J7**. Place the red locomotive on the matching board row. Tap the other gate and verify that only one is open.
3. Press **Test**: a clear matching exit should return **1 step**. Select the opposite exit without moving the red locomotive; Test should return **X**.
4. Add a horizontal train in the same row, between the red locomotive and the gate. Test should return **X** if that train cannot leave the row.
5. Place a vertical train across the exit path with room to slide clear. Test should report a nonzero solvable step count.
6. Check drag, touch, rotate, undo/redo, reset, Save, reload, Export JSON and Import JSON.
7. For offline testing, visit online and press **Check out**. The current shared family feature grants **48 hours**, not 72. Disconnect and revisit the workshop.

Local development: run `python -m http.server 8000` in the repository root and open `http://localhost:8000/`. Do not open files via `file://` because module imports and Firebase sign-in need HTTP.

## Implementation

```text
move-red-loco/
├── README.md          This test guide
├── index.html         11-column workshop layout and styles
├── editor.js          Board editor, pointer interactions, save/import/export
├── solver.js          Pure validation and breadth-first solver
└── solver-worker.js   Runs the solver without blocking the editor
```

- Shared authentication: `../shared/gate.js`. Login required for any editor access.
- Service-worker `PRECACHE` includes the editor assets, with cache version `kidsgames-v3`.
- The root game menu is **not** updated. The page is only a prototype, not a playable game.
- Firestore security rules are unchanged. No levels or results are uploaded.
- Proposed playable-game features, hints, statistics and final rules remain in the design plan.

## Future work

Confirm target gate geometry and piece inventory. Review UI on a tablet. Add puzzle IDs and a curated library after the editor is accepted. Build the playable puzzle view separately.
