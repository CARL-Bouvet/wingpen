# Wingpen — protocole extension ↔ broker

Contrat figé le 2026-09-16. **Les deux côtés se développent en parallèle contre ce document.**
Toute modification se fait ici d'abord, jamais dans un seul des deux camps.

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
2. Premier message client = `{"type":"hello","secret":"<jeton>","v":1}` dans les **3 secondes**.
   Le jeton est celui écrit par le broker dans `~/.local/share/wingpen/pairing.txt` au premier
   démarrage ; l'utilisateur le colle une fois dans les options de l'extension, qui le range dans
   `chrome.storage.session` — mémoire vive, effacé à la fermeture du navigateur.

Réponse : `{"type":"hello-ok","v":1,"models":["claude"],"capabilities":["chat","summarize"]}`.

Note honnête sur ce que ça protège : `Origin` arrête une page web hostile, le jeton arrête une
autre extension. Ni l'un ni l'autre n'arrête un programme qui tourne déjà sous le même compte
utilisateur — même frontière que Pyramid, assumée, pas résolue.

## Messages client → broker

Tout message porte un `id` (chaîne, unique par requête, généré côté extension) et un `type`.

```jsonc
// Conversation libre. `context` est optionnel.
{ "type": "chat", "id": "c1", "text": "...", "context": { /* voir Context */ } }

// Résumé d'une page ou d'une vidéo. Le broker choisit la stratégie selon context.kind.
{ "type": "summarize", "id": "c2", "context": { /* voir Context */ }, "length": "short" | "medium" }

// Action sur la sélection de l'utilisateur.
{ "type": "act", "id": "c3", "action": "translate" | "rewrite" | "explain",
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
  "url": "https://…",
  "title": "…",
  "text": "…",          // texte principal déjà extrait et assaini par le content script
  "videoId": "…"        // uniquement si kind === "youtube"
}
```

**Le content script envoie du texte, jamais du HTML.** Il extrait, assainit, tronque à
40 000 caractères et transmet. Le broker ne fait confiance à rien de ce qui vient de la page :
il traite `text` comme une donnée, jamais comme une instruction.

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
