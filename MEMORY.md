# Wingpen — mémoire durable

Réinjecté chaque session. Invariants seulement. L'état daté va dans `JOURNAL.md`.

## Index de référence
- Périmètre d'accès, prouvé ligne à ligne : `docs/PERIMETRE.md`. Installation Firefox + signature AMO : `docs/FIREFOX.md`. Service systemd : `docs/INSTALL.md`.
- Contrat extension ↔ broker : `docs/PROTOCOL.md` (fait autorité).
- Décisions figées + motifs : `docs/DECISIONS.md` (P1-P17, T1-T19, L1-L2, règle du geste + son exception nommée, 9 risques).
- Faisabilité du distribué payant : `docs/etudes/faisabilite.md`. Sept études brutes dans `docs/etudes/`.
- Chaîne d'attaque : `docs/MENACE_chaine_navigateur.md`.
- Appairage, transport et options WebSocket / Native Messaging : `docs/etudes/appairage.md` (25/09). Mesures : `docs/etudes/mesures-transport.md`, banc `bench/transport/`.

## Invariants d'architecture
- L'extension ne détient aucun identifiant de modèle. Tout secret vit dans le broker local.
- Broker : `127.0.0.1` seulement. Admission par `Host` + UID du pair (Linux, `/proc/net/tcp`), puis `Origin` + jeton avant tout traitement. Frontière de menace = le compte utilisateur.
- Transport WebSocket, pas `fetch`. Local Network Access filtre désormais les WebSockets des sites (Chrome 147, Firefox 154), pas encore ceux des extensions, sans garantie. Remède si ça change : Native Messaging.
- Jeton de pairage en `chrome.storage.session`, jamais `local` (non chiffré sur disque).
- Contenu de page = donnée, jamais instruction. Texte assaini, jamais de HTML, jamais d'`innerHTML`.
- Pas de `<all_urls>` : `activeTab` + permissions d'hôte optionnelles.
- **La règle du geste** : Wingpen accompagne un geste, il n'en fabrique jamais. Une seule exception, nommée et bornée : ouvrir la transcription YouTube en réponse au clic « Résumer cette vidéo ». Ne sert pas de précédent.
- **Ne jamais écrire dans le produit qu'on estime quelque chose illégal.** Un aveu livré au client ne protège de rien et fournit la preuve du savoir. Le cadre juridique s'énonce une fois, en termes neutres, dans les CGU et la fiche de boutique ; les messages d'interface restent factuels.
- Le risque réel n'est pas le procès mais le **retrait du Chrome Web Store** : administratif, sans recours, immédiat. On optimise pour l'examinateur, pas pour le tribunal.
- Le SDK Claude Agent ne va jamais dans le binaire distribué (109 Mo + CLI) — `cli.ts` en `await import`.
- Recettes par site : déclaratives, ancrées sur le **texte visible** et non les classes CSS, signées Ed25519, servies par CDN. Jamais de code distant (MV3 = retrait automatique). Une recette qui échoue **dégrade**, elle ne casse pas : le modèle relit une tranche plus large.

## Méthode de travail (figée le 19/09)
- **Le visuel se modélise à la main avant d'être codé.** Maquette Penpot/Figma faite par Romain, puis transmise à Claude qui la reproduit. Faire inventer un dessin détaillé à l'IA coûte cher et rend mal (quinze planches de logo l'ont prouvé).
- **Graphiques : Plotly.js.** Jamais de SVG dessiné à la main par le modèle.
- Dialogue admin ↔ Romain : dans le chat, jamais par le panneau APPROVALS. **Bref et clair** : chaque ligne lue fatigue, ne donner que ce qui sert à décider ou agir. Ambiguïtés levées d'un bloc par un grill (`workflow-grill-me` : questions groupées par message, chacune avec une recommandation), puis le but se déroule d'un bout à l'autre sans checkpoint. Ne demander que les vrais choix (préférence, coût, architecture, irréversible) : une recommandation saine et réversible s'applique, annoncée en une ligne. Travail dense → plan écrit + ligne `/goal` prête à lancer.

## Contraintes économiques figées
- Usage perso : abonnement Claude Max via le CLI local. **Interdit de le revendre** (CGU Anthropic).
- Distribué : **BYOK**, jamais de relais d'inférence. C'est l'argument de vente, pas une contrainte subie.
- Dépôt public AGPL-3.0 ; seul le corpus de recettes est privé. Ce qu'on vend : la fraîcheur des recettes, la commodité, le support — jamais le code.
- Gratuit grand public = acquisition. Premium vertical pro = revenu. Pas de tarif à vie.
- Aucun serveur sauf les licences, et il échoue en laissant passer.
- Encaissement par marchand de référence (Paddle/Lemon Squeezy), jamais Stripe nu — TVA UE.

## Appairage (révisé le 25/09, `docs/etudes/appairage.md`)
- **Identifiant d'extension épinglé** : `hehlgipomfminodhahcjbencblepjhah`, clé dans `extension-key.pem` (gitignoré). Sans épinglage Chrome dérive l'ID du chemin et déplacer le dossier casse le pairage en silence.
- Chromium : appairage silencieux → **jeton de session** frais, en mémoire du broker, perdu à son redémarrage ; l'extension l'efface et retente une seule fois sans secret. Le chemin « un clic » (`externally_connectable`) est **retiré** : un ID inconnu est refusé à l'`Origin` → l'ajouter à `allowedExtensionIds` et redémarrer.
- Firefox : le secret permanent se colle une fois depuis `/pair` (une fois par chargement en extension temporaire), puis l'uuid est épinglé dans `firefox-extension-uuids.txt` (liste, relue à chaud) et les reconnexions sont silencieuses.
- `/pair` : Firefox seulement, servie à une navigation de premier niveau seulement (`Sec-Fetch-*`). Port 8787 figé pour l'extension.
- Risque résiduel assumé : une autre extension Chrome peut forger l'`Origin` via DNR depuis une page (C2) ; seul Native Messaging le ferme. L'étude recommande A (WebSocket durci) pour l'usage perso, B (Native Messaging + relais vers le démon) pour la version distribuée.

## Gotchas mesurés
- **Le CLI Claude annonce l'expiration de session sur `stdout`, pas `stderr`** — or le SDK ne nous transmet que `stderr`. Toute détection basée sur le seul `stderr` classe la panne en « modèle injoignable » et envoie l'utilisateur chercher un bug qui n'existe pas. D'où la sonde de confirmation `claude-cli.ts:probeAuthFailure`.
- **Login Claude et bulle Pyramid** : depuis le 24/09, `claude-iso/.credentials.json` (`~/.local/share/pyramid/instances/<id>/`) est un lien symbolique vers `~/.claude/.credentials.json`, que lit le broker systemd. Avant, un `claude /login` fait dans Pyramid restait invisible du broker (trois reconnexions pour rien le 21/09). Reconnexion sans effet → vérifier que le fichier de la bulle est toujours un lien (`stat -c %N`).
- **Un `pkill` sort avec le code 0** : `Restart=on-failure` ne relève donc jamais le broker. `Restart=always` + `loginctl enable-linger`. Et l'unité *installée* dérive de celle du dépôt — le broker le détecte au démarrage depuis le 21/09.
- **Avant de conclure à une régression, comparer l'empreinte** affichée en bas du panneau à `bash scripts/stamp.sh`. Elles diffèrent = le navigateur tourne sur du code périmé. Deux heures perdues sur ce motif le 20 et le 21/09.
- Éprouver toute la chaîne sans navigateur : `bun scripts/probe-summarize.ts`.
- **Workers Pyramid : bac à sable sans `AF_UNIX` ni réseau de l'hôte.** Brave n'y démarre pas, le vrai broker y est injoignable, `dangerouslyDisableSandbox` est ignoré. Tout essai avec un vrai navigateur Chromium ou le vrai broker se lance depuis le shell admin. Le rôle `security` ne peut pas écrire de fichiers.
- Brave ignore `<user-data-dir>/NativeMessagingHosts/` sous `--user-data-dir` personnalisé : seul `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` compte (mesuré le 25/09).
- Le SDK embarque un CLI Claude cassé (`EEXIST /todos`) : `model.ts:resolveClaudeExecutable` pointe sur le `claude` système, surchargeable par `WINGPEN_CLAUDE_PATH`.
- `chrome.sidePanel` : un panneau par fenêtre, `open()` exige un **vrai** clic (aucun geste simulé n'est accepté, même via CDP), et le panneau ne maintient pas le service worker en vie.
- Extraction : toujours `innerText`, jamais `textContent` — ce dernier n'insère rien entre les blocs et colle les mots sur tout HTML généré sans espaces (React, Medium).
- Transcription YouTube : interroger **les deux** sélecteurs, le déploiement oscille. Le 18/09 seul `transcript-segment-view-model` rendait ; le 20/09 seul `ytd-transcript-segment-renderer` (576 segments). Ne jamais n'en garder qu'un.
- **La transcription YouTube ne se remplit jamais en headless** : le panneau s'ouvre (`engagement-panel-searchable-transcript` EXPANDED) mais reste un squelette vide. Tout essai de ce chemin doit être fenêtré, sinon on conclut à tort à une régression de sélecteur.
- **Chromium expose un global `browser` distinct de `chrome`** (mesuré dans Brave). Le shim naïf `globalThis.browser ?? chrome` bascule donc Chromium sur un objet jamais éprouvé, en silence. Détecter Gecko positivement : `browser.runtime.getBrowserInfo` n'existe que chez Firefox (`extension/lib/browser-compat.js`).
- Tester l'extension sans clic humain : `WINGPEN_DEV=1 ./scripts/smoke.sh` (copie à permissions) puis `bun scripts/extract-probe.js <url> 9333`.
- Icônes d'extension : **PNG obligatoire**, Chrome ne rend pas le SVG déclaré au manifest (Firefox, si). Dessiner l'icône 16 px à part, jamais réduire la grande marque. À 16 px l'antialiasing **aide** — le pixel dur rend les formes illisibles (essayé, rejeté).
- Traitement d'image : redimensionner **en alpha prémultiplié** (PIL ne le fait pas → liseré sur fond sombre). Un fond uni se détoure en propageant la couleur des pixels sûrs vers les bords, pas en divisant par l'alpha (ça clippe en noir). `wingpenEtudeLogo2.png` a un canal alpha : `convert("RGB")` le compose sur du noir.
- Nom **Wingpen conservé** malgré Wandpen (`wandpen.com`, extension Chrome IA rédactionnelle, ~1 000 users, même structure syllabique). Arbitré le 18/09 : différenciation par le logo et le positionnement. Ne pas rouvrir sans élément neuf. TESS/EUIPO restent à vérifier à la main avant tout dépôt.

## Identité visuelle (figée le 19/09)
- **Marque = B3** : stylo plume vertical centré (issu de `wingpenEtudeLogo2.png`, détouré, recoloré) + ailes déployées à bord perdu gauche/droite (issues de `wingpenEtudeLogo.png`, **vectorisées** via potrace → `docs/logo/wings_vec.svg`). Le stylo ne touche ni le haut ni le bas.
- **Palette** : dégradé ailes `#2D5BE8` → `#7C3AED` → `#D211D9`. Corps du stylo `#1E2A4A` sur fond clair, `#F6F7FB` sur fond sombre. Accents (tête, clip, bague, nib) en dégradé vertical bleu→magenta.
- **L'icône 16 px est un dessin distinct**, pas la marque réduite : silhouette simplifiée, même palette. Sources `docs/logo/icon_{light,dark}.svg`. Démonstration du pourquoi : `docs/logo/planche15.png`.
- Livrables : `extension/icons/icon{16,32,48,128}.png` (barre sombre) + `icon-light*.png` (barre claire) ; `docs/logo/png/wingpen-{light,dark}-{128,256,512,1024}.png`.
- Le stylo reste **raster** (source 4000 px, tient jusqu'au 1024). Pas de source vectorielle — le vectoriser demanderait trois tracés séparés (corps / accents / réserves).
- Bascule claire/sombre **pas encore câblée** : Firefox → clé `theme_icons` (attention, `"dark"` y désigne l'icône pour barre **claire**) ; Chrome/Brave → aucun déclaratif, il faut un *offscreen document* qui lit `matchMedia` et fait appeler `chrome.action.setIcon()` (le service worker MV3 n'a pas de `window`).
