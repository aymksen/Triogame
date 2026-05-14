# Trio

A real-time multiplayer card game for 2-6 players. Collect 3 Trios to win!

**[Play the Web Version](https://triogame.netlify.app)**

## Screenshots

<!-- Add screenshots here -->
<!-- Example: ![Home Screen](screenshots/home.png) -->
<!-- Example: ![Game Screen](screenshots/game.png) -->

*Screenshots coming soon...*

## About The Game

**Trio** is a fast-paced multiplayer card game built with **Firebase Realtime Database** for instant synchronization across all players. Whether you're on a phone, tablet, or desktop, the game adapts beautifully to your screen.

### How To Play

1. **Create or Join** a lobby with a 4-digit code
2. **Flip cards** from the center pile or reveal from other players' hands
3. **Match 3 cards** of the same number to collect a Trio
4. **First to collect 3 Trios** (or a Trio of 7s) wins!

### Features

- **Real-time multiplayer** — No refresh needed, all moves sync instantly
- **Cross-platform** — Web, Android, and iOS from a single codebase
- **Mobile-first design** — Optimized for touch with responsive card layouts
- **Smart reconnection** — Disconnect? Rejoin with the same name and code
- **Beautiful UI** — Midnight carnival theme with golden accents

## Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Firebase Realtime Database
- **Mobile Wrapper:** Capacitor (Android & iOS)
- **Hosting:** Netlify

## Quick Start

```bash
# Clone the repo
git clone https://github.com/aymksen/Triogame.git
cd triogame

# Run locally
cd web
python -m http.server 5173
# Open http://localhost:5173
```

## Setup

### 1. Firebase Configuration

Copy `web/firebase-config.js.template` to `web/firebase-config.js` and add your Firebase project credentials:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

See [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) for detailed Firebase setup instructions.

### 2. Deploy Web

Deploy the `web/` folder to Netlify, Vercel, or any static host.

### 3. Mobile Apps

```bash
cd mobile
npm install
npm run build
npx cap run android   # or ios
```

## Repository Structure

```
triogame/
├── web/              # Web app (HTML/CSS/JS)
├── mobile/           # Capacitor wrapper for native apps
├── FIREBASE_SETUP.md # Firebase configuration guide
└── README.md         # This file
```

## License

MIT © [aymksen](https://github.com/aymksen)
