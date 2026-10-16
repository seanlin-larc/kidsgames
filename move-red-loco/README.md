# Move The Red Locomotive

**Status:** Planning only — awaiting design review. No playable game exists yet.

This folder is reserved for **Move The Red Locomotive**, an original railway sliding-block puzzle inspired by the physical Railroad RushHour set. The game will use original puzzle arrangements and original artwork.

## Design plan

See [Move The Red Locomotive — proposed game plan](https://github.com/seanlin-larc/notes-with-llm/blob/main/projects/kidsgame/2026-10-15_move-red-locomotive-plan.md).

The plan covers the proposed game rules, interface, puzzles, solver, accessibility, sign-in, offline play, statistics, tests, and decisions that need review. Do not begin implementation before review.

## Project conventions

- **Folder:** `move-red-loco/` (lowercase letters and hyphens).
- **Future entry point:** `move-red-loco/index.html`.
- Keep game-specific files inside this folder.
- Use relative links: `../` for the homepage and `../shared/gate.js` for shared sign-in.
- Reserve `mrl-` as the prefix for game-specific browser storage keys.
- Reuse family sign-in, the 48-hour offline check-out, and the shared result outbox.
- Before release, update the root menu, service-worker `PRECACHE` and cache version, and the Firestore rules.
- Do not add a homepage menu link until the game is playable.

## Planned structure (not implemented)

```text
move-red-loco/
├── README.md          Planning placeholder
├── index.html         Game board and interface
├── levels.js          Original levels
└── solver.js          Move validation and solution search
```

## Initial scope for review

Proposed: a 7×7 grid, a red locomotive that must reach a designated exit, one-axis sliding railway vehicles, two-axis movable 2×2 platforms, undo, restart, hints, and original puzzles. The proposed first release uses responsive 2D graphics.

**This README is not approval to implement the proposed game.**
