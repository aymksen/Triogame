// Copies ../web → ./www so Capacitor can bundle the latest web assets.
// Run via `npm run sync-web` (called automatically by `npm run build`).

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "..", "web");
const DEST = path.resolve(__dirname, "..", "www");

// Files we don't want shipped inside the mobile bundle.
const EXCLUDES = new Set(["netlify.toml", "README.md", ".DS_Store", "Thumbs.db"]);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDES.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(SRC)) {
  console.error(`[sync-web] Source folder not found: ${SRC}`);
  process.exit(1);
}

// Wipe and recopy so deletions in /web are reflected.
if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
copyDir(SRC, DEST);
console.log(`[sync-web] Copied ${SRC} -> ${DEST}`);
