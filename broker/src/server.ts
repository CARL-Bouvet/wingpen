// Bun.serve WebSocket entrypoint. Binds to 127.0.0.1 ONLY — never 0.0.0.0, never a
// network interface. Handshake: Origin check, then a `hello` with the pairing
// secret within 3s, else close 4401 with a plain-language reason.

import { timingSafeEqual } from "node:crypto";
import {
  defaultDirs,
  loadConfig,
  loadOrCreatePairingSecret,
  type Dirs,
  type WingpenConfig,
} from "./config.ts";
import { parseClientMessage, type ClientMessage, type ServerMessage } from "./protocol.ts";
import { buildPrompt, streamAnswer } from "./model.ts";
import { listPrompts, savePrompt, deletePrompt, type PromptsDirs } from "./prompts.ts";

// Content is truncated to 40 000 chars by the content script (see PROTOCOL.md).
// The broker enforces the same cap server-side as a safety net.
export const MAX_CONTEXT_CHARS = 40_000;

export function contextTooLarge(text: string | undefined): boolean {
  return typeof text === "string" && text.length > MAX_CONTEXT_CHARS;
}

/** Pure: Origin header must exactly match chrome-extension://<one of allowedExtensionIds>. */
export function checkOrigin(origin: string | null | undefined, allowedExtensionIds: string[]): boolean {
  if (!origin) return false;
  return allowedExtensionIds.some((id) => origin === `chrome-extension://${id}`);
}

/** Pure: constant-time secret comparison. */
export function checkSecret(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface ConnData {
  origin: string | null;
  authed: boolean;
  active: Map<string, AbortController>;
  helloTimer: ReturnType<typeof setTimeout> | null;
}

function send(ws: { send(data: string): unknown }, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

async function runStream(
  ws: { send(data: string): unknown },
  active: Map<string, AbortController>,
  id: string,
  prompt: string,
): Promise<void> {
  const controller = new AbortController();
  active.set(id, controller);
  try {
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of streamAnswer(prompt, { signal: controller.signal })) {
      if (controller.signal.aborted) break;
      if (event.kind === "usage") {
        usage = event.usage;
        continue;
      }
      send(ws, { type: "chunk", id, delta: event.text });
    }
    if (controller.signal.aborted) {
      send(ws, { type: "error", id, code: "cancelled", message: "request cancelled" });
    } else {
      send(ws, { type: "done", id, usage });
    }
  } catch (err) {
    if (controller.signal.aborted) {
      send(ws, { type: "error", id, code: "cancelled", message: "request cancelled" });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      send(ws, { type: "error", id, code: "internal", message });
    }
  } finally {
    active.delete(id);
  }
}

function handleMessage(
  ws: { send(data: string): unknown },
  message: ClientMessage,
  active: Map<string, AbortController>,
  promptsDirs: PromptsDirs,
): void {
  switch (message.type) {
    case "hello":
      // Duplicate hello after an already-authed handshake: no-op.
      return;
    case "chat": {
      if (contextTooLarge(message.text) || contextTooLarge(message.context?.text)) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: "text exceeds 40000 characters" });
        return;
      }
      const prompt = buildPrompt({ kind: "chat", text: message.text, context: message.context });
      void runStream(ws, active, message.id, prompt);
      return;
    }
    case "summarize": {
      if (contextTooLarge(message.context.text)) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: "context exceeds 40000 characters" });
        return;
      }
      const prompt = buildPrompt({ kind: "summarize", context: message.context, length: message.length });
      void runStream(ws, active, message.id, prompt);
      return;
    }
    case "act": {
      if (contextTooLarge(message.text)) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: "text exceeds 40000 characters" });
        return;
      }
      const prompt = buildPrompt({
        kind: "act",
        action: message.action,
        text: message.text,
        params: message.params,
      });
      void runStream(ws, active, message.id, prompt);
      return;
    }
    case "prompts.list": {
      send(ws, { type: "prompts", id: message.id, items: listPrompts(promptsDirs) });
      return;
    }
    case "prompts.save": {
      send(ws, { type: "prompts", id: message.id, items: savePrompt(promptsDirs, message.prompt) });
      return;
    }
    case "prompts.delete": {
      send(ws, { type: "prompts", id: message.id, items: deletePrompt(promptsDirs, message.name) });
      return;
    }
    case "cancel": {
      active.get(message.target)?.abort();
      return;
    }
  }
}

function handleHandshakeMessage(
  ws: { close(code: number, reason: string): unknown; send(data: string): unknown; data: ConnData },
  raw: string,
  pairingSecret: string,
): void {
  if (ws.data.helloTimer) {
    clearTimeout(ws.data.helloTimer);
    ws.data.helloTimer = null;
  }
  const result = parseClientMessage(raw);
  if (!result.ok || result.message.type !== "hello") {
    ws.close(4401, "expected hello message with pairing secret");
    return;
  }
  if (!checkSecret(result.message.secret, pairingSecret)) {
    ws.close(4401, "invalid pairing secret");
    return;
  }
  ws.data.authed = true;
  send(ws, { type: "hello-ok", v: 1, models: ["claude"], capabilities: ["chat", "summarize"] });
}

export function startServer(config: WingpenConfig, pairingSecret: string, promptsDirs: PromptsDirs) {
  return Bun.serve<ConnData, {}>({
    hostname: "127.0.0.1", // NEVER 0.0.0.0 — see CLAUDE.md non-negotiable rule #2.
    port: config.port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname !== "/ws") {
        return new Response("not found", { status: 404 });
      }
      const origin = req.headers.get("origin");
      const upgraded = server.upgrade(req, {
        data: { origin, authed: false, active: new Map(), helloTimer: null } satisfies ConnData,
      });
      if (!upgraded) {
        return new Response("expected websocket upgrade", { status: 400 });
      }
      return undefined;
    },
    websocket: {
      open(ws) {
        if (!checkOrigin(ws.data.origin, config.allowedExtensionIds)) {
          ws.close(4401, "origin not allowed");
          return;
        }
        ws.data.helloTimer = setTimeout(() => {
          ws.close(4401, "handshake timeout: no hello within 3s");
        }, 3000);
      },
      message(ws, raw) {
        const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
        if (!ws.data.authed) {
          handleHandshakeMessage(ws, text, pairingSecret);
          return;
        }
        const result = parseClientMessage(text);
        if (!result.ok) {
          if (result.error.id) {
            send(ws, { type: "error", id: result.error.id, code: result.error.code, message: result.error.message });
          }
          return;
        }
        handleMessage(ws, result.message, ws.data.active, promptsDirs);
      },
      close(ws) {
        if (ws.data.helloTimer) clearTimeout(ws.data.helloTimer);
        for (const controller of ws.data.active.values()) controller.abort();
        ws.data.active.clear();
      },
    },
  });
}

if (import.meta.main) {
  const dirs: Dirs = defaultDirs();
  const config = loadConfig(dirs);
  const port = Number(process.env.WINGPEN_PORT) || config.port;
  const pairingSecret = loadOrCreatePairingSecret(dirs);
  const promptsDirs: PromptsDirs = { dataDir: dirs.dataDir };
  const server = startServer({ ...config, port }, pairingSecret, promptsDirs);
  console.log(`wingpen-broker listening on ws://127.0.0.1:${server.port}/ws`);
}
