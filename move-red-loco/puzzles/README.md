# Puzzle storage and JSON archives

**Current decision:** use Firestore for the shared puzzle library.
The earlier convention of publishing a JSON file per puzzle is superseded.
See [Firebase setup](../../firebase/PUZZLE_SETUP.md) for activation instructions.

Cloud saving remains staged off until Sean publishes the prepared Firestore rules.
Save keeps the existing device draft during setup.
After activation, SL can save directly from the workshop.
The cloud library stores one document per puzzle.

Download archive creates one JSON file containing the saved puzzles.
Restore archive validates that file and previews changes before any write.
The archive does not contain player statistics or account IDs.

Export JSON and Import JSON still support a single workshop layout.
Those controls remain separate from the full library archive.
A repository commit is not required to save or archive puzzles.

