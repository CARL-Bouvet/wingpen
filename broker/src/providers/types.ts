// Shared provider contract. Every model backend (claude-cli, ollama, and any
// future one — see docs/DECISIONS.md T8) implements this so server.ts and the
// `settings.*` protocol messages never need to know which backend is active.
// Prompt assembly (fencing, the shared system prompt) stays out of here —
// that's ../model.ts, on purpose, so it cannot be duplicated per provider.

import type { AnswerEvent, BuiltPrompt, StreamAnswerOptions } from "../model.ts";

export interface Availability {
  available: boolean;
  /** Short, human-readable reason when available is false, e.g. "claude CLI
   * not found on PATH" or "Ollama unreachable at http://127.0.0.1:11434".
   * Surfaced to the extension's settings UI — never hidden. */
  reason?: string;
}

/** Runtime knobs threaded in from WingpenConfig (broker/src/config.ts).
 * Providers ignore whatever they don't need — claude-cli ignores ollamaUrl,
 * both accept model. */
export interface ProviderRuntimeOptions {
  model?: string;
  ollamaUrl?: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly label: string;
  /** Cheap, side-effect-free probe: is this provider usable right now, with
   * the given runtime options? Never throws — reports unavailability via the
   * return value instead. */
  isAvailable(opts: ProviderRuntimeOptions): Promise<Availability>;
  /** Only implemented by providers that can enumerate installed models
   * (currently just ollama, via /api/tags). Used to populate the settings
   * UI's model picker. */
  listModels?(opts: ProviderRuntimeOptions): Promise<string[]>;
  /** Streams the model's answer to `built.prompt`. Throws ModelTimeoutError
   * or ModelUnavailableError (../model.ts) for conditions server.ts should
   * report as `model-unavailable` rather than `internal`. */
  streamAnswer(
    built: BuiltPrompt,
    opts: StreamAnswerOptions & ProviderRuntimeOptions,
  ): AsyncIterable<AnswerEvent>;
}
