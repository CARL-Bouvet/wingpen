# Enquête métier — potentiel de revenus (2026-09-16)

Source : worker `research-ca3e1f` (sonnet46, pyr-search + firecrawl). Rapport brut.

Différenciateurs évalués : (1) pont navigateur réel ↔ orchestrateur local, (2) BYOK / modèle local, (3) vérification front-end sur la page rendue, (4) SEO live in-browser, (5) résumé page + YouTube.

## 1. Segments qui paient

- **Développeurs** : le mieux converti. Outils dev (sélecteurs CSS, scraping, QA) tiennent $7-15/user/mois en équipe. (source: nichecheck.com/blog/chrome-extension-market-size-2026)
- **SEO/Marketing** : achètent la plateforme (Ahrefs, Semrush) qui bundle l'extension gratuitement → volonté de payer l'extension seule faible, sauf différenciation forte.
- **Sales/recrutement** : extensions gardées derrière l'abonnement plateforme.
- **Recherche/étudiants** : résumés — segment très large, ARPU bas (<$5/mo) [UNVERIFIED].
- Marché total des extensions : $7,8 Md en 2024, +23 % YoY (Forbes 2025, via chromegoldmine.com).

## 2. Marché du « browser control pour agents »

100 % B2B infrastructure, pas grand public :
- **Browserbase** : Free → $20/mo (100 h navigateur) → $99/mo (500 h) → Enterprise. 1000+ clients (Perplexity, Vercel), 50 M sessions en 2025, Series B $40 M. (source: browserbase.com/pricing)
- **Browser Use** : open-source + cloud, tarifs non publiés clairement.
- **Perplexity Comet / OpenAI browser agent / Claude in Chrome** : pas de grille autonome, bundlés Pro/Enterprise [UNVERIFIED].

Le créneau « pont vers orchestrateur local » est **orthogonal** : Browserbase vend du headless cloud, nous vendrions « mon vrai navigateur, mon LLM local ». Aucun concurrent direct identifié sur ce positionnement.

## 3. SEO

Les extensions SEO rentables **ne se monétisent pas seules** — elles sont des portes d'entrée d'abonnement plateforme. Ahrefs/Semrush toolbars : gratuites avec la plateforme ($99-399/mo). Detailed SEO, SEO Minion : gratuits. Keywords Everywhere (crédits, ~$10-50/mo) est l'exception [UNVERIFIED tarifs actuels].

Un add-on SEO vendu seul doit offrir une donnée exclusive (SERP live, Core Web Vitals sur la page rendue) ou servir d'aimant vers une plateforme. Valeur estimée $10-30/mo pour un pro si crawl + CWV + on-page en une action.

## 4. Réalisme pour un solo dev

Benchmarks publiés (source: chromegoldmine.com/blog/chrome-extension-monetization/chrome-extension-revenue-benchmarks) :

| Utilisateurs actifs | MRR réaliste (freemium 2-5 %) |
|---|---|
| 2 000-10 000 | $100-1 500/mo |
| 10 000-50 000 | $500-7 500/mo |
| 50 000+ | $2 500-30 000/mo |

Cas réel cité : 50 000 users → $21k ARR à <1 % de conversion. Le levier principal est **le placement du paywall**, pas le volume d'installs. Distribution : Chrome Web Store organique + Product Hunt + SEO ; aucun canal payant efficace sur ce segment. Conversion freemium → payant : 2-5 % des **actifs hebdomadaires**, pas du total d'installs. Niche pro (dev, SEO) → ARPU 2-5× l'outil généraliste.

## 5. Risques commerciaux

1. **Local Network Access** — critique pour le différenciateur n°1. Chrome 138 (opt-in), puis livré par défaut. Toute extension touchant `127.0.0.1` déclenche un prompt de permission ; à gérer explicitement sinon l'UX casse en silence. ⚠️ Divergence de dates entre les deux études (Chrome 139 vs 142) — non tranché, mais la contrainte est active aujourd'hui dans les deux cas. (sources: developer.chrome.com/blog/local-network-access, steeleobrienconsulting.com/blog/chrome-local-network-access)
2. **Dépendance plateforme** : MV3 restreint `<all_urls>` ; une extension qui le demande est signalée et peut être retirée sans préavis.
3. **Bundling par les gros** : Perplexity Comet, OpenAI browser agent, Claude in Chrome construisent tous le différenciateur n°5 (résumé) et le bundlent dans leur Pro. Un solo dev ne tient pas sur les features génériques.
4. **Friction de revue** : `localhost` + host permissions larges + WebSocket vers un démon local → cycle de revue 4-8 semaines, rejets fréquents.
5. **BYOK** : fort en argument de confidentialité, faible en réduction de coût perçue par qui n'a pas déjà une stack locale. Cible réduite aux devs équipés.

## Verdict

Créneau **défendable mais étroit** : développeurs full-stack et SEO techniques qui ont déjà un LLM local et veulent un pont navigateur → orchestrateur sans exposer leurs tokens. Ce segment paie $15-30/user/mois pour un outil pro ciblé.

Différenciateur le plus monétisable : **n°3, la vérification front-end sur la page rendue** — personne ne fait ce pont « orchestrateur local ↔ DOM réel » — couplé à **n°4, le SEO live**.
Différenciateur n°5 (résumé page/vidéo) : **à écarter commercialement**, commoditisé par Perplexity/OpenAI/Claude. (Reste parfaitement légitime comme fonction perso.)
Risque à lever avant tout lancement : tester et documenter le prompt Local Network Access.
