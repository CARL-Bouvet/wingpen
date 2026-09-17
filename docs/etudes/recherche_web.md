# Étude — recherche web in-browser : défendable face à Perplexity ? (2026-09-17)

Source : worker `research-fae88d` (sonnet46, pyr-search + firecrawl). Rapport brut, non retravaillé.
Angle 2 sur 4 de la cartographie des niches libres.

## Ce que les cloud agents ne peuvent pas atteindre

**Sessions authentifiées / contenu abonné.** Perplexity, ChatGPT Search et Google AI Mode opèrent depuis leurs propres identités réseau, sans accès aux sessions utilisateur. Un agent injecté dans le navigateur réel hérite des cookies et tokens de session — accès légitime à tout ce à quoi l'utilisateur est abonné (presse payante, bases de données, SaaS). Perplexity Comet et ChatGPT Atlas (navigateurs IA autonomes) ont *leur propre* session vierge, pas celle de l'utilisateur.
(source: https://o-mega.ai/articles/virtual-browser-agents-ai-with-their-own-online-identity-2025-guide)

**SERP personnalisé.** Un cloud agent interroge Google de façon anonyme et générique. L'extension dans le navigateur de l'utilisateur bénéficie du profil de recherche personnalisé, des alertes actives et de l'historique — résultats différents, pas accessibles autrement.

**Sites bloquant les crawlers IA à la couche réseau.** Les cloud agents présentent des TLS fingerprints, des ASN et des user-agents reconnaissables comme bots. Un vrai navigateur Chrome passe les défenses de fingerprinting de Cloudflare Bot Management par définition.

## Blocage des crawlers IA — ampleur chiffrée

- **57,5 %** des requêtes HTTP HTML sur le réseau Cloudflare sont issues de bots (Cloudflare Radar, Matthew Prince, 3 juin 2026). (source: https://www.digitalapplied.com/blog/ai-crawler-bot-traffic-statistics-2026-data-reference)
- **79 %** des 100 grands sites d'actualité US/UK bloquent au moins un bot de training via robots.txt ; **71 %** bloquent les bots de retrieval ; **67 %** bloquent PerplexityBot. (source: https://www.buzzstream.com/blog/publishers-block-ai-study/)
- Cloudflare a introduit (juillet 2026) une taxonomie **Search / Agent / Training** : à partir du 15 septembre 2026, les bots *Agent* et *Training* sont bloqués par défaut sur les pages affichant de la publicité. (source: https://blog.cloudflare.com/content-independence-day-ai-options/)

**Le navigateur de l'utilisateur échappe-t-il légitimement au blocage ?** Oui, par design. La taxonomie Cloudflare définit *Agent* comme « comportement automatisé agissant pour le compte d'un humain en temps réel ». Une extension pilotée par un utilisateur réel se comporte comme un humain : cookies propres, TLS fingerprint natif Chrome, IP résidentielle. `robots.txt` ne s'applique pas aux humains. C'est une exemption structurelle, pas un contournement — à l'opposé de Perplexity, pris à utiliser des « stealth crawlers » ignorant délibérément les directives `robots.txt` (incident documenté par Cloudflare).

⚠️ Réserve à porter au risque : cette exemption tient tant que l'usage reste piloté par un humain en temps réel. Une fonction d'automatisation de masse (crawl multi-pages sans geste utilisateur) ferait basculer Wingpen dans la catégorie *Agent* et annulerait l'avantage.

## Concurrents déjà positionnés

| Produit | Ce qu'il fait | Limite vs extension |
|---|---|---|
| **Fellou** (fellou.ai) | Navigateur IA agentic, revendique « deep search incluant comptes logged-in (X, Reddit, Salesforce) » | Navigateur séparé → session distincte de la session habituelle |
| **Perplexity Comet** | Navigateur IA avec session propre + revenue-sharing presse (CNN, Fortune, WaPo) | Session vierge, pas les abonnements existants ; objet de poursuites pour contournement de paywalls |
| **ChatGPT Atlas (OpenAI)** | Navigateur IA autonome, bypasse certains paywalls | Même limite : identité réseau séparée, session nouvelle |
| **Merlin** (extension Chrome) | Multi-modèles + résumé page active | Pas de deep research autonome multi-sources ; pas d'accès aux sessions |

(sources: https://fellou.ai/ ; https://cybernews.com/ai-news/ai-browser-media-paywall/ ; https://www.datacamp.com/blog/top-agentic-ai-chrome-extensions)

Aucun concurrent existant ne combine les trois avantages simultanément dans une extension injectée dans le navigateur habituel de l'utilisateur.

## Verdict défendabilité

**Jugement du worker, non sourcé.**

Défendable sur trois axes structurels : (1) l'accès aux abonnements payants est légitimement irréplicable par un cloud agent sans entrer dans l'illégalité (ce que font Perplexity/Atlas, au risque de procès) ; (2) la classification Cloudflare protège activement les vrais navigateurs humains de tout blocage systémique ; (3) aucun concurrent ne propose la combinaison *extension + session existante + deep research autonome*. Le risque principal n'est pas technique mais de positionnement : le user effort requis (activer l'extension sur les bons sites, gérer les permissions `activeTab`) freine l'adoption face à l'immédiateté de Perplexity — friction à concevoir soigneusement.
