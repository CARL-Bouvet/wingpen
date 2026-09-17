# Étude — douleurs et niches non servies chez les concurrents (2026-09-17)

Source : worker `research-93b686` (sonnet46, pyr-search + firecrawl). Rapport brut, non retravaillé.
Angle 1 sur 4 de la cartographie des niches libres.

## Douleurs récurrentes

**1. Vie privée : exfiltration silencieuse des données de navigation**
Les extensions envoient le DOM complet (incluant champs de formulaire, SSN, historique médical) à leurs propres serveurs *et* à des trackers tiers (Google Analytics), souvent en dehors de toute interaction explicite de l'utilisateur. Sider, Merlin et HARPA capturent le HTML brut ; Merlin a capturé des inputs de formulaire (numéros de sécurité sociale sur des sites bancaires). Certaines extensions promettent explicitement de ne pas collecter les données mais sont prises en flagrant délit par analyse de trafic réseau.
(source: https://www.theregister.com/2025/03/25/generative_ai_browser_extensions_privacy/ — étude UC Davis / UCL / Mediterranea, mars 2025)

**2. Paywalls opaques et quotas gratuits épuisés trop vite**
Le free tier de HARPA disparaît sans avertissement clair ; des utilisateurs se retrouvent bloqués sur des modèles gratuits (GPT-3.5) avec des erreurs de crédit inexplicables. La valeur de l'extension s'effondre immédiatement à la limite.
(source: https://www.reddit.com/r/chrome_extensions/comments/1gwznvg ; https://www.producthunt.com/products/harpa-ai/reviews)

**3. Support inexistant**
Un utilisateur HARPA rapporte avoir passé des heures à chercher un contact humain sans succès, après un bug de crédit côté serveur — et avoir créé plusieurs comptes en vain.
(source: https://www.producthunt.com/products/harpa-ai/reviews — avis 1 étoile Daniel Frank)

**4. Méfiance envers l'origine des extensions (Chine)**
Monica et Sider sont régulièrement écartées sur Reddit pour leur propriétaire chinois supposé, indépendamment de leurs fonctionnalités. La simple géographie des serveurs est un frein d'adoption.
(source: https://www.reddit.com/r/ChatGPT/comments/1c5b6k3/ ; https://www.theregister.com/2025/03/25/generative_ai_browser_extensions_privacy/)

**5. UX surchargée / courbe d'apprentissage**
HARPA et MaxAI sont régulièrement décrits comme « overwhelming » pour les nouveaux utilisateurs ; l'ancienne interface de HARPA est citée comme source de confusion.
(source: https://www.producthunt.com/products/harpa-ai/reviews)

## Demandes non servies

**1. Vrai BYOK/BYOM sans transit par les serveurs de l'éditeur**
Les utilisateurs veulent brancher leur propre clé API (OpenAI, Anthropic, Groq) *directement*, sans que l'extension interpose un serveur intermédiaire qui reçoit aussi le contenu de page. HARPA le propose techniquement mais en faisant peser sur l'utilisateur la configuration d'un LLM local (Ollama). Aucun acteur ne propose un BYOK pur avec architecture zero-relay vérifiable par design.
(source: https://www.theregister.com/2025/03/25/generative_ai_browser_extensions_privacy/ — réponse HARPA ; https://gptbreeze.io/blog/top-10-byom-ai-chrome-extensions-comparison-guide/)

**2. Architecture privacy-by-design auditée (pas seulement promise)**
Les promesses écrites (« we do not collect user data ») ont été démenties par analyse réseau pour Monica et HARPA. Les utilisateurs cherchent un acteur dont l'architecture *structurellement* empêche l'exfiltration (broker local, zéro cloud propre).
(source: https://www.theregister.com/2025/03/25/generative_ai_browser_extensions_privacy/ ; https://cabina.ai/blog/5-best-monica-ai-alternatives-to-use/)

**3. Intégration locale (Ollama/LM Studio) first-class, pas en mode dégradé**
Mentionné par des utilisateurs tech sur Reddit et dans la réponse HARPA elle-même comme solution aux problèmes de vie privée — mais aucun acteur n'en fait une fonctionnalité centrale et guidée.
(source: https://www.theregister.com/2025/03/25/generative_ai_browser_extensions_privacy/)

**4. Monitoring de prix / alertes multi-sites sans abonnement**
HARPA est apprécié pour le price tracking mais son free tier trop court tue l'usage. Aucun concurrent ne reprend cette feature avec un modèle économique viable pour l'utilisateur occasionnel.
(source: https://www.producthunt.com/products/harpa-ai/reviews — avis Maria Aceti)

## Signaux faibles

- **Extraction de données structurées depuis pages web** (keywords, articles, tableaux) citée à plusieurs reprises comme cas d'usage principal justifiant l'installation, mais mal servie sans plan payant.
- **Détection AI / contournement de détecteurs** — un utilisateur HARPA mentionne modifier légèrement les sorties « pour passer un détecteur AI » : usage réel non assumé par les acteurs.
- **Confiance géographique** comme critère de choix primaire chez les utilisateurs non-techniques, au-dessus des fonctionnalités — niche pour un acteur européen/open-source auditable.
- **Transcription vidéo + action** (YouTube → résumé → email) cité comme workflow cible, mais fragile dès que la page change de structure.
