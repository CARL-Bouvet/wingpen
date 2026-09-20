// Bun.serve WebSocket entrypoint. Binds to 127.0.0.1 ONLY — never 0.0.0.0, never a
// network interface. Handshake: Origin check, then a `hello` with the pairing
// secret within 3s, else close 4401 with a plain-language reason.

import { timingSafeEqual } from "node:crypto";
import {
  DEFAULT_CONFIG,
  defaultDirs,
  loadConfig,
  loadOrCreatePairingSecret,
  saveConfig,
  type Dirs,
  type ProviderId,
  type WingpenConfig,
} from "./config.ts";
import {
  parseClientMessage,
  type ClientMessage,
  type ProviderStatus,
  type ServerMessage,
  type SettingsSetMessage,
} from "./protocol.ts";
import { buildPrompt, isModelUnavailableError, type BuiltPrompt } from "./model.ts";
import { listPrompts, savePrompt, deletePrompt, type PromptsDirs } from "./prompts.ts";
import { renderPairPage } from "./pair.ts";
import { PROVIDERS, getProvider } from "./providers/registry.ts";
import type { ModelProvider, ProviderRuntimeOptions } from "./providers/types.ts";

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

// A local process on the machine (not the intended extension) can open a
// WebSocket and probe the handshake. Distinct client-visible messages for
// "wrong Origin" / "wrong secret" / "no hello in time" would let it tell
// those apart — an oracle. Every failure gets this one generic message on the
// wire; the real reason goes to the broker's own stderr only.
const HANDSHAKE_FAILURE_MESSAGE = "unauthorized";

function rejectHandshake(
  ws: { close(code: number, reason: string): unknown; send(data: string): unknown },
  reason: string,
): void {
  console.error(`wingpen-broker: handshake rejected — ${reason}`);
  send(ws, { type: "error", id: "hello", code: "unauthorized", message: HANDSHAKE_FAILURE_MESSAGE });
  ws.close(4401, HANDSHAKE_FAILURE_MESSAGE);
}

// Per-connection cap on simultaneously in-flight model streams. Without it, an
// authenticated client sending N chat/summarize/act messages back to back
// spawns N `claude` subprocesses with no limit. See docs/PROTOCOL.md "Limites".
export const MAX_CONCURRENT_STREAMS = 3;

async function runStream(
  ws: { send(data: string): unknown },
  active: Map<string, AbortController>,
  id: string,
  built: BuiltPrompt,
  provider: ModelProvider,
  providerOpts: ProviderRuntimeOptions,
): Promise<void> {
  const controller = new AbortController();
  active.set(id, controller);
  try {
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of provider.streamAnswer(built, { signal: controller.signal, ...providerOpts })) {
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
      const code = isModelUnavailableError(err) ? "model-unavailable" : "internal";
      send(ws, { type: "error", id, code, message });
    }
  } finally {
    active.delete(id);
  }
}

/** Probes every known provider's isAvailable() and, for the currently active
 * one, its listModels() (when it has one) — the full payload of a `settings`
 * reply. A provider that errors while probing is reported unavailable rather
 * than crashing the whole response; never hidden (see docs/PROTOCOL.md). */
async function buildSettingsPayload(config: WingpenConfig): Promise<{
  provider: ProviderId;
  model?: string;
  available: ProviderStatus[];
  models?: string[];
}> {
  const provider = config.provider ?? DEFAULT_CONFIG.provider!;
  const opts: ProviderRuntimeOptions = { model: config.model, ollamaUrl: config.ollamaUrl };
  const available = await Promise.all(
    PROVIDERS.map(async (p): Promise<ProviderStatus> => {
      try {
        const a = await p.isAvailable(opts);
        return { id: p.id as ProviderId, label: p.label, available: a.available, reason: a.reason };
      } catch (err) {
        return {
          id: p.id as ProviderId,
          label: p.label,
          available: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  const active = getProvider(provider);
  const models = active?.listModels ? await active.listModels(opts).catch(() => undefined) : undefined;
  return { provider, model: config.model, available, models };
}

/** Bundles what handleMessage needs beyond the message itself: the provider
 * currently selected (for chat/summarize/act) and read/write access to the
 * live config (for settings.get/settings.set). Config is process-wide per
 * server instance — one broker serves one user — so `set` mutates the
 * closure in startServer() directly. */
interface SettingsCtx {
  provider: ModelProvider;
  providerOpts: ProviderRuntimeOptions;
  getConfig(): WingpenConfig;
  /** Applies provider/model fields from a settings.set message, persists to
   * config.json when a configDir was supplied to startServer, and returns
   * the resulting config. */
  applySettings(patch: Pick<SettingsSetMessage, "provider" | "model">): WingpenConfig;
}

function handleMessage(
  ws: { send(data: string): unknown },
  message: ClientMessage,
  active: Map<string, AbortController>,
  promptsDirs: PromptsDirs,
  settingsCtx: SettingsCtx,
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
      if (active.size >= MAX_CONCURRENT_STREAMS) {
        send(ws, { type: "error", id: message.id, code: "bad-request", message: `too many concurrent requests (max ${MAX_CONCURRENT_STREAMS} per connection)` });
        return;
      }
      const built = buildPrompt({ kind: "chat", text: message.text, context: message.context });
      void runStream(ws, active, message.id, built, settingsCtx.provider, settingsCtx.providerOpts);
      return;
    }
    case "summarize": {
      if (contextTooLarge(message.context.text)) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: "context exceeds 40000 characters" });
        return;
      }
      if (active.size >= MAX_CONCURRENT_STREAMS) {
        send(ws, { type: "error", id: message.id, code: "bad-request", message: `too many concurrent requests (max ${MAX_CONCURRENT_STREAMS} per connection)` });
        return;
      }
      const built = buildPrompt({ kind: "summarize", context: message.context, length: message.length });
      void runStream(ws, active, message.id, built, settingsCtx.provider, settingsCtx.providerOpts);
      return;
    }
    case "act": {
      if (contextTooLarge(message.text)) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: "text exceeds 40000 characters" });
        return;
      }
      if (active.size >= MAX_CONCURRENT_STREAMS) {
        send(ws, { type: "error", id: message.id, code: "bad-request", message: `too many concurrent requests (max ${MAX_CONCURRENT_STREAMS} per connection)` });
        return;
      }
      const built = buildPrompt({
        kind: "act",
        action: message.action,
        text: message.text,
        params: message.params,
      });
      void runStream(ws, active, message.id, built, settingsCtx.provider, settingsCtx.providerOpts);
      return;
    }
    case "prompts.list": {
      send(ws, { type: "prompts", id: message.id, items: listPrompts(promptsDirs) });
      return;
    }
    case "prompts.save": {
      void savePrompt(promptsDirs, message.prompt).then((items) => {
        send(ws, { type: "prompts", id: message.id, items });
      });
      return;
    }
    case "prompts.delete": {
      void deletePrompt(promptsDirs, message.name).then((items) => {
        send(ws, { type: "prompts", id: message.id, items });
      });
      return;
    }
    case "cancel": {
      active.get(message.target)?.abort();
      return;
    }
    case "settings.get": {
      void buildSettingsPayload(settingsCtx.getConfig()).then((payload) => {
        send(ws, { type: "settings", id: message.id, ...payload });
      });
      return;
    }
    case "settings.set": {
      const updated = settingsCtx.applySettings({ provider: message.provider, model: message.model });
      void buildSettingsPayload(updated).then((payload) => {
        send(ws, { type: "settings", id: message.id, ...payload });
      });
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
    rejectHandshake(ws, "expected hello message with pairing secret");
    return;
  }
  if (!checkSecret(result.message.secret, pairingSecret)) {
    rejectHandshake(ws, "invalid pairing secret");
    return;
  }
  ws.data.authed = true;
  send(ws, { type: "hello-ok", v: 1, models: ["claude"], capabilities: ["chat", "summarize"] });
}

/** promptsDirs, widened with an optional configDir so startServer can persist
 * settings.set to config.json. Optional and separate from PromptsDirs (rather
 * than requiring the full config.Dirs shape) so every existing test call site
 * passing a bare `{ dataDir }` keeps compiling — persistence is simply
 * skipped (in-memory only) when configDir is omitted, which is exactly what
 * those tests want since none of them exercise settings.set. */
export interface ServerDirs extends PromptsDirs {
  configDir?: string;
}

export function startServer(config: WingpenConfig, pairingSecret: string, dirs: ServerDirs) {
  const promptsDirs: PromptsDirs = { dataDir: dirs.dataDir };

  // Config is process-wide for the lifetime of this server instance — one
  // broker serves one user, so there is no per-connection config. Defaults
  // are merged in here (not just in config.ts's loadConfig) so a caller that
  // constructs a WingpenConfig literal directly — every existing test does —
  // doesn't have to know about provider/ollamaUrl to keep working.
  let currentConfig: WingpenConfig = {
    provider: DEFAULT_CONFIG.provider,
    ollamaUrl: DEFAULT_CONFIG.ollamaUrl,
    ...config,
  };

  function settingsCtx(): SettingsCtx {
    const cfg = currentConfig;
    return {
      provider: getProvider(cfg.provider) ?? getProvider(DEFAULT_CONFIG.provider)!,
      providerOpts: { model: cfg.model, ollamaUrl: cfg.ollamaUrl },
      getConfig: () => currentConfig,
      applySettings(patch) {
        if (patch.provider !== undefined) currentConfig = { ...currentConfig, provider: patch.provider };
        if (patch.model !== undefined) currentConfig = { ...currentConfig, model: patch.model };
        if (dirs.configDir) saveConfig({ configDir: dirs.configDir }, currentConfig);
        return currentConfig;
      },
    };
  }

  return Bun.serve<ConnData, {}>({
    hostname: "127.0.0.1", // NEVER 0.0.0.0 — see CLAUDE.md non-negotiable rule #2.
    port: config.port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/pair") {
        const html = renderPairPage({
          port: config.port,
          extensionIds: config.allowedExtensionIds,
          token: pairingSecret,
        });
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
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
          rejectHandshake(ws, `origin not allowed: ${ws.data.origin ?? "(none)"}`);
          return;
        }
        ws.data.helloTimer = setTimeout(() => {
          rejectHandshake(ws, "handshake timeout: no hello within 3s");
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
        handleMessage(ws, result.message, ws.data.active, promptsDirs, settingsCtx());
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
  const server = startServer({ ...config, port }, pairingSecret, {
    dataDir: dirs.dataDir,
    configDir: dirs.configDir,
  });
  console.log(`wingpen-broker listening on ws://127.0.0.1:${server.port}/ws`);
}
