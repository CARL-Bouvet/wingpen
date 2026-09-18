# Wingpen — mémoire durable

Réinjecté chaque session. Invariants seulement. L'état daté va dans `JOURNAL.md`.

## Index de référence
- Contrat extension ↔ broker : `docs/PROTOCOL.md` (fait autorité).
- Décisions figées + motifs : `docs/DECISIONS.md` (P1-P17, T1-T19, L1-L2, règle du geste + son exception nommée, 9 risques).
- Faisabilité du distribué payant : `docs/etudes/faisabilite.md`. Sept études brutes dans `docs/etudes/`.
- Chaîne d'attaque : `docs/MENACE_chaine_navigateur.md`.

## Invariants d'architecture
- L'extension ne détient aucun identifiant de modèle. Tout secret vit dans le broker local.
- Broker : `127.0.0.1` seulement, vérifie `Origin` + jeton de pairage avant traitement.
- Transport WebSocket, pas `fetch` — contourne Local Network Access (échappatoire datée, crbug.com/421156866).
- Jeton de pairage en `chrome.storage.session`, jamais `local` (non chiffré sur disque).
- Contenu de page = donnée, jamais instruction. Texte assaini, jamais de HTML, jamais d'`innerHTML`.
- Pas de `<all_urls>` : `activeTab` + permissions d'hôte optionnelles.
- **La règle du geste** : Wingpen accompagne un geste, il n'en fabrique jamais. Une seule exception, nommée et bornée : ouvrir la transcription YouTube en réponse au clic « Résumer cette vidéo ». Ne sert pas de précédent.
- **Ne jamais écrire dans le produit qu'on estime quelque chose illégal.** Un aveu livré au client ne protège de rien et fournit la preuve du savoir. Le cadre juridique s'énonce une fois, en termes neutres, dans les CGU et la fiche de boutique ; les messages d'interface restent factuels.
- Le risque réel n'est pas le procès mais le **retrait du Chrome Web Store** : administratif, sans recours, immédiat. On optimise pour l'examinateur, pas pour le tribunal.
- Le SDK Claude Agent ne va jamais dans le binaire distribué (109 Mo + CLI) — `cli.ts` en `await import`.
- Recettes par site : déclaratives, ancrées sur le **texte visible** et non les classes CSS, signées Ed25519, servies par CDN. Jamais de code distant (MV3 = retrait automatique). Une recette qui échoue **dégrade**, elle ne casse pas : le modèle relit une tranche plus large.

## Contraintes économiques figées
- Usage perso : abonnement Claude Max via le CLI local. **Interdit de le revendre** (CGU Anthropic).
- Distribué : **BYOK**, jamais de relais d'inférence. C'est l'argument de vente, pas une contrainte subie.
- Dépôt public AGPL-3.0 ; seul le corpus de recettes est privé. Ce qu'on vend : la fraîcheur des recettes, la commodité, le support — jamais le code.
- Gratuit grand public = acquisition. Premium vertical pro = revenu. Pas de tarif à vie.
- Aucun serveur sauf les licences, et il échoue en laissant passer.
- Encaissement par marchand de référence (Paddle/Lemon Squeezy), jamais Stripe nu — TVA UE.

## Gotchas mesurés
- Le SDK embarque un CLI Claude cassé (`EEXIST /todos`) : `model.ts:resolveClaudeExecutable` pointe sur le `claude` système, surchargeable par `WINGPEN_CLAUDE_PATH`.
- `chrome.sidePanel` : un panneau par fenêtre, `open()` exige un **vrai** clic (aucun geste simulé n'est accepté, même via CDP), et le panneau ne maintient pas le service worker en vie.
- Extraction : toujours `innerText`, jamais `textContent` — ce dernier n'insère rien entre les blocs et colle les mots sur tout HTML généré sans espaces (React, Medium).
- Transcription YouTube : `transcript-segment-view-model`. L'ancien `ytd-transcript-segment-renderer` ne rend plus rien.
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
