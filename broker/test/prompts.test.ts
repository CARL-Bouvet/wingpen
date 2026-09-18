import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPrompts, savePrompt, deletePrompt, DEFAULT_PROMPTS, type PromptsDirs } from "../src/prompts.ts";

let dirs: PromptsDirs;

beforeEach(() => {
  const dataDir = mkdtempSync(join(tmpdir(), "wingpen-prompts-"));
  dirs = { dataDir };
});

afterEach(() => {
  rmSync(dirs.dataDir, { recursive: true, force: true });
});

describe("prompts library round-trip", () => {
  test("starts with the default starter prompts, not empty", () => {
    expect(listPrompts(dirs)).toEqual(DEFAULT_PROMPTS);
  });

  test("save then list returns the defaults plus the saved prompt", () => {
    savePrompt(dirs, { name: "greeting", body: "Say hi" });
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hi" }]);
  });

  test("save with same name overwrites", () => {
    savePrompt(dirs, { name: "greeting", body: "Say hi" });
    savePrompt(dirs, { name: "greeting", body: "Say hello" });
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hello" }]);
  });

  test("delete removes the prompt", () => {
    savePrompt(dirs, { name: "greeting", body: "Say hi" });
    savePrompt(dirs, { name: "farewell", body: "Say bye" });
    deletePrompt(dirs, "greeting");
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "farewell", body: "Say bye" }]);
  });

  test("delete of an absent prompt is a no-op", () => {
    savePrompt(dirs, { name: "greeting", body: "Say hi" });
    deletePrompt(dirs, "nonexistent");
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hi" }]);
  });

  test("persists across fresh reads of the same dir", () => {
    savePrompt(dirs, { name: "greeting", body: "Say hi" });
    const reread = listPrompts({ dataDir: dirs.dataDir });
    expect(reread).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hi" }]);
  });
});

describe("defaults are not wiped by a delete", () => {
  test("deleting one default persists the others", () => {
    const victim = DEFAULT_PROMPTS[0]!.name;
    const left = deletePrompt(dirs, victim);
    expect(left).toEqual(DEFAULT_PROMPTS.filter((p) => p.name !== victim));
    expect(listPrompts({ dataDir: dirs.dataDir })).toEqual(left);
  });
});
