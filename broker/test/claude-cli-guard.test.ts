// CHANGE 2 (2026-09-21): startup guard for the claude-cli provider — fail
// fast instead of silently falling back to the SDK's broken bundled CLI,
// which hangs every request with no chunk, no done, no error. See
// providers/claude-cli.ts's assertClaudeExecutableIsUsable.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  assertClaudeExecutableIsUsable,
  bundledClaudeExecutablePath,
  buildBundledFallbackError,
} from "../src/providers/claude-cli.ts";

describe("bundledClaudeExecutablePath", () => {
  test("resolves inside node_modules/@anthropic-ai/claude-agent-sdk, ending in cli.js", () => {
    const path = bundledClaudeExecutablePath();
    expect(path).toContain("@anthropic-ai/claude-agent-sdk");
    expect(path.endsWith("cli.js")).toBe(true);
  });
});

describe("buildBundledFallbackError", () => {
  test("names WINGPEN_CLAUDE_PATH as the fix and includes the offending path", () => {
    const err = buildBundledFallbackError("/fake/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
    expect(err.message).toContain("WINGPEN_CLAUDE_PATH");
    expect(err.message).toContain("/fake/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
  });
});

describe("assertClaudeExecutableIsUsable", () => {
  test("does not throw when a real claude install resolves (this test machine has one on PATH)", () => {
    expect(() => assertClaudeExecutableIsUsable()).not.toThrow();
  });

  // Only claude-cli is affected — never a module-load-time crash for a broker
  // configured to use ollama, since providers/registry.ts always imports this
  // file regardless of the active provider.
  test("importing this module never throws by itself — only the explicit call does", async () => {
    await expect(import("../src/providers/claude-cli.ts")).resolves.toBeDefined();
  });

  // Fails fast + names WINGPEN_CLAUDE_PATH when no real claude is resolvable.
  // CLAUDE_EXECUTABLE is a module-level constant computed once at import time
  // from PATH/WINGPEN_CLAUDE_PATH, so simulating "no real install" requires a
  // genuinely fresh process started with an empty PATH — mutating
  // process.env.PATH in this already-running test process would not do it
  // (Bun's execFileSync does not pick up a post-startup env mutation here).
  test("fails fast, naming WINGPEN_CLAUDE_PATH, in a subprocess with no claude reachable on PATH", () => {
    const brokerDir = join(import.meta.dir, "..");
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `import("./src/providers/claude-cli.ts").then((m) => {
           try { m.assertClaudeExecutableIsUsable(); console.log("NOTHROW"); }
           catch (e) { console.log("THROW:" + e.message); }
         });`,
      ],
      cwd: brokerDir,
      env: { PATH: "", HOME: process.env.HOME ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = result.stdout.toString();
    expect(out).toContain("THROW:");
    expect(out).toContain("WINGPEN_CLAUDE_PATH");
    expect(out).toContain("SDK-bundled fallback");
  });
});
