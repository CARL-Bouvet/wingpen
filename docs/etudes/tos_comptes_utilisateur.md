# Contrôle ToS — axe « les comptes de l'utilisateur » (2026-09-17)

Source : worker `research-b87c92` (sonnet46, pyr-search + firecrawl). Clauses citées textuellement.
Contrôle de la verticale de remplacement, après l'invalidation de l'axe on-chain (`tos_onchain.md`).

**Résultat : les quatre services sont viables** pour le motif Wingpen — geste unique, page déjà
rendue, données du compte de l'utilisateur, aucun crawl.

## urssaf.fr / autoentrepreneur.urssaf.fr — ZONE GRISE (basse)

CGU (source : https://www.urssaf.fr/accueil/conditions-generales-utilisation.html) :
> « ne pas porter atteinte au système de traitement automatisé de données. »

> « Les demandes abusives, notamment par leur nombre, leur caractère répétitif ou systématique, ou les envois à caractère frauduleux susceptibles de porter atteinte à la sécurité des systèmes d'informations seront rejetés. »

La CGU d'`autoentrepreneur.urssaf.fr` est introuvable (404) ; la FAQ mentionne une CGU fondée sur
l'article L. 112-9 CRPA, mais le scrape ne retourne aucune clause sur l'accès automatisé.

**Ce qui est visé** : l'atteinte à la sécurité du SI, les requêtes répétitives ou systématiques. Un
geste isolé sur une page déjà chargée n'entre pas dans ce profil. Aucune clause sur les extensions,
aucune sur le traitement par l'utilisateur de ses propres données.

## impots.gouv.fr — PERMIS (par absence)

Page examinée : https://www.impots.gouv.fr/mentions-legales (màj 2026-07-28). Aucune page CGU
dédiée localisée. Les mentions légales ne contiennent **aucune** clause sur l'accès automatisé, les
robots, les extensions, ni sur le traitement des données par l'utilisateur.

⚠️ Portée réelle de ce verdict : une permission *par absence de clause* est plus faible qu'une
autorisation explicite. Le worker signale [UNVERIFIED] qu'une CGU pourrait exister derrière
l'authentification, non vérifiable sans compte. À relire une fois connecté.

## net-entreprises.fr — ZONE GRISE (basse)

CGU (source : https://www.net-entreprises.fr/declaration/mentions-legales, modifié 2026-04-07) :
> « Afin de parer aux tentatives d'usage malveillant, le GIP-MDS se réserve le droit de bloquer tout accès considéré comme suspect. »

Aucune définition d'« accès suspect », aucune clause sur le scraping, les robots ou les extensions.
Formulation défensive, non prescriptive pour l'usage ordinaire.

## github.com — ZONE GRISE, favorable

*Acceptable Use Policy* (source : https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) :
> « Scraping refers to extracting information from our Service via an automated process, such as a bot or webcrawler. Scraping does not refer to the collection of information through our API. »

> « using our servers for any form of excessive automated bulk activity… »

*Terms of Service* §D.9 : la restriction sur l'accès automatisé vise exclusivement l'entraînement de
systèmes d'IA commerciaux, avec exemption explicite pour la recherche académique.
(source : https://docs.github.com/site-policy/github-terms/github-terms-of-service)

**Ce qui est visé** : bots, crawlers, extraction en masse. GitHub est le seul des quatre à *définir*
le scraping, et sa définition — « via an automated process, such as a bot or webcrawler » — exclut
une extension déclenchée par un geste humain. Aucune clause ne restreint l'utilisateur dans le
traitement de ses propres données affichées.

## Synthèse du worker

Priorité recommandée : **impots.gouv.fr** (aucune friction détectée) et **GitHub** (définition
favorable), puis Urssaf et net-entreprises (zone grise basse).

## Conséquence que le contrôle ne dit pas, et qui compte davantage

Cet axe porte les données les plus sensibles qu'un utilisateur possède : revenus, cotisations,
avis d'imposition, déclarations. Ce qui change deux choses.

**1. L'architecture de Wingpen cesse d'être un argument et devient une condition d'entrée.** Aucun
concurrent ne peut s'approcher de ces pages : Monica, Sider, Merlin et HARPA envoient le DOM brut à
leurs serveurs (`niches.md`) — sur un avis d'imposition, c'est indéfendable, et ils ne peuvent pas
retirer le relais sans détruire leur modèle. Le fossé est ici maximal.

**2. Le chemin modèle local passe de commodité à fonction phare.** Avec Ollama ou LM Studio, la
donnée fiscale ne quitte jamais la machine — ni broker distant, ni API, ni Anthropic. C'est une
phrase que personne d'autre ne peut prononcer : *ton avis d'imposition ne sort pas de chez toi.*
Sous BYOK avec clé Anthropic, la donnée part chez un sous-traitant américain choisi par
l'utilisateur, qui en est le responsable de traitement — acceptable, mais à **dire explicitement**
avant la première requête sur ce type de page, pas à enfouir dans les CGU.

Conséquence de jalonnage : l'adaptateur `openai-compat.ts` (Ollama/LM Studio) n'est plus optionnel
sur cette verticale. Il passe devant l'adaptateur BYOK HTTP dans l'ordre de construction.
