// Wingpen options page — pairing token entry.
//
// The token is a secret: it MUST live in chrome.storage.session (wiped when
// the browser closes), never chrome.storage.local (unencrypted on disk).

const RETENTION_DAYS_KEY = "wingpen:retentionDays"; // number of days, or null for "jamais"
const DEFAULT_RETENTION_DAYS = 30;

// Fixed suggestions offered even when not yet granted (deliverable 4 —
// "Sites où Wingpen se reconnaît tout seul"). Any origin already granted is
// added on top of these when rendering, read fresh from
// chrome.permissions.getAll() every time — never a cached copy.
const SUGGESTED_HOST_PATTERNS = ["https://www.youtube.com/*"];

const els = {
  token: document.getElementById("token"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  statusLabel: document.querySelector("#status .status-label"),
  retention: document.getElementById("retention"),
  siteToggles: document.getElementById("siteToggles"),
  modelDisconnected: document.getElementById("modelDisconnected"),
  providerList: document.getElementById("providerList"),
  modelField: document.getElementById("modelField"),
  modelSelect: document.getElementById("modelSelect"),
  modelInput: document.getElementById("modelInput"),
  modelSave: document.getElementById("modelSave"),
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
  els.modelSelect.addEventListener("change", () => setProvider(undefined, els.modelSelect.value));
  els.modelSave.addEventListener("click", () => setProvider(undefined, els.modelInput.value.trim()));
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "wingpen:status") applyStatus(message.state);
    if (message?.type === "wingpen:hello-ok") {
      applyStatus("connected");
      requestSettings();
    }
    if (message?.type === "wingpen:closed") applyStatus("disconnected");
    if (message?.type === "wingpen:broker-message" && message.message?.type === "settings") {
      renderModelSection(message.message);
    }
  });

  const status = await chrome.runtime.sendMessage({ type: "wingpen:get-status" }).catch(() => null);
  applyStatus(status?.state ?? "unknown");
  if (status?.state === "connected") requestSettings();

  await renderSiteToggles();
  chrome.permissions.onAdded.addListener(renderSiteToggles);
  chrome.permissions.onRemoved.addListener(renderSiteToggles);
}

function newId() {
  return `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  if (state !== "connected") {
    // Never show a stale provider/model choice while we can't confirm it
    // against the broker — explain instead (deliverable 3's requirement).
    renderModelSection(null);
  }
}

// --- Model provider section (broker/src/providers/, docs/PROTOCOL.md
// "Fournisseur de modèle") ----------------------------------------------

function requestSettings() {
  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "settings.get", id: newId() },
  });
}

function setProvider(provider, model) {
  const payload = { type: "settings.set", id: newId() };
  if (provider !== undefined) payload.provider = provider;
  if (model !== undefined) payload.model = model;
  chrome.runtime.sendMessage({ type: "wingpen:client-message", payload });
}

/** Renders the provider radio list + model field from the broker's latest
 * `settings` message, or the "not connected" explainer when `settings` is
 * null. No innerHTML — every node built with createElement, per the
 * extension's CSP (no inline styles/handlers either; all of that lives in
 * options.css and addEventListener calls below). */
function renderModelSection(settings) {
  els.modelDisconnected.hidden = settings !== null;
  clearChildren(els.providerList);

  if (!settings) {
    els.modelField.hidden = true;
    return;
  }

  for (const provider of settings.available) {
    const item = document.createElement("li");
    item.className = "provider-item";

    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "provider";
    radio.value = provider.id;
    radio.checked = provider.id === settings.provider;
    radio.disabled = !provider.available;
    radio.addEventListener("change", () => {
      if (radio.checked) setProvider(provider.id, undefined);
    });

    const name = document.createElement("span");
    name.textContent = provider.label;

    label.appendChild(radio);
    label.appendChild(name);
    item.appendChild(label);

    if (!provider.available && provider.reason) {
      const reason = document.createElement("span");
      reason.className = "provider-reason";
      reason.textContent = `— indisponible : ${provider.reason}`;
      item.appendChild(reason);
    }

    els.providerList.appendChild(item);
  }

  renderModelField(settings);
}

function renderModelField(settings) {
  els.modelField.hidden = false;

  if (Array.isArray(settings.models) && settings.models.length > 0) {
    els.modelSelect.hidden = false;
    els.modelInput.hidden = true;
    els.modelSave.hidden = true;

    clearChildren(els.modelSelect);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choisir un modèle…";
    els.modelSelect.appendChild(placeholder);
    for (const name of settings.models) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      els.modelSelect.appendChild(option);
    }
    els.modelSelect.value = settings.model ?? "";
  } else {
    els.modelSelect.hidden = true;
    els.modelInput.hidden = false;
    els.modelSave.hidden = false;
    els.modelInput.value = settings.model ?? "";
  }
}

// --- Per-site activation (deliverable 4) -----------------------------------
//
// chrome.permissions.request() below is called directly from a checkbox
// "change" listener — a click in an extension page is a genuine user
// gesture, so this is allowed to run without going through activeTab or a
// content-script round trip.

function friendlyHostname(pattern) {
  try {
    return new URL(pattern.replace(/\*+$/, "")).hostname;
  } catch {
    return pattern;
  }
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function renderSiteToggles() {
  const granted = await chrome.permissions.getAll();
  const grantedOrigins = (granted.origins ?? []).filter(
    (origin) => origin.startsWith("http://") || origin.startsWith("https://"),
  );
  const patterns = [...new Set([...SUGGESTED_HOST_PATTERNS, ...grantedOrigins])];

  clearChildren(els.siteToggles);
  for (const pattern of patterns) {
    const item = document.createElement("li");
    item.className = "site-toggle";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = grantedOrigins.includes(pattern);
    checkbox.addEventListener("change", () => onSiteToggleChange(pattern, checkbox));

    const name = document.createElement("span");
    name.textContent = friendlyHostname(pattern);

    label.appendChild(checkbox);
    label.appendChild(name);
    item.appendChild(label);
    els.siteToggles.appendChild(item);
  }
}

async function onSiteToggleChange(pattern, checkbox) {
  checkbox.disabled = true;
  try {
    if (checkbox.checked) {
      const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
      if (!granted) checkbox.checked = false;
    } else {
      await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
    }
  } finally {
    // Re-render from chrome.permissions.getAll() rather than trusting the
    // request()/remove() return value alone — reflects the real state.
    await renderSiteToggles();
  }
}
