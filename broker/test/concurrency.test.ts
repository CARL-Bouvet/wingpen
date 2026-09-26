// Integration test for item 3's per-connection concurrency cap
// (MAX_CONCURRENT_STREAMS, server.ts): a connection with 3 chat streams
// already running must have its 4th rejected with bad-request, naming the
// limit, without spawning a 4th model call.

import { describe, expect, test, afterEach } from "bun:test";
import { startServer, MAX_CONCURRENT_STREAMS } from "../src/server.ts";
import { __setQueryImplForTests, __resetQueryImplForTests } from "../src/model.ts";
import type { ServerMessage } from "../src/protocol.ts";
import { makeTmpDir } from "./helpers/tmp-dir.ts";

const ALLOWED_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "0123456789abcdef0123456789abcdef";

let servers: ReturnType<typeof startServer>[] = [];

function boot() {
  const dataDir = makeTmpDir("wingpen-concurrency-");
  const server = startServer({ port: 0, allowedExtensionIds: [ALLOWED_ID] }, SECRET, { dataDir });
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const s of servers) s.stop(true);
  servers = [];
  __resetQueryImplForTests();
});

async function connectAndAuth(server: ReturnType<typeof startServer>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
    headers: { Origin: `chrome-extension://${ALLOWED_ID}` },
  } as any);
  await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
  const helloOk = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string);
      if (msg.type === "hello-ok") {
        ws.removeEventListener("message", onMessage);
        resolve();
      }
    };
    ws.addEventListener("message", onMessage);
  });
  ws.send(JSON.stringify({ type: "hello", secret: SECRET, v: 1 }));
  await helloOk;
  return ws;
}

describe("MAX_CONCURRENT_STREAMS", () => {
  test("a 4th concurrent chat on the same connection is rejected as bad-request", async () => {
    // A model call that never resolves: keeps the first MAX_CONCURRENT_STREAMS
    // requests "active" for the duration of the test without needing a real
    // `claude` binary.
    __setQueryImplForTests((() => {
      async function* gen() {
        await new Promise(() => {}); // never settles
      }
      return gen();
    }) as any);

    const server = boot();
    const ws = await connectAndAuth(server);

    const messages: ServerMessage[] = [];
    ws.addEventListener("message", (event) => {
      messages.push(JSON.parse(event.data as string));
    });

    for (let i = 0; i < MAX_CONCURRENT_STREAMS; i++) {
      ws.send(JSON.stringify({ type: "chat", id: `stream-${i}`, text: "hello" }));
    }
    // The 4th (one past the cap) must be rejected immediately.
    ws.send(JSON.stringify({ type: "chat", id: "stream-over-cap", text: "hello" }));

    // Give the event loop a turn to deliver the rejection.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const rejection = messages.find((m) => (m as any).id === "stream-over-cap");
    expect(rejection).toMatchObject({ type: "error", code: "bad-request" });
    expect((rejection as any).message).toContain(String(MAX_CONCURRENT_STREAMS));

    // None of the first MAX_CONCURRENT_STREAMS requests should have been
    // rejected — they're legitimately within the cap.
    for (let i = 0; i < MAX_CONCURRENT_STREAMS; i++) {
      const msg = messages.find((m) => (m as any).id === `stream-${i}`);
      expect(msg).toBeUndefined();
    }

    ws.close();
  });
});
