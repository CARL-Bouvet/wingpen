// Wingpen transport bench — bench extension background script.
// Isolated prototype for lot 2 of goal-3jSMWnRt. NEVER wired into the real
// product. Runs automatically on load (no user gesture): this is a
// throwaway measurement harness, not something that ships.
//
// Loaded two ways depending on browser:
//  - Chromium (classic, non-module service worker): this file calls
//    importScripts("bench-config.js") itself.
//  - Firefox (background.scripts array): bench-config.js is listed before
//    this file in the manifest and already ran in the same global scope.
// Either way, `self.BENCH_CONFIG` is expected to be set before the IIFE
// below runs its logic.

if (typeof importScripts === "function") {
  try {
    importScripts("bench-config.js");
  } catch (err) {
    console.error("importScripts(bench-config.js) failed:", err);
  }
}

const CFG = self.BENCH_CONFIG;

// Overridable via CFG.params for a fast smoke test of the whole pipeline
// (browser + extension + transport + collector) before committing to a
// full ~6 minute run per (browser, transport) pair. Defaults match the
// measurement protocol in the brief exactly.
const PARAMS = Object.assign(
  {
    coldConnectRuns: 10,
    roundTripRuns: 3,
    roundTripPings: 1000,
    streamingRuns: 3,
    streamingChunks: 5000,
    streamingChunkSize: 60,
    uploadRuns: 5,
    uploadBytes: 1024 * 1024,
    idleMs: 5 * 60 * 1000,
  },
  CFG?.params || {},
);

// --- small helpers -----------------------------------------------------

function nowMs() {
  return performance.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 0.5),
    p95: percentile(s, 0.95),
    p99: percentile(s, 0.99),
    min: s[0] ?? null,
    max: s[s.length - 1] ?? null,
  };
}

// --- transport abstraction ---------------------------------------------
// Both branches expose the same shape: { ready, send, onMessage, close }.

function createConnection() {
  if (CFG.transport === "ws") {
    const ws = new WebSocket(CFG.wsUrl);
    let onAny = null;
    ws.onmessage = (ev) => {
      if (onAny) onAny(JSON.parse(ev.data));
    };
    const ready = new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("websocket error"));
    });
    return {
      ready,
      send: (obj) => ws.send(JSON.stringify(obj)),
      onMessage: (fn) => {
        onAny = fn;
      },
      close: () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
    };
  }

  // Native Messaging. connectNative() returns synchronously; there is no
  // separate "open" event, so `ready` resolves immediately and the actual
  // host-spawn latency shows up in the first round trip — which is exactly
  // what the cold-connect measurement wants to capture.
  let port;
  let connectError = null;
  try {
    port = chrome.runtime.connectNative(CFG.nmHost);
  } catch (err) {
    connectError = err;
  }
  let onAny = null;
  let disconnectError = null;
  if (port) {
    port.onMessage.addListener((msg) => {
      if (onAny) onAny(msg);
    });
    port.onDisconnect.addListener(() => {
      disconnectError = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : "disconnected (no lastError)";
    });
  }
  return {
    ready: connectError ? Promise.reject(connectError) : Promise.resolve(),
    send: (obj) => {
      if (disconnectError) throw new Error(`native port already disconnected: ${disconnectError}`);
      port.postMessage(obj);
    },
    onMessage: (fn) => {
      onAny = fn;
    },
    close: () => {
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
    },
    get lastDisconnectError() {
      return disconnectError;
    },
  };
}

async function helloHandshake(conn, timeoutMs = 8000) {
  const helloOk = new Promise((resolve) => {
    conn.onMessage((msg) => {
      if (msg.cmd === "hello-ok") resolve();
    });
  });
  conn.send({ cmd: "hello" });
  await withTimeout(helloOk, timeoutMs, "hello handshake");
}

// --- results / incremental persistence ----------------------------------

const results = {
  meta: {
    browser: CFG?.browser,
    transport: CFG?.transport,
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
  },
  coldConnect: [],
  roundTrip: [],
  streaming: [],
  upload: [],
  idle: null,
  errors: [],
};

async function persist() {
  results.meta.updatedAt = new Date().toISOString();
  const conn = createConnection();
  try {
    await withTimeout(conn.ready, 5000, "persist: connect");
    await helloHandshake(conn, 5000);
    const acked = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("results-ack timeout")), 10000);
      conn.onMessage((msg) => {
        if (msg.cmd === "results-ack") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    conn.send({ cmd: "results", browser: CFG.browser, transport: CFG.transport, measurements: results });
    await acked;
  } catch (err) {
    // Best-effort: note it locally, keep going. Nothing else we can do if
    // the collector is unreachable — the next persist() call may succeed.
    console.error("persist() failed:", err);
  } finally {
    conn.close();
  }
}

// --- measurement 1: cold connect (10 runs) -------------------------------

async function coldConnectOnce() {
  const t0 = nowMs();
  const conn = createConnection();
  const helloOk = new Promise((resolve) => {
    conn.onMessage((msg) => {
      if (msg.cmd === "hello-ok") resolve();
    });
  });
  await withTimeout(conn.ready, 5000, "cold connect: ready");
  conn.send({ cmd: "hello" });
  await withTimeout(helloOk, 8000, "cold connect: hello-ok");
  const elapsed = nowMs() - t0;
  conn.close();
  return elapsed;
}

async function runColdConnect() {
  const samples = [];
  for (let i = 0; i < PARAMS.coldConnectRuns; i++) {
    try {
      samples.push(await coldConnectOnce());
    } catch (err) {
      results.errors.push(`coldConnect run ${i}: ${String(err)}`);
    }
    await sleep(100);
  }
  results.coldConnect = { samples, ...stats(samples) };
}

// --- measurement 2: round trip (1000 sequential pings, 3 runs) ----------

async function roundTripOnce() {
  const conn = createConnection();
  await withTimeout(conn.ready, 5000, "round trip: ready");
  await helloHandshake(conn);
  const samples = [];
  const startedAt = Date.now();
  for (let seq = 0; seq < PARAMS.roundTripPings; seq++) {
    const t0 = nowMs();
    await withTimeout(
      new Promise((resolve) => {
        conn.onMessage((msg) => {
          if (msg.cmd === "pong" && msg.seq === seq) resolve();
        });
        conn.send({ cmd: "ping", seq, t0 });
      }),
      5000,
      `round trip seq ${seq}`,
    );
    samples.push(nowMs() - t0);
  }
  const endedAt = Date.now();
  conn.close();
  return { samples, startedAt, endedAt };
}

async function runRoundTrip() {
  const runs = [];
  for (let i = 0; i < PARAMS.roundTripRuns; i++) {
    try {
      const { samples, startedAt, endedAt } = await roundTripOnce();
      runs.push({ startedAt, endedAt, ...stats(samples) });
    } catch (err) {
      results.errors.push(`roundTrip run ${i}: ${String(err)}`);
    }
    await sleep(200);
  }
  results.roundTrip = runs;
}

// --- measurement 3: streaming host->extension (5000 * 60 bytes, 3 runs) -

async function streamingOnce() {
  const conn = createConnection();
  await withTimeout(conn.ready, 5000, "streaming: ready");
  await helloHandshake(conn);
  let bytes = 0;
  let count = 0;
  const t0 = nowMs();
  const done = withTimeout(
    new Promise((resolve) => {
      conn.onMessage((msg) => {
        if (msg.cmd === "chunk") {
          bytes += msg.data.length;
          count++;
        } else if (msg.cmd === "stream-end") {
          resolve();
        }
      });
    }),
    20000,
    "streaming: stream-end",
  );
  conn.send({ cmd: "stream-start", count: PARAMS.streamingChunks, size: PARAMS.streamingChunkSize });
  await done;
  const elapsed = nowMs() - t0;
  conn.close();
  return { elapsed, bytes, count, throughputBytesPerSec: bytes / (elapsed / 1000) };
}

async function runStreaming() {
  const runs = [];
  for (let i = 0; i < PARAMS.streamingRuns; i++) {
    try {
      runs.push(await streamingOnce());
    } catch (err) {
      results.errors.push(`streaming run ${i}: ${String(err)}`);
    }
    await sleep(200);
  }
  results.streaming = runs;
}

// --- measurement 4: upload extension->host (1 MiB, 5 runs) --------------

async function uploadOnce(seq) {
  const conn = createConnection();
  await withTimeout(conn.ready, 5000, "upload: ready");
  await helloHandshake(conn);
  const data = "x".repeat(PARAMS.uploadBytes);
  const t0 = nowMs();
  let error = null;
  let ackBytes = null;
  try {
    const ackPromise = new Promise((resolve) => {
      conn.onMessage((msg) => {
        if (msg.cmd === "upload-ack") resolve(msg);
      });
    });
    conn.send({ cmd: "upload", seq, data });
    const ack = await withTimeout(ackPromise, 20000, "upload: ack");
    ackBytes = ack.bytes;
  } catch (err) {
    error = String(err) + (conn.lastDisconnectError ? ` (disconnect: ${conn.lastDisconnectError})` : "");
  }
  const elapsed = nowMs() - t0;
  conn.close();
  return { elapsed, ackBytes, error };
}

async function runUpload() {
  const runs = [];
  for (let i = 0; i < PARAMS.uploadRuns; i++) {
    runs.push(await uploadOnce(i));
    await sleep(200);
  }
  results.upload = runs;
}

// --- measurement 5: idle survival (5 minutes) ----------------------------

async function runIdle() {
  results.idle = { status: "pending", startedAt: new Date().toISOString() };
  await persist(); // flush "pending" BEFORE the long wait, so a SW kill is visible.

  const conn = createConnection();
  let openError = null;
  try {
    await withTimeout(conn.ready, 5000, "idle: ready");
    await helloHandshake(conn);
  } catch (err) {
    openError = String(err);
  }

  if (openError) {
    results.idle = { status: "error", error: `could not establish connection: ${openError}` };
    return;
  }

  await sleep(PARAMS.idleMs);

  const t0 = nowMs();
  try {
    const pong = new Promise((resolve) => {
      conn.onMessage((msg) => {
        if (msg.cmd === "pong") resolve();
      });
    });
    conn.send({ cmd: "ping", seq: -1, t0 });
    await withTimeout(pong, 10000, "idle: post-idle ping");
    results.idle = {
      status: "survived",
      pingElapsedMs: nowMs() - t0,
      serviceWorkerSurvivedInProcess: true,
    };
  } catch (err) {
    results.idle = {
      status: "failed",
      error: String(err) + (conn.lastDisconnectError ? ` (disconnect: ${conn.lastDisconnectError})` : ""),
    };
  } finally {
    conn.close();
  }
}

// --- orchestration --------------------------------------------------------

async function main() {
  if (!CFG) {
    console.error("BENCH_CONFIG missing — this load is for extension-id discovery only, not running the bench.");
    return;
  }
  try {
    await runColdConnect();
    await persist();
    await runRoundTrip();
    await persist();
    await runStreaming();
    await persist();
    await runUpload();
    await persist();
    await runIdle();
  } catch (err) {
    results.errors.push(`fatal: ${String(err)}`);
  } finally {
    await persist();
  }
}

main().catch((err) => console.error("bench main() crashed:", err));
