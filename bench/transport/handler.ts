// Command handler shared by host.ts (Native Messaging) and ws-server.ts
// (WebSocket) so both transports answer identically. Each transport wraps
// this in its own framing (4-byte length prefix for NM, plain JSON text
// frames for WS).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BenchCommand, BenchReply } from "./protocol.ts";
import { RESULTS_DIR } from "./protocol.ts";

export async function handleCommand(
  cmd: BenchCommand,
  send: (reply: BenchReply) => void,
): Promise<void> {
  switch (cmd.cmd) {
    case "hello":
      send({ cmd: "hello-ok" });
      return;
    case "ping":
      send({ cmd: "pong", seq: cmd.seq, t0: cmd.t0 });
      return;
    case "stream-start": {
      const payload = "x".repeat(cmd.size);
      for (let seq = 0; seq < cmd.count; seq++) {
        send({ cmd: "chunk", seq, data: payload });
      }
      send({ cmd: "stream-end", count: cmd.count });
      return;
    }
    case "upload":
      send({ cmd: "upload-ack", seq: cmd.seq, bytes: cmd.data.length });
      return;
    case "results": {
      await mkdir(RESULTS_DIR, { recursive: true });
      const path = join(RESULTS_DIR, `${cmd.browser}-${cmd.transport}.json`);
      await writeFile(path, JSON.stringify(cmd.measurements, null, 2) + "\n", "utf8");
      send({ cmd: "results-ack" });
      return;
    }
    default:
      send({ cmd: "error", message: `unknown command: ${JSON.stringify(cmd)}` });
  }
}
