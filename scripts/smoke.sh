#!/usr/bin/env bash
# Wingpen — boucle de vérification de bout en bout.
#
# Charge l'extension dans un profil Chrome dédié, sème le jeton de pairage dans
# le service worker, et laisse l'alarme de reconnexion déclencher la connexion au
# broker. Sert à répondre à une seule question, la seule qui compte ici : est-ce
# que l'extension joint le serveur local, et avec quel `Origin` ?
#
#   ./scripts/smoke.sh            # contre le vrai broker (doit tourner sur 8787)
#   ./scripts/smoke.sh --stub     # contre un stub qui journalise tout
#
# Variables :
#   WINGPEN_CHROME    binaire du navigateur (défaut : Chrome for Testing 154)
#   WINGPEN_HEADLESS  0 pour une vraie fenêtre. Indispensable pour observer une
#                     demande de permission : en headless elle ne peut pas
#                     s'afficher, donc son absence ne prouve rien.
#   WINGPEN_PROFILE   répertoire de profil (défaut : un profil dédié par navigateur)
#
# Laisse le navigateur en vie à la fin : inspecter avec `bun scripts/cdp-eval.js '<expr>'`.
# Arrêter avec ./scripts/smoke.sh --stop

set -uo pipefail
cd "$(dirname "$0")/.."

CHROME="${WINGPEN_CHROME:-$HOME/.cache/ms-playwright/chromium-1244/chrome-linux64/chrome}"
HEADLESS="${WINGPEN_HEADLESS:-1}"
PROFILE="${WINGPEN_PROFILE:-$HOME/.local/share/wingpen/profile-$(basename "$CHROME")}"
EXT="$PWD/extension"
PORT=9222
STUB_LOG=/tmp/wingpen-stub.log

stop() {
  pkill -f "user-data-dir=$PROFILE" && echo "Chrome arrêté."
  pkill -f "wingpen-stub.js" && echo "Stub arrêté."
  exit 0
}
[ "${1:-}" = "--stop" ] && stop

if [ "${1:-}" = "--stub" ]; then
  cat > /tmp/wingpen-stub.js <<'STUB'
const log = (m) => console.log(new Date().toISOString(), m);
Bun.serve({
  hostname: "127.0.0.1", port: 8787,
  fetch(req, server) {
    const origin = req.headers.get("origin") ?? "(none)";
    if (server.upgrade(req, { data: { origin } })) return;
    log("HTTP " + req.method + " origin=" + origin);
    return new Response("wingpen stub");
  },
  websocket: {
    open(ws) { log("WS OPEN origin=" + ws.data.origin); },
    message(ws, msg) {
      log("WS MSG " + String(msg).slice(0, 300));
      ws.send(JSON.stringify({ type: "hello-ok", v: 1, models: ["claude"], capabilities: ["chat", "summarize"] }));
    },
    close(ws, code, reason) { log("WS CLOSE " + code + " " + reason); },
  },
});
log("stub listening on 127.0.0.1:8787");
STUB
  setsid --fork bun /tmp/wingpen-stub.js > "$STUB_LOG" 2>&1 < /dev/null
  sleep 1
  echo "Stub démarré → $STUB_LOG"
fi

mkdir -p "$PROFILE"
if [ "$HEADLESS" = "1" ]; then MODE=(--headless=new); else MODE=(); fi
if ! pgrep -f "user-data-dir=$PROFILE" > /dev/null; then
  setsid --fork "$CHROME" "${MODE[@]}" --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE" \
    --disable-extensions-except="$EXT" --load-extension="$EXT" \
    --remote-debugging-port=$PORT about:blank > /tmp/wingpen-chrome.log 2>&1 < /dev/null
  sleep 6
  echo "$(basename "$CHROME") lancé (headless=$HEADLESS, profil $PROFILE, extension chargée)."
fi

# Le jeton vit en chrome.storage.session : il disparaît à chaque redémarrage du
# navigateur, c'est voulu. On le resème à chaque passage.
bun scripts/cdp-eval.js "chrome.storage.session.set({pairingToken:'${WINGPEN_TOKEN:-smoke-token}'}).then(()=>'token semé')"

echo "Attente de l'alarme de reconnexion (jusqu'à 35 s)…"
sleep 35

if [ "${1:-}" = "--stub" ]; then
  echo "--- journal du stub ---"
  cat "$STUB_LOG"
fi
