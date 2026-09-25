# Appairage et transport — étude du 25 septembre 2026

Lot 6 du goal `goal-3jSMWnRt`. Cette étude explique comment Wingpen relie l'extension au broker,
ce que le travail du 25/09 a changé, et compare trois façons de faire ce lien. Elle s'appuie sur
la recherche du lot 1 (`notes/recherche_appairage_2026-09-25.md` et ses cinq rapports), les
mesures du lot 2 (`docs/etudes/mesures-transport.md`, `bench/results/`), le protocole amendé
(`docs/PROTOCOL.md`, passages « Amendement 2026-09-25 »), la revue de sécurité du lot 7 et les
essais de bout en bout (`notes/e2e_preuves_2026-09-25.md`).

Convention : **[À VÉRIFIER]** marque une affirmation que la recherche n'a pas pu sourcer. Les
références `fichier:ligne` pointent l'arbre de travail du 25/09.

---

## 1. Comment Wingpen fonctionne

| Pièce | Où elle tourne | Ce qu'elle fait | Ce qu'elle détient |
|---|---|---|---|
| **L'extension** | dans le navigateur | affiche le panneau, lit la page quand vous le demandez | un jeton de session, en mémoire |
| **Le broker** | un programme de fond sur votre machine | prépare le prompt, appelle le modèle | la clé API, la configuration, vos prompts |
| **Le modèle** | chez le fournisseur choisi | écrit la réponse | rien de Wingpen |

Trois fournisseurs (`docs/PROTOCOL.md:460-483`) : `claude-cli` (le programme `claude` de la
machine, sur votre abonnement personnel, réservé au développement) ; `claude-api` (l'API
d'Anthropic avec votre propre clé, dite BYOK, voie du produit distribué) ; `ollama` (un modèle
local, seul cas où rien ne quitte la machine).

**Le trajet d'un clic.**
1. Vous cliquez « Résumer ». Ce clic autorise la suite (règle n°5) : la permission `activeTab`
   ouvre l'onglet affiché, et lui seul (`docs/extensions-101.md:58-61`).
2. Le panneau injecte un court script dans l'onglet (`extension/panel/panel.js:1061`). Il lit le
   texte affiché, jamais le HTML, retire les zones en cours de saisie, coupe à 40 000 caractères
   et réduit l'adresse à origine plus chemin (`extension/content/extract.js:17`, `:42-56`,
   `:158-164`).
3. Le *service worker*, script d'arrière-plan de l'extension, envoie ce texte sur un WebSocket
   (un canal ouvert dans les deux sens) vers `ws://127.0.0.1:8787/ws`
   (`extension/background/service-worker.js:22-23`). `127.0.0.1` désigne la machine elle-même.
4. Le broker encadre le texte par un délimiteur tiré au sort et dit au modèle que tout ce qui est
   dedans est une donnée (`docs/PROTOCOL.md:446-458`) : une page qui écrit « ignore tes
   instructions » reste du texte à résumer.
5. Le broker appelle le modèle avec les identifiants qu'il est seul à connaître ; la réponse
   revient par morceaux jusqu'au panneau (`broker/src/server.ts:280`).

Mesuré le 25/09 sur la vraie chaîne : 4,2 à 4,6 s par résumé, dont 9 à 15 ms pour ouvrir la
connexion (`bench/results/model-reference.json`).

**Pourquoi les identifiants vivent dans le broker.** Le stockage durable d'une extension est
écrit en clair sur le disque (`docs/etudes/technique.md:59`), et son script de contenu lit un
DOM qu'une page hostile peut écrire (`technique.md:55`) : un secret absent de l'extension ne peut
pas fuir par elle. La clé entre dans le broker par `settings.set` et n'en ressort jamais ;
l'extension ne voit qu'un booléen `configured` (`docs/PROTOCOL.md:485-502`). Elle va du broker à
Anthropic sans serveur de Wingpen entre les deux (`docs/DECISIONS.md`, T11).

**À quoi sert le jeton d'appairage.** Le broker écoute sur un port que tout ce qui tourne sur la
machine peut viser : une page web, une autre extension, un autre programme, un autre compte. Il
reconnaît Wingpen par quatre contrôles successifs (`docs/PROTOCOL.md:119-199`) :
1. **`Host`** doit valoir `127.0.0.1:8787` ou `localhost:8787`. Cela écarte le *DNS rebinding*,
   où un site fait pointer son propre nom vers `127.0.0.1`.
2. **UID du pair** (Linux) : le programme qui se connecte tourne sous le compte du broker.
3. **`Origin`** : l'identité de l'émetteur, apposée par le navigateur, qu'une page web ne peut
   pas modifier (`docs/PROTOCOL.md:278-279`). Pour Wingpen :
   `chrome-extension://hehlgipomfminodhahcjbencblepjhah`, ou `moz-extension://<uuid>` sous Firefox.
4. **Le jeton**, dans le premier message (`hello`).

Le **secret permanent** (`~/.local/share/wingpen/pairing.txt`, 128 bits) présente au broker une
installation Firefox, dont l'uuid est tiré au sort et ne peut pas être connu d'avance : un humain
le colle une fois, le broker retient l'uuid. Le **jeton de session**, remis à chaque connexion
réussie, vit en mémoire des deux côtés et disparaît au redémarrage du broker. Sous Chromium, il
n'ajoute aucune protection à l'`Origin` ; il remplace, dès la première connexion, le secret collé
sous Firefox (`docs/PROTOCOL.md:216-218`), si bien que l'extension ne garde aucun secret durable.

---

## 2. Où est la valeur

Le gratuit est grand public et délibérément complet ; le payant est vertical et professionnel
(`docs/DECISIONS.md`, P7, P11). Ce qui est vendu est « la fraîcheur des recettes, la commodité,
le support — jamais le code » (P17). Le code est public sous AGPL-3.0 (P16).

| Ressort | Contenu | Gratuit ou payant | Touché par le choix du transport ? |
|---|---|---|---|
| **Confiance** | pas de relais d'inférence, clé chez l'utilisateur, code public vérifiable | les deux ; c'est l'argument du gratuit | **en partie** |
| **Commodité** | installation en un paquet, connexion sans geste, chemin Ollama sans clé | les deux (voir la tension ci-dessous) | **oui** |
| **Fraîcheur des recettes** | corpus privé, signé, réparé quand un site change son HTML | payant | non |
| **Support** | un humain qui répond | payant | non |

**Confiance.** La promesse exacte est celle de `docs/PERIMETRE.md` : « vos pages vont au modèle
que vous avez choisi, et à personne d'autre — pas même à nous ». Elle repose sur trois faits
indépendants du transport : aucun relais (T11, `docs/etudes/faisabilite.md` §3), une clé en
écriture seule, un code que chacun peut relire. Le transport ne touche qu'une question : qui,
en dehors de Wingpen, peut parler au broker. Un intrus qui passerait l'admission obtiendrait une
session complète : faire tourner le modèle sur votre clé ou votre abonnement, changer de
fournisseur parmi les trois, écraser la clé, lire et effacer vos prompts
(`docs/PROTOCOL.md:96-101`). Il pourrait dépenser la clé sans pouvoir la lire.

**Commodité.** Trois gestes comptent : installer le broker et le garder lancé, relier
l'extension, fournir un modèle. Le premier est la falaise actuelle : aucun binaire empaqueté,
aucun démarrage automatique hors systemd (`notes/audit_connexion_2026-09-25.md` §6b). Le
deuxième est réglé sous Chromium depuis le 21/09 ; sous Firefox il reste un collage par
installation avec le WebSocket, aucun avec Native Messaging. Le troisième relève du *keywall*
(`docs/etudes/faisabilite.md` §5). Le transport décide du nombre de fichiers que l'installateur
pose, d'un éventuel avertissement à l'installation, du collage Firefox et de la prise en charge
des navigateurs Flatpak et Snap.

Une tension à signaler : P17 range « le paquet installable en un clic » dans ce qui est vendu,
alors que le gratuit grand public n'a pas d'utilisateurs sans installateur (P7, P11). Cette étude
suppose un installateur commun aux deux niveaux ; la question reste à trancher au jalon 2.

**Fraîcheur des recettes et support.** Les recettes sont des fichiers déclaratifs signés,
distribués par CDN (T10), entretenus par un canari et par les signalements des utilisateurs
(T19). Aucune des trois options de transport ne les concerne.

En résumé, le choix du transport touche deux choses : la solidité de « seul Wingpen parle au
broker » et le nombre de gestes à l'installation. Ce qui est vendu et l'absence de relais n'en
dépendent pas.

---

## 3. État au 25 septembre

### Ce que le travail du jour a changé

| Changement | Avant | Maintenant | Preuve |
|---|---|---|---|
| **Frontière de menace appliquée** | toute la machine, autres comptes compris (audit du jeton, écart n°8) | `Host` exact puis UID du pair (Linux), avant tout routage (`broker/src/server.ts:738-774`) | `Host: evil.example:8787` → 403 et `reject stage=host` au journal. Refus d'un autre compte : relu dans le code (revue lot 7), pas simulable ici |
| **Jeton de session** | `hello-ok` renvoyait le secret permanent (écart n°1) | jeton frais de 256 bits, en mémoire, lié à l'origine, 64 au plus (`docs/PROTOCOL.md:201-218`) | journal : `grant via=silent`, puis `grant via=session` ; après redémarrage du broker, `reject stage=handshake` suivi de `grant via=silent`, sans boucle ni geste |
| **`/pair` réservée à Firefox** | le secret à tout client local, avec les ID et un script | ni ID, ni bouton, ni script ; servie seulement à une navigation d'onglet (`broker/src/server.ts:860-894`) | `fetch` sans `Sec-Fetch-*` → 403 ; navigation → 200 avec `no-store`, CSP `default-src 'none'`, `CORP: same-origin` ; `POST` → 405 |
| **Liste d'uuid Firefox** | un seul uuid, le premier arrivé gardait la place, redémarrage requis | liste de 16, relue à chaque connexion, seul le secret permanent épingle, connexion silencieuse ensuite (`docs/PROTOCOL.md:220-256`) | tests `firefox-pins`, `firefox-pairing` ; essai humain dans Firefox encore à faire |
| **Disponibilité du fournisseur** | « Connecté » affiché alors que la première requête allait échouer | `provider.status` à l'ouverture du panneau, sans appel facturé (`docs/PROTOCOL.md:572-639`) | vrai broker : `{"provider":"claude-cli","state":"ok","reason":"logged-in"}` ; le durcissement systemd ne bloque pas la sonde |
| **Chemin « un clic » retiré** | `externally_connectable` ouvrait un canal à toute page servie sur 8787 | supprimé (`docs/PROTOCOL.md:358-377`) | revue lot 7 : plus d'`externally_connectable`, d'`onMessageExternal` ni de `wingpen:pair` |
| **Port 8787 figé** | `config.port` promettait un port libre que la CSP interdisait | 8787 seulement ; `WINGPEN_PORT` pour les tests (`docs/PROTOCOL.md:62-72`) | adresse et CSP littérales (`extension/background/service-worker.js:22-23`, `extension/manifest.json:15`) |

Preuves : `notes/e2e_preuves_2026-09-25.md` §2 à §5, sur le vrai broker (systemd) et le vrai
Brave. La revue de sécurité n'a trouvé aucun point haut, un point moyen (une annulation
déclenchait une sonde synchrone et facturée qui figeait le broker) et cinq points bas, tous
corrigés ; 298 tests passent (`notes/lot7_revue_securite.md`, `notes/lot7_fix_rapport.md`).

### Risques résiduels ouverts

Du plus sérieux au plus mineur.

1. **Falsification de l'`Origin` par une autre extension, sous Chrome (C2).**
   `declarativeNetRequest` permet à une extension de réécrire les en-têtes d'une requête, et
   `Origin` ne figure pas parmi les en-têtes interdits (source 11). Le bogue Chromium 1285664
   empêche de modifier un WebSocket ouvert *depuis un service worker* (sources 12, 13) ; il
   couvre la requête de Wingpen, et laisse modifiable celle qu'un attaquant ouvrirait depuis une
   page. Une extension munie de
   `declarativeNetRequest` et d'une permission d'hôte sur `127.0.0.1` pourrait donc ouvrir son
   propre WebSocket depuis une page ou un document *offscreen*, y apposer l'`Origin` de Wingpen,
   et recevoir l'octroi silencieux. L'ID de Wingpen devient public dès la publication sur le
   Chrome Web Store (source 21). Non prouvé par l'essai. Seul Native Messaging ferme ce chemin.
2. **Firefox : lecture de `/pair` par une autre extension.** Une extension munie d'une permission
   d'hôte sur `127.0.0.1` qui ouvre un onglet sur `/pair` et y injecte un script de contenu lit
   le secret permanent et s'épingle (`docs/PROTOCOL.md:105-107`, `:345-350`). Le filtre de
   navigation retire le `fetch()` direct, pas ce chemin. La réécriture de l'`Origin` par
   `webRequest` (C3) exigerait en plus de connaître l'uuid de Wingpen, propre à chaque profil et
   non exposé aux autres extensions (source 18).
3. **Usurpation du port.** L'extension n'authentifie pas le broker. Un programme qui occupe
   `127.0.0.1:8787` pendant que le broker est arrêté reçoit le `hello`, puis le texte des pages et
   les prompts (`docs/PROTOCOL.md:111-115`). Le jeton de session qu'il reçoit est déjà périmé,
   puisque le vrai broker s'est arrêté ; le secret permanent ne transite que dans le `hello` qui
   suit un collage Firefox.
4. **Hors Linux, pas de contrôle d'UID.** Sous macOS et Windows, un autre compte de la machine a
   le même accès que le vôtre (`docs/PROTOCOL.md:102-104`). Le broker range ses fichiers sous
   `~/.config/wingpen` et `~/.local/share/wingpen` sur tous les systèmes
   (`broker/src/config.ts:66-72`) ; que les modes 0600 et 0700 protègent quoi que ce soit sous
   Windows est [À VÉRIFIER].
5. **Trajectoire de Local Network Access (C1).** Chrome 147 (avril 2026) et Firefox 154 (août
   2026) filtrent désormais les WebSockets des *sites web* vers la boucle locale (sources 6, 7,
   9, 26). Les origines d'extension ne sont pas visées, ce qui explique que Wingpen se connecte
   sans permission d'hôte (mesuré sur Brave 152, `docs/DECISIONS.md` risque 1 ; `grant
   via=silent` le 25/09) ; la couche `localhost` propre à Brave (source 28) ne s'y applique pas
   non plus. Aucune source ne dit que cette exemption est définitive ; le cas des extensions sous
   Firefox n'est pas sourcé. Si elle se ferme, le remède sous Chrome est une permission d'hôte
   sur `127.0.0.1:8787` (source 5), demandée à l'installation ou à l'exécution. Le paragraphe
   « Transport » de `PROTOCOL.md` et la décision T3 citent encore crbug.com/421156866 comme « pas
   encore » appliqué : ce motif est daté.
6. **Un programme sous votre compte.** Accepté : il lit `pairing.txt` et `config.json`
   directement (`docs/PROTOCOL.md:96-101`). Aucune des trois options ne change ce point.
7. **Clé API non vérifiée à l'ouverture.** `claude-api` annonce `unknown` / `key-unverified` :
   que `GET /v1/models` ne soit pas facturé est probable, mais pas écrit par Anthropic
   (source 30). Une clé refusée se découvre à la première requête.
8. **Stabilité de l'uuid Firefox en chargement temporaire avec un ID gecko.** Les sources se
   contredisaient (C5, sources 18, 19, 20). **Tranché par l'essai le 25/09** : avec un ID gecko,
   l'uuid reste le même au rechargement et au redémarrage, sur un même profil
   (`docs/etudes/preuves-origine.md`). Et la réécriture de l'`Origin` (C2, C3) est prouvée sur les
   deux navigateurs, ce qui renforce la recommandation B.
9. **`allowedExtensionIds` demande un redémarrage du broker** ; seule la liste d'uuid est relue à
   chaud.
10. **Gestes humains non encore éprouvés** : la ligne d'état du panneau dans Brave, le collage
    Firefox suivi d'une reconnexion sans collage, le refus d'un autre compte
    (`notes/e2e_preuves_2026-09-25.md`, dernière section).

---

## 4. Trois options

- **A — WebSocket durci.** Ce qui tourne aujourd'hui : un broker lancé en service, qui écoute sur
  `127.0.0.1:8787` et trie les connexions par `Host`, UID, `Origin` et jeton.
- **B — Native Messaging et relais.** Le navigateur lance lui-même un très petit programme, le
  *relais*, et lui parle par son entrée et sa sortie standard. Le relais recopie les messages vers
  le broker existant, toujours lancé en service, par un fichier de socket local réservé à votre
  compte. Plus de port réseau, plus de `/pair`, plus de jeton.
- **C — Native Messaging, broker lancé par le navigateur.** Le manifeste d'hôte désigne le broker
  lui-même. Plus de service : le navigateur démarre le broker quand l'extension se connecte et
  l'arrête quand la connexion se ferme.

Le chapitre « La messagerie native » de `docs/extensions-101.md` explique le mécanisme.

### Comparaison

| Critère | A — WebSocket durci | B — NM et relais | C — NM, broker lancé par le navigateur |
|---|---|---|---|
| Qui reconnaît l'extension | le broker (`Host`, UID sous Linux, `Origin`, jeton) | le navigateur (`allowed_origins`, `allowed_extensions`) | le navigateur |
| Falsification d'`Origin` (C2) | ouverte, non prouvée | fermée | fermée |
| `/pair` lue par une extension Firefox | ouverte, rétrécie | sans objet | sans objet |
| Usurpation du port | ouverte | sans objet (socket 0600 dans un dossier 0700) | sans objet |
| Autre compte, macOS et Windows | non contrôlé | droits du fichier de socket ; Windows [À VÉRIFIER] | processus enfant du navigateur |
| Dépendance à LNA | oui | aucune | aucune |
| Programme sous votre compte | accepté | accepté | accepté |
| Linux, paquet natif | binaire + unité systemd | binaire + unité + relais + 1 manifeste par navigateur | binaire + 1 manifeste par navigateur |
| Linux, Flatpak et Snap | boucle locale partagée [À VÉRIFIER] | Snap Firefox ≥ 107 par portail ; Flatpak par script relais, fragile | Snap : comme B ; Flatpak : revient à B |
| macOS | binaire + démarrage de session [À VÉRIFIER] | idem + manifestes | binaire + manifestes |
| Windows | binaire + démarrage de session [À VÉRIFIER] | idem + manifestes + clés de registre | binaire + manifestes + clés de registre |
| Collage sous Firefox | un par installation | aucun | aucun |
| Avertissement à l'installation | aucun | `nativeMessaging` [texte À VÉRIFIER] | idem B |
| Revue de boutique | revue manuelle probable (`faisabilite.md` §7) | précédents : KeePassXC, Bitwarden, 1Password | idem B |
| Connexion à froid, p50 | 1,5 à 2,7 ms | 15 à 25 ms, plus le saut du relais (non mesuré) | 15 à 25 ms, plus le démarrage du broker |
| Plafond d'un message hôte → extension | aucun en pratique | 1 Mo | 1 Mo |
| Service worker Chromium inactif | peut s'arrêter ; l'alarme de 30 s le relance | maintenu par le port ouvert | maintenu |
| Environnement du broker | celui du service | celui du service | celui du navigateur |
| Nombre de brokers | 1 | 1 | 1 par navigateur |
| Code | existe, 298 tests | relais + socket ; retrait de `/pair`, du jeton et de l'`Origin` | cycle de vie + accès concurrents ; mêmes retraits |

### Performances mesurées

Même protocole de banc pour les deux transports, Brave 152 et Firefox 155, Linux
(`docs/etudes/mesures-transport.md`, `bench/results/`). Les chiffres Brave viennent de
`brave-ws.json`, `brave-nm.json` (sans DevTools) et `brave-cdp.json` (DevTools attaché, qui
garde le service worker en vie) ; `mesures-transport.md` ne les reprend pas encore.

| Mesure | Firefox WS | Firefox NM | Brave WS | Brave NM |
|---|---|---|---|---|
| Connexion à froid, p50 | 2 ms | 25 ms | 2,7 ms (CDP 1,5) | 15,1 ms (CDP 14,7) |
| Aller-retour, p99 | 2 ms | 2 ms | 0,3 à 0,7 ms | 0,6 à 1,1 ms |
| 5 000 blocs de 60 octets vers l'extension | 145 à 160 ms | 263 à 307 ms | 54 à 64 ms (CDP 48 à 56) | 126 à 179 ms (CDP 137 à 143) |
| 1 Mio vers l'hôte | 5 à 6 ms | 14 à 32 ms | 8,6 à 12 ms | 18,5 à 25,9 ms |
| 5 min d'inactivité puis ping | non conclu | survit, 7 ms | non conclu | non conclu |

Référence : un résumé complet coûte 4 232 à 4 579 ms (`bench/results/model-reference.json`).
L'écart le plus large entre transports, environ 160 ms pour 300 Ko en 5 000 morceaux (Firefox),
reste plus de vingt fois inférieur à ce temps, et une réponse réelle pèse bien moins (voir §5).
Les performances ne départagent pas les options.

Deux mesures manquent : le saut supplémentaire du relais de B, et la survie à l'inactivité sous
Brave (non conclue sur les deux transports ; DevTools attaché garde le service worker en vie).
Sous A, un service worker Chromium inactif peut s'arrêter ; l'alarme de 30 s le relance
(`extension/background/service-worker.js:83`) et la reconnexion coûte 9 à 15 ms.

### A — WebSocket durci

C'est l'existant, éprouvé en vrai le 25/09. Sa sécurité repose sur quatre contrôles faits par
le broker, dont un seul, l'`Origin`, distingue Wingpen d'une autre extension ; ce contrôle tient
contre les pages web et pas contre une extension qui réécrit ses propres en-têtes (risque 1). Sous
Linux le compte est vraiment la frontière ; sous macOS et Windows il ne l'est pas (risque 4).
L'installation ne touche aucun navigateur : un binaire et un démarrage de session suffisent, ce
qui fonctionne aussi avec les navigateurs Flatpak et Snap tant qu'ils partagent la boucle locale
de l'hôte [À VÉRIFIER]. Aucun texte de politique du Chrome Web Store trouvé n'interdit ce
schéma, et Chrome documente les WebSockets depuis un service worker (source 10) ; aucun précédent
de revue n'est documenté [À VÉRIFIER]. Côté maintenance, le coût est connu : suivre
LNA, garder `/pair` pour Firefox, écrire un démarrage de session par système.

### B — Native Messaging et relais

Le navigateur vérifie lui-même l'identité de l'extension avant de lancer le relais, contre une
liste exacte, sans joker (sources 1, 2). C'est ce qui ferme la falsification d'`Origin`, la
lecture de `/pair`, l'usurpation du port et la dépendance à LNA d'un seul coup, et ce qui retire
le collage sous Firefox. Le broker reste un service unique, lancé avec l'environnement que
l'installateur a réglé, ce qui préserve la leçon du 21/09. Le prix est à l'installation : un
manifeste par navigateur et par système, des clés de registre sous Windows, un relais par
architecture, et des navigateurs Flatpak ou Snap qui exigent un portail ou un script relais
(sources 4, 25). La permission `nativeMessaging` affiche un avertissement à l'installation ; sous
Firefox elle ne peut pas être facultative (source 16). Le plafond d'1 Mo impose de découper les
rares réponses volumineuses (voir §5). KeePassXC suit ce schéma (source 22) ; Bitwarden et
1Password aussi, sur les deux boutiques [À VÉRIFIER].

### C — Native Messaging, broker lancé par le navigateur

C a la même sécurité côté navigateur que B, et supprime en plus le service à installer. Ses
défauts tiennent au cycle de vie. Le broker hérite de l'environnement du navigateur, dont le
`PATH` ; le 21/09, un broker privé d'une seule variable d'environnement a basculé en silence sur
un CLI cassé et chaque requête a pendu sans message (`JOURNAL.md` 2026-09-21). Chaque navigateur
lance son propre broker : Brave et Firefox ouverts ensemble donnent deux processus qui écrivent
la même configuration et les mêmes prompts. Fermer le navigateur tue le broker et toute réponse
en cours (source 1). Un navigateur Flatpak ne peut pas lancer un programme hors de son bac à
sable sans passer par un relais (source 25), ce qui ramène à B.

---

## 5. Recommandation

**Garder A pour l'outil personnel tel qu'il tourne aujourd'hui. Adopter B pour la version
distribuée, et trancher au moment d'écrire l'installateur (jalon 2, point 7 de
`docs/etudes/faisabilite.md`). Écarter C.**

Les raisons, par ordre de poids :

1. **La falsification d'`Origin` (C2) n'a qu'un remède, Native Messaging.** Pour Romain sur sa
   machine, elle exige qu'il installe lui-même une extension malveillante munie de
   `declarativeNetRequest` ; A suffit. Pour un produit vendu sur la confiance, un examinateur ou
   un chercheur en sécurité pourra écrire qu'une autre extension peut dépenser la clé API de
   l'utilisateur. Confier la vérification au navigateur est le schéma que les gestionnaires de
   mots de passe utilisent déjà.
2. **Le distribué vise aussi Windows et macOS** (cadrage du 25/09, point 8), où A ne contrôle pas
   le compte (risque 4). B y remplace le port par un fichier de socket réservé au compte.
3. **LNA (C1) épargne les extensions aujourd'hui, sans garantie.** Le repli d'A est connu et peu
   coûteux (une permission d'hôte), donc C1 seul ne forcerait pas la bascule ; il pèse dans le
   même sens.
4. **Le plafond d'1 Mo ne gêne pas.** Les réponses partent en morceaux (`broker/src/server.ts:280`),
   `claude-api` plafonne la sortie à 8 192 tokens (`broker/src/providers/claude-api.ts:46`), soit
   quelques dizaines de kilo-octets, et chaque message client est déjà limité à 256 Ko
   (`broker/src/protocol.ts:6`). D'après le protocole, seule la réponse `prompts` peut dépasser
   1 Mo ; elle devra être paginée sous B ou C.
5. **La leçon du 21/09 écarte C.** Un broker lancé par le navigateur perd l'environnement du
   service ; c'est exactement la panne muette que l'unité systemd a corrigée. B garde le service.
6. **Les navigateurs Flatpak et Snap sont le point faible de B.** Forme proposée : sous B, le
   port WebSocket reste dans le broker, **désactivé par défaut**, activable à la main pour ces
   navigateurs, avec les risques d'A écrits à côté de l'interrupteur. Un port ouvert pour tous
   rendrait à chacun la surface qu'on retire.
7. **L'installateur pose déjà des fichiers par système** (binaire, démarrage de session). Un
   manifeste par navigateur et une clé de registre s'ajoutent à un travail qui existe de toute
   façon.

**Ce qui changerait la réponse :**

- L'essai du lot 1 bis montre qu'une extension ne peut pas apposer l'`Origin` d'une autre sur un
  WebSocket, ou Chrome ajoute `Origin` aux en-têtes interdits : l'avantage de B se réduit alors
  au collage Firefox, à l'usurpation du port et au compte sous macOS et Windows.
- Un contrôle du compte appelant devient possible sur la boucle locale sous macOS et Windows
  [À VÉRIFIER] : une raison de B tombe.
- Le Chrome Web Store ou AMO traite `nativeMessaging` plus durement qu'un WebSocket local (rejet,
  revue plus longue) : A.
- Une part importante du public visé utilise des navigateurs Flatpak ou Snap : A, ou B avec son
  interrupteur documenté dès l'installation.
- LNA s'étend aux origines d'extension sans exemption par permission d'hôte : B devient urgent,
  outil personnel compris.
- Le distribué abandonne `claude-cli` et ne vise qu'un navigateur par utilisateur : les coûts de C
  baissent (plus de chemin de CLI à trouver, un seul processus) et C redevient discutable.

---

## 6. Ce que l'installateur devra poser

Les chemins marqués « proposition » sont des choix de conception, pas des faits sourcés.

### Commun aux deux designs

- **Le broker**, compilé en exécutable unique (`bun build --compile`, T9), dans un dossier de
  l'utilisateur, sans droits d'administrateur. Proposition : `~/.local/bin/wingpen-broker`
  (Linux), `~/Library/Application Support/Wingpen/` (macOS), `%LOCALAPPDATA%\Wingpen\` (Windows).
- **Ses dossiers de données** : le broker crée lui-même `~/.config/wingpen/` et
  `~/.local/share/wingpen/` en 0700 au démarrage (`broker/src/config.ts:66-72`), sur tous les
  systèmes. Sous macOS et Windows, un emplacement natif serait plus propre ; sous Windows, les
  modes Unix ne décrivent pas les ACL [À VÉRIFIER].
- **Un environnement explicite** : tout chemin dont le broker a besoin figure dans la
  configuration ou dans l'unité de service, jamais dans le `PATH` hérité
  (`packaging/wingpen-broker.service`, commentaire de `Environment=`).
- **Geste de l'utilisateur** : franchir SmartScreen (Windows) ou Gatekeeper (macOS) tant que le
  broker n'est pas signé (`docs/etudes/faisabilite.md` §6) ; coller sa clé API dans les options,
  ou installer Ollama.

### Design WebSocket (A, l'existant)

| Système | Ce qui est posé | Démarrage | Geste de l'utilisateur |
|---|---|---|---|
| Linux avec systemd | `~/.config/systemd/user/wingpen-broker.service`, avec `Restart=always`, `Environment=` et `ReadWritePaths=` des deux dossiers | `systemctl --user daemon-reload`, `systemctl --user enable --now wingpen-broker`, `loginctl enable-linger` (`docs/INSTALL.md:15-17`, `MEMORY.md:47`) | aucun |
| Linux sans systemd | un lanceur de session XDG [À VÉRIFIER] | à l'ouverture de session | aucun |
| macOS | un LaunchAgent dans `~/Library/LaunchAgents/` [À VÉRIFIER] | à l'ouverture de session | Gatekeeper si non signé |
| Windows | une tâche planifiée à l'ouverture de session, ou une valeur sous `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` [À VÉRIFIER] | à l'ouverture de session | SmartScreen si non signé |

Par navigateur :

- **Chrome, Brave, Chromium** : rien à écrire, à condition que l'ID publié sur la boutique soit
  `hehlgipomfminodhahcjbencblepjhah`. Il faut pour cela publier avec la même clé publique (champ
  `key`, source 21). Sinon, l'installateur ajoute l'ID de la boutique à `allowedExtensionIds` de
  `~/.config/wingpen/config.json` puis redémarre le broker. Edge [À VÉRIFIER].
- **Firefox** : rien à écrire. L'utilisateur ouvre `/pair` et colle le secret une fois par
  installation.
- **Navigateurs Flatpak ou Snap** : rien de plus s'ils partagent la boucle locale [À VÉRIFIER].

### Design Native Messaging (B, et C)

**Le manifeste d'hôte.** Nom proposé : `app.wingpen.broker`, conforme aux règles des deux
familles (minuscules, points ; source 1 ; motif `^\w+(\.\w+)*$`, source 2). Le chemin du
programme est absolu sous Linux et macOS, relatif admis sous Windows (source 1).

```json
{
  "name": "app.wingpen.broker",
  "description": "Wingpen — relais vers le broker local",
  "path": "/home/<utilisateur>/.local/bin/wingpen-relay",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://hehlgipomfminodhahcjbencblepjhah/"]
}
```

Pour Firefox, la même chose avec `"allowed_extensions": ["wingpen@localhost"]` à la place de
`allowed_origins` (l'ID gecko actuel, `extension/manifest.firefox.json:8`). Les deux clés peuvent
cohabiter dans un même fichier, chaque navigateur ignorant celle de l'autre (source 3). Sous C,
`path` désigne le broker au lieu du relais.

**Emplacements, au niveau de l'utilisateur (aucun `sudo`) :**

| Navigateur | Linux | macOS | Windows |
|---|---|---|---|
| Chrome | `~/.config/google-chrome/NativeMessagingHosts/app.wingpen.broker.json` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | clé `HKCU\Software\Google\Chrome\NativeMessagingHosts\app.wingpen.broker`, valeur par défaut = chemin complet du JSON |
| Chromium | `~/.config/chromium/NativeMessagingHosts/` | [À VÉRIFIER] | [À VÉRIFIER] |
| Brave | `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` (mesuré, Brave 152) | [À VÉRIFIER] | [À VÉRIFIER] |
| Edge | [À VÉRIFIER] | [À VÉRIFIER] | [À VÉRIFIER] |
| Firefox | `~/.mozilla/native-messaging-hosts/app.wingpen.broker.json` | `~/Library/Application Support/Mozilla/NativeMessagingHosts/` | clé `HKCU\Software\Mozilla\NativeMessagingHosts\app.wingpen.broker`, valeur par défaut = chemin complet du JSON |

Sources : 1 et 2 pour Chrome et Firefox. Pour Brave, un fil communautaire affirme qu'il lit les
dossiers de Chrome (source 24) ; le banc du 25/09 montre au contraire que Brave 152 lit son propre
dossier `~/.config/BraveSoftware/…` et ignore `<user-data-dir>/NativeMessagingHosts/` quand on
lui passe `--user-data-dir` (`bench/results/brave-cdp.json`, `bench/results/run-brave.log`),
alors que la documentation de Chrome annonce ce dernier (source 1). Poser les deux dossiers, Brave
et Chrome, ne coûte rien.

**Flatpak et Snap.** Firefox en Snap lance un hôte depuis la version 107, par l'interface
WebExtensions du portail XDG (portail ≥ 1.14.4, snap `snap-desktop-integration`), sur GNOME et
KDE ; sur un gestionnaire de fenêtres sans portail, l'hôte ne démarre pas (source 4). Un
navigateur Flatpak demande un script relais posé dans son bac à sable, par exemple
`~/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/` (précédent KeePassXC,
source 25). Proposition : non pris en charge par NM au lancement, orientés vers l'interrupteur
WebSocket du §5.

**Ce que B ajoute** : le broker écoute sur un fichier de socket au lieu d'un port. Proposition :
`$XDG_RUNTIME_DIR/wingpen/broker.sock` sous Linux, un fichier sous
`~/Library/Application Support/Wingpen/` sous macOS, en 0600 dans un dossier 0700 ; sous
Windows, un tube nommé dont l'ACL ne laisse passer que le compte [À VÉRIFIER]. Le démarrage de
session est le même que pour A.

**Ce que C retire et impose** : plus de démarrage de session ; en échange, le broker ne doit
dépendre d'aucune variable d'environnement, puisqu'il hérite de celles du navigateur et démarre
dans le dossier de son exécutable (source 1).

**Côté extension** : la permission `nativeMessaging`. Sous Chrome elle peut être facultative
(source 15) ; sous Firefox, facultative, elle ne fonctionnait pas au moins jusqu'à la version 90
(source 16), donc obligatoire.

**Geste de l'utilisateur** : accepter l'avertissement de la permission à l'installation. Aucun
appairage, sur aucun navigateur.

**Désinstallation**, dans les deux designs : retirer le démarrage de session, les manifestes, les
clés de registre, le binaire ; les dossiers de données restent si l'utilisateur ne demande pas
leur suppression.

---

## 7. Sources

Qualité : **P** = documentation officielle ou traqueur de bogues de l'éditeur ; **S** =
source secondaire (blog, tiers) ; **C** = communauté.

| # | URL | Ce qu'elle établit | Q. |
|---|---|---|---|
| 1 | https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging | format du manifeste d'hôte Chrome, `allowed_origins` sans joker, emplacements Linux, macOS, registre Windows, cadrage 4 octets + JSON, 1 Mo hôte → extension et 64 Mio dans l'autre sens, un processus par `connectNative`, SIGTERM puis SIGKILL, arguments passés à l'hôte, dossier de travail | P |
| 2 | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests | manifeste Firefox, `allowed_extensions`, motif du nom, emplacements Linux, macOS, registre Windows | P |
| 3 | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging | cadrage et tailles côté Firefox (1 Mo, 4 Go), ID gecko requis, les deux clés coexistent dans un manifeste | P |
| 4 | https://bugzilla.mozilla.org/show_bug.cgi?id=1661935 | Native Messaging dans le Snap Firefox par le portail XDG, échec sans portail | P |
| 5 | https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pUDh8RiTjJk | une extension munie des bonnes permissions d'hôte n'est pas touchée par LNA (équipe Chrome, nov. 2025) ; bogue corrigé en 144 | P |
| 6 | https://developer.chrome.com/blog/local-network-access | LNA vise les *sites web* ; un service worker web ne peut pas déclencher la demande | P |
| 7 | https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups | intention de livrer LNA pour les WebSockets | P |
| 8 | https://groups.google.com/a/chromium.org/g/blink-dev/c/4gx2y5jPGbU | crbug.com/421156866, WebSockets sous LNA, phase de test | P |
| 9 | https://myconnectionserver.visualware.com/support/v11/userguide/chrome-lna-websocket | WebSockets sous LNA à partir de Chrome 147 ; classement par adresse résolue | S |
| 10 | https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets | Chrome documente les WebSockets depuis un service worker d'extension | P |
| 11 | https://groups.google.com/a/chromium.org/g/chromium-extensions/c/034BzGADjsg | `Origin` n'est pas un en-tête interdit à `declarativeNetRequest` | P |
| 12 | https://groups.google.com/a/chromium.org/g/chromium-extensions/c/-BnVay-2Irw | DNR et `webRequest` ne s'appliquent pas aux WebSockets ouverts depuis un service worker | P |
| 13 | https://bugs.chromium.org/p/chromium/issues/detail?id=1285664 | le bogue correspondant, ouvert | P |
| 14 | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeSendHeaders | `webRequest` bloquant sous Firefox, aucune restriction par en-tête documentée | P |
| 15 | https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions | permissions facultatives en MV3 | P |
| 16 | https://bugzilla.mozilla.org/show_bug.cgi?id=1630415 | `nativeMessaging` facultatif en échec sous Firefox 90 | P |
| 17 | https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle | un port `connectNative` ouvert garde le service worker en vie depuis Chrome 105 ; activité WebSocket prise en compte depuis Chrome 116 | P |
| 18 | https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id | uuid Firefox rangé dans `extensions.webextensions.uuids`, propre au profil | P |
| 19 | https://discourse.mozilla.org/t/constant-or-well-known-mox-extension-uuid-for-webextension/9701 | uuid différent entre installation de développement et installation signée | C |
| 20 | https://airtower.wordpress.com/2020/07/19/configure-a-firefox-web-extension-from-selenium | uuid aléatoire à chaque chargement temporaire sans ID gecko | S |
| 21 | https://developer.chrome.com/docs/extensions/reference/manifest/key | le champ `key` fixe l'ID ; la boutique le conserve si on publie avec | P |
| 22 | https://gitlab.com/nonguix/nonguix/-/issues/368 | KeePassXC pose lui-même ses manifestes d'hôte pour Firefox et Chrome | C |
| 23 | — | Bitwarden et 1Password utilisent `nativeMessaging` et sont publiés sur les deux boutiques [À VÉRIFIER] | — |
| 24 | https://community.brave.app/t/what-is-the-path-for-native-messaging-on-linux/616427 | confusion sur le dossier lu par Brave sous Linux | C |
| 25 | https://zihad.com.bd/posts/how-to-use-keepassxc-flatpak-with-flatpak-browser | script relais pour un navigateur Flatpak | S |
| 26 | https://hirantha.me/blog/firefox-154-locks-down-websocket-access-to-your-local-network | Firefox 154 filtre les WebSockets des sites vers la boucle locale | S |
| 27 | https://archive.fosdem.org/2026/schedule/event/QCSKWL-firefox-local-network-access | architecture LNA de Firefox ; ne traite pas le cas des extensions | P |
| 28 | https://brave.com/privacy-updates/27-localhost-permission | couche de permission `localhost` propre à Brave, pour les pages | P |
| 29 | https://github.blog/security/application-security/localhost-dangers-cors-and-dns-rebinding | la liste `Host` comme défense serveur contre le *DNS rebinding* | S |
| 30 | https://docs.anthropic.com/en/api/models-list | `GET /v1/models` exige la clé ; la gratuité n'y est pas écrite | P |
| 31 | https://code.claude.com/docs/en/cli-reference | `claude auth status` rend un JSON | P |

**Non sourcé, marqué [À VÉRIFIER] dans le texte :**

- le texte exact de l'avertissement `nativeMessaging` sous Chrome et Firefox ;
- le traitement de `nativeMessaging` et du WebSocket local par la revue du Chrome Web Store et
  d'AMO (aucune politique ni aucun rejet documenté trouvé) ;
- les emplacements des manifestes d'hôte pour Chromium hors Linux, Brave hors Linux et Edge ;
- l'exemption LNA des extensions sous Firefox ;
- l'accès des navigateurs Flatpak et Snap à la boucle locale de l'hôte ;
- les démarrages de session hors systemd (lanceur XDG, LaunchAgent, tâche planifiée, clé `Run`) ;
- l'effet des modes 0600 et 0700 sous Windows, et l'ACL d'un tube nommé ;
- un contrôle du compte appelant sur la boucle locale sous macOS et Windows ;
- la stabilité de l'uuid Firefox d'un chargement temporaire muni d'un ID gecko (C5).

**Sources internes** : `docs/PROTOCOL.md`, `docs/DECISIONS.md`, `docs/etudes/faisabilite.md`,
`docs/etudes/technique.md`, `docs/etudes/mesures-transport.md`, `bench/results/*.json`,
`notes/recherche_*.md`, `notes/audit_jeton_2026-09-25.md`, `notes/audit_connexion_2026-09-25.md`,
`notes/lot7_revue_securite.md`, `notes/lot7_fix_rapport.md`, `notes/e2e_preuves_2026-09-25.md`,
`JOURNAL.md` (2026-09-21).
