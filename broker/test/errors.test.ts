// Integration test: spins up the real Bun.serve server and drives it over an
// actual WebSocket, to check that handshake failures emit the `unauthorized`
// error message the protocol promises (docs/PROTOCOL.md:87-88) before the
// close(4401) — see ARCHITECTURE.md §7 "codes d'erreur morts".

import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import type { ServerMessage } from "../src/protocol.ts";

const ALLOWED_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "0123456789abcdef0123456789abcdef";

let servers: ReturnType<typeof startServer>[] = [];

function boot() {
  const dataDir = mkdtempSync(join(tmpdir(), "wingpen-errors-"));
  const server = startServer(
    { port: 0, allowedExtensionIds: [ALLOWED_ID] },
    SECRET,
    { dataDir },
  );
  servers.push(server);
  return { server, dataDir };
}

afterEach(() => {
  for (const s of servers) s.stop(true);
  servers = [];
});

/** Collects every ServerMessage received until the socket closes, plus the close code. */
function collectUntilClose(ws: WebSocket): Promise<{ messages: ServerMessage[]; code: number }> {
  const messages: ServerMessage[] = [];
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => {
      messages.push(JSON.parse(event.data as string));
    });
    ws.addEventListener("close", (event) => {
      resolve({ messages, code: event.code });
    });
  });
}

describe("unauthorized error emission on bad handshake", () => {
  test("wrong Origin: emits error(unauthorized) then closes 4401", async () => {
    const { server } = boot();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { Origin: "chrome-extension://wrong-id-wrong-id-wrong-id-wro" },
    } as any);
    const { messages, code } = await collectUntilClose(ws);
    expect(code).toBe(4401);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "error", code: "unauthorized" });
  });

  test("wrong pairing secret: emits error(unauthorized) then closes 4401", async () => {
    const { server } = boot();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { Origin: `chrome-extension://${ALLOWED_ID}` },
    } as any);
    const donePromise = collectUntilClose(ws);
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    ws.send(JSON.stringify({ type: "hello", secret: "not-the-secret", v: 1 }));
    const { messages, code } = await donePromise;
    expect(code).toBe(4401);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "error", code: "unauthorized" });
  });

  test("correct handshake: no error, gets hello-ok", async () => {
    const { server } = boot();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { Origin: `chrome-extension://${ALLOWED_ID}` },
    } as any);
    const helloOk = new Promise<ServerMessage>((resolve) => {
      ws.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)));
    });
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    ws.send(JSON.stringify({ type: "hello", secret: SECRET, v: 1 }));
    const msg = await helloOk;
    expect(msg).toMatchObject({ type: "hello-ok" });
    ws.close();
  });
});
