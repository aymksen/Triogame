# Trio — Multiplayer Card Game

A real-time browser game powered by Firebase Realtime Database. Pure
HTML/CSS/JS so it deploys anywhere static and wraps cleanly with Capacitor for
iOS/Android.

## Project files

```
index.html             # markup
style.css              # Midnight Carnival theme
app.js                 # game logic + UI
firebase.js            # Firebase init + small DB helper
FIREBASE_SETUP.md      # full Firebase setup guide
netlify.toml           # Netlify deploy config
```

## Run locally

```bash
# Option A — Python 3
python -m http.server 5173

# Option B — Node.js
npx serve .
```

Open `http://localhost:5173` in two tabs to test multiplayer.

---

## Deploy to Netlify

The repo is ready to deploy as-is — there is no build step.

### Option 1 — drag & drop (60 seconds)

1. Make sure your Firebase config is filled in inside `firebase.js`
   (see `FIREBASE_SETUP.md`).
2. Open [https://app.netlify.com/drop](https://app.netlify.com/drop).
3. Drag the **entire `triogame` folder** onto the drop zone.
4. Netlify gives you a URL like `https://lucky-trio-1a2b3c.netlify.app`.
   Open it on two devices and play.

### Option 2 — Git-based continuous deployment

1. Push this folder to a GitHub / GitLab / Bitbucket repo.
2. In Netlify: **Add new site → Import an existing project**.
3. Pick the repo. The settings auto-detect from `netlify.toml`:
   - **Build command:** *(empty)*
   - **Publish directory:** `.`
4. Click **Deploy site**. Every push to your default branch redeploys
   automatically.

### Option 3 — Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify deploy           # preview deploy
netlify deploy --prod    # production deploy
```

When prompted for the publish directory, accept `.` (already set by
`netlify.toml`).

### Custom domain (optional)

In the Netlify dashboard: **Site settings → Domain management → Add custom
domain**. Netlify provisions a free Let's Encrypt SSL certificate
automatically.

---

## Firebase note for production

The Firebase Realtime Database does not need any origin whitelisting — your
Netlify domain works out of the box because all access is governed by the
**database security rules** in `FIREBASE_SETUP.md`.

If you later enable Firebase Authentication (e.g. anonymous auth), add your
Netlify domain (e.g. `lucky-trio-1a2b3c.netlify.app` and any custom domain) to
**Firebase Console → Authentication → Settings → Authorized domains**.

---

## Wrap as a mobile app later (Capacitor)

```bash
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init "Trio" "com.example.trio" --web-dir=.
npx cap add android
npx cap add ios
npx cap copy
npx cap open android   # or: npx cap open ios
```

No code changes needed.
