// Config and pairing-secret loading. Base directories are always passed in as
// parameters (never hard-coded via homedir()) so tests can point at a temp dir.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

/** The set of model providers Wingpen knows how to drive. Single source of
 * truth for the *set of valid ids* lives here (config.ts has no dependency on
 * protocol.ts or the providers/ tree, so both can import this type without a
 * cycle); protocol.ts and providers/registry.ts both key off it. */
export type ProviderId = "claude-cli" | "ollama";

export interface WingpenConfig {
  port: number;
  allowedExtensionIds: string[];
  /** Selected model provider. Optional at the type level because an old
   * config.json (written before this key existed) won't have it — loadConfig
   * fills in DEFAULT_CONFIG.provider when absent, no migration step needed. */
  provider?: ProviderId;
  /** Provider-specific model name (e.g. "llama3.2" for ollama). Unset means
   * "no model chosen yet" — claude-cli tolerates that (falls back to the CLI's
   * own default), ollama does not (see providers/ollama.ts). */
  model?: string;
  /** Base URL of the local Ollama daemon. */
  ollamaUrl?: string;
}

export interface Dirs {
  /** Directory holding config.json, e.g. ~/.config/wingpen */
  configDir: string;
  /** Directory holding pairing.txt and prompts.json, e.g. ~/.local/share/wingpen */
  dataDir: string;
}

// The pinned extension ID, derived from extension/manifest.json's "key" field
// (RSA 2048 public key). See docs/PROTOCOL.md "Pairing" for the derivation.
// Private key: extension-key.pem (gitignored, never committed).
const PINNED_EXTENSION_ID = "hehlgipomfminodhahcjbencblepjhah";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

export const DEFAULT_CONFIG: WingpenConfig = {
  port: 8787,
  allowedExtensionIds: [PINNED_EXTENSION_ID],
  provider: "claude-cli",
  ollamaUrl: DEFAULT_OLLAMA_URL,
};

/** Real-world default directories. Never called from library logic directly — only from server.ts entrypoint. */
export function defaultDirs(): Dirs {
  const home = homedir();
  return {
    configDir: join(home, ".config", "wingpen"),
    dataDir: join(home, ".local", "share", "wingpen"),
  };
}

function isProviderId(v: unknown): v is ProviderId {
  return v === "claude-cli" || v === "ollama";
}

function configPath(dirs: Dirs): string {
  return join(dirs.configDir, "config.json");
}

/**
 * Loads ~/.config/wingpen/config.json (relative to dirs.configDir), creating it
 * with defaults on first run.
 */
export function loadConfig(dirs: Dirs): WingpenConfig {
  const path = configPath(dirs);
  if (!existsSync(dirs.configDir)) {
    mkdirSync(dirs.configDir, { recursive: true });
  }
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", {
      mode: 0o600,
    });
    return { ...DEFAULT_CONFIG, allowedExtensionIds: [...DEFAULT_CONFIG.allowedExtensionIds] };
  }
  // Same reasoning as loadOrCreatePairingSecret's "already exists" branch: a
  // config file surviving a backup/restore could have lost its 0600 mode.
  chmodSync(path, 0o600);
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  return {
    port: typeof obj.port === "number" ? obj.port : DEFAULT_CONFIG.port,
    allowedExtensionIds: Array.isArray(obj.allowedExtensionIds)
      ? (obj.allowedExtensionIds as string[])
      : [],
    // Absent/unrecognized provider in an old or hand-edited config.json falls
    // back to the historical (and only, pre-this-lot) behaviour: claude-cli.
    provider: isProviderId(obj.provider) ? obj.provider : DEFAULT_CONFIG.provider,
    model: typeof obj.model === "string" && obj.model ? obj.model : undefined,
    ollamaUrl:
      typeof obj.ollamaUrl === "string" && obj.ollamaUrl ? obj.ollamaUrl : DEFAULT_CONFIG.ollamaUrl,
  };
}

/**
 * Persists the full config to dirs.configDir/config.json, 0600. Used by the
 * `settings.set` handler (server.ts) — writes the whole config, not a diff,
 * since WingpenConfig is small and this avoids a partial-write footgun.
 */
export function saveConfig(dirs: Pick<Dirs, "configDir">, config: WingpenConfig): void {
  if (!existsSync(dirs.configDir)) {
    mkdirSync(dirs.configDir, { recursive: true });
  }
  const path = configPath(dirs as Dirs);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Loads the pairing secret from ~/.local/share/wingpen/pairing.txt (relative to
 * dirs.dataDir), generating a fresh 32 hex char secret with mode 0600 if absent.
 */
export function loadOrCreatePairingSecret(dirs: Dirs): string {
  const secretPath = join(dirs.dataDir, "pairing.txt");
  if (!existsSync(dirs.dataDir)) {
    mkdirSync(dirs.dataDir, { recursive: true });
  }
  if (existsSync(secretPath)) {
    // Re-assert 0600 even on the "already exists" path: a file restored from a
    // backup, copied by a naive sync tool, or left over from an older broker
    // version could have laxer permissions than the mode we set at creation.
    chmodSync(secretPath, 0o600);
    return readFileSync(secretPath, "utf8").trim();
  }
  const secret = randomBytes(16).toString("hex"); // 32 hex chars
  writeFileSync(secretPath, secret, { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  return secret;
}
