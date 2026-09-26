// The "claude-cli" provider: talks to the local Claude Code install through
// @anthropic-ai/claude-agent-sdk. No tools are ever enabled — this provider
// only ever wants text back. Prompt assembly (fencing, system prompt) lives
// in ../model.ts and is shared by every provider — see ../model.ts's header.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync, execFile } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSystemPrompt,
  MODEL_TIMEOUT_MS,
  ModelTimeoutError,
  AuthRequiredError,
  type AnswerEvent,
  type BuiltPrompt,
  type StreamAnswerOptions,
} from "../model.ts";
import type { Availability, ModelProvider, ProviderRuntimeOptions, StatusCheck } from "./types.ts";

// Testing seam: production code always drives the real SDK `query`. Tests
// substitute a fake here to exercise the streaming/timeout/cancel paths
// without a live `claude` binary. Not part of the public API — only
// broker/test/*.test.ts should call the two functions below.
let queryImpl: typeof query = query;
export function __setQueryImplForTests(fn: typeof query): void {
  queryImpl = fn;
}
export function __resetQueryImplForTests(): void {
  queryImpl = query;
}

/**
 * Resolves which `claude` binary the SDK should drive.
 *
 * The SDK ships its OWN bundled copy of the CLI and uses it by default. Measured
 * 2026-09-16: that bundled copy (2.0.77) dies at startup with
 * `EEXIST: mkdir '<config dir>/todos'` whenever the directory already exists,
 * which surfaced here as the opaque `Claude Code process exited with code 1`.
 * The CLI installed on the machine (2.1.273) runs the same prompt fine. So we
 * point the SDK at the installed one and keep the bundled copy as a last resort.
 *
 * Override with WINGPEN_CLAUDE_PATH when the user's install lives elsewhere.
 */
function resolveClaudeExecutable(): string | undefined {
  const override = process.env.WINGPEN_CLAUDE_PATH;
  if (override) return override;
  try {
    const found = execFileSync("sh", ["-c", "command -v claude"], { encoding: "utf8" }).trim();
    if (found) return realpathSync(found);
  } catch {
    // Not on PATH — fall through and let the SDK use its bundled copy.
  }
  return undefined;
}

const CLAUDE_EXECUTABLE = resolveClaudeExecutable();

/**
 * The path the SDK falls back to when `pathToClaudeCodeExecutable` is not
 * passed — its own bundled `cli.js`, next to `sdk.mjs` (mirrors the SDK's own
 * `join(dirname(import.meta.url), "cli.js")`; see sdk.mjs). Computed only to
 * name this path in the startup log/error below — never passed to queryImpl.
 */
export function bundledClaudeExecutablePath(): string {
  try {
    const entry = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
    return join(dirname(fileURLToPath(entry)), "cli.js");
  } catch {
    return "<the SDK's bundled cli.js, inside node_modules/@anthropic-ai/claude-agent-sdk>";
  }
}

/** Pure: the error assertClaudeExecutableIsUsable() throws when only the
 * SDK-bundled copy resolved. Factored out so it's testable without depending
 * on this module's own top-level CLAUDE_EXECUTABLE (resolved once, from
 * PATH/WINGPEN_CLAUDE_PATH, at import time). */
export function buildBundledFallbackError(bundledPath: string): Error {
  return new Error(
    `claude-cli: no real 'claude' install found (checked WINGPEN_CLAUDE_PATH and PATH) — would fall back ` +
      `to the SDK's own bundled copy at ${bundledPath}, which is known broken and hangs every request with no ` +
      `error. Set WINGPEN_CLAUDE_PATH to a working 'claude' executable, or put one on PATH, then restart.`,
  );
}

/**
 * Startup guard (CHANGE 2, 2026-09-21): logs which executable this provider
 * will drive, and fails fast — instead of starting and hanging on the first
 * request — if that resolves to the SDK's own bundled `cli.js`. That bundled
 * copy is broken (measured 2026-09-16: `EEXIST: mkdir '<config dir>/todos'`
 * at its own startup) and every request against it hangs with no chunk, no
 * `done`, no `error` — silent, because resolveClaudeExecutable() above only
 * ever fails soft (falls through to `undefined`, letting the SDK's default
 * apply). An installed systemd unit losing its `WINGPEN_CLAUDE_PATH` line
 * (drift from packaging/wingpen-broker.service) reproduces exactly this and
 * cost an hour to diagnose — hence failing at startup, loudly, instead.
 *
 * Called once from server.ts's `import.meta.main` entrypoint, and ONLY when
 * claude-cli is the active provider — never at module load (this file is
 * always imported by providers/registry.ts, including when ollama is
 * active, so importing it must never itself throw or log).
 */
export function assertClaudeExecutableIsUsable(): void {
  if (CLAUDE_EXECUTABLE) {
    console.log(`wingpen-broker: claude-cli provider will drive ${CLAUDE_EXECUTABLE}`);
    return;
  }
  const bundled = bundledClaudeExecutablePath();
  console.log(`wingpen-broker: claude-cli provider will drive ${bundled} (SDK-bundled fallback)`);
  throw buildBundledFallbackError(bundled);
}

/**
 * Phrases the real `claude` CLI is known to emit (stderr, or the message of
 * its own thrown errors) when the local session is not authenticated or has
 * expired. Sourced 2026-09-21 by grepping the installed CLI's bundled
 * strings for its own `/login` copy (`Please run /login…`, `Invalid API
 * key`, `Your session has expired`, `authentication_failed`, etc.) — see
 * docs/PROTOCOL.md's `auth-required` entry. Kept case-insensitive and
 * intentionally not anchored to exact CLI wording: a version bump that
 * rephrases the message must not silently regress this to a generic
 * `internal` error (task C3's requirement).
 */
const AUTH_REQUIRED_PATTERNS: RegExp[] = [
  /please run\s+\/login/i,
  /\bnot authenticated\b/i,
  /\bnot logged in\b/i,
  /invalid api key/i,
  /session (?:has )?expired/i,
  /token (?:has )?expired/i,
  /re-?authenticate/i,
  /authentication[_ ]?error/i,
  /authentication[_ ]?failed/i,
  /you must be logged in/i,
];

// Tolerant fallback: stderr that clearly talks about login/session/auth but
// doesn't match one of the exact phrases above is still classified as
// auth-required rather than falling through to an opaque `internal` error —
// per C3's spec, the remedy (`claude /login`) is the same either way, and
// guessing wrong here costs the user one no-op login attempt, whereas
// guessing "internal" sends them looking for a bug that doesn't exist.
const AUTH_KEYWORD_HINT = /\blogin\b|\blogged in\b|\bauthenticat/i;

/** Pure: true when `stderrText` (accumulated from the CLI subprocess, see
 * streamAnswer below) looks like an auth/session failure. Exported for
 * tests. */
export function looksLikeAuthFailure(stderrText: string): boolean {
  const text = stderrText.trim();
  if (!text) return false;
  return AUTH_REQUIRED_PATTERNS.some((re) => re.test(text)) || AUTH_KEYWORD_HINT.test(text);
}

// How much of the CLI's own words to keep in the error message/journal line
// (2026-09-26 amendment, docs/PROTOCOL.md): enough to diagnose, short enough
// to stay a log line rather than a dump.
const CLI_REASON_MAX_LENGTH = 300;

/** Pure: makes CLI-sourced text safe to put in an error message and a journal
 * log line — strips control chars (a hostile/broken CLI build could emit
 * ANSI escapes or newlines), collapses whitespace, and caps the length.
 * Exported for tests. Returns "" for empty/whitespace-only input. */
export function sanitizeCliReason(text: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, CLI_REASON_MAX_LENGTH);
}

// How long the confirmation probe below may take before we give up on it and
// let the original error through unchanged. The real CLI answers an expired
// session in ~3s; 15s is slack, not a target.
const AUTH_PROBE_TIMEOUT_MS = 15_000;

/**
 * Last-resort confirmation that a failed query was an authentication problem.
 *
 * Measured 2026-09-21, and the whole reason this function exists: the Claude
 * CLI prints "Failed to authenticate: OAuth session expired and could not be
 * refreshed" on **stdout**, not stderr. The SDK owns stdout (it parses its
 * JSON stream there) and only forwards stderr to our callback, so the text
 * that names the real problem never reaches looksLikeAuthFailure() — we get
 * an opaque "Claude Code process exited with code 1" instead, and the user
 * gets told the model is unreachable when in fact they just need to log in.
 *
 * So when a query fails and stderr told us nothing, we ask the CLI directly.
 * ASYNC end to end (lot7 security review, M1): a routine cancel/close used to
 * run a SYNCHRONOUS `execFileSync(claude, ["-p","ping"])` here, blocking the
 * whole broker's event loop for up to AUTH_PROBE_TIMEOUT_MS — and it was a
 * real, billed model call, made with the user's full Claude Code settings
 * (hooks, MCP servers), just to confirm a cancel. Two steps now: first the
 * free `claude auth status` (checkStatus() below, already used by
 * `provider.status`) — `loggedIn: false` alone confirms an auth failure, no
 * model call needed. Only when `loggedIn: true` (the free check found nothing
 * wrong) do we fall back to the billed `-p ping` confirmation, itself async
 * via execFile with a hard timeout and SIGKILL (never SIGTERM, which a CLI
 * that ignores it could hang on indefinitely — see L3, provider-status.ts).
 * Callers must never invoke this when the request was aborted by the user —
 * see streamAnswer's `abortController.signal.aborted` check below, which
 * returns before reaching this function at all.
 */
async function probeAuthFailure(): Promise<boolean> {
  if (!CLAUDE_EXECUTABLE) return false;
  const status = await checkStatus();
  if (status.state === "ko" && status.reason === "not-logged-in") return true;
  if (status.state !== "ok") return false; // unknown/probe-failed/cli-missing: can't confirm either way
  return new Promise<boolean>((resolve) => {
    execFileImpl(
      CLAUDE_EXECUTABLE!,
      ["-p", "ping"],
      { timeout: AUTH_PROBE_TIMEOUT_MS, killSignal: "SIGKILL", encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) {
          // The probe succeeded, so the session is fine and the original
          // failure was something else. Leave the caller's error alone.
          resolve(false);
          return;
        }
        const e = err as { stdout?: string; stderr?: string; message?: string };
        resolve(
          looksLikeAuthFailure(
            `${typeof stdout === "string" ? stdout : (e.stdout ?? "")}\n${typeof stderr === "string" ? stderr : (e.stderr ?? "")}\n${e.message ?? ""}`,
          ),
        );
      },
    );
  });
}

/** French, user-facing (sent verbatim as ErrorMessage.message — the panel
 * displays it as-is) — see docs/PROTOCOL.md's `auth-required` entry. Doesn't
 * attempt to drive the login flow itself (another worker's job, per the C3
 * brief); just names the fix. */
export const AUTH_REQUIRED_MESSAGE =
  "Session Claude Code expirée ou non authentifiée. Lancez `claude /login` dans un terminal, puis réessayez.";

// Testing seam for checkStatus's `claude auth status` subprocess call — see
// queryImpl above for the same pattern. Not part of the public API.
type ExecFileImpl = typeof execFile;
let execFileImpl: ExecFileImpl = execFile;
export function __setExecFileImplForTests(fn: ExecFileImpl): void {
  execFileImpl = fn;
}
export function __resetExecFileImplForTests(): void {
  execFileImpl = execFile;
}

// `claude auth status` measured non-billed on Claude Code 2.1.281
// (2026-09-25): JSON on stdout, exit 0, no model call — see
// docs/PROTOCOL.md's "Disponibilité du fournisseur" amendement 2026-09-25
// bis. 5s is generous slack for a purely local check.
const AUTH_STATUS_TIMEOUT_MS = 5_000;

// L3 (lot7 security review): execFile's own `timeout` option sends SIGTERM by
// default and its callback only fires once the child's stdio actually
// closes — a CLI that ignores SIGTERM, or a grandchild process holding
// stdout open, means that callback can simply never run, and `checkStatus()`
// hangs forever. `killSignal: "SIGKILL"` below makes the kill itself
// unignorable; this outer `Promise.race` is a second, independent safety net
// in case even that doesn't get the callback to fire (a zombie holding the
// pipe open past the kill) — it resolves `unknown`/`probe-failed` on its own
// clock, about a second past AUTH_STATUS_TIMEOUT_MS, so `provider.status`
// always settles either way.
const AUTH_STATUS_OUTER_TIMEOUT_MS = 6_000;

/**
 * `provider.status` for claude-cli — amendement 2026-09-25 bis. Two steps:
 * the executable-presence check (same test as isAvailable()), then
 * `claude auth status`. Of its JSON output, ONLY `loggedIn` is read — never
 * `email`, `orgId` or `orgName`, which must never leave the broker (not even
 * to the log — see docs/PROTOCOL.md). `ok`/`logged-in` means "a session is
 * open on this machine", not "Anthropic still accepts it" — a
 * server-revoked session is still only caught at the next real request
 * (auth-required, unchanged).
 */
async function checkStatus(): Promise<StatusCheck> {
  if (!CLAUDE_EXECUTABLE) return { state: "ko", reason: "cli-missing" };
  try {
    accessSync(CLAUDE_EXECUTABLE, constants.X_OK);
  } catch {
    return { state: "ko", reason: "cli-missing" };
  }
  const probe = new Promise<StatusCheck>((resolve) => {
    execFileImpl(
      CLAUDE_EXECUTABLE!,
      ["auth", "status"],
      { timeout: AUTH_STATUS_TIMEOUT_MS, killSignal: "SIGKILL", encoding: "utf8" },
      (err, stdout) => {
        if (err) {
          resolve({ state: "unknown", reason: "probe-failed" });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout));
          if (typeof parsed?.loggedIn !== "boolean") {
            resolve({ state: "unknown", reason: "probe-failed" });
            return;
          }
          resolve(parsed.loggedIn ? { state: "ok", reason: "logged-in" } : { state: "ko", reason: "not-logged-in" });
        } catch {
          resolve({ state: "unknown", reason: "probe-failed" });
        }
      },
    );
  });
  const outerTimeout = new Promise<StatusCheck>((resolve) => {
    setTimeout(() => resolve({ state: "unknown", reason: "probe-failed" }), AUTH_STATUS_OUTER_TIMEOUT_MS);
  });
  return Promise.race([probe, outerTimeout]);
}

async function isAvailable(): Promise<Availability> {
  if (!CLAUDE_EXECUTABLE) {
    return {
      available: false,
      reason: "claude CLI not found on PATH (set WINGPEN_CLAUDE_PATH to override)",
    };
  }
  try {
    accessSync(CLAUDE_EXECUTABLE, constants.X_OK);
  } catch {
    return { available: false, reason: `claude CLI at ${CLAUDE_EXECUTABLE} is not executable` };
  }
  return { available: true };
}

/**
 * Streams the model's answer to `built.prompt`, fenced with `built.nonce`. No
 * tools enabled. Aborting `opts.signal` stops the underlying query, and so
 * does hitting the timeout (see MODEL_TIMEOUT_MS) — in which case this throws
 * ModelTimeoutError once the underlying stream has settled.
 *
 * Yields text deltas as they arrive, then at most one `usage` event built from
 * the SDK's final result message. Token counts only exist on that final message,
 * which is why this yields a union rather than plain strings — an earlier version
 * returned `AsyncIterable<string>` and could only ever report zero.
 */
export async function* streamAnswer(
  built: BuiltPrompt,
  opts: StreamAnswerOptions & ProviderRuntimeOptions = {},
): AsyncIterable<AnswerEvent> {
  const abortController = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) {
      abortController.abort();
    } else {
      opts.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }
  }

  const timeoutMs = opts.timeoutMs ?? MODEL_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  // Captured for auth-failure detection only (see looksLikeAuthFailure
  // below) — never logged, never forwarded to the client verbatim. Passing
  // this callback also switches the child process's stderr from "ignore" to
  // "pipe" (see the SDK's spawnLocalProcess): without it the CLI's own
  // "Please run /login" text never reaches us, only the opaque "Claude Code
  // process exited with code 1".
  let stderrText = "";

  // The CLI's OWN account of why it failed, when it has one. Measured
  // 2026-09-26 (empty CLAUDE_CONFIG_DIR, no ANTHROPIC_API_KEY/
  // CLAUDE_CODE_OAUTH_TOKEN — a deterministic "not logged in" failure, no
  // network): the CLI does NOT just exit 1 silently. Before exiting it still
  // emits a `result` message on stdout, valid stream-json, with `is_error:
  // true` and `result: "Not logged in · Please run /login"` — the SDK's
  // ProcessTransport.readMessages() yields every stdout line before it
  // eventually throws `Claude Code process exited with code 1` from
  // waitForExit(). So the real reason is available in this for-await loop,
  // one message before the generic exit error — we just weren't reading it.
  // This is what probeAuthFailure() below used to need a second, billed CLI
  // call to reconstruct.
  let cliReasonText = "";

  try {
    const stream = queryImpl({
      prompt: built.prompt,
      options: {
        abortController,
        systemPrompt: buildSystemPrompt(built.nonce),
        tools: [],
        includePartialMessages: true,
        settingSources: [],
        stderr: (data: string) => {
          stderrText += data;
        },
        ...(CLAUDE_EXECUTABLE ? { pathToClaudeCodeExecutable: CLAUDE_EXECUTABLE } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      },
    });

    for await (const message of stream) {
      if (message.type === "stream_event") {
        // Runtime duck-typing: the Anthropic streaming event shape for text
        // deltas is `{ type: "content_block_delta", delta: { type: "text_delta", text } }`.
        const event = message.event as unknown as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
          if (typeof event.delta.text === "string") {
            yield { kind: "delta", text: event.delta.text };
          }
        }
        continue;
      }

      if (message.type === "result") {
        // See cliReasonText's declaration above: on a failed run the CLI's
        // final `result` message carries its own error text — capture it
        // before it's lost when readMessages() later throws the generic
        // "process exited with code 1".
        const resultMsg = message as unknown as { is_error?: boolean; result?: unknown };
        if (resultMsg.is_error && typeof resultMsg.result === "string") {
          cliReasonText = resultMsg.result;
        }
        // Duck-typed: the SDK forwards Anthropic's snake_case usage block, but
        // tolerate a camelCase shape too rather than silently reporting zero.
        const usage = (message as unknown as { usage?: Record<string, unknown> }).usage ?? {};
        const num = (...keys: string[]): number => {
          for (const k of keys) {
            const v = usage[k];
            if (typeof v === "number") return v;
          }
          return 0;
        };
        yield {
          kind: "usage",
          usage: {
            inputTokens: num("input_tokens", "inputTokens"),
            outputTokens: num("output_tokens", "outputTokens"),
          },
        };
      }
    }
  } catch (err) {
    if (timedOut) throw new ModelTimeoutError(timeoutMs);
    // Checked ahead of the generic model-unavailable classification (task
    // C3): an expired/missing Claude Code session is not "the model is
    // unreachable", it's "the human needs to re-run `claude /login`" — a
    // different remedy deserves a different error code.
    // M1 (lot7 security review): a cancel (user click, panel closed) aborts
    // the SDK's query with an AbortError whose text names nothing about
    // auth — never confirm an aborted request with a probe (billed, and
    // pointless: the user is walking away from this request, not hitting an
    // auth wall). `timedOut` is checked above and already returns; by this
    // point any abort left is `opts.signal`'s own — a real cancel.
    if (abortController.signal.aborted) throw err;
    const errText = err instanceof Error ? err.message : String(err);
    if (looksLikeAuthFailure(`${stderrText}\n${cliReasonText}\n${errText}`) || (await probeAuthFailure())) {
      throw new AuthRequiredError(AUTH_REQUIRED_MESSAGE);
    }
    // 2026-09-26 amendment (docs/PROTOCOL.md): surface the CLI's own words
    // instead of the opaque "Claude Code process exited with code 1" — prefer
    // the reason captured from its `result` message (see cliReasonText
    // above), fall back to the stderr tail. Appending rather than replacing
    // keeps every existing isModelUnavailableError() substring match (e.g.
    // "process exited") intact; mutating err.message in place (rather than
    // building a new Error) preserves `instanceof`/`err.name` for the same
    // reason.
    const reason = sanitizeCliReason(cliReasonText) || sanitizeCliReason(stderrText);
    if (err instanceof Error && reason) {
      err.message = `${errText}: ${reason}`;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) throw new ModelTimeoutError(timeoutMs);
}

export const claudeCliProvider: ModelProvider = {
  id: "claude-cli",
  label: "Claude (CLI locale)",
  isAvailable,
  checkStatus,
  streamAnswer,
};
