// Wingpen side panel — chat UI, streaming rendering, page/video summarize
// affordances, prompt library. Plain JS, no framework, no bundler.
//
// Conversation state lives HERE (persisted to chrome.storage.local), never
// only in the background service worker's memory: the service worker can be
// killed and restarted at any time (see background/service-worker.js).

const STORAGE_KEY = "wingpen:conversation";
const MAX_PERSISTED_MESSAGES = 200;

const els = {
  status: document.getElementById("status"),
  statusLabel: document.querySelector("#status .status-label"),
  openOptions: document.getElementById("openOptions"),
  summarizePage: document.getElementById("summarizePage"),
  summarizeVideo: document.getElementById("summarizeVideo"),
  promptSelect: document.getElementById("promptSelect"),
  savePrompt: document.getElementById("savePrompt"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  cancel: document.getElementById("cancel"),
};

/** @type {Array<{id: string, role: 'user'|'assistant'|'system', text: string}>} */
let conversation = [];
let activeRequestId = null;
let prompts = [];

init();

async function init() {
  conversation = await loadConversation();
  renderAll();

  els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.summarizePage.addEventListener("click", () => summarize("page"));
  els.summarizeVideo.addEventListener("click", () => summarize("youtube"));
  els.send.addEventListener("click", sendChat);
  els.cancel.addEventListener("click", cancelActive);
  els.promptSelect.addEventListener("change", onPromptSelected);
  els.savePrompt.addEventListener("click", saveCurrentAsPrompt);
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  const status = await chrome.runtime.sendMessage({ type: "wingpen:panel-ready" }).catch(() => null);
  applyStatus(status?.state ?? "unknown");
  requestPrompts();
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
}

// --- Chat ---------------------------------------------------------------

function sendChat() {
  const text = els.input.value.trim();
  if (!text || activeRequestId) return;

  const id = newId();
  addMessage({ id: `${id}-u`, role: "user", text });
  addMessage({ id, role: "assistant", text: "", streaming: true });
  els.input.value = "";

  activeRequestId = id;
  setStreamingUi(true);
  persistConversation();

  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "chat", id, text },
  });
}

function cancelActive() {
  if (!activeRequestId) return;
  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "cancel", id: newId(), target: activeRequestId },
  });
}

function setStreamingUi(streaming) {
  els.send.disabled = streaming;
  els.cancel.hidden = !streaming;
  if (!streaming) activeRequestId = null;
}

// --- Summarize ------------------------------------------------------------

async function summarize(expectedKind) {
  let context;
  try {
    context = await extractFromActiveTab();
  } catch (err) {
    addMessage({ id: newId(), role: "system", text: `⚠ Impossible de lire la page : ${err.message}` });
    return;
  }

  if (expectedKind === "youtube" && context.kind !== "youtube") {
    addMessage({ id: newId(), role: "system", text: "⚠ Cette page n'est pas une vidéo YouTube." });
    return;
  }

  // YouTube loads its transcript lazily, and Wingpen does not click it open —
  // it accompanies a gesture, it never manufactures one. Without the
  // transcript there is nothing to summarise but the description and the
  // comments, which would produce a plausible and wrong answer. Ask instead.
  if (context.needsTranscript) {
    addMessage({
      id: newId(),
      role: "system",
      text:
        "La transcription n'est pas ouverte. Sous la vidéo : « Plus » → « Afficher la transcription », " +
        "puis relancez le résumé. Sans elle, il n'y aurait que la description et les commentaires à lire.",
    });
    return;
  }

  if (!context.text || context.text.trim().length < 40) {
    addMessage({
      id: newId(),
      role: "system",
      text: "⚠ Rien de lisible n'a été trouvé sur cette page. Contenu chargé après coup, ou réservé aux abonnés ?",
    });
    return;
  }

  const id = newId();
  const label = expectedKind === "youtube" ? "Résumer cette vidéo" : "Résumer cette page";
  addMessage({ id: `${id}-u`, role: "user", text: `${label} : ${context.title || context.url}` });
  addMessage({ id, role: "assistant", text: "", streaming: true });

  activeRequestId = id;
  setStreamingUi(true);
  persistConversation();

  chrome.runtime.sendMessage({
    type: "wingpen:client-message",
    payload: { type: "summarize", id, context, length: "medium" },
  });
}

async function extractFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("aucun onglet actif");

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/extract.js"],
  });

  const result = results?.[0]?.result;
  if (!result || typeof result !== "object") throw new Error("extraction vide");
  return result;
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
  placeholder.textContent = "Bibliothèque de prompts…";
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
  conversation.push(msg);
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
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

function persistConversation() {
  chrome.storage.local.set({ [STORAGE_KEY]: conversation });
}

function newId() {
  return crypto.randomUUID();
}
