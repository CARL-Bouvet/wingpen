// Wingpen side panel — chat UI, streaming rendering, contextual summarize
// button, selection actions, prompt library. Plain JS, no framework, no
// bundler.
//
// Conversation state lives HERE (persisted to chrome.storage.local), never
// only in the background service worker's memory: the service worker can be
// killed and restarted at any time (see background/service-worker.js).
//
// --- Permission flow for the contextual main button (read before editing) --
//
// Rule (CLAUDE.md #5, "la règle du geste"): Wingpen never reads a page on its
// own. Concretely, for `chrome.scripting.executeScript` against page content:
//
//   - On a tab switch (`chrome.tabs.onActivated`) there is NO user gesture —
//     switching tabs is not "using Wingpen". So we NEVER inject there.
//     `redetectTabFromMetadata()` classifies from `tab.url`/`tab.title` alone
//     (via `classifyPageTypeFromMetadata()` in detect.js), which
//     `chrome.tabs.get` already returns for any origin we hold a host
//     permission for — no page read needed to get that far. Most page types
//     cannot be told apart from the URL alone (an article and a plain page
//     look the same), so this stays honestly "unknown" and the main button
//     keeps its generic "Résumer" label; only a recognisable shape like a
//     YouTube watch URL resolves to a real type here.
//   - Opening the panel IS a gesture (the user clicked the toolbar icon), and
//     it grants `activeTab` for whatever tab is active right now. `init()`
//     spends that grant immediately via `redetectTab()`: query the tab,
//     inject content/extract.js, classify with the fuller
//     `classifyPageType()`, and show the precise main-button label. This is
//     the one page read allowed without a click inside the panel itself.
//   - Past that, a page is only ever read again on an explicit gesture inside
//     the panel: a click on the main button (`summarize()`), the "Wingpen lit
//     cette page" toggle being ON at send time (`sendChat()`), or a
//     context-menu action on selected text. Each of those calls
//     `extractFromTab()` and, once real content came back, refines the type
//     and relabels the button via `applyDetectedContext()`.
//   - Chicken-and-egg: to offer "Activer Wingpen sur ce site" we need the
//      tab's *origin*, but on a tab switch we just said we won't read the
//      page to get it. So that affordance is now only offered as a side
//      effect of a gesture-driven extraction attempt: `extractFromTab()`
//      against a tab we lack permission for REJECTS with a message that
//      embeds the tab's URL (Chrome's own diagnostic text, e.g.
//      `Cannot access contents of url "https://…"`). We don't need a fresh
//      permission to read that error string — so a failed extraction on
//      panel load or on a main-button click is how we learn the origin to
//      offer. See NoAccessError below. A plain tab switch no longer triggers
//      this at all — one more page-read source removed, not just deferred.
//   - Once the user clicks "Activer Wingpen sur ce site", THAT click is a
//      genuine gesture, sufficient for `chrome.permissions.request`. If
//      granted, Chrome remembers it — nothing is cached here (no secrets in
//      chrome.storage, CLAUDE.md rule #1), and `chrome.scripting.executeScript`
//      simply starts working for that origin from then on, on every tab that
//      matches it, with no further gesture needed.

import { classifyPageType, classifyPageTypeFromMetadata } from "../content/detect.js";
import { applyRetention } from "./retention.js";
import { api, IS_GECKO } from "../lib/browser-compat.js";
import { parseTimestamps, getYouTubeVideoIdFromUrl } from "./timestamps.js";

// Must match extension/background/service-worker.js's BROKER_PORT — port is
// fixed (docs/PROTOCOL.md "Transport"), so this can't be derived from config
// at runtime. Firefox only (docs/PROTOCOL.md "Page /pair").
const BROKER_PORT = 8787;
const PAIR_URL = `http://127.0.0.1:${BROKER_PORT}/pair`;

const STORAGE_KEY = "wingpen:conversation";
const ATTACH_PAGE_KEY = "wingpen:attachPage";
const PENDING_ACTION_KEY = "wingpen:pendingAction";
const RETENTION_DAYS_KEY = "wingpen:retentionDays"; // number of days, or null for "jamais" — set from the options page
const DEFAULT_RETENTION_DAYS = 30;
const MAX_PERSISTED_MESSAGES = 200;

// Client-side deadline for an in-flight request (deliverable B1). Set just
// PAST the broker's own 120s model timeout (broker/src/model.ts,
// MODEL_TIMEOUT_MS) so, when the broker's specific "model-unavailable" error
// can still reach us, it wins the race and this generic deadline never fires.
// It only fires for the case the broker's own timeout can't cover: the
// answer that never arrives at all (socket dropped mid-request).
const REQUEST_DEADLINE_MS = 130_000;
// How often the panel checks that the service worker instance which
// accepted the current request is still the same one (deliverable B4).
const WORKER_HEARTBEAT_MS = 5_000;

const MAIN_BUTTON_LABELS = {
  video: "Résumer cette vidéo",
  article: "Résumer cet article",
  page: "Résumer cette page",
};

// Fixed file list for the code fingerprint (deliverable C1) — order and
// paths MUST stay identical to scripts/stamp.sh's FILES array, or the two
// hashes computed independently (one from what the browser actually loaded,
// one from disk) stop being comparable, defeating the whole point.
const FINGERPRINT_FILES = [
  "background/service-worker.js",
  "content/detect.js",
  "content/extract.js",
  "lib/browser-compat.js",
  "manifest.json",
  "options.css",
  "options.html",
  "options.js",
  "panel/panel.css",
  "panel/panel.html",
  "panel/panel.js",
  "panel/retention.js",
  "panel/timestamps.js",
];

const els = {
  status: document.getElementById("status"),
  statusLabel: document.querySelector("#status .status-label"),
  connectionBanner: document.getElementById("connectionBanner"),
  connectionBannerText: document.getElementById("connectionBannerText"),
  connectWingpen: document.getElementById("connectWingpen"),
  openOptions: document.getElementById("openOptions"),
  mainAction: document.getElementById("mainAction"),
  activateSite: document.getElementById("activateSite"),
  promptSelect: document.getElementById("promptSelect"),
  savePrompt: document.getElementById("savePrompt"),
  messages: document.getElementById("messages"),
  attachPage: document.getElementById("attachPage"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  cancel: document.getElementById("cancel"),
  eraseConversation: document.getElementById("eraseConversation"),
  buildInfo: document.getElementById("buildInfo"),
};

/** @type {Array<{id: string, role: 'user'|'assistant'|'system', text: string}>} */
let conversation = [];
let activeRequestId = null;
let prompts = [];

// Replay payloads for the "J'ai relancé, réessayer" recovery button
// (deliverable D1) — keyed by request id, in-memory only (never persisted to
// chrome.storage.local: it can hold page content, same reasoning as why
// context.url is kept out of the conversation elsewhere in this file). Only
// kept for a request that ended in "auth-required": any other terminal
// outcome drops its entry, so this never grows unbounded over a long session.
const pendingRetries = new Map();

// Request-watch state (deliverables B1 + B4) — armed by startRequestWatch()
// right after a request is sent, disarmed by clearRequestWatch() whenever
// setStreamingUi(false) runs (done/error/cancel/disconnect all funnel there).
let requestDeadlineTimer = null;
let requestHeartbeatTimer = null;
let requestWorkerInstanceId = null; // service worker instance that accepted the current request, or null

// Page detection state (deliverable 1) — see the comment block above.
let currentTabId = null;
let pageType = null; // "video" | "article" | "page" | null (unknown)
let knownOrigin = null; // origin string once learned (granted, or from a failed-extraction error), or null

// "Wingpen lit cette page" toggle (deliverable 3). null = no stored
// preference yet, so default to true once a page type is known.
let attachPagePreference = null;

// Erase-button two-step confirm state (no window.confirm — see the comment
// above wireEraseButton()).
let eraseConfirmPending = false;
let eraseConfirmTimer = null;

/** Thrown by extractFromTab when Chrome refuses the injection for lack of
 * permission. Carries the origin mined out of Chrome's own error message —
 * see the comment block at the top of this file, point 3. */
class NoAccessError extends Error {
  constructor(origin) {
    super(`no permission for ${origin}`);
    this.name = "NoAccessError";
    this.origin = origin;
  }
}

init();

async function init() {
  conversation = await loadConversation();
  renderAll();

  els.openOptions.addEventListener("click", () => api.runtime.openOptionsPage());
  els.connectWingpen.addEventListener("click", () => api.tabs.create({ url: PAIR_URL }));
  els.mainAction.addEventListener("click", () => summarize());
  els.activateSite.addEventListener("click", activateOnThisSite);
  els.send.addEventListener("click", sendChat);
  els.cancel.addEventListener("click", cancelActive);
  els.promptSelect.addEventListener("change", onPromptSelected);
  els.savePrompt.addEventListener("click", saveCurrentAsPrompt);
  els.eraseConversation.addEventListener("click", onEraseClick);
  els.attachPage.addEventListener("change", () => {
    attachPagePreference = els.attachPage.checked;
    persistConversation();
  });
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });

  api.runtime.onMessage.addListener(onRuntimeMessage);
  api.tabs.onActivated.addListener(({ tabId }) => {
    currentTabId = tabId;
    redetectTabFromMetadata(tabId);
  });

  const status = await api.runtime.sendMessage({ type: "wingpen:panel-ready" }).catch(() => null);
  applyStatus(status?.state ?? "unknown");
  requestPrompts();

  try {
    currentTabId = await activeTabId();
    // Reading the page on panel load is legitimate when the panel is loading
    // BECAUSE the user just clicked the icon. It is not when the browser
    // restored a panel left open from the previous session: that would be a
    // page read with nobody asking, which rule 5 forbids. Chrome gives us no
    // signal on the panel side, so the service worker stamps the browser's
    // startup and we stay on metadata-only classification for a few seconds
    // after it. Cost of the fallback: on an article the main button reads
    // "Résumer" instead of "Résumer cet article" until the first click.
    if (await openedFromGesture()) {
      await redetectTab(currentTabId);
    } else {
      await redetectTabFromMetadata(currentTabId);
    }
  } catch {
    currentTabId = null;
    updateMainButton();
    updateAttachToggle();
  }

  await drainPendingAction();
  await showBuildInfo();
}

// --- Build fingerprint (deliverable C1) ------------------------------------
//
// Twice in one day, testing continued against a stale unpacked build with
// nothing on screen to reveal it. This computes a hash of the code the
// browser ACTUALLY loaded (fetched at runtime via chrome.runtime.getURL, not
// read from disk) so a mismatch with `scripts/stamp.sh`'s output — run
// against the files on disk — is visible in one glance, no devtools needed.

async function showBuildInfo() {
  els.buildInfo.textContent = "";
  const version = api.runtime.getManifest().version;
  const fingerprint = await computeCodeFingerprint().catch(() => null);
  els.buildInfo.textContent = fingerprint ? `v${version} · ${fingerprint}` : `v${version} · empreinte indisponible`;
}

async function computeCodeFingerprint() {
  const buffers = await Promise.all(
    FINGERPRINT_FILES.map((path) => fetch(api.runtime.getURL(path)).then((res) => res.arrayBuffer())),
  );
  let totalLength = 0;
  for (const buf of buffers) totalLength += buf.byteLength;
  const concatenated = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    concatenated.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", concatenated);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 7);
}

function onRuntimeMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "wingpen:status") {
    applyStatus(message.state);
    if (message.state === "connected") requestPrompts();
    return;
  }

  if (message.type === "wingpen:hello-ok") {
    applyStatus("connected");
    requestPrompts();
    return;
  }

  if (message.type === "wingpen:closed") {
    applyStatus("disconnected");
    return;
  }

  if (message.type === "wingpen:pending-action") {
    drainPendingAction();
    return;
  }

  if (message.type === "wingpen:broker-message") {
    handleBrokerMessage(message.message);
  }
}

function handleBrokerMessage(message) {
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "chunk": {
      const msg = conversation.find((m) => m.id === message.id);
      if (msg) {
        msg.text += message.delta ?? "";
        renderMessage(msg);
      }
      break;
    }
    case "done": {
      pendingRetries.delete(message.id);
      const msg = conversation.find((m) => m.id === message.id);
      if (msg) {
        msg.streaming = false;
        renderMessage(msg);
      }
      if (activeRequestId === message.id) setStreamingUi(false);
      persistConversation();
      break;
    }
    case "error": {
      // docs/PROTOCOL.md "Disponibilité du fournisseur": an older broker that
      // doesn't know provider.status answers some generic error for this id
      // instead of provider.status-result — show nothing for it, per spec.
      if (message.id === providerStatusRequestId) {
        providerStatusRequestId = null;
        break;
      }
      const text = describeBrokerError(message);
      const authRequired = message.code === "auth-required";
      if (!authRequired) pendingRetries.delete(message.id);
      // Clear activeRequestId BEFORE rendering: buildAuthRecoveryBlock()
      // reads it to decide whether the retry button starts enabled, and
      // this terminal error is exactly what should free it up again.
      if (activeRequestId === message.id) setStreamingUi(false);
      const msg = conversation.find((m) => m.id === message.id);
      if (msg) {
        msg.streaming = false;
        msg.text = msg.text || text;
        msg.authRequired = authRequired;
        renderMessage(msg);
      } else {
        addMessage({ id: message.id, role: "system", text, authRequired });
      }
      persistConversation();
      break;
    }
    case "prompts": {
      prompts = Array.isArray(message.items) ? message.items : [];
      renderPromptOptions();
      break;
    }
    case "provider.status-result": {
      if (message.id !== providerStatusRequestId) break; // stale/unrelated — ignore
      providerStatusRequestId = null;
      providerStatusSuffix = formatProviderStatus(message);
      renderStatusLabel();
      break;
    }
    default:
      break;
  }
}

/** Maps a terminal broker `error` to a French message that names its own
 * remedy (deliverable B5, third banner: "broker reachable but the model
 * failed"). The other two B5 causes — broker unreachable, no pairing token —
 * are connection-level states handled separately by applyConnectionBanner();
 * this one is per-request, so it renders inline in the conversation like any
 * other error, not as a banner. */
function describeBrokerError(message) {
  // docs/PROTOCOL.md "Limites côté broker" — the broker sends this fixed id,
  // then closes the connection with code 1009; the normal reconnect flow
  // (backoff/alarm) takes over from there, same as any other drop.
  if (message.id === "oversized") {
    return "⚠ Le message envoyé dépassait la taille maximale acceptée par le broker (256 Ko) ; la connexion a été fermée. Réessayez avec un contenu plus court.";
  }
  switch (message.code) {
    case "model-unavailable":
      // Covers both the broker's own 120s model-call timeout and a model
      // that can't be reached at all (broker/src/model.ts, MODEL_TIMEOUT_MS)
      // — the broker itself is fine, the model is the problem.
      return `⚠ Le modèle ne répond pas (${message.message || "indisponible"}). Le broker fonctionne normalement ; c'est le modèle qui pose problème. Réessayez dans un instant.`;
    case "auth-required":
      // The actionable part (copy `claude /login`, "J'ai relancé,
      // réessayer") is rendered separately by renderMessage() via
      // msg.authRequired — see buildAuthRecoveryBlock() below.
      return "⚠ La session Claude a expiré.";
    case "cancelled":
      return "Requête annulée.";
    case "context-too-large":
      return "⚠ Le contenu envoyé est trop volumineux pour le modèle.";
    case "bad-request":
      return `⚠ Requête invalide : ${message.message || message.code}.`;
    default:
      return `⚠ ${message.message || message.code}`;
  }
}

// Current connection state, kept so a later provider.status-result (which
// arrives asynchronously) can be folded into the status line without
// recomputing/duplicating the connection label above it.
let currentConnState = "unknown";
// Short factual French text from the last provider.status-result, or "" when
// there is nothing to add (state "ok", or no check done yet this panel
// session) — see maybeRequestProviderStatus()/renderStatusLabel() below.
let providerStatusSuffix = "";

function applyStatus(state) {
  // A dropped connection must not leave the panel permanently locked: any
  // in-flight request will never get its "done"/"error" reply now.
  if ((state === "disconnected" || state === "no-token") && activeRequestId) {
    setStreamingUi(false);
  }

  currentConnState = state;
  if (state !== "connected") providerStatusSuffix = ""; // stale once disconnected
  els.status.className = `status status--${state}`;
  renderStatusLabel();
  applyConnectionBanner(state);
  if (state === "connected") maybeRequestProviderStatus();
}

function renderStatusLabel() {
  const labels = {
    connected: "Connecté",
    connecting: "Connexion…",
    handshaking: "Connexion…",
    disconnected: "Déconnecté",
    "no-token": "Pas de jeton — voir réglages",
    unknown: "…",
  };
  let text = labels[currentConnState] ?? currentConnState;
  if (currentConnState === "connected" && providerStatusSuffix) text += ` · ${providerStatusSuffix}`;
  els.statusLabel.textContent = text;
}

// Two states must never be confused (see the design brief for this feature):
// "no-token" means the extension has never been paired (or the browser was
// restarted and chrome.storage.session was wiped, see CLAUDE.md rule #1) —
// the fix differs by browser (see below). "disconnected" means we DO hold a
// token but the broker itself isn't answering right now — the fix is
// starting the broker. The options page's paste field remains the fallback
// for both; see options.js.
function applyConnectionBanner(state) {
  if (state === "no-token") {
    if (IS_GECKO) {
      // docs/PROTOCOL.md "Appairage silencieux", "Bandeau no-token" — Firefox
      // uuid is never known in advance; the fix is the manual /pair copy.
      els.connectionBannerText.textContent =
        "Wingpen n'est pas encore appairé à ce broker. Ouvrez la page /pair pour copier le code, puis collez-le dans les réglages de l'extension (icône ⚙).";
      els.connectWingpen.hidden = false;
    } else {
      // Chromium: an unknown id is refused before any secret is even read —
      // there is no /pair path for it (docs/PROTOCOL.md "Chemin un clic
      // retiré"). The only fix is adding this id broker-side.
      els.connectionBannerText.textContent =
        `L'identifiant de cette extension (${api.runtime.id}) n'est pas connu du broker. Ajoutez-le à allowedExtensionIds puis redémarrez le broker.`;
      els.connectWingpen.hidden = true;
    }
    els.connectionBanner.hidden = false;
    return;
  }
  if (state === "disconnected") {
    els.connectionBannerText.textContent =
      "Le broker Wingpen ne répond pas. Lancez-le sur votre machine (voir le README), puis réessayez.";
    els.connectWingpen.hidden = true;
    els.connectionBanner.hidden = false;
    return;
  }
  els.connectionBanner.hidden = true;
}

// --- Disponibilité du fournisseur (docs/PROTOCOL.md "provider.status") ----
//
// Sent once per panel open, on a user gesture (opening the panel), the first
// time this panel reaches "connected" — never from the service worker, never
// on a timer, never again for the lifetime of this panel instance.

let providerStatusRequested = false;
let providerStatusRequestId = null;

function maybeRequestProviderStatus() {
  if (providerStatusRequested) return;
  providerStatusRequested = true;
  const id = newId();
  providerStatusRequestId = id;
  api.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "provider.status", id },
  });
}

// Reason codes are a closed, stable, English list read by this code only
// (docs/PROTOCOL.md "Disponibilité du fournisseur") — never shown as-is.
// `state: "ok"` is shown too: the point of the check is that the user sees,
// before any click, whether the model will answer (goal 2026-09-25, Q5).
const PROVIDER_LABEL = {
  "claude-cli": "Claude (abonnement)",
  "claude-api": "Claude (clé API)",
  "ollama": "Ollama",
};

const PROVIDER_STATUS_REASON_TEXT = {
  "ready": "prêt",
  "logged-in": "session ouverte",
  "no-key": "aucune clé API enregistrée",
  "key-unverified": "clé API enregistrée, non vérifiée",
  "cli-missing": "exécutable claude introuvable",
  "not-logged-in": "session Claude Code non authentifiée",
  "probe-failed": "état indéterminé",
  "ollama-unreachable": "Ollama ne répond pas",
  "model-missing": "modèle configuré absent d'Ollama",
  "no-model-installed": "aucun modèle installé dans Ollama",
};

function formatProviderStatus(message) {
  const label = PROVIDER_LABEL[message.provider] ?? "Modèle";
  const reasonText =
    PROVIDER_STATUS_REASON_TEXT[message.reason] ?? (message.state === "ok" ? "prêt" : "état inconnu");
  return `${label} : ${reasonText}`;
}

// --- Chat ---------------------------------------------------------------

async function sendChat() {
  const text = els.input.value.trim();
  if (!text || activeRequestId) return;

  // Extract at send time only — never on every keystroke.
  const attach = !els.attachPage.disabled && els.attachPage.checked && currentTabId != null;
  let context;
  if (attach) {
    // Never send the question alone when the user asked for the page to be
    // attached: a blind answer looks like a working feature and wastes a turn.
    try {
      context = await extractFromTab(currentTabId);
    } catch (err) {
      if (err instanceof NoAccessError) {
        knownOrigin = err.origin;
        showActivateAffordance(err.origin);
        addMessage({
          id: newId(),
          role: "system",
          text: "⚠ Wingpen n'a pas accès à cette page, la question n'a pas été envoyée. Cliquez sur « Activer Wingpen sur ce site » ci-dessus, ou décochez « Wingpen lit cette page » pour poser une question générale.",
        });
      } else if (looksLikeAccessDenied(err)) {
        addMessage({
          id: newId(),
          role: "system",
          text: "⚠ Wingpen n'a pas accès à cette page, la question n'a pas été envoyée. Cliquez sur l'icône Wingpen dans la barre d'outils pour l'autoriser sur cet onglet.",
        });
      } else {
        addMessage({
          id: newId(),
          role: "system",
          text: `⚠ Lecture de la page impossible, la question n'a pas été envoyée : ${err.message}`,
        });
      }
      return;
    }
  }

  const id = newId();
  const note = context ? "\n\n*avec le contenu de la page*" : "";
  addMessage({ id: `${id}-u`, role: "user", text: `${text}${note}` });
  addMessage({ id, role: "assistant", text: "", streaming: true });
  els.input.value = "";

  activeRequestId = id;
  setStreamingUi(true);
  persistConversation();

  pendingRetries.set(id, { type: "chat", text, context });
  const ack = await api.runtime
    .sendMessage({ type: "wingpen:client-message", payload: { type: "chat", id, text, context } })
    .catch(() => null);
  startRequestWatch(id, ack?.workerInstanceId ?? null);
}

// Cancelling clears the in-flight state right away rather than waiting on the
// broker's "error"/cancelled reply (deliverable B1): that reply is exactly
// what might never arrive if we're cancelling because the connection is
// stuck. The protocol does define a "cancel" message (docs/PROTOCOL.md), so
// it is still sent best-effort in case the broker is in fact listening.
function cancelActive() {
  if (!activeRequestId) return;
  const id = activeRequestId;
  pendingRetries.delete(id);
  api.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "cancel", id: newId(), target: id },
  });
  const msg = conversation.find((m) => m.id === id);
  if (msg) {
    msg.streaming = false;
    if (!msg.text) msg.text = "Requête annulée.";
    renderMessage(msg);
  }
  setStreamingUi(false);
  persistConversation();
}

// --- Erase conversation (deliverable "historique — effacement") -----------
//
// `window.confirm()` is unreliable in extension surfaces (it is outright
// blocked in MV3 popups, and Chrome's side panel behavior is not documented
// as supported either) — so confirmation is inline, in the panel itself: a
// first click turns the button into "Confirmer l'effacement ?", a second
// click within 4 s actually erases. A human must click twice in the real
// side panel to verify this reads clearly; that click cannot be simulated
// here.
function onEraseClick() {
  if (!eraseConfirmPending) {
    eraseConfirmPending = true;
    els.eraseConversation.textContent = "Confirmer l'effacement ?";
    els.eraseConversation.classList.add("link-button--confirm");
    eraseConfirmTimer = setTimeout(resetEraseButton, 4000);
    return;
  }
  resetEraseButton();
  eraseConversation();
}

function resetEraseButton() {
  eraseConfirmPending = false;
  clearTimeout(eraseConfirmTimer);
  eraseConfirmTimer = null;
  els.eraseConversation.textContent = "Effacer la conversation";
  els.eraseConversation.classList.remove("link-button--confirm");
}

async function eraseConversation() {
  // Cancel any in-flight request first — its "chunk"/"done" replies must not
  // repopulate the conversation we are about to wipe.
  cancelActive();
  activeRequestId = null;
  setStreamingUi(false);

  conversation = [];
  pendingRetries.clear();
  await api.storage.local.remove(STORAGE_KEY);
  persistConversation();
  renderAll();
}

// --- Auth recovery (deliverable D1) ---------------------------------------
//
// The broker's `auth-required` error (docs/PROTOCOL.md, "Fournisseur de
// modèle") means the local `claude` CLI session expired. We deliberately do
// NOT relay or drive the interactive `claude /login` flow (that decision is
// final, see the task brief) — the panel only makes the manual fix as cheap
// as possible: the exact command to copy, and a button that replays the
// request that just failed once the user says they ran it.

/** Builds the actionable block appended under an assistant/system message
 * whose terminal error was `auth-required`. No innerHTML — real DOM nodes,
 * same discipline as linkifyTimestamps() above. */
function buildAuthRecoveryBlock(msg) {
  const block = document.createElement("div");
  block.className = "recovery-block";

  const commandRow = document.createElement("div");
  commandRow.className = "recovery-command";
  const code = document.createElement("code");
  code.textContent = "claude /login";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "recovery-copy";
  copyBtn.textContent = "Copier";
  copyBtn.addEventListener("click", () => copyLoginCommand(copyBtn));
  commandRow.appendChild(code);
  commandRow.appendChild(copyBtn);
  block.appendChild(commandRow);

  // Only offered when we still hold the payload to replay — lost across a
  // panel reload (pendingRetries is in-memory only), in which case the copy
  // button above remains the fallback: rerun the question by hand.
  if (pendingRetries.has(msg.id)) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "recovery-retry";
    retryBtn.textContent = "J'ai relancé, réessayer";
    retryBtn.disabled = !!activeRequestId;
    retryBtn.addEventListener("click", () => retryRequest(msg));
    block.appendChild(retryBtn);
  }

  return block;
}

async function copyLoginCommand(button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText("claude /login");
    button.textContent = "Copié !";
  } catch {
    button.textContent = "Échec de la copie";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

/** Replays the request that ended in `auth-required`, reusing its own id —
 * by the time this can be clicked that id already reached a terminal state,
 * so the broker/service-worker no longer track anything under it. Sending it
 * again goes through the exact same path (sendToBroker's one-slot pending
 * queue, panel.js's 130s request-watch deadline) as any first-time request —
 * no separate replay machinery (task brief, D1). */
async function retryRequest(msg) {
  if (activeRequestId) return;
  const payload = pendingRetries.get(msg.id);
  if (!payload) return;

  msg.authRequired = false;
  msg.text = "";
  msg.streaming = true;
  renderMessage(msg);

  activeRequestId = msg.id;
  setStreamingUi(true);
  persistConversation();

  const ack = await api.runtime
    .sendMessage({ type: "wingpen:client-message", payload: { ...payload, id: msg.id } })
    .catch(() => null);
  startRequestWatch(msg.id, ack?.workerInstanceId ?? null);
}

function setStreamingUi(streaming) {
  els.send.disabled = streaming;
  els.mainAction.disabled = streaming;
  els.cancel.hidden = !streaming;
  if (!streaming) {
    activeRequestId = null;
    clearRequestWatch();
  }
}

// --- Request watch (deliverables B1 + B4) ---------------------------------
//
// Armed right after a request is sent to the background, disarmed the moment
// streaming stops for any reason (done, error, cancel, or a disconnect — see
// setStreamingUi). Two independent guards run in parallel:
//   - a deadline, just past the broker's own 120s model timeout, for the
//     case where no reply — not even the broker's own error — ever arrives;
//   - a heartbeat that notices the service worker instance changed under us,
//     which means it was killed by the MV3 lifecycle mid-request and nothing
//     is coming for this id no matter how long we wait.

function startRequestWatch(id, workerInstanceId) {
  clearRequestWatch();
  requestWorkerInstanceId = workerInstanceId;
  requestDeadlineTimer = setTimeout(() => onRequestDeadline(id), REQUEST_DEADLINE_MS);
  requestHeartbeatTimer = setInterval(() => checkWorkerAlive(id), WORKER_HEARTBEAT_MS);
}

function clearRequestWatch() {
  clearTimeout(requestDeadlineTimer);
  clearInterval(requestHeartbeatTimer);
  requestDeadlineTimer = null;
  requestHeartbeatTimer = null;
  requestWorkerInstanceId = null;
}

async function checkWorkerAlive(id) {
  if (activeRequestId !== id) return;
  const status = await api.runtime.sendMessage({ type: "wingpen:get-status" }).catch(() => null);
  if (!status || activeRequestId !== id) return;
  if (
    requestWorkerInstanceId &&
    status.workerInstanceId &&
    status.workerInstanceId !== requestWorkerInstanceId
  ) {
    failActiveRequest(id, "La requête a été interrompue (le service en arrière-plan a redémarré), relancez-la.");
  }
}

function onRequestDeadline(id) {
  if (activeRequestId !== id) return;
  failActiveRequest(id, "Aucune réponse après 130 s. Le broker ne répond pas ; vérifiez qu'il tourne, puis réessayez.");
}

function failActiveRequest(id, text) {
  const msg = conversation.find((m) => m.id === id);
  if (msg) {
    msg.streaming = false;
    if (!msg.text) msg.text = `⚠ ${text}`;
    renderMessage(msg);
  } else {
    addMessage({ id: newId(), role: "system", text: `⚠ ${text}` });
  }
  if (activeRequestId === id) setStreamingUi(false);
  persistConversation();
}

// --- Page detection (deliverable 1) --------------------------------------

function updateMainButton() {
  els.mainAction.textContent = MAIN_BUTTON_LABELS[pageType] ?? "Résumer";
}

function updateAttachToggle() {
  // Gated on "do we have a tab to read", not on whether its type is already
  // known — real extraction always happens at send time (a gesture), even
  // when redetectTabFromMetadata() left the type unknown.
  const available = currentTabId != null;
  els.attachPage.disabled = !available;
  els.attachPage.checked = available && (attachPagePreference ?? true);
}

function showActivateAffordance(origin) {
  els.activateSite.hidden = false;
  els.activateSite.title = origin;
}

function hideActivateAffordance() {
  els.activateSite.hidden = true;
  els.activateSite.removeAttribute("title");
}

function resetPageState() {
  pageType = null;
  updateMainButton();
  updateAttachToggle();
}

function classifyForContext(context) {
  return classifyPageType({
    url: context.url,
    title: context.title,
    textLength: (context.text || "").length,
    hasTranscript: context.kind === "youtube" && !context.needsTranscript && !!context.text,
    hasVideoElement: !!context.hasVideoElement,
    hasArticleMarkup: !!context.hasArticleMarkup,
  });
}

function applyDetectedContext(context) {
  try {
    knownOrigin = new URL(context.url).origin;
  } catch {
    knownOrigin = null;
  }
  pageType = classifyForContext(context);
  updateMainButton();
  updateAttachToggle();
  hideActivateAffordance();
}

/** Re-runs detection for `tabId`. Never throws — degrades to the generic
 * state (and, when possible, the "activer sur ce site" affordance) instead. */
/** How long after the browser starts a loading panel is assumed to be a
 * restored one rather than a freshly clicked one. Chrome restores side panels
 * within a second or two of startup; ten seconds covers a cold machine without
 * swallowing a deliberate click, which realistically comes later than that. */
const RESTORE_WINDOW_MS = 10_000;

/** False when this panel is most likely one the browser restored at startup.
 * Fails closed: any error reading the stamp means we do NOT read the page. */
async function openedFromGesture() {
  try {
    const { browserStartedAt } = await api.storage.session.get("browserStartedAt");
    if (typeof browserStartedAt !== "number") return true;
    return Date.now() - browserStartedAt > RESTORE_WINDOW_MS;
  } catch {
    return false;
  }
}

async function redetectTab(tabId) {
  try {
    const context = await extractFromTab(tabId);
    applyDetectedContext(context);
  } catch (err) {
    resetPageState();
    if (err instanceof NoAccessError) {
      knownOrigin = err.origin;
      const pattern = `${err.origin}/*`;
      const alreadyGranted = await api.permissions.contains({ origins: [pattern] }).catch(() => false);
      // If we already hold this permission, extraction failed for some other
      // reason (a chrome:// page, a PDF viewer…) — nothing to "activate".
      if (!alreadyGranted) showActivateAffordance(err.origin);
    } else {
      knownOrigin = null;
    }
  }
}

/** Tab-switch handler — never reads the page (see the comment block at the
 * top of this file). Classifies from `tab.url`/`tab.title` only, which
 * `chrome.tabs.get` returns without injecting anything as long as we hold a
 * host permission for that tab's origin. Leaves the type "unknown" (and the
 * main button generic) whenever the URL shape alone can't tell — that is the
 * honest answer, not a bug. */
async function redetectTabFromMetadata(tabId) {
  let tab;
  try {
    tab = await api.tabs.get(tabId);
  } catch {
    tab = null;
  }

  resetPageState();
  knownOrigin = null;
  if (!tab || !tab.url) return; // no permission for this origin: nothing legible

  try {
    knownOrigin = new URL(tab.url).origin;
  } catch {
    knownOrigin = null;
  }
  pageType = classifyPageTypeFromMetadata({ url: tab.url, title: tab.title });
  updateMainButton();
  updateAttachToggle();
  hideActivateAffordance();
}

async function activateOnThisSite() {
  if (!knownOrigin) return;
  const pattern = `${knownOrigin}/*`;
  const granted = await api.permissions.request({ origins: [pattern] }).catch(() => false);
  if (!granted) return;
  hideActivateAffordance();
  if (currentTabId != null) await redetectTab(currentTabId);
}

// --- Summarize ------------------------------------------------------------

async function summarize() {
  if (activeRequestId) return;
  activeRequestId = "pending"; // in-flight guard until the real id is known below; also drives the disabled buttons
  setStreamingUi(true);

  if (currentTabId == null) {
    addMessage({ id: newId(), role: "system", text: "⚠ Aucun onglet actif à lire." });
    setStreamingUi(false);
    return;
  }

  let context;
  try {
    context = await extractFromTab(currentTabId);
  } catch (err) {
    if (err instanceof NoAccessError) {
      knownOrigin = err.origin;
      showActivateAffordance(err.origin);
      addMessage({
        id: newId(),
        role: "system",
        text: "⚠ Wingpen n'a pas encore accès à cette page. Cliquez sur « Activer Wingpen sur ce site » ci-dessus.",
      });
    } else if (looksLikeAccessDenied(err)) {
      // Access refused but the origin could not be mined from the message.
      // Clicking the toolbar icon re-grants activeTab for the current tab.
      addMessage({
        id: newId(),
        role: "system",
        text: "⚠ Wingpen n'a pas accès à cette page. Cliquez sur l'icône Wingpen dans la barre d'outils pour l'autoriser sur cet onglet.",
      });
    } else {
      addMessage({ id: newId(), role: "system", text: `⚠ Impossible de lire la page : ${err.message}` });
    }
    setStreamingUi(false);
    return;
  }

  applyDetectedContext(context);

  // YouTube charge sa transcription en différé. On ouvre le panneau une fois —
  // exception nommée à la règle du geste — puis on relit. Sans transcription il
  // n'y aurait que la description et les commentaires à résumer, ce qui
  // produirait une réponse plausible et fausse.
  if (context.needsTranscript) {
    const opened = await openYouTubeTranscript(currentTabId).catch(() => false);
    if (opened) context = await extractFromTab(currentTabId).catch(() => context);
  }

  if (context.needsTranscript) {
    // Message factuel, sans qualification juridique : soit YouTube a changé sa
    // page, soit la vidéo n'a pas de sous-titres. C'est aussi le signal de
    // rupture prévu par T19.
    addMessage({
      id: newId(),
      role: "system",
      text:
        "La transcription n'a pas pu être lue. Sous la vidéo : « … » → « Afficher la transcription », " +
        "puis relancez le résumé. Si le bouton est absent, la vidéo n'a pas de sous-titres.",
    });
    setStreamingUi(false);
    return;
  }

  if (!context.text || context.text.trim().length < 40) {
    addMessage({
      id: newId(),
      role: "system",
      text: "⚠ Rien de lisible n'a été trouvé sur cette page. Contenu chargé après coup, ou réservé aux abonnés ?",
    });
    setStreamingUi(false);
    return;
  }

  applyDetectedContext(context);

  const id = newId();
  const label = MAIN_BUTTON_LABELS[pageType] ?? "Résumer";
  // Never the URL here: it is persisted to chrome.storage.local unencrypted
  // (CLAUDE.md rule #1) and a URL can carry a session token. Title only, with
  // a neutral fallback rather than reaching for context.url.
  const description = (context.title || "").trim() || "cette page";
  addMessage({ id: `${id}-u`, role: "user", text: `${label} : ${description}` });
  // videoId only — never context.url (rule #1: chrome.storage.local is
  // unencrypted, and a URL can carry a session token; a bare video id can't).
  // It's what lets a rendered timestamp be tied back to "the video this
  // summary was made from" without ever persisting that video's URL.
  const videoId = context.kind === "youtube" ? context.videoId : undefined;
  addMessage({ id, role: "assistant", text: "", streaming: true, videoId });

  activeRequestId = id;
  setStreamingUi(true);
  persistConversation();

  pendingRetries.set(id, { type: "summarize", context, length: "medium" });
  const ack = await api.runtime
    .sendMessage({ type: "wingpen:client-message", payload: { type: "summarize", id, context, length: "medium" } })
    .catch(() => null);
  startRequestWatch(id, ack?.workerInstanceId ?? null);
}

async function activeTabId() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("aucun onglet actif");
  return tab.id;
}

/** Mines the target origin out of Chrome's own permission-denied message —
 * see the comment block at the top of this file, point 3. */
function extractOriginFromError(err) {
  const message = err && typeof err.message === "string" ? err.message : "";
  // Chrome's exact wording is not contractual: try the quoted form first, then
  // fall back to any http(s) URL appearing in the message.
  const quoted = message.match(/url ["“]([^"”]+)["”]/i);
  const bare = quoted ? null : message.match(/\bhttps?:\/\/[^\s"'”)]+/i);
  const candidate = quoted ? quoted[1] : bare ? bare[0] : null;
  if (!candidate) return null;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

/** True when the failure looks like Chrome refusing access for lack of a host
 * permission, even if we could not mine the origin out of the message. */
function looksLikeAccessDenied(err) {
  const message = err && typeof err.message === "string" ? err.message : "";
  return /cannot access|permission|extension manifest/i.test(message);
}

async function extractFromTab(tabId) {
  let results;
  try {
    results = await api.scripting.executeScript({
      target: { tabId },
      // Leading slash, and it matters: Chrome resolves an injected file path
      // against the extension root, Firefox against the calling document — the
      // panel lives in panel/, so "content/extract.js" became
      // moz-extension://…/panel/content/extract.js and failed to load.
      // Measured in Firefox on 2026-09-20. Root-relative works on both.
      files: ["/content/extract.js"],
    });
  } catch (err) {
    const origin = extractOriginFromError(err);
    if (origin) throw new NoAccessError(origin);
    throw err;
  }

  const result = results?.[0]?.result;
  if (!result || typeof result !== "object") throw new Error("extraction vide");
  return result;
}

// Exception nommée à la règle du geste (DECISIONS.md). Un seul clic, sur le
// bouton que YouTube affiche déjà, uniquement en réponse au clic de
// l'utilisateur sur « Résumer cette vidéo », sur l'onglet qu'il regarde. Jamais
// au chargement, jamais en boucle, jamais sur une autre vidéo. Ce n'est pas un
// parcours automatisé : c'est le geste de l'utilisateur, outillé.
async function openYouTubeTranscript(tabId) {
  const results = await api.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const button = [...document.querySelectorAll("button")].find((el) =>
        /afficher la transcription|show transcript/i.test(
          el.getAttribute("aria-label") || el.innerText || "",
        ),
      );
      if (!button) return false;

      button.click();

      // Le panneau se remplit en différé ; mesuré entre 1 et 10 s.
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (
          document.querySelector(
            "transcript-segment-view-model, ytd-transcript-segment-renderer",
          )
        ) {
          return true;
        }
      }
      return false;
    },
  });
  return results?.[0]?.result === true;
}

// --- Selection actions (context menu) -------------------------------------

/** Reads and clears the stash left by the context-menu click, then runs it.
 * See the comment above chrome.contextMenus.onClicked in service-worker.js:
 * called both on panel load and on the "wingpen:pending-action" broadcast,
 * whichever comes first — reading it here removes it, so the other caller
 * finds nothing and no-ops. */
async function drainPendingAction() {
  const data = await api.storage.session.get(PENDING_ACTION_KEY);
  const pending = data[PENDING_ACTION_KEY];
  if (!pending) return;
  await api.storage.session.remove(PENDING_ACTION_KEY);
  runAct(pending);
}

async function runAct(pending) {
  const { action, label, params, selectionText } = pending;
  if (!selectionText) return;
  if (activeRequestId) {
    addMessage({ id: newId(), role: "system", text: "⚠ Une requête est déjà en cours ; réessayez ensuite." });
    return;
  }

  const id = newId();
  addMessage({ id: `${id}-u`, role: "user", text: `${label} : « ${truncateForDisplay(selectionText)} »` });
  addMessage({ id, role: "assistant", text: "", streaming: true });

  activeRequestId = id;
  setStreamingUi(true);
  persistConversation();

  pendingRetries.set(id, { type: "act", action, text: selectionText, params });
  const ack = await api.runtime
    .sendMessage({ type: "wingpen:client-message", payload: { type: "act", id, action, text: selectionText, params } })
    .catch(() => null);
  startRequestWatch(id, ack?.workerInstanceId ?? null);
}

function truncateForDisplay(text, max = 220) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// --- Prompt library ---------------------------------------------------

function requestPrompts() {
  api.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "prompts.list", id: newId() },
  });
}

function renderPromptOptions() {
  els.promptSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent =
    prompts.length === 0 ? "Bibliothèque de prompts vide" : "Bibliothèque de prompts…";
  els.promptSelect.appendChild(placeholder);

  for (const prompt of prompts) {
    const option = document.createElement("option");
    option.value = prompt.name;
    option.textContent = prompt.name;
    els.promptSelect.appendChild(option);
  }
}

function onPromptSelected() {
  const name = els.promptSelect.value;
  const prompt = prompts.find((p) => p.name === name);
  if (prompt) {
    els.input.value = prompt.body;
    els.input.focus();
  }
  els.promptSelect.value = "";
}

function saveCurrentAsPrompt() {
  const body = els.input.value.trim();
  if (!body) return;
  const name = window.prompt("Nom de ce prompt ?");
  if (!name) return;

  api.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "prompts.save", id: newId(), prompt: { name, body } },
  });
  requestPrompts();
}

// --- Rendering ----------------------------------------------------------

function addMessage(msg) {
  conversation.push(msg.ts == null ? { ...msg, ts: Date.now() } : msg);
  if (conversation.length > MAX_PERSISTED_MESSAGES) {
    conversation = conversation.slice(-MAX_PERSISTED_MESSAGES);
  }
  renderAll();
}

function renderAll() {
  els.messages.innerHTML = "";
  for (const msg of conversation) renderMessage(msg, { append: true });
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderMessage(msg, { append = false } = {}) {
  let node = document.getElementById(`msg-${msg.id}`);
  if (!node) {
    if (!append) return;
    node = document.createElement("div");
    node.id = `msg-${msg.id}`;
    els.messages.appendChild(node);
  }
  node.className = `message message--${msg.role}${msg.streaming ? " message--streaming" : ""}`;
  node.innerHTML = renderSafeMarkdown(msg.text);
  // Only a YouTube-context assistant message carries a videoId (set in
  // summarize()) — an ordinary article summary that happens to contain
  // "[1:23]" has none, so its timestamps stay plain text (deliverable 4).
  if (msg.role === "assistant" && msg.videoId) linkifyTimestamps(node, msg.videoId);
  if (msg.authRequired) node.appendChild(buildAuthRecoveryBlock(msg));
  els.messages.scrollTop = els.messages.scrollHeight;
}

/**
 * Walks a rendered message's text nodes and turns `[mm:ss]`/`[h:mm:ss]`
 * timestamps into clickable <button>s. Built as real DOM nodes
 * (createElement/textContent), never via string-concatenated HTML — the
 * text driving this is model output, and CLAUDE.md rule #3 says page/model
 * content is data, never markup, full stop.
 */
function linkifyTimestamps(container, videoId) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  for (const textNode of textNodes) {
    const tokens = parseTimestamps(textNode.data);
    if (tokens.length === 1 && tokens[0].type === "text") continue; // nothing to link

    const fragment = document.createDocumentFragment();
    for (const token of tokens) {
      if (token.type === "text") {
        fragment.appendChild(document.createTextNode(token.value));
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "timestamp-link";
      button.textContent = token.raw;
      button.title = "Aller à cet instant de la vidéo";
      button.addEventListener("click", () => seekActiveVideoTab(videoId, token.seconds));
      fragment.appendChild(button);
    }
    textNode.parentNode.replaceChild(fragment, textNode);
  }
}

// Seeks the <video> element of the CURRENT active tab — but only when a real
// click just happened (this is only ever called from a "click" listener
// above) AND that tab is showing the same video the summary was made from.
// CLAUDE.md rule #5 ("la règle du geste"): this tools a gesture the user just
// made, it never fires on its own, never on a timer, never on another tab.
async function seekActiveVideoTab(videoId, seconds) {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || getYouTubeVideoIdFromUrl(tab.url) !== videoId) return;
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t) => {
        const video = document.querySelector("video");
        if (video) video.currentTime = t;
      },
      args: [seconds],
    });
  } catch {
    // Tab closed, no more permission, no <video> on the page yet — a seek is
    // best-effort, never worth surfacing an error for.
  }
}

/**
 * Escapes HTML first, THEN applies a minimal markdown subset on top of the
 * already-escaped text. Content coming from the page or the model is never
 * trusted as markup — only these fixed, code-authored tags are inserted.
 */
function renderSafeMarkdown(text) {
  let escaped = escapeHtml(text ?? "");
  escaped = escaped
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  return escaped;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Persistence ----------------------------------------------------------

async function loadConversation() {
  const data = await api.storage.local.get([STORAGE_KEY, ATTACH_PAGE_KEY, RETENTION_DAYS_KEY]);
  attachPagePreference = typeof data[ATTACH_PAGE_KEY] === "boolean" ? data[ATTACH_PAGE_KEY] : null;
  const retentionDays =
    data[RETENTION_DAYS_KEY] === null || typeof data[RETENTION_DAYS_KEY] === "number"
      ? data[RETENTION_DAYS_KEY]
      : DEFAULT_RETENTION_DAYS;
  const raw = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  const filtered = applyRetention(raw, retentionDays);
  if (filtered.length !== raw.length || filtered.some((msg, i) => msg.ts !== raw[i]?.ts)) {
    // Persist the migration (stamped timestamps) and the expiry (dropped
    // messages) right away, so a crash before the next save doesn't re-show
    // messages that should have expired.
    api.storage.local.set({ [STORAGE_KEY]: filtered });
  }
  return filtered;
}

function persistConversation() {
  api.storage.local.set({ [STORAGE_KEY]: conversation, [ATTACH_PAGE_KEY]: attachPagePreference });
}

function newId() {
  return crypto.randomUUID();
}
