# Dossier de faisabilité — Wingpen distribué

Rédigé le 2026-09-17, à l'issue d'un entretien de cadrage en quatre tours et de cinq études web
(`docs/etudes/`). Ce dossier couvre la **version distribuée payante**. L'outil personnel n'y est
traité que là où il partage du code avec elle.

Il fait suite à `marche.md`, `revenus.md` et `technique.md` (16/09), et à `niches.md`,
`recherche_web.md`, `plateformes_juridique.md`, `design_figma.md` (17/09).

---

## 1. Verdict

**Go, sous une forme différente de celle envisagée le 16/09.**

Le projet est faisable techniquement, finançable à partir de rien (coût de lancement sous 50 €) et
défendable commercialement — mais pas sur la fonction qui avait motivé son ouverture. Le résumé de
page est commoditisé ; ce qui ne l'est pas, c'est **l'architecture**.

Le raisonnement en trois pas :

1. La demande la plus citée et servie par personne est un assistant navigateur qui **ne peut pas**
   exfiltrer les données de page, parce que son architecture l'en empêche — et non parce qu'il le
   promet. Trois concurrents majeurs ont été pris à envoyer le DOM brut à leurs serveurs et à des
   trackers tiers (`niches.md`, étude UC Davis/UCL). Wingpen a déjà cette architecture.
2. Cet avantage est **structurellement incopiable** par les concurrents : leur revenu vient de la
   revente de tokens, qui exige un relais. Ils ne peuvent pas retirer le relais sans détruire leur
   modèle économique.
3. Il se double d'un second fossé qui se creuse tout seul : le web se ferme aux agents et reste
   ouvert aux humains (`recherche_web.md`). Wingpen s'exécute dans un vrai navigateur, avec la
   session et l'IP de l'utilisateur.

Ce que le dossier écarte, et il faut l'écarter franchement : le grand public payant, le résumé
comme argument de vente, Figma, l'automatisation sociale, la veille en arrière-plan.

---

## 2. Le produit

Deux moitiés qui partagent un dépôt et un protocole, jamais un modèle économique.

**Wingpen perso** (existe, jalon 1 presque fini). Broker adossé au CLI Claude local et à
l'abonnement Max de l'auteur. Non distribuable : revendre un abonnement personnel est interdit par
les conditions d'Anthropic (`DECISIONS.md:T7`). Il reste l'outil quotidien et le banc d'essai.

**Wingpen distribué**, en deux niveaux :

| | Gratuit | Premium |
|---|---|---|
| Modèle | BYOK — clé de l'utilisateur, ou Ollama/LM Studio en local | idem, aucune revente de tokens |
| Fonctions | dialogue avec le modèle, lecture du DOM de la page active, résumé de page et de vidéo | + les recettes par site de la verticale |
| Rôle | acquisition, démonstration de confiance, usage perso de l'auteur | le revenu |
| Prix | 0 € | 15-20 €/mois |

Le gratuit n'est pas un essai bridé. C'est la vitrine de l'argument central — *regarde le code, rien
ne sort de ta machine* — et il est délibérément complet, parce que c'est lui qui installe la
confiance que le premium monnaie ensuite.

### ⚠️ La verticale de lancement décrite ci-dessous est invalidée (17/09, même jour)

Le contrôle ToS lancé à la rédaction de ce dossier est revenu négatif : **Arkham et CryptoQuant
interdisent tous deux explicitement l'usage d'un outil** pour accéder à leur contenu, et CryptoQuant
place le sien sous licence *NonCommercial*, ce qui exclut une fonction payante. Seul mempool.space
est libre, et il ne porte pas un produit à 15 €/mois à lui seul. Clauses citées dans
`tos_onchain.md`.

La section qui suit est conservée telle quelle : son raisonnement — pourquoi *ce type* de verticale
est le bon — reste valide, et c'est lui qui guide le choix du remplacement. Seuls les trois sites
tombent. Les enseignements du contrôle (critère de sélection en trois conditions, distinction entre
gratuit générique et premium nommé) sont devenus `DECISIONS.md:T14` et `T15`.

### La verticale de lancement : analyse on-chain *(sites invalidés, raisonnement conservé)*

Premier périmètre payant : **mempool.space, Arkham Intelligence, CryptoQuant**.

Cinq raisons, dans l'ordre de leur poids :

1. **Arkham et CryptoQuant ont des abonnements payants.** Perplexity, Comet et Atlas ne peuvent pas
   lire ces pages : ils arrivent avec une session vierge (`recherche_web.md`). Wingpen lit ce que
   l'utilisateur paie déjà. Le fossé n'est pas théorique ici, il est mesurable page par page.
2. **Le trader on-chain a la volonté de payer la plus haute de tous les segments approchés.** Il
   dépense déjà des dizaines à des centaines d'euros par mois en outils. 15 € n'est pas une
   objection.
3. **Le keywall disparaît sur ce segment.** C'est la friction la plus coûteuse du produit (§5) et
   cette audience a déjà une clé API. La contrainte s'annule là où le revenu se trouve.
4. **L'auteur est son propre utilisateur** — il suit déjà ces trois sites, et conçoit un bot de
   sniping (Mizpa). En solo, c'est la seule façon connue de faire un bon outil de niche.
5. Le domaine est dense en jargon et en chiffres mal présentés : l'écart entre la page brute et la
   page expliquée est large, donc la valeur ajoutée est visible immédiatement.

⚠️ **Point porteur non encore vérifié** : les conditions d'utilisation d'Arkham et de CryptoQuant
peuvent interdire l'usage d'une extension ou l'export de données affichées. Vérification lancée le
17/09 (worker `research-8eadaa`). **Rien ne doit être construit sur cette verticale avant son
retour.** Si l'un des trois interdit, il sort du périmètre ; si les trois interdisent, la verticale
est à remplacer — les candidates de repli sont en §10.

### Verticales suivantes, évaluées

Par ordre de solidité décroissante, à ouvrir une par une et jamais deux à la fois :

- **Information et politique** (worldmonitor, presse) — l'accès aux abonnements presse de
  l'utilisateur est exactement le fossé de `recherche_web.md`, et 79 % des grands sites d'actualité
  bloquent au moins un bot IA. Fort. Mais audience à faible volonté de payer : à traiter comme
  extension du gratuit, ou comme premium bon marché.
- **Prêt-à-porter et marchands** (Amazon, AliExpress, Temu, boutiques) — le suivi de prix est
  demandé et mal servi (`niches.md`). Mais ce que les gens veulent, c'est la surveillance en
  arrière-plan, que la contrainte du §4 interdit. Reste la comparaison à la demande. Moyen.
- **Streaming sportif** — **écarté, et fermement.** Le Chrome Web Store interdit textuellement
  « enable the unauthorized access, download, or streaming of copyrighted content »
  (`plateformes_juridique.md`). Ce n'est pas une zone à manier avec des pincettes, c'est une cause
  de retrait immédiat. Aucune version de cette idée n'est publiable.

### Écarté du périmètre distribué

- **Figma** — le canvas est rendu en WebGL, une extension ne lit que le DOM : elle est
  structurellement aveugle à la sélection et aux propriétés des calques (`design_figma.md`).
  Y accéder demanderait de livrer en plus un plugin Figma : second produit, seconde boutique,
  seconde revue.
- **psdly, gfx-hub** — redistribution de ressources sous droits (à confirmer, mais l'hypothèse
  suffit à décider). Clause CWS sur le contenu protégé. Usage perso libre, version publiée exclue.
- **4chan** — rien d'illégal à le lire, mais une recette dédiée rend l'extension invendable auprès
  du reste du marché.
- **Automatisation sociale** (publier, aimer, suivre) — retrait du store au motif « supporting
  illegal activities », et sanction sur le compte de l'utilisateur, pas sur le vendeur
  (`plateformes_juridique.md`).

---

## 3. Architecture

### Un dépôt, trois adaptateurs de modèle

Le broker perso et le broker distribué ne partagent que le protocole — mais le protocole, le
panneau et l'extraction représentent l'essentiel du travail. Un seul dépôt, avec l'accès au modèle
derrière une interface :

```
broker/src/
  protocol.ts    server.ts    config.ts    prompts.ts     ← partagés
  model/
    index.ts                   ← interface ModelAdapter + sélection
    cli.ts                     ← SDK + CLI Claude local   (perso uniquement)
    anthropic-http.ts          ← appel HTTP direct, BYOK   (distribué)
    openai-compat.ts           ← Ollama / LM Studio / OpenRouter
```

**Contrainte de build à respecter dès le refactoring** : `@anthropic-ai/claude-agent-sdk` pèse
109 Mo de `node_modules` et fait tourner le CLI Claude installé sur la machine. Il ne doit **jamais**
entrer dans le binaire distribué. L'adaptateur `cli.ts` se charge dynamiquement (`await import`)
et uniquement quand la configuration le demande. Le binaire distribué se compile par
`bun build --compile` : un exécutable unique, sans runtime à installer.

L'adaptateur `openai-compat.ts` mérite mieux qu'une note de bas de page : l'intégration
Ollama/LM Studio « en première classe et non en mode dégradé » est la **demande non servie n°3** de
`niches.md`. Elle coûte un adaptateur et elle supprime le keywall pour les utilisateurs équipés.

### Le distribué n'a pas de serveur, sauf un

Trois serveurs possibles avaient été confondus au cours du cadrage. Le tri :

| | Retenu ? | Coût | Ce qu'il voit |
|---|---|---|---|
| **(A) Licences** — qui a payé | **oui, obligatoire** | 0-5 €/mois (Cloudflare Workers, palier gratuit) | un identifiant de licence, jamais de contenu |
| **(B) Synchronisation** — état par utilisateur entre machines | **non, reporté** | hébergement + RGPD + sauvegardes + responsabilité de fuite | des données d'utilisateur |
| **(C) Relais d'inférence** | **non** | trésorerie avancée, astreinte, abus à surveiller | tout le contenu de page |

(A) est incontournable : sans lui le premium se déverrouille en trente secondes. Il tient en
quelques dizaines de lignes, et il doit **échouer en laissant passer** — si le serveur de licences
tombe, le premium reste actif ; on ne punit pas un client payant pour une panne.

(B) a été demandé pour « les réglages et repères d'outillage sur les sites très utilisés ». Après
examen, ce n'est pas un besoin de synchronisation : ces repères sont de la **donnée produit**,
écrite par l'auteur, identique pour tous, et qui descend vers les utilisateurs sans jamais remonter
de personne. Elle se distribue en fichier statique (§4), pour zéro euro et zéro exposition. (B) ne
redevient utile que pour synchroniser les données *propres* à chaque utilisateur entre ses machines
— confort, pas fonction, et à ne construire que si des clients le réclament.

Sur le chiffrement au repos évoqué pendant le cadrage : une partition chiffrée protège contre le
vol physique du disque, pas contre la menace réelle — une faille applicative, où le service lit sa
propre base en clair puisqu'il tourne. La seule protection robuste est de **ne pas détenir la
donnée**. C'est d'ailleurs l'argument de vente.

---

## 4. Contraintes dures

### La règle du geste

> **Wingpen accompagne un geste de l'utilisateur, il n'en fabrique jamais.**

Cette règle n'est pas une précaution morale, c'est la condition d'existence du produit. Les trois
études convergent exactement sur la même ligne :

| | Côté licite | Côté interdit |
|---|---|---|
| Cloudflare (taxonomie juillet 2026) | humain en temps réel | boucle automatisée = catégorie *Agent*, bloquée par défaut depuis le 15/09/2026 sur toute page avec publicité |
| ToS des plateformes | l'utilisateur agit, l'outil assiste | l'outil agit à sa place (ban du compte de l'utilisateur) |
| Chrome Web Store | enrichir ce qui est affiché | extraire en volume, transmettre, contourner |

Franchir la ligne fait perdre les trois protections d'un coup. Elle interdit donc : le suivi de prix
en arrière-plan, la veille automatique, le crawl multi-pages, la publication programmée, toute
boucle sans geste. Elle autorise tout ce qui part d'un clic sur la page ouverte.

**Sur l'affichage de cette contrainte à l'utilisateur** — l'idée d'indiquer dans chaque réponse ce
que Wingpen a le droit de faire a été examinée et écartée pour trois raisons. Le Chrome Web Store
juge le **code**, pas l'interface : une extension qui automatise en affichant un avertissement est
retirée comme les autres, la responsabilité ne se transfère pas par mention légale. L'encart
juridique répété reproduit la plainte n°5 de `niches.md` (« UX écrasante »), alors que la simplicité
est ce qu'on vend. Et surtout, expliquer *comment* contourner une restriction est qualifié de
**facilitation** par la politique CWS — le mot y figure : une extension qui refuse d'agir mais
publie le mode d'emploi est plus exposée qu'une qui se tait.

La forme retenue : la contrainte vit **dans le code** (la fonction n'existe pas), elle est énoncée
**une fois** à l'installation et dans les CGU, et un message contextuel d'une ligne n'apparaît que
si l'utilisateur demande quelque chose que Wingpen ne fera pas.

### Les quatre règles de sécurité

Inchangées, rappelées dans `CLAUDE.md` et `MEMORY.md` : aucun secret dans `chrome.storage.local` ;
broker sur `127.0.0.1` avec vérification d'`Origin` et jeton de pairage ; contenu de page traité
comme donnée et jamais comme instruction ; pas de `<all_urls>`.

### Les recettes par site : déclaratives et signées

Une recette décrit comment lire un site : sélecteurs CSS, noms de champs, gabarit de prompt. Elle
est publiée sur un CDN et récupérée au démarrage.

**Elle ne doit contenir aucun code exécutable.** Deux raisons qui se renforcent : Manifest V3
interdit le code distant (« the full functionality of an extension must be easily discernible from
its submitted code ») — c'est une cause de retrait automatique ; et un CDN compromis deviendrait
sinon une exécution de code arbitraire dans l'extension de tous les utilisateurs.

Donc : format déclaratif strict, validé contre un schéma avant usage, **signé** (Ed25519, clé
publique embarquée dans l'extension), signature vérifiée avant chargement. Le gabarit de prompt est
couvert par la signature — sans quoi une recette altérée devient un vecteur d'injection.

Le bénéfice opérationnel est considérable : quand un site change son HTML un dimanche soir, la
recette se corrige en poussant un fichier, sans nouvelle version de l'extension ni passage par la
revue du store.

---

## 5. Le keywall

C'est le problème d'ergonomie central du projet, et il est spécifique au BYOK.

Les concurrents offrent trois clics et ça parle. Wingpen demande de créer un compte API et de coller
une clé **avant la première réponse**, y compris dans le tier gratuit. La majorité des installs se
perd là, avant même que le premium existe. Ce n'est pas rédhibitoire — HARPA vit avec — mais
l'entonnoir de Wingpen ne ressemble pas à celui des benchmarks de `revenus.md`, et il faut le
concevoir explicitement au lieu de le subir.

Trois décisions qui en découlent :

1. **La promesse premium doit être visible avant la demande de clé.** Personne ne franchit un mur
   pour découvrir ce qu'il y avait derrière. L'écran d'accueil montre ce que fait Wingpen sur une
   page réelle, puis demande la clé.
2. **Deux chemins d'entrée, pas un** : clé API, ou serveur local (Ollama/LM Studio) détecté
   automatiquement. Le second n'a aucune clé à coller et aucun coût à l'usage.
3. **Un guide en images dans le panneau**, trois captures d'écran, pas une page d'aide externe.

Ce qui reste écarté : offrir quelques requêtes sur le compte de l'auteur. Le coût n'est pas le
montant, c'est de devenir opérateur d'inférence — facture, abus à surveiller, astreinte — soit
exactement le (C) que le BYOK sert à éviter.

---

## 6. Économie

### Coût de lancement

| Poste | Montant |
|---|---|
| Frais développeur Chrome Web Store | 5 $ une fois |
| Firefox AMO | 0 € |
| Domaine (`wingpen.app` ou `.dev`) | ~15-20 €/an |
| Site vitrine + CDN des recettes (Cloudflare Pages ou GitHub Pages) | 0 € |
| Serveur de licences (Cloudflare Workers, palier gratuit) | 0-5 €/mois |
| **Total avant premier euro encaissé** | **sous 50 €** |

Le projet est finançable à partir de rien. C'est une conséquence directe du BYOK : pas de
trésorerie d'inférence à avancer.

**Coût différé volontairement** : la signature de code du broker (certificat Windows ~300-400 €/an,
Apple Developer 99 $/an). Non signé, le broker déclenche un avertissement SmartScreen sur Windows et
un blocage Gatekeeper sur macOS. Pour la verticale on-chain — audience technique — une distribution
par `brew`, `scoop`, `npm` ou binaire brut avec instructions est acceptable au lancement. La
signature devient nécessaire le jour où on s'adresse à un public non technique, pas avant.

### Encaissement

**Paddle** ou **Lemon Squeezy** comme marchand de référence, pas Stripe nu. Motif : sur un
abonnement vendu à un particulier de l'UE, la TVA est due dans le pays de l'acheteur — 19 % en
Allemagne, 20 % en France, 27 % en Hongrie. Le marchand de référence est juridiquement le vendeur :
il collecte et reverse la TVA de chaque pays, gère remboursements et fraude, et verse un virement
mensuel qui se déclare en une ligne. Coût : ~5 % + 0,50 $ par transaction, contre ~2,9 % chez
Stripe. Deux points de commission pour ne jamais toucher à la TVA intracommunautaire.

### Seuils, à 15 €/mois

Net après commission marchand (~5 % + 0,50 $) et cotisations auto-entrepreneur BNC (~25 % en 2026) :
**≈ 10,30 € par abonné et par mois**.

| Scénario | Actifs hebdo | Conversion | Abonnés | Net mensuel |
|---|---|---|---|---|
| Pessimiste | 2 000 | 2 % | 40 | ~410 € |
| Médian | 8 000 | 4 % | 320 | ~3 300 € |
| Optimiste | 25 000 | 5 % | 1 250 | ~12 900 € |

Conversion exprimée en pourcentage des **actifs hebdomadaires**, jamais des installs
(`revenus.md`). Le taux retenu est supérieur aux 2-3 % des benchmarks généralistes parce que le
gratuit ne sert pas du tout l'audience visée : pour un trader on-chain, le premium est la seule
chose qui l'intéresse.

**Pourquoi 15 € et pas 3 €.** À 3 €/mois et 3 % de conversion, il faut 5 500 actifs hebdomadaires
pour 500 €/mois et 22 000 pour 2 000 €. À 15 € sur une niche professionnelle, les mêmes 2 000 €
demandent 4 400 actifs — cinq fois moins. Or pour un solo sans budget d'acquisition, la ressource
rare n'est pas le prix, c'est l'utilisateur : chaque install se gagne à la main. Diviser le prix par
cinq multiplie par cinq le seul travail qui ne s'accélère pas. Le tarif bas est cohérent avec un
produit grand public généraliste — celui que les deux études du 16/09 donnent pour bouché.

**Pas de tarif à vie** (décision de l'auteur, prise malgré la pratique de HARPA à 240 $).

**Plafond de statut** : le régime auto-entrepreneur plafonne à 77 700 € de chiffre d'affaires en
prestations de services, soit ~6 475 €/mois, atteint autour de **470 abonnés**. Au-delà, passage en
société (EURL ou SASU). À anticiper dans le scénario médian, qui frôle ce seuil. La franchise de TVA
et le traitement des sommes versées par un marchand de référence étranger sont à confirmer avec un
comptable — ce dossier ne tranche pas une question fiscale.

---

## 7. Jalons

45 h par semaine disponibles, objectif « le plus tôt possible ». Le chemin critique n'est pas le
code, c'est la revue du store : 4 à 8 semaines rapportées, hors travail.

**Jalon 1 — finir ce qui existe** (~1 semaine)
Le panneau n'a jamais été manipulé par un humain : chat, trois boutons, bibliothèque de prompts
écrits mais jamais cliqués. Extraction YouTube jamais éprouvée sur une vraie vidéo. Reconfirmer que
le WebSocket vers `127.0.0.1` passe sans permission sur le Chrome **quotidien**, pas seulement sur
Chrome for Testing 154 en headless (`DECISIONS.md`, risque 1). Icônes.

**Jalon 2 — le distribué** (~6 semaines)
1. Refactoring `model.ts` en trois adaptateurs, chargement dynamique du SDK. *(3-4 j)*
2. Adaptateur BYOK HTTP + adaptateur OpenAI-compatible pour Ollama. *(4-5 j)*
3. Keywall : accueil, détection d'Ollama, guide en trois images. *(1 sem)*
4. Format de recette : schéma, signature Ed25519, vérification, chargement CDN. *(4-5 j)*
5. Trois recettes on-chain — **sous réserve du retour ToS**. *(1 sem)*
6. Serveur de licences + Paddle, échec en laissant passer. *(4-5 j)*
7. Packaging `bun build --compile` sur les trois systèmes. *(3-4 j)*
8. Dossier de boutique : politique de confidentialité, divulgation *Limited Use*, captures,
   description, justification de chaque permission. *(3-4 j)*

**Jalon 3 — soumission et attente** (4-8 semaines, sans travail)
Soumission visée début novembre 2026. Publication réaliste entre décembre 2026 et janvier 2027.
Firefox une fois Chrome validé (`DECISIONS.md:T1`).

Le point 8 mérite son temps : `localhost` plus permissions d'hôte plus WebSocket vers un démon local
place le dossier en revue manuelle quasi certaine. Un dossier soigné est ce qui distingue quatre
semaines de huit.

---

## 8. Registre des risques

| # | Risque | Gravité | Parade |
|---|---|---|---|
| 1 | **Local Network Access** — la fenêtre WebSocket se referme côté Chromium (crbug.com/421156866) | fatale pour l'archi | repli documenté : canal `fetch` avec permission demandée depuis le panneau (un document, pas le service worker). À reconfirmer sur Chrome quotidien avant soumission. |
| 2 | **Revue de boutique** — rejet ou 8 semaines d'attente | retard, pas mort | dossier soigné (jalon 2.8), permissions minimales, code non obfusqué |
| 3 | ~~ToS de la verticale~~ — **survenu le 17/09.** Arkham et CryptoQuant interdisent | a tué la verticale, pas le produit | `tos_onchain.md`. Devenu un processus permanent : `DECISIONS.md:T14`, contrôle ToS avant toute recette payante |
| 4 | **Les sites changent leur HTML** — les recettes cassent | coût récurrent permanent | c'est le vrai coût du produit, pas un incident ; atténué par la publication CDN sans revue |
| 5 | **Reclassement Cloudflare** — Wingpen classé *Agent* | perd le fossé n°2 | la règle du geste (§4), tenue sans exception |
| 6 | **Keywall** — l'entonnoir d'installation s'effondre | plafonne le revenu | §5 ; le chemin Ollama ; la verticale choisie a déjà des clés |
| 7 | **Bundling par les gros** | tue le gratuit, pas le premium | le gratuit est un canal d'acquisition, pas une source de revenu — perdre cette bataille était prévu |
| 8 | **Plafond auto-entrepreneur** à ~470 abonnés | bon problème | passage en société, à préparer avant de l'atteindre |
| 9 | **Verticale unique** — toute la recette dans un panier | structurel | ouvrir la suivante dès que la première tient, une à la fois |
| 10 | **Frontière du broker** — rien n'arrête un programme tournant déjà sous le même compte | assumée | identique à Pyramid ; à dire dans la documentation plutôt qu'à masquer |

---

## 9. Ce qui change dans les décisions du 16/09

- **P2** (tension grand public / développeurs) — **tranchée** : le gratuit est grand public, le
  payant est vertical et professionnel. La tension disparaît sans renier l'usage quotidien.
- **P3** (résumé comme fonction phare) — **confirmée comme fonction, écartée comme argument de
  vente**. Le résumé sert l'acquisition et l'auteur.
- **P4** (différenciateur : vérification front-end + SEO live) — **amendée**. Le mécanisme est
  conservé — vrai navigateur, vraie session — mais la cible commerciale devient l'analyse on-chain.
  La vérification front-end reste le lien avec Pyramid (`L2`), pas l'argument de vente.
- **T7** (BYOK pour le distribué) — **confirmée et renforcée** : c'est devenu l'argument central, et
  non une contrainte subie.

Décisions à ajouter (proposées) : verticale on-chain, gratuit comme canal d'acquisition, prix
15-20 €, refus du tarif à vie, un dépôt et trois adaptateurs, recettes déclaratives signées sans
code distant, pas de serveur de synchronisation au lancement, règle du geste.

---

## 10. À vérifier avant d'écrire une ligne de code

1. **ToS Arkham, CryptoQuant, mempool.space** — en cours, bloquant pour la verticale.
2. **WebSocket vers `127.0.0.1` sur le Chrome quotidien**, en mode fenêtré, profil réel. Le test du
   16/09 était en headless sur Chrome for Testing 154 : un prompt de permission ne pouvait pas s'y
   afficher.
3. **Existence de Claude Design** — les trois sources sont des agrégateurs de communiqués, jamais
   `anthropic.com` (`design_figma.md`). Sans conséquence sur ce dossier, mais à ne pas propager.
4. **Nature de psdly et gfx-hub** — l'hypothèse de redistribution sous droits suffit à les exclure
   du périmètre distribué ; à confirmer si on veut les réintégrer un jour.
5. **Traitement fiscal des versements d'un marchand de référence** pour un auto-entrepreneur
   français — avec un comptable, pas avec une recherche web.
