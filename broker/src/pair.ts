// Renders the broker's self-served pairing page (GET /pair, see
// docs/PROTOCOL.md "Appairage en un clic"). This page is served by the
// broker over plain HTTP to 127.0.0.1 — it is NOT an extension page, so the
// extension's CSP (manifest.json, content_security_policy) does not apply to
// it. An inline <style> and <script> block is acceptable here for that
// reason; nowhere else in this codebase.
//
// Everything server-controlled (pairing token, extension id, port) is
// injected below. Nothing here comes from the request — there is no user
// input to this page — but both the token and the configured extension id
// come from files an admin could hand-edit (config.json, pairing.txt), so
// they are escaped exactly as if they were untrusted, defense in depth.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Embeds a string as a JS string literal inside an inline <script> block.
// JSON.stringify handles quote/backslash escaping; the extra `<`/`>` escape
// blocks a "</script>" (or "<script>") breakout even though neither the
// token (hex) nor a well-formed extension id (a-p) can normally contain one.
function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export interface PairPageOptions {
  /** Port the broker is actually listening on. */
  port: number;
  /** Every allowed extension id. The page tries them in order and keeps the
   * first that answers — a config file usually carries stale ids from earlier
   * unpacked loads, and targeting only the first one pairs with a ghost. */
  extensionIds: string[];
  /** The pairing secret (docs/PROTOCOL.md handshake step 2). */
  token: string;
}

export function renderPairPage({ port, extensionIds, token }: PairPageOptions): string {
  if (!extensionIds || extensionIds.length === 0) {
    // No allowedExtensionIds configured — nothing to pair with. Say so rather
    // than rendering a button that can only ever fail.
    return renderErrorPage(
      "Aucune extension autorisée n'est configurée sur ce broker (allowedExtensionIds est vide dans config.json). Rien à appairer.",
    );
  }

  const safeToken = escapeHtml(token);
  const tokenLiteral = jsStringLiteral(token);
  const extensionIdsLiteral = `[${extensionIds.map(jsStringLiteral).join(",")}]`;
  const safePort = escapeHtml(String(port));

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connecter Wingpen</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    max-width: 480px;
    margin: 48px auto;
    padding: 0 16px;
    color: #1f2430;
    line-height: 1.5;
  }
  h1 { font-size: 20px; }
  p.help { color: #555; }
  button {
    border: none;
    background: #3b5cf6;
    color: #fff;
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
  }
  button:hover { background: #2d4be0; }
  button:disabled { background: #9aa4c4; cursor: default; }
  #result { min-height: 1.5em; font-weight: 600; }
  #result.ok { color: #1a8a4a; }
  #result.err { color: #b0332f; }
  details {
    margin-top: 24px;
    border: 1px solid #d8d8de;
    border-radius: 8px;
    padding: 12px 16px;
  }
  code {
    display: block;
    margin-top: 8px;
    padding: 8px;
    background: #f3f3f6;
    border-radius: 6px;
    word-break: break-all;
    font-size: 13px;
  }
</style>
</head>
<body>
  <h1>Connecter Wingpen</h1>
  <p class="help">
    Cette page va transmettre le jeton de pairage à l'extension Wingpen installée
    dans ce navigateur, pour qu'elle se connecte au broker qui tourne sur cette
    machine (127.0.0.1:${safePort}). Rien n'est envoyé ailleurs.
  </p>
  <p>
    <button id="connect" type="button">Connecter Wingpen</button>
  </p>
  <p id="result" role="status"></p>
  <details id="fallback" hidden>
    <summary>La connexion automatique n'a pas fonctionné — copier le jeton manuellement</summary>
    <p>Ouvrez les réglages de l'extension Wingpen (clic droit sur son icône → Options) et collez ce jeton :</p>
    <code id="tokenFallback">${safeToken}</code>
  </details>
  <script>
  (function () {
    var EXTENSION_IDS = ${extensionIdsLiteral};
    var TOKEN = ${tokenLiteral};
    var btn = document.getElementById("connect");
    var result = document.getElementById("result");
    var fallback = document.getElementById("fallback");

    function showFallback(reason) {
      result.textContent = "\u00c9chec : " + reason;
      result.className = "err";
      btn.disabled = false;
      fallback.hidden = false;
    }

    btn.addEventListener("click", function () {
      btn.disabled = true;
      result.textContent = "Connexion\u2026";
      result.className = "";

      if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        showFallback("l'extension Wingpen n'est pas installée dans ce navigateur.");
        return;
      }

      // Try every allowed id in turn: only one of them is the extension that is
      // actually installed, and it is not necessarily the first in config.json.
      var lastReason = "l'extension Wingpen n'a pas répondu (installée ? bon identifiant ?).";
      function tryId(i) {
        if (i >= EXTENSION_IDS.length) {
          showFallback(lastReason);
          return;
        }
        try {
          chrome.runtime.sendMessage(EXTENSION_IDS[i], { type: "wingpen:pair", token: TOKEN }, function (response) {
            if (chrome.runtime.lastError || !response || response.ok !== true) {
              lastReason =
                (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
                (response && response.reason) ||
                lastReason;
              tryId(i + 1);
              return;
            }
            result.textContent = "Connecté. Vous pouvez fermer cet onglet.";
            result.className = "ok";
            btn.hidden = true;
          });
        } catch (err) {
          lastReason = err && err.message ? err.message : String(err);
          tryId(i + 1);
        }
      }
      tryId(0);
    });
  })();
  </script>
</body>
</html>
`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Connecter Wingpen</title></head>
<body>
  <h1>Connecter Wingpen</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>
`;
}
