/* ============================================================
   app.js — Trio multiplayer card game (vanilla JS)
   Depends on: firebase.js (window.TrioDB)
   ============================================================ */

// ====================== CONSTANTS ======================
const CARD_NUMBERS = 12;
const COPIES = 3;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const RESOLVE_DELAY_MS = 2500;
const FINISHED_GRACE_MS = 30000; // host removes finished game after this delay
const SKIP_OFFLINE_MS = 6000;     // wait before auto-skipping a disconnected current-turn player

// Card distribution per player count: { handSize, centerSize }
const DEAL_TABLE = {
  2: { hand: 12, center: 12 },
  3: { hand: 9,  center: 9  },
  4: { hand: 7,  center: 8  },
  5: { hand: 6,  center: 6  },
  6: { hand: 5,  center: 6  },
};

// Optimal grid layout for the center pile by card count
const CENTER_GRID = {
  12: [4, 3], 9: [3, 3], 8: [4, 2], 6: [3, 2],
};

// Distinct player accent colors (used for avatars + borders + name tags)
const PLAYER_COLORS = [
  "#ffd86b", "#4ade80", "#60a5fa", "#f472b6",
  "#c084fc", "#fb923c", "#2dd4bf", "#f87171",
];

// ====================== STATE ======================
const state = {
  uid: null,
  name: null,
  code: null,
  isHost: false,
  game: null,
  unsubGame: null,
  winShown: false,
  presenceRef: null,   // path string for cleanup
  skipTimer: null,
};

// ====================== IDENTITY ======================
function getOrCreateUid() {
  let u = localStorage.getItem("trio_uid");
  if (!u) {
    u = "u_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
    localStorage.setItem("trio_uid", u);
  }
  return u;
}
state.uid = getOrCreateUid();

// Restore last name
const savedName = localStorage.getItem("trio_name");
if (savedName) document.getElementById("input-name").value = savedName;

// ====================== UTILS ======================
function $(id) { return document.getElementById(id); }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}
function toast(msg, ms = 2200) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}
function colorClass(n) {
  if (n <= 4) return "color-low";
  if (n <= 8) return "color-mid";
  return "color-high";
}
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function playerColor(uid) {
  return PLAYER_COLORS[hashString(uid || "") % PLAYER_COLORS.length];
}
function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ====================== DECK / DEAL ======================
function buildDeck() {
  const deck = [];
  for (let n = 1; n <= CARD_NUMBERS; n++) for (let c = 0; c < COPIES; c++) deck.push(n);
  return shuffle(deck);
}
function dealGame(playerOrder) {
  const cfg = DEAL_TABLE[playerOrder.length];
  if (!cfg) throw new Error("Unsupported player count");
  const deck = buildDeck();
  const players = {};
  for (const uid of playerOrder) {
    const hand = deck.splice(0, cfg.hand).sort((a, b) => a - b);
    players[uid] = { hand, trios: [] };
  }
  // The remaining deck is the center pile; it must equal cfg.center.
  const centerPile = deck.slice(0, cfg.center);
  return { deals: players, centerPile };
}

// ====================== CODE GENERATION ======================
async function generateUniqueCode() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    // Skip if there's a real game record using this code (lobby or playing).
    const existing = await TrioDB.get(`games/${code}`);
    if (existing) continue;
    // Atomically claim /codes/{code}. Allow overwrite if it was orphaned
    // (i.e. /games/{code} doesn't exist anymore but /codes/{code} lingered
    // from an abandoned lobby).
    const result = await TrioDB.transaction(`codes/${code}`, () => ({ createdAt: Date.now() }));
    if (result.committed) return code;
  }
  throw new Error("Could not allocate a unique lobby code. Try again.");
}

// ====================== CONFIRM MODAL ======================
function confirmDialog({ title = "Are you sure?", message = "", confirmText = "Yes", cancelText = "Cancel" } = {}) {
  return new Promise((resolve) => {
    $("confirm-title").textContent = title;
    $("confirm-message").textContent = message;
    $("confirm-yes").textContent = confirmText;
    $("confirm-no").textContent = cancelText;
    const overlay = $("confirm-overlay");
    overlay.classList.remove("hidden");
    const cleanup = (val) => {
      overlay.classList.add("hidden");
      $("confirm-yes").removeEventListener("click", onYes);
      $("confirm-no").removeEventListener("click", onNo);
      resolve(val);
    };
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    $("confirm-yes").addEventListener("click", onYes);
    $("confirm-no").addEventListener("click", onNo);
  });
}

// ====================== PRESENCE ======================
// Listens to .info/connected and re-asserts online:true whenever the
// connection comes back. This prevents a brief network blip from leaving
// the player marked "offline" forever (which other clients then treat as
// a candidate for cleanup / turn-skip).
async function registerPresence() {
  if (!state.code) return;
  const path = `games/${state.code}/players/${state.uid}/online`;
  state.presenceRef = path;
  // Tear down any previous .info/connected listener
  if (state.presenceConnHandler) {
    try { TrioDB.ref(".info/connected").off("value", state.presenceConnHandler); } catch {}
    state.presenceConnHandler = null;
  }
  const connRef = TrioDB.ref(".info/connected");
  state.presenceConnHandler = connRef.on("value", async (snap) => {
    if (snap.val() !== true) return;
    if (state.presenceRef !== path) return; // stale
    try {
      await TrioDB.ref(path).onDisconnect().set(false);
      await TrioDB.set(path, true);
    } catch (e) {
      console.warn("presence refresh failed", e);
    }
  });
}
async function clearPresence() {
  if (state.presenceConnHandler) {
    try { TrioDB.ref(".info/connected").off("value", state.presenceConnHandler); } catch {}
    state.presenceConnHandler = null;
  }
  if (!state.presenceRef) return;
  const path = state.presenceRef;
  state.presenceRef = null;
  try {
    await TrioDB.ref(path).onDisconnect().cancel();
  } catch {}
}

// ====================== HOME SCREEN ======================
$("btn-create").addEventListener("click", async () => {
  const name = $("input-name").value.trim();
  if (!name) return setError("Please enter your name");
  setError("");
  state.name = name;
  localStorage.setItem("trio_name", name);
  $("btn-create").disabled = true;
  $("btn-join").disabled = true;
  try {
    const code = await generateUniqueCode();
    await TrioDB.set(`games/${code}`, {
      code,
      host: state.uid,
      status: "lobby",
      createdAt: Date.now(),
      players: { [state.uid]: { name, hand: [], trios: [], online: true } },
      playerOrder: [state.uid],
    });
    state.code = code;
    state.isHost = true;
    await registerPresence();
    // If the host disconnects while the lobby is still pending, auto-clean
    // the orphaned /games and /codes entries so the 4-digit code is freed.
    // We cancel these onDisconnect handlers when the game actually starts.
    try {
      await TrioDB.ref(`games/${code}`).onDisconnect().remove();
      await TrioDB.ref(`codes/${code}`).onDisconnect().remove();
      state.hostLobbyDisconnect = code;
    } catch {}
    enterLobby();
  } catch (e) {
    setError(e.message || "Failed to create lobby");
  } finally {
    $("btn-create").disabled = false;
    $("btn-join").disabled = false;
  }
});

$("btn-join").addEventListener("click", async () => {
  const name = $("input-name").value.trim();
  const code = $("input-code").value.trim();
  if (!name) return setError("Please enter your name");
  if (!/^\d{4}$/.test(code)) return setError("Enter a valid 4-digit code");
  setError("");
  state.name = name;
  localStorage.setItem("trio_name", name);
  $("btn-create").disabled = true;
  $("btn-join").disabled = true;
  try {
    const game = await TrioDB.get(`games/${code}`);
    if (!game) throw new Error("Lobby not found");
    if (game.status === "finished") throw new Error("Game already finished");

    if (game.status === "playing") {
      // Allow rejoin: same uid (returning device) OR same name as an offline player.
      let rejoinUid = null;
      const players = game.players || {};
      if (players[state.uid]) {
        rejoinUid = state.uid;
      } else {
        const target = name.toLowerCase();
        for (const [uid, p] of Object.entries(players)) {
          if ((p.name || "").toLowerCase() === target) { rejoinUid = uid; break; }
        }
      }
      if (!rejoinUid) throw new Error("Game in progress — only original players can rejoin (use the same name).");
      // If we matched by name on a different device/uid, hijack that slot.
      if (rejoinUid !== state.uid) {
        state.uid = rejoinUid;
        localStorage.setItem("trio_uid", rejoinUid);
      }
      await TrioDB.update(`games/${code}/players/${state.uid}`, { online: true });
      state.code = code;
      state.isHost = game.host === state.uid;
      await registerPresence();
      enterLobby();
      toast("Rejoined the game");
      return;
    }

    // Lobby state — normal join
    const order = (game.playerOrder || []).slice();
    if (!order.includes(state.uid)) {
      if (order.length >= MAX_PLAYERS) throw new Error("Lobby is full");
      order.push(state.uid);
    }
    await TrioDB.update(`games/${code}`, {
      [`players/${state.uid}`]: { name, hand: [], trios: [], online: true },
      playerOrder: order,
    });
    state.code = code;
    state.isHost = game.host === state.uid;
    await registerPresence();
    enterLobby();
  } catch (e) {
    setError(e.message || "Failed to join lobby");
  } finally {
    $("btn-create").disabled = false;
    $("btn-join").disabled = false;
  }
});

function setError(msg) {
  $("home-error").textContent = msg;
}

// ====================== LOBBY SCREEN ======================
function enterLobby() {
  $("lobby-code").textContent = state.code;
  showScreen("screen-lobby");
  if (state.unsubGame) state.unsubGame();
  state.unsubGame = TrioDB.on(`games/${state.code}`, onGameSnapshot);
}

// Click/tap the code box to copy the lobby code
async function copyLobbyCode() {
  if (!state.code) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(state.code);
    } else {
      const ta = document.createElement("textarea");
      ta.value = state.code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    const box = $("code-box");
    box.classList.add("copied");
    clearTimeout(copyLobbyCode._t);
    copyLobbyCode._t = setTimeout(() => box.classList.remove("copied"), 900);
  } catch (e) {
    toast("Couldn't copy — code is " + state.code);
  }
}
$("code-box").addEventListener("click", copyLobbyCode);
$("code-box").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copyLobbyCode(); }
});

$("btn-start").addEventListener("click", startGame);
$("btn-leave").addEventListener("click", () => askLeave("lobby"));
$("btn-leave-game").addEventListener("click", () => askLeave("game"));

// In-game code chip: tap to copy.
$("game-code").addEventListener("click", async () => {
  const chip = $("game-code");
  if (!state.code) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(state.code);
    } else {
      const ta = document.createElement("textarea");
      ta.value = state.code; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
    chip.classList.add("copied");
    toast(`Code ${state.code} copied`);
    setTimeout(() => chip.classList.remove("copied"), 1200);
  } catch {
    toast(`Code: ${state.code}`);
  }
});

// Help / rules popup — reuses the same rules HTML from the home screen.
function openRules() {
  const src = document.querySelector(".how-to-play .rules");
  const dest = $("rules-modal-body");
  if (src && !dest.dataset.filled) {
    dest.innerHTML = src.innerHTML;
    dest.dataset.filled = "1";
  }
  $("rules-overlay").classList.remove("hidden");
}
function closeRules() { $("rules-overlay").classList.add("hidden"); }
$("btn-help").addEventListener("click", openRules);
$("btn-rules-close").addEventListener("click", closeRules);
$("rules-overlay").addEventListener("click", (e) => {
  if (e.target.id === "rules-overlay") closeRules();
});
$("btn-play-again").addEventListener("click", () => leaveLobby());

async function askLeave(where) {
  const isHost = state.isHost;
  const inGame = where === "game";
  const ok = await confirmDialog({
    title: inGame ? "Leave the game?" : (isHost ? "Close the lobby?" : "Leave the lobby?"),
    message: inGame
      ? "You'll abandon this game. Other players will continue without you."
      : isHost
        ? "You're the host — leaving will close this lobby for everyone."
        : "You'll exit this lobby and return to the home screen.",
    confirmText: inGame ? "Leave Game" : (isHost ? "Close Lobby" : "Leave"),
    cancelText: "Stay",
  });
  if (ok) leaveLobby();
}

async function startGame() {
  const game = state.game;
  if (!game || game.host !== state.uid) return;
  const baseOrder = (game.playerOrder || []).slice();
  if (baseOrder.length < MIN_PLAYERS) return toast("Need at least 2 players");
  $("btn-start").disabled = true;
  // Randomize seating so first turn is random
  const order = shuffle(baseOrder.slice());
  const { deals, centerPile } = dealGame(order);
  const playersUpdate = {};
  for (const uid of order) {
    playersUpdate[uid] = {
      name: game.players[uid].name,
      hand: deals[uid].hand,
      trios: [],
      online: game.players[uid].online !== false,
    };
  }
  try {
    await TrioDB.update(`games/${state.code}`, {
      status: "playing",
      players: playersUpdate,
      playerOrder: order,
      centerPile,
      centerSize: centerPile.length,
      currentTurnIndex: 0,
      turnPhase: "firstFlip",
      revealedThisTurn: [],
      resolving: false,
      winner: null,
      startedAt: Date.now(),
    });
    // Note: keep /codes/{code} reserved while the game is in progress so a
    // new lobby can't reuse this 4-digit code. We only free it once the
    // game finishes (see resolveTurnIfNeeded / leaveLobby).
    // Cancel the host's "abandon lobby" onDisconnect cleanup — once the
    // game has started we don't want a brief disconnect to nuke it.
    if (state.hostLobbyDisconnect) {
      try {
        await TrioDB.ref(`games/${state.hostLobbyDisconnect}`).onDisconnect().cancel();
        await TrioDB.ref(`codes/${state.hostLobbyDisconnect}`).onDisconnect().cancel();
      } catch {}
      state.hostLobbyDisconnect = null;
    }
  } catch (e) {
    toast("Failed to start: " + e.message);
    $("btn-start").disabled = false;
  }
}

// ====================== SUBSCRIPTION ======================
async function onGameSnapshot(game) {
  if (!game) {
    // Defensive: a single null delivery can happen during reconnect or due
    // to a transient race. Re-fetch after a short delay before kicking the
    // user out of the game.
    const code = state.code;
    if (!code) return;
    await new Promise((r) => setTimeout(r, 1500));
    if (!state.code || state.code !== code) return; // user already left
    const fresh = await TrioDB.get(`games/${code}`).catch(() => undefined);
    if (fresh) {
      // Real data came back — process it through this same handler.
      onGameSnapshot(fresh);
      return;
    }
    // Truly gone.
    cleanupGameSubscription();
    showScreen("screen-home");
    toast("Game ended");
    return;
  }
  state.game = game;
  state.isHost = game.host === state.uid;

  if (game.status === "lobby") {
    showScreen("screen-lobby");
    renderLobby(game);
    cleanupOfflineLobbyPlayers(game);
  } else if (game.status === "playing") {
    renderGame(game);
    scheduleSkipIfOffline(game);
  } else if (game.status === "finished") {
    renderGame(game);
    if (game.winner) showWinScreen(game);
  }
}

// Host removes lobby players who disconnected before the game started
async function cleanupOfflineLobbyPlayers(game) {
  if (!state.isHost) return;
  const order = game.playerOrder || [];
  const stale = order.filter((uid) => uid !== state.uid && (game.players?.[uid]?.online === false));
  if (!stale.length) return;
  const updates = { playerOrder: order.filter((u) => !stale.includes(u)) };
  for (const u of stale) updates[`players/${u}`] = null;
  try { await TrioDB.update(`games/${state.code}`, updates); } catch {}
}

// If the current-turn player is offline, schedule a transactional skip
function scheduleSkipIfOffline(game) {
  clearTimeout(state.skipTimer);
  if (game.winner || game.resolving) return;
  const order = game.playerOrder || [];
  const cur = order[game.currentTurnIndex || 0];
  const curP = (game.players || {})[cur];
  if (!curP) return;
  if (curP.online !== false) return;     // online — no skip
  if (cur === state.uid) return;          // never skip yourself
  state.skipTimer = setTimeout(() => trySkipOfflineTurn(cur), SKIP_OFFLINE_MS);
}
async function trySkipOfflineTurn(expectedUid) {
  if (!state.code) return;
  try {
    await TrioDB.transaction(`games/${state.code}`, (g) => {
      if (!g || g.status !== "playing" || g.winner) return;
      const order = g.playerOrder || [];
      const cur = order[g.currentTurnIndex || 0];
      if (cur !== expectedUid) return;
      const curP = (g.players || {})[cur];
      if (!curP || curP.online !== false) return;
      g.currentTurnIndex = ((g.currentTurnIndex || 0) + 1) % order.length;
      g.turnPhase = "firstFlip";
      g.revealedThisTurn = null;
      g.resolving = false;
      return g;
    });
    toast("Skipped a disconnected player");
  } catch (e) { console.warn("skip failed", e); }
}

function renderLobby(game) {
  const list = $("player-list");
  list.innerHTML = "";
  const order = game.playerOrder || [];
  order.forEach((uid) => {
    const p = (game.players || {})[uid];
    if (!p) return;
    const li = document.createElement("li");
    li.style.setProperty("--player-color", playerColor(uid));
    if (p.online === false) li.classList.add("offline");
    let html = `<span class="avatar">${escapeHtml(initials(p.name))}</span><span>${escapeHtml(p.name)}</span>`;
    if (uid === state.uid) html += `<span class="you-tag">YOU</span>`;
    if (uid === game.host) html += `<span class="host-tag">HOST</span>`;
    li.innerHTML = html;
    list.appendChild(li);
  });
  const isHost = game.host === state.uid;
  const startBtn = $("btn-start");
  startBtn.style.display = isHost ? "" : "none";
  startBtn.disabled = order.length < MIN_PLAYERS;
  $("lobby-hint").textContent =
    order.length < MIN_PLAYERS
      ? "Waiting for at least 2 players…"
      : isHost
      ? "Ready to start when you are!"
      : "Waiting for host to start…";
}

// ====================== GAME RENDERING ======================
function renderGame(game) {
  showScreen("screen-game");
  $("game-code-num").textContent = state.code || "----";
  const order = game.playerOrder || [];
  const currentUid = order[game.currentTurnIndex || 0];
  const isMyTurn = currentUid === state.uid && !game.resolving && !game.winner;

  // Banner
  const banner = $("turn-banner");
  banner.classList.toggle("my-turn", currentUid === state.uid && !game.winner);
  if (game.winner) {
    banner.textContent = `${(game.players[game.winner] || {}).name || "Someone"} wins!`;
  } else if (currentUid === state.uid) {
    banner.textContent = `Your turn — ${phaseHint(game)}`;
  } else {
    const nm = (game.players[currentUid] || {}).name || "...";
    banner.textContent = `${nm}'s turn`;
  }

  renderOpponents(game, isMyTurn, currentUid);
  renderCenterPile(game, isMyTurn);
  renderRevealed(game);
  renderMyHand(game, isMyTurn);
}

function phaseHint(game) {
  const n = (game.revealedThisTurn || []).length;
  if (game.resolving) return "resolving…";
  if (n === 0) return "flip a card";
  if (n === 1) return `match the ${game.revealedThisTurn[0].value}`;
  if (n === 2) return `find one more ${game.revealedThisTurn[0].value}`;
  return "…";
}

function notYetRevealedIndices(uid, game) {
  const used = new Set();
  for (const r of game.revealedThisTurn || []) {
    if (r.origin === uid) used.add(r.originIndex);
  }
  const hand = ((game.players || {})[uid] || {}).hand || [];
  return hand.map((v, i) => ({ v, i })).filter((x) => !used.has(x.i));
}
function lowestIdx(uid, game) {
  const arr = notYetRevealedIndices(uid, game);
  return arr.length ? arr[0].i : -1;
}
function highestIdx(uid, game) {
  const arr = notYetRevealedIndices(uid, game);
  return arr.length ? arr[arr.length - 1].i : -1;
}

function renderOpponents(game, isMyTurn, currentUid) {
  const root = $("opponents");
  root.innerHTML = "";
  for (const uid of game.playerOrder || []) {
    if (uid === state.uid) continue;
    const p = (game.players || {})[uid];
    if (!p) continue;
    const div = document.createElement("div");
    div.className = "opponent" + (uid === currentUid ? " current-turn" : "") + (p.online === false ? " offline" : "");
    div.style.setProperty("--pc", playerColor(uid));
    const handCount = (p.hand || []).length;
    const trios = p.trios || [];
    const lowI = lowestIdx(uid, game);
    const highI = highestIdx(uid, game);
    const canShow = isMyTurn && handCount > 0 && p.online !== false;
    const chips = trios.map((v) => `<span class="trio-chip" data-num="${v}" style="background:${cardColor(v)}">${v}</span>`).join("");
    div.innerHTML = `
      <div class="op-head">
        <span class="avatar">${escapeHtml(initials(p.name))}</span>
        <span class="op-name">${escapeHtml(p.name)}</span>
        <span class="op-status ${p.online === false ? "away" : "live"}">${p.online === false ? "away" : "live"}</span>
      </div>
      <div class="op-stats">
        <span class="cards-stat" title="cards in hand">
          <span class="card-icon">🃏</span>
          <span class="stat-num">${handCount}</span>
        </span>
        <span class="trio-chips">${chips}</span>
      </div>
      <div class="op-actions">
        <button class="btn-tiny" data-act="show-low" data-uid="${uid}" ${(!canShow || lowI < 0) ? "disabled" : ""}>Lowest</button>
        <button class="btn-tiny" data-act="show-high" data-uid="${uid}" ${(!canShow || highI < 0) ? "disabled" : ""}>Highest</button>
      </div>`;
    root.appendChild(div);
  }
  root.onclick = (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn || btn.disabled) return;
    const uid = btn.dataset.uid;
    const idx = btn.dataset.act === "show-low" ? lowestIdx(uid, state.game) : highestIdx(uid, state.game);
    revealOpponentCard(uid, idx);
  };
}

// Pick the (cols, rows) grid that maximizes the per-card pixel size given
// the actual available box (availW × availH) and a fixed card aspect ratio
// (width:height = 2:3). This guarantees the cards always fill the space
// nicely without being cramped, regardless of count or screen size.
function bestGridDynamic(n, availW, availH, gap, aspect, maxCols) {
  aspect = aspect || 1.5; // height = width * aspect
  // On PC/tablet, limit to 4 columns max for nicer proportions
  // On mobile (narrow), allow up to 6 for density
  const isDesktop = window.innerWidth >= 768;
  const hardMax = maxCols || (isDesktop ? 4 : 6);
  let best = { cols: Math.min(n, hardMax), rows: Math.ceil(n / Math.min(n, hardMax)), cardW: 0 };
  // Try every cols from 1..min(n, hardMax). rows = ceil(n/cols).
  for (let cols = 1; cols <= Math.min(n, hardMax); cols++) {
    const rows = Math.ceil(n / cols);
    if (rows * cols >= n + cols) continue; // last row would be entirely empty
    const wByW = (availW - (cols - 1) * gap) / cols;
    const wByH = (availH - (rows - 1) * gap) / rows / aspect;
    const cardW = Math.min(wByW, wByH);
    if (cardW > best.cardW) best = { cols, rows, cardW };
  }
  return [best.cols, best.rows, best.cardW];
}

function bestGrid(n) {
  // (Legacy — kept for callers that just need a default shape.)
  if (window.innerWidth < 480) {
    if (n === 12) return [6, 2];
    if (n === 9)  return [5, 2]; // 5 + 4 (one trailing slot empty)
    if (n === 8)  return [5, 2]; // 5 + 3 (two trailing slots empty)
    if (n === 6)  return [6, 1];
  }
  if (CENTER_GRID[n]) return CENTER_GRID[n];
  const cols = Math.ceil(Math.sqrt(n));
  return [cols, Math.ceil(n / cols)];
}

let _centerRO = null;
let _centerLastSize = { w: 0, h: 0 };
let _centerScheduledRecheck = false;
function ensureCenterObserver(root) {
  if (_centerRO) return;
  if (typeof ResizeObserver === "undefined") return;
  _centerRO = new ResizeObserver((entries) => {
    const r = entries[0].contentRect;
    if (Math.abs(r.width - _centerLastSize.w) < 2 && Math.abs(r.height - _centerLastSize.h) < 2) return;
    _centerLastSize = { w: r.width, h: r.height };
    if (state.game) renderCenterPile(state.game, isMyTurnNow());
  });
  _centerRO.observe(root);
}

function renderCenterPile(game, isMyTurn) {
  const wrap = document.querySelector(".center-area");
  if (wrap) wrap.classList.toggle("my-turn", !!isMyTurn);

  const root = $("center-pile");
  ensureCenterObserver(root);
  const pile = game.centerPile || [];
  // The total slot count is fixed at game start so positions don't shift when trios are removed.
  const totalSlots = game.centerSize || pile.length;
  const isPresent = (i) => pile[i] !== null && pile[i] !== undefined;
  const remaining = (() => { let n = 0; for (let i = 0; i < totalSlots; i++) if (isPresent(i)) n++; return n; })();
  $("center-count").textContent = remaining;
  root.innerHTML = "";
  if (totalSlots === 0) {
    root.style.gridTemplateColumns = "";
    root.innerHTML = `<div class="placeholder">Center pile is empty</div>`;
    return;
  }
  // The center-area is now shrink-to-fit (so its dark frame hugs the cards
  // rather than stretching to fill the screen). That means we can't read
  // its clientHeight to size the cards — it would be circular. Instead,
  // we compute the available space from the GAME SCREEN minus the heights
  // of the other sections (topbar, opponents, staging, my-area).
  const gap = window.innerWidth < 480 ? 6 : 8;
  const parent = root.parentElement; // .center-area
  const screen = document.getElementById("screen-game");
  const topbar = screen ? screen.querySelector(".game-topbar") : null;
  const opponentsEl = document.getElementById("opponents");
  const stagingEl = document.getElementById("staging-area");
  const myArea = screen ? screen.querySelector(".my-area") : null;
  const screenStyle = screen ? getComputedStyle(screen) : null;
  const screenPadY = screenStyle
    ? (parseFloat(screenStyle.paddingTop) || 0) + (parseFloat(screenStyle.paddingBottom) || 0)
    : 0;
  const screenGap = screenStyle ? (parseFloat(screenStyle.rowGap) || parseFloat(screenStyle.gap) || 6) : 6;
  const screenH = screen ? screen.clientHeight : window.innerHeight;
  const used =
    (topbar ? topbar.offsetHeight : 0) +
    (opponentsEl ? opponentsEl.offsetHeight : 0) +
    (stagingEl ? stagingEl.offsetHeight : 0) +
    (myArea ? myArea.offsetHeight : 0) +
    screenPadY + screenGap * 4; // 4 gaps between 5 sections
  // Center-area's own padding (around the inner grid)
  const pcs = parent ? getComputedStyle(parent) : null;
  const padX = pcs ? (parseFloat(pcs.paddingLeft) || 0) + (parseFloat(pcs.paddingRight) || 0) : 0;
  const padY = pcs ? (parseFloat(pcs.paddingTop) || 0) + (parseFloat(pcs.paddingBottom) || 0) : 0;
  const title = parent ? parent.querySelector(".section-title") : null;
  const titleAbs = title && getComputedStyle(title).position === "absolute";
  const titleH = (title && !titleAbs) ? title.getBoundingClientRect().height : 0;
  // Capture for the deferred re-check
  const parentClientWidthAtRender = screen ? screen.clientWidth : window.innerWidth;
  const parentClientHeightAtRender = screenH - used;
  const availH = Math.max(80, screenH - used - padY - titleH);
  const availW = (screen ? screen.clientWidth : window.innerWidth) - padX - 8; // small horizontal safety
  // Dynamically pick the grid shape that maximizes per-card pixel size for the
  // given available box. This ensures cards always fill the space nicely.
  const [cols, rows, idealCardW] = bestGridDynamic(totalSlots, availW, availH, gap, 1.5);
  const ceiling = window.innerWidth < 480 ? 72 : 96;
  const floor = 30;
  const cardW = Math.max(floor, Math.min(ceiling, Math.floor(idealCardW)));
  root.style.gridTemplateColumns = `repeat(${cols}, ${cardW}px)`;
  // First-paint, the layout often isn't settled yet (other sections still
  // resolving their final heights — especially in Android WebView). Schedule
  // multiple deferred re-measurements: rAF (next frame), 100ms (after styles
  // applied) and 350ms (after slow Android layout pass). Each one re-renders
  // only if the parent's actual size changed by more than 4px.
  const reCheckCenter = () => {
    if (!state.game || !screen || !screen.isConnected) return;
    const newUsed =
      (topbar ? topbar.offsetHeight : 0) +
      (opponentsEl ? opponentsEl.offsetHeight : 0) +
      (stagingEl ? stagingEl.offsetHeight : 0) +
      (myArea ? myArea.offsetHeight : 0) +
      screenPadY + screenGap * 4;
    const newAvailH = screen.clientHeight - newUsed;
    const newAvailW = screen.clientWidth;
    if (Math.abs(newAvailH - parentClientHeightAtRender) > 4 ||
        Math.abs(newAvailW - parentClientWidthAtRender) > 4) {
      renderCenterPile(state.game, isMyTurnNow());
    }
  };
  if (!_centerScheduledRecheck) {
    _centerScheduledRecheck = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      _centerScheduledRecheck = false;
      reCheckCenter();
    }));
    setTimeout(reCheckCenter, 100);
    setTimeout(reCheckCenter, 350);
  }

  // Map of revealed-this-turn center indices -> value (so we can render them face-up in place)
  const revealedCenter = new Map();
  for (const r of game.revealedThisTurn || []) {
    if (r.origin === "center") revealedCenter.set(r.originIndex, r.value);
  }
  const canFlip = isMyTurn;
  for (let i = 0; i < totalSlots; i++) {
    const c = document.createElement("div");
    if (!isPresent(i)) {
      // Slot was claimed by a previous trio — keep it as an invisible placeholder
      // so the rest of the grid stays in place.
      c.className = "card slot-empty";
    } else if (revealedCenter.has(i)) {
      // Show the actual card face-up at its position with a flip animation
      c.className = "card face-up flipped";
      c.dataset.num = revealedCenter.get(i);
      c.textContent = revealedCenter.get(i);
    } else {
      c.className = "card face-down" + (canFlip ? " clickable" : "");
      if (canFlip) c.addEventListener("click", () => flipCenter(i));
    }
    root.appendChild(c);
  }
}

// Approximate color used for trio chips (matches CSS gradients above)
function cardColor(n) {
  return ({
    1: "#c81d2e", 2: "#d96a17", 3: "#a87808", 4: "#2e7d32",
    5: "#0d7064", 6: "#0f5fa8", 7: "#ff8a3d", 8: "#6b21a8",
    9: "#9d174d", 10: "#075a73", 11: "#4d7c0f", 12: "#312e81",
  })[n] || "#444";
}

function renderRevealed(game) {
  const root = $("revealed-cards");
  const status = $("turn-status");
  const wrap = $("staging-area");
  const rev = game.revealedThisTurn || [];
  if (rev.length === 0) {
    wrap.classList.remove("has-cards");
    root.innerHTML = '<div class="placeholder">tap a card to start your turn</div>';
    status.textContent = "";
    status.classList.remove("success", "fail");
    return;
  }
  wrap.classList.add("has-cards");
  root.innerHTML = "";
  rev.forEach((r) => {
    const chip = document.createElement("span");
    chip.className = "revealed-chip";
    chip.textContent = r.value;
    chip.dataset.origin = r.origin === "center" ? "center" : "player";
    const originColor = r.origin === "center" ? "#ffd86b" : playerColor(r.origin);
    chip.style.setProperty("--origin", originColor);
    chip.style.background = cardColor(r.value);
    chip.title = r.origin === "center"
      ? `★ ${r.value} from center`
      : `${r.value} from ${(game.players[r.origin] || {}).name || "?"}`;
    root.appendChild(chip);
  });
  status.classList.remove("success", "fail");
  if (game.resolving) {
    const allMatch = rev.length >= 2 && rev.every((x) => x.value === rev[0].value);
    if (rev.length === 3 && allMatch) {
      status.textContent = `🎉 TRIO OF ${rev[0].value}!`;
      status.classList.add("success");
    } else {
      status.textContent = "❌ No match — returning cards…";
      status.classList.add("fail");
    }
  } else {
    status.textContent = "";
  }
}

function renderMyHand(game, isMyTurn) {
  const root = $("my-hand");
  root.innerHTML = "";
  const me = (game.players || {})[state.uid];
  if (!me) return;
  const hand = me.hand || [];
  $("hand-count").textContent = hand.length;
  const myTrios = me.trios || [];
  $("my-trio-chips").innerHTML = myTrios
    .map((v) => `<span class="trio-chip" data-num="${v}" style="background:${cardColor(v)}">${v}</span>`)
    .join("");
  $("my-name").textContent = me.name || "You";
  $("my-avatar").textContent = initials(me.name);
  $("my-name-tag").style.setProperty("--pc", playerColor(state.uid));
  const usedSelf = new Set();
  for (const r of game.revealedThisTurn || []) if (r.origin === state.uid) usedSelf.add(r.originIndex);
  const lowI = lowestIdx(state.uid, game);
  const highI = highestIdx(state.uid, game);
  hand.forEach((v, i) => {
    const c = document.createElement("div");
    c.className = "card face-up" + (usedSelf.has(i) ? " staged" : "");
    c.dataset.num = v;
    const isLow = i === lowI;
    const isHigh = i === highI;
    if (isLow) c.classList.add("is-low");
    if (isHigh) c.classList.add("is-high");
    // Allow direct click on lowest/highest when it's my turn
    if (isMyTurn && (isLow || isHigh) && !usedSelf.has(i)) {
      c.classList.add("clickable");
      const which = isLow ? "low" : "high";
      c.addEventListener("click", () => revealMine(which));
    }
    c.textContent = v;
    root.appendChild(c);
  });
  $("btn-reveal-mine-low").disabled = !isMyTurn || lowI < 0;
  $("btn-reveal-mine-high").disabled = !isMyTurn || highI < 0;
}

$("btn-reveal-mine-low").addEventListener("click", () => revealMine("low"));
$("btn-reveal-mine-high").addEventListener("click", () => revealMine("high"));

// ====================== TURN ACTIONS ======================
function isMyTurnNow() {
  const g = state.game;
  if (!g || g.winner || g.resolving) return false;
  return (g.playerOrder || [])[g.currentTurnIndex] === state.uid;
}

async function flipCenter(idx) {
  if (!isMyTurnNow()) return;
  const value = state.game.centerPile[idx];
  await applyReveal({ value, origin: "center", originIndex: idx });
}
async function revealOpponentCard(uid, idx) {
  if (!isMyTurnNow() || idx < 0) return;
  const value = state.game.players[uid].hand[idx];
  await applyReveal({ value, origin: uid, originIndex: idx });
}
async function revealMine(which) {
  if (!isMyTurnNow()) return;
  const idx = which === "low" ? lowestIdx(state.uid, state.game) : highestIdx(state.uid, state.game);
  if (idx < 0) return;
  const value = state.game.players[state.uid].hand[idx];
  await applyReveal({ value, origin: state.uid, originIndex: idx });
}

async function applyReveal(reveal) {
  const game = state.game;
  if (!game || game.winner || game.resolving) return;
  if ((game.playerOrder || [])[game.currentTurnIndex] !== state.uid) return;

  const newRevealed = (game.revealedThisTurn || []).concat([reveal]);
  const n = newRevealed.length;
  const updates = { revealedThisTurn: newRevealed };

  if (n === 1) {
    updates.turnPhase = "secondFlip";
    await TrioDB.update(`games/${state.code}`, updates);
  } else if (n === 2) {
    if (newRevealed[1].value === newRevealed[0].value) {
      updates.turnPhase = "thirdFlip";
      await TrioDB.update(`games/${state.code}`, updates);
    } else {
      updates.turnPhase = "resolving";
      updates.resolving = true;
      await TrioDB.update(`games/${state.code}`, updates);
      setTimeout(() => resolveTurnEnd(false, newRevealed), RESOLVE_DELAY_MS);
    }
  } else if (n === 3) {
    const isTrio = newRevealed.every((r) => r.value === newRevealed[0].value);
    updates.turnPhase = "resolving";
    updates.resolving = true;
    await TrioDB.update(`games/${state.code}`, updates);
    setTimeout(() => resolveTurnEnd(isTrio, newRevealed), RESOLVE_DELAY_MS);
  }
}

async function resolveTurnEnd(trioCollected, revealed) {
  let game;
  try {
    game = await TrioDB.get(`games/${state.code}`);
  } catch {
    return;
  }
  if (!game || game.winner) return;
  const order = game.playerOrder || [];
  if (order[game.currentTurnIndex] !== state.uid) return;

  const players = JSON.parse(JSON.stringify(game.players || {}));
  let centerPile = (game.centerPile || []).slice();
  const updates = {};

  if (trioCollected) {
    const removeFrom = {};
    for (const r of revealed) {
      removeFrom[r.origin] = removeFrom[r.origin] || new Set();
      removeFrom[r.origin].add(r.originIndex);
    }
    for (const origin of Object.keys(removeFrom)) {
      const indices = removeFrom[origin];
      if (origin === "center") {
        // Preserve grid positions: mark removed slots as null instead of compacting.
        centerPile = centerPile.map((v, i) => indices.has(i) ? null : v);
      } else if (players[origin]) {
        players[origin].hand = (players[origin].hand || []).filter((_, i) => !indices.has(i));
      }
    }
    const value = revealed[0].value;
    players[state.uid].trios = (players[state.uid].trios || []).concat([value]);

    updates.players = players;
    updates.centerPile = centerPile;

    // Win check
    const myTrios = players[state.uid].trios;
    if (value === 7 || myTrios.length >= 3) {
      updates.winner = state.uid;
      updates.status = "finished";
      updates.finishedAt = Date.now();
    }
  }

  if (!updates.winner) {
    updates.currentTurnIndex = (game.currentTurnIndex + 1) % order.length;
    updates.turnPhase = "firstFlip";
  }
  updates.revealedThisTurn = [];
  updates.resolving = false;

  try {
    await TrioDB.update(`games/${state.code}`, updates);
  } catch (e) {
    console.warn("resolve update failed", e);
  }

  if (updates.winner && state.isHost) {
    const code = state.code;
    setTimeout(() => {
      TrioDB.remove(`games/${code}`).catch(() => {});
      TrioDB.remove(`codes/${code}`).catch(() => {});
    }, FINISHED_GRACE_MS);
  }
}

// ====================== WIN SCREEN ======================
function showWinScreen(game) {
  if (state.winShown) return;
  state.winShown = true;
  const winner = game.players[game.winner] || { name: "Someone" };
  const isMe = game.winner === state.uid;
  $("win-title").textContent = isMe ? "You win! 🎉" : `${winner.name} wins`;
  const reason = (winner.trios || []).includes(7)
    ? "Captured the trio of 7s ⚡"
    : "Collected 3 trios 🏆";
  $("win-reason").textContent = reason;
  $("win-overlay").classList.remove("hidden");
}
function hideWinScreen() {
  $("win-overlay").classList.add("hidden");
  state.winShown = false;
}

// ====================== LEAVE / CLEANUP ======================
function cleanupGameSubscription() {
  clearTimeout(state.skipTimer);
  state.skipTimer = null;
  if (state.unsubGame) {
    try { state.unsubGame(); } catch {}
    state.unsubGame = null;
  }
  // Cancel any host-lobby onDisconnect cleanup so it doesn't fire later.
  if (state.hostLobbyDisconnect) {
    const c = state.hostLobbyDisconnect;
    state.hostLobbyDisconnect = null;
    try { TrioDB.ref(`games/${c}`).onDisconnect().cancel(); } catch {}
    try { TrioDB.ref(`codes/${c}`).onDisconnect().cancel(); } catch {}
  }
  clearPresence();
  state.code = null;
  state.game = null;
  state.isHost = false;
  hideWinScreen();
}

async function leaveLobby() {
  const code = state.code;
  const game = state.game;
  cleanupGameSubscription();
  showScreen("screen-home");
  if (!code) return;
  try {
    if (game && game.status === "lobby") {
      if (game.host === state.uid) {
        await TrioDB.remove(`games/${code}`);
        await TrioDB.remove(`codes/${code}`).catch(() => {});
      } else {
        const order = (game.playerOrder || []).filter((u) => u !== state.uid);
        await TrioDB.update(`games/${code}`, {
          playerOrder: order,
          [`players/${state.uid}`]: null,
        });
      }
    } else if (game && game.status === "playing") {
      // Mark this player offline so others can skip their turn / continue.
      await TrioDB.update(`games/${code}/players/${state.uid}`, { online: false }).catch(() => {});
    } else if (game && game.status === "finished") {
      // Anyone can clean up a finished game (and free its code).
      await TrioDB.remove(`games/${code}`).catch(() => {});
      await TrioDB.remove(`codes/${code}`).catch(() => {});
    }
  } catch (e) {
    console.warn("leaveLobby cleanup failed", e);
  }
}

// Re-render game on viewport changes so the center pile re-fits.
let _resizeT = null;
window.addEventListener("resize", () => {
  if (!state.game) return;
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => state.game && onGameSnapshot(state.game), 80);
}, { passive: true });

// ====================== INIT ======================
showScreen("screen-home");
