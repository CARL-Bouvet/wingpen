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

// Must match extension/background/service-worker.js's BROKER_PORT and
// manifest.json's "externally_connectable" entry — see the comment there for
// why this can't be derived from config at runtime.
const BROKER_PORT = 8787;
const PAIR_URL = `http://127.0.0.1:${BROKER_PORT}/pair`;

const STORAGE_KEY = "wingpen:conversation";
const ATTACH_PAGE_KEY = "wingpen:attachPage";
const PENDING_ACTION_KEY = "wingpen:pendingAction";
const RETENTION_DAYS_KEY = "wingpen:retentionDays"; // number of days, or null for "jamais" — set from the options page
const DEFAULT_RETENTION_DAYS = 30;
const MAX_PERSISTED_MESSAGES = 200;

const MAIN_BUTTON_LABELS = {
  video: "Résumer cette vidéo",
  article: "Résumer cet article",
  page: "Résumer cette page",
};

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
};

/** @type {Array<{id: string, role: 'user'|'assistant'|'system', text: string}>} */
let conversation = [];
let activeRequestId = null;
let prompts = [];

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

  els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.connectWingpen.addEventListener("click", () => chrome.tabs.create({ url: PAIR_URL }));
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

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    currentTabId = tabId;
    redetectTabFromMetadata(tabId);
  });

  const status = await chrome.runtime.sendMessage({ type: "wingpen:panel-ready" }).catch(() => null);
  applyStatus(status?.state ?? "unknown");
  requestPrompts();

  try {
    currentTabId = await activeTabId();
    await redetectTab(currentTabId);
  } catch {
    currentTabId = null;
    updateMainButton();
    updateAttachToggle();
  }

  await drainPendingAction();
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
      const msg = conversation.find((m) => m.id === message.id);
      if (msg) {
        msg.streaming = false;
        msg.text = msg.text || `⚠ ${message.message || message.code}`;
        renderMessage(msg);
      } else {
        addMessage({ id: message.id, role: "system", text: `⚠ ${message.message || message.code}` });
      }
      if (activeRequestId === message.id) setStreamingUi(false);
      persistConversation();
      break;
    }
    case "prompts": {
      prompts = Array.isArray(message.items) ? message.items : [];
      renderPromptOptions();
      break;
    }
    default:
      break;
  }
}

function applyStatus(state) {
  // A dropped connection must not leave the panel permanently locked: any
  // in-flight request will never get its "done"/"error" reply now.
  if ((state === "disconnected" || state === "no-token") && activeRequestId) {
    setStreamingUi(false);
  }

  els.status.className = `status status--${state}`;
  const labels = {
    connected: "Connecté",
    connecting: "Connexion…",
    handshaking: "Connexion…",
    disconnected: "Déconnecté",
    "no-token": "Pas de jeton — voir réglages",
    unknown: "…",
  };
  els.statusLabel.textContent = labels[state] ?? state;

  applyConnectionBanner(state);
}

// Two states must never be confused (see the design brief for this feature):
// "no-token" means the extension has never been paired (or the browser was
// restarted and chrome.storage.session was wiped, see CLAUDE.md rule #1) —
// the fix is one click. "disconnected" means we DO hold a token but the
// broker itself isn't answering right now — the fix is starting the broker.
// The options page's paste field remains the fallback for both; see options.js.
function applyConnectionBanner(state) {
  if (state === "no-token") {
    els.connectionBannerText.textContent = "Wingpen n'est pas encore connecté à votre broker.";
    els.connectWingpen.hidden = false;
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

  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "chat", id, text, context },
  });
}

function cancelActive() {
  if (!activeRequestId) return;
  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "cancel", id: newId(), target: activeRequestId },
  });
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
  await chrome.storage.local.remove(STORAGE_KEY);
  persistConversation();
  renderAll();
}

function setStreamingUi(streaming) {
  els.send.disabled = streaming;
  els.mainAction.disabled = streaming;
  els.cancel.hidden = !streaming;
  if (!streaming) activeRequestId = null;
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
async function redetectTab(tabId) {
  try {
    const context = await extractFromTab(tabId);
    applyDetectedContext(context);
  } catch (err) {
    resetPageState();
    if (err instanceof NoAccessError) {
      knownOrigin = err.origin;
      const pattern = `${err.origin}/*`;
      const alreadyGranted = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
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
    tab = await chrome.tabs.get(tabId);
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
  const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
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
  addMessage({ id, role: "assistant", text: "", streaming: true });

  activeRequestId = id;
  setStreamingUi(true);
  persistConversation();

  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "summarize", id, context, length: "medium" },
  });
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    results = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/extract.js"],
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
  const results = await chrome.scripting.executeScript({
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
  const data = await chrome.storage.session.get(PENDING_ACTION_KEY);
  const pending = data[PENDING_ACTION_KEY];
  if (!pending) return;
  await chrome.storage.session.remove(PENDING_ACTION_KEY);
  runAct(pending);
}

function runAct(pending) {
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

  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "act", id, action, text: selectionText, params },
  });
}

function truncateForDisplay(text, max = 220) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// --- Prompt library ---------------------------------------------------

function requestPrompts() {
  chrome.runtime.sendMessage({
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

  chrome.runtime.sendMessage({
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
  els.messages.scrollTop = els.messages.scrollHeight;
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
  const data = await chrome.storage.local.get([STORAGE_KEY, ATTACH_PAGE_KEY, RETENTION_DAYS_KEY]);
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
    chrome.storage.local.set({ [STORAGE_KEY]: filtered });
  }
  return filtered;
}

function persistConversation() {
  chrome.storage.local.set({ [STORAGE_KEY]: conversation, [ATTACH_PAGE_KEY]: attachPagePreference });
}

function newId() {
  return crypto.randomUUID();
}
