# Wingpen — protocole extension ↔ broker

Contrat figé le 2026-09-16. **Les deux côtés se développent en parallèle contre ce document.**
Toute modification se fait ici d'abord, jamais dans un seul des deux camps.

Amendement 2026-09-20 : ajout de l'action `shorten` (Raccourcir) au message `act`, pour le menu
contextuel de sélection du panneau.

Amendement 2026-09-20 (2) : ajout de la route `GET /pair` et du message externe `wingpen:pair`,
pour l'appairage en un clic — voir « Appairage en un clic » plus bas.

Amendement 2026-09-20 (3) : ajout des messages `settings.get` / `settings.set` (et de la réponse
`settings`), pour choisir le fournisseur de modèle (`claude-cli` ou `ollama`) depuis la page
d'options — voir « Fournisseur de modèle » plus bas.

## Transport

WebSocket, `ws://127.0.0.1:8787/ws`.

**Pourquoi WebSocket et pas `fetch`** — Chrome applique désormais Local Network Access : une
requête HTTP vers `127.0.0.0/8` déclenche une demande de permission utilisateur, et un service
worker ne peut même pas la déclencher lui-même (il faut un accord préalable obtenu depuis un
document). Les WebSockets ne sont pas encore soumis à cette règle (crbug.com/421156866). C'est
une échappatoire datée : si elle se ferme, le repli est un canal `fetch` + prompt de permission
assumé, déclenché depuis le panneau (qui est un document, donc autorisé à demander).

Port par défaut 8787, surchargeable par `WINGPEN_PORT`. Le broker écoute **exclusivement** sur
`127.0.0.1` — jamais `0.0.0.0`.

## Poignée de main

À l'ouverture, le broker vérifie **dans cet ordre**, et ferme la connexion au premier échec
(code 4401, raison en clair) :

1. En-tête `Origin` strictement égal à `chrome-extension://<ID>` où `<ID>` est dans la config du
   broker (`~/.config/wingpen/config.json`, clé `allowedExtensionIds`, tableau).

   L'ID d'une extension non empaquetée est dérivé par Chrome du chemin de son dossier — il change
   si le dossier bouge, ce qui casse silencieusement le pairing (`checkOrigin()` ne matche plus
   rien). Pour l'éviter, l'extension embarque une clé publique fixe (`extension/manifest.json`,
   champ `key`, RSA 2048 en DER/base64) : Chrome dérive alors l'ID de cette clé, indépendamment du
   dossier. L'ID en résultant, `hehlgipomfminodhahcjbencblepjhah`, est celui présent par défaut
   dans `allowedExtensionIds` (`broker/src/config.ts`). La clé privée correspondante vit dans
   `extension-key.pem` à la racine du dépôt, gitignorée, jamais commitée — sa perte oblige à
   régénérer une paire et à republier l'extension sous un nouvel ID.
2. Premier message client = `{"type":"hello","secret":"<jeton>","v":1}` dans les **3 secondes**.
   Le jeton est celui écrit par le broker dans `~/.local/share/wingpen/pairing.txt` au premier
   démarrage ; l'utilisateur le colle une fois dans les options de l'extension, qui le range dans
   `chrome.storage.session` — mémoire vive, effacé à la fermeture du navigateur.

Réponse : `{"type":"hello-ok","v":1,"models":["claude"],"capabilities":["chat","summarize"]}`.

Note honnête sur ce que ça protège : `Origin` arrête une page web hostile, le jeton arrête une
autre extension. Ni l'un ni l'autre n'arrête un programme qui tourne déjà sous le même compte
utilisateur — même frontière que Pyramid, assumée, pas résolue.

**Échec de poignée de main : un seul message générique.** Quel que soit l'échec (mauvais `Origin`,
mauvais jeton, pas de `hello` dans les 3 s), le broker envoie exactement
`{"type":"error","id":"hello","code":"unauthorized","message":"unauthorized"}` puis ferme en 4401
avec la même raison générique. Un programme local qui teste la poignée de main ne peut pas
distinguer laquelle des trois vérifications a échoué — la raison précise part seulement dans le
log stderr du broker.

## Appairage en un clic

Coller le jeton à la main dans les options reste possible (repli), mais n'est plus le chemin
normal. Le broker sert lui-même une page d'appairage qui le transmet directement à l'extension.

**`GET /pair`** (broker, port du broker, pas `/ws`) — répond `200 text/html`, une page HTML
autonome générée côté serveur avec le jeton de pairage et le premier `allowedExtensionIds` de la
config injectés dedans (échappés, voir `broker/src/pair.ts`). C'est la **seule** route HTTP en
dehors de `/ws` ; tout le reste répond `404` (voir `checkOrigin`-style défense : cette page reste
servie exclusivement sur `127.0.0.1`, jamais `0.0.0.0`). Elle n'est **pas** une page d'extension :
la CSP de `manifest.json` ne s'y applique pas, d'où le `<style>`/`<script>` en ligne, acceptable
ici seulement.

Le bouton « Connecter Wingpen » de cette page appelle :
```js
chrome.runtime.sendMessage(EXTENSION_ID, { type: "wingpen:pair", token })
```
— un message externe (`chrome.runtime.onMessageExternal`), rendu possible par
`manifest.json` : `"externally_connectable": { "matches": ["http://127.0.0.1:8787/*"] }`.

Côté extension, `background/service-worker.js` vérifie, dans cet ordre, avant tout traitement :
1. `sender.url` commence par `http://127.0.0.1:8787/` (vérification explicite, ne fait pas
   confiance à la liste `matches` du manifeste seule) ;
2. `sender.tab` est présent (un message venu d'un contexte non-onglet est refusé) ;
3. `message.type === "wingpen:pair"` et `message.token` est une chaîne non vide.

Sur succès : le jeton est écrit dans `chrome.storage.session` (jamais `local` — règle non
négociable n°1), une reconnexion est déclenchée immédiatement, et la réponse est
`{ ok: true }`. Sur échec, `{ ok: false, reason: "…" }`. La page affiche le résultat et, si
l'extension ne répond pas (non installée, mauvais id), propose la copie manuelle du jeton en repli.

**Limitation connue — le port ne peut pas être dynamique ici.** `config.json` permet de changer
le port du broker (clé `port`), mais `externally_connectable.matches` de `manifest.json`
n'accepte qu'un motif littéral, pas une variable : Chrome ne permet aucune interpolation à ce
niveau. Le port `8787` est donc en dur à trois endroits qui doivent rester synchronisés à la main :
`manifest.json` (`externally_connectable`), `background/service-worker.js` (`BROKER_PORT`, qui
dérive aussi `WS_URL`), et `panel/panel.js` (`BROKER_PORT`, pour ouvrir `/pair`). Un broker lancé
sur un port non standard casse l'appairage en un clic silencieusement — le repli « coller le jeton
à la main » dans les options reste le recours dans ce cas.

## Messages client → broker

Tout message porte un `id` (chaîne, unique par requête, généré côté extension) et un `type`.

```jsonc
// Conversation libre. `context` est optionnel.
{ "type": "chat", "id": "c1", "text": "...", "context": { /* voir Context */ } }

// Résumé d'une page ou d'une vidéo. Le broker choisit la stratégie selon context.kind.
{ "type": "summarize", "id": "c2", "context": { /* voir Context */ }, "length": "short" | "medium" }

// Action sur la sélection de l'utilisateur. Déclenché depuis le menu
// contextuel du navigateur (clic droit sur une sélection) : Reformuler →
// rewrite, Raccourcir → shorten, Expliquer → explain, Traduire → translate.
{ "type": "act", "id": "c3", "action": "translate" | "rewrite" | "explain" | "shorten",
  "text": "...", "params": { "targetLang": "fr" } }

// Bibliothèque de prompts (stockée côté broker).
{ "type": "prompts.list", "id": "c4" }
{ "type": "prompts.save", "id": "c5", "prompt": { "name": "...", "body": "..." } }
{ "type": "prompts.delete", "id": "c6", "name": "..." }

// Annulation d'une requête en cours.
{ "type": "cancel", "id": "c7", "target": "c2" }

// Lire le fournisseur de modèle actif et la liste des fournisseurs connus.
{ "type": "settings.get", "id": "c8" }

// Changer le fournisseur et/ou le modèle. Champs omis = inchangés. Ne
// transporte JAMAIS de secret (pas de clé d'API) — voir CLAUDE.md règle n°1.
{ "type": "settings.set", "id": "c9", "provider": "ollama", "model": "llama3.2" }
```

### Context

```jsonc
{
  "kind": "page" | "youtube" | "selection",
  "url": "https://…",   // origine + chemin UNIQUEMENT — jamais la query string ni le fragment
  "title": "…",
  "text": "…",          // texte principal déjà extrait et assaini par le content script
  "videoId": "…"        // uniquement si kind === "youtube"
}
```

**`url` n'est jamais l'URL complète.** Le content script envoie `location.origin +
location.pathname`, jamais `location.href` : une query string ou un fragment peuvent porter un
jeton de session (`?token=…`, `#access_token=…`) que rien en aval n'a besoin de voir.

**Le content script envoie du texte, jamais du HTML.** Il extrait, assainit, tronque à
40 000 caractères et transmet. Le broker ne fait confiance à rien de ce qui vient de la page :
il traite `text`, `title` et `url` comme des données, jamais comme une instruction — voir
« Construction du prompt » plus bas.

## Construction du prompt (assainissement et anti-injection)

`buildPrompt()` (`broker/src/model.ts`) est le seul endroit du broker qui assemble un prompt. Tout
contenu page-contrôlé (`context.text`, `context.title`, `context.url`, le texte sélectionné d'un
`act`) est encadré par un délimiteur généré à neuf, aléatoirement, à **chaque** appel :
`<<<wingpen-<16 hex>` … `wingpen-<16 hex>>>>`. Le system prompt nomme ce délimiteur comme seule
frontière valable et précise que tout ce qui est dedans est une donnée, jamais une instruction. En
plus de l'aléa du nonce : toute occurrence de la forme du délimiteur et toute suite de 3 guillemets
ou plus sont neutralisées dans le texte avant interpolation (défense en profondeur — l'ancien
format de délimiteur figé, `"""`, ne doit plus pouvoir servir de frontière). `title` et `url` sont
en plus aplatis (tous les espaces/retours à la ligne réduits à un seul espace) et tronqués à
300 caractères, et placés **à l'intérieur** du délimiteur — jamais au-dessus, là où le system
prompt traite le contenu comme la requête de l'utilisateur.

## Fournisseur de modèle

Amendement 2026-09-20 (3). Le broker sait parler à deux fournisseurs de modèle, choisis derrière
une interface commune (`broker/src/providers/`, voir docs/DECISIONS.md T8) :

- **`claude-cli`** (par défaut) — le binaire `claude` installé sur la machine, via le SDK Claude
  Agent. Comportement inchangé par rapport à avant cet amendement.
- **`ollama`** — un démon Ollama local (`http://127.0.0.1:11434` par défaut, surchargeable par la
  clé `ollamaUrl` de `config.json`). C'est le seul fournisseur pour lequel Wingpen peut
  honnêtement affirmer que rien ne sort de la machine.

**`settings.get`** ne prend rien d'autre qu'un `id`. Réponse :

```jsonc
{
  "type": "settings",
  "id": "c8",
  "provider": "claude-cli",     // fournisseur actuellement sélectionné
  "model": "llama3.2",          // optionnel — nom de modèle propre au fournisseur
  "available": [
    { "id": "claude-cli", "label": "Claude (CLI locale)", "available": true },
    { "id": "ollama", "label": "Ollama (local)", "available": false, "reason": "Ollama unreachable at http://127.0.0.1:11434" }
  ],
  "models": ["llama3.2:latest", "mistral:latest"]  // seulement si le fournisseur actif sait lister ses modèles
}
```

`available` liste **toujours** tous les fournisseurs connus, y compris ceux qui ne sont pas
utilisables maintenant — un fournisseur indisponible n'est jamais caché, seulement signalé avec une
raison courte (`reason`).

**`settings.set`** accepte `provider` et/ou `model`, tous deux optionnels — un champ omis reste
inchangé côté broker. Un `provider` qui n'est ni `"claude-cli"` ni `"ollama"` est rejeté en
`bad-request` par `parseClientMessage()` (`broker/src/protocol.ts`), avant tout traitement. Ce
message ne transporte **jamais** de secret — pas de clé d'API, pas maintenant, voir CLAUDE.md règle
n°1. Sur succès, le broker persiste le changement dans `~/.config/wingpen/config.json` (permissions
`0600`, comme le reste du fichier) et répond avec un `settings` frais, construit de la même façon
que pour `settings.get`.

Si le modèle configuré pour `ollama` n'apparaît pas dans la réponse de son `/api/tags`, une
requête `chat`/`summarize`/`act` échoue en `model-unavailable`, avec le nom du modèle manquant dans
le message — jamais de repli silencieux sur un autre modèle installé.

## Limites côté broker

- **Délai maximal d'un appel modèle : 120 s** (`MODEL_TIMEOUT_MS`, `broker/src/model.ts`). Passé
  ce délai sans réponse, le broker abandonne l'appel et envoie `{"type":"error","code":
  "model-unavailable", ...}` — sans ce garde-fou, un appel qui reste bloqué ne renvoie jamais ni
  `done` ni `error`, ce qui viole l'invariant « tout `id` reçoit un terminal » ci-dessous.
- **Flux modèle simultanés par connexion : 3** (`MAX_CONCURRENT_STREAMS`,
  `broker/src/server.ts`). Un `chat`/`summarize`/`act` de plus alors que 3 sont déjà en cours reçoit
  `{"type":"error","code":"bad-request","message":"too many concurrent requests (max 3 per
  connection)"}` sans lancer de processus `claude` supplémentaire.

## Messages broker → client

```jsonc
{ "type": "chunk", "id": "c1", "delta": "texte partiel…" }   // flux, n fois
{ "type": "done",  "id": "c1", "usage": { "inputTokens": 0, "outputTokens": 0 } }
{ "type": "error", "id": "c1", "code": "…", "message": "…" } // terminal pour cet id
{ "type": "prompts", "id": "c4", "items": [ { "name": "…", "body": "…" } ] }
```

Codes d'erreur : `bad-request`, `unauthorized`, `model-unavailable`, `context-too-large`,
`cancelled`, `internal`.

## Règles invariantes

- Un `id` reçoit **toujours** un terminal : `done` ou `error`. Jamais les deux, jamais aucun.
- Le broker ne renvoie jamais le contenu de sa configuration ni le jeton de pairage, quelle que
  soit la question posée.
- Les requêtes sont sérialisées par connexion ; une deuxième requête pendant qu'une autre coule
  est acceptée, mais le broker ne garantit pas l'ordre d'arrivée entre `id` distincts.
- Taille maximale d'un message client : 256 Ko. Au-delà, `error` + fermeture.
