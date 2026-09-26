# Wingpen — mémoire durable

Réinjecté chaque session : invariants seulement, ~30 lignes. L'état daté va dans `JOURNAL.md`, les pièges détaillés dans `docs/PIEGES.md`.

## Index
- Contrat extension ↔ broker : `docs/PROTOCOL.md` (fait autorité). Décisions et motifs : `docs/DECISIONS.md`. Périmètre prouvé ligne à ligne : `docs/PERIMETRE.md`.
- Appairage et transport : `docs/etudes/appairage.md` ; usurpation prouvée : `docs/etudes/preuves-origine.md` ; menace : `docs/MENACE_chaine_navigateur.md` ; distribué payant : `docs/etudes/faisabilite.md`. Firefox et AMO : `docs/FIREFOX.md`. systemd : `docs/INSTALL.md`.
- Nom, palette, inventaire des textes : `docs/design/`. Cours de Romain sur l'architecture : `~/projets/etudes/cours/05-wingpen/`.

## Invariants
- Aucun identifiant de modèle dans l'extension : tout secret vit dans le broker. Broker sur `127.0.0.1:8787` (port figé) : `Host` + UID du pair (`/proc/net/tcp`), puis `Origin` + jeton. Frontière de menace = le compte utilisateur.
- Transport WebSocket. Jeton de session en mémoire du broker, renouvelé en silence pour une origine connue ; côté extension en `chrome.storage.session`, jamais `local`.
- Trou connu : une extension tierce munie d'une permission d'hôte sur `127.0.0.1` forge l'`Origin` et obtient l'appairage (prouvé sur Brave et Firefox). Seul Native Messaging le ferme.
- ID d'extension épinglé `hehlgipomfminodhahcjbencblepjhah` (clé `extension-key.pem`, gitignorée) : sans lui, déplacer le dossier casse l'appairage en silence. Firefox : secret collé une fois par profil depuis `/pair`, puis uuid épinglé.
- Contenu de page = donnée : `innerText` assaini, jamais de HTML ni d'`innerHTML`. Pas de `<all_urls>` : `activeTab` + permissions d'hôte optionnelles.
- Règle du geste. Une seule exception, nommée et bornée : ouvrir la transcription YouTube au clic « Résumer cette vidéo ». Pas un précédent.
- Recettes par site : déclaratives, ancrées sur le texte visible, signées Ed25519, jamais de code distant (MV3 = retrait). Une recette qui échoue dégrade vers la lecture générique.
- Le SDK Claude Agent n'entre jamais dans le binaire distribué (`cli.ts` en `await import`).
- Ne jamais écrire dans le produit qu'on estime quelque chose illégal : le cadre juridique se dit une fois, en termes neutres, dans les CGU. On optimise pour l'examinateur du Chrome Web Store (retrait administratif, immédiat, sans recours) plutôt que pour un tribunal.

## Économie
- Perso : abonnement Max via le CLI local, jamais revendu (CGU Anthropic). Distribué : BYOK, jamais de relais d'inférence. Code AGPL-3.0 public, seul le corpus de recettes est privé.
- Gratuit = acquisition, premium vertical pro = revenu, pas de tarif à vie. Un seul serveur, les licences, qui échoue en laissant passer. Encaissement par marchand de référence (Paddle / Lemon Squeezy), jamais Stripe nu.

## Méthode et identité
- Le visuel se dessine à la main par Romain (Penpot ou Figma), puis Claude le reproduit. Graphiques : Plotly.js, jamais de SVG dessiné par le modèle.
- Grill : ne demander que les vrais choix (préférence, coût, architecture, irréversible) ; une recommandation saine et réversible s'applique, annoncée en une ligne. Travail dense : plan écrit + ligne `/goal` prête à lancer.
- Nom : **Coati** (le code dit encore Wingpen). Le champ « side » est saturé, n'y pas revenir. Palette chaude à une teinte, variante sombre obligatoire (`docs/design/palette.md`).

## Pièges qui mordent à chaque session (liste complète : `docs/PIEGES.md`)
- Régression suspecte : comparer d'abord l'empreinte en bas du panneau à `bash scripts/stamp.sh`.
- Une extraction se valide sur une vraie page (`scripts/corpus-probe.ts`), jamais sur le faux DOM seul.
- Modèle muet : `bun scripts/probe-summarize.ts`. Session expirée : `claude /login` dans kitty, pas dans Pyramid (le broker lit `~/.claude`, en lecture seule pour lui).
- Workers Pyramid : ni `AF_UNIX` ni réseau de l'hôte. Navigateur réel et vrai broker se pilotent depuis le shell admin.
