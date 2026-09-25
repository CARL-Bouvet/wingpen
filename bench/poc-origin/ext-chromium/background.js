// PoC service worker, lot L5 (goal-6t00P5LW). On install, attempts a
// WebSocket connection to ws://127.0.0.1:18801 from three different contexts
// so their results can be compared against the same DNR ruleset
// (rules.json), which unconditionally rewrites the Origin header for any
// websocket request to ws://127.0.0.1/*:
//   1. this service worker itself — research (notes/recherche_appairage_
//      2026-09-25.md, C2) says a Chromium bug lets service-worker-initiated
//      WebSockets escape DNR header modification; kept as a negative control.
//   2. a normal extension page (page.html), opened as a tab.
//   3. an offscreen document (offscreen.html) — the case the research flags
//      as the interesting one, since it is NOT a service worker context.

function openWs(label) {
  const ws = new WebSocket(`ws://127.0.0.1:18801/?label=${encodeURIComponent(label)}`);
  ws.onopen = () => ws.send(JSON.stringify({ cmd: "report", label, from: "service-worker" }));
  ws.onerror = (err) => console.error("poc-origin-chromium: ws error for", label, err);
  setTimeout(() => {
    try {
      ws.close();
    } catch {}
  }, 1500);
}

chrome.runtime.onInstalled.addListener(async () => {
  openWs("chromium-serviceworker-control");

  chrome.tabs.create({ url: chrome.runtime.getURL("page.html") });

  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["TESTING"],
      justification: "PoC WebSocket connection for Wingpen lot L5 Origin-forgery experiment (bench/poc-origin).",
    });
  } catch (err) {
    console.error("poc-origin-chromium: offscreen.createDocument failed", err);
  }
});
