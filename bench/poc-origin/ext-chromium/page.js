// Runs in a normal extension page (a tab), not a service worker — see
// background.js for why this context matters for the DNR-escape claim.
const ws = new WebSocket("ws://127.0.0.1:18801/?label=chromium-page-forged");
ws.onopen = () => ws.send(JSON.stringify({ cmd: "report", label: "chromium-page-forged", from: "extension-page" }));
ws.onmessage = (ev) => console.log("poc-origin page: server said", ev.data);
ws.onerror = (err) => console.error("poc-origin page: ws error", err);
setTimeout(() => {
  try {
    ws.close();
  } catch {}
}, 1500);
