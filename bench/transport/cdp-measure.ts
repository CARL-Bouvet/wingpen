// Brave measurement through CDP, added 2026-09-25 by the admin after the
// auto-run bench could not complete its Brave/NM pass (see
// bench/results/brave-nm.json). Same handler (handler.ts) and same workload as
// run.ts, but driven by Runtime.evaluate inside the bench service worker.
// Limit: an attached DevTools session keeps the service worker alive, so this
// script measures latency and throughput only — never idle survival.
//
// Usage: bun bench/transport/cdp-measure.ts <nm|ws> [debugPort]

const mode = process.argv[2];
const port = process.argv[3] ?? "9447";
if (mode !== "nm" && mode !== "ws") {
  console.error("usage: bun bench/transport/cdp-measure.ts <nm|ws> [debugPort]");
  process.exit(2);
}

const expression = `(async (mode) => {
  const now = () => performance.now();
  const open = () => new Promise((resolve, reject) => {
    const t0 = now();
    const handlers = [];
    let c;
    if (mode === "nm") {
      const p = chrome.runtime.connectNative("wingpen_bench");
      p.onMessage.addListener((m) => handlers.slice().forEach((f) => f(m)));
      p.onDisconnect.addListener(() => reject(new Error("nm disconnect: " + (chrome.runtime.lastError && chrome.runtime.lastError.message))));
      c = { send: (m) => p.postMessage(m), close: () => p.disconnect() };
    } else {
      const ws = new WebSocket("ws://127.0.0.1:18787");
      ws.onmessage = (e) => { const m = JSON.parse(e.data); handlers.slice().forEach((f) => f(m)); };
      ws.onerror = () => reject(new Error("ws error"));
      c = { send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() };
      c.ready = new Promise((r) => { ws.onopen = r; });
    }
    c.on = (f) => handlers.push(f);
    c.off = (f) => { const i = handlers.indexOf(f); if (i >= 0) handlers.splice(i, 1); };
    const onHello = (m) => { if (m.cmd === "hello-ok") { c.off(onHello); resolve({ c, ms: now() - t0 }); } };
    c.on(onHello);
    Promise.resolve(c.ready).then(() => c.send({ cmd: "hello" }));
  });
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
  const cold = [];
  for (let i = 0; i < 10; i++) { const { c, ms } = await open(); cold.push(ms); c.close(); await new Promise((r) => setTimeout(r, 200)); }
  const { c } = await open();
  const req = (msg, done) => new Promise((r) => { const f = (m) => { if (done(m)) { c.off(f); r(m); } }; c.on(f); c.send(msg); });
  const rtt = [];
  for (let i = 0; i < 1000; i++) { const t = now(); await req({ cmd: "ping", seq: i, t0: t }, (m) => m.cmd === "pong" && m.seq === i); rtt.push(now() - t); }
  const stream = [];
  for (let r = 0; r < 3; r++) { const t = now(); await req({ cmd: "stream-start", count: 5000, size: 60 }, (m) => m.cmd === "stream-end"); stream.push(+(now() - t).toFixed(1)); }
  const data = "y".repeat(1024 * 1024);
  const upload = [];
  for (let r = 0; r < 5; r++) { const t = now(); await req({ cmd: "upload", seq: r, data }, (m) => m.cmd === "upload-ack" && m.seq === r); upload.push(+(now() - t).toFixed(1)); }
  c.close();
  return { mode, coldConnectMs: { p50: pct(cold, 0.5), max: pct(cold, 1) }, roundTripMs: { p50: pct(rtt, 0.5), p95: pct(rtt, 0.95), p99: pct(rtt, 0.99) }, stream5000x60Ms: stream, upload1MiBMs: upload };
})(${JSON.stringify(mode)})`;

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((t: any) => t.type === "service_worker" && t.url.includes("background.js"));
if (!target) {
  console.error("bench service worker not found on CDP port " + port);
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
const value = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("CDP timeout after 120s")), 120_000);
  ws.onopen = () =>
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id !== 1) return;
    clearTimeout(timer);
    if (m.result?.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500)));
    else resolve(m.result?.result?.value);
  };
});
console.log(JSON.stringify(value));
process.exit(0);
