# Preuves — l'`Origin` peut-il être forgé ? l'uuid Firefox tient-il ? (2026-09-25)

Le broker reconnaît l'extension surtout par l'en-tête `Origin` de sa connexion WebSocket
(`chrome-extension://hehlgipomfminodhahcjbencblepjhah`, ou un `moz-extension://<uuid>` épinglé).
La recherche du lot 1 disait qu'une autre extension *pourrait* forger cet en-tête (C2, C3) et se
contredisait sur la stabilité de l'uuid d'une extension temporaire Firefox (C5). Ces trois points
sont désormais tranchés par l'essai.

Protocole commun : une extension « attaquante » (`bench/poc-origin/`) ouvre un WebSocket vers un
**serveur d'essai** sur `127.0.0.1:18801`, qui note l'`Origin` reçu. Jamais le vrai broker. Profils
de navigateur jetables, `HOME` simulé, tout sous `wingpen/.tmp/`. Relevés bruts :
`bench/poc-origin/results/observations.ndjson`, détail Firefox : `notes/poc-origin-resultats.md`.

## Chrome et Brave — C2 : confirmé

Brave 152, extension munie de `declarativeNetRequestWithHostAccess` et d'une permission d'hôte sur
`127.0.0.1`, une seule règle `modifyHeaders` qui fixe `Origin` à l'identifiant de Wingpen pour les
requêtes `websocket` vers `ws://127.0.0.1:18801/`.

| Connexion ouverte depuis | `Origin` reçu par le serveur |
|---|---|
| le service worker de l'extension (témoin) | `chrome-extension://ljmabjmgmdglabfcgmanclfdggloohlg`, le vrai, non modifié |
| une page de l'extension | **`chrome-extension://hehlgipomfminodhahcjbencblepjhah`, celui de Wingpen** |

La requête issue du service worker échappe à la règle : c'est le bug Chromium signalé par la
recherche. Celle issue d'une page, non : l'en-tête arrive forgé.

Un premier essai avait échoué. Sa règle filtrait `ws://127.0.0.1/*` et ne correspondait donc pas
à une adresse qui porte un port. Corrigée en `|ws://127.0.0.1:18801/`, elle forge l'en-tête.
L'échec du premier essai ne prouvait donc rien.

## Firefox — C3 : confirmé

Firefox 155, extension munie de `webRequest`, `webRequestBlocking` et d'une permission d'hôte sur
`127.0.0.1` : un écouteur `onBeforeSendHeaders` bloquant réécrit l'`Origin` de sa propre
connexion WebSocket en `chrome-extension://hehlgipomfminodhahcjbencblepjhah`, et le serveur le
reçoit tel quel. Une extension Firefox peut donc se faire passer pour **Wingpen sous Chromium**,
et le broker accorde l'octroi silencieux à cette origine quel que soit le navigateur.

## Ce que cela veut dire pour Wingpen

**Le contrôle d'`Origin` ne distingue pas Wingpen d'une autre extension installée**, ni sous Chrome
ni sous Firefox. Une extension qui obtient ces permissions, discrètes (une permission d'hôte sur
`127.0.0.1`, et `declarativeNetRequest` ou `webRequest`), obtient une session complète du broker :

- elle utilise l'abonnement ou la clé de l'utilisateur ;
- elle lit et modifie les réglages et la bibliothèque de prompts ;
- elle ne lit pas les pages que Wingpen a résumées, puisque le broker ne les garde pas.

Le contrôle `Host` et le contrôle du compte ne l'arrêtent pas : la connexion vient bien du
navigateur de l'utilisateur, sous son compte.

**Aucune parade simple n'existe dans l'option A.**
- Supprimer l'octroi silencieux ramènerait le collage du jeton à chaque redémarrage du navigateur.
- Un secret glissé dans le paquet de l'extension se lit dans le paquet public de la boutique.
- Vérifier quel processus détient la connexion distingue Firefox de Chrome, mais pas deux
  extensions d'un même navigateur.

Native Messaging règle la question, puisque le navigateur y vérifie lui-même l'identité de
l'extension. C'est l'option B de `docs/etudes/appairage.md`, et ce résultat la renforce.
**Basculer est un changement d'architecture : la décision revient à Romain.**

## Firefox — C5 : l'uuid d'une extension temporaire tient

Extension temporaire munie d'un ID gecko, même profil, trois exécutions indépendantes : l'uuid
est **identique** au premier chargement, après un rechargement, et après un redémarrage complet de
Firefox. Il ne change qu'avec le profil.

Conséquence : sous Firefox, le secret se colle **une fois par profil**, pas une fois par chargement.
Après un redémarrage, il suffit de recharger l'extension temporaire, et l'uuid déjà épinglé est
reconnu sans rien coller. Les passages qui disaient « une fois par chargement » sont corrigés
(`PROTOCOL.md`, le cours).

## Les cinq erreurs Firefox

Elles ne se reproduisent pas au chargement de l'extension seule : aucune exception n'est
relevée. La trace d'erreur de Firefox sur la sortie standard est un gabarit générique
(`Object { message }`) qui ne porte jamais le texte réel. WebDriver BiDi ne couvre pas le
contexte d'arrière-plan d'une extension, et refuse d'ouvrir `about:debugging` comme les pages
`moz-extension://`. Seul l'outil « Examiner » de `about:debugging` donnera le vrai message. C'est un
clic à faire avec Romain, panneau ouvert.
