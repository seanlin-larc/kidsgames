# Admin tools

Tools that run on Sean's computer, not in the website. They use the Firebase Admin SDK.

**Do not put a service account key in this folder or anywhere in this repo.** The repo is public.
A service account key gives full control of the Firebase project.

## reset-pin.mjs — set a new PIN for a player

Use it when a player forgets the PIN, or to give a player an own PIN.
The site cannot do this: the accounts use `@kidsgames.invalid`, so a reset email cannot arrive.

### One-time setup

1. Install Node.js 22 or later (https://nodejs.org). `firebase-admin` 14 needs Node 22.
2. Open a terminal in this `admin` folder. Run:

   ```
   npm install
   ```

### Get a key (each time, or keep one)

1. Firebase console → ⚙ Project settings → **Service accounts** → **Generate new private key**.
2. Save the file as `<home folder>/kidsgames-admin/service-account.json`
   (Windows: `C:\Users\<you>\kidsgames-admin\service-account.json`).
   Any other path outside the repo also works with `--key <path>`.
3. Safer option: delete the key after you use it. Google Cloud console → IAM & Admin →
   Service accounts → `firebase-adminsdk-…` → Keys → delete. Make a new key next time.

### Run

```
node reset-pin.mjs                 list the players, pick one, type the new PIN
node reset-pin.mjs --player YC     go straight to player YC
node reset-pin.mjs --list          list the players only, change nothing
node reset-pin.mjs --key <path>    use a key file at another path
```

The script:

1. Stops if the key is missing, inside the repo, or for a project other than `kidsgame-7a262`.
2. Lists the `@kidsgames.invalid` accounts with the player code from `players/{uid}`.
3. Asks for the new 6-digit PIN two times at a hidden prompt (shows `*`).
   The PIN is not stored, logged, or put on the command line.
4. Asks you to type `yes`, then sets the PIN in Firebase Authentication.

After a change:

- Devices still signed in as that player are signed out when their sign-in next refreshes.
  The player then types the new PIN.
- A device with an active check-out can still play offline until the check-out ends.
- The 30-minute PIN lock is stored on each device (`kg-lock`). The script cannot clear it.
