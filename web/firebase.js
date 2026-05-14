/* ============================================================
   firebase.js — Firebase initialization and DB helpers
   ============================================================
   Configuration is loaded from firebase-config.js (not in git).
   Copy firebase-config.js.template to firebase-config.js and
   add your Firebase project credentials.
   ============================================================ */

// firebase-config.js must define: const firebaseConfig = { ... };
// It is loaded via <script> tag in index.html before this file.



// Initialize Firebase (compat API)
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Expose helpers used by app.js
window.TrioDB = {
  ref: (path) => db.ref(path),
  serverTime: () => firebase.database.ServerValue.TIMESTAMP,

  // Get a single snapshot value
  async get(path) {
    const snap = await db.ref(path).once("value");
    return snap.val();
  },

  // Atomic transaction (used to claim a unique 4-digit code)
  async transaction(path, updater) {
    return db.ref(path).transaction(updater);
  },

  set: (path, value) => db.ref(path).set(value),
  update: (path, value) => db.ref(path).update(value),
  remove: (path) => db.ref(path).remove(),

  // Subscribe; returns unsubscribe function
  on(path, cb) {
    const r = db.ref(path);
    const handler = r.on("value", (snap) => cb(snap.val()));
    return () => r.off("value", handler);
  },

  // Disconnect cleanup helper
  onDisconnectRemove: (path) => db.ref(path).onDisconnect().remove(),
};
