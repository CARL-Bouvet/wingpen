// Prompt library persisted at ~/.local/share/wingpen/prompts.json.
// Base directory is always passed in as a parameter so tests can point at a temp dir.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { PromptEntry } from "./protocol.ts";

export interface PromptsDirs {
  /** Directory holding prompts.json, e.g. ~/.local/share/wingpen */
  dataDir: string;
}

function promptsPath(dirs: PromptsDirs): string {
  return join(dirs.dataDir, "prompts.json");
}

/**
 * Starter prompts shown when prompts.json does not exist yet. Returned by
 * listPrompts() but never written to disk on read — they only get persisted
 * if the user saves something (see savePrompt below), so an empty library
 * never silently becomes a file the user didn't ask for.
 */
export const DEFAULT_PROMPTS: PromptEntry[] = [
  { name: "Traduire en français", body: "Traduis le texte suivant en français, sans commentaire ni reformulation :" },
  { name: "Expliquer simplement", body: "Explique ce texte simplement, comme à quelqu'un qui découvre le sujet :" },
  { name: "Extraire les points clés", body: "Extrais les points clés de ce texte sous forme de liste à puces :" },
  { name: "Rédiger une réponse", body: "Rédige une réponse courte et polie à ce message :" },
  { name: "Résumer en 3 phrases", body: "Résume ce texte en 3 phrases maximum :" },
];

function isPromptEntry(v: unknown): v is PromptEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).name === "string" &&
    typeof (v as Record<string, unknown>).body === "string"
  );
}

function readAll(dirs: PromptsDirs): PromptEntry[] {
  const path = promptsPath(dirs);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPromptEntry);
  } catch {
    return [];
  }
}

/**
 * Writes atomically: write to a sibling temp file, then rename over the
 * target. Rename is atomic on POSIX, so a reader (or a crash mid-write) never
 * observes a partially-written prompts.json. `writeFileSync`'s mode is kept
 * through the rename, so the 0600 permission survives.
 */
function writeAllAtomic(dirs: PromptsDirs, items: PromptEntry[]): void {
  if (!existsSync(dirs.dataDir)) {
    mkdirSync(dirs.dataDir, { recursive: true });
  }
  const target = promptsPath(dirs);
  const tmp = join(dirs.dataDir, `.prompts.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(items, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp was never created, or already gone — fine either way.
    }
    throw err;
  }
}

export function listPrompts(dirs: PromptsDirs): PromptEntry[] {
  if (!existsSync(promptsPath(dirs))) return DEFAULT_PROMPTS;
  return readAll(dirs);
}

/**
 * Per-dataDir serialization so two concurrent callers (e.g. two open panels
 * saving/deleting at the same time) queue instead of racing a read-modify-write
 * against each other — the atomic rename above only protects a single write
 * from being observed half-done, not two writes from clobbering one another.
 */
const dirLocks = new Map<string, Promise<unknown>>();

function withDirLock<T>(dataDir: string, fn: () => T): Promise<T> {
  const prev = dirLocks.get(dataDir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Track a settled-either-way promise so a prior rejection never wedges the queue.
  dirLocks.set(
    dataDir,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Saves (creates or overwrites by name) a prompt and returns the full updated list. */
export function savePrompt(dirs: PromptsDirs, prompt: PromptEntry): Promise<PromptEntry[]> {
  return withDirLock(dirs.dataDir, () => {
    const items = existsSync(promptsPath(dirs)) ? readAll(dirs) : [...DEFAULT_PROMPTS];
    const idx = items.findIndex((p) => p.name === prompt.name);
    if (idx >= 0) {
      items[idx] = prompt;
    } else {
      items.push(prompt);
    }
    writeAllAtomic(dirs, items);
    return items;
  });
}

/**
 * Deletes a prompt by name and returns the full updated list. No-op if absent.
 *
 * Reads through the same starting point as listPrompts: on a library that is
 * still the untouched defaults, deleting one entry must persist the remaining
 * four, not wipe the lot.
 */
export function deletePrompt(dirs: PromptsDirs, name: string): Promise<PromptEntry[]> {
  return withDirLock(dirs.dataDir, () => {
    const items = listPrompts(dirs).filter((p) => p.name !== name);
    writeAllAtomic(dirs, items);
    return items;
  });
}
