# Extensions de navigateur — l'antisèche

Ce que les tutoriels montrent, et ce qu'ils oublient. À relire avant de coder, pas à apprendre par
cœur.

## Le paysage réel

Deux cibles existent. Le reste est du folklore sympathique.

| Navigateur | Extensions | Ce qu'il faut savoir |
|---|---|---|
| **Chrome / Brave / Edge / Vivaldi** | MV3, identiques | Même moteur, même API, même magasin. Tester sur un suffit. |
| **Firefox** | MV3 aussi, mais **pas le même** | API très proche, différences réelles ci-dessous. Magasin séparé (AMO), examen plus rapide et plus humain. |
| **ungoogled-chromium** | Oui, mêmes extensions | Pas de Web Store câblé : l'utilisateur installe un `.crx` à la main. Le code marche, c'est la **distribution** qui change. |
| **GNOME Web (Epiphany)** | Non, en pratique | WebKitGTK a une API WebExtensions expérimentale et très partielle. Pas une cible. |
| **GNU IceCat** | Oui (base Firefox ESR) | Fork militant, très en retard sur les versions. Ce qui marche sur Firefox ESR y marche. |
| **Safari** | Oui, mais | Il faut empaqueter l'extension dans une app Xcode signée, sur un Mac. Autre monde. |

## Chrome vs Firefox, les différences qui coûtent du temps

- **`chrome.*` rend des callbacks, `browser.*` rend des promesses.** Firefox fournit les deux,
  Chrome n'a que `chrome.*` (promisifié depuis MV3 sur la plupart des API). Écrire `chrome.*` avec
  `await` marche des deux côtés aujourd'hui.
- **Le panneau latéral n'est pas le même objet.** Chrome : `chrome.sidePanel`, un panneau par
  fenêtre, `open()` exige un vrai clic. Firefox : `sidebar_action`, déclaré au manifest, ouverture
  libre. **Deux manifests, deux points d'entrée** — c'est la principale fourche pour Wingpen.
- **Firefox garde `webRequest` bloquant**, Chrome l'a supprimé au profit de
  `declarativeNetRequest`. Sans objet pour nous, mais c'est la vraie raison de la guerre des
  bloqueurs de pub.
- **Les permissions d'hôte sont optionnelles par défaut chez Firefox** : accordées à l'install,
  l'utilisateur peut les retirer d'un clic. Prévoir que la permission disparaisse en cours de route.
- **L'identifiant de l'extension.** Chrome dérive l'ID d'une extension non empaquetée **du chemin
  du dossier** : déplace le dossier, l'ID change. Firefox donne un ID aléatoire à chaque chargement
  temporaire. On épingle : champ `key` au manifest (Chrome), `browser_specific_settings.gecko.id`
  (Firefox). *Pour Wingpen c'est critique : le broker autorise l'extension par son ID.*

## Les huit pièges que les tutoriels ne montrent pas

1. **Le service worker meurt.** MV3 n'a plus de page d'arrière-plan permanente : le navigateur tue
   le script après quelques dizaines de secondes d'inactivité. Toute variable globale disparaît
   avec lui. Les tutoriels écrivent `let state = {}` en haut du fichier — c'est faux dès la
   deuxième minute. L'état va dans `chrome.storage`, ou dans un document qui vit (panneau, onglet).
2. **Le content script ne voit pas le JavaScript de la page.** Il vit dans un « monde isolé » :
   même DOM, variables séparées. Impossible de lire une variable de la page, sauf à demander
   `world: "MAIN"` — ce qui supprime l'isolation et ouvre la porte que toute notre architecture
   ferme. À ne jamais faire ici.
3. **Pas de code distant, jamais.** La politique de sécurité MV3 interdit `eval`, les scripts en
   ligne, et tout fichier chargé depuis un CDN. Une bibliothèque tierce doit être **copiée dans le
   dossier de l'extension**. (Plotly.js, par exemple : on vendorise le `.js`, on ne met pas de
   balise `<script src="https://…">`.) Enfreindre ça, c'est le retrait automatique.
4. **`return true` dans `onMessage`.** Si le gestionnaire répond de façon asynchrone et ne retourne
   pas `true`, le canal se ferme avant la réponse et l'appelant ne reçoit rien — sans erreur. Le
   bug silencieux numéro un des extensions.
5. **Les trois stockages ne se valent pas.** `storage.local` : sur disque, **non chiffré**, gros.
   `storage.session` : en mémoire vive, effacé à la fermeture — c'est là que vont les secrets.
   `storage.sync` : synchronisé chez Google, ~100 Ko en tout, 8 Ko par entrée, quota d'écritures
   horaire. On ne stocke pas une conversation dedans.
6. **Les permissions se paient à l'installation.** Demander `<all_urls>` affiche « peut lire et
   modifier toutes vos données sur tous les sites » — beaucoup de gens renoncent là. `activeTab`
   donne l'onglet courant **après un clic**, sans aucun avertissement. C'est autant un enjeu de
   conversion que de sécurité.
7. **Chaque contexte a sa propre console.** Le service worker se débogue depuis
   `chrome://extensions` (lien « service worker »), le content script écrit dans la console **de la
   page**, le panneau et les options ont chacun la leur. Chercher un log au mauvais endroit fait
   perdre des heures.
8. **Recharger ne suffit pas toujours.** Modifier le service worker → recharger l'extension.
   Modifier un content script → recharger l'extension **et** la page. Modifier le manifest →
   recharger, et parfois retirer/réinstaller.

## Les quatre fichiers d'une extension

- `manifest.json` — la déclaration. Tout ce que l'extension a le droit de faire y est écrit ; ce
  qui n'y est pas déclaré n'existe pas.
- Un **script d'arrière-plan** — l'orchestrateur, sans interface, éphémère.
- Un ou plusieurs **content scripts** — le seul code qui touche les pages visitées.
- Des **pages** (popup, options, panneau latéral) — du HTML/CSS/JS ordinaire, dans une fenêtre
  fournie par le navigateur.

Wingpen a exactement ces quatre-là, plus le broker. Le détail est dans `docs/ARCHITECTURE.md`.
