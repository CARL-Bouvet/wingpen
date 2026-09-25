# Wingpen — protocole extension ↔ broker

Contrat figé le 2026-09-16. **Les deux côtés se développent en parallèle contre ce document.**
Toute modification se fait ici d'abord, jamais dans un seul des deux camps.

Amendement 2026-09-20 : ajout de l'action `shorten` (Raccourcir) au message `act`, pour le menu
contextuel de sélection du panneau.

Amendement 2026-09-20 (2) : ajout de la route `GET /pair` et du message externe `wingpen:pair`,
pour l'appairage en un clic. *Le message externe et le bouton sont retirés par l'amendement
2026-09-25 ; `/pair` ne sert plus qu'à Firefox — voir « Page `/pair` » plus bas.*

Amendement 2026-09-20 (3) : ajout des messages `settings.get` / `settings.set` (et de la réponse
`settings`), pour choisir le fournisseur de modèle (`claude-cli` ou `ollama`) depuis la page
d'options — voir « Fournisseur de modèle » plus bas.

Amendement 2026-09-20 (4) : le broker accepte désormais aussi une origine `moz-extension://<uuid>`
(extension Firefox), en plus de `chrome-extension://<ID>` — voir « Poignée de main » plus bas, et
`docs/FIREFOX.md` côté extension.

Amendement 2026-09-21 : appairage silencieux pour une origine `chrome-extension://<ID>` déjà
présente dans `allowedExtensionIds` — le `hello` peut omettre `secret`, le broker en octroie alors
un directement dans `hello-ok`, sans passage par `/pair`. Ne s'applique jamais à `moz-extension://`
(Firefox, comportement inchangé). Voir « Poignée de main » et « Appairage silencieux » plus bas.
*Étendu par l'amendement 2026-09-25 aux uuid Firefox épinglés ; le jeton octroyé devient un jeton
de session.*

Amendement 2026-09-21 (2) : nouveau code d'erreur `auth-required` (task C3), distinct de
`model-unavailable`, quand le provider `claude-cli` détecte que la session Claude Code locale n'est
plus authentifiée ou a expiré — voir « Fournisseur de modèle » plus bas.

Amendement 2026-09-21 (3) : nouveau fournisseur `claude-api` (BYOK — l'utilisateur apporte sa
propre clé Anthropic), en HTTPS direct avec streaming SSE, aucune dépendance ajoutée côté broker.
`settings.set` gagne un champ `apiKey`, write-only de bout en bout ; la réponse `settings` gagne un
booléen `configured` par fournisseur ; nouveaux messages `settings.test` / `settings.test-result`
pour le bouton « Tester la connexion » du panneau d'options — voir « Fournisseur de modèle » plus
bas pour le détail des trois.

Amendement 2026-09-25 (appairage et connexion au modèle) : frontière de menace = le compte
utilisateur du système, appliquée par le code ; admission HTTP et WebSocket (`Host`, UID du pair) ;
`hello-ok.token` devient un jeton de session frais tenu en mémoire ; appairage silencieux étendu aux
uuid Firefox épinglés (liste relue à chaud) ; chemin « un clic » retiré, `/pair` réservé à Firefox ;
nouveau couple `provider.status` / `provider.status-result` ; port 8787 figé ; journalisation des octrois,
épinglages et refus ; les 11 écarts relevés par l'audit du jeton (`notes/audit_jeton_2026-09-25.md`
§5) résolus. Chaque passage touché porte la mention « Amendement 2026-09-25 ». **Là où ce texte
contredit le code, c'est le code qui se corrige** (lots 4 et 5).

## Transport

WebSocket, `ws://127.0.0.1:8787/ws`.

**Pourquoi WebSocket et pas `fetch`** — Chrome applique désormais Local Network Access : une
requête HTTP vers `127.0.0.0/8` déclenche une demande de permission utilisateur, et un service
worker ne peut même pas la déclencher lui-même (il faut un accord préalable obtenu depuis un
document). Les WebSockets ne sont pas encore soumis à cette règle (crbug.com/421156866). C'est
une échappatoire datée : si elle se ferme, le repli est un canal `fetch` + prompt de permission
assumé, déclenché depuis le panneau (qui est un document, donc autorisé à demander).

Amendement 2026-09-25 (recherche du lot 1, `docs/etudes/appairage.md`). Le paragraphe précédent
est dépassé pour les sites web : Chrome 147 et Firefox 154 soumettent aussi les WebSockets vers
loopback à Local Network Access, et crbug.com/421156866 est clos. Les **origines d'extension** ne
sont pas visées aujourd'hui : Wingpen se connecte sans permission d'hôte sur `127.0.0.1` (constaté
le 25/09 dans Brave 152). Aucune source ne garantit que cela durera. Si les navigateurs étendent la
règle aux extensions, deux voies : déclarer la permission d'hôte `http://127.0.0.1:8787/*`, ou
passer à Native Messaging, que Local Network Access ne concerne pas.

Le broker écoute **exclusivement** sur `127.0.0.1` — jamais `0.0.0.0`, jamais `::`, jamais une
interface réseau.

**Port — amendement 2026-09-25 : 8787, figé pour l'extension.** L'extension ne connaît que 8787 :
`WS_URL` du service worker et `connect-src` de la CSP des deux manifestes sont littéraux, et une CSP
de manifeste n'admet aucune variable. Un broker sur un autre port est donc injoignable, collage
manuel compris ; le protocole cesse de promettre le contraire.
- La clé `port` de `config.json` **n'est plus lue**. Si elle est présente avec une valeur différente
  de 8787, le broker écrit une ligne d'avertissement au démarrage et écoute quand même sur 8787.
- La variable d'environnement `WINGPEN_PORT` reste, **pour les tests seulement** (serveurs de test
  sur un port libre). Quand elle est définie, le broker écrit au démarrage une ligne qui le dit :
  `wingpen-broker: WINGPEN_PORT=<n> — mode test, l'extension ne se connectera pas`.
- Toutes les vérifications qui citent « le port » (liste `Host` ci-dessous) utilisent le port
  effectivement écouté.

## Frontière de menace

Amendement 2026-09-25. Remplace la « Note honnête » du 2026-09-16, qui promettait « le compte
utilisateur » alors que le code laissait passer tout processus de la machine, y compris sous un
autre compte (audit du jeton, écart n°8).

**La frontière est le compte utilisateur du système d'exploitation sous lequel tourne le broker, et
le code l'applique.** Ce qui est arrêté, et par quoi :

| Adversaire | Arrêté par |
|---|---|
| Machine du réseau local | l'écoute sur `127.0.0.1` seulement |
| Page web hostile | l'en-tête `Origin`, imposé par le navigateur (voir « Poignée de main ») |
| Page web par *DNS rebinding* (`attacker.tld` résolu en `127.0.0.1`) | la liste `Host` (voir « Admission ») : sa requête porte `Host: attacker.tld:8787` |
| Processus d'un **autre compte** de la même machine | la vérification de l'UID du pair (Linux), voir « Admission » ; fichiers en 0600, dossiers en 0700 |
| Autre extension, Chromium | l'`Origin` : son origine est `chrome-extension://<autre ID>`, absente de `allowedExtensionIds` |
| Autre extension, Firefox | l'`Origin` tant que son uuid n'est pas épinglé ; épingler exige le secret permanent (voir « Poignée de main ») |

Fichiers du broker : `~/.config/wingpen/` et `~/.local/share/wingpen/` sont créés en **0700** et
remis à 0700 à chaque démarrage ; les fichiers qu'ils contiennent (`config.json`, `pairing.txt`,
`firefox-extension-uuids.txt`, prompts) en 0600, comme aujourd'hui.

**Ce qui reste accepté, écrit ici pour ne pas être redécouvert :**
- **Un processus qui tourne sous le même compte.** Il lit `pairing.txt` et `config.json`, charge
  `/pair`, ouvre un WebSocket brut avec l'`Origin` de son choix et obtient une session complète :
  exécuter le modèle sur l'abonnement ou la clé de l'utilisateur, changer de fournisseur, écraser la
  clé API, lire et effacer les prompts. Aucune mesure de ce protocole ne s'y oppose ; un tel
  processus peut de toute façon lire directement les fichiers du broker.
- **Hors Linux** (macOS, Windows), la vérification de l'UID du pair **n'est pas appliquée** : un
  processus d'un autre compte a le même accès qu'un processus du même compte. Le broker l'écrit une
  fois au démarrage (voir « Journalisation »).
- **Une autre extension Firefox munie d'une permission d'hôte sur `127.0.0.1`** peut lire `/pair`,
  donc le secret permanent, et s'épingler elle-même. Native Messaging, où le navigateur vérifie
  lui-même l'ID de l'extension, en est le vrai remède ; il n'est pas implémenté ici.
- **Réécriture de l'`Origin` d'un WebSocket par une autre extension** (Chrome
  `declarativeNetRequest`, Firefox `webRequest` bloquant) : non vérifié à la date de cet amendement
  (recherche R3 du lot 1). Si c'est possible, l'appairage silencieux lui est ouvert.
- **Usurpation du port** : l'extension n'authentifie pas le broker. Un processus qui occupe
  `127.0.0.1:8787` pendant que le broker est arrêté reçoit le `hello` puis le texte des pages et
  les prompts. Depuis cet amendement, l'extension ne détient plus qu'un jeton de session (inutile
  après un redémarrage du broker) ; le secret permanent ne transite que dans le `hello` qui suit un
  collage Firefox.
- Conteneurs et applications isolées qui partagent l'espace réseau de l'hôte : ils sont vus avec
  leur UID ; s'il est égal à celui du broker, ils sont traités comme le même compte.

## Admission HTTP et WebSocket

Amendement 2026-09-25. **Avant tout routage**, sur chaque requête HTTP — `/pair`, `/ws` avant la
montée en WebSocket, route inconnue comprise —, le broker applique dans cet ordre :

1. **En-tête `Host`.** Accepté seulement s'il vaut exactement, après passage en minuscules,
   `127.0.0.1:<port>` ou `localhost:<port>` (`<port>` = port écouté). Absent, vide, sans port, avec
   un autre port ou un autre nom : refusé. Pare le *DNS rebinding*.
2. **UID du pair (Linux).** Le broker prend l'adresse et le port source de la connexion
   (`server.requestIP(req)` sous Bun), cherche dans `/proc/net/tcp` la ligne dont
   `local_address` est ce couple et `rem_address` est `127.0.0.1:<port>` (adresses en hexadécimal
   petit-boutiste, format du noyau), et compare sa colonne `uid` à `process.getuid()`. Différent :
   refusé. **Ligne introuvable ou fichier illisible : refusé** (on échoue fermé). Si l'adresse du
   pair est une adresse IPv6 (`::ffff:127.0.0.1`), la recherche se fait aussi dans `/proc/net/tcp6`.
   Hors Linux : pas de vérification ; une seule ligne au démarrage, voir « Journalisation ».

Refus à l'étape 1 ou 2 : réponse `403`, corps `forbidden` en `text/plain`, rien d'autre (ni jeton,
ni raison), une ligne de journal. Aucune montée en WebSocket n'a lieu.

Puis le routage (remplace la phrase « tout le reste répond 404 », fausse pour `/ws` — audit, écart
n°10) :

| Requête | Réponse |
|---|---|
| `GET /pair` | `200 text/html` — voir « Page `/pair` » |
| `/pair` avec une autre méthode | `405`, en-tête `Allow: GET` |
| `/ws` avec en-têtes de montée WebSocket | `101`, puis « Poignée de main » |
| `/ws` sans montée | `400` `expected websocket upgrade` |
| toute autre route | `404` `not found` |

**Aucune route HTTP ne modifie l'état du broker.** `GET /pair` est en lecture seule. La révocation
d'un uuid Firefox et la rotation du secret permanent se font à la main, dans les fichiers (voir
« Poignée de main »), jamais par une requête.

## Poignée de main

Après l'admission HTTP ci-dessus, à l'ouverture du WebSocket, le broker vérifie **dans cet
ordre**, et ferme la connexion au premier échec (code 4401, raison **générique** `unauthorized` —
amendement 2026-09-25 : le texte disait « raison en clair », ce qui contredisait le paragraphe
« Échec de poignée de main » plus bas ; c'est ce dernier qui fait foi, audit écart n°3) :

1. En-tête `Origin` strictement égal à l'une de ces formes :
   - `chrome-extension://<ID>` où `<ID>` est dans la config du broker
     (`~/.config/wingpen/config.json`, clé `allowedExtensionIds`, tableau) — origine **autorisée** ;
   - `moz-extension://<uuid>` où `<uuid>` figure dans la liste des uuid Firefox épinglés — origine
     **épinglée** (voir « Cas Firefox » ci-dessous) ;
   - `moz-extension://<uuid>` absent de la liste — origine **provisoire** : admise jusqu'à l'étape 2,
     mais seul le secret permanent peut l'authentifier (et l'épingler).

   Toute autre origine, ou une origine absente, est refusée ici, avant la lecture de tout secret.
   `allowedExtensionIds` n'est lu qu'au démarrage : ajouter un ID demande un redémarrage du broker
   (inchangé). La liste des uuid Firefox, elle, est **relue sur disque à chaque ouverture de
   WebSocket** (amendement 2026-09-25).

   L'ID d'une extension non empaquetée est dérivé par Chrome du chemin de son dossier — il change
   si le dossier bouge, ce qui casse silencieusement le pairing (`checkOrigin()` ne matche plus
   rien). Pour l'éviter, l'extension embarque une clé publique fixe (`extension/manifest.json`,
   champ `key`, RSA 2048 en DER/base64) : Chrome dérive alors l'ID de cette clé, indépendamment du
   dossier. L'ID en résultant, `hehlgipomfminodhahcjbencblepjhah`, est celui présent par défaut
   dans `allowedExtensionIds` (`broker/src/config.ts`). La clé privée correspondante vit dans
   `extension-key.pem` à la racine du dépôt, gitignorée, jamais commitée — sa perte oblige à
   régénérer une paire et à republier l'extension sous un nouvel ID.
2. Premier message client = `{"type":"hello","v":1}` avec un champ `secret` **facultatif**, dans
   les **3 secondes**. Amendement 2026-09-25 — `secret`, s'il est présent, est l'un des deux :
   - le **secret permanent** : écrit par le broker dans `~/.local/share/wingpen/pairing.txt` au
     premier démarrage (128 bits aléatoires, 32 caractères hexadécimaux, 0600) ; comparé en temps
     constant ;
   - un **jeton de session** : délivré par un `hello-ok` précédent de ce même broker (voir
     ci-dessous).

   Décision du broker :

   | Origine (étape 1) | `hello` sans `secret` | secret permanent valide | jeton de session valide | autre valeur |
   |---|---|---|---|---|
   | autorisée (`chrome-extension://`) | octroi silencieux | octroi | octroi | refus |
   | épinglée (`moz-extension://`) | octroi silencieux | octroi | octroi | refus |
   | provisoire (`moz-extension://`) | refus | octroi **et épinglage** | refus | refus |

   Un jeton de session n'est valide que s'il a été délivré **à la même origine** et que cette
   origine est encore autorisée ou épinglée au moment du `hello`. Un jeton de session n'épingle
   jamais rien.

**Réponse — amendement 2026-09-25.** Tout octroi, quel qu'en soit le chemin, répond :
`{"type":"hello-ok","v":1,"models":["claude"],"capabilities":["chat","summarize"],"token":"<jeton de session>"}`.
`token` est désormais **toujours présent** :
- jeton de session **frais** si le `hello` n'en portait pas (sans `secret`, ou avec le secret
  permanent) ; c'est ce que ce document promettait déjà, le code renvoyait le secret permanent
  (audit, écart n°1) ;
- le **même** jeton si le `hello` présentait un jeton de session valide (pas de rotation à chaque
  reconnexion).

**Jeton de session.** 256 bits d'un générateur cryptographique (`randomBytes(32)`), 64 caractères
hexadécimaux — la longueur le distingue du secret permanent. Tenu **en mémoire seulement** par le
broker, jamais écrit sur disque : **un redémarrage du broker invalide tous les jetons de session.**
Le broker range chaque jeton sous son empreinte SHA-256 (la recherche ne dépend pas des premiers
caractères présentés), avec l'origine à laquelle il a été délivré, dans l'ordre de dernier usage. Au
plus 64 jetons ; au-delà, le moins récemment utilisé est oublié. Pas d'autre expiration.
L'extension range le jeton reçu dans `chrome.storage.session` sous la clé `pairingToken`, **à la
place** de ce qui s'y trouvait — en particulier, un secret permanent collé à la main est remplacé
par le jeton de session dès le premier `hello-ok`, et ne séjourne donc plus dans l'extension.

**Cas Firefox — amendement 2026-09-25 (remplace le passage du 2026-09-20).** L'origine est
`moz-extension://<uuid>`, où `<uuid>` est tiré au sort par Firefox à **chaque installation**
(`browser_specific_settings.gecko.id` ne l'influence pas). Le broker ne peut pas le connaître à
l'avance ; il l'apprend :
- **Épinglage.** Une origine provisoire qui présente le secret permanent valide est authentifiée,
  et son uuid est ajouté à la liste des uuid épinglés. Épingler exige le secret permanent ; rien
  d'autre ne l'accorde.
- **Liste, pas valeur unique.** Plusieurs uuid peuvent être épinglés (deux profils Firefox, une
  réinstallation, un chargement temporaire) ; le premier épinglé n'exclut pas les suivants.
- **Fichier.** `~/.local/share/wingpen/firefox-extension-uuids.txt`, 0600. Une entrée par ligne :
  `<uuid> <épinglé-le> <vu-le>`, séparés par une espace, uuid en minuscules, dates en ISO 8601 UTC
  (`2026-09-25T14:03:00Z`). Lignes vides et lignes commençant par `#` ignorées ; ligne malformée
  ignorée, avec une ligne de journal.
- **Relu à chaud.** Le broker relit le fichier à chaque ouverture de WebSocket : une modification
  à la main prend effet à la connexion suivante, **sans redémarrage** (audit, écart n°9). Les
  connexions déjà ouvertes ne sont pas coupées ; pour les couper, redémarrer le broker.
- **`vu-le`** est mis à jour à chaque octroi pour cet uuid. Toute écriture relit d'abord le fichier,
  modifie, puis écrit dans un fichier temporaire renommé par-dessus (atomique), en 0600 ; une
  entrée supprimée à la main n'est jamais recréée par une mise à jour de `vu-le`.
- **Plafond : 16 uuid.** Épingler un 17e oublie l'entrée au `vu-le` le plus ancien, avec une ligne
  de journal (`evict`).
- **Révocation** : supprimer la ligne. **Rotation du secret permanent** : supprimer `pairing.txt`
  et redémarrer le broker (tous les jetons de session tombent avec le redémarrage ; les uuid
  épinglés restent épinglés).
- **Migration.** Si `firefox-extension-uuids.txt` n'existe pas et que l'ancien
  `firefox-extension-uuid.txt` (valeur unique) existe, le broker crée le nouveau fichier avec cet
  uuid (`épinglé-le` = `vu-le` = date du démarrage), puis renomme l'ancien en
  `firefox-extension-uuid.txt.migrated`. Il ne le supprime pas.

**Ce que ça donne à l'usage (remplace « le colle une fois », audit écart n°6) :**
- Chromium (ID autorisé) : aucun collage, jamais.
- Firefox, extension **installée** (signée, non listée — voir `docs/FIREFOX.md`) : l'uuid est
  stable d'un redémarrage à l'autre. Un collage du secret permanent **par installation** ; ensuite
  appairage silencieux, y compris après un redémarrage du navigateur ou du broker.
- Firefox, extension **chargée temporairement** (`about:debugging`) : elle disparaît à la fermeture
  de Firefox et revient avec un **nouvel uuid** à chaque chargement. Un collage **par chargement**.
  Chaque chargement ajoute une entrée à la liste ; le plafond de 16 recycle les plus anciennes.

### Appairage silencieux

Amendement 2026-09-21. Problème : le jeton vit en `chrome.storage.session` (règle de sécurité n°1,
non négociable — jamais `storage.local`), donc il est effacé à **chaque** redémarrage du
navigateur, et sans ça l'utilisateur devait rouvrir `/pair` et cliquer à chaque fois. Trop de
friction pour un geste qui ne protège déjà rien de plus, une fois l'extension déjà connue.

Si le premier message du client est `{"type":"hello","v":1}` (sans `secret`) **et** que son
`Origin` est autorisée (`chrome-extension://<ID>` avec `<ID>` dans `allowedExtensionIds`) ou —
amendement 2026-09-25 — **épinglée** (`moz-extension://<uuid>` avec `<uuid>` dans la liste des
uuid Firefox), le broker octroie directement un jeton de session frais dans `hello-ok.token`.

Une origine qui n'est ni autorisée ni épinglée ne reçoit rien ici :
- un `chrome-extension://<ID>` inconnu est refusé **dès l'étape 1**, avant la lecture de tout
  secret. Ni `/pair` ni un collage ne peuvent le repêcher (le texte d'avant disait qu'il
  « retombe sur le flux `/pair` » : c'était faux, audit écart n°4). Le seul remède est d'ajouter
  l'ID à `allowedExtensionIds` puis de redémarrer le broker ;
- un `moz-extension://<uuid>` non épinglé (provisoire) doit présenter le secret permanent : la
  première utilisation reste un geste humain délibéré.

**Pourquoi ça ne réduit pas la protection.** Une page web ne peut pas forger l'en-tête `Origin` —
c'est le navigateur qui l'impose — donc un site hostile reste bloqué. Un programme qui tourne sous
le compte de l'utilisateur peut usurper l'origine de l'extension, mais il peut aussi lire
`pairing.txt` : il est dans la frontière acceptée (voir « Frontière de menace »). Un programme d'un
autre compte est arrêté avant, à l'admission (UID du pair, Linux). Pour Firefox, l'uuid épinglé est
connu du broker exactement comme un ID Chromium l'est d'avance : l'ancien motif d'exclusion (« il
n'y a jamais de moment où le broker pourrait le reconnaître d'avance ») tombe une fois l'uuid
épinglé.

**Côté extension — amendement 2026-09-25** (`background/service-worker.js`) :
- À froid (pas de `pairingToken` en `chrome.storage.session`), `connectIfNeeded()` ouvre le
  WebSocket et envoie `hello` **sans** `secret` (inchangé).
- Avec un `pairingToken` en mémoire, il l'envoie dans `hello.secret`.
- À chaque `hello-ok`, il range `hello-ok.token` dans `pairingToken` (remplacement).
- **Jeton refusé.** Si la connexion se ferme avec le code `4401` pendant la poignée de main
  **alors qu'un `secret` a été envoyé** : effacer `pairingToken`, puis retenter **aussitôt, une
  seule fois, sans `secret`**. Cet unique nouvel essai est permis **une fois par cycle de
  connexion** — un cycle va d'une déconnexion au `hello-ok` suivant ; le drapeau se remet à zéro
  sur `hello-ok`. S'il échoue aussi, l'état devient `"no-token"` et la reconnexion reprend son
  rythme habituel (backoff, alarme de 30 s). C'est ce qui rattrape un redémarrage du broker (jetons
  de session perdus) sans boucle infinie ni geste de l'utilisateur (audit §2, « Token rotation »).
- Refus sans `secret` envoyé : état `"no-token"`, comme avant.
- **Collage (options, Firefox).** Le champ est en écriture seule : jamais pré-rempli avec le jeton
  en mémoire. Coller une valeur non vide la range dans `pairingToken` et déclenche une reconnexion
  **immédiate**, qui annule le délai de backoff en cours. Coller une chaîne vide efface
  `pairingToken` (au lieu de ranger `""`).
- **Bandeau `"no-token"`**, reformulé :
  - sous Chromium, il dit que l'ID de cette extension (`chrome.runtime.id`, affiché) n'est pas
    dans `allowedExtensionIds` du broker, et qu'il faut l'y ajouter puis redémarrer le broker.
    **Aucun lien vers `/pair`** ;
  - sous Firefox, il renvoie vers `http://127.0.0.1:8787/pair` pour copier le secret permanent,
    et vers les options pour le coller.

**Échec de poignée de main : un seul message générique.** Quel que soit l'échec (mauvais `Origin`,
mauvais secret ou jeton de session, premier message qui n'est pas un `hello` valide — message de
plus de 256 Ko compris —, pas de `hello` dans les 3 s), le broker envoie exactement
`{"type":"error","id":"hello","code":"unauthorized","message":"unauthorized"}` puis ferme en 4401
avec la même raison générique. Un programme local qui teste la poignée de main ne peut pas
distinguer laquelle des vérifications a échoué — la raison précise part seulement dans le
journal du broker (voir « Journalisation »).

## Page `/pair` (Firefox seulement)

Amendement 2026-09-25 — remplace « Appairage en un clic » (2026-09-20 (2)).

**`GET /pair`**, après l'admission (`Host`, UID du pair), répond `200 text/html; charset=utf-8`,
une page générée côté serveur (`broker/src/pair.ts`) qui sert **uniquement** à épingler une
extension Firefox. Elle contient, échappés :
- le **secret permanent** (contenu de `pairing.txt`), à copier puis coller dans les options de
  l'extension Firefox ;
- la **liste, en lecture seule, des uuid Firefox épinglés**, avec `épinglé-le` et `vu-le`, et le
  chemin du fichier où les révoquer à la main ;
- une phrase qui dit que Chromium n'a pas besoin de cette page.

Elle ne contient **aucun ID d'extension, aucun bouton, aucun script** (le texte d'avant disait que
seul le premier ID était injecté, le code les injectait tous : la question disparaît avec eux,
audit écart n°2). Le secret est présenté dans un bloc de texte sélectionnable ; la copie se fait
à la main.

En-têtes de la réponse :
- `Cache-Control: no-store` ;
- `Referrer-Policy: no-referrer` ;
- `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`
  (aucun script ne peut s'exécuter dans la page, et elle ne peut pas être encadrée) ;
- `X-Content-Type-Options: nosniff` ;
- `Cross-Origin-Resource-Policy: same-origin`.

Amendement 2026-09-25 ter (revue de sécurité, L5). `/pair` n'est servie qu'à une navigation de
premier niveau : `Sec-Fetch-Mode: navigate` **et** `Sec-Fetch-Dest: document`, sinon `403`. Un
`fetch()` depuis le service worker d'une autre extension munie d'une permission d'hôte sur
`127.0.0.1` n'obtient donc plus le secret. Défense en profondeur seulement : une extension qui ouvre
un onglet sur `/pair` et y injecte un script de contenu le lit encore ; seul Native Messaging ferme
ce chemin. Un outil en ligne de commande qui veut le secret lit `pairing.txt`.

Aucune en-tête CORS : une page d'une autre origine ne peut pas lire la réponse. Elle n'est **pas**
une page d'extension : la CSP des manifestes ne s'y applique pas, d'où le `<style>` en ligne.

L'extension n'ouvre `/pair` que sous Firefox (bandeau `"no-token"`, page d'options). Sous
Chromium, aucun lien n'y mène.

### Chemin « un clic » retiré

Amendement 2026-09-25. Sont supprimés : le bouton « Connecter Wingpen » de `/pair`, le message
externe `wingpen:pair`, l'écouteur `chrome.runtime.onMessageExternal` du service worker et la clé
`externally_connectable` de `manifest.json`.

Pourquoi : ce chemin ne servait plus à rien et exposait une surface.
- Pour un ID **autorisé**, l'appairage silencieux donne déjà un jeton sans geste.
- Pour un ID **inconnu**, le broker refuse la connexion à l'étape `Origin`, avant de lire le
  moindre jeton (audit jeton §5, point 4) : le jeton transmis en un clic ne pouvait donc jamais
  servir.
- `externally_connectable` ne peut viser qu'un port littéral (`http://127.0.0.1:8787/*`), et
  ouvrait à toute page servie sur ce port — donc à un processus qui l'occuperait — un canal de
  messages vers le service worker.
- Firefox n'a jamais eu ce chemin (`externally_connectable` est absent de `manifest.firefox.json`).

Le paragraphe « Limitation connue — le port ne peut pas être dynamique » disparaît avec lui : le
port est figé (voir « Transport »). Il reste en dur dans `background/service-worker.js`
(`BROKER_PORT`, `WS_URL`), dans `panel/panel.js` (lien `/pair`, Firefox) et dans la CSP
`connect-src` des deux manifestes.

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

// Changer le fournisseur et/ou le modèle, et/ou la clé API du fournisseur
// claude-api. Champs omis = inchangés. `apiKey` est WRITE-ONLY (voir
// CLAUDE.md règle n°1) : accepté ici, jamais renvoyé — pas même dans la
// réponse `settings` qui suit ce message. Une chaîne vide efface la clé
// stockée. Voir « Fournisseur de modèle » plus bas.
{ "type": "settings.set", "id": "c9", "provider": "claude-api", "apiKey": "sk-ant-..." }

// Teste une connexion réelle (quelques tokens, pas un résumé) pour le
// fournisseur nommé — backend du bouton « Tester la connexion » des
// réglages. Voir « Fournisseur de modèle » plus bas.
{ "type": "settings.test", "id": "c10", "provider": "claude-api" }

// Amendement 2026-09-25. Disponibilité du fournisseur ACTIF, sans appel
// facturé. Envoyé par le panneau à son ouverture seulement. Voir
// « Disponibilité du fournisseur » plus bas.
{ "type": "provider.status", "id": "c11" }
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
  Agent. Comportement inchangé par rapport à avant cet amendement. **Ne peut jamais être le
  fournisseur du produit distribué** — il pilote l'abonnement Max personnel de l'utilisateur, dont
  les conditions Anthropic interdisent la revente (voir MEMORY.md « Contraintes économiques
  figées »). Reste utile en développement local.
- **`ollama`** — un démon Ollama local (`http://127.0.0.1:11434` par défaut, surchargeable par la
  clé `ollamaUrl` de `config.json`). C'est le seul fournisseur pour lequel Wingpen peut
  honnêtement affirmer que rien ne sort de la machine.
- **`claude-api`** (amendement 2026-09-21 (3)) — l'API Anthropic en HTTPS direct, avec la clé de
  l'utilisateur (BYOK, « bring your own key ») : c'est le chemin du produit distribué. Streaming
  SSE via `fetch`/`ReadableStream` de Bun, aucune dépendance ajoutée
  (`broker/src/providers/claude-api.ts`). Modèle par défaut `claude-opus-5`, surchargeable par le
  même champ `model` que les autres fournisseurs. La clé n'est jamais transmise à l'extension —
  voir juste en dessous. Un 401/403 de l'API échoue en `auth-required` avec :
  ```jsonc
  { "type": "error", "id": "c1", "code": "auth-required",
    "message": "Clé API refusée — vérifiez-la dans les réglages." }
  ```
  Un 429 ou une 5xx échoue en `model-unavailable`.

### La clé API : stockée par le broker, jamais transmise à l'extension

`settings.set` accepte un champ `apiKey` optionnel, WRITE-ONLY de bout en bout : persistée dans
`~/.config/wingpen/config.json` (0600, écriture atomique — comme le reste du fichier) mais **jamais**
renvoyée dans une réponse `settings`, quelle que soit la question posée — c'est la règle de sécurité
n°1 du projet (aucun secret ne doit atteindre l'extension). Une chaîne vide (`"apiKey": ""`) efface
la clé stockée. La clé n'est jamais journalisée, même tronquée, et n'apparaît jamais dans le texte
d'une erreur.

En échange, chaque entrée de `available` dans la réponse `settings` gagne un booléen `configured` :
vrai quand ce fournisseur a ce qu'il lui faut pour fonctionner — une clé stockée pour `claude-api`,
un démon qui répond pour `ollama`, un CLI installé pour `claude-cli` — indépendamment du modèle
actuellement choisi (c'est `available` qui couvre déjà cette dimension-là). L'extension affiche un
état, jamais une valeur :
```jsonc
{ "id": "claude-api", "label": "Claude (clé API)", "available": false,
  "reason": "no Anthropic API key configured", "configured": false }
```

### `settings.test` — tester une connexion réelle

Backend du bouton « Tester la connexion » des réglages. Effectue un vrai appel minimal (quelques
tokens, pas un résumé) contre le fournisseur nommé — pas forcément celui actuellement sélectionné,
l'utilisateur peut tester avant de basculer — borné à 20 s pour ne jamais bloquer le panneau :
```jsonc
{ "type": "settings.test", "id": "c10", "provider": "claude-api" }
{ "type": "settings.test-result", "id": "c10", "provider": "claude-api", "ok": true,
  "message": "Connexion à l'API Anthropic réussie." }
```
`message` est en français, une phrase, affichée telle quelle à un humain ; en cas d'échec elle nomme
le remède : clé refusée (« Clé API refusée — vérifiez-la dans les réglages. »), Ollama non lancé
(« Ollama ne répond pas — vérifiez qu'il est bien lancé sur cette machine. »), session Claude Code
expirée (le même message que l'erreur `auth-required` de `claude-cli` ci-dessus).

**`settings.get`** ne prend rien d'autre qu'un `id`. Réponse :

```jsonc
{
  "type": "settings",
  "id": "c8",
  "provider": "claude-cli",     // fournisseur actuellement sélectionné
  "model": "llama3.2",          // optionnel — nom de modèle propre au fournisseur
  "available": [
    { "id": "claude-cli", "label": "Claude (CLI locale)", "available": true, "configured": true },
    { "id": "ollama", "label": "Ollama (local)", "available": false,
      "reason": "Ollama unreachable at http://127.0.0.1:11434", "configured": false },
    { "id": "claude-api", "label": "Claude (clé API)", "available": false,
      "reason": "no Anthropic API key configured", "configured": false }
  ],
  "models": ["llama3.2:latest", "mistral:latest"]  // seulement si le fournisseur actif sait lister ses modèles
}
```

`available` liste **toujours** tous les fournisseurs connus, y compris ceux qui ne sont pas
utilisables maintenant — un fournisseur indisponible n'est jamais caché, seulement signalé avec une
raison courte (`reason`).

**`settings.set`** accepte `provider`, `model` et `apiKey`, tous trois optionnels — un champ omis
reste inchangé côté broker. Un `provider` qui n'est ni `"claude-cli"`, ni `"ollama"`, ni
`"claude-api"` est rejeté en `bad-request` par `parseClientMessage()` (`broker/src/protocol.ts`),
avant tout traitement. Seul `apiKey` est un secret (voir « La clé API » ci-dessus, amendement
2026-09-21 (3)) — write-only, jamais renvoyé. Sur succès, le broker persiste le changement dans
`~/.config/wingpen/config.json` (permissions `0600`, comme le reste du fichier) et répond avec un
`settings` frais, construit de la même façon que pour `settings.get`.

Si le modèle configuré pour `ollama` n'apparaît pas dans la réponse de son `/api/tags`, une
requête `chat`/`summarize`/`act` échoue en `model-unavailable`, avec le nom du modèle manquant dans
le message — jamais de repli silencieux sur un autre modèle installé.

**Session `claude-cli` expirée ou non authentifiée (amendement 2026-09-21 (2), task C3).** Les
sessions Claude Code expirent régulièrement et demandent à l'utilisateur de relancer `claude
/login` dans un terminal. Sans détection dédiée, ça échouait de façon obscure (erreur interne
opaque) ou faisait tourner l'appel jusqu'au timeout de 120 s, sans jamais dire pourquoi. Le
provider `claude-cli` (`broker/src/providers/claude-cli.ts`) capture le stderr du sous-processus
CLI et reconnaît un petit ensemble de formulations connues (`Please run /login`, `Invalid API
key`, `session has expired`, etc.), en restant tolérant : un échec dont le stderr parle de
login/session/authentification sans correspondre exactement à une formulation connue est quand
même classé `auth-required` plutôt que `internal` — la remède est la même dans les deux cas. Une
requête `chat`/`summarize`/`act` échoue alors avec :
```jsonc
{ "type": "error", "id": "c1", "code": "auth-required",
  "message": "Session Claude Code expirée ou non authentifiée. Lancez `claude /login` dans un terminal, puis réessayez." }
```
Ce broker ne pilote jamais lui-même le flux de connexion (`claude /login` reste un geste humain,
au clavier) — il se contente de le détecter et de le signaler clairement au lieu de le laisser
échouer en silence.

### Disponibilité du fournisseur — `provider.status`

Amendement 2026-09-25. Comble l'écart relevé par l'audit de connexion (§4 et §6) : le panneau
affichait « Connecté » alors que la première requête allait échouer. Le panneau demande l'état du
fournisseur **actif** à son ouverture et l'affiche en texte dans les bandeaux existants.

```jsonc
{ "type": "provider.status", "id": "c11" }
{ "type": "provider.status-result", "id": "c11", "provider": "ollama",
  "state": "ko", "reason": "model-missing", "checkedAt": "2026-09-25T14:03:00Z" }
```

- `provider` : le fournisseur dont l'état est rapporté, c'est-à-dire celui qui était actif à la
  réception de la demande (`claude-cli`, `ollama`, `claude-api`). Un `settings.set` concurrent vide
  le cache ; la demande suivante rapporte le nouveau fournisseur.
  La requête ne prend aucun autre champ que `id` : elle ne vise que le fournisseur actif.
- `state` :
  - `ok` — une vérification **non facturée** a établi que le fournisseur acceptera une requête ;
  - `ko` — une vérification non facturée a établi que la prochaine requête échouera ;
  - `unknown` — aucune vérification non facturée ne permet de conclure ; un échec éventuel sera
    signalé à la première requête, comme aujourd'hui.
- `reason` : code court, stable, en anglais, lu par le code du panneau (jamais affiché tel quel) ;
  toujours présent. Liste fermée ci-dessous.
- `checkedAt` : date ISO 8601 UTC de la vérification **effective** (pour une réponse servie depuis
  le cache, la date de la vérification d'origine).

`provider.status-result` est le terminal de son `id` ; `provider.status` ne répond jamais
`error`, sauf `bad-request` pour un message malformé. Une panne interne de la vérification donne
`state: "unknown"`, `reason: "probe-failed"`.

**Sémantique par fournisseur :**

| Fournisseur | Vérification | `state` / `reason` |
|---|---|---|
| `claude-api` | présence d'une clé dans `config.json` | pas de clé : `ko` / `no-key` ; clé présente : `unknown` / `key-unverified` |
| `claude-cli` | exécutable `claude` trouvé (même test que `isAvailable()`), puis `claude auth status` (JSON, délai 5 s) | introuvable : `ko` / `cli-missing` ; `loggedIn: false` : `ko` / `not-logged-in` ; `loggedIn: true` : `ok` / `logged-in` ; sortie non nulle, délai dépassé ou JSON illisible : `unknown` / `probe-failed` |
| `ollama` | `GET <ollamaUrl>/api/tags`, délai 1,5 s (celui d'`isAvailable()`) | injoignable, délai dépassé ou HTTP non 2xx : `ko` / `ollama-unreachable` ; modèle configuré absent de la liste (même règle de correspondance que `isAvailable()`, suffixe `:latest` toléré) : `ko` / `model-missing` ; aucun modèle configuré et liste vide : `ko` / `no-model-installed` ; sinon `ok` / `ready` |

- **`claude-api`** : une clé présente n'est **pas** annoncée `ok`, puisque rien n'a vérifié
  qu'elle est acceptée. Une validation non facturée (`GET /v1/models`) n'est ajoutée que **si une
  sonde non facturée est confirmée** par une source citée (recherche du lot 1) ; elle passera alors
  par un amendement de ce document, avec les codes `ready` (`ok`), `key-rejected` (`ko`, HTTP 401
  ou 403) et `api-unreachable` (`unknown`, réseau, 429 ou 5xx). **Jusque-là, présence seulement.**
- **`claude-cli`** (amendement 2026-09-25 bis) : `claude auth status` est une sonde non facturée,
  constatée le 25/09 sur Claude Code 2.1.281 : JSON sur `stdout`, code de sortie 0, aucun appel au
  modèle. Elle ne lit que l'état local : `ok` / `logged-in` veut dire « session ouverte sur cette
  machine », pas « session acceptée par Anthropic ». Une session révoquée côté serveur reste
  détectée à la première requête et signalée en `auth-required` (inchangé). La sonde utilise le
  même exécutable que le fournisseur (`resolveClaudeExecutable`, `WINGPEN_CLAUDE_PATH`) et
  l'environnement du broker. Des champs du JSON, seul `loggedIn` est lu : `email`, `orgId` et
  `orgName` ne quittent jamais le broker, ni vers l'extension ni vers le journal.
- **`ollama`** : `/api/tags` est local et gratuit.

**Cache côté broker : 60 s.** Un résultat est réutilisé pendant 60 s pour le même fournisseur et
la même configuration (fournisseur, modèle, `ollamaUrl`, présence de la clé). Un `settings.set`
réussi vide le cache. Deux demandes simultanées pendant une vérification en cours partagent la
même vérification.

**Quand le panneau le demande — uniquement à son ouverture**, c'est-à-dire en réponse à un geste
de l'utilisateur (règle du geste, `CLAUDE.md` n°5) : **une** demande par ouverture du panneau.
Jamais au démarrage du navigateur, jamais sur une reconnexion en soi, jamais périodiquement, jamais
depuis le service worker de sa propre initiative. Si le panneau s'ouvre alors que la connexion
n'est pas établie, la demande part une fois, dès l'état `connected`, tant que ce panneau reste
ouvert. Affichage : texte dans les bandeaux existants, aucun nouvel élément visuel.

**Aucune bascule automatique.** Le broker ne change **jamais** de fournisseur de lui-même — ni
sur un `ko`, ni sur un échec de requête. Seul un `settings.set` venu de l'utilisateur change le
fournisseur. `provider.status` ne modifie aucun état du broker (hormis son cache).

## Limites côté broker

- **Délai maximal d'un appel modèle : 120 s** (`MODEL_TIMEOUT_MS`, `broker/src/model.ts`). Passé
  ce délai sans réponse, le broker abandonne l'appel et envoie `{"type":"error","code":
  "model-unavailable", ...}` — sans ce garde-fou, un appel qui reste bloqué ne renvoie jamais ni
  `done` ni `error`, ce qui viole l'invariant « tout `id` reçoit un terminal » ci-dessous.
- **Flux modèle simultanés par connexion : 3** (`MAX_CONCURRENT_STREAMS`,
  `broker/src/server.ts`). Un `chat`/`summarize`/`act` de plus alors que 3 sont déjà en cours reçoit
  `{"type":"error","code":"bad-request","message":"too many concurrent requests (max 3 per
  connection)"}` sans lancer de processus `claude` supplémentaire.
- **Taille d'un message client : 256 Ko** (`MAX_MESSAGE_BYTES`, `broker/src/protocol.ts`).
  Amendement 2026-09-25 (audit écart n°11 : le code n'envoyait l'erreur que si un `id` était
  lisible, et ne fermait jamais) :
  - pendant la poignée de main : échec générique `unauthorized`, fermeture 4401 (voir « Poignée de
    main ») ;
  - après authentification : le broker envoie
    `{"type":"error","id":"oversized","code":"bad-request","message":"message exceeds 262144 byte cap"}`,
    puis ferme la connexion avec le code **1009** (*message too big*), ce qui interrompt les flux
    en cours de cette connexion. Le message n'est pas analysé : son `id` n'est pas cherché.
    L'extension légitime n'atteint jamais cette taille (texte tronqué à 40 000 caractères) ; un
    tel message vient d'un client défaillant.
- **Message invalide sans `id` lisible, après authentification** (JSON illisible, `id` absent) :
  ignoré, sans réponse ni fermeture — il n'y a pas d'`id` à qui répondre. Invalide avec un `id` :
  `error` `bad-request` pour cet `id` (inchangé).

## Messages broker → client

```jsonc
{ "type": "chunk", "id": "c1", "delta": "texte partiel…" }   // flux, n fois
{ "type": "done",  "id": "c1", "usage": { "inputTokens": 0, "outputTokens": 0 } }
{ "type": "error", "id": "c1", "code": "…", "message": "…" } // terminal pour cet id
{ "type": "prompts", "id": "c4", "items": [ { "name": "…", "body": "…" } ] }
// Amendement 2026-09-25 — voir « Disponibilité du fournisseur ».
{ "type": "provider.status-result", "id": "c11", "provider": "claude-api",
  "state": "ok" | "ko" | "unknown", "reason": "…", "checkedAt": "2026-09-25T14:03:00Z" }
```

Codes d'erreur : `bad-request`, `unauthorized`, `model-unavailable`, `auth-required`,
`context-too-large`, `cancelled`, `internal`.

## Journalisation

Amendement 2026-09-25. Le broker écrit sur sa sortie d'erreur (donc dans `journalctl` sous systemd)
**une ligne par octroi, par épinglage et par refus**, préfixée `wingpen-broker:` :

```
wingpen-broker: grant via=silent|secret|session origin=<origine>
wingpen-broker: pin uuid=<uuid>
wingpen-broker: evict uuid=<uuid> lastSeen=<date>
wingpen-broker: reject stage=host host=<valeur>
wingpen-broker: reject stage=peer peerUid=<n>          (ou reason=not-found)
wingpen-broker: reject stage=origin origin=<origine>
wingpen-broker: reject stage=handshake origin=<origine> reason=<raison précise>
wingpen-broker: reject stage=oversized origin=<origine>
```

Au démarrage, une ligne `peer-uid check: enforced (linux)` ou
`peer-uid check: NOT enforced on <plateforme>`, et les avertissements `port` / `WINGPEN_PORT`
décrits dans « Transport ».

**Jamais** le secret permanent, un jeton de session ni la clé API — ni entiers, ni tronqués, ni
leur empreinte. Les valeurs venues du client (`Host`, `Origin`) sont journalisées assainies :
caractères de contrôle remplacés par `?`, coupées à 200 caractères.

## Règles invariantes

- Un `id` reçoit **toujours** un terminal : `done`, `error` ou la réponse propre à son type
  (`prompts`, `settings`, `settings.test-result`, `provider.status-result`). Jamais deux, jamais
  aucun — **sauf si la connexion se ferme** : l'extension traite alors la fermeture comme le
  terminal de tous les `id` encore en vol sur cette connexion (amendement 2026-09-25).
- Le broker ne renvoie jamais la clé API, ni le secret permanent, ni un jeton de session, quelle
  que soit la question posée. **Exceptions, nommées et limitées à elles seules** (amendement
  2026-09-25, audit écart n°7) :
  1. `hello-ok.token` : un jeton de session, délivré seulement à la connexion qu'il authentifie
     (voir « Poignée de main ») ;
  2. `GET /pair` : le secret permanent, affiché pour l'épinglage d'une extension Firefox (voir
     « Page `/pair` »), après l'admission `Host` et UID du pair.
- Le broker ne renvoie jamais le contenu brut de `config.json`. `settings` expose le fournisseur,
  le modèle et un état par fournisseur (`available`, `configured`, `reason`), rien d'autre.
- Les requêtes sont sérialisées par connexion ; une deuxième requête pendant qu'une autre coule
  est acceptée, mais le broker ne garantit pas l'ordre d'arrivée entre `id` distincts.
- Taille maximale d'un message client : 256 Ko. Au-delà : `error` puis fermeture (4401 pendant la
  poignée de main, 1009 après) — voir « Limites côté broker ».
- Aucune route HTTP ne modifie l'état du broker.
- Le broker ne change jamais de fournisseur de lui-même.

## Annexe — écarts de l'audit du jeton (§5), résolution

Amendement 2026-09-25. Référence : `notes/audit_jeton_2026-09-25.md` §5.

| # | Écart | Résolution |
|---|---|---|
| 1 | « Jeton frais » promis, secret permanent renvoyé | Le code change : jeton de session frais en mémoire (« Poignée de main ») |
| 2 | `/pair` : « premier ID » écrit, tous injectés | Texte corrigé : `/pair` n'injecte plus aucun ID ; le code retire les ID de la page |
| 3 | 4401 « raison en clair » contre raison générique | Texte corrigé : raison générique `unauthorized` |
| 4 | ID inconnu « retombe sur `/pair` » | Texte corrigé : refus à l'`Origin`, remède = `allowedExtensionIds` + redémarrage ; chemin un clic retiré |
| 5 | Port personnalisé « marche par collage » | Texte corrigé : port 8787 figé ; le code cesse de lire `port` |
| 6 | « Collé une fois » | Texte corrigé (Chromium : jamais ; Firefox installé : une fois par installation ; temporaire : une fois par chargement) ; le code ajoute l'appairage silencieux des uuid épinglés |
| 7 | « Ne renvoie jamais le jeton » sans exception `/pair` | Texte corrigé : deux exceptions nommées |
| 8 | Frontière « même compte » non appliquée | Texte précisé (« Frontière de menace ») ; le code ajoute `Host` et UID du pair |
| 9 | Ré-appairage Firefox sans redémarrage promis | Le code change : liste relue à chaud ; texte : révocation = supprimer une ligne |
| 10 | « Tout le reste répond 404 » | Texte corrigé : table des routes (400, 403, 405) ; le code ajoute 403 et 405 |
| 11 | Message trop gros : `error` + fermeture promis | Le code change : `error` `oversized` puis fermeture 1009 après authentification |
