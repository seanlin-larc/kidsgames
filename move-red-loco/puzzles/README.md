# Puzzle storage and JSON archives

**Current decision:** use Firestore for the shared puzzle library.
The earlier convention of publishing a JSON file per puzzle is superseded.
See [Firebase setup](../../firebase/PUZZLE_SETUP.md) for activation instructions.

Cloud controls are enabled after Sean's report of rule publication.
SL and CJ can save directly from the workshop when online.
Save also keeps a device draft.
The cloud library stores one document per puzzle.

Export Full Library creates one JSON file containing all saved puzzles.
Import into Library validates one or more puzzles and previews new copies before any write.
It assigns fresh IDs and keeps existing puzzles intact. SL and CJ have the same access.
The archive does not contain player statistics or account IDs.

Export Layout and Import Layout still support a single workshop layout.
Those controls remain separate from the full library archive.
A repository commit is not required to save or archive puzzles.

