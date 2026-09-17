# Wingpen — mémoire durable

Réinjecté chaque session. Invariants seulement. L'état daté va dans `JOURNAL.md`.

## Index de référence
- Contrat extension ↔ broker : `docs/PROTOCOL.md` (fait autorité).
- Décisions figées + motifs : `docs/DECISIONS.md` (P1-P14, T1-T13, L1-L2, règle du geste, 9 risques).
- Dossier de faisabilité du distribué payant : `docs/etudes/faisabilite.md` (verdict, archi, économie, jalons).
- Études : `docs/etudes/{marche,revenus,technique,niches,recherche_web,plateformes_juridique,design_figma}.md`.
- Chaîne d'attaque : `docs/MENACE_chaine_navigateur.md`.

## Invariants d'architecture
- L'extension ne détient aucun identifiant de modèle. Tout secret vit dans le broker local.
- Broker : `127.0.0.1` seulement, vérifie `Origin` + jeton de pairage avant traitement.
- Transport WebSocket, pas `fetch` — contourne Local Network Access (échappatoire datée, crbug.com/421156866).
- Jeton de pairage en `chrome.storage.session`, jamais `local` (non chiffré sur disque).
- Contenu de page = donnée, jamais instruction. Texte assaini, jamais de HTML, jamais d'`innerHTML`.
- Pas de `<all_urls>` : `activeTab` + permissions d'hôte optionnelles.
- **La règle du geste** : Wingpen accompagne un geste, il n'en fabrique jamais. Pas de boucle, de veille, de crawl, d'interaction automatisée. Cloudflare + ToS + Chrome Web Store tracent la même ligne.
- Le SDK Claude Agent ne va jamais dans le binaire distribué (109 Mo + CLI) — `cli.ts` en `await import`.
- Recettes par site : déclaratives, signées Ed25519, CDN. Jamais de code distant (MV3 = retrait automatique).

## Contraintes économiques figées
- Usage perso : abonnement Claude Max via le CLI local. **Interdit de le revendre** (CGU Anthropic).
- Distribué : **BYOK**, jamais de relais d'inférence. C'est l'argument de vente, pas une contrainte subie.
- Gratuit grand public = acquisition. Premium vertical pro = revenu, 15-20 €/mois. Pas de tarif à vie.
- Aucun serveur sauf les licences, et il échoue en laissant passer.
- Encaissement par marchand de référence (Paddle/Lemon Squeezy), jamais Stripe nu — TVA UE.

## Gotchas mesurés
- Le SDK embarque un CLI Claude cassé (`EEXIST /todos`) : `model.ts:resolveClaudeExecutable` pointe sur le `claude` système, surchargeable par `WINGPEN_CLAUDE_PATH`.
- `chrome.sidePanel` : un panneau par fenêtre, `open()` exige un geste utilisateur, le panneau ne maintient pas le service worker en vie.
