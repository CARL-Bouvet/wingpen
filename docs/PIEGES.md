# Pièges mesurés

Chaque entrée a coûté du temps au moins une fois. Toutes sont mesurées ; la date dit quand.
Les quatre qui mordent le plus souvent sont rappelées dans `MEMORY.md`.

## Broker et modèle

- **Avant de conclure à une régression, comparer l'empreinte** affichée en bas du panneau à
  `bash scripts/stamp.sh`. Si elles diffèrent, le navigateur tourne sur du code périmé (deux heures
  perdues sur ce motif les 20 et 21/09).
- Éprouver toute la chaîne sans navigateur : `bun scripts/probe-summarize.ts`. La sonde passe par
  le vrai broker et fait un vrai appel au modèle.
- **Le broker tourne en `ProtectSystem=strict`** : `~/.claude` est en lecture seule pour lui et pour
  le CLI qu'il lance. Ce CLI rafraîchit en mémoire, à chaque appel, un jeton d'accès expiré ; il
  fonctionne tant que le jeton de rafraîchissement de `~/.claude/.credentials.json` reste valide
  (mesuré le 25/09 : jeton d'accès expiré depuis huit heures, sonde au vert).
- Diagnostiquer le modèle sans rien écrire hors du dépôt : relancer le CLI dans le bac à sable exact
  du broker. Sa sortie complète s'affiche, `stdout` compris :
  `systemd-run --user --wait --pipe -p ProtectSystem=strict -p PrivateTmp=true -p "ReadWritePaths=$HOME/.config/wingpen $HOME/.local/share/wingpen" ~/.local/bin/claude -p ok`
- **Session Claude expirée : se reconnecter dans un vrai terminal** (kitty). `claude /login` y écrit
  `~/.claude`, que lit le broker. Dans Pyramid, `claude-iso/.credentials.json` n'est un lien vers
  `~/.claude` que jusqu'à la rotation suivante du jeton : le CLI écrit par `rename`, ce qui remplace
  le lien par un fichier, puis Pyramid réconcilie les deux par date de modification. Un `/login` fait
  dans Pyramid n'atteint donc le broker qu'après cette réconciliation (trois reconnexions pour rien
  le 21/09, lien remplacé constaté le 25/09).
- **Le CLI Claude annonce l'expiration de session sur `stdout`, pas sur `stderr`**, et le SDK ne
  transmet que `stderr`. Une détection fondée sur le seul `stderr` classe la panne en « modèle
  injoignable ». D'où la sonde de confirmation `claude-cli.ts:probeAuthFailure`.
- Le SDK embarque un CLI cassé (`EEXIST /todos`) : `model.ts:resolveClaudeExecutable` pointe sur le
  `claude` système, surchargeable par `WINGPEN_CLAUDE_PATH`.
- **Un `pkill` sort avec le code 0** : `Restart=on-failure` ne relève donc jamais le broker. D'où
  `Restart=always` et `loginctl enable-linger`. L'unité installée peut dériver de celle du dépôt ; le
  broker le signale au démarrage depuis le 21/09, et `scripts/install-service.sh` est idempotent.

## Navigateurs

- **Chromium expose un global `browser` distinct de `chrome`** (mesuré dans Brave). Le shim naïf
  `globalThis.browser ?? chrome` bascule donc Chromium, en silence, sur un objet jamais éprouvé.
  Détecter Gecko positivement : `browser.runtime.getBrowserInfo` n'existe que sous Firefox
  (`extension/lib/browser-compat.js`).
- `chrome.sidePanel` : un panneau par fenêtre ; `open()` exige un vrai clic, aucun geste simulé
  n'est accepté, même par CDP ; le panneau ne maintient pas le service worker en vie.
- Brave ignore `<user-data-dir>/NativeMessagingHosts/` sous un `--user-data-dir` personnalisé : seul
  `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` compte (25/09).
- Tester l'extension sans clic humain : `WINGPEN_DEV=1 ./scripts/smoke.sh` (copie à permissions),
  puis `bun scripts/extract-probe.js <url> 9333`.

## Extraction

- **Une extraction se valide sur une vraie page avant d'être déclarée finie** :
  `scripts/corpus-probe.ts` sur `notes/corpus/urls.txt` (Chromium confiné sous `.tmp/`). Le 25/09,
  64 tests passaient sur un faux DOM trop permissif, et rien n'était détecté sur les vraies pages.
- Toujours `innerText`, jamais `textContent` : ce dernier n'insère rien entre les blocs et colle les
  mots sur tout HTML généré sans espaces (React, Medium).
- Transcription YouTube : interroger **les deux** sélecteurs, le déploiement oscille. Le 18/09 seul
  `transcript-segment-view-model` rendait, le 20/09 seul `ytd-transcript-segment-renderer`.
- **La transcription YouTube ne se remplit jamais en headless** : le panneau s'ouvre mais reste un
  squelette vide. Tout essai de ce chemin se fait fenêtré, sinon on conclut à tort à une régression
  de sélecteur.

## Environnement de dev (Pyramid)

- Les workers n'ont ni `AF_UNIX` ni le réseau de l'hôte : Brave n'y démarre pas, le vrai broker y
  est injoignable, `dangerouslyDisableSandbox` est ignoré. Navigateur réel et vrai broker se
  pilotent depuis le shell admin.
- Les rôles `security` et `research` ne peuvent pas écrire de fichiers : leur faire rendre le texte,
  un `backend` l'écrit.
- Un `rm -rf` passe par la file d'approbation. Sans Romain, il expire.

## Icônes et images

- Icônes d'extension : **PNG obligatoire**, Chrome ne rend pas le SVG déclaré au manifest (Firefox
  le rend). L'icône 16 px est un dessin à part, jamais la grande marque réduite. À 16 px
  l'antialiasing aide ; le pixel dur rend les formes illisibles (essayé, rejeté).
- Bascule claire / sombre de l'icône : sous Firefox, clé `theme_icons` (attention, `"dark"` y
  désigne l'icône pour barre **claire**) ; sous Chrome et Brave, rien de déclaratif, il faut un
  *offscreen document* qui lit `matchMedia` et fait appeler `chrome.action.setIcon()`.
- Redimensionner **en alpha prémultiplié** : PIL ne le fait pas, d'où un liseré sur fond sombre. Un
  fond uni se détoure en propageant la couleur des pixels sûrs vers les bords ; diviser par l'alpha
  clippe en noir. `wingpenEtudeLogo2.png` a un canal alpha : `convert("RGB")` le compose sur du noir.
