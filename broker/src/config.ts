// Config and pairing-secret loading. Base directories are always passed in as
// parameters (never hard-coded via homedir()) so tests can point at a temp dir.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

export interface WingpenConfig {
  port: number;
  allowedExtensionIds: string[];
}

export interface Dirs {
  /** Directory holding config.json, e.g. ~/.config/wingpen */
  configDir: string;
  /** Directory holding pairing.txt and prompts.json, e.g. ~/.local/share/wingpen */
  dataDir: string;
}

export const DEFAULT_CONFIG: WingpenConfig = { port: 8787, allowedExtensionIds: [] };

/** Real-world default directories. Never called from library logic directly — only from server.ts entrypoint. */
export function defaultDirs(): Dirs {
  const home = homedir();
  return {
    configDir: join(home, ".config", "wingpen"),
    dataDir: join(home, ".local", "share", "wingpen"),
  };
}

/**
 * Loads ~/.config/wingpen/config.json (relative to dirs.configDir), creating it
 * with defaults on first run.
 */
export function loadConfig(dirs: Dirs): WingpenConfig {
  const configPath = join(dirs.configDir, "config.json");
  if (!existsSync(dirs.configDir)) {
    mkdirSync(dirs.configDir, { recursive: true });
  }
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", {
      mode: 0o600,
    });
    return { ...DEFAULT_CONFIG, allowedExtensionIds: [] };
  }
  const raw = readFileSync(configPath, "utf8");
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
  };
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
    return readFileSync(secretPath, "utf8").trim();
  }
  const secret = randomBytes(16).toString("hex"); // 32 hex chars
  writeFileSync(secretPath, secret, { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  return secret;
}
