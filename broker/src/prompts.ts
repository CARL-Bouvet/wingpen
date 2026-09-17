// Prompt library persisted at ~/.local/share/wingpen/prompts.json.
// Base directory is always passed in as a parameter so tests can point at a temp dir.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptEntry } from "./protocol.ts";

export interface PromptsDirs {
  /** Directory holding prompts.json, e.g. ~/.local/share/wingpen */
  dataDir: string;
}

function promptsPath(dirs: PromptsDirs): string {
  return join(dirs.dataDir, "prompts.json");
}

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

function writeAll(dirs: PromptsDirs, items: PromptEntry[]): void {
  if (!existsSync(dirs.dataDir)) {
    mkdirSync(dirs.dataDir, { recursive: true });
  }
  writeFileSync(promptsPath(dirs), JSON.stringify(items, null, 2) + "\n", { mode: 0o600 });
}

export function listPrompts(dirs: PromptsDirs): PromptEntry[] {
  return readAll(dirs);
}

/** Saves (creates or overwrites by name) a prompt and returns the full updated list. */
export function savePrompt(dirs: PromptsDirs, prompt: PromptEntry): PromptEntry[] {
  const items = readAll(dirs);
  const idx = items.findIndex((p) => p.name === prompt.name);
  if (idx >= 0) {
    items[idx] = prompt;
  } else {
    items.push(prompt);
  }
  writeAll(dirs, items);
  return items;
}

/** Deletes a prompt by name and returns the full updated list. No-op if absent. */
export function deletePrompt(dirs: PromptsDirs, name: string): PromptEntry[] {
  const items = readAll(dirs).filter((p) => p.name !== name);
  writeAll(dirs, items);
  return items;
}
