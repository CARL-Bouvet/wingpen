// GET /pair (one-click pairing, see docs/PROTOCOL.md "Appairage en un clic").
// Verifies: the pairing page is served with the token and extension id
// embedded and escaped, every other path still 404s, and the bind address
// stays 127.0.0.1 (CLAUDE.md non-negotiable rule #2).

import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { renderPairPage } from "../src/pair.ts";

const ALLOWED_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "0123456789abcdef0123456789abcdef";

let servers: ReturnType<typeof startServer>[] = [];

function boot(allowedExtensionIds: string[] = [ALLOWED_ID]) {
  const dataDir = mkdtempSync(join(tmpdir(), "wingpen-pair-"));
  const server = startServer({ port: 0, allowedExtensionIds }, SECRET, { dataDir });
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const s of servers) s.stop(true);
  servers = [];
});

describe("GET /pair", () => {
  test("returns 200 html with the token embedded", async () => {
    const server = boot();
    const res = await fetch(`http://127.0.0.1:${server.port}/pair`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain(SECRET); // JSON.stringify'd literal and the fallback <code> both contain it verbatim (hex, nothing to escape)
    expect(body).toContain(ALLOWED_ID);
    expect(body).toContain("Connecter Wingpen");
  });

  test("only the pinned bind address is used — never 0.0.0.0", async () => {
    const server = boot();
    expect(server.hostname).toBe("127.0.0.1");
  });

  test("any other path still 404s", async () => {
    const server = boot();
    for (const path of ["/", "/pair/", "/pair/x", "/pairing", "/unknown"]) {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
      expect(res.status).toBe(404);
    }
  });

  test("POST /pair 404s — the route is GET only", async () => {
    const server = boot();
    const res = await fetch(`http://127.0.0.1:${server.port}/pair`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("renders a no-extension-configured page instead of a broken button when allowedExtensionIds is empty", async () => {
    const server = boot([]);
    const res = await fetch(`http://127.0.0.1:${server.port}/pair`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("<button");
    expect(body).toContain("Aucune extension autorisée");
  });
});

describe("renderPairPage — escaping", () => {
  test("escapes a hostile token for both the HTML fallback and the JS string literal", () => {
    const hostile = '</script><script>alert(1)</script>"\'';
    const html = renderPairPage({ port: 8787, extensionIds: [ALLOWED_ID], token: hostile });

    // The raw hostile substring must never appear verbatim.
    expect(html).not.toContain(hostile);
    // No unescaped "</script>" other than the two legitimate closing tags this
    // page itself emits (one inline <script> block).
    const scriptCloses = html.match(/<\/script>/g) ?? [];
    expect(scriptCloses.length).toBe(1);
  });

  test("escapes a hostile extension id the same way", () => {
    const hostile = '"></script><script>alert(1)</script>';
    const html = renderPairPage({ port: 8787, extensionIds: [hostile], token: SECRET });
    expect(html).not.toContain(hostile);
    const scriptCloses = html.match(/<\/script>/g) ?? [];
    expect(scriptCloses.length).toBe(1);
  });
});
