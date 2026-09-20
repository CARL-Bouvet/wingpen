# Wingpen — protocole extension ↔ broker

Contrat figé le 2026-09-16. **Les deux côtés se développent en parallèle contre ce document.**
Toute modification se fait ici d'abord, jamais dans un seul des deux camps.

Amendement 2026-09-20 : ajout de l'action `shorten` (Raccourcir) au message `act`, pour le menu
contextuel de sélection du panneau.

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
