// Wingpen background service worker.
//
// Owns the single WebSocket connection to the broker (ws://127.0.0.1:8787/ws,
// see docs/PROTOCOL.md). This file must never hold conversation state as its
// only copy: the service worker can be killed by the browser at any moment
// (idle timeout, MV3 lifecycle), so it only relays messages. The panel is
// responsible for persisting the conversation (chrome.storage.local).

const WS_URL = "ws://127.0.0.1:8787/ws";
const PROTOCOL_VERSION = 1;
const RECONNECT_ALARM = "wingpen-reconnect";
const MAX_BACKOFF_MS = 30000;
const HELLO_TIMEOUT_MS = 5000;

let ws = null;
let wsState = "disconnected"; // disconnected | connecting | handshaking | connected
let backoffMs = 1000;
let helloTimeoutId = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  connectIfNeeded();
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

  ws.addEventListener("error", () => {
    // The close event follows; nothing to do here besides letting it fire.
  });
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
