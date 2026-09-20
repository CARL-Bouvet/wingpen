// The list of model providers Wingpen knows about. server.ts uses this both
// to dispatch chat/summarize/act to the currently-selected provider and to
// answer `settings.get`/`settings.set` by probing every provider's
// isAvailable() — see docs/PROTOCOL.md's settings.* amendment.

import type { ModelProvider } from "./types.ts";
import { claudeCliProvider } from "./claude-cli.ts";
import { ollamaProvider } from "./ollama.ts";

export const PROVIDERS: readonly ModelProvider[] = [claudeCliProvider, ollamaProvider];

export function getProvider(id: string | undefined): ModelProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
