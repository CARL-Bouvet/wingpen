// Runs in an offscreen document, not a service worker — the case the
// research (notes/recherche_appairage_2026-09-25.md, C2) flags as the
// interesting one: not covered by the service-worker-specific DNR escape
// bug it describes.
const ws = new WebSocket("ws://127.0.0.1:18801/?label=chromium-offscreen-forged");
ws.onopen = () => ws.send(JSON.stringify({ cmd: "report", label: "chromium-offscreen-forged", from: "offscreen-document" }));
ws.onmessage = (ev) => console.log("poc-origin offscreen: server said", ev.data);
ws.onerror = (err) => console.error("poc-origin offscreen: ws error", err);
setTimeout(() => {
  try {
    ws.close();
  } catch {}
}, 1500);
