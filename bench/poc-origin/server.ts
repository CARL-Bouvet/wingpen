#!/usr/bin/env bun
// PoC WebSocket server for lot L5 (goal-6t00P5LW), Origin-forgery experiments.
// Listens on 127.0.0.1:18801 — NEVER the real broker port (8787). Logs, for
// every upgrade attempt, the Origin and Host headers it received and whether
// Origin matches the real Wingpen Chrome extension id, then answers a fixed
// JSON. One JSON line is appended per connection to
// bench/poc-origin/results/observations.ndjson.
//
// This never binds anything but 127.0.0.1, and is never wired into the real
// broker or extension.

import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = 18801;
const RESULTS_DIR = join(import.meta.dir, "results");
const RESULTS_FILE = join(RESULTS_DIR, "observations.ndjson");
const WINGPEN_CHROME_ID = "hehlgipomfminodhahcjbencblepjhah";
const WINGPEN_CHROME_ORIGIN = `chrome-extension://${WINGPEN_CHROME_ID}`;

await mkdir(RESULTS_DIR, { recursive: true });

function classifyOrigin(origin: string | null): { matchesWingpenChromeId: boolean; kind: string } {
  if (origin === WINGPEN_CHROME_ORIGIN) return { matchesWingpenChromeId: true, kind: "chrome-wingpen-forged-or-real" };
  if (origin?.startsWith("chrome-extension://")) return { matchesWingpenChromeId: false, kind: "chrome-other" };
  if (origin?.startsWith("moz-extension://")) return { matchesWingpenChromeId: false, kind: "moz-extension" };
  if (origin === null || origin === undefined) return { matchesWingpenChromeId: false, kind: "none" };
  return { matchesWingpenChromeId: false, kind: "other" };
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    const label = url.searchParams.get("label") ?? "unlabeled";
    const classification = classifyOrigin(origin);
    const record = {
      t: new Date().toISOString(),
      label,
      origin,
      host,
      userAgent: req.headers.get("user-agent"),
      ...classification,
    };
    console.error("[poc-origin] upgrade attempt:", JSON.stringify(record));
    appendFile(RESULTS_FILE, JSON.stringify(record) + "\n").catch((err) => {
      console.error("[poc-origin] failed to write results:", err);
    });

    if (srv.upgrade(req, { data: record })) return;
    return new Response(JSON.stringify({ ok: true, note: "poc-origin server alive, no upgrade" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ cmd: "hello", server: "poc-origin", sawOrigin: (ws.data as any).origin, sawHost: (ws.data as any).host }));
    },
    message(ws, raw) {
      // Echo back whatever was sent plus the recorded headers, so the
      // extension under test can report the server's view of itself.
      let payload: unknown;
      try {
        payload = JSON.parse(String(raw));
      } catch {
        payload = String(raw);
      }
      ws.send(
        JSON.stringify({
          cmd: "echo",
          received: payload,
          sawOrigin: (ws.data as any).origin,
          sawHost: (ws.data as any).host,
        }),
      );
    },
  },
});

console.error(`poc-origin server listening on 127.0.0.1:${PORT} (pid ${process.pid})`);
console.error(`results file: ${RESULTS_FILE}`);
