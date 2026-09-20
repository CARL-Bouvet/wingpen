// Wingpen options page — pairing token entry.
//
// The token is a secret: it MUST live in chrome.storage.session (wiped when
// the browser closes), never chrome.storage.local (unencrypted on disk).

const RETENTION_DAYS_KEY = "wingpen:retentionDays"; // number of days, or null for "jamais"
const DEFAULT_RETENTION_DAYS = 30;

const els = {
  token: document.getElementById("token"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  statusLabel: document.querySelector("#status .status-label"),
  retention: document.getElementById("retention"),
};

init();

async function init() {
  const { pairingToken } = await chrome.storage.session.get("pairingToken");
  if (pairingToken) els.token.value = pairingToken;

  const data = await chrome.storage.local.get(RETENTION_DAYS_KEY);
  const stored = data[RETENTION_DAYS_KEY];
  const retentionDays = stored === null || typeof stored === "number" ? stored : DEFAULT_RETENTION_DAYS;
  els.retention.value = retentionDays === null ? "never" : String(retentionDays);

  els.save.addEventListener("click", save);
  els.retention.addEventListener("change", saveRetention);
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

async function saveRetention() {
  const raw = els.retention.value;
  const retentionDays = raw === "never" ? null : Number(raw);
  await chrome.storage.local.set({ [RETENTION_DAYS_KEY]: retentionDays });
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
