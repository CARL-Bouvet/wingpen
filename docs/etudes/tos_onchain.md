# Contrôle ToS — verticale on-chain (2026-09-17)

Source : worker `research-8eadaa` (sonnet46, pyr-search + firecrawl). Rapport brut, clauses citées
textuellement. Contrôle bloquant demandé par `faisabilite.md` §2.

**Résultat : deux sites sur trois interdisent. La verticale on-chain telle que définie en P10 est
morte.**

## Arkham Intelligence — INTERDIT (zone grise à l'origine, tranchée à l'interdiction)

*User Conduct*, point 16 :
> « engage in or use any data mining, robots, scraping, or similar data gathering or extraction methods. »

*Service Content* :
> « you agree not to modify, copy, frame, **scrape**, rent, lease, loan, sell, distribute, or create derivative works based on the Service or the Service Content »

Point 9 :
> « obtain or attempt to access or otherwise obtain any content or information through any means not intentionally made available or provided for through the Service »

(source : https://www.arkhamintelligence.com/terms-of-service, révisé 15 juillet 2025)

Le mot « scraping » apparaît dans deux sections distinctes, sans restriction au scraping serveur —
la formulation couvre « any » méthode d'extraction. Aucune clause explicite sur les extensions,
mais aucune exemption non plus. Une clause *Competitors* interdit en outre l'accès à toute entité
concurrente.

## CryptoQuant — INTERDIT, sans ambiguïté

*Section 6.1, Restrictions on Use* :
> « You shall not use or attempt to use any 'scraper,' 'deep-link,' 'robot,' 'bot,' 'spider,' 'data mining,' **'computer code,' or any other automate device, program, tool, algorithm, process or methodology** to access, acquire, copy, or monitor any portion of the Service, any data or content found on or accessed through the Service. »

*Section 6, chapeau* :
> « YOU AGREE NOT TO (i) DUPLICATE, PUBLISH, DISPLAY, DISTRIBUTE, MODIFY, OR CREATE DERIVATIVE WORKS FROM THE MATERIAL PRESENTED THROUGH THE WEBSITE »

*Section 4.1, Grant of Rights* :
> « a limited non-exclusive, non-transferable, worldwide right … to access, copy, display, perform, and use Data and Analytics and other CryptoQuant Content for **internal, non-commercial** business purposes pursuant to the terms of the Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) License »

(source : https://cryptoquant.com/terms-of-service)

La formulation « computer code, or any other automate device, program, tool, algorithm, process or
methodology » est délibérément exhaustive et couvre une extension de navigateur. La licence
CC BY-NC autorise l'usage personnel non commercial — mais une fonction payante d'un produit viole
la condition *NonCommercial*.

## mempool.space — PERMIS

Le ToS (màj 10 juillet 2024) ne contient **aucune** clause sur le scraping, l'automatisation, les
bots, les extensions, la redistribution ou l'accès programmatique. Il se limite à : *No Warranty,
No Liability, No Advertising, No Altcoins* et les règles du Mempool Accelerator. Projet
open-source (AGPL), API publique documentée et librement utilisable.
(source : https://mempool.space/terms-of-service)

## Ce que ce contrôle enseigne au-delà des trois sites

**1. Une recette nommée par site est un engagement contractuel, pas un détail technique.**
Livrer une recette « CryptoQuant » signifie viser ce site et se faire opposer son ToS. Le contrôle
des conditions doit précéder l'écriture de toute recette, au même titre que le test technique.

**2. La distinction qui sauve le produit** : l'interdiction porte sur l'outil *ciblant* le service,
pas sur le fait qu'un outil générique fonctionne aussi là. « Lis la page que je regarde » est une
fonction universelle, indifférente au site, déclenchée par l'utilisateur sur son propre écran —
au même titre que le mode lecture de Chrome ou Claude in Chrome. Ce que le contrôle interdit, c'est
de **vendre** une fonction nommée pour un site qui l'interdit. Le gratuit générique n'est pas
touché ; le premium par recette l'est.

**3. Le critère de sélection d'une recette payante.** Au moins une des trois conditions :
- (a) le ToS du site ne comporte aucune clause anti-outil — rare (mempool.space) ;
- (b) **le contenu appartient à l'utilisateur** — ses propres données sur son propre compte. Aucun
  ToS ne peut lui interdire de lire ce qui est à lui, et la question des droits d'auteur et des
  clauses *NonCommercial* disparaît. Seule subsiste l'éventuelle interdiction contractuelle d'outil,
  absente des services publics ;
- (c) le site offre une API officielle dont les conditions autorisent un client tiers.

La condition (b) est la plus robuste des trois : elle est structurellement immunisée, et c'est
aussi là que les agents cloud sont les plus aveugles, puisqu'il faut être connecté.
