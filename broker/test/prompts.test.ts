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

  test("save then list returns the defaults plus the saved prompt", async () => {
    await savePrompt(dirs, { name: "greeting", body: "Say hi" });
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hi" }]);
  });

  test("save with same name overwrites", async () => {
    await savePrompt(dirs, { name: "greeting", body: "Say hi" });
    await savePrompt(dirs, { name: "greeting", body: "Say hello" });
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hello" }]);
  });

  test("delete removes the prompt", async () => {
    await savePrompt(dirs, { name: "greeting", body: "Say hi" });
    await savePrompt(dirs, { name: "farewell", body: "Say bye" });
    await deletePrompt(dirs, "greeting");
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "farewell", body: "Say bye" }]);
  });

  test("delete of an absent prompt is a no-op", async () => {
    await savePrompt(dirs, { name: "greeting", body: "Say hi" });
    await deletePrompt(dirs, "nonexistent");
    expect(listPrompts(dirs)).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hi" }]);
  });

  test("persists across fresh reads of the same dir", async () => {
    await savePrompt(dirs, { name: "greeting", body: "Say hi" });
    const reread = listPrompts({ dataDir: dirs.dataDir });
    expect(reread).toEqual([...DEFAULT_PROMPTS, { name: "greeting", body: "Say hi" }]);
  });

  test("concurrent saves of distinct prompts all land, none lost to a race", async () => {
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) => savePrompt(dirs, { name: `p${i}`, body: `body ${i}` })),
    );
    const items = listPrompts(dirs);
    for (let i = 0; i < N; i++) {
      expect(items).toContainEqual({ name: `p${i}`, body: `body ${i}` });
    }
    expect(items.length).toBe(DEFAULT_PROMPTS.length + N);
  });
});

describe("defaults are not wiped by a delete", () => {
  test("deleting one default persists the others", async () => {
    const victim = DEFAULT_PROMPTS[0]!.name;
    const left = await deletePrompt(dirs, victim);
    expect(left).toEqual(DEFAULT_PROMPTS.filter((p) => p.name !== victim));
    expect(listPrompts({ dataDir: dirs.dataDir })).toEqual(left);
  });
});
