# Move The Red Locomotive

**Status (2026-10-16): Puzzle Workshop prototype for testing. The playable game is not implemented.**

- [Open the Puzzle Workshop](https://seanlin-larc.github.io/kidsgames/move-red-loco/)
- [Design plan and notes](https://github.com/seanlin-larc/notes-with-llm/blob/main/projects/kidsgame/2026-10-15_move-red-locomotive-plan.md)

This is an **original puzzle editor**, inspired by the mechanical idea of Railroad RushHour. Do not copy commercial challenge arrangements or artwork into published levels.

## Workshop — first draft

The interface uses a responsive 11-column sheet with up to 2560 px width and at least 30 rows:

- A1: shared offline warning; H1: shared check-out; J1: shared sign-out.
- C2: Reset; E2: Undo; G2: Redo; I2: Save flyout (Save as Beginner / Medium / Hard / Crazy).
- Row 3 difficulty buttons removed. The 7×7 board shifts up one row.
- C3–I9: 7×7 board; J5 and J6 are selectable exit gates. Exactly **one gate is open** per puzzle (J5 by default). Logical solver exit rows stay unchanged.
- C11–E11: Build / Play toggle. In Build, I11: Test and J11: solver result (X = exhaustively unsolvable, number = optimal sliding moves; ? = search limit; ! = invalid).
- In Play, G11–H11: **Replay**; I11: **Moves** (tap to focus the history); J11: number of moves made. K3–K9: scrollable move log, one move per line at two lines per page-grid row.
- From row 12 down: module tray and supporting tools, shifted up one row. Modules retain one empty grid column and row between cards.

**Mouse or touch:** drag a module from the tray onto the board, or select a module and tap a board cell. Drag a placed piece to reposition it. Template copies are unlimited except the single red locomotive. Overlaps and out-of-board positions are blocked.

**Keyboard:** use Tab and Enter to select a palette module. Use arrow keys to reposition a selected piece, R to rotate a non-red train, Delete to remove, Escape to deselect, Ctrl/Cmd+Z to undo, and Ctrl/Cmd+Shift+Z to redo.

**Save flyout:** choose Save as Beginner, Medium, Hard, or Crazy. It stores both the latest per-player draft (`mrl-editor-v1:<uid>`) and one independent slot per tier (`mrl-editor-v1:<uid>:<tier>`). Saving again under the same tier overwrites that tier's previous slot. The last saved draft is restored on reopening. Export JSON contains the chosen tier and exit. Earlier drafts labeled Intermediate import as Medium. Older files with no exit select the red locomotive's row, otherwise J5. **No cloud puzzle saving, level library, or Firestore writes are implemented.**

**Test:** deterministic breadth-first search in a Web Worker. Only the **selected exit** is usable. Each straight slide counts as one move, regardless of distance. Exiting counts as one move. Platforms can slide horizontally or vertically. The worker stops after 200,000 expanded states and reports an **inconclusive** result rather than a false "X".

**Exit rule:** select **J5** (board row 3, zero-based 2) or **J6** (board row 4, zero-based 3). These labels shifted up one page row with the board; only one exit is active. The red locomotive must be a 2×1 horizontal piece on either of those rows. An attempt to escape through the closed exit fails. Exact physical gate geometry remains provisional.


### Build / Play preview

**Build:** the default editor. Row 2, exit selection, Test, palette, module tools, Save flyout, Import, and Export work normally.

**Play:** switching modes preserves a temporary copy of the Build arrangement. The editor controls in row 2 and palette/tools below are greyed out and disabled. I11 changes from Test to Moves; J11 shows the count. G11–H11 shows Replay. The K3–K9 move log has 14 half-row-height entries before scrolling. Each successful slide, including the final exit, adds one numbered entry with piece, direction, and travel distance; blocked attempts are not counted. The log scrolls to the newest move. Tap Moves to focus the log at its latest entry. Drag a train along its fixed axis, drag a platform along either single axis, or use arrow keys after selecting a train. Each valid slide counts as one move, regardless of distance. Tap the open exit when the red locomotive has a clear path to win.

**Replay** animates the recorded sequence at 550 milliseconds per step. It highlights each history entry and updates the on-screen move count during playback. It restores the final Play arrangement and original log when it finishes. Switching back to Build cancels any replay, restores the original puzzle, and clears the preview move count. Play does not upload a result or modify stored drafts.

Play mode starts only if the puzzle passes layout validation, including having one red locomotive. This is a **workshop preview**, not the released game.

## Test instructions

1. Open the site while online and sign in on the homepage first. Then open the workshop URL above.
2. Choose **J5** or **J6**. Place the red locomotive on the matching board row. Tap the other gate and verify that only one is open.
3. Press **Test**: a clear matching exit should return **1 step**. Select the opposite exit without moving the red locomotive; Test should return **X**.
4. Add a horizontal train in the same row, between the red locomotive and the gate. Test should return **X** if that train cannot leave the row.
5. Place a vertical train across the exit path with room to slide clear. Test should report a nonzero solvable step count.
6. Check drag, touch, rotate, undo/redo, reset, the four Save tiers, reload, Export JSON and Import JSON. Switch to Play and verify editing is disabled. Make three slides: the count should be 3 and K3–K9 should contain three numbered lines. Press Replay: the pieces should follow those moves, highlight each line, then restore the final arrangement. Switch to Build during another Replay: it must cancel and restore the original layout.
7. For offline testing, visit online and press **Check out**. The current shared family feature grants **48 hours**, not 72. Disconnect and revisit the workshop.

Local development: run `python -m http.server 8000` in the repository root and open `http://localhost:8000/`. Do not open files via `file://` because module imports and Firebase sign-in need HTTP.

## Implementation

```text
move-red-loco/
├── README.md          This test guide
├── index.html         11-column workshop layout and styles
├── editor.js          Build/Play UI, pointer interactions, save/import/export
├── solver.js          Pure validation and breadth-first solver
├── play-rules.js      Pure legal movement and exit rules for Play preview
└── solver-worker.js   Runs the solver without blocking the editor
```

- Shared authentication: `../shared/gate.js`. Login required for any editor access.
- Service-worker `PRECACHE` includes the editor assets, with cache version `kidsgames-v5`.
- The root game menu is **not** updated. The page is only a prototype, not a playable game.
- Firestore security rules are unchanged. No levels or results are uploaded.
- Proposed playable-game features, hints, statistics and final rules remain in the design plan.

## Future work

Confirm target gate geometry and piece inventory. Review UI on a tablet. Add puzzle IDs and a curated library after the editor is accepted. Build the playable puzzle view separately.
