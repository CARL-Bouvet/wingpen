// The "claude-cli" provider: talks to the local Claude Code install through
// @anthropic-ai/claude-agent-sdk. No tools are ever enabled — this provider
// only ever wants text back. Prompt assembly (fencing, system prompt) lives
// in ../model.ts and is shared by every provider — see ../model.ts's header.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import {
  buildSystemPrompt,
  MODEL_TIMEOUT_MS,
  ModelTimeoutError,
  type AnswerEvent,
  type BuiltPrompt,
  type StreamAnswerOptions,
} from "../model.ts";
import type { Availability, ModelProvider, ProviderRuntimeOptions } from "./types.ts";

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

  try {
    const stream = queryImpl({
      prompt: built.prompt,
      options: {
        abortController,
        systemPrompt: buildSystemPrompt(built.nonce),
        tools: [],
        includePartialMessages: true,
        settingSources: [],
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
  streamAnswer,
};
