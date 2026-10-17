# Move The Red Locomotive

**Status (2026-10-16): Puzzle Workshop prototype for testing. The playable game is not implemented.**

- [Open the Puzzle Workshop](https://seanlin-larc.github.io/kidsgames/move-red-loco/)
- [Design plan and notes](https://github.com/seanlin-larc/notes-with-llm/blob/main/projects/kidsgame/2026-10-15_move-red-locomotive-plan.md)

This is an **original puzzle editor**, inspired by the mechanical idea of Railroad RushHour. Do not copy commercial challenge arrangements or artwork into published levels.

## Compact workspace — Build / Play

The workshop is designed to fit the **full editing interface within a 1200 × 900 browser viewport**, rather than using the earlier 11-column × 30-row spreadsheet arrangement.

| Area | Build mode | Play mode |
|---|---|---|
| Header and top bar | Game title, Light/Dark/Auto appearance, player, offline, Check out, Sign out | Same |
| **Left panel** | Reset, Undo, Redo, Save as flyout, Build/Play switch, Test result, guidance | Editor controls disabled; Build/Play, Replay, Moves, count |
| **Centre** | Fixed 7×7 square grid with one selected right-side exit (J5 or J6) | Same board, with legal sliding interactions |
| **Right panel** | Six draggable modules in a 2-column × 3-row palette, rotation/remove/deselect, JSON import/export | Scrollable log of every valid move, with highlighted Replay step |
| Bottom status | Current editor message | Move, replay, or win message |

- Main content is a **three-column responsive CSS grid** (controls / square board / palette-or-history), with a maximum page width of **1200px**.
- The centre board's maximum width responds to both viewport width and viewport height (`max-width:calc(100dvh - 168px)` on the board stage); the exit strip is 32px wide.
- Below 980px, the controls become a compact toolbar above the board. In **portrait phone view (max-width 600px)**, Reset/Undo/Redo/Save are **above** the board, while Build/Play, Test/Moves, Replay and selection tools appear **below** it. The persistent palette card is hidden on portrait phones; the game retains its 7×7 board.
- On desktop, the palette is replaced by the move history in **exactly the same right panel** in Play mode. On portrait phones, the move history is accessed by a **Moves button over the board** and opens a scrollable flyout instead of using permanent screen space.
- **Save** offers Beginner, Medium, Hard, Crazy. A separate local slot is stored for each difficulty, and the latest draft is restored on opening.
- The red locomotive **X** can only be placed on board row 3 or 4. Adding or moving X automatically opens the matching exit gate (J5 or J6). Tapping the opposite exit in Build moves X to that row if space is available; otherwise the editor reports a blocked move.

**Appearance (top bar):** tap the theme button to cycle **Light → Dark → Auto → Light** (from the default Auto, first tap chooses Light). Light uses bright board, controls, palette, move log, and panels; Dark uses deep navy surfaces and brighter contrast. Auto follows the device's light/dark setting and updates when that setting changes. An explicit Light or Dark choice is saved on this device using `mrl-theme`, independent of the signed-in player or puzzle draft. Auto removes the stored override. The choice applies instantly without reloading.

**Mouse/desktop:** drag a module from the right palette to the board, or select one and tap a target cell. While dragging, the block is **centered under the pointer**, rather than offset from its corner. The palette samples use one common 21px grid-cell size: 2×1 cars appear as 42×21px, 3×1 trains as 63×21px, and 2×2 platforms as 42×42px. Drag an already placed piece to reposition it.

**Portrait phone:** long-press an empty board cell for approximately **480ms** to open a six-option block picker. Selecting one shows a **floating, centered block**, which can be dragged to a valid position or placed by tapping an empty cell. Drag a placed block **outside** the board to discard it (Undo can restore it). The large right-hand block palette is hidden; the editor's Rotate/Remove/Deselect and JSON tools remain available below the board. In Play, tap **Moves ▾** over the board to open or close the move-history flyout. A move history entry is added only for a legal slide.

**Piece letters:** one red locomotive = **X**; 2-cell trains (2×1 or 1×2) share letters **A–L**; 3-cell trains (3×1 or 1×3) share **O–S**; 2×2 platforms use **U** and **V**. Letters stay attached to pieces through dragging, rotation, Undo/Redo and Save/Export. If an older imported or locally saved draft lacks letters, the editor assigns the first available letters in each group. The editor stops additions when a letter group is exhausted.

**Keyboard:** use Tab and Enter to select a palette module. Use arrow keys to reposition a selected piece, R to rotate a non-red train, Delete to remove, Escape to deselect, Ctrl/Cmd+Z to undo, and Ctrl/Cmd+Shift+Z to redo.

**Save flyout:** choose Save as Beginner, Medium, Hard, or Crazy. It stores both the latest per-player draft (`mrl-editor-v1:<uid>`) and one independent slot per tier (`mrl-editor-v1:<uid>:<tier>`). Saving again under the same tier overwrites that tier's previous slot. The last saved draft is restored on reopening. Export JSON contains the chosen tier and exit. Earlier drafts labeled Intermediate import as Medium. Older files with no exit select the red locomotive's row, otherwise J5. **No cloud puzzle saving, level library, or Firestore writes are implemented.**

**Test:** deterministic breadth-first search in a Web Worker. Only the **selected exit** is usable. Each straight slide counts as one move, regardless of distance. Exiting counts as one move. Platforms can slide horizontally or vertically. The worker stops after 200,000 expanded states and reports an **inconclusive** result rather than a false "X".

**Exit rule:** select **J5** (board row 3, zero-based 2) or **J6** (board row 4, zero-based 3). These labels shifted up one page row with the board; only one exit is active. The red locomotive must be a 2×1 horizontal piece on either of those rows. An attempt to escape through the closed exit fails. Exact physical gate geometry remains provisional.


### Build / Play preview

**Build:** the default editor. Row 2, exit selection, Test, palette, module tools, Save flyout, Import, and Export work normally.

**Play:** switching modes preserves a temporary copy of the Build arrangement. The editor controls in row 2 and palette/tools below are greyed out and disabled. I11 changes from Test to Moves; J11 shows the count. G11–H11 shows Replay. The K3–K9 move log has 14 half-row-height entries before scrolling. Each successful slide, including the final exit, adds one numbered entry with piece, direction, and travel distance; blocked attempts are not counted. The log scrolls to the newest move. Tap Moves to focus the log at its latest entry. Drag a train along its fixed axis, drag a platform along either single axis, or use arrow keys after selecting a train. Each valid slide counts as one move, regardless of distance. Tap the open exit when the red locomotive has a clear path to win.

**Replay** animates the recorded sequence at 550 milliseconds per step. It highlights each history entry and updates the on-screen move count during playback. It restores the final Play arrangement and original log when it finishes. Switching back to Build cancels any replay, restores the original puzzle, and clears the preview move count. Play does not upload a result or modify stored drafts.

Play mode starts only if the puzzle passes layout validation, including having one red locomotive. This is a **workshop preview**, not the released game.

### Grid layout correction — 2026-10-16

Historical grid layout (superseded by the compact three-column workspace): CSS Grid requires a space in span placement syntax: `grid-column:3 / span 7` and `grid-row:3 / span 7`, not `/span7`. Earlier rules used invalid named-line syntax (for example, `span2`, `span3`, `span7`), causing oversized grid items, overlapping row controls and a board extending off-screen. All 36 instances were corrected; the planned 11-column layout and the existing game logic are unchanged.

**Chromium layout check at 1,672px viewport:** board now fits in C3–I9 at 1,064 × 1,064px, with no horizontal page overflow. Also checked representative 1,024px and 390px viewport sizes. Check the actual deployed site and mobile touch controls separately.

## Test instructions

1. Open the site while online and sign in on the homepage first. Then open the workshop URL above.
2. Choose **J5** or **J6**. Place the red locomotive on the matching board row. Tap the other gate and verify that only one is open.
3. Press **Test**: a clear matching exit should return **1 step**. Select the opposite exit in Build: X should move to that row automatically when unblocked. Confirm that the selected gate changes with X.
4. Add a horizontal train in the same row, between the red locomotive and the gate. Test should return **X** if that train cannot leave the row.
5. Place a vertical train across the exit path with room to slide clear. Test should report a nonzero solvable step count.
6. Check Light, Dark and Auto in the top bar. On a portrait phone, hold an empty board cell, select X, drag the floating block to an exit row, long-press to choose an A–L car, and drag the placed car off the board to discard it. Verify the module samples have consistent scale on desktop and X/A/O/U letters appear on placed pieces. Check Undo, Save, JSON export/import, and restored labels. In Play, open the Moves flyout, make legal moves, and verify the count/history and Replay. Switch to Build to restore the original layout.
7. For offline testing, visit online and press **Check out**. The current shared family feature grants **48 hours**, not 72. Disconnect and revisit the workshop.

Local development: run `python -m http.server 8000` in the repository root and open `http://localhost:8000/`. Do not open files via `file://` because module imports and Firebase sign-in need HTTP.

## Implementation

```text
move-red-loco/
├── README.md          This test guide
├── index.html         Compact responsive desktop/mobile UI and styles
├── editor.js          Build/Play UI, pointer interactions, save/import/export
├── solver.js          Pure validation and breadth-first solver
├── play-rules.js      Pure legal movement and exit rules for Play preview
└── solver-worker.js   Runs the solver without blocking the editor
```

- Shared authentication: `../shared/gate.js`. Login required for any editor access.
- Service-worker `PRECACHE` includes the editor assets, with cache version `kidsgames-v9`.
- The root game menu is **not** updated. The page is only a prototype, not a playable game.
- Firestore security rules are unchanged. No levels or results are uploaded.
- Proposed playable-game features, hints, statistics and final rules remain in the design plan.

## Future work

Confirm target gate geometry and piece inventory. Review UI on a tablet. Add puzzle IDs and a curated library after the editor is accepted. Build the playable puzzle view separately.
