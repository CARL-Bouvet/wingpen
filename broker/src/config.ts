// Config and pairing-secret loading. Base directories are always passed in as
// parameters (never hard-coded via homedir()) so tests can point at a temp dir.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

/** The set of model providers Wingpen knows how to drive. Single source of
 * truth for the *set of valid ids* lives here (config.ts has no dependency on
 * protocol.ts or the providers/ tree, so both can import this type without a
 * cycle); protocol.ts and providers/registry.ts both key off it. */
export type ProviderId = "claude-cli" | "ollama" | "claude-api";

export interface WingpenConfig {
  port: number;
  allowedExtensionIds: string[];
  /** Selected model provider. Optional at the type level because an old
   * config.json (written before this key existed) won't have it — loadConfig
   * fills in DEFAULT_CONFIG.provider when absent, no migration step needed. */
  provider?: ProviderId;
  /** Provider-specific model name (e.g. "llama3.2" for ollama, an Anthropic
   * model id for claude-api). Unset means "no model chosen yet" — claude-cli
   * and claude-api tolerate that (fall back to their own default), ollama
   * does not (see providers/ollama.ts). */
  model?: string;
  /** Base URL of the local Ollama daemon. */
  ollamaUrl?: string;
  /**
   * The user's own Anthropic API key, for the claude-api provider (BYOK).
   * WRITE-ONLY end to end: accepted by `settings.set`, persisted here
   * (0600, same as the rest of this file), and NEVER read back into a
   * `settings`/`settings.set` response — see server.ts's buildSettingsPayload
   * and CLAUDE.md security rule #1 (no secret reaches the extension). Never
   * logged, never included in an error message — see providers/claude-api.ts.
   */
  apiKey?: string;
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

// Amendement 2026-09-25 ("Transport"): the port is fixed. config.json's
// `port` key is no longer read into the running config — see loadConfig's
// warning below — this constant is the only source of truth left.
export const FIXED_PORT = 8787;

export const DEFAULT_CONFIG: WingpenConfig = {
  port: FIXED_PORT,
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

/** Creates `dir` (recursively) if absent, and (re)asserts 0700 on it either
 * way — docs/PROTOCOL.md "Frontière de menace": the broker's own directories
 * are "remis à 0700 à chaque démarrage" (re-applied at every start), not just
 * set once at creation, in case a backup/restore/sync tool loosened them. */
function ensureDir0700(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  chmodSync(dir, 0o700);
}

function isProviderId(v: unknown): v is ProviderId {
  return v === "claude-cli" || v === "ollama" || v === "claude-api";
}

function configPath(dirs: Dirs): string {
  return join(dirs.configDir, "config.json");
}

/**
 * Loads ~/.config/wingpen/config.json (relative to dirs.configDir), creating it
 * with defaults on first run. The `port` key, if present, is IGNORED — the
 * broker always listens on FIXED_PORT (amendement 2026-09-25, "Transport");
 * a value other than FIXED_PORT only produces a startup warning, never a
 * different listening port.
 */
export function loadConfig(dirs: Dirs): WingpenConfig {
  const path = configPath(dirs);
  ensureDir0700(dirs.configDir);
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
  if (typeof obj.port === "number" && obj.port !== FIXED_PORT) {
    console.warn(
      `wingpen-broker: config.json a "port": ${obj.port}, ignoré — le port est figé à ${FIXED_PORT} ` +
        `(amendement 2026-09-25, voir docs/PROTOCOL.md "Transport").`,
    );
  }
  return {
    port: FIXED_PORT,
    allowedExtensionIds: Array.isArray(obj.allowedExtensionIds)
      ? (obj.allowedExtensionIds as string[])
      : [],
    // Absent/unrecognized provider in an old or hand-edited config.json falls
    // back to the historical (and only, pre-this-lot) behaviour: claude-cli.
    provider: isProviderId(obj.provider) ? obj.provider : DEFAULT_CONFIG.provider,
    model: typeof obj.model === "string" && obj.model ? obj.model : undefined,
    ollamaUrl:
      typeof obj.ollamaUrl === "string" && obj.ollamaUrl ? obj.ollamaUrl : DEFAULT_CONFIG.ollamaUrl,
    apiKey: typeof obj.apiKey === "string" && obj.apiKey ? obj.apiKey : undefined,
  };
}

/**
 * Persists the full config to dirs.configDir/config.json, 0600. Used by the
 * `settings.set` handler (server.ts) — writes the whole config, not a diff,
 * since WingpenConfig is small and this avoids a partial-write footgun.
 */
export function saveConfig(dirs: Pick<Dirs, "configDir">, config: WingpenConfig): void {
  ensureDir0700(dirs.configDir);
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
  ensureDir0700(dirs.dataDir);
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

// --- Firefox pinning — amendement 2026-09-25 ---------------------------------
//
// Firefox gives every install of an extension a random moz-extension://<uuid>
// origin — unlike Chrome's "key"-derived, stable chrome-extension://<id>, it
// cannot be known ahead of time and put in allowedExtensionIds. Instead the
// broker learns it on first successful pairing (valid permanent secret over a
// moz-extension:// origin) and pins it. Unlike the pre-2026-09-25 behaviour
// (one uuid, one file, one value), this is now a LIST — several Firefox
// profiles/installs/temporary-loads can each pin their own uuid — capped at
// FIREFOX_UUID_CAP with least-recently-seen eviction. See server.ts's
// evaluateOrigin and docs/PROTOCOL.md "Cas Firefox".

export const FIREFOX_UUIDS_FILENAME = "firefox-extension-uuids.txt";
// Pre-2026-09-25 format: a single bare uuid, no timestamps. Migrated once,
// then renamed `.migrated` (never deleted — see docs/PROTOCOL.md).
const LEGACY_FIREFOX_UUID_FILENAME = "firefox-extension-uuid.txt";

export const FIREFOX_UUID_CAP = 16;

// Exported (L4, lot7 security review) so the legacy single-uuid migration
// below can validate what it reads off disk before writing it into the new
// pin store and logging it — a hand-edited/corrupted legacy file must not
// inject an arbitrary string into either.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FirefoxPin {
  uuid: string;
  /** ISO 8601 UTC, e.g. "2026-09-25T14:03:00Z". */
  pinnedAt: string;
  /** ISO 8601 UTC — updated on every grant to this uuid. */
  lastSeen: string;
}

/** Pure: parses `firefox-extension-uuids.txt`'s content into pins. Blank
 * lines and `#`-comments are skipped; a line that doesn't parse as
 * `<uuid> <pinnedAt> <lastSeen>` is dropped and counted in `malformedCount`
 * (the caller logs it) rather than throwing or aborting the whole file. */
export function parseFirefoxPinsFile(content: string): { pins: FirefoxPin[]; malformedCount: number } {
  const pins: FirefoxPin[] = [];
  let malformedCount = 0;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3 || !UUID_RE.test(parts[0])) {
      malformedCount++;
      continue;
    }
    const [uuid, pinnedAt, lastSeen] = parts;
    pins.push({ uuid: uuid.toLowerCase(), pinnedAt, lastSeen });
  }
  return { pins, malformedCount };
}

/** Pure: the inverse of parseFirefoxPinsFile — one `<uuid> <pinnedAt>
 * <lastSeen>` line per pin, trailing newline, nothing else. */
export function serializeFirefoxPinsFile(pins: FirefoxPin[]): string {
  if (pins.length === 0) return "";
  return pins.map((p) => `${p.uuid} ${p.pinnedAt} ${p.lastSeen}`).join("\n") + "\n";
}

function firefoxPinsPath(dirs: Pick<Dirs, "dataDir">): string {
  return join(dirs.dataDir, FIREFOX_UUIDS_FILENAME);
}

/** One-time migration from the legacy single-uuid file, called from
 * loadFirefoxPins when the new-format file doesn't exist yet. Renames the
 * legacy file to `<name>.migrated` (never deletes it). Returns the migrated
 * pin list, or null if there was nothing to migrate. */
function migrateLegacyFirefoxUuid(dirs: Pick<Dirs, "dataDir">): FirefoxPin[] | null {
  const legacyPath = join(dirs.dataDir, LEGACY_FIREFOX_UUID_FILENAME);
  if (!existsSync(legacyPath)) return null;
  const uuid = readFileSync(legacyPath, "utf8").trim().toLowerCase();
  // L4 (lot7 security review): the legacy file was migrated and logged
  // unconditionally — a corrupted or hand-edited file could inject an
  // arbitrary string both into the new pin store and into this startup log
  // line. Validate against the same UUID_RE every other uuid in this module
  // goes through; an invalid legacy file is left untouched (not renamed —
  // nothing was migrated) and produces no pins, same as "nothing to migrate".
  if (!uuid || !UUID_RE.test(uuid)) return null;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const pins: FirefoxPin[] = [{ uuid, pinnedAt: now, lastSeen: now }];
  writeFirefoxPinsAtomic(dirs, pins);
  renameSync(legacyPath, `${legacyPath}.migrated`);
  // `uuid` is safe to log as-is here: UUID_RE above already restricts it to
  // `[0-9a-f-]`, so there is nothing left to sanitize (unlike the free-form
  // lastSeen value logged by server.ts's evict line — see sanitizeLogValue).
  console.log(`wingpen-broker: migrated legacy ${LEGACY_FIREFOX_UUID_FILENAME} (uuid=${uuid}) to ${FIREFOX_UUIDS_FILENAME}`);
  return pins;
}

/** Reads the current Firefox pin list off disk — called at EVERY WebSocket
 * open (docs/PROTOCOL.md: "relu à chaud"), never cached, so a hand-edit takes
 * effect on the very next connection without a broker restart. */
export function loadFirefoxPins(dirs: Pick<Dirs, "dataDir">): FirefoxPin[] {
  ensureDir0700(dirs.dataDir);
  const path = firefoxPinsPath(dirs);
  if (!existsSync(path)) {
    return migrateLegacyFirefoxUuid(dirs) ?? [];
  }
  chmodSync(path, 0o600);
  const { pins, malformedCount } = parseFirefoxPinsFile(readFileSync(path, "utf8"));
  if (malformedCount > 0) {
    console.warn(`wingpen-broker: ${malformedCount} malformed line(s) in ${FIREFOX_UUIDS_FILENAME} ignored`);
  }
  return pins;
}

/** Atomic write: temp file in the same directory, then renamed over the real
 * path — so a reader never observes a half-written file, and a concurrent
 * writer's win is all-or-nothing. 0600, matching every other file here. */
function writeFirefoxPinsAtomic(dirs: Pick<Dirs, "dataDir">, pins: FirefoxPin[]): void {
  ensureDir0700(dirs.dataDir);
  const path = firefoxPinsPath(dirs);
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, serializeFirefoxPinsFile(pins), { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, path);
}

export interface RecordFirefoxSeenResult {
  pins: FirefoxPin[];
  /** True when `uuid` was not already pinned and this call just pinned it
   * (a "pin" event, per docs/PROTOCOL.md's journal lines) — false when this
   * was only a lastSeen refresh for an already-pinned uuid. */
  pinned: boolean;
  /** Set when adding this pin pushed the list over FIREFOX_UUID_CAP and the
   * least-recently-seen entry was evicted to make room. */
  evicted?: FirefoxPin;
}

/**
 * Records a successful grant to `uuid`: re-reads the file first (per spec,
 * "toute écriture relit d'abord le fichier" — a line deleted by hand between
 * the read at WS-open and this call must never be silently recreated), then
 * either refreshes `lastSeen` for an existing pin, or — only when `mayCreate`
 * is true — adds a fresh pin (pinnedAt = lastSeen = nowIso), evicting the
 * least-recently-seen entry if that pushes the list past FIREFOX_UUID_CAP.
 * Writes atomically. Used for BOTH the "provisional origin presents the
 * permanent secret" case (a new pin, `mayCreate: true`) and the
 * "already-pinned origin connects again" case (a lastSeen touch) — see
 * server.ts's handleHandshakeMessage.
 *
 * `mayCreate` defaults to true so every existing direct caller (this
 * module's own tests included) keeps its historical "touch or create"
 * behaviour; server.ts passes it explicitly, true only on the permanent
 * secret + not-yet-pinned-origin path (L1, lot7 security review). When
 * `mayCreate` is false and `uuid` isn't already pinned, this is a no-op: no
 * write, `pinned: false`, the pin list unchanged — a lastSeen touch must
 * never resurrect (or silently pin) an entry that isn't there.
 */
export function recordFirefoxSeen(
  dirs: Pick<Dirs, "dataDir">,
  uuid: string,
  nowIso: string,
  mayCreate = true,
): RecordFirefoxSeenResult {
  const current = loadFirefoxPins(dirs); // re-read, per spec
  const idx = current.findIndex((p) => p.uuid === uuid);
  if (idx >= 0) {
    const pins = current.slice();
    pins[idx] = { ...pins[idx], lastSeen: nowIso };
    writeFirefoxPinsAtomic(dirs, pins);
    return { pins, pinned: false };
  }
  if (!mayCreate) {
    return { pins: current, pinned: false };
  }
  const fresh: FirefoxPin = { uuid, pinnedAt: nowIso, lastSeen: nowIso };
  let pins = [...current, fresh];
  let evicted: FirefoxPin | undefined;
  if (pins.length > FIREFOX_UUID_CAP) {
    let lruIdx = 0;
    for (let i = 1; i < pins.length; i++) {
      if (pins[i].lastSeen < pins[lruIdx].lastSeen) lruIdx = i;
    }
    evicted = pins[lruIdx];
    pins = pins.filter((_, i) => i !== lruIdx);
  }
  writeFirefoxPinsAtomic(dirs, pins);
  return { pins, pinned: true, evicted };
}
