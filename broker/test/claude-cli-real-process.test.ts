// End-to-end proof (not a mocked queryImpl): drives the REAL
// @anthropic-ai/claude-agent-sdk `query()` against a fake `claude` executable
// (test/fixtures/*.sh) via WINGPEN_CLAUDE_PATH, exactly the mechanism used in
// production. CLAUDE_EXECUTABLE is resolved once, at module load, from
// WINGPEN_CLAUDE_PATH/PATH (see providers/claude-cli.ts) — so, like
// claude-cli-guard.test.ts's own subprocess test, this needs a fresh process
// per fixture rather than mutating env in the already-running test process.
//
// Proves the 2026-09-26 amendment (docs/PROTOCOL.md): the CLI's own reason
// (captured from the SDK's `result` message, see cliReasonText) reaches
// isAuthRequiredError/isModelUnavailableError and the error's `message`,
// through the real SDK plumbing — not just through a hand-built fake message
// in model.test.ts.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const brokerDir = join(import.meta.dir, "..");

function runAgainstFixture(fixture: string): { ok: boolean; isAuth: boolean; isModelUnavailable: boolean; message: string } {
  const fixturePath = join(import.meta.dir, "fixtures", fixture);
  const script = `
    import("./src/model.ts").then(async (model) => {
      const cli = await import("./src/providers/claude-cli.ts");
      const built = model.buildPrompt({ kind: "chat", text: "hello" });
      try {
        for await (const _e of cli.streamAnswer(built, { timeoutMs: 10000 })) {
          // draining
        }
        console.log(JSON.stringify({ ok: true }));
      } catch (err) {
        console.log(JSON.stringify({
          ok: false,
          isAuth: model.isAuthRequiredError(err),
          isModelUnavailable: model.isModelUnavailableError(err),
          message: err && err.message,
        }));
      }
      // The SDK's own Query.close() sends SIGTERM to an already-exited fixture
      // process, then unconditionally arms a 5s SIGKILL fallback timer that
      // keeps this short-lived script's event loop alive for no reason here
      // (a long-running broker process never notices it). Force an immediate
      // exit once we have our answer instead of waiting it out.
      process.exit(0);
    });
  `;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    cwd: brokerDir,
    env: { ...process.env, WINGPEN_CLAUDE_PATH: fixturePath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = result.stdout.toString().trim();
  const lastLine = out.split("\n").filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(lastLine);
  } catch {
    throw new Error(
      `fixture ${fixture}: could not parse subprocess output as JSON.\nstdout:\n${out}\nstderr:\n${result.stderr.toString()}`,
    );
  }
}

describe("streamAnswer against a real fake-CLI subprocess (WINGPEN_CLAUDE_PATH)", () => {
  test("a 'not logged in' CLI failure surfaces as auth-required, via the real SDK plumbing", () => {
    const res = runAgainstFixture("fake-claude-not-logged-in.sh");
    expect(res.ok).toBe(false);
    expect(res.isAuth).toBe(true);
    expect(res.isModelUnavailable).toBe(false);
    expect(res.message).toMatch(/claude \/login/i);
  });

  test("a generic (non-auth) CLI failure stays model-unavailable and carries the CLI's own reason", () => {
    const res = runAgainstFixture("fake-claude-generic-error.sh");
    expect(res.ok).toBe(false);
    expect(res.isAuth).toBe(false);
    expect(res.isModelUnavailable).toBe(true);
    expect(res.message).toContain("Internal crash: unexpected token in config");
  });
});
