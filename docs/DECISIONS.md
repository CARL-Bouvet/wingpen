# Wingpen — décisions de conception

Figées le 2026-09-16, à l'issue d'un cadrage et de quatre études (voir `docs/etudes/`).
Complétées le 2026-09-17 par le volet distribué payant (`docs/etudes/faisabilite.md`).
Une décision ne se rouvre que sur élément neuf, pas sur intuition.

## Produit

| # | Décision | Motif |
|---|---|---|
| P1 | Outil personnel d'abord, produit commercial étudié en parallèle | L'usage quotidien finance la conception ; la vitrine se décide plus tard. |
| P2 | Public visé : grand public, pas les développeurs aguerris | Choix de l'auteur. ⚠️ **Tension connue** : l'enquête métier désigne développeurs et SEO techniques comme le seul segment qui paie ($15-30/user/mois). À trancher au jalon 2. |
| P3 | Fonction phare du jalon 1 : résumé de page web et de vidéo YouTube | Besoin le plus fort de l'auteur. ⚠️ Commercialement commoditisé (Perplexity, OpenAI, Claude in Chrome le bundlent) — légitime comme fonction perso, sans valeur comme argument de vente. |
| P4 | Différenciateur commercial retenu : la vérification front-end sur la page **rendue**, couplée au SEO live | Seul créneau sans concurrent direct identifié : Browserbase vend du navigateur headless dans le cloud, l'inverse du positionnement « mon vrai navigateur, mon modèle local ». |
| P5 | Pas d'« IA » dans le nom ; le mot-clé vit dans le sous-titre | Aucun produit à succès récent (Cursor, Warp, Arc, Linear, Raycast) ne le met dans son nom ; la boutique sanctionne les noms bourrés de mots-clés. |
| P6 | Nom : **Wingpen** | Aucun logiciel ni extension sous ce nom. `wingpen.com` enregistré depuis 2014 mais ne sert rien ; `.app` et `.dev` libres. Réserve assumée : « pen » promet d'écrire alors que la fonction phare est de résumer. |

### Volet distribué payant (17/09)

| # | Décision | Motif |
|---|---|---|
| P7 | **P2 tranchée** : le gratuit est grand public, le payant est vertical et professionnel | Fait disparaître la tension du 16/09 sans renier l'usage quotidien de l'auteur. |
| P8 | **P3 amendée** : le résumé de page et de vidéo reste une fonction, cesse d'être un argument de vente | Commoditisé par Perplexity/OpenAI/Anthropic. Sert l'acquisition et l'auteur, pas le revenu. |
| P9 | **P4 amendée** : le mécanisme (vrai navigateur, vraie session) est conservé, la cible commerciale devient l'analyse on-chain | La vérification front-end reste le lien avec Pyramid (`L2`), pas la promesse de vente. |
| P10 | ~~Verticale de lancement : mempool.space, Arkham, CryptoQuant~~ — **INVALIDÉE le 17/09, contrôle ToS** | Arkham interdit « any data mining, robots, scraping, or similar data gathering or extraction methods » ; CryptoQuant interdit « 'computer code,' or any other automate device, program, tool, algorithm, process or methodology » et place son contenu sous CC BY-**NC**, ce qui exclut une fonction payante. Seul mempool.space est libre, et il ne porte pas un produit à 15 €/mois à lui seul. Clauses citées dans `etudes/tos_onchain.md`. Verticale à remplacer. |
| P16 | **Dépôt public sous AGPL-3.0**, corpus de recettes premium dans un dépôt privé séparé | Le code public n'est pas une concession, c'est l'outil de vente : Sider, Merlin et HARPA ont tous promis par écrit de ne rien collecter et une analyse de trafic les a démentis (`niches.md`). Sans dépôt ouvert, « rien ne sort de ta machine » est une promesse indiscernable des leurs. MV3 impose de toute façon du code lisible dans le paquet publié. AGPL plutôt que MIT : l'avantage est architectural donc copiable — l'AGPL oblige à republier toute version modifiée, y compris servie en ligne, ce qui décourage la reprise par un concurrent financé. **Chaque ligne qui touche aux données de l'utilisateur reste publique** ; seul le corpus de recettes est fermé. |
| P17 | Ce qui est vendu : **la fraîcheur des recettes, la commodité, le support** — jamais le code | Une recette est un JSON de sélecteurs, republiable une fois livrée, mais elle pourrit dès que le site change son HTML. L'abonnement n'achète pas le fichier, il achète que quelqu'un le répare lundi matin — modèle des listes antipub payantes et des flux de signatures antivirus. S'y ajoutent le paquet installable en un clic (l'AGPL autorise à compiler soi-même, presque personne ne le fait) et un humain qui répond, la plainte n°3 de `niches.md`. Limite assumée : l'AGPL n'empêche pas un utilisateur d'auto-héberger gratuitement, elle empêche un concurrent financé de fermer le code. |
| T17 | **Les recettes ancrent sur le texte visible, jamais sur les classes CSS** | `.css-1x7bf3q` d'un build CSS-in-JS change à chaque déploiement ; le libellé « Montant de vos cotisations » ne change qu'à la refonte. Chercher une valeur *à côté d'un libellé* est ce que fait un humain, et c'est nettement plus stable. |
| T18 | **Une recette qui échoue dégrade, elle ne casse jamais** | Il y a un LLM dans la boucle : quand les ancres ne répondent plus, on envoie une tranche plus large de texte assaini et le modèle retrouve l'information. Plus lent, moins précis, mais fonctionnel. Un scraper classique casse net. Corollaire : le chemin générique gratuit marche toujours, la recette l'améliore sans jamais en être l'unique voie. |
| T19 | **Maintenance : canari quotidien sur les pages publiques, utilisateurs-capteurs sur les pages connectées** | Une page connectée n'est pas vérifiable automatiquement sans détenir des identifiants — exclu. Compensations, par ordre d'efficacité : un bouton « cette recette ne correspond plus » (sans bouton, l'utilisateur part en silence) ; un signalement **opt-in, sans contenu** — structure fixe du type `recette impots-avis v3, ancres 2 et 5 introuvables`, zéro texte de page, aperçu exact affiché avant envoi ; et l'auteur lui-même, qui visite ces sites de toute façon. Charge estimée : ~20 recettes sur des sites publics lents = quelques heures par mois ; 50 recettes sur du SaaS à déploiement continu = un mi-temps. D'où la stratégie : **peu de recettes, sur des sites lents, bien faites.** |
| P15 | ~~Verticale : les comptes de l'utilisateur, impots.gouv d'abord~~ — **desserrée le 18/09. Le choix de la verticale premium est reporté au jalon 2.** | Élément neuf : l'auteur est mal à l'aise à l'idée d'adosser le produit à l'Urssaf, et son besoin immédiat est l'outil généraliste — résumer des articles de dev, des tutos, des vidéos. Or **c'est le produit gratuit** (P11), donc l'outil perso, donc le jalon 1. Rien n'oblige à trancher le premium maintenant : la décision était prématurée. Ce qui reste acquis du travail du 17/09 : l'axe on-chain est mort (ToS), le critère de sélection T14 est établi, et les quatre services testés en `tos_comptes_utilisateur.md` restent éligibles le jour où on choisira. Piste notée sans être retenue : « apprendre depuis le web » (articles techniques, tutoriels, vidéos) est un groupe cohérent — mais le résumé lui-même est commoditisé (P8), donc un éventuel premium viendrait de ce qui se passe *après* le résumé, pas du résumé. | Contrôle ToS favorable sur les quatre (`etudes/tos_comptes_utilisateur.md`) : les portails publics ne visent que l'atteinte au SI et les requêtes systématiques, GitHub définit le scraping comme « via an automated process, such as a bot or webcrawler » et en exclut le geste humain. Immunisé par le critère T14(b) : personne ne peut interdire à quelqu'un de lire ce qui lui appartient. Agents cloud aveugles (connexion requise). L'auteur est son propre utilisateur. ⚠️ Réserves : verdict « permis par absence » sur impots.gouv, à relire connecté ; marché franco-français donc étroit ; valeur saisonnière autour des déclarations. |
| T16 | **L'adaptateur modèle local (Ollama/LM Studio) passe devant le BYOK HTTP dans l'ordre de construction** | Cette verticale porte les données les plus sensibles d'un utilisateur — revenus, cotisations, avis d'imposition. Avec un modèle local, elles ne quittent jamais la machine : ni broker distant, ni API, ni Anthropic. Personne d'autre ne peut prononcer cette phrase. Sous BYOK avec clé Anthropic, la donnée part chez un sous-traitant choisi par l'utilisateur, qui en est responsable de traitement — acceptable, mais à **dire avant** la première requête sur ce type de page, pas à enfouir dans les CGU. |
| T14 | **Une recette payante par site exige un contrôle ToS préalable.** Critère : (a) aucune clause anti-outil, ou (b) le contenu appartient à l'utilisateur, ou (c) API officielle autorisant un client tiers | Une recette nommée est un engagement contractuel, pas un détail technique : la livrer, c'est viser le site et se faire opposer ses conditions. Le contrôle passe avant l'écriture, au même rang que le test technique. La condition (b) est la plus robuste — personne ne peut interdire à quelqu'un de lire ce qui lui appartient, la question des droits d'auteur et des clauses *NonCommercial* disparaît, et c'est là que les agents cloud sont les plus aveugles puisqu'il faut être connecté. |
| T15 | La distinction qui préserve le produit : **le gratuit générique n'est pas visé, le premium nommé l'est** | « Lis la page que je regarde » est universel, indifférent au site, déclenché par l'utilisateur sur son propre écran — au même titre que le mode lecture de Chrome. Ce qu'un ToS interdit, c'est de **vendre** une fonction nommée pour son service. |
| P11 | Le gratuit est un **canal d'acquisition**, délibérément complet, pas un essai bridé | C'est lui qui démontre l'argument central — rien ne sort de la machine — que le premium monnaie ensuite. |
| P12 | Prix premium **15-20 €/mois**. Pas de tarif à vie | À 3 €/mois il faut cinq fois plus d'utilisateurs pour le même revenu ; or l'utilisateur est la ressource rare d'un solo, pas le prix. Refus du tarif à vie : décision de l'auteur. |
| P13 | Verticales suivantes, une à la fois : information/politique, puis marchands. **Streaming sportif exclu définitivement** | Le CWS interdit textuellement « enable the unauthorized access, download, or streaming of copyrighted content ». Cause de retrait, pas zone à manier prudemment. |
| P14 | Hors périmètre distribué : Figma, psdly, gfx-hub, 4chan, automatisation sociale | Figma : canvas WebGL, une extension est aveugle au DOM. psdly/gfx-hub : contenu sous droits. 4chan : rend l'extension invendable ailleurs. Automatisation sociale : retrait du store et ban du compte de l'utilisateur. |

## Technique

| # | Décision | Motif |
|---|---|---|
| T1 | Chromium d'abord, Firefox ensuite | Le panneau latéral diverge : `chrome.sidePanel` (par onglet) contre `browser.sidebarAction` (par fenêtre). Un codebase unique reste possible avec un manifest scindé + `webextension-polyfill`. |
| T2 | Un broker local **écrit par nous**, pas une bibliothèque tierce | Rien d'existant ne combine réutilisation du CLI local + pont Pyramid + politique par origine. ~400 lignes. |
| T3 | Transport WebSocket, pas `fetch` | Local Network Access soumet `fetch` vers `127.0.0.1` à une permission utilisateur, et un service worker ne peut pas la demander lui-même. Les WebSockets y échappent encore (crbug.com/421156866) — échappatoire datée, repli documenté dans `PROTOCOL.md`. |
| T4 | Aucun secret dans `chrome.storage.local` | Non chiffré sur disque. Le jeton de pairage vit dans `chrome.storage.session` (mémoire vive) ; les identifiants du modèle ne quittent jamais le broker. |
| T5 | Pas de `<all_urls>` : `activeTab` + permissions d'hôte optionnelles | Réduit le rayon de souffle d'un content script compromis, et évite la file de revue manuelle de la boutique. |
| T6 | Le content script envoie du **texte** assaini, jamais du HTML ; le broker traite ce texte comme une donnée, jamais comme une instruction | Une page hostile écrit dans le DOM que le content script lit. C'est le vecteur d'injection principal de cette forme d'extension. |
| T7 | Source du modèle : abonnement Claude Max via le CLI local pour l'usage personnel ; **BYOK** pour toute version distribuée | Revendre un abonnement personnel est interdit par les conditions d'Anthropic. L'étude marché désigne par ailleurs le BYOK comme le seul modèle tenable hors revente de tokens. **Renforcée le 17/09** : c'est devenu l'argument de vente central, pas une contrainte subie — la demande n°1 non servie du marché est un assistant qui ne *peut pas* exfiltrer. |
| T8 | **Un dépôt, trois adaptateurs de modèle** derrière une interface : `cli.ts` (perso), `anthropic-http.ts` (BYOK), `openai-compat.ts` (Ollama/LM Studio/OpenRouter) | Le protocole, le panneau et l'extraction — l'essentiel du travail — sont communs. Seul l'accès au modèle diverge. L'adaptateur Ollama répond en plus à la demande non servie n°3 de `niches.md`. |
| T9 | Le SDK Claude Agent ne doit **jamais** entrer dans le binaire distribué ; chargement dynamique de `cli.ts` uniquement | 109 Mo de `node_modules` plus le CLI Claude installé sur la machine. Intenable chez un client. Le distribué se compile par `bun build --compile` en exécutable unique. |
| T10 | Les recettes par site sont **déclaratives** (sélecteurs, champs, gabarit de prompt), validées contre un schéma et **signées Ed25519**, distribuées sur CDN | MV3 interdit le code distant (« functionality easily discernible from its submitted code ») — retrait automatique sinon. Et un CDN compromis deviendrait une exécution de code arbitraire chez tous les utilisateurs. La signature couvre le gabarit de prompt, sans quoi une recette altérée devient un vecteur d'injection. Bénéfice : corriger un site qui change son HTML sans repasser par la revue du store. |
| T11 | **Aucun serveur au lancement, sauf celui des licences.** Ni synchronisation, ni relais d'inférence | Le relais détruirait l'avantage (T7). La synchronisation avait été demandée pour les « repères par site » — ce sont en réalité des données produit, identiques pour tous, qui se distribuent en fichier statique (T10). Le serveur de licences doit **échouer en laissant passer** : on ne punit pas un client payant pour une panne. |
| T12 | Signature de code du broker **différée** ; distribution par `brew`/`scoop`/`npm`/binaire au lancement | ~400 €/an (certificat Windows + Apple Developer) pour supprimer un avertissement que l'audience technique de la verticale sait franchir. Nécessaire le jour où le public cesse d'être technique, pas avant. |
| T13 | Encaissement par **marchand de référence** (Paddle ou Lemon Squeezy), pas Stripe nu | La TVA d'un abonnement vendu à un particulier de l'UE est due dans le pays de l'acheteur. Le marchand de référence est juridiquement le vendeur : il la collecte et la reverse. ~2 points de commission en plus pour ne jamais toucher à la TVA intracommunautaire. |

## Lien avec Pyramid

| # | Décision | Motif |
|---|---|---|
| L1 | Les workers Pyramid pilotent un **profil Chrome dédié**, avec ses propres sessions — jamais le navigateur quotidien de l'utilisateur | Le navigateur quotidien contient messagerie et banque. Un profil dédié garde l'utilité (rester connecté à un site) sans le risque. |
| L2 | Canal immédiat : les MCP Playwright / chrome-devtools. Le pont par l'extension vient au jalon 2 | Mesuré le 16/09 : les MCP navigateur tournent hors du bac à sable des workers et atteignent `127.0.0.1`. La boucle front-end éditer → afficher → vérifier fonctionne déjà, sans toucher à la sécurité. |

## Contrainte dure — la règle du geste

> **Wingpen accompagne un geste de l'utilisateur, il n'en fabrique jamais.**

Au même rang que les quatre règles de sécurité. Ce n'est pas une précaution morale, c'est la
condition d'existence du produit : les trois cadres qui nous protègent tracent exactement la même
ligne, et la franchir les fait perdre tous les trois d'un coup.

| | Côté licite | Côté interdit |
|---|---|---|
| Cloudflare (taxonomie juillet 2026) | humain en temps réel | boucle automatisée = catégorie *Agent*, bloquée par défaut depuis le 15/09/2026 sur toute page affichant de la publicité |
| ToS des plateformes | l'utilisateur agit, l'outil assiste | l'outil agit à sa place — ban du compte **de l'utilisateur** |
| Chrome Web Store | enrichir ce qui est affiché | extraire en volume, transmettre, contourner |

Interdit : suivi de prix en arrière-plan, veille automatique, crawl multi-pages, publication
programmée, toute boucle sans geste. Autorisé : tout ce qui part d'un clic sur la page ouverte.

### L'exception nommée (18/09) — ouvrir la transcription YouTube

Un seul clic, sur le bouton « Afficher la transcription » que YouTube affiche déjà, **uniquement**
en réponse au clic de l'utilisateur sur « Résumer cette vidéo », sur l'onglet qu'il regarde. Jamais
au chargement, jamais en boucle, jamais sur une autre vidéo que celle affichée. Code isolé dans
`panel.js:openYouTubeTranscript`, séparé de l'extraction pour rester lisible par un examinateur de
boutique.

Motif : ce que visent les trois régimes, c'est le **volume et l'autonomie** — un moissonneur. Une
interaction unique, sur instruction directe et simultanée d'un utilisateur connecté, est son acte à
lui, outillé. C'est l'axe de hiQ v. LinkedIn et de Meta v. Bright Data : ce qui a fait basculer les
décisions, c'est l'accès massif derrière un login, jamais une interaction isolée avec une interface.
Une lecture stricte interdirait aussi de faire défiler une page pour charger du contenu différé, ce
qui rendrait l'extension inutilisable.

Cette exception est **nommée et bornée** : elle vaut pour ce bouton, pas comme précédent. Toute
extension du principe repasse par une décision explicite.

⚠️ **Ce qui a été écarté au passage** : faire dire au produit « clique à ma place, je n'ai pas le
droit de le faire ». Cette phrase n'aurait protégé de rien et aurait tout aggravé — un aveu écrit,
livré à chaque client, que l'éditeur estime l'action interdite, doublé d'une instruction de la
commettre. C'est la définition de la **facilitation** que vise la politique du Chrome Web Store, et
la preuve du savoir en cas de litige. Règle générale qui en découle : **ne jamais écrire dans le
produit qu'on estime quelque chose illégal.** Le cadre juridique s'énonce une fois, en termes
factuels et neutres, dans les CGU et la fiche de boutique. Les messages d'interface restent
factuels : ce qui s'est passé, ce que l'utilisateur peut faire — jamais une qualification de droit.

Corollaire de risque : l'exposition réelle n'est pas un procès — aucune plateforme ne poursuit un
développeur solo pour un clic — mais un **retrait du Chrome Web Store**, administratif, sans recours
pratique, immédiat. On optimise pour la lecture d'un examinateur, pas pour un tribunal.

**La contrainte vit dans le code, pas dans l'interface.** L'idée d'afficher dans chaque réponse ce
que Wingpen a le droit de faire a été examinée et écartée : le CWS juge le code et non l'interface
(la responsabilité ne se transfère pas par mention légale) ; l'encart répété reproduit la plainte
n°5 de `niches.md` (« UX écrasante ») alors que la simplicité est ce qu'on vend ; et expliquer
*comment* contourner une restriction est qualifié de **facilitation** par la politique CWS — une
extension qui refuse d'agir mais publie le mode d'emploi est plus exposée qu'une qui se tait.
Forme retenue : la fonction n'existe pas, c'est énoncé une fois à l'installation et dans les CGU, et
un message d'une ligne n'apparaît que si l'utilisateur demande ce que Wingpen ne fera pas.

## Risques ouverts

1. ~~**Local Network Access**~~ — **levé pour de bon le 18/09.** Les deux réserves du 16/09 sont tombées. Mesuré sur **Brave 152.1.94.121** (base Chromium 152), le navigateur quotidien de l'auteur, **en fenêtré** — donc une demande de permission aurait pu s'afficher, et ne s'est pas affichée. Le service worker ouvre `ws://127.0.0.1:8787/ws` sans aucune permission ; l'extension se connecte seule par son alarme de reconnexion, et la connexion survit au délai de poignée de main (le broker ferme en 4401 sinon). Point neuf : Brave applique sa propre couche de permission sur `localhost`, indépendante de celle de Chromium — elle ne s'applique pas non plus. Rejouable : `WINGPEN_CHROME=/usr/bin/brave WINGPEN_HEADLESS=0 ./scripts/smoke.sh`. La fenêtre peut toujours se refermer côté Chromium ; le repli reste un canal `fetch` avec permission demandée depuis le panneau. Détail de la mesure du 16/09 ci-dessous.

   *(16/09, conservé)* — **levé, mesuré.** Extension MV3 chargée dans Chrome for Testing 154 (headless, profil dédié) : le service worker a ouvert `ws://127.0.0.1:8787/ws` sans aucune demande de permission, `Origin: chrome-extension://<id>` présent, poignée de main conforme au protocole. Rejouable par `./scripts/smoke.sh --stub`. Deux réserves honnêtes : mesuré en headless (un prompt de permission ne peut pas s'y afficher — il aurait produit un refus, pas un laissez-passer, donc le résultat tient) et sur Chrome 154 uniquement. À reconfirmer sur le Chrome quotidien avant toute distribution. La fenêtre peut se refermer côté Chromium : le repli reste un canal `fetch` avec permission assumée, demandée depuis le panneau.
2. **Revue de boutique** — `localhost` + permissions d'hôte + WebSocket vers un démon local : cycle de revue de 4 à 8 semaines rapporté, rejets fréquents.
3. **Bundling par les gros** — Perplexity, OpenAI et Anthropic livrent le résumé de page gratuitement dans leur abonnement. Aucun solo ne tient sur une fonction générique.
4. **Frontière de sécurité du broker** — `Origin` arrête une page hostile, le jeton arrête une autre extension, rien n'arrête un programme tournant déjà sous le même compte. Limite assumée, identique à celle de Pyramid.
5. ~~**ToS de la verticale**~~ — **survenu le 17/09, verticale invalidée.** Arkham et CryptoQuant interdisent explicitement l'usage d'un outil ; CryptoQuant place son contenu sous CC BY-NC. Clauses dans `etudes/tos_onchain.md`. Le risque ponctuel est devenu un processus permanent (T14). Verticale de remplacement à choisir.
6. **Érosion des recettes** — les sites changent leur HTML, les recettes cassent. Ce n'est pas un incident mais le coût récurrent permanent du produit. Atténué par la publication CDN sans repasser par la revue du store (T10).
7. **Keywall** — le BYOK impose de coller une clé avant la première réponse, y compris en gratuit. L'entonnoir d'installation ne ressemble pas à celui des benchmarks de `revenus.md`. Parades en `faisabilite.md` §5 : promesse visible avant la demande de clé, chemin Ollama sans clé, guide en trois images.
8. **Plafond de statut** — le régime auto-entrepreneur plafonne à 77 700 € de CA, atteint vers ~470 abonnés à 15 €/mois. Passage en société à préparer avant de l'atteindre.
9. **Verticale unique** — toute la recette dans un seul panier. Ouvrir la suivante dès que la première tient, une à la fois.
