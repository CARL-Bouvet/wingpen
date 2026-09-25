# Inventaire de l'interface — Coati (Wingpen)

État relevé le 2026-09-25 sur le code du dépôt. Chaque affirmation porte sa référence
`fichier:ligne` ; les chemins d'extension sont relatifs à `extension/`.

## 1. Ce que la maquette doit couvrir

Ce document recense tout ce que l'extension montre et fait aujourd'hui, pour que la maquette Penpot
n'oublie ni un écran, ni un état, ni un message. Il ne propose aucune forme visuelle, aucune
disposition, aucun wireframe : la maquette est dessinée par Romain, puis reproduite dans le code
(méthode du projet, 19/09). Les seules indications de mise en page données ici sont des
contraintes techniques dures (largeur du panneau, tailles d'icône, rendu du texte). Le nom affiché
dans le code est encore « Wingpen » ; « Coati » est le nom retenu (`docs/design/noms.md:171-176`)
et n'est appliqué nulle part dans l'interface.

## 2. Surfaces

### 2.1 Le panneau (panneau latéral Chrome / barre latérale Firefox)

- **Accès.** Clic sur l'icône de la barre d'outils. Sous Chromium, le comportement
  `openPanelOnActionClick` ouvre le panneau (`background/service-worker.js:82`) ; sous Firefox,
  l'écouteur `action.onClicked` appelle `sidebarAction.open()` (`background/service-worker.js:104-107`,
  `:119-123`). Aussi ouvert par un choix du menu contextuel (`background/service-worker.js:144`).
- **Déclaration.** Chrome : `side_panel.default_path` (`manifest.json:21-23`), permission
  `sidePanel` (`manifest.json:12`). Firefox : `sidebar_action` avec son propre titre et ses icônes
  (`manifest.firefox.json:31-40`), sans permission `sidePanel` (`manifest.firefox.json:11-17`).
- **Structure actuelle, de haut en bas** (`panel/panel.html:10-50`) : barre du haut (nom, ligne
  d'état, bouton réglages), bandeau de connexion (masqué par défaut), barre d'outils (bouton
  principal, lien d'activation, bibliothèque de prompts, bouton d'enregistrement), fil de messages
  (`aria-live="polite"`), zone de saisie (case « Wingpen lit cette page », champ, trois boutons),
  ligne de version.
- **Contraintes dures.**
  - Largeur : le panneau latéral Chrome est redimensionnable par l'utilisateur ; aucune mesure
    n'est consignée dans le dépôt. Lecture prudente : dessiner pour environ 320 px de large au
    plus étroit, et vérifier que rien ne casse jusqu'à environ 600 px. Hauteur : toute la fenêtre,
    le corps est une colonne flex pleine hauteur (`panel/panel.css:5-17`).
  - Firefox : la barre latérale est partagée avec les favoris et l'historique ; son en-tête (titre
    « Wingpen », sélecteur de barre) est dessiné par Firefox, hors de notre contrôle
    (`manifest.firefox.json:33`). Le panneau n'y connaît pas d'autre différence fonctionnelle
    (`docs/FIREFOX.md:11-12`), sauf le bandeau « pas de jeton » (section 3).
  - Clair / sombre : la palette Coati exige une variante sombre qui suit `prefers-color-scheme`
    (`docs/design/palette.md:33-34`). Le CSS actuel n'a aucune règle sombre (fond `#fafafb`,
    `panel/panel.css:10-11`).
  - Le panneau ne maintient pas le service worker en vie : celui-ci peut être tué à tout moment
    (`background/service-worker.js:4-7`). Le panneau détecte ce cas pendant une requête et l'annonce
    par un message (`panel/panel.js:766-777`). La maquette doit prévoir qu'une requête s'arrête
    sans réponse, avec un message d'erreur à la place.
  - Un panneau restauré au démarrage du navigateur (sans clic) ne lit pas la page pendant 10 s ; le
    bouton principal reste alors « Résumer » (`panel/panel.js:212-224`, `:857-869`).
  - CSP : aucun style en ligne, aucune image distante (`manifest.json:15`). Tout visuel est un
    fichier de l'extension.

### 2.2 La page d'options

- **Accès.** Bouton ⚙ du panneau (`panel/panel.js:180`) ; menu de l'extension du navigateur.
  S'ouvre dans un onglet (`manifest.json:24-27`, `manifest.firefox.json:41-44`).
- **Structure actuelle** : quatre sections titrées — « Réglages Wingpen » (jeton), « Modèle »,
  « Conservation de l'historique », « Sites où Wingpen se reconnaît tout seul »
  (`options.html:9`, `:32`, `:52`, `:69`). Colonne de 480 px au plus (`options.css:4`).
- **Contraintes.** Page pleine largeur d'onglet ; pas de variante sombre aujourd'hui. Le champ du
  jeton ne sert qu'à Firefox (`options.html:10-17`) mais est affiché partout.

### 2.3 L'icône de la barre d'outils

- Quatre tailles déclarées : 16, 32, 48, 128 px (`manifest.json:28-41`,
  `manifest.firefox.json:36-39`, `:45-58`). Infobulle : « Wingpen » (`manifest.json:35`).
- Des variantes `icon-light16/32/48/128.png` existent dans `icons/` mais aucun manifeste ne les
  référence. Aucune icône ne change selon l'état de connexion (pas de badge, pas de
  `setIcon`).
- Règle : l'icône 16 px est un dessin séparé, jamais une réduction de la grande
  (`JOURNAL.md:345-346`, `:403-406`). Elle doit rester lisible sur une barre claire et sur une
  barre sombre.

### 2.4 Le menu contextuel

- Visible seulement sur une sélection de texte (`contexts: ["selection"]`,
  `background/service-worker.js:90-92`). Un parent « Wingpen » et quatre entrées : Reformuler,
  Raccourcir, Expliquer, Traduire (vers le français) (`background/service-worker.js:57-62`).
- Le rendu est celui du navigateur : seuls les libellés relèvent de la maquette. Le libellé de
  l'entrée réapparaît dans la bulle utilisateur du panneau (`panel/panel.js:1144`).

### 2.5 La page `/pair` du broker (Firefox seulement)

- **Accès.** Bouton « Ouvrir /pair » du bandeau « pas de jeton », sous Firefox uniquement
  (`panel/panel.js:446-451`, `:181`), ou saisie manuelle de `http://127.0.0.1:8787/pair`.
- **Contenu** (`broker/src/pair.ts:91-115`) : titre, phrase d'explication, secret permanent dans un
  bloc sélectionnable, liste en lecture seule des uuid Firefox épinglés avec leurs dates.
- **Contraintes.** Page servie par le broker, hors extension : aucun script, styles en ligne
  seulement (`docs/PROTOCOL.md:351-362`, `:371-372`). Aucun bouton, la copie se fait à la main
  (`docs/PROTOCOL.md:351-354`). Colonne de 560 px (`broker/src/pair.ts:66`). Pas de variante sombre.

## 3. États de connexion

L'état vient du service worker (`background/service-worker.js:65`, `:249-252`) ; le panneau le
traduit (`panel/panel.js:408-471`).

| État | Ligne d'état du panneau | Bandeau | Bouton d'action | Positionné par |
|---|---|---|---|---|
| `unknown` | « … » | aucun | aucun | `panel/panel.js:207` (le service worker n'a pas répondu) ; valeur initiale `panel/panel.html:15` |
| `connecting` | « Connexion… », point orange | aucun | aucun | `background/service-worker.js:267` |
| `handshaking` | « Connexion… », point orange | aucun | aucun | `background/service-worker.js:277` |
| `handshake-timeout` | le code brut « handshake-timeout », sans couleur de point | aucun | aucun | `background/service-worker.js:283` ; libellé absent de `panel/panel.js:424-431` (état fugace, suivi de `disconnected`) |
| `connected` | « Connecté », point vert, suivi du suffixe fournisseur | aucun | aucun | `background/service-worker.js:384` ; `panel/panel.js:277` |
| `disconnected` | « Déconnecté », point rouge | « Le broker Wingpen ne répond pas… » | aucun | `background/service-worker.js:309`, `:323`, `:350` ; `panel/panel.js:283` |
| `no-token` (Chromium) | « Pas de jeton — voir réglages », point rouge | identifiant de l'extension inconnu du broker | aucun | `background/service-worker.js:320` ; `panel/panel.js:453-458` |
| `no-token` (Firefox) | « Pas de jeton — voir réglages », point rouge | pas encore appairé, ouvrir `/pair` | « Ouvrir /pair » | `background/service-worker.js:320` ; `panel/panel.js:446-451` |

Couleurs des points actuelles : vert `#2fb757`, orange `#e8a53c`, rouge `#d5495a`
(`panel/panel.css:53-57`). La page d'options affiche la même ligne d'état, avec « Pas de jeton »
sans renvoi (`options.js:120-130`).

**Suffixe de disponibilité du fournisseur.** En état `connected`, le panneau demande une fois par
ouverture l'état du fournisseur actif (`panel/panel.js:479-491`) et ajoute à « Connecté » le texte
« · <fournisseur> : <raison> » (`panel/panel.js:433`, `:516-521`). Il s'efface dès qu'on quitte
`connected` (`panel/panel.js:416`).

| Fournisseur (`provider`) | Libellé | Source |
|---|---|---|
| `claude-cli` | Claude (abonnement) | `panel/panel.js:498` |
| `claude-api` | Claude (clé API) | `panel/panel.js:499` |
| `ollama` | Ollama | `panel/panel.js:500` |
| autre | Modèle | `panel/panel.js:517` |

| Code `reason` | `state` | Texte affiché | Source |
|---|---|---|---|
| `ready` | ok | prêt | `panel/panel.js:504` |
| `logged-in` | ok | session ouverte | `panel/panel.js:505` |
| `no-key` | ko | aucune clé API enregistrée | `panel/panel.js:506` |
| `key-unverified` | unknown | clé API enregistrée, non vérifiée | `panel/panel.js:507` |
| `cli-missing` | ko | exécutable claude introuvable | `panel/panel.js:508` |
| `not-logged-in` | ko | session Claude Code non authentifiée | `panel/panel.js:509` |
| `probe-failed` | unknown | état indéterminé | `panel/panel.js:510` |
| `ollama-unreachable` | ko | Ollama ne répond pas | `panel/panel.js:511` |
| `model-missing` | ko | modèle configuré absent d'Ollama | `panel/panel.js:512` |
| `no-model-installed` | ko | aucun modèle installé dans Ollama | `panel/panel.js:513` |
| code inconnu | ok / autre | prêt / état inconnu | `panel/panel.js:519` |

Les codes et leur sens sont fixés par `docs/PROTOCOL.md:969-975`. Aujourd'hui, `ok`, `ko` et
`unknown` ne se distinguent que par le texte : aucune couleur, aucune icône propre.

## 4. Parcours

1. **Première utilisation, Chromium.** Installer l'extension, cliquer l'icône : le panneau s'ouvre
   (`background/service-worker.js:82`). Le service worker se connecte sans secret ; si l'ID est
   connu du broker, le jeton arrive seul et l'état passe à « Connecté »
   (`background/service-worker.js:258-266`, `:381-384`). Sinon, bandeau « L'identifiant de cette
   extension (…) n'est pas connu du broker » : le remède est côté broker, sans lien
   (`panel/panel.js:453-458`). Aucun écran d'accueil.
2. **Première utilisation, Firefox.** Clic sur l'icône, état « Pas de jeton — voir réglages » et
   bandeau avec « Ouvrir /pair » (`panel/panel.js:446-451`). L'onglet `/pair` affiche le secret
   (`broker/src/pair.ts:98-103`). L'utilisateur le copie à la main, ouvre les réglages par ⚙,
   colle dans « Jeton de pairage » : le collage s'applique seul, sans clic sur « Enregistrer »
   (`options.js:67-69`), le champ se vide (`options.js:111`), la reconnexion est immédiate
   (`background/service-worker.js:339-352`). Aucun message de réussite dans la page d'options
   autre que la ligne d'état qui passe à « Connecté ».
3. **Résumer la page courante.** Clic sur le bouton principal (`panel/panel.js:182`). Libellé selon
   le type détecté : « Résumer cette page », « Résumer cet article », « Résumer cette vidéo », ou
   « Résumer » si inconnu (`panel/panel.js:83-87`, `:800`). Lecture de la page
   (`panel/panel.js:941-966`), bulle utilisateur « <libellé> : <titre de la page> »
   (`panel/panel.js:1011-1012`), bulle de réponse qui se remplit au fil de l'eau avec un curseur
   clignotant (`panel/panel.js:1018`, `panel/panel.css:226-229`). Moins de 40 caractères lisibles :
   message d'échec, pas de requête (`panel/panel.js:994-1002`).
4. **Résumer une vidéo YouTube.** Même bouton, libellé « Résumer cette vidéo ». Si la transcription
   n'est pas chargée, le panneau clique une fois sur « Afficher la transcription » de YouTube et
   attend jusqu'à 15 s (`panel/panel.js:974-977`, `:1089-1118`) : aucun indicateur n'est affiché
   pendant cette attente, seuls les boutons sont désactivés. Échec : message explicatif, pas de
   requête (`panel/panel.js:979-992`). Réussite : les horodatages `[m:ss]` de la réponse deviennent
   cliquables et font sauter la vidéo (`panel/panel.js:1240`, `:1252-1301`).
5. **Discuter.** Saisir dans le champ, Entrée ou « Envoyer » (`panel/panel.js:184`, `:193-198`). Si
   « Wingpen lit cette page » est cochée, la page est lue à l'envoi et la bulle utilisateur porte
   la mention en italique « avec le contenu de la page » (`panel/panel.js:530-564`). Une invite de
   la bibliothèque peut pré-remplir le champ (`panel/panel.js:1188-1196`) ; « 💾 » enregistre le
   texte saisi sous un nom demandé par une boîte native (`panel/panel.js:1198-1209`).
6. **Agir sur une sélection.** Sélectionner du texte, clic droit, « Wingpen » → action
   (`background/service-worker.js:88-95`). Le panneau s'ouvre, reprend la demande
   (`panel/panel.js:1127-1133`) et affiche « <Action> : « <extrait tronqué à 220 caractères> » »
   (`panel/panel.js:1144`, `:1158-1161`). Si une requête est déjà en cours, message d'attente et
   rien n'est envoyé (`panel/panel.js:1138-1141`).
7. **Accorder une permission d'hôte quand la page n'est pas lisible.** Une lecture refusée fait
   apparaître le lien « Activer Wingpen sur ce site », avec l'origine en infobulle
   (`panel/panel.js:812-815`, `:945-952`), et un message dans le fil. Clic : boîte de permission du
   navigateur (`panel/panel.js:919-926`) ; accordée, le lien disparaît et la page est relue. Refus :
   rien ne change, aucun message. Variante sans origine lisible : message renvoyant à l'icône de la
   barre d'outils (`panel/panel.js:953-960`). Les sites autorisés se gèrent aussi dans les options,
   avec YouTube proposé d'office (`options.js:15`, `:377-418`).
8. **Annuler une requête.** « Annuler » n'est visible que pendant une requête
   (`panel/panel.js:733`). Clic : la bulle s'arrête, « Requête annulée. » si elle était vide
   (`panel/panel.js:585-601`). « Effacer la conversation » annule aussi la requête en cours
   (`panel/panel.js:635`).
9. **Page de type liste / fiche / article.** Le protocole définit `pageKind` (`list`, `listing`,
   `article`, `other`) et une consigne de résumé par type (`docs/PROTOCOL.md:474-487`,
   `:796-822`). La logique de détection existe (`content/detect.js:226-263`) mais n'est branchée ni
   dans l'extraction ni dans le panneau : le bouton n'a pas de libellé pour une liste ou une fiche
   (`panel/panel.js:83-87`). En attente du lot L6 ; voir section 9.

## 5. Messages à l'utilisateur

Textes exacts, tels qu'écrits dans le code. `<…>` marque une partie variable. Le préfixe « ⚠ »
fait partie du texte là où il figure.

### 5.1 Panneau — libellés fixes

| Texte | Où | Déclencheur | Source |
|---|---|---|---|
| Wingpen | titre du document | toujours | `panel/panel.html:6` |
| Wingpen | nom dans la barre du haut | toujours | `panel/panel.html:12` |
| … | ligne d'état | avant tout état connu, et état `unknown` | `panel/panel.html:15`, `panel/panel.js:430` |
| ⚙ (infobulle « Réglages ») | bouton de la barre du haut | toujours | `panel/panel.html:18` |
| Ouvrir /pair | bouton du bandeau | `no-token` sous Firefox | `panel/panel.html:23`, `panel/panel.js:451` |
| Résumer | bouton principal | type de page inconnu | `panel/panel.html:27`, `panel/panel.js:800` |
| Résumer cette vidéo | bouton principal | type `video` | `panel/panel.js:84` |
| Résumer cet article | bouton principal | type `article` | `panel/panel.js:85` |
| Résumer cette page | bouton principal | type `page` | `panel/panel.js:86` |
| Activer Wingpen sur ce site (infobulle : l'origine, ex. `https://exemple.fr`) | lien sous la barre d'outils | lecture refusée faute de permission | `panel/panel.html:28`, `panel/panel.js:812-815` |
| Bibliothèque de prompts… | première option du sélecteur | au moins une invite enregistrée, ou avant réponse du broker | `panel/panel.html:30`, `panel/panel.js:1177` |
| Bibliothèque de prompts vide | première option du sélecteur | le broker renvoie une liste vide | `panel/panel.js:1177` |
| <nom de l'invite> | options du sélecteur | une par invite enregistrée | `panel/panel.js:1180-1185` |
| 💾 (infobulle « Enregistrer le texte saisi comme prompt ») | bouton de la barre d'outils | toujours | `panel/panel.html:32` |
| Nom de ce prompt ? | boîte native `window.prompt` | clic sur 💾 avec un texte saisi | `panel/panel.js:1201` |
| Wingpen lit cette page | case à cocher de la zone de saisie | toujours | `panel/panel.html:40` |
| Écrivez à Wingpen… | texte indicatif du champ | champ vide | `panel/panel.html:42` |
| Effacer la conversation | lien de la zone de saisie | état normal | `panel/panel.html:44`, `panel/panel.js:628` |
| Confirmer l'effacement ? | même lien | premier clic, pendant 4 s | `panel/panel.js:615-617` |
| Annuler | bouton de la zone de saisie | requête en cours | `panel/panel.html:45` |
| Envoyer | bouton de la zone de saisie | toujours | `panel/panel.html:46` |
| v<version> · <empreinte à 7 caractères> | ligne de version, en bas | toujours | `panel/panel.js:247` |
| v<version> · empreinte indisponible | ligne de version | calcul de l'empreinte en échec | `panel/panel.js:247` |
| ▍ | fin de la bulle de réponse | réponse en cours de réception | `panel/panel.css:227` |

### 5.2 Panneau — ligne d'état et bandeau

| Texte | Où | Déclencheur | Source |
|---|---|---|---|
| Connecté | ligne d'état | `connected` | `panel/panel.js:425` |
| Connexion… | ligne d'état | `connecting`, `handshaking` | `panel/panel.js:426-427` |
| Déconnecté | ligne d'état | `disconnected` | `panel/panel.js:428` |
| Pas de jeton — voir réglages | ligne d'état | `no-token` | `panel/panel.js:429` |
| handshake-timeout | ligne d'état (code brut) | poignée de main sans réponse en 2,5 s | `background/service-worker.js:283`, `panel/panel.js:432` |
| Connecté · <fournisseur> : <raison> | ligne d'état | réponse `provider.status-result` (tables de la section 3) | `panel/panel.js:433`, `:520` |
| Wingpen n'est pas encore appairé à ce broker. Ouvrez la page /pair pour copier le code, puis collez-le dans les réglages de l'extension (icône ⚙). | bandeau | `no-token`, Firefox | `panel/panel.js:449-450` |
| L'identifiant de cette extension (<id de l'extension>) n'est pas connu du broker. Ajoutez-le à allowedExtensionIds puis redémarrez le broker. | bandeau | `no-token`, Chromium | `panel/panel.js:456-457` |
| Le broker Wingpen ne répond pas. Lancez-le sur votre machine (voir le README), puis réessayez. | bandeau | `disconnected` | `panel/panel.js:464-465` |

### 5.3 Panneau — messages dans le fil

Les messages « système » s'affichent centrés, en rouge, en petit corps (`panel/panel.css:203-208`).
Ceux qui terminent une requête remplacent le contenu de la bulle de réponse si elle était vide
(`panel/panel.js:335-343`, `:784-795`).

| Texte | Déclencheur | Source |
|---|---|---|
| ⚠ Aucun onglet actif à lire. | clic sur le bouton principal sans onglet actif | `panel/panel.js:936` |
| ⚠ Wingpen n'a pas encore accès à cette page. Cliquez sur « Activer Wingpen sur ce site » ci-dessus. | résumé refusé, origine connue | `panel/panel.js:951` |
| ⚠ Wingpen n'a pas accès à cette page. Cliquez sur l'icône Wingpen dans la barre d'outils pour l'autoriser sur cet onglet. | résumé refusé, origine illisible | `panel/panel.js:959` |
| ⚠ Impossible de lire la page : <message du navigateur> | autre échec de lecture au résumé ; le message peut être « extraction vide » ou un texte anglais du navigateur | `panel/panel.js:962`, `:1080` |
| La transcription n'a pas pu être lue. Sous la vidéo : « … » → « Afficher la transcription », puis relancez le résumé. Si le bouton est absent, la vidéo n'a pas de sous-titres. | vidéo YouTube sans transcription lisible | `panel/panel.js:987-988` |
| ⚠ Rien de lisible n'a été trouvé sur cette page. Contenu chargé après coup, ou réservé aux abonnés ? | moins de 40 caractères extraits | `panel/panel.js:998` |
| ⚠ Wingpen n'a pas accès à cette page, la question n'a pas été envoyée. Cliquez sur « Activer Wingpen sur ce site » ci-dessus, ou décochez « Wingpen lit cette page » pour poser une question générale. | envoi avec la case cochée, lecture refusée, origine connue | `panel/panel.js:544` |
| ⚠ Wingpen n'a pas accès à cette page, la question n'a pas été envoyée. Cliquez sur l'icône Wingpen dans la barre d'outils pour l'autoriser sur cet onglet. | même cas, origine illisible | `panel/panel.js:550` |
| ⚠ Lecture de la page impossible, la question n'a pas été envoyée : <message du navigateur> | autre échec de lecture à l'envoi | `panel/panel.js:556` |
| ⚠ Une requête est déjà en cours ; réessayez ensuite. | action du menu contextuel pendant une requête | `panel/panel.js:1139` |
| ⚠ Le message envoyé dépassait la taille maximale acceptée par le broker (256 Ko) ; la connexion a été fermée. Réessayez avec un contenu plus court. | erreur `oversized` du broker | `panel/panel.js:375` |
| ⚠ Le modèle ne répond pas (<message du broker, ou « indisponible »>). Le broker fonctionne normalement ; c'est le modèle qui pose problème. Réessayez dans un instant. | erreur `model-unavailable` | `panel/panel.js:382` |
| ⚠ La session Claude a expiré. | erreur `auth-required`, suivie du bloc de reprise | `panel/panel.js:387` |
| Requête annulée. | erreur `cancelled`, ou clic sur « Annuler » avant tout texte | `panel/panel.js:389`, `:596` |
| ⚠ Le contenu envoyé est trop volumineux pour le modèle. | erreur `context-too-large` | `panel/panel.js:391` |
| ⚠ Requête invalide : <message du broker, en anglais>. | erreur `bad-request` (ex. « too many concurrent requests (max 3 per connection) ») | `panel/panel.js:393`, `broker/src/server.ts:466` |
| ⚠ <message du broker, ou code> | tout autre code, dont `internal` | `panel/panel.js:395` |
| ⚠ Une nouvelle requête a pris la priorité ; celle-ci a été abandonnée. | deux requêtes pendant une coupure (via le cas précédent) | `background/service-worker.js:415` |
| ⚠ Le broker ne répond pas depuis 15 s. Vérifiez qu'il tourne sur cette machine, puis réessayez. | requête retenue 15 s sans connexion (via le même cas) | `background/service-worker.js:421` |
| ⚠ La requête a été interrompue (le service en arrière-plan a redémarré), relancez-la. | le service worker a changé pendant la requête | `panel/panel.js:775`, `:788` |
| ⚠ Aucune réponse après 130 s. Le broker ne répond pas ; vérifiez qu'il tourne, puis réessayez. | délai client dépassé | `panel/panel.js:781`, `:788` |

### 5.4 Panneau — bulles utilisateur et bloc de reprise

| Texte | Déclencheur | Source |
|---|---|---|
| <libellé du bouton> : <titre de la page, ou « cette page »> | résumé lancé | `panel/panel.js:1011-1012` |
| <texte saisi> puis, sur une ligne séparée, *avec le contenu de la page* (en italique) | message envoyé avec la page | `panel/panel.js:564-565` |
| <Reformuler / Raccourcir / Expliquer / Traduire> : « <sélection, 220 caractères au plus, puis …> » | action du menu contextuel | `panel/panel.js:1144`, `:1158-1161` |
| claude /login | bloc de reprise, en police de code | `panel/panel.js:665` |
| Copier | bouton du bloc de reprise | `panel/panel.js:669` |
| Copié ! | même bouton, 1,5 s | `panel/panel.js:695`, `:699-701` |
| Échec de la copie | même bouton, 1,5 s | `panel/panel.js:697` |
| J'ai relancé, réessayer | bouton du bloc de reprise, tant que la requête peut être rejouée | `panel/panel.js:678-686` |
| Aller à cet instant de la vidéo | infobulle d'un horodatage cliquable | `panel/panel.js:1272` |

### 5.5 Page d'options

| Texte | Où | Déclencheur | Source |
|---|---|---|---|
| Réglages — Wingpen | titre de l'onglet | toujours | `options.html:5` |
| Réglages Wingpen | titre de section | toujours | `options.html:9` |
| Sous Chromium/Brave, rien à coller ici : l'extension s'appaire seule avec le broker. Sous Firefox, collez ici le secret affiché par `http://127.0.0.1:8787/pair` — un geste à faire une seule fois par installation. Le jeton n'est jamais écrit sur le disque par l'extension : il reste en mémoire vive et disparaît à la fermeture du navigateur. | aide | toujours | `options.html:10-17` |
| Jeton de pairage | libellé de champ | toujours | `options.html:20` |
| … | texte indicatif du champ jeton | champ vide | `options.html:21` |
| Enregistrer | bouton du jeton | toujours | `options.html:25` |
| Connecté / Connexion… / Déconnecté / Pas de jeton / … | ligne d'état | selon l'état ; tout autre code affiché brut | `options.js:122-130` |
| Modèle | titre de section | toujours | `options.html:32` |
| Wingpen ne revend jamais d'accès à un modèle : choisissez celui qui traite vos demandes — votre propre clé Anthropic, un modèle Ollama local, ou votre installation Claude Code. Ce réglage vit dans le broker ; changer de fournisseur ici s'applique à la prochaine requête. | aide | toujours | `options.html:33-38` |
| Broker non connecté — impossible d'afficher ou de changer le fournisseur de modèle. | section Modèle | tout état autre que `connected` | `options.html:40-42`, `options.js:132-136` |
| <libellé du fournisseur, fourni par le broker> : Claude (clé API) / Claude (CLI locale) / Ollama (local) | bouton radio | réponse `settings` | `options.js:233`, `broker/src/providers/claude-api.ts:258`, `claude-cli.ts:431`, `ollama.ts:258` |
| Votre propre clé Anthropic, facturée sur votre compte. | description | fournisseur `claude-api` | `options.js:36` |
| Un modèle qui tourne sur votre machine : rien n'en sort. | description | fournisseur `ollama` | `options.js:37` |
| Votre installation Claude Code locale — chemin réservé aux profils techniques. | description | fournisseur `claude-cli` | `options.js:38` |
| clé enregistrée | marque | `claude-api` configuré | `options.js:247` |
| configuré | marque | autre fournisseur configuré | `options.js:247` |
| — indisponible : <raison du broker, en anglais> | après le fournisseur | fournisseur indisponible (ex. « claude CLI not found on PATH (set WINGPEN_CLAUDE_PATH to override) », « Ollama unreachable at <url> ») | `options.js:251-256`, `broker/src/providers/claude-cli.ts:301`, `ollama.ts:73`, `:77`, `claude-api.ts:56` |
| Clé API Anthropic (sk-ant-…) | texte indicatif | champ de clé, sous `claude-api` | `options.js:281` |
| Enregistrer | bouton de la clé | sous `claude-api` | `options.js:285` |
| Effacer la clé | bouton de la clé | sous `claude-api` | `options.js:296` |
| Tester la connexion | bouton | un par fournisseur | `options.js:317`, `:192` |
| Test en cours… | même bouton | test en cours | `options.js:174` |
| <message du broker> / OK / Échec | résultat du test | réponse `settings.test-result` ; messages français possibles : « Fournisseur inconnu. », « Aucune clé API configurée — ajoutez-la dans les réglages. », « Aucun modèle Ollama configuré — choisissez-en un dans les réglages. » | `options.js:196`, `broker/src/server.ts:396-402` |
| Modèle | libellé de champ | réponse `settings` reçue | `options.html:45` |
| Choisir un modèle… | première option du sélecteur | le broker fournit une liste de modèles | `options.js:341` |
| ex : llama3.2 ou claude-sonnet-4-5 (optionnel) | texte indicatif du champ libre | pas de liste de modèles | `options.html:47` |
| Enregistrer le modèle | bouton | pas de liste de modèles | `options.html:48` |
| Conservation de l'historique | titre de section | toujours | `options.html:52` |
| La conversation (y compris les extraits de pages qu'elle contient) est stockée non chiffrée sur le disque de cet ordinateur. Ce réglage détermine combien de temps elle y reste avant d'être effacée automatiquement. | aide | toujours | `options.html:53-57` |
| Conserver l'historique pendant | libellé | toujours | `options.html:60` |
| 7 jours / 30 jours / 90 jours / Jamais (aucune expiration automatique) | options du sélecteur (30 par défaut) | toujours | `options.html:62-65`, `options.js:9` |
| Sites où Wingpen se reconnaît tout seul | titre de section | toujours | `options.html:69` |
| Sans cette autorisation, Chrome cache à l'extension quel site est ouvert dans l'onglet, donc le bouton principal reste générique tant que vous n'avez pas cliqué dessus. | aide | toujours (dit « Chrome » aussi sous Firefox) | `options.html:70-74` |
| <nom d'hôte> (ex. www.youtube.com) | case à cocher par site | YouTube proposé d'office, plus chaque site accordé | `options.js:15`, `:396` |

### 5.6 Hors panneau

| Texte | Où | Source |
|---|---|---|
| Wingpen | parent du menu contextuel | `background/service-worker.js:90` |
| Reformuler / Raccourcir / Expliquer / Traduire | entrées du menu contextuel | `background/service-worker.js:58-61` |
| Wingpen | infobulle de l'icône | `manifest.json:35` |
| Assistant IA local : résumer une page ou une vidéo, discuter avec un modèle, agir sur une sélection, via un broker qui tourne sur votre machine. | description (gestionnaire d'extensions) | `manifest.json:5` |
| Connecter Wingpen (Firefox) | titre de l'onglet `/pair` | `broker/src/pair.ts:61` |
| Connecter Wingpen — Firefox | titre de `/pair` | `broker/src/pair.ts:91` |
| Cette page ne sert qu'à épingler une extension Wingpen pour Firefox sur le broker qui tourne sur cette machine (127.0.0.1:<port>). Sous Chromium, cette page n'est pas nécessaire : l'extension s'appaire seule. | `/pair` | `broker/src/pair.ts:93-95` |
| Secret permanent | sous-titre de `/pair` | `broker/src/pair.ts:98` |
| Copiez ce secret, puis collez-le dans les options de l'extension Wingpen (Firefox) pour l'épingler. Ce geste n'est nécessaire qu'une fois par installation. | `/pair` | `broker/src/pair.ts:100-101` |
| Extensions Firefox épinglées | sous-titre de `/pair` | `broker/src/pair.ts:105` |
| Liste en lecture seule. Pour révoquer un épinglage, supprimez sa ligne dans <chemin du fichier> à la main. | `/pair` | `broker/src/pair.ts:107-108` |
| uuid / épinglé le / vu le | en-têtes du tableau de `/pair` | `broker/src/pair.ts:111` |
| Aucune extension Firefox épinglée pour l'instant. | tableau vide de `/pair` | `broker/src/pair.ts:54` |

## 6. Actions

### 6.1 Panneau

| Élément | Effet | Désactivé / masqué quand | Source |
|---|---|---|---|
| ⚙ Réglages | ouvre la page d'options dans un onglet | jamais | `panel/panel.js:180` |
| Ouvrir /pair | ouvre `http://127.0.0.1:8787/pair` dans un onglet | masqué sauf `no-token` sous Firefox | `panel/panel.js:181`, `:446-461` |
| Bouton principal (Résumer…) | lit la page et lance un résumé de longueur moyenne | désactivé pendant une requête | `panel/panel.js:182`, `:732`, `:1024` |
| Activer Wingpen sur ce site | demande la permission d'hôte pour l'origine, puis relit la page | masqué tant qu'aucune lecture n'a été refusée ; masqué dès qu'une page est lue | `panel/panel.js:183`, `:812-820`, `:919-926` |
| Bibliothèque de prompts (sélecteur) | copie le corps de l'invite dans le champ et y place le curseur ; le sélecteur revient à son premier choix | jamais désactivé ; vide hors connexion | `panel/panel.js:186`, `:1188-1196` |
| 💾 | demande un nom, enregistre le texte saisi comme invite | sans effet si le champ est vide ou si le nom est vide | `panel/panel.js:187`, `:1198-1209` |
| Case « Wingpen lit cette page » | à l'envoi, joint le contenu de la page ; le choix est mémorisé | désactivée sans onglet actif ; cochée par défaut | `panel/panel.js:189-192`, `:803-810` |
| Champ de saisie | Entrée envoie, Maj+Entrée va à la ligne | jamais désactivé ; Entrée sans effet pendant une requête ou champ vide | `panel/panel.js:193-198`, `:527` |
| Envoyer | envoie le message | désactivé pendant une requête ; sans effet si le champ est vide | `panel/panel.js:184`, `:731` |
| Annuler | arrête la requête en cours | visible seulement pendant une requête | `panel/panel.js:185`, `:733` |
| Effacer la conversation | premier clic : demande confirmation 4 s ; second clic : annule la requête et vide tout l'historique | jamais | `panel/panel.js:188`, `:612-644` |
| Copier (bloc de reprise) | copie `claude /login` | jamais | `panel/panel.js:670`, `:691-702` |
| J'ai relancé, réessayer | rejoue la requête échouée sous le même identifiant | désactivé si une autre requête est en cours ; absent après rechargement du panneau | `panel/panel.js:678-686`, `:710-728` |
| Horodatage `[m:ss]` | fait sauter la vidéo de l'onglet actif à cet instant | sans effet si l'onglet actif n'est pas la même vidéo | `panel/panel.js:1268-1274`, `:1285-1301` |

Aucun raccourci clavier global n'est déclaré (pas de clé `commands` dans les manifestes). Seuls les
horodatages ont un style de focus propre (`panel/panel.css:221-224`) ; les autres éléments gardent
le focus par défaut du navigateur.

### 6.2 Page d'options

| Élément | Effet | Désactivé / masqué quand | Source |
|---|---|---|---|
| Champ « Jeton de pairage » | un collage s'applique seul ; le champ est en écriture seule et se vide après usage | jamais | `options.js:67-69`, `:107-112` |
| Enregistrer (jeton) | applique le contenu du champ ; un champ vide efface le jeton en mémoire | jamais | `options.js:62`, `background/service-worker.js:228-233` |
| Bouton radio d'un fournisseur | change le fournisseur actif dans le broker | désactivé si le broker le déclare indisponible | `options.js:222-230` |
| Champ de clé API + Enregistrer | transmet la clé au broker, vide le champ | sans effet si le champ est vide | `options.js:278-291` |
| Effacer la clé | efface la clé côté broker, sans confirmation | jamais | `options.js:293-300` |
| Tester la connexion | fait un vrai essai du fournisseur | désactivé pendant le test | `options.js:168-199`, `:310-328` |
| Sélecteur de modèle | change le modèle aussitôt | masqué si le broker ne fournit pas de liste | `options.js:71`, `:333-349` |
| Champ de modèle + Enregistrer le modèle | enregistre le nom saisi | masqués si une liste existe | `options.js:72`, `:350-355` |
| Sélecteur de conservation | enregistré aussitôt, appliqué à la prochaine ouverture du panneau | jamais | `options.js:70`, `:114-118`, `panel/panel.js:1328-1344` |
| Case d'un site | accorde ou retire la permission d'hôte ; relue ensuite depuis le navigateur | désactivée pendant la demande | `options.js:405-418` |

### 6.3 Ailleurs

- Clic sur l'icône de la barre d'outils : ouvre le panneau (section 2.1).
- Menu contextuel sur une sélection : ouvre le panneau et lance l'action (section 2.4).

## 7. Contenu variable

- **Rendu des réponses.** Le texte est échappé, puis trois marques seulement sont rendues :
  `` `code` ``, `**gras**`, `*italique*`, chacune sur une seule ligne (`panel/panel.js:1308-1315`).
  Tout le reste reste littéral : titres `#`, listes `-` ou `1.`, liens, tableaux, blocs de code
  sur plusieurs lignes. Les sauts de ligne sont conservés (`white-space: pre-wrap`,
  `panel/panel.css:189`). La maquette doit donc prévoir des tirets et des dièses visibles tant que
  le rendu n'évolue pas.
- **Bulles.** Utilisateur alignée à droite, réponse à gauche, système centrée ; 92 % de la largeur
  au plus (`panel/panel.css:184-208`).
- **Réponse en cours.** La bulle grandit à chaque fragment, suivie du curseur « ▍ »
  (`panel/panel.css:226-229`). Le fil défile vers le bas à chaque fragment, même si
  l'utilisateur est remonté (`panel/panel.js:1242`).
- **Horodatages.** Dans un résumé de vidéo YouTube seulement, `[m:ss]`, `[mm:ss]` et `[h:mm:ss]`
  deviennent des boutons soulignés dans le texte (`panel/timestamps.js:10-14`,
  `panel/panel.js:1237-1240`) ; ailleurs, ils restent du texte.
- **Bloc de reprise** sous une réponse en `auth-required` : commande `claude /login`, « Copier »,
  et éventuellement « J'ai relancé, réessayer » (`panel/panel.js:658-689`).
- **Structure imposée au modèle selon le type de page** (quand les types seront branchés) : pour
  une liste, fourchette de prix, répartition, entrées remarquables, « N annonces lues sur cette
  page », ligne finale « À retenir : » ; pour une fiche, trois temps (faits, points à vérifier,
  ce qu'en dit l'annonce) et ligne finale « Ce que l'annonce ne dit pas : »
  (`docs/PROTOCOL.md:796-819`). Ce sont des lignes de texte, sans rendu dédié.
- **Extrêmes de longueur à tenir :**
  - une réponse d'une ligne, ou un message système d'un mot (« Requête annulée. ») ;
  - une réponse de 60 lignes : seul le fil défile, la barre du haut et la zone de saisie restent
    en place (`panel/panel.html:35`, `panel/panel.css:5-17`) ;
  - une URL longue sans espace : coupée n'importe où (`word-break: break-word`,
    `panel/panel.css:190`) ;
  - un titre de page très long dans la bulle « Résumer cet article : <titre> », jamais tronqué
    (`panel/panel.js:1011-1012`) ;
  - une sélection de 220 caractères plus « … » (`panel/panel.js:1158-1161`) ;
  - les messages système les plus longs (bandeau Chromium avec un identifiant de 32 lettres,
    message `oversized`, transcription YouTube), en largeur minimale ;
  - la ligne d'état la plus longue : « Connecté · Claude (clé API) : clé API enregistrée, non
    vérifiée » ; elle partage la barre du haut avec le nom et ⚙, sans règle de repli ni de
    coupure (`panel/panel.html:10-19`, `panel/panel.css:19-43`) ; le bouton « Ouvrir /pair »,
    lui, ne se replie jamais (`panel/panel.css:79`) ;
  - un fil de 200 messages, plafond de l'historique (`panel/panel.js:70`, `:1215-1217`) ;
  - un fil vide, au premier lancement ou après effacement : rien n'est affiché aujourd'hui
    (`panel/panel.js:639-643`).

## 8. Contraintes pour la maquette

- **Palette Coati** (`docs/design/palette.md:7-17`), point de départ proposé :

  | Rôle | Clair | Sombre |
  |---|---|---|
  | Fond | `#F7F0E6` | `#1E1712` |
  | Surface (cartes, champ de saisie) | `#EFE3D3` | `#2A2019` |
  | Texte | `#3A2A1F` | `#F4EADF` |
  | Texte secondaire | `#6B5646` | `#C9B6A3` |
  | Roux (accent, bouton principal) | `#A4502A` | `#E0894F` |
  | Libellé sur le bouton | `#FFFFFF` | `#1E1712` |
  | Erreur | `#B3261E` | `#F2B8B5` |

- **Accessibilité déjà décidée.** Contraste AA (4,5:1) pour tout texte courant, vérifié pour les
  paires de la palette (`docs/design/palette.md:19-29`). Une erreur se signale par une icône et un
  texte, jamais par la couleur seule, d'autant que le roux et le rouge d'erreur ne contrastent qu'à
  1,2:1 (`docs/design/palette.md:35-37`). Le roux est réservé aux éléments d'action : bouton
  principal, lien, focus (`docs/design/palette.md:38-39`). Aujourd'hui les points d'état vert,
  orange et rouge portent seuls une information de couleur ; leur texte l'accompagne.
- **Variante sombre obligatoire**, suivant `prefers-color-scheme` (`docs/design/palette.md:33-34`).
- **Icônes.** 16, 32, 48, 128 px (`manifest.json:28-33`). Le 16 px est un dessin à part, pas une
  réduction ; deux signes ne cohabitent pas à cette taille (`JOURNAL.md:321-323`, `:345-346`).
  Lisible sur barre claire et sombre. Les icônes actuelles sont celles de Wingpen (ailes et
  stylo, `docs/logo/`), à redessiner pour Coati.
- **Techniques.** Pas de framework ni de bundler : ce qui est dessiné doit se construire en HTML et
  CSS simples (`CLAUDE.md`, « Ce qui n'existe pas encore »). Pas de police distante, pas d'image
  distante (CSP, `manifest.json:15`). Police système aujourd'hui (`panel/panel.css:8`).
- **Règle du geste.** Aucun élément ne peut agir de lui-même sur une page : pas de résumé
  automatique à l'ouverture d'un onglet, pas d'indicateur qui suppose une lecture en arrière-plan
  (`CLAUDE.md`, règle 5 ; `docs/PERIMETRE.md:30-54`).
- **À décider dans Penpot par Romain :**
  1. largeur de référence et comportement entre la largeur minimale et une largeur confortable ;
  2. place et forme de la ligne d'état, et distinction visuelle de `ok` / `ko` / `unknown` du
     fournisseur (aujourd'hui texte seul) ;
  3. forme des bandeaux de connexion, et icône d'erreur qui double la couleur ;
  4. hiérarchie de la barre d'outils : bouton principal, lien d'activation, bibliothèque,
     enregistrement d'invite ;
  5. forme des trois bulles (utilisateur, réponse, système) et du curseur de réponse ;
  6. état de la bulle pendant l'attente de la transcription YouTube (aucun indicateur aujourd'hui) ;
  7. forme des horodatages cliquables et du bloc de reprise ;
  8. état vide du fil ;
  9. confirmation d'effacement en deux temps ;
  10. affichage de la ligne de version (outil de développement, gardé ou non) ;
  11. mise en page de la page d'options, et de `/pair` si elle doit suivre la palette ;
  12. icône Coati en 16 px et en grand, clair et sombre ;
  13. glyphes ⚙ et 💾, aujourd'hui caractères Unicode (`panel/panel.html:18`, `:32`) ;
  14. rendu Firefox : la barre latérale a son propre en-tête au-dessus du panneau.

## 9. Ce qui n'existe pas encore

- **Écran d'accueil et guide.** Prévus : un accueil qui montre Wingpen sur une page réelle avant
  de demander une clé, deux chemins d'entrée (clé API ou serveur local détecté), et un guide de
  trois images dans le panneau (`docs/etudes/faisabilite.md:255-260`, `:346`). Rien de construit.
- **Choix du fournisseur à la première ouverture.** Aujourd'hui seulement dans la page d'options
  (`options.html:32-48`) ; aucune détection d'Ollama côté panneau.
- **Libellés pour une liste et une fiche.** `pageKind` est spécifié (`docs/PROTOCOL.md:474-487`),
  la détection écrite (`content/detect.js:226-263`), mais ni l'extraction ni le panneau ne s'en
  servent (`panel/panel.js:83-87`). Lecture prudente : prévoir « Résumer cette liste » et « Résumer
  cette annonce » comme libellés possibles, à confirmer avec le lot L6.
- **Longueur du résumé.** Le protocole connaît `short` et `medium` (`docs/PROTOCOL.md:407`) ; le
  panneau envoie toujours `medium` (`panel/panel.js:1024`), sans réglage.
- **Suppression d'une invite.** Le protocole définit `prompts.delete`
  (`docs/PROTOCOL.md:418`) ; l'interface ne permet que lister et enregistrer.
- **Vérification de la clé API.** Codes `ready`, `key-rejected`, `api-unreachable` prévus sous
  condition (`docs/PROTOCOL.md:977-981`) ; aujourd'hui une clé présente reste « non vérifiée ».
- **Thème sombre, palette Coati, nom Coati, icône Coati** : décidés ou proposés
  (`docs/design/palette.md`, `docs/design/noms.md:171-176`), non appliqués.
- **Variantes d'icône claires** : fichiers présents dans `icons/`, non déclarés dans les manifestes.
- **Libellé de l'état `handshake-timeout`** : absent (section 3).
- **Lien vers `/pair` depuis la page d'options** : le protocole le mentionne
  (`docs/PROTOCOL.md:374`), la page n'en affiche que l'adresse en texte (`options.html:13`).
