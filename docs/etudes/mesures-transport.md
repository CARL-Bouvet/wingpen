# Mesures — WebSocket vs Native Messaging (lot 2, goal-3jSMWnRt)

Étude de transport isolée : elle ne change rien au produit. Le transport réel de
Wingpen reste le WebSocket vers `127.0.0.1:8787` (voir `docs/PROTOCOL.md`). Ce
document rassemble des mesures brutes pour que la décision de garder ou de
changer de transport se prenne sur des chiffres, pas sur une intuition. Aucune
recommandation ici — c'est le rôle du lot d'étude, pas de cette page.

## Machine et versions

| | |
|---|---|
| Machine | `basilide`, Intel Core i7-7700K @ 4.20 GHz, 8 threads, 15 Gio RAM |
| OS | Arch Linux, noyau 7.2.4-arch1-2 |
| Bun | 1.4.2 |
| Brave | 152.1.94.121 |
| Firefox | 155.0.1 |
| Date des mesures | 2026-09-24/25 |

## Méthode

Prototype jetable, jamais câblé dans l'extension réelle : `bench/transport/`.
Une extension MV3 minimale (`bench/transport/ext/`), un hôte Native Messaging
(`bench/transport/host.ts`, cadre standard 4 octets de longueur + JSON) et un
serveur WebSocket (`bench/transport/ws-server.ts`, écoute sur
`127.0.0.1:18787` — **jamais** le port 8787 du vrai broker) implémentent les
mêmes commandes (`hello`, `ping`, `stream-start`, `upload`, `results`), pour
comparer les deux transports sur un protocole identique. L'extension se lance
seule à l'installation (aucun clic), exécute les six mesures dans l'ordre, et
transmet un instantané cumulatif de ses résultats après chaque étape — pour ne
rien perdre si une étape plante la page d'arrière-plan.

Profils de navigateur jetables (`mktemp`), jamais le profil réel de Romain,
jamais le vrai broker touché. Chargement de l'extension :
- **Firefox** : WebDriver BiDi (`--remote-debugging-port`, commande
  `webExtension.install`) sur un profil et un `$HOME` temporaires — l'hôte
  Native Messaging de Firefox se déclare dans
  `<HOME temporaire>/.mozilla/native-messaging-hosts/`, donc l'isolement est
  total sans toucher `~/.mozilla` réel.
- **Brave** : `--disable-extensions-except=<ext> --load-extension=<ext>` sur
  un `--user-data-dir` jetable (`mktemp`), comme `scripts/smoke.sh`. Pas
  d'étape d'installation façon BiDi : Chromium charge l'extension au
  démarrage. `ext/chromium/manifest.json` porte désormais une paire de clés
  RSA jetable (champ `key`, générée pour ce banc uniquement, aucun secret
  produit) pour que l'identifiant d'extension soit stable et connu à
  l'avance (`hiajdmhhpoajipmlilaaaalgbmbjekho`), indépendamment du chemin
  `--load-extension` — nécessaire pour écrire le manifeste de l'hôte Native
  Messaging (`allowed_origins`) avant le lancement. Constat établi par l'admin :
  Brave 152 ignore `<user-data-dir>/NativeMessagingHosts/` quand lancé avec un
  `--user-data-dir` personnalisé — il ne consulte que
  `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` (vérifié :
  « Specified native messaging host not found » avec l'emplacement profil,
  succès avec l'emplacement utilisateur). L'auto-run du banc étant bloqué en
  sandbox (socket Unix `AF_UNIX` refusée par la politique du worker), l'admin a
  mesuré Brave séparément via CDP (`bench/transport/cdp-measure.ts`) — voir
  section « Mesure Brave via CDP » ci-dessous. Le manifeste NM temporaire a été
  supprimé après le run.

Orchestrateur : `bench/transport/run.ts` (`--brave-only`, `--skip-brave`,
`--smoke [--nm] [--brave]` pour une validation rapide du pipeline avant un
run complet). Résultats bruts par navigateur et transport dans
`bench/results/<navigateur>-<transport>.json`, agrégat dans
`bench/results/summary.json`.

## Mesure Brave via CDP

L'auto-run du banc (`runBrave()` dans `run.ts`) a été bloqué en sandbox
(socket Unix `AF_UNIX` refusée, `dangerouslyDisableSandbox` neutralisé par la
politique de session). L'admin a mesuré Brave 152 séparément le 2026-09-25 via
`bench/transport/cdp-measure.ts` : une session DevTools (`Runtime.evaluate`) est
ouverte sur un service worker Brave headless déjà démarré avec l'extension de
banc, et les mêmes fonctions de mesure (`hello`/`ping`/`stream-start`/`upload`)
sont pilotées depuis l'extérieur du sandbox. Toutes les mesures 1 à 4 ont
produit des valeurs. Résultats dans `bench/results/brave-cdp.json`.

**Limite propre à cette méthode** : une session DevTools attachée maintient le
service worker en vie. La survie à l'inactivité (mesure 5) ne peut pas être
obtenue via CDP — voir section 5 ci-dessous.

## Référence modèle — mesurée (hors bac à sable, par l'admin)

Le lot précédent ne pouvait pas la mesurer (broker réel hors de portée réseau
depuis ce worker). L'admin a lancé `bun scripts/probe-summarize.ts` en dehors
du bac à sable, contre le vrai broker (`127.0.0.1:8787`, service systemd,
fournisseur `claude-cli`, abonnement Claude Max) : trois résumés d'un faux
transcript YouTube, temps total de bout en bout (ouverture WebSocket → `done`
du broker) :

| Essai | Total | Tokens de sortie | Poignée de main (WS open → `hello-ok`) |
|---|---|---|---|
| 1 | 4579 ms | 228 | 9 ms |
| 2 | 4467 ms | 243 | 15 ms |
| 3 | 4232 ms | 234 | 11 ms |

Détail dans `bench/results/model-reference.json`. Le probe n'imprime pas les
morceaux intermédiaires : ces totaux bornent le temps jusqu'au premier jeton
par le haut, ils ne l'isolent pas.

**Mise en regard avec le transport** : un résumé complet coûte 4,2 à 4,6 s.
Le coût de transport mesuré sur Firefox (mesures 1 à 4 ci-dessous) va de
quelques millisecondes (aller-retour, upload en WS) à quelques dizaines de
millisecondes (connexion à froid NM, upload NM) — deux à trois ordres de
grandeur en dessous du temps modèle. Aucune conclusion tirée ici sur l'impact
perçu par l'utilisateur ; le fait est seulement posé.

## 1. Connexion à froid (10 mesures, `new WebSocket` / `connectNative` → réponse au hello)

| | Firefox / WS | Firefox / NM | Brave / WS | Brave / NM |
|---|---|---|---|---|
| p50 | 2 ms | 25 ms | 1,5 ms | 14,7 ms |
| p95 | 11 ms | 42 ms | n.d. (CDP) | n.d. (CDP) |
| min / max | 1 / 11 ms | 23 / 42 ms | — / 4,6 ms | — / 24,8 ms |

Fait mesuré : sur Firefox, la connexion à froid Native Messaging est
nettement plus lente que la connexion WebSocket (p50 25 ms contre 2 ms) —
cohérent avec le coût de démarrage d'un nouveau processus hôte à chaque
`connectNative()`, que la mesure inclut volontairement (voir méthode dans le
brief). Brave suit le même schéma (p50 NM 14,7 ms contre 1,5 ms WS). La p95
n'est pas disponible pour Brave (un seul jeu de 10 ouvertures via CDP, sans
répétition inter-série). Résultats Brave dans `bench/results/brave-cdp.json`.

## 2. Aller-retour (1000 pings séquentiels, 3 séries)

| Série | Firefox / WS p50/p95/p99 (ms) | Firefox / NM p50/p95/p99 (ms) | Brave / WS p50/p95/p99 (ms) | Brave / NM p50/p95/p99 (ms) |
|---|---|---|---|---|
| 1 | 1 / 2 / 2 | 0 / 1 / 2 | 0,1 / 0,2 / 0,3 | 0,2 / 0,3 / 0,9 |
| 2 | 0 / 1 / 2 | 0 / 1 / 2 | — (1 run CDP) | — (1 run CDP) |
| 3 | 1 / 1 / 2 | 0 / 1 / 2 | — | — |

Fait mesuré : sur cette machine, les deux transports restent sous 2 ms au
p99 pour un aller-retour local de petit message (Firefox) ; Brave via CDP
reste sous 1 ms au p99 sur WS et NM (un seul run de 1000 pings). La différence
entre WS et NM est dans le bruit de mesure pour les deux navigateurs (résolution
`performance.now()` en headless, charge machine).

## 3. Streaming hôte→extension (5000 blocs de 60 octets, 3 séries)

| Série | Firefox / WS | Firefox / NM | Brave / WS | Brave / NM |
|---|---|---|---|---|
| 1 | 145 ms, 2,07 Mo/s | 307 ms, 0,98 Mo/s | 48,4 ms, 6,20 Mo/s | 141,8 ms, 2,12 Mo/s |
| 2 | 160 ms, 1,88 Mo/s | 263 ms, 1,14 Mo/s | 53,7 ms, 5,59 Mo/s | 137,2 ms, 2,19 Mo/s |
| 3 | 158 ms, 1,90 Mo/s | 277 ms, 1,08 Mo/s | 56,0 ms, 5,36 Mo/s | 142,5 ms, 2,11 Mo/s |

Fait mesuré : pour ce motif (beaucoup de petits messages hôte→extension), WS
est environ 1,7 à 2,1× plus rapide que NM sur Firefox. Brave confirme le même
schéma (2,7 à 2,9× en faveur de WS), avec un débit WS plus élevé (~5,4–6,2 Mo/s
contre ~1,9–2,1 Mo/s sur Firefox) — cohérent avec un runtime Chromium plus
réactif pour les messages WebSocket en headless.

## 4. Upload extension→hôte (1 message de 1 Mio, 5 mesures)

| Essai | Firefox / WS (ms) | Firefox / NM (ms) | Brave / WS (ms) | Brave / NM (ms) |
|---|---|---|---|---|
| 1 | 6 | 32 | 9 | 17,6 |
| 2 | 6 | 15 | 9 | 13,3 |
| 3 | 6 | 15 | 9 | 17,5 |
| 4 | 6 | 14 | 12,7 | 11,5 |
| 5 | 5 | 17 | 7 | 10,8 |

Aucune limite de taille rencontrée sur aucun des deux transports pour un
message de 1 Mio (Firefox et Brave). Fait mesuré : NM est 2,5 à 6× plus lent
que WS pour Firefox ; Brave suit le même schéma (1,2 à 2,5× en faveur de WS),
écart moins marqué — cohérent avec le processus hôte NM déjà chaud lors de la
mesure CDP (pas de cold-start à chaque envoi).

## 5. Survie à l'inactivité (connexion idle 5 min, puis un ping)

| | Firefox / WS | Firefox / NM | Brave / WS | Brave / NM |
|---|---|---|---|---|
| Statut | **`pending` — jamais confirmé** | `survived`, ping post-idle en 7 ms | **non résolu** | **non mesurable par CDP** |

Fait mesuré, pas expliqué en profondeur : sur le transport WS Firefox,
l'instantané de résultats écrit juste avant l'attente de 5 minutes
(`idle.status: "pending"`) n'a plus jamais été mis à jour dans le budget imparti
(9 minutes au total). Sur NM Firefox, la même séquence s'est terminée
normalement avec un ping post-idle réussi. Deux lectures possibles, non
départagées par cette mesure : la page d'arrière-plan MV3 non persistante de
Firefox (`background.scripts`) a pu être suspendue pendant l'attente côté WS et
jamais réveillée (rien ne la sollicite pendant une connexion WS purement idle),
alors qu'un port Native Messaging connecté semble empêcher cette suspension. À
vérifier plus avant si cette mesure compte dans la décision — ce n'est pas
creusé ici.

Pour Brave, la situation est doublement ouverte. La méthode CDP maintient le
service worker en vie via une session DevTools attachée : la mesure 5 via CDP
ne peut pas produire de résultat valide. L'auto-run WS du banc avait démarré
une mesure idle avant d'être bloqué — `bench/results/brave-ws.json` conserve
`"idle": {"status": "pending"}`, mais ce `pending` est un artefact du blocage
sandbox, pas un résultat de survie. La différence Chromium attendue (service
worker WS pouvant être tué après ~30 s, port `connectNative` le maintenant
vivant — Chrome ≥ 105) n'est ni confirmée ni infirmée par ces données.

## 6. CPU et RSS du process hôte / serveur pendant la mesure 2

Échantillonnage `ps` toutes les 100 ms côté orchestrateur, filtré sur la
fenêtre de chacune des 3 séries d'aller-retour.

| Série | Firefox / WS (serveur `ws-server.ts`) | Firefox / NM (hôte `host.ts`, relancé à chaque connexion) |
|---|---|---|
| 1 | %CPU moy 1,4 / max 2,3 — RSS moy 34,3 Mo / max 35,4 Mo | %CPU moy 15,9 / max 20 — RSS moy 33,3 Mo / max 35,4 Mo |
| 2 | %CPU moy 2,9 / max 3,0 — RSS moy 35,7 Mo / max 35,8 Mo | %CPU moy 30,9 / max 50 — RSS moy 33,2 Mo / max 35,4 Mo |
| 3 | %CPU moy 3,9 / max 4,5 — RSS moy 35,9 Mo / max 36,3 Mo | %CPU moy 17,3 / max 20 — RSS moy 32,5 Mo / max 34,8 Mo |

Fait mesuré : le process serveur WS (un seul process Bun, longue durée de
vie) consomme nettement moins de CPU pendant les 1000 pings que le process
hôte NM (relancé à chaque connexion, donc mesuré alors qu'il vient de
démarrer — démarrage d'un runtime Bun à chaque `connectNative()`). La RSS est
comparable entre les deux (~33-36 Mo), cohérent avec le même runtime Bun côté
serveur.

## Limites de la mesure

- **Brave mesuré via CDP uniquement** (mesures 1 à 4) — un seul run par
  transport (pas de répétition inter-série pour les mesures 2–4), p95 absente
  pour la mesure 1, survie à l'inactivité (mesure 5) non mesurable avec un
  DevTools attaché. L'auto-run WebSocket (`brave-ws.json`) a produit un
  `idle.status: "pending"` avant blocage : ce n'est pas un résultat de survie.
- **Référence modèle** — mesurée depuis ce lot, mais par l'admin hors bac à
  sable (voir section dédiée), pas par ce worker directement.
- Machine partagée, sous Bash-tool sandboxé (bubblewrap) — le CPU/RSS mesurés
  incluent la charge de l'orchestrateur lui-même à côté du process mesuré ;
  les temps absolus (souvent < 5 ms) sont proches de la résolution de
  `performance.now()` en headless et du bruit d'ordonnancement machine.
  Comparer les ordres de grandeur entre WS et NM est plus fiable que les
  valeurs absolues.
- Chaque série de mesure 2/3/4 ouvre et referme sa propre connexion — le
  coût de connexion (mesure 1) n'est donc pas mélangé aux mesures suivantes,
  mais cela veut dire aussi que NM repaie un démarrage de process à chaque
  série, ce que WS ne fait pas (une seule socket TCP à rétablir).
- Le hôte Native Messaging et le serveur WS de ce banc ne vérifient ni
  jeton ni `Origin` — volontairement, ce n'est pas le vrai broker et la
  sécurité du transport n'est pas ce qui est mesuré ici.
- Mesure 5 (survie à l'inactivité) : résultat WS non concluant (voir
  ci-dessus), NM concluant. Aucune conclusion tirée sur la cause exacte du
  `pending` côté WS — fait rapporté tel quel.
- Une seule machine, une seule session de mesure. Pas de répétition
  inter-session pour estimer la variance jour à jour.

## Fichiers

- `bench/results/brave-cdp.json` — résultats Brave mesurés par l'admin via
  CDP (mesures 1 à 4, WS et NM).
- `bench/results/brave-ws.json` — run auto-run interrompu : `idle.status:
  "pending"` (blocage sandbox, pas un résultat de survie).
- `bench/results/brave-nm.json` — statut `blocked`, `nmProbeLog` vide
  (socket Unix refusée avant que la sonde NM ne soit tentée).
- `bench/results/firefox-ws.json`, `bench/results/firefox-nm.json` —
  échantillons bruts des 6 mesures.
- `bench/results/model-reference.json` — référence modèle mesurée par
  l'admin hors bac à sable (3 résumés réels, 4,2–4,6 s de bout en bout).
- `bench/results/summary.json` — agrégat lisible des quatre fichiers de
  résultats bruts (Brave + Firefox).
- `bench/results/run-report.json`, `bench/results/run.log` — trace de la
  dernière invocation de l'orchestrateur pour Brave dans ce worker
  (`--brave-only`) ; les entrées Firefox y sont ré-agrégées depuis les
  fichiers bruts (non ré-exécutées dans ce lot).
