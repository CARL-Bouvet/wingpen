// Bun.serve WebSocket entrypoint. Binds to 127.0.0.1 ONLY — never 0.0.0.0, never a
// network interface. Handshake: Origin check, then a `hello` with the pairing
// secret within 3s, else close 4401 with a plain-language reason.

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  FIREFOX_UUIDS_FILENAME,
  defaultDirs,
  loadConfig,
  loadFirefoxPins,
  loadOrCreatePairingSecret,
  recordFirefoxSeen,
  saveConfig,
  type Dirs,
  type ProviderId,
  type WingpenConfig,
} from "./config.ts";
import { isHostAllowed, resolvePeerUid } from "./admission.ts";
import { SessionTokenStore } from "./session-tokens.ts";
import { ProviderStatusCache } from "./provider-status.ts";
import {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  FACTS_MAX,
  FACT_LABEL_MAX,
  FACT_VALUE_MAX,
  ITEMS_MAX,
  ITEM_TITLE_MAX,
  ITEM_PRICE_MAX,
  ITEM_LOCATION_MAX,
  ITEM_DETAIL_MAX,
  type ClientMessage,
  type Context,
  type ProviderStatus,
  type ServerMessage,
  type SettingsSetMessage,
} from "./protocol.ts";
import {
  buildPrompt,
  isAuthRequiredError,
  isModelUnavailableError,
  ModelTimeoutError,
  type BuiltPrompt,
} from "./model.ts";
import { listPrompts, savePrompt, deletePrompt, type PromptsDirs } from "./prompts.ts";
import { renderPairPage } from "./pair.ts";
import { PROVIDERS, getProvider } from "./providers/registry.ts";
import { assertClaudeExecutableIsUsable } from "./providers/claude-cli.ts";
import type { ModelProvider, ProviderRuntimeOptions } from "./providers/types.ts";

// Content is truncated to 40 000 chars by the content script (see PROTOCOL.md).
// The broker enforces the same cap server-side as a safety net.
export const MAX_CONTEXT_CHARS = 40_000;

export function contextTooLarge(text: string | undefined): boolean {
  return typeof text === "string" && text.length > MAX_CONTEXT_CHARS;
}

// Amendement 2026-09-25 (types de page) — "Budget de taille" / "Limites côté
// broker". `text` + `facts` + `items` now share the same 40 000-character
// budget, and each of `facts`/`items` has its own count and per-field length
// caps. Checked AFTER protocol.ts's parseContext has already dropped
// malformed-shaped elements ("après avoir écarté les éléments de forme
// invalide") — every count/length here is on data that is at least
// well-formed. On any breach the broker refuses outright — it never
// truncates (a legitimate client already respects every one of these
// bounds; a breach signals a broken client, not something to paper over).
// Returns the exact bound crossed (for the error's `message`, which "nomme
// la borne franchie"), or undefined when the context fits.
export function contextBudgetError(context: Context | undefined): string | undefined {
  if (!context) return undefined;
  const facts = context.facts ?? [];
  const items = context.items ?? [];

  if (facts.length > FACTS_MAX) return `facts exceeds ${FACTS_MAX} entries`;
  if (items.length > ITEMS_MAX) return `items exceeds ${ITEMS_MAX} entries`;

  for (const fact of facts) {
    if (fact.label.length > FACT_LABEL_MAX) return `fact label exceeds ${FACT_LABEL_MAX} characters`;
    if (fact.value.length > FACT_VALUE_MAX) return `fact value exceeds ${FACT_VALUE_MAX} characters`;
  }
  for (const item of items) {
    if (item.title.length > ITEM_TITLE_MAX) return `item title exceeds ${ITEM_TITLE_MAX} characters`;
    if (item.price !== undefined && item.price.length > ITEM_PRICE_MAX) {
      return `item price exceeds ${ITEM_PRICE_MAX} characters`;
    }
    if (item.location !== undefined && item.location.length > ITEM_LOCATION_MAX) {
      return `item location exceeds ${ITEM_LOCATION_MAX} characters`;
    }
    if (item.detail !== undefined && item.detail.length > ITEM_DETAIL_MAX) {
      return `item detail exceeds ${ITEM_DETAIL_MAX} characters`;
    }
  }

  const total =
    (context.text?.length ?? 0) +
    facts.reduce((sum, f) => sum + f.label.length + f.value.length, 0) +
    items.reduce(
      (sum, it) =>
        sum + it.title.length + (it.price?.length ?? 0) + (it.location?.length ?? 0) + (it.detail?.length ?? 0),
      0,
    );
  if (total > MAX_CONTEXT_CHARS) return `context exceeds ${MAX_CONTEXT_CHARS} characters`;

  return undefined;
}

// --- A2: one journal line per request -------------------------------------
//
// Before this, the broker only logged handshake rejections and its own
// listen line — a request that hung (today's incident) or errored left
// nothing in `journalctl --user -u wingpen-broker` to even start diagnosing
// from. Exactly one line on receipt, one on completion; never page text,
// user content, or the pairing token — these go straight to the systemd
// journal and must stay safe to paste into a bug report as-is.
// L4 (lot7 security review): `id` is entirely client-supplied (protocol.ts
// only requires it to be a non-empty string — see isNonEmptyString) and, once
// authenticated, was logged raw here. Up to 256 KB of newlines/ANSI escapes
// in it could forge journal lines (including these very grant/reject-shaped
// ones). Every client-supplied value in these two lines goes through
// sanitizeLogValue(), same as Host/Origin elsewhere in this file.
// Amendement 2026-09-25 (types de page) — "Limites côté broker": "la ligne de
// réception ... peut porter pageKind validé et les nombres de faits et
// d'entrées ; jamais un libellé, une valeur, un titre ni aucun autre contenu
// de page." pageKind/factsCount/itemsCount are optional so chat/act (which
// carry no pageKind) keep their existing "-"/0/0 shape.
export function logRequestReceived(
  type: string,
  id: string,
  contextKind: string | undefined,
  textLength: number,
  pageKind?: string,
  factsCount = 0,
  itemsCount = 0,
): void {
  console.log(
    `wingpen-broker: request received type=${type} id=${sanitizeLogValue(id)} context=${contextKind ?? "-"} textLength=${textLength} pageKind=${pageKind ?? "-"} facts=${factsCount} items=${itemsCount}`,
  );
}

export function logRequestCompleted(id: string, outcome: string, elapsedMs: number): void {
  console.log(`wingpen-broker: request completed id=${sanitizeLogValue(id)} outcome=${outcome} elapsedMs=${elapsedMs}`);
}

// --- A1: systemd unit drift detection -------------------------------------
//
// Today's incident: the installed unit (~/.config/systemd/user/wingpen-broker.service)
// had drifted from packaging/wingpen-broker.service in the repo — it lost its
// `Environment=WINGPEN_CLAUDE_PATH` line — and the broker silently fell back
// to the SDK's broken bundled CLI. Diagnosis cost an hour. This can't prevent
// a drifted unit from being *used* (systemd already launched the process by
// the time this runs), but it can name the problem loudly instead of the
// broker hanging every request with no clue why.

/** Pure: true when the installed unit's content differs from the repo's. A
 * byte-for-byte compare is deliberate — the goal is catching "someone
 * hand-edited or forgot to re-copy the unit", not semantic diffing. */
export function unitFileDrifted(installedContent: string, repoContent: string): boolean {
  return installedContent !== repoContent;
}

/**
 * Startup-only, best-effort warning. Never throws, never blocks startup:
 *  - Skipped silently when not started by systemd — a bare `bun run
 *    src/server.ts` from a terminal has no INVOCATION_ID (see systemd.exec(5))
 *    and no installed unit to compare against.
 *  - Skipped silently when either file can't be read — a stripped-down
 *    deployment without a `packaging/` directory, or a permissions quirk,
 *    must never turn into a startup failure over a diagnostic nicety.
 */
export function checkUnitDriftAtStartup(
  paths: { installedUnitPath: string; repoUnitPath: string },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.INVOCATION_ID) return;
  let installed: string;
  let repo: string;
  try {
    installed = readFileSync(paths.installedUnitPath, "utf8");
    repo = readFileSync(paths.repoUnitPath, "utf8");
  } catch {
    return;
  }
  if (unitFileDrifted(installed, repo)) {
    console.warn(
      `wingpen-broker: attention — l'unité systemd installée (${paths.installedUnitPath}) diffère de ` +
        `${paths.repoUnitPath} dans le dépôt. Une ligne comme "Environment=WINGPEN_CLAUDE_PATH" a pu ` +
        `disparaître silencieusement (voir l'incident du 2026-09-21) : relancez ` +
        `"bash scripts/install-service.sh" pour la remettre à jour.`,
    );
  }
}

/** Pure: Origin header must exactly match chrome-extension://<one of allowedExtensionIds>. */
export function checkOrigin(origin: string | null | undefined, allowedExtensionIds: string[]): boolean {
  if (!origin) return false;
  return allowedExtensionIds.some((id) => origin === `chrome-extension://${id}`);
}

// Firefox's own extension origin scheme. The uuid is a standard RFC 4122
// v4-shaped string; Firefox assigns it randomly per install, so — unlike
// Chrome's "key"-derived id — it cannot be part of allowedExtensionIds ahead
// of time (see config.ts's loadFirefoxExtensionUuid comment).
const MOZ_EXTENSION_ORIGIN_RE = /^moz-extension:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Pure: extracts the uuid out of a moz-extension://<uuid> origin, or null if
 * `origin` isn't one. */
export function parseMozExtensionOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const match = MOZ_EXTENSION_ORIGIN_RE.exec(origin);
  return match ? match[1].toLowerCase() : null;
}

export type OriginDecision =
  | { ok: true; kind: "chrome" }
  | { ok: true; kind: "firefox-known" }
  // Origin looks like a Firefox install not (yet) in the pinned uuid list: the
  // connection may proceed to the hello step, but is NOT authenticated by
  // origin alone — only a valid pairing secret in the following hello
  // promotes it, and only then is its uuid pinned (see
  // handleHandshakeMessage). This is the one case where checkOrigin's usual
  // "reject before hello" guarantee is deliberately relaxed, because Firefox
  // gives us no way to know the uuid ahead of time.
  | { ok: true; kind: "firefox-provisional"; uuid: string }
  | { ok: false; kind: "rejected" };

/** Pure: decides what to do with a connection's Origin header, given the
 * Chrome allowlist and the CURRENT list of pinned Firefox uuids (amendement
 * 2026-09-25 — a list, not a single value: several profiles/installs/
 * temporary-loads can each pin their own uuid, none excluding the others).
 * Never accepts an origin that is neither a known-good chrome-extension://
 * id nor a moz-extension:// uuid eligible for (or already through) pairing. */
export function evaluateOrigin(
  origin: string | null | undefined,
  allowedExtensionIds: string[],
  pinnedFirefoxUuids: readonly string[],
): OriginDecision {
  if (checkOrigin(origin, allowedExtensionIds)) return { ok: true, kind: "chrome" };

  const uuid = parseMozExtensionOrigin(origin);
  if (uuid) {
    return pinnedFirefoxUuids.includes(uuid)
      ? { ok: true, kind: "firefox-known" }
      : { ok: true, kind: "firefox-provisional", uuid };
  }

  return { ok: false, kind: "rejected" };
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
  // evaluateOrigin()'s verdict for this connection's Origin header, recorded
  // at `open()` so handleHandshakeMessage can tell a known origin (chrome or
  // pinned Firefox — both auto-grant eligible, see "Appairage silencieux" in
  // docs/PROTOCOL.md) apart from a not-yet-pinned Firefox one.
  originKind: OriginDecision["kind"] | null;
}

function send(ws: { send(data: string): unknown }, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

// Client-controlled values (Host, Origin) are logged sanitized — control
// characters replaced with `?`, cut to 200 chars — see docs/PROTOCOL.md
// "Journalisation" (amendement 2026-09-25).
export function sanitizeLogValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "(none)";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200);
}

// A local process on the machine (not the intended extension) can open a
// WebSocket and probe the handshake. Distinct client-visible messages for
// "wrong Origin" / "wrong secret" / "no hello in time" would let it tell
// those apart — an oracle. Every failure gets this one generic message on the
// wire; the real reason goes to the broker's own stderr only.
const HANDSHAKE_FAILURE_MESSAGE = "unauthorized";

function sendUnauthorizedAndClose(ws: {
  close(code: number, reason: string): unknown;
  send(data: string): unknown;
}): void {
  send(ws, { type: "error", id: "hello", code: "unauthorized", message: HANDSHAKE_FAILURE_MESSAGE });
  ws.close(4401, HANDSHAKE_FAILURE_MESSAGE);
}

/** Origin check failure — `reject stage=origin` (docs/PROTOCOL.md
 * "Journalisation"). */
function rejectOrigin(
  ws: { close(code: number, reason: string): unknown; send(data: string): unknown },
  origin: string | null | undefined,
): void {
  console.error(`wingpen-broker: reject stage=origin origin=${sanitizeLogValue(origin)}`);
  sendUnauthorizedAndClose(ws);
}

/** Anything past the origin check (bad/missing hello, wrong secret, timeout)
 * — `reject stage=handshake` (docs/PROTOCOL.md "Journalisation"). The precise
 * `reason` only ever reaches the broker's own stderr, never the wire (see
 * HANDSHAKE_FAILURE_MESSAGE above). */
function rejectHandshake(
  ws: { close(code: number, reason: string): unknown; send(data: string): unknown },
  origin: string | null | undefined,
  reason: string,
): void {
  console.error(`wingpen-broker: reject stage=handshake origin=${sanitizeLogValue(origin)} reason=${reason}`);
  sendUnauthorizedAndClose(ws);
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
  startedAt: number,
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
      logRequestCompleted(id, "cancelled", Date.now() - startedAt);
    } else {
      send(ws, { type: "done", id, usage });
      logRequestCompleted(id, "ok", Date.now() - startedAt);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      send(ws, { type: "error", id, code: "cancelled", message: "request cancelled" });
      logRequestCompleted(id, "cancelled", Date.now() - startedAt);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      const code = isAuthRequiredError(err) ? "auth-required" : isModelUnavailableError(err) ? "model-unavailable" : "internal";
      send(ws, { type: "error", id, code, message });
      const outcome = err instanceof ModelTimeoutError ? "timeout" : `error:${code}`;
      logRequestCompleted(id, outcome, Date.now() - startedAt);
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
  const opts: ProviderRuntimeOptions = { model: config.model, ollamaUrl: config.ollamaUrl, apiKey: config.apiKey };
  // `configured` (task 2) deliberately omits `model`: it answers "does this
  // provider have what it needs at all" (a stored key, a reachable daemon, an
  // installed CLI) — independent of whether the *currently selected* model
  // happens to be valid for it, which `available` (above, with the full
  // opts) already covers. For ollama this turns isAvailable()'s "model X not
  // installed" branch off, leaving only the daemon-reachability check —
  // exactly "its URL answers" per the task brief.
  const configuredOpts: ProviderRuntimeOptions = { ollamaUrl: config.ollamaUrl, apiKey: config.apiKey };
  const available = await Promise.all(
    PROVIDERS.map(async (p): Promise<ProviderStatus> => {
      const configured = await p
        .isAvailable(configuredOpts)
        .then((r) => r.available)
        .catch(() => false);
      try {
        const a = await p.isAvailable(opts);
        return { id: p.id as ProviderId, label: p.label, available: a.available, reason: a.reason, configured };
      } catch (err) {
        return {
          id: p.id as ProviderId,
          label: p.label,
          available: false,
          reason: err instanceof Error ? err.message : String(err),
          configured,
        };
      }
    }),
  );
  const active = getProvider(provider);
  const models = active?.listModels ? await active.listModels(opts).catch(() => undefined) : undefined;
  return { provider, model: config.model, available, models };
}

// --- settings.test (task 3): "Tester la connexion" backend ------------------
//
// A real, minimal model call — a few tokens, not a summarize — bounded by
// SETTINGS_TEST_TIMEOUT_MS so the panel's button can never hang. Runs
// against whichever provider id the message names, not necessarily the one
// currently selected: the user can test a provider before switching to it.
export const SETTINGS_TEST_TIMEOUT_MS = 20_000;

function settingsTestSuccessMessage(providerId: ProviderId): string {
  switch (providerId) {
    case "claude-api":
      return "Connexion à l'API Anthropic réussie.";
    case "ollama":
      return "Connexion à Ollama réussie.";
    case "claude-cli":
      return "Connexion à Claude Code réussie.";
  }
}

/** French, names the remedy — never the raw error text (which is English and
 * provider-internal), per task brief: wrong key, Ollama not running, expired
 * Claude Code session. */
function settingsTestFailureMessage(providerId: ProviderId, err: unknown): string {
  if (isAuthRequiredError(err)) {
    // Already French and already names the remedy (claude-cli's
    // AUTH_REQUIRED_MESSAGE or claude-api's CLAUDE_API_AUTH_MESSAGE).
    return (err as Error).message;
  }
  if (err instanceof ModelTimeoutError) {
    return "La vérification a dépassé le délai imparti — réessayez.";
  }
  switch (providerId) {
    case "claude-api":
      return "Impossible de joindre l'API Anthropic — vérifiez la clé ou votre connexion réseau.";
    case "ollama":
      return "Ollama ne répond pas — vérifiez qu'il est bien lancé sur cette machine.";
    case "claude-cli":
      return "Impossible de lancer Claude Code — vérifiez l'installation du CLI.";
  }
}

export async function testProviderConnection(
  providerId: ProviderId,
  config: WingpenConfig,
): Promise<{ ok: boolean; message: string }> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, message: "Fournisseur inconnu." };

  if (providerId === "claude-api" && !config.apiKey) {
    return { ok: false, message: "Aucune clé API configurée — ajoutez-la dans les réglages." };
  }
  if (providerId === "ollama" && !config.model) {
    return { ok: false, message: "Aucun modèle Ollama configuré — choisissez-en un dans les réglages." };
  }

  const opts: ProviderRuntimeOptions = { model: config.model, ollamaUrl: config.ollamaUrl, apiKey: config.apiKey };
  const built = buildPrompt({ kind: "chat", text: "Réponds uniquement par le mot ok." });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SETTINGS_TEST_TIMEOUT_MS);
  try {
    for await (const _event of provider.streamAnswer(built, {
      ...opts,
      signal: controller.signal,
      timeoutMs: SETTINGS_TEST_TIMEOUT_MS,
    })) {
      // Draining only — a minimal connectivity probe, no chunk reaches the
      // client (the extension only cares about ok/message, see PROTOCOL.md).
    }
    return { ok: true, message: settingsTestSuccessMessage(providerId) };
  } catch (err) {
    return { ok: false, message: settingsTestFailureMessage(providerId, err) };
  } finally {
    clearTimeout(timer);
  }
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
  /** Applies provider/model/apiKey fields from a settings.set message,
   * persists to config.json when a configDir was supplied to startServer,
   * and returns the resulting config. */
  applySettings(patch: Pick<SettingsSetMessage, "provider" | "model" | "apiKey">): WingpenConfig;
  /** `provider.status` for the currently active provider, through the
   * broker-wide ProviderStatusCache (see docs/PROTOCOL.md "Disponibilité du
   * fournisseur"). */
  getProviderStatus(): ReturnType<ProviderStatusCache["get"]>;
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
      const startedAt = Date.now();
      const textLength = message.text.length + (message.context?.text?.length ?? 0);
      logRequestReceived(
        "chat",
        message.id,
        message.context?.kind,
        textLength,
        message.context?.pageKind,
        message.context?.facts?.length ?? 0,
        message.context?.items?.length ?? 0,
      );
      if (contextTooLarge(message.text)) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: "text exceeds 40000 characters" });
        logRequestCompleted(message.id, "error:context-too-large", Date.now() - startedAt);
        return;
      }
      const chatBudgetError = contextBudgetError(message.context);
      if (chatBudgetError) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: chatBudgetError });
        logRequestCompleted(message.id, "error:context-too-large", Date.now() - startedAt);
        return;
      }
      if (active.size >= MAX_CONCURRENT_STREAMS) {
        send(ws, { type: "error", id: message.id, code: "bad-request", message: `too many concurrent requests (max ${MAX_CONCURRENT_STREAMS} per connection)` });
        logRequestCompleted(message.id, "error:bad-request", Date.now() - startedAt);
        return;
      }
      const built = buildPrompt({ kind: "chat", text: message.text, context: message.context });
      void runStream(ws, active, message.id, built, settingsCtx.provider, settingsCtx.providerOpts, startedAt);
      return;
    }
    case "summarize": {
      const startedAt = Date.now();
      logRequestReceived(
        "summarize",
        message.id,
        message.context.kind,
        message.context.text?.length ?? 0,
        message.context.pageKind,
        message.context.facts?.length ?? 0,
        message.context.items?.length ?? 0,
      );
      const summarizeBudgetError = contextBudgetError(message.context);
      if (summarizeBudgetError) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: summarizeBudgetError });
        logRequestCompleted(message.id, "error:context-too-large", Date.now() - startedAt);
        return;
      }
      if (active.size >= MAX_CONCURRENT_STREAMS) {
        send(ws, { type: "error", id: message.id, code: "bad-request", message: `too many concurrent requests (max ${MAX_CONCURRENT_STREAMS} per connection)` });
        logRequestCompleted(message.id, "error:bad-request", Date.now() - startedAt);
        return;
      }
      const built = buildPrompt({ kind: "summarize", context: message.context, length: message.length });
      void runStream(ws, active, message.id, built, settingsCtx.provider, settingsCtx.providerOpts, startedAt);
      return;
    }
    case "act": {
      const startedAt = Date.now();
      logRequestReceived("act", message.id, undefined, message.text.length);
      if (contextTooLarge(message.text)) {
        send(ws, { type: "error", id: message.id, code: "context-too-large", message: "text exceeds 40000 characters" });
        logRequestCompleted(message.id, "error:context-too-large", Date.now() - startedAt);
        return;
      }
      if (active.size >= MAX_CONCURRENT_STREAMS) {
        send(ws, { type: "error", id: message.id, code: "bad-request", message: `too many concurrent requests (max ${MAX_CONCURRENT_STREAMS} per connection)` });
        logRequestCompleted(message.id, "error:bad-request", Date.now() - startedAt);
        return;
      }
      const built = buildPrompt({
        kind: "act",
        action: message.action,
        text: message.text,
        params: message.params,
      });
      void runStream(ws, active, message.id, built, settingsCtx.provider, settingsCtx.providerOpts, startedAt);
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
      const updated = settingsCtx.applySettings({
        provider: message.provider,
        model: message.model,
        apiKey: message.apiKey,
      });
      void buildSettingsPayload(updated).then((payload) => {
        send(ws, { type: "settings", id: message.id, ...payload });
      });
      return;
    }
    case "settings.test": {
      void testProviderConnection(message.provider, settingsCtx.getConfig()).then(({ ok, message: resultMessage }) => {
        send(ws, { type: "settings.test-result", id: message.id, provider: message.provider, ok, message: resultMessage });
      });
      return;
    }
    case "provider.status": {
      void settingsCtx.getProviderStatus().then((result) => {
        send(ws, {
          type: "provider.status-result",
          id: message.id,
          provider: result.provider,
          state: result.state,
          reason: result.reason,
          checkedAt: result.checkedAt,
        });
      });
      return;
    }
  }
}

/**
 * Handshake decision table (docs/PROTOCOL.md "Poignée de main", amendement
 * 2026-09-25):
 *
 * | origin (step 1)      | no secret    | permanent secret valid | session token valid | other |
 * |-----------------------|--------------|-------------------------|----------------------|-------|
 * | allowed (chrome)      | silent grant | grant                   | grant                | reject|
 * | pinned (firefox)      | silent grant | grant                   | grant                | reject|
 * | provisional (firefox) | reject       | grant AND pin           | reject               | reject|
 *
 * A session token is only valid when issued to the SAME origin and that
 * origin is still allowed/pinned at hello time — `knownKind` below is
 * exactly that "still allowed or pinned" check, computed by evaluateOrigin()
 * at `open()` from the CURRENT pin list (re-read every WebSocket open — see
 * config.ts's loadFirefoxPins).
 */
function handleHandshakeMessage(
  ws: { close(code: number, reason: string): unknown; send(data: string): unknown; data: ConnData },
  raw: string,
  pairingSecret: string,
  sessionTokens: SessionTokenStore,
  firefoxDirs: Pick<Dirs, "dataDir">,
  allowedExtensionIds: string[],
): void {
  if (ws.data.helloTimer) {
    clearTimeout(ws.data.helloTimer);
    ws.data.helloTimer = null;
  }
  const origin = ws.data.origin;
  const result = parseClientMessage(raw);
  if (!result.ok || result.message.type !== "hello") {
    rejectHandshake(ws, origin, "expected hello message with pairing secret");
    return;
  }

  // L1 (lot7 security review): the decision recorded at open() (in
  // ws.data.originKind) can go stale — a pin deleted by hand during the up
  // to 3s window before this hello arrives must not still be honoured. Every
  // hello re-reads the pin list and re-runs evaluateOrigin() fresh, rather
  // than trusting the value computed at open() — same fail-closed posture as
  // L2: any I/O error here (loadFirefoxPins can throw) is treated exactly
  // like a rejected origin, never like a known one.
  let originKind: OriginDecision["kind"];
  try {
    const pins = loadFirefoxPins(firefoxDirs);
    originKind = evaluateOrigin(origin, allowedExtensionIds, pins.map((p) => p.uuid)).kind;
  } catch {
    originKind = "rejected";
  }
  if (originKind === "rejected") {
    rejectHandshake(ws, origin, "origin no longer valid at hello time");
    return;
  }
  ws.data.originKind = originKind;

  const knownKind = originKind === "chrome" || originKind === "firefox-known";
  // Non-null for both firefox-known and firefox-provisional origins — used
  // to touch `lastSeen` on every grant and, for a provisional origin, to pin.
  const firefoxUuid = parseMozExtensionOrigin(origin);

  /** Finalizes a grant: records the Firefox pin/lastSeen touch (if this
   * origin is a moz-extension:// one — recordFirefoxSeen creates a fresh pin
   * only when `mayCreate` is true, otherwise just refreshes lastSeen for an
   * EXISTING entry and is a no-op for a missing one), marks the connection
   * authed, logs, and replies hello-ok. L2 (lot7 security review): wrapped in
   * try/catch — a throw here (e.g. recordFirefoxSeen's file I/O) used to
   * leave the socket authed=false with its helloTimer already cleared
   * (see the top of this function), so it would never time out either;
   * now it fails the handshake explicitly instead. */
  function grant(via: "silent" | "secret" | "session", token: string): void {
    try {
      if (firefoxUuid) {
        const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
        // mayCreate (L1): only the permanent-secret path on a not-yet-pinned
        // (provisional) origin may CREATE a pin. The silent and session-token
        // paths only ever touch an existing entry's lastSeen — per the
        // decision table above (and docs/PROTOCOL.md), neither can reach
        // this function unless `knownKind` was already true, i.e. the origin
        // is already pinned, so mayCreate:false here is a pure safety net,
        // not a normal path.
        const mayCreate = via === "secret" && originKind === "firefox-provisional";
        const pinResult = recordFirefoxSeen(firefoxDirs, firefoxUuid, nowIso, mayCreate);
        // grant/pin/evict/reject all go to stderr (docs/PROTOCOL.md
        // "Journalisation") — item 7, lot7 security review: these three used
        // console.log (stdout) until now, the odd ones out among this file's
        // reject* lines, which were already console.error.
        if (pinResult.pinned) console.error(`wingpen-broker: pin uuid=${sanitizeLogValue(firefoxUuid)}`);
        if (pinResult.evicted) {
          console.error(
            `wingpen-broker: evict uuid=${sanitizeLogValue(pinResult.evicted.uuid)} lastSeen=${sanitizeLogValue(pinResult.evicted.lastSeen)}`,
          );
        }
      }
      ws.data.authed = true;
      console.error(`wingpen-broker: grant via=${via} origin=${sanitizeLogValue(origin)}`);
      send(ws, { type: "hello-ok", v: 1, models: ["claude"], capabilities: ["chat", "summarize"], token });
    } catch {
      rejectHandshake(ws, origin, "grant failed");
    }
  }

  const secret = result.message.secret;

  if (secret === undefined) {
    // No secret at all: silent-pairing request (see HelloMessage.secret and
    // docs/PROTOCOL.md "Appairage silencieux", extended 2026-09-25 to pinned
    // Firefox uuids alongside allowed chrome-extension ids). A provisional
    // (not-yet-pinned) Firefox origin gets nothing here — first use is still
    // a deliberate secret paste.
    if (!knownKind) {
      rejectHandshake(ws, origin, "hello without a secret is only allowed for an already-trusted origin");
      return;
    }
    grant("silent", sessionTokens.issue(origin ?? ""));
    return;
  }

  if (checkSecret(secret, pairingSecret)) {
    // Permanent secret: grants for any of the three origin kinds reachable
    // here (a "rejected" kind never reaches hello — the connection is closed
    // at open()). For a provisional origin, this is also the ONLY thing that
    // pins it.
    grant("secret", sessionTokens.issue(origin ?? ""));
    return;
  }

  // Not the permanent secret — maybe a session token. Only chrome/pinned
  // origins are eligible (see docs/PROTOCOL.md's decision table); the token
  // must have been issued to THIS SAME origin string.
  if (knownKind) {
    const tokenOrigin = sessionTokens.lookupOrigin(secret);
    if (tokenOrigin !== null && tokenOrigin === origin) {
      grant("session", secret); // same token echoed back, no rotation
      return;
    }
  }

  rejectHandshake(ws, origin, "invalid pairing secret or session token");
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

// --- Admission (Host allowlist + peer UID) — docs/PROTOCOL.md "Admission
// HTTP et WebSocket" (amendement 2026-09-25). Applied before ANY routing, on
// every HTTP request (/pair, /ws before upgrade, unknown routes included). --

type AdmissionOutcome =
  | { ok: true }
  | { ok: false; stage: "host"; host: string | null }
  | { ok: false; stage: "peer"; peerUid: number | null };

/** Bun-provided IP lookup, narrowed to what admitRequest needs — a thin seam
 * so tests could substitute it, though the integration tests below exercise
 * the real Bun.serve/server.requestIP path directly. */
interface RequestIpSource {
  requestIP(req: Request): { address: string; port: number } | null;
}

function admitRequest(req: Request, server: RequestIpSource, port: number): AdmissionOutcome {
  const host = req.headers.get("host");
  if (!isHostAllowed(host, port)) {
    return { ok: false, stage: "host", host };
  }
  // Peer-UID check: Linux only (docs/PROTOCOL.md "Frontière de menace" — not
  // enforced elsewhere, logged once at startup instead, see startServer).
  if (process.platform === "linux") {
    const ip = server.requestIP(req);
    let uid: number | null = null;
    if (ip) {
      let procNetTcp: string | undefined;
      let procNetTcp6: string | undefined;
      try {
        procNetTcp = readFileSync("/proc/net/tcp", "utf8");
      } catch {
        // Unreadable: treated as "not found" below — fail closed.
      }
      try {
        procNetTcp6 = readFileSync("/proc/net/tcp6", "utf8");
      } catch {
        // ditto
      }
      uid = resolvePeerUid({
        procNetTcp,
        procNetTcp6,
        peerAddress: ip.address,
        peerPort: ip.port,
        serverPort: port,
      });
    }
    if (uid === null || uid !== process.getuid?.()) {
      return { ok: false, stage: "peer", peerUid: uid };
    }
  }
  return { ok: true };
}

function logAdmissionRejection(outcome: Extract<AdmissionOutcome, { ok: false }>): void {
  if (outcome.stage === "host") {
    console.error(`wingpen-broker: reject stage=host host=${sanitizeLogValue(outcome.host)}`);
  } else {
    const detail = outcome.peerUid === null ? "reason=not-found" : `peerUid=${outcome.peerUid}`;
    console.error(`wingpen-broker: reject stage=peer ${detail}`);
  }
}

const FORBIDDEN_RESPONSE_HEADERS = { "content-type": "text/plain" };

export function startServer(config: WingpenConfig, pairingSecret: string, dirs: ServerDirs) {
  const promptsDirs: PromptsDirs = { dataDir: dirs.dataDir };
  const firefoxDirs: Pick<Dirs, "dataDir"> = { dataDir: dirs.dataDir };
  const pinsFilePath = join(dirs.dataDir, FIREFOX_UUIDS_FILENAME);

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

  // Session tokens and the provider-status probe cache are broker-wide (one
  // broker instance serves one user across many connections/panel opens),
  // never per-connection — see docs/PROTOCOL.md "Jeton de session" and
  // "Disponibilité du fournisseur".
  const sessionTokens = new SessionTokenStore();
  const providerStatusCache = new ProviderStatusCache();

  console.log(
    `wingpen-broker: peer-uid check: ${
      process.platform === "linux" ? "enforced (linux)" : `NOT enforced on ${process.platform}`
    }`,
  );

  function settingsCtx(): SettingsCtx {
    const cfg = currentConfig;
    const providerId = cfg.provider ?? DEFAULT_CONFIG.provider!;
    const providerOpts: ProviderRuntimeOptions = { model: cfg.model, ollamaUrl: cfg.ollamaUrl, apiKey: cfg.apiKey };
    return {
      provider: getProvider(providerId) ?? getProvider(DEFAULT_CONFIG.provider)!,
      providerOpts,
      getConfig: () => currentConfig,
      applySettings(patch) {
        if (patch.provider !== undefined) currentConfig = { ...currentConfig, provider: patch.provider };
        if (patch.model !== undefined) currentConfig = { ...currentConfig, model: patch.model };
        // Empty string means "forget the stored key" (task 2) — spreading
        // `apiKey: undefined` drops the key entirely from the JSON written by
        // saveConfig (JSON.stringify omits undefined-valued keys), so a
        // forgotten key leaves no trace on disk either.
        if (patch.apiKey !== undefined) {
          currentConfig = { ...currentConfig, apiKey: patch.apiKey === "" ? undefined : patch.apiKey };
        }
        if (dirs.configDir) saveConfig({ configDir: dirs.configDir }, currentConfig);
        // docs/PROTOCOL.md "Disponibilité du fournisseur": "Un settings.set
        // réussi vide le cache."
        providerStatusCache.clear();
        return currentConfig;
      },
      getProviderStatus: () => providerStatusCache.get(providerId, providerOpts),
    };
  }

  return Bun.serve<ConnData, {}>({
    hostname: "127.0.0.1", // NEVER 0.0.0.0 — see CLAUDE.md non-negotiable rule #2.
    port: config.port,
    fetch(req, server) {
      // "le port" always means the port ACTUALLY listened on (server.port),
      // not the requested one — matters for tests (`port: 0`, OS-assigned) —
      // see docs/PROTOCOL.md "Transport": "Toutes les vérifications qui
      // citent « le port »... utilisent le port effectivement écouté."
      const admission = admitRequest(req, server, server.port);
      if (!admission.ok) {
        logAdmissionRejection(admission);
        return new Response("forbidden", { status: 403, headers: FORBIDDEN_RESPONSE_HEADERS });
      }

      const url = new URL(req.url);

      if (url.pathname === "/pair") {
        if (req.method !== "GET") {
          return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
        }
        // L5 (lot7 security review), amendement 2026-09-25 ter: /pair only
        // answers a top-level navigation — Sec-Fetch-Mode: navigate AND
        // Sec-Fetch-Dest: document — else 403. Defense in depth only (a
        // fetch() from another extension's service worker, which has a
        // 127.0.0.1 host permission, no longer reads the permanent secret
        // this way; an extension that opens a TAB on /pair and injects a
        // content script still reads it — only Native Messaging closes that
        // path). Every modern Chromium/Firefox sends both headers on a real
        // navigation; a same-origin `fetch()` or `<img>`/`<script>` load
        // never does.
        if (req.headers.get("sec-fetch-mode") !== "navigate" || req.headers.get("sec-fetch-dest") !== "document") {
          return new Response("forbidden", { status: 403, headers: FORBIDDEN_RESPONSE_HEADERS });
        }
        const pins = loadFirefoxPins(firefoxDirs);
        const html = renderPairPage({
          port: server.port,
          token: pairingSecret,
          pinned: pins.map((p) => ({ uuid: p.uuid, pinnedAt: p.pinnedAt, lastSeen: p.lastSeen })),
          pinsFilePath,
        });
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
            "x-content-type-options": "nosniff",
            "cross-origin-resource-policy": "same-origin",
          },
        });
      }

      if (url.pathname !== "/ws") {
        return new Response("not found", { status: 404 });
      }

      const origin = req.headers.get("origin");
      const upgraded = server.upgrade(req, {
        data: {
          origin,
          authed: false,
          active: new Map(),
          helloTimer: null,
          originKind: null,
        } satisfies ConnData,
      });
      if (!upgraded) {
        return new Response("expected websocket upgrade", { status: 400 });
      }
      return undefined;
    },
    websocket: {
      open(ws) {
        // L2 (lot7 security review): the hello timer is armed FIRST, before
        // any file I/O — an unauthenticated socket must always time out, even
        // if the origin evaluation below throws (unreadable pins file, EISDIR,
        // a chmod EPERM). close() (below) clears this timer either way, so
        // rejecting the origin right after arming it is not a leak.
        ws.data.helloTimer = setTimeout(() => {
          rejectHandshake(ws, ws.data.origin, "handshake timeout: no hello within 3s");
        }, 3000);

        let decision: OriginDecision;
        try {
          // Firefox pin list is relu à chaud — re-read from disk at EVERY
          // WebSocket open, never cached — see docs/PROTOCOL.md "Cas Firefox".
          const pins = loadFirefoxPins(firefoxDirs);
          decision = evaluateOrigin(ws.data.origin, config.allowedExtensionIds, pins.map((p) => p.uuid));
        } catch {
          // Fail closed (L2): a failure to even READ the pin list must never
          // fall through to "origin unknown, treat as allowed" — it is
          // treated exactly like an explicitly rejected origin.
          rejectOrigin(ws, ws.data.origin);
          return;
        }
        if (!decision.ok) {
          rejectOrigin(ws, ws.data.origin);
          return;
        }
        ws.data.originKind = decision.kind;
      },
      message(ws, raw) {
        const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
        if (!ws.data.authed) {
          handleHandshakeMessage(ws, text, pairingSecret, sessionTokens, firefoxDirs, config.allowedExtensionIds);
          return;
        }
        // Oversized, post-auth: docs/PROTOCOL.md "Limites côté broker" —
        // checked on the raw byte length BEFORE any parsing (the message is
        // never analyzed, its own `id` is never looked for).
        if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
          console.error(`wingpen-broker: reject stage=oversized origin=${sanitizeLogValue(ws.data.origin)}`);
          send(ws, {
            type: "error",
            id: "oversized",
            code: "bad-request",
            message: `message exceeds ${MAX_MESSAGE_BYTES} byte cap`,
          });
          ws.close(1009, "oversized");
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
  // A1: warn (never block) if the unit we were launched from has drifted
  // from the repo's packaging/wingpen-broker.service — see
  // checkUnitDriftAtStartup's doc for exactly what today's incident was.
  checkUnitDriftAtStartup({
    installedUnitPath: join(homedir(), ".config", "systemd", "user", "wingpen-broker.service"),
    repoUnitPath: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packaging", "wingpen-broker.service"),
  });
  const dirs: Dirs = defaultDirs();
  const config = loadConfig(dirs);
  // WINGPEN_PORT is for tests only (a free port for a test server) — the
  // extension only ever knows 8787, see config.ts's FIXED_PORT and
  // docs/PROTOCOL.md "Transport".
  if (process.env.WINGPEN_PORT) {
    console.log(`wingpen-broker: WINGPEN_PORT=${process.env.WINGPEN_PORT} — mode test, l'extension ne se connectera pas`);
  }
  const port = Number(process.env.WINGPEN_PORT) || config.port;
  const pairingSecret = loadOrCreatePairingSecret(dirs);
  // CHANGE 2 (2026-09-21): fail fast if claude-cli would silently fall back
  // to the SDK's broken bundled CLI — never affects the ollama provider. See
  // assertClaudeExecutableIsUsable's doc.
  if ((config.provider ?? DEFAULT_CONFIG.provider) === "claude-cli") {
    try {
      assertClaudeExecutableIsUsable();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
  const server = startServer({ ...config, port }, pairingSecret, {
    dataDir: dirs.dataDir,
    configDir: dirs.configDir,
  });
  console.log(`wingpen-broker listening on ws://127.0.0.1:${server.port}/ws`);
}
