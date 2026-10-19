# Puzzle JSON files

Store reviewed puzzle layouts in this folder as `.json` files.
Use lowercase names with hyphens, for example `starter-001.json`.
Keep each filename stable after publication.

## Save and publication

Only SL can use Save and Export JSON in the workshop.
Save keeps a draft on the device, with one slot per difficulty tier.
Export JSON downloads a portable layout file.
Commit reviewed JSON files to this folder to publish them.
The workshop does not write to GitHub from the browser.

No reviewed levels are included yet.
The workshop supports Import JSON; a library selection screen is future work.

## File contents

Each exported file contains these fields:

| Field | Meaning |
|---|---|
| `format` | `move-red-loco-editor-v1` |
| `difficulty` | Starter, Beginner, Amateur, Pro, or Freak |
| `exitRow` | Active exit: upper is `2`, lower is `3` |
| `pieces` | Blocks with IDs, types, positions, dimensions, movement axes, letters, and colors |

The file contains no player account data or device save timestamps.
`puzzle-data.js` checks the same rules for exported files, imported files, and saved drafts.
It checks shapes, coordinates, overlap, IDs, colors, and difficulty.
It preserves rotated trains and supports older files without letters or colors.
The red locomotive determines the active exit when an older file specifies a different valid exit.

An unfinished draft can lack the red locomotive.
Test and Play require a complete, valid layout.
Test proves solvability when its search completes; it does not assign difficulty.

## Access

These files are public in the public repository.
The workshop still requires the shared family sign-in or a valid offline checkout.
The SL save restriction controls the normal interface; it is not a server authorization rule.
GitHub permissions control publication to this folder.
