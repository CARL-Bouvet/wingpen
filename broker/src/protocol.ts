// TypeScript types and parser for every message defined in docs/PROTOCOL.md.
// The 256 KB per-message cap is enforced here, at parse time.

import type { ProviderId } from "./config.ts";

export const MAX_MESSAGE_BYTES = 256 * 1024;

export type ErrorCode =
  | "bad-request"
  | "unauthorized"
  | "model-unavailable"
  | "auth-required"
  | "context-too-large"
  | "cancelled"
  | "internal";

export type ContextKind = "page" | "youtube" | "selection";

// Amendement 2026-09-25 (types de page). Only meaningful when kind === "page"
// — see docs/PROTOCOL.md "Types de page, faits et entrées". Anything outside
// these four literals is not a PageKind: parseContext below drops it, and the
// broker then behaves exactly as it did before this amendment ("other").
export type PageKind = "list" | "listing" | "article" | "other";

// A "libellé : valeur" pair read verbatim off the page (context.facts). Only
// carried when pageKind === "listing" — see "Compatibilité".
export interface Fact {
  label: string;
  value: string;
}

// One entry of a results page (context.items). Only carried when
// pageKind === "list" — see "Compatibilité". `title` is the only required
// field; a malformed/absent one drops the whole entry (parseItem below).
export interface Item {
  title: string;
  price?: string;
  location?: string;
  detail?: string;
}

export interface Context {
  kind: ContextKind;
  url?: string;
  title?: string;
  text?: string;
  videoId?: string;

  // Amendement 2026-09-25 (types de page). Optional, page-controlled data —
  // same trust level as `text` (CLAUDE.md rule #3). See model.ts's
  // renderContext for how they're fenced, and server.ts's
  // contextBudgetError for the numeric caps ("Limites côté broker").
  pageKind?: PageKind;
  facts?: Fact[];
  items?: Item[];
}

// Amendement 2026-09-25 (types de page) — "Faits", "Entrées", "Budget de
// taille". These are the contract's numeric bounds: parseContext below only
// enforces *shape* (drops a malformed field/element, never rejects the whole
// message — "Compatibilité"); a numeric breach is refused outright by
// server.ts's contextBudgetError, never silently truncated here ("Limites
// côté broker": the broker refuses, it never truncates).
export const FACTS_MAX = 40;
export const FACT_LABEL_MAX = 60;
export const FACT_VALUE_MAX = 160;
export const ITEMS_MAX = 40;
export const ITEM_TITLE_MAX = 160;
export const ITEM_PRICE_MAX = 40;
export const ITEM_LOCATION_MAX = 80;
export const ITEM_DETAIL_MAX = 200;

export interface PromptEntry {
  name: string;
  body: string;
}

export interface HelloMessage {
  type: "hello";
  // Omitted (not just empty) means "I have no token — auto-grant me one if
  // my origin is already trusted". The server only honours that for a
  // chrome-extension:// origin already in allowedExtensionIds; see
  // server.ts's handleHandshakeMessage and docs/PROTOCOL.md's "Appairage
  // silencieux". Firefox's flow is unchanged — always sends a secret.
  secret?: string;
  v: 1;
}

export interface ChatMessage {
  type: "chat";
  id: string;
  text: string;
  context?: Context;
}

export interface SummarizeMessage {
  type: "summarize";
  id: string;
  context: Context;
  length: "short" | "medium";
}

// "shorten" added for the panel's selection context menu (Raccourcir) —
// see docs/PROTOCOL.md and the matching addition in model.ts's ACT_VERB.
export type ActAction = "translate" | "rewrite" | "explain" | "shorten";

export interface ActMessage {
  type: "act";
  id: string;
  action: ActAction;
  text: string;
  params?: { targetLang?: string; [key: string]: unknown };
}

export interface PromptsListMessage {
  type: "prompts.list";
  id: string;
}

export interface PromptsSaveMessage {
  type: "prompts.save";
  id: string;
  prompt: PromptEntry;
}

export interface PromptsDeleteMessage {
  type: "prompts.delete";
  id: string;
  name: string;
}

export interface CancelMessage {
  type: "cancel";
  id: string;
  target: string;
}

// Added 2026-09-20 (3) — see docs/PROTOCOL.md's dated amendment. Lets the
// options page read and change the active model provider. Never carries a
// secret (no API key field) — see CLAUDE.md rule #1.
export interface SettingsGetMessage {
  type: "settings.get";
  id: string;
}

export interface SettingsSetMessage {
  type: "settings.set";
  id: string;
  /** Omitted fields are left unchanged server-side. */
  provider?: ProviderId;
  model?: string;
  /**
   * The user's own Anthropic API key, for the claude-api provider. WRITE-ONLY
   * — see config.ts's WingpenConfig.apiKey and CLAUDE.md rule #1: it is
   * accepted here, persisted, and never echoed back in any `settings`
   * response. An empty string means "forget the stored key". Omitted means
   * "leave the stored key unchanged", same as every other field here.
   */
  apiKey?: string;
}

// Added for task 3 (2026-09-21): backs the panel's "Tester la connexion"
// button — see docs/PROTOCOL.md's settings.test amendment.
export interface SettingsTestMessage {
  type: "settings.test";
  id: string;
  provider: ProviderId;
}

// Amendement 2026-09-25 — "Disponibilité du fournisseur". Sent by the panel
// once per panel open only (never automatically, never periodically — see
// CLAUDE.md rule #5, "la règle du geste"). Takes no field beyond `id`: it
// always targets the currently active provider.
export interface ProviderStatusMessage {
  type: "provider.status";
  id: string;
}

export type ClientMessage =
  | HelloMessage
  | ChatMessage
  | SummarizeMessage
  | ActMessage
  | PromptsListMessage
  | PromptsSaveMessage
  | PromptsDeleteMessage
  | CancelMessage
  | SettingsGetMessage
  | SettingsSetMessage
  | SettingsTestMessage
  | ProviderStatusMessage;

// --- Server -> client messages ---

export interface ChunkMessage {
  type: "chunk";
  id: string;
  delta: string;
}

export interface DoneMessage {
  type: "done";
  id: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ErrorMessage {
  type: "error";
  id: string;
  code: ErrorCode;
  message: string;
}

export interface PromptsMessage {
  type: "prompts";
  id: string;
  items: PromptEntry[];
}

export interface HelloOkMessage {
  type: "hello-ok";
  v: 1;
  models: string[];
  capabilities: string[];
  // Amendement 2026-09-25: ALWAYS present on every grant, whatever the path —
  // a fresh session token (memory-only, invalid after a broker restart) if
  // the hello didn't already present a valid one, or the SAME session token
  // echoed back if it did (no rotation on every reconnect). Never the
  // permanent secret — see docs/PROTOCOL.md "Jeton de session".
  token: string;
}

/** Reported per known provider in a SettingsMessage's `available` array —
 * every provider Wingpen knows about is listed, including unavailable ones
 * (with `reason`), never hidden. */
export interface ProviderStatus {
  id: ProviderId;
  label: string;
  available: boolean;
  reason?: string;
  /**
   * True when this provider has what it needs to be used at all — a stored
   * API key (claude-api), a reachable daemon (ollama), an installed CLI
   * (claude-cli) — independent of whether the currently *selected* model is
   * valid for it (that distinction is `available`, above). The extension
   * shows a state, never a value: this is a boolean, never the key itself.
   */
  configured: boolean;
}

export interface SettingsMessage {
  type: "settings";
  id: string;
  provider: ProviderId;
  model?: string;
  available: ProviderStatus[];
  /** Installed model names for the currently-selected provider, when it can
   * enumerate them (currently only ollama). Absent otherwise. */
  models?: string[];
}

// Reply to a settings.test request — a real minimal model call, bounded by a
// short timeout (see server.ts's SETTINGS_TEST_TIMEOUT_MS), never a
// chat/summarize the extension would otherwise trigger via the wire. `message`
// is French, one sentence, shown verbatim to a human — see docs/PROTOCOL.md.
export interface SettingsTestResultMessage {
  type: "settings.test-result";
  id: string;
  provider: ProviderId;
  ok: boolean;
  message: string;
}

// Amendement 2026-09-25 — "Disponibilité du fournisseur". `state` is the
// broker's best answer, from a never-billed check, to "will the next request
// against this provider work?" — see docs/PROTOCOL.md for the full
// per-provider reason-code table (server.ts's providerStatus.ts owns the
// actual probing). `reason` is a short, stable, English code meant for the
// panel's own logic, never shown to a human verbatim.
export type ProviderStatusState = "ok" | "ko" | "unknown";

export interface ProviderStatusResultMessage {
  type: "provider.status-result";
  id: string;
  provider: ProviderId;
  state: ProviderStatusState;
  reason: string;
  /** ISO 8601 UTC — the time of the *effective* check (for a cached answer,
   * that's the original check's time, not now). */
  checkedAt: string;
}

export type ServerMessage =
  | ChunkMessage
  | DoneMessage
  | ErrorMessage
  | PromptsMessage
  | HelloOkMessage
  | SettingsMessage
  | SettingsTestResultMessage
  | ProviderStatusResultMessage;

// --- Parsing ---

export interface ParseError {
  code: ErrorCode;
  message: string;
  /** Present only if we could recover an id from the raw payload. */
  id?: string;
}

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: ParseError };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isProviderId(v: unknown): v is ProviderId {
  return v === "claude-cli" || v === "ollama" || v === "claude-api";
}

// I3 (lot7 security review): bounds an apiKey before it's ever persisted or
// used in an HTTP header. Printable ASCII (0x21-0x7e — excludes space and
// every control character, including newlines), no upper bound the real key
// shapes come close to (Anthropic keys are well under 200 chars); generous
// on purpose so a legitimate key format change never breaks this. Exported
// for tests.
const API_KEY_MAX_LEN = 512;
const API_KEY_RE = /^[\x21-\x7e]+$/;
export function isValidApiKeyFormat(value: string): boolean {
  return value.length <= API_KEY_MAX_LEN && API_KEY_RE.test(value);
}

function isPageKind(v: unknown): v is PageKind {
  return v === "list" || v === "listing" || v === "article" || v === "other";
}

// A single facts[] element: kept only if both fields are strings — see
// "Compatibilité": "label ou value non chaîne" drops the element, others
// stay. No length/emptiness check here — that's a numeric bound, see
// FACT_LABEL_MAX/FACT_VALUE_MAX above and server.ts's contextBudgetError.
function parseFact(v: unknown): Fact | undefined {
  if (!isRecord(v)) return undefined;
  if (typeof v.label !== "string" || typeof v.value !== "string") return undefined;
  return { label: v.label, value: v.value };
}

function parseFacts(v: unknown): Fact[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(parseFact).filter((f): f is Fact => f !== undefined);
}

// A single items[] element. `title` absent/non-string/empty drops the whole
// entry — "Entrées": "une entrée sans titre non vide est écartée". Each
// optional field is dropped on its own (not the whole entry) when present
// but not a string — "Compatibilité": "champ optionnel non chaîne".
function parseItem(v: unknown): Item | undefined {
  if (!isRecord(v)) return undefined;
  if (typeof v.title !== "string" || v.title.length === 0) return undefined;
  const item: Item = { title: v.title };
  if (typeof v.price === "string") item.price = v.price;
  if (typeof v.location === "string") item.location = v.location;
  if (typeof v.detail === "string") item.detail = v.detail;
  return item;
}

function parseItems(v: unknown): Item[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(parseItem).filter((i): i is Item => i !== undefined);
}

function parseContext(v: unknown): Context | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) return undefined;
  const kind = v.kind;
  if (kind !== "page" && kind !== "youtube" && kind !== "selection") return undefined;
  const context: Context = { kind };
  if (typeof v.url === "string") context.url = v.url;
  if (typeof v.title === "string") context.title = v.title;
  if (typeof v.text === "string") context.text = v.text;
  if (typeof v.videoId === "string") context.videoId = v.videoId;

  // Amendement 2026-09-25 (types de page). pageKind/facts/items only exist
  // for kind === "page" — "Compatibilité": "kind différent de page →
  // pageKind, facts et items ignorés". A pageKind outside the four known
  // values is dropped (undefined), same as an absent one — the client
  // behaves exactly as before this amendment ("other").
  if (kind === "page") {
    if (isPageKind(v.pageKind)) context.pageKind = v.pageKind;
    // "facts avec un pageKind autre que listing, items avec un pageKind
    // autre que list → champ ignoré (ni rendu, ni compté dans le budget)".
    if (context.pageKind === "listing") {
      const facts = parseFacts(v.facts);
      if (facts !== undefined) context.facts = facts;
    }
    if (context.pageKind === "list") {
      const items = parseItems(v.items);
      if (items !== undefined) context.items = items;
    }
  }
  return context;
}

/**
 * Parses a raw WebSocket text frame into a well-typed ClientMessage, or a
 * structured ParseError. Enforces the 256 KB message cap.
 */
export function parseClientMessage(raw: string): ParseResult {
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      error: { code: "bad-request", message: `message exceeds ${MAX_MESSAGE_BYTES} byte cap` },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: { code: "bad-request", message: "invalid JSON" } };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: { code: "bad-request", message: "message must be a JSON object" } };
  }

  const type = parsed.type;
  if (typeof type !== "string") {
    return { ok: false, error: { code: "bad-request", message: "missing type" } };
  }

  // hello is the only message without an id. `secret` may be omitted
  // entirely (auto-grant request, see HelloMessage) but if present must be a
  // non-empty string — never silently treated as "omitted".
  if (type === "hello") {
    if (parsed.secret !== undefined && !isNonEmptyString(parsed.secret)) {
      return { ok: false, error: { code: "bad-request", message: "hello: invalid secret" } };
    }
    if (parsed.v !== 1) {
      return { ok: false, error: { code: "bad-request", message: "hello: unsupported v" } };
    }
    return {
      ok: true,
      message: { type: "hello", secret: typeof parsed.secret === "string" ? parsed.secret : undefined, v: 1 },
    };
  }

  const id = parsed.id;
  if (!isNonEmptyString(id)) {
    return { ok: false, error: { code: "bad-request", message: "missing id" } };
  }

  switch (type) {
    case "chat": {
      if (!isNonEmptyString(parsed.text)) {
        return { ok: false, error: { code: "bad-request", message: "chat: missing text", id } };
      }
      const context = parseContext(parsed.context);
      return { ok: true, message: { type: "chat", id, text: parsed.text, context } };
    }
    case "summarize": {
      const context = parseContext(parsed.context);
      if (!context) {
        return { ok: false, error: { code: "bad-request", message: "summarize: missing context", id } };
      }
      if (parsed.length !== "short" && parsed.length !== "medium") {
        return { ok: false, error: { code: "bad-request", message: "summarize: invalid length", id } };
      }
      return { ok: true, message: { type: "summarize", id, context, length: parsed.length } };
    }
    case "act": {
      if (
        parsed.action !== "translate" &&
        parsed.action !== "rewrite" &&
        parsed.action !== "explain" &&
        parsed.action !== "shorten"
      ) {
        return { ok: false, error: { code: "bad-request", message: "act: invalid action", id } };
      }
      if (!isNonEmptyString(parsed.text)) {
        return { ok: false, error: { code: "bad-request", message: "act: missing text", id } };
      }
      const params = isRecord(parsed.params) ? (parsed.params as ActMessage["params"]) : undefined;
      return { ok: true, message: { type: "act", id, action: parsed.action, text: parsed.text, params } };
    }
    case "prompts.list": {
      return { ok: true, message: { type: "prompts.list", id } };
    }
    case "prompts.save": {
      const prompt = parsed.prompt;
      if (!isRecord(prompt) || !isNonEmptyString(prompt.name) || typeof prompt.body !== "string") {
        return { ok: false, error: { code: "bad-request", message: "prompts.save: invalid prompt", id } };
      }
      return { ok: true, message: { type: "prompts.save", id, prompt: { name: prompt.name, body: prompt.body } } };
    }
    case "prompts.delete": {
      if (!isNonEmptyString(parsed.name)) {
        return { ok: false, error: { code: "bad-request", message: "prompts.delete: missing name", id } };
      }
      return { ok: true, message: { type: "prompts.delete", id, name: parsed.name } };
    }
    case "cancel": {
      if (!isNonEmptyString(parsed.target)) {
        return { ok: false, error: { code: "bad-request", message: "cancel: missing target", id } };
      }
      return { ok: true, message: { type: "cancel", id, target: parsed.target } };
    }
    case "settings.get": {
      return { ok: true, message: { type: "settings.get", id } };
    }
    case "settings.set": {
      const provider = parsed.provider;
      if (provider !== undefined && !isProviderId(provider)) {
        return { ok: false, error: { code: "bad-request", message: "settings.set: unknown provider", id } };
      }
      const model = parsed.model;
      if (model !== undefined && typeof model !== "string") {
        return { ok: false, error: { code: "bad-request", message: "settings.set: invalid model", id } };
      }
      const apiKey = parsed.apiKey;
      if (apiKey !== undefined && typeof apiKey !== "string") {
        return { ok: false, error: { code: "bad-request", message: "settings.set: invalid apiKey", id } };
      }
      // I3 (lot7 security review): reject a malformed key at the door rather
      // than persisting it and having it flow, unvalidated, into an
      // `x-api-key` HTTP header (providers/claude-api.ts) and error text
      // downstream — see docs/PROTOCOL.md's CLAUDE_API_AUTH_MESSAGE path. An
      // Anthropic key is printable ASCII, no whitespace; "" is exempt (it
      // means "forget the stored key", see SettingsSetMessage.apiKey).
      if (apiKey !== undefined && apiKey !== "" && !isValidApiKeyFormat(apiKey)) {
        return { ok: false, error: { code: "bad-request", message: "settings.set: invalid apiKey format", id } };
      }
      return { ok: true, message: { type: "settings.set", id, provider, model, apiKey } };
    }
    case "settings.test": {
      const provider = parsed.provider;
      if (!isProviderId(provider)) {
        return { ok: false, error: { code: "bad-request", message: "settings.test: unknown provider", id } };
      }
      return { ok: true, message: { type: "settings.test", id, provider } };
    }
    case "provider.status": {
      return { ok: true, message: { type: "provider.status", id } };
    }
    default:
      return { ok: false, error: { code: "bad-request", message: `unknown type: ${type}`, id } };
  }
}
