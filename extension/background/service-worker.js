// Wingpen background service worker.
//
// Owns the single WebSocket connection to the broker (ws://127.0.0.1:8787/ws,
// see docs/PROTOCOL.md). This file must never hold conversation state as its
// only copy: the service worker can be killed by the browser at any moment
// (idle timeout, MV3 lifecycle), so it only relays messages. The panel is
// responsible for persisting the conversation (chrome.storage.local).

// The broker's port is configurable server-side (config.json "port"), but
// manifest.json's "externally_connectable.matches" cannot take a dynamic
// value — Chrome only accepts a literal match pattern there. So this port is
// hardcoded in exactly two places, kept equal by convention: here, and
// manifest.json's "externally_connectable" entry. A broker running on a
// non-default port breaks one-click pairing; see docs/PROTOCOL.md.
const BROKER_PORT = 8787;
const WS_URL = `ws://127.0.0.1:${BROKER_PORT}/ws`;
// Prefix an external sender's URL must start with to be trusted by
// onMessageExternal below — checked in addition to (not instead of)
// manifest.json's "externally_connectable" match list.
const PAIR_ORIGIN_PREFIX = `http://127.0.0.1:${BROKER_PORT}/`;
const PROTOCOL_VERSION = 1;
const RECONNECT_ALARM = "wingpen-reconnect";
const MAX_BACKOFF_MS = 30000;
// Must stay below the broker's own handshake timeout (3000ms, server.ts:193-195)
// so the client — not the server closing the socket first — is the one to
// report "handshake timeout" as a distinct state.
const HELLO_TIMEOUT_MS = 2500;

// Key for the "act on selection" stash — see the context menu block below.
// chrome.storage.SESSION only: the stashed text is the user's private
// selection, so it must never touch chrome.storage.local (unencrypted disk,
// CLAUDE.md rule #1).
const PENDING_ACTION_KEY = "wingpen:pendingAction";

// Wingpen's four selection actions (docs/PROTOCOL.md, message "act"). Menu
// item id -> the broker action it maps to, the French label shown both in
// the context menu and later as the panel's own user-bubble label, and any
// fixed params the action needs (translate defaults to French, matching the
// rest of the UI).
const CONTEXT_MENU_ACTIONS = {
  "wingpen-rewrite": { action: "rewrite", label: "Reformuler" },
  "wingpen-shorten": { action: "shorten", label: "Raccourcir" },
  "wingpen-explain": { action: "explain", label: "Expliquer" },
  "wingpen-translate": { action: "translate", label: "Traduire", params: { targetLang: "fr" } },
};

let ws = null;
let wsState = "disconnected"; // disconnected | connecting | handshaking | connected
let backoffMs = 1000;
let helloTimeoutId = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  connectIfNeeded();
  setupContextMenus();
});

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "wingpen", title: "Wingpen", contexts: ["selection"] });
    for (const [id, entry] of Object.entries(CONTEXT_MENU_ACTIONS)) {
      chrome.contextMenus.create({ id, parentId: "wingpen", title: entry.label, contexts: ["selection"] });
    }
  });
}

// A right-click on a text selection, followed by picking one of our menu
// items, IS a real user gesture — the same kind a toolbar-icon click is —
// which is why chrome.sidePanel.open() is allowed to run here (it throws
// outside of a genuine gesture). The panel, however, may not exist yet (this
// is often the very first interaction). So the selection text is stashed in
// chrome.storage.session — a request "in flight" until a panel picks it up —
// and a broadcast is sent in case a panel is already open and listening.
// panel.js drains the stash both on its own load and on that broadcast,
// whichever comes first, and deletes it the moment it's read: two panels
// racing to read it is impossible in single-threaded JS, but a panel that
// died mid-read (drainPendingAction did not run yet) leaves a "read but
// still present" stash undamaged for the next attempt, so nothing is lost
// and a delivered action never fires twice.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const entry = CONTEXT_MENU_ACTIONS[info.menuItemId];
  if (!entry || !info.selectionText || !tab?.windowId) return;

  await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});

  await chrome.storage.session.set({
    [PENDING_ACTION_KEY]: {
      action: entry.action,
      label: entry.label,
      params: entry.params,
      selectionText: info.selectionText,
      url: tab.url,
      title: tab.title,
    },
  });
  broadcast({ type: "wingpen:pending-action" });
});

chrome.runtime.onStartup.addListener(() => {
  connectIfNeeded();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connectIfNeeded();
});

// Any message from a panel/options page wakes this worker up; take that
// opportunity to make sure the socket is alive.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "wingpen:panel-ready") {
    connectIfNeeded();
    sendResponse({ state: wsState });
    return undefined;
  }

  if (message.type === "wingpen:get-status") {
    sendResponse({ state: wsState });
    return undefined;
  }

  if (message.type === "wingpen:client-message") {
    sendToBroker(message.payload);
    return undefined;
  }

  return undefined;
});

// One-click pairing (docs/PROTOCOL.md "Appairage en un clic"): the broker's
// own /pair page, loaded in a normal tab, hands us the pairing token
// directly via chrome.runtime.sendMessage(EXTENSION_ID, …). This is the
// ONLY entry point that can write to chrome.storage.session from outside the
// extension, so it is checked twice — manifest.json's
// "externally_connectable.matches" (Chrome enforces this before we even see
// the message) AND explicitly here, because the matches list alone is a
// prefix a hostile page reachable via the same loopback port could also
// satisfy in principle (e.g. some other origin under 127.0.0.1 on the same
// port is not a thing today, but the explicit check costs nothing and does
// not rely solely on Chrome's manifest-level enforcement).
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!sender.url || !sender.url.startsWith(PAIR_ORIGIN_PREFIX)) {
    sendResponse({ ok: false, reason: "origin not allowed" });
    return undefined;
  }
  // A message from a normal tab always carries `sender.tab`; refuse anything
  // that doesn't (e.g. sent from another extension's background context).
  if (!sender.tab) {
    sendResponse({ ok: false, reason: "no sender tab" });
    return undefined;
  }
  if (!message || message.type !== "wingpen:pair") {
    sendResponse({ ok: false, reason: "unknown message type" });
    return undefined;
  }
  if (typeof message.token !== "string" || !message.token) {
    sendResponse({ ok: false, reason: "missing token" });
    return undefined;
  }

  (async () => {
    await chrome.storage.session.set({ pairingToken: message.token });
    forceReconnect();
    sendResponse({ ok: true });
  })();
  return true; // keep the message channel open for the async sendResponse above
});

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // No listener (panel/options closed) — fine, nothing to relay to.
  });
}

function setState(next) {
  wsState = next;
  broadcast({ type: "wingpen:status", state: wsState });
}

async function connectIfNeeded() {
  if (wsState === "connected" || wsState === "connecting" || wsState === "handshaking") return;
  if (ws) return;

  const { pairingToken } = await chrome.storage.session.get("pairingToken");
  if (!pairingToken) {
    setState("no-token");
    return;
  }

  setState("connecting");
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    ws = null;
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    setState("handshaking");
    ws.send(JSON.stringify({ type: "hello", secret: pairingToken, v: PROTOCOL_VERSION }));
    helloTimeoutId = setTimeout(() => {
      if (wsState !== "connected") {
        setState("handshake-timeout");
        ws?.close();
      }
    }, HELLO_TIMEOUT_MS);
  });

  ws.addEventListener("message", (event) => {
    handleBrokerMessage(event.data);
  });

  ws.addEventListener("close", (event) => {
    clearTimeout(helloTimeoutId);
    ws = null;
    setState("disconnected");
    broadcast({ type: "wingpen:closed", code: event.code, reason: event.reason });
    scheduleReconnect();
  });

  ws.addEventListener("error", (event) => {
    // The close event follows; nothing actionable here besides letting it fire,
    // but log it so a case where that assumption breaks isn't silently invisible.
    console.warn("wingpen: WebSocket error", { state: wsState, type: event?.type, event });
  });
}

// Called right after a fresh token lands via one-click pairing: any stale
// socket/backoff state from repeated failed attempts on the OLD (or absent)
// token must not delay the very next attempt.
function forceReconnect() {
  if (ws) {
    try {
      ws.close();
    } catch {
      // already closed/closing — fine.
    }
    ws = null;
  }
  backoffMs = 1000;
  setState("disconnected");
  connectIfNeeded();
}

function scheduleReconnect() {
  setTimeout(() => {
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    connectIfNeeded();
  }, backoffMs);
}

function handleBrokerMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === "hello-ok") {
    clearTimeout(helloTimeoutId);
    backoffMs = 1000;
    setState("connected");
    broadcast({ type: "wingpen:hello-ok", models: message.models, capabilities: message.capabilities });
    return;
  }

  // chunk / done / error / prompts — relayed as-is to the panel.
  broadcast({ type: "wingpen:broker-message", message });
}

function sendToBroker(payload) {
  if (!payload || wsState !== "connected" || !ws || ws.readyState !== WebSocket.OPEN) {
    broadcast({
      type: "wingpen:broker-message",
      message: {
        type: "error",
        id: payload?.id ?? "unknown",
        code: "internal",
        message: "Not connected to the broker.",
      },
    });
    connectIfNeeded();
    return;
  }
  ws.send(JSON.stringify(payload));
}
