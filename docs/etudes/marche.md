# Étude marché — assistant navigateur payant (2026-09-16)

Source : worker `research-7c21e4` (sonnet46, pyr-search + firecrawl). Rapport brut, non retravaillé.

## 1. Incumbents & pricing (septembre 2026)

| Tool | Free tier | Entry paid | Mid | Top |
|---|---|---|---|---|
| **HARPA AI** | 100 runs, 10 web-session msg/j | $12/mo (75M tok/an) | $19/mo (225M tok/an) | $240 one-time (Lifetime, BYOK) |
| **Monica** | cap quotidien, 0 crédit avancé | $9.90/mo | $19.90/mo (Unlimited) | — |
| **Sider** | limité/jour | $8.99/mo | $12.99/mo | $24.99/mo |
| **Merlin** | ~50 req/j | $14.25/mo | $12/mo/user (Team) | — |
| **MaxAI** | très restreint | $9.99/mo | $19.99/mo | — |
| **Prophet** (newcomer 2026) | $0.20 de crédits, sans CB | $9.99/mo (+$11 crédits) | $29.99/mo | $59.99/mo |

Perplexity : pas de SKU extension autonome, bundlé Pro $20/mo [UNVERIFIED].
Sources : harpa.ai/pricing ; prophetchrome.com/best-ai-chrome-extensions

## 2. Modèles de monétisation réellement utilisés

- **Abonnement plat (dominant)** : Monica, Sider, Merlin, MaxAI. Free tier = essai plafonné, quota qui reset chaque jour. Marche (les 4 sont toujours actifs en 2026).
- **Revente de tokens avec marge** : HARPA (Megatokens, top-ups −25 % en volume), Prophet (coût API + 20 %, transparent). Marche pour HARPA ; Prophet est un pari 2026 sur la transparence tarifaire.
- **BYOK** : seul HARPA en fait une offre de premier plan (Lifetime $240 = usage clé-perso). Les autres proposent « API connections » en add-on payant, pas gratuit-avec-clé.
- **Lifetime deal** : HARPA $240 toujours offert. Monica et Merlin ont retiré les leurs [UNVERIFIED date].
- **Freemium-entonnoir** : universel. Monica 30 req/j, Merlin 51 — « assez serré pour pousser à l'abo en une ou deux semaines ».

## 3. Ce que les gens paient vraiment / raisons de churn

Déclencheurs d'achat :
- **Multi-modèles sur une seule facture** — argument n°1 de Monica et Sider (« remplace $140/mo d'abos séparés »).
- **Comparaison côte à côte des modèles** (group chat) — différenciateur documenté de Sider, cité comme unique par les tests.
- **Réponses ancrées dans la recherche web** — le moat de Merlin.
- **Automatisation du navigateur** (click/fill/navigate) — pitch de Prophet, 18 outils interactifs mi-2026. HARPA fait du monitoring/scraping à règles, plus faible.
- **Surveillance de changement de page + suivi de prix** — spécifique HARPA, niche mais collant.

Raisons de churn :
- « Le plan Unlimited a quand même des limites quotidiennes sur les modèles avancés » (Monica) — promesse perçue comme rompue.
- Fonctions avancées verrouillées derrière les tiers supérieurs (Sider) ; free tier très restreint (MaxAI).
- Le pay-per-use gagne pour les usages légers : seuil de bascule ≈ 500 messages Sonnet/mois contre un forfait $10.

## 4. Viabilité du BYOK

Viable mais niche. HARPA est le seul à en faire une offre première (Lifetime $240 construit autour du BYOK : clés OpenAI/Anthropic/OpenRouter/Azure/LLM local, l'utilisateur paie son fournisseur directement, HARPA prend un forfait unique).

Pourquoi les autres l'évitent : la marge sur revente de tokens est leur revenu récurrent principal ; le BYOK la réduit à zéro. Seule une structure lifetime (ou un positionnement open-source façon Prophet) rend le BYOK tolérable économiquement.

Risque pour un nouvel entrant : BYOK + abonnement marche comme **tier premium** (signal de confiance, de confidentialité, transparence des coûts pour les power users) mais ne peut pas être l'unique voie de monétisation — marge trop mince sauf forfait plateforme élevé.
