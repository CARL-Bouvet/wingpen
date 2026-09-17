# Étude — assistance IA sur les outils de design (2026-09-17)

Source : worker `research-bc01ff` (sonnet46, pyr-search + firecrawl). Rapport brut, non retravaillé.
Angle 4 sur 4 de la cartographie des niches libres.

## « Claude Design » — existe ou non

**Verdict du worker : existe.** Anthropic aurait lancé **Claude Design** le 17 avril 2026 sous l'étiquette Anthropic Labs — outil de collaboration visuelle pour créer designs, prototypes, slides et one-pagers avec Claude.

> « Anthropic is launching Claude Design, a new Anthropic Labs product that lets you collaborate with Claude to create polished visual work like designs, prototypes, slides, one-pagers, and more. »

(sources: https://markets.businessinsider.com/news/stocks/anthropic-introduces-claude-design-by-anthropic-labs-1036034747 ; https://cryptorank.io/news/feed/35c69-anthropic-claude-design-launch ; https://dapta.ai/blog-posts/ai-news-week-16-claude-design)

⚠️ **Réserve de fiabilité (admin, 17/09)** : les trois sources sont des agrégateurs de communiqués, pas la source primaire. La page produit Anthropic n'a pas été consultée. À reconfirmer sur `anthropic.com` avant de fonder quoi que ce soit dessus. Retenir en revanche le point structurel, lui indépendant de la date : c'est une surface autonome, sans accès au canvas Figma.

## Figma — IA native et ce que l'API plugin autorise

Suite IA 2026 : **Figma Agent** (beta mai 2026, remplace First Draft — prompt-to-design, bulk edits conscients du design system, critique par persona) ; **Figma Make** (text-to-app, export React+TS) ; **Figma Weave** (génération d'assets, 12+ modèles) ; **Dev Mode + MCP** (pipe le contexte design vers Claude Code, Cursor, Codex) ; **Code Layers** (layer-to-code, early access juillet 2026) ; partenariat **Figma × Anthropic** « Code to Canvas » avec Claude Sonnet 4.6.

Limites signalées : meilleures fonctions en closed beta, crédits qui brûlent vite, fragmentation sur 4 surfaces.

**L'API plugin autorise** : lecture et écriture complètes sur tous les nœuds du canvas (couleur, position, hiérarchie, texte, composants), accès aux APIs navigateur depuis l'iframe du plugin (réseau, WebGL, WASM). Contraintes : pas d'exécution en arrière-plan, composants tiers seulement s'ils sont déjà importés dans le fichier.
(source: https://developers.figma.com/docs/plugins/)

## Extension navigateur sur Figma — faisable ?

**Verdict tranché : une extension est structurellement aveugle au canvas Figma.**

Le canvas est rendu en **WebGL**. Les nœuds de design (calques, composants, propriétés) vivent en mémoire GPU, pas dans le DOM HTML. Une extension ne lit que le DOM : elle ne voit ni la sélection courante, ni les propriétés d'un calque, ni le contenu du canvas.

Ce qu'une extension peut faire : lire l'URL et les métadonnées de la page, injecter une UI latérale, appeler la **REST API Figma** (accès fichier, pas temps réel), capturer le presse-papier ou les raccourcis clavier.

Ce qu'elle ne peut pas faire sans plugin Figma : lire les nœuds et propriétés du canvas en temps réel, réagir à la sélection courante.

Seule voie viable : **coupler l'extension à un plugin Figma** qui tourne à l'intérieur et transmet les données par un pont. Le dépôt `figma-viewer-chrome-plugin` le confirme : « Due to limitations in the Plugin API context, the extension uses a canvas click listener as a workaround. »
(source: https://deepwiki.com/hallee9000/figma-viewer-chrome-plugin/3.3-figma-api-integration)

**Conséquence pour Wingpen** : l'extension seule ne peut pas agir sur le canvas. Il faudrait livrer un second produit (un plugin Figma) ou se limiter à la couche méta.

## Besoin non servi

- **Éducation absente** : les outils IA de Figma génèrent ou automatisent — aucun n'explique *pourquoi* une décision de design est juste ou fausse, ni n'enseigne pendant la manipulation. [UNVERIFIED sur la totalité du marché plugin, mais aucun outil dominant identifié]
- **Figma AI inaccessible aux étudiants** : les plans Éducation n'ont pas accès aux fonctions IA (forum Figma, mai 2026) — gap structurel pour l'apprentissage. (source: https://forum.figma.com/report-a-problem-6/why-don-t-i-have-figma-ai-features-on-my-education-plan-45624)
- **Critique contextuelle** : la « persona-based critique » de Figma Agent est en closed beta et réservée aux plans payants — créneau visible, non couvert au quotidien.
- **Fragmentation** : 4 points d'entrée sans cohérence pédagogique ; une couche transversale d'explication serait complémentaire, pas concurrente.
