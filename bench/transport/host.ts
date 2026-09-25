#!/usr/bin/env bun
// Native Messaging host for the transport bench (lot 2, goal-3jSMWnRt).
// Standard Chrome/Firefox Native Messaging framing: each message is a
// 4-byte length prefix in the platform's native byte order (little-endian
// on every machine this runs on) followed by that many bytes of UTF-8 JSON.
//
// Spawned by the browser itself (per the native-messaging-hosts manifest),
// never run directly except for manual smoke testing.

import { handleCommand } from "./handler.ts";
import type { BenchReply } from "./protocol.ts";

// Written so run.ts (spawned by the browser, not by us) can find this
// process's pid for `ps` sampling. Best-effort, not part of the protocol.
try {
  await Bun.write(new URL(".nm-host.pid", import.meta.url), String(process.pid));
} catch {
  /* non-fatal */
}

const stdin = Bun.stdin.stream();
const writer = Bun.stdout.writer();

function writeFrame(reply: BenchReply): void {
  const body = Buffer.from(JSON.stringify(reply), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  writer.write(header);
  writer.write(body);
  writer.flush();
}

let buffer = Buffer.alloc(0);

function tryDrain(): void {
  for (;;) {
    if (buffer.length < 4) return;
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) return;
    const body = buffer.subarray(4, 4 + len);
    buffer = buffer.subarray(4 + len);
    let cmd: unknown;
    try {
      cmd = JSON.parse(body.toString("utf8"));
    } catch (err) {
      writeFrame({ cmd: "error", message: `bad JSON: ${(err as Error).message}` });
      continue;
    }
    handleCommand(cmd as any, writeFrame).catch((err) => {
      writeFrame({ cmd: "error", message: String(err) });
    });
  }
}

for await (const chunk of stdin) {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
  tryDrain();
}
// stdin closed: the browser disconnected the port. Exit cleanly.
process.exit(0);
