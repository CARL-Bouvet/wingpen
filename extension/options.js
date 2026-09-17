// Wingpen options page — pairing token entry.
//
// The token is a secret: it MUST live in chrome.storage.session (wiped when
// the browser closes), never chrome.storage.local (unencrypted on disk).

const els = {
  token: document.getElementById("token"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  statusLabel: document.querySelector("#status .status-label"),
};

init();

async function init() {
  const { pairingToken } = await chrome.storage.session.get("pairingToken");
  if (pairingToken) els.token.value = pairingToken;

  els.save.addEventListener("click", save);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "wingpen:status") applyStatus(message.state);
    if (message?.type === "wingpen:hello-ok") applyStatus("connected");
    if (message?.type === "wingpen:closed") applyStatus("disconnected");
  });

  const status = await chrome.runtime.sendMessage({ type: "wingpen:get-status" }).catch(() => null);
  applyStatus(status?.state ?? "unknown");
}

async function save() {
  const value = els.token.value.trim();
  await chrome.storage.session.set({ pairingToken: value });
  await chrome.runtime.sendMessage({ type: "wingpen:panel-ready" }).catch(() => null);
}

function applyStatus(state) {
  els.status.className = `status status--${state}`;
  const labels = {
    connected: "Connecté",
    connecting: "Connexion…",
    handshaking: "Connexion…",
    disconnected: "Déconnecté",
    "no-token": "Pas de jeton",
    unknown: "…",
  };
  els.statusLabel.textContent = labels[state] ?? state;
}
