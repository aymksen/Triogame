# Firebase Setup for **Trio**

This guide walks you through everything you need to get the Trio multiplayer
card game running on Firebase Realtime Database. It also covers free hosting
and security rules.

> Estimated time: **5–10 minutes**.

---

## 1. Create a Firebase project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → enter a name (e.g. `trio-game`) → **Continue**.
3. You can disable Google Analytics for this project (not needed). Click **Create project**.
4. Wait for it to finish provisioning, then click **Continue**.

---

## 2. Enable the Realtime Database

1. In the left sidebar, click **Build → Realtime Database**.
2. Click **Create Database**.
3. Choose a location close to your users (e.g. `us-central1` or `europe-west1`).
4. When asked about security rules, choose **Start in test mode** for now.
   We will replace these rules in step 5 with production-ready ones.
5. Click **Enable**.

You should now see an empty Realtime Database with a URL like:

```
https://trio-game-default-rtdb.firebaseio.com/
```

Copy that URL — you'll need it in step 4.

---

## 3. Register a Web App and get the config

1. In the project dashboard, click the **`</>` (Web)** icon next to "Get started by adding Firebase to your app".
2. Give the app a nickname (e.g. `trio-web`) and click **Register app**.
   - **Do NOT** enable Firebase Hosting at this point — we'll do it later via the CLI.
3. Firebase will show you a `firebaseConfig` object that looks like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "trio-game.firebaseapp.com",
  databaseURL: "https://trio-game-default-rtdb.firebaseio.com",
  projectId: "trio-game",
  storageBucket: "trio-game.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdefabcdef",
};
```

Click **Continue to console**.

---

## 4. Paste the config into the code

Open the file **`firebase.js`** in this project. Near the top you'll see:

```js
const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_AUTH_DOMAIN_HERE",
  databaseURL: "PASTE_DATABASE_URL_HERE",
  projectId: "PASTE_PROJECT_ID_HERE",
  storageBucket: "PASTE_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_SENDER_ID_HERE",
  appId: "PASTE_APP_ID_HERE",
};
```

Replace every `PASTE_..._HERE` with the matching value from step 3.

> ⚠️ Make sure the `databaseURL` is included — it is **not** added by default in
> newly-created Firebase configs unless you explicitly enabled the Realtime
> Database before generating the config (which you did in step 2).
> If the field isn't shown, copy it from the Realtime Database page.

Save the file. The app is now connected to your Firebase project.

---

## 5. Realtime Database security rules

The default "test mode" rules expire after 30 days and allow anyone to read/write
**all** of your data. Replace them with the rules below for a safer setup.

In the Firebase console: **Realtime Database → Rules** tab. Paste:

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "codes": {
      ".read": true,
      "$code": {
        ".write": "($code.matches(/^[0-9]{4}$/))",
        ".validate": "newData.hasChildren(['createdAt']) || !newData.exists()"
      }
    },

    "games": {
      ".read": false,
      "$code": {
        ".read": "$code.matches(/^[0-9]{4}$/)",
        ".write": "$code.matches(/^[0-9]{4}$/) && (!data.exists() || !newData.exists() || data.child('status').val() !== 'finished' || newData.child('status').val() === 'finished')"
      }
    }
  }
}
```

Then click **Publish**.

These rules:

- Lock down the database by default.
- Allow any client to read/write `/codes/{4-digit}` (used to claim unique lobby codes).
- Allow any client to read/write `/games/{4-digit}` while the game is **lobby** or **playing**.
- Block writes to a game that has already been marked **finished**, except writes that delete it (cleanup).

> 💡 If you want stronger security, enable **Anonymous Authentication**
> (Build → Authentication → Sign-in method → Anonymous) and add `auth != null`
> guards to each rule. The app already uses a per-device UUID; switching to
> Firebase anonymous auth is a small change in `firebase.js`.

---

## 6. Run locally

You can open `index.html` directly in a browser, but most browsers block some
APIs on `file://`. Use a tiny local server instead:

```bash
# Option A — Python 3
python -m http.server 5173

# Option B — Node.js
npx serve .
```

Open `http://localhost:5173` on two devices (or two browser tabs) and try
creating + joining a lobby.

---

## 7. Deploy to Firebase Hosting (free)

1. Install the Firebase CLI once:

   ```bash
   npm install -g firebase-tools
   ```

2. Log in:

   ```bash
   firebase login
   ```

3. From this project's folder, initialize hosting:

   ```bash
   firebase init hosting
   ```

   - **Use an existing project** → pick the project you created.
   - **Public directory:** `.` (a single dot — current folder).
   - **Single-page app:** `Yes`.
   - **Set up automatic builds:** `No`.
   - When asked whether to overwrite `index.html`, answer **No**.

4. Deploy:

   ```bash
   firebase deploy --only hosting
   ```

5. The CLI prints a URL like `https://trio-game.web.app`. Open it on any phone
   or desktop — your game is live.

---

## 8. Wrapping for Android / iOS later (Capacitor)

The codebase is plain HTML/CSS/JS, so wrapping it is straightforward:

```bash
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init "Trio" "com.example.trio" --web-dir=.
npx cap add android
npx cap add ios
npx cap copy
npx cap open android   # or: npx cap open ios
```

No code changes are required — Firebase compat SDK works inside the WebView.
Just remember to whitelist your Firebase domain in Capacitor's `allowNavigation`
config if you ever add custom auth flows.

---

## 9. (Optional) Cleanup of stale codes

The `/codes/{code}` node is removed automatically when:

- The host clicks **Start Game**, or
- The host leaves the lobby.

If a host disconnects without leaving cleanly, the code can persist. To clean up
codes older than 24 hours, you can either:

- Run a small Cloud Function on a schedule, **or**
- Manually delete the `/codes` subtree once in a while in the Firebase console.

A simple Cloud Function example (optional):

```js
// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.cleanupOldCodes = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const snap = await admin.database().ref("codes").once("value");
    const updates = {};
    snap.forEach((child) => {
      const v = child.val();
      if (!v || (v.createdAt && v.createdAt < cutoff)) {
        updates[child.key] = null;
      }
    });
    await admin.database().ref("codes").update(updates);
    return null;
  });
```

You can deploy this with `firebase deploy --only functions` (requires the
**Blaze** plan, which still has a generous free tier for this kind of usage).

---

## You're done 🎉

Open the deployed URL on two phones, create a lobby on one, share the 4-digit
code with the other, and play Trio. Have fun!
