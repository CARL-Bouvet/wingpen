// TypeScript types and parser for every message defined in docs/PROTOCOL.md.
// The 256 KB per-message cap is enforced here, at parse time.

export const MAX_MESSAGE_BYTES = 256 * 1024;

export type ErrorCode =
  | "bad-request"
  | "unauthorized"
  | "model-unavailable"
  | "context-too-large"
  | "cancelled"
  | "internal";

export type ContextKind = "page" | "youtube" | "selection";

export interface Context {
  kind: ContextKind;
  url?: string;
  title?: string;
  text?: string;
  videoId?: string;
}

export interface PromptEntry {
  name: string;
  body: string;
}

export interface HelloMessage {
  type: "hello";
  secret: string;
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

export type ActAction = "translate" | "rewrite" | "explain";

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

export type ClientMessage =
  | HelloMessage
  | ChatMessage
  | SummarizeMessage
  | ActMessage
  | PromptsListMessage
  | PromptsSaveMessage
  | PromptsDeleteMessage
  | CancelMessage;

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
}

export type ServerMessage =
  | ChunkMessage
  | DoneMessage
  | ErrorMessage
  | PromptsMessage
  | HelloOkMessage;

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

  // hello is the only message without an id.
  if (type === "hello") {
    if (!isNonEmptyString(parsed.secret)) {
      return { ok: false, error: { code: "bad-request", message: "hello: missing secret" } };
    }
    if (parsed.v !== 1) {
      return { ok: false, error: { code: "bad-request", message: "hello: unsupported v" } };
    }
    return { ok: true, message: { type: "hello", secret: parsed.secret, v: 1 } };
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
      if (parsed.action !== "translate" && parsed.action !== "rewrite" && parsed.action !== "explain") {
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
    default:
      return { ok: false, error: { code: "bad-request", message: `unknown type: ${type}`, id } };
  }
}
