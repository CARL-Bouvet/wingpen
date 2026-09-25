#!/usr/bin/env bun
// WebSocket transport for the bench, listening on 127.0.0.1:18787 — NOT the
// real broker port (8787). Implements the same commands as host.ts so the
// two transports are compared apples-to-apples. Never bind anything but
// 127.0.0.1: this repo's non-negotiable rule #2 applies to this prototype
// too even though it never ships.

import { handleCommand } from "./handler.ts";
import type { BenchReply } from "./protocol.ts";

const PORT = 18787;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(req, srv) {
    if (srv.upgrade(req)) return;
    return new Response("wingpen transport bench ws-server", { status: 200 });
  },
  websocket: {
    message(ws, raw) {
      let cmd: unknown;
      try {
        cmd = JSON.parse(String(raw));
      } catch (err) {
        ws.send(JSON.stringify({ cmd: "error", message: `bad JSON: ${(err as Error).message}` }));
        return;
      }
      const send = (reply: BenchReply) => ws.send(JSON.stringify(reply));
      handleCommand(cmd as any, send).catch((err) => {
        send({ cmd: "error", message: String(err) });
      });
    },
  },
});

console.error(`bench ws-server listening on 127.0.0.1:${PORT} (pid ${process.pid})`);
