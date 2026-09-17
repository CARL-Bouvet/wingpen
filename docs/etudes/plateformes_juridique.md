# Étude — YouTube et réseaux sociaux : ce qui est permis, ce qui fait retirer (2026-09-17)

Source : worker `research-3cbc83` (sonnet46, pyr-search + firecrawl). Rapport brut, non retravaillé.
Angle 3 sur 4 de la cartographie des niches libres.

## YouTube

**Interdit par les ToS** (section 5.B) : tout accès automatisé par robots, bots ou scrapers, sauf moteurs de recherche publics ou accord explicite. La lecture des transcriptions par automation non-officielle est en zone grise — aucune API publique ne la couvre, et la Data API v3 interdit explicitement le scraping (« You and your API Clients must not… scrape YouTube Applications »).
(sources: https://www.youtube.com/static?template=terms ; https://developers.google.com/youtube/terms/developer-policies)

**Ce qui a causé des retraits** : les extensions de téléchargement vidéo sont le cas le plus documenté. Le Chrome Web Store les liste explicitement parmi les produits **non mis en avant** (« video downloaders »). Elles restent disponibles mais à risque de retrait sur plainte DMCA ou signalement ToS. Toute extension contournant un paywall est interdite (CWS, *Malicious and Prohibited Products* §4).
(source: https://developer.chrome.com/docs/webstore/program-policies/policies)

## Réseaux sociaux — ToS et jurisprudence

**La ligne de partage légale est le login, pas la publicité du contenu.**

- **hiQ v. LinkedIn** (9e Circuit, 2019 + 2022) : le CFAA ne couvre pas le scraping de données publiquement accessibles *sans connexion*. Mais hiQ a été condamné ($500k, injonction déc. 2022) pour avoir utilisé de faux comptes afin d'accéder à des données *sous login*. Session connectée = ToS contractuellement opposables.
- **Meta v. Bright Data** (jan. 2024) : un juge fédéral a statué que Bright Data, non connecté, n'était pas partie aux ToS de Meta. Meta a abandonné le mois suivant. Affaiblit les plateformes contre le scraping *logged-out* de données publiques.
- **Conséquence pour une extension** : agir dans la session connectée de l'utilisateur la lie aux ToS via le compte. Violation → ban du compte **de l'utilisateur**, pas forcément poursuite.
(source: https://inboundlabs.app/blog/is-linkedin-scraping-legal)

LinkedIn, X/Twitter, Instagram et Reddit interdisent tous le scraping automatisé sous compte connecté et les interactions automatisées (likes, follows, posts en masse). L'UE ajoute le RGPD : extraire des données personnelles d'utilisateurs UE est un traitement soumis à base légale, quelle que soit la publicité du profil.
[UNVERIFIED pour les ToS de chaque plateforme prise individuellement — non scrappés directement]

## Politique Chrome Web Store applicable

(source: https://developer.chrome.com/docs/webstore/program-policies/policies, màj 2025-05-22)

| Règle | Texte |
|---|---|
| Contournement paywall/login | « Do not facilitate unauthorized access to content on websites, such as **circumventing paywalls or login restrictions**. » |
| Contenu sous droits | « Do not encourage, facilitate, or enable the **unauthorized access, download, or streaming of copyrighted content**. » |
| Permissions minimales | « Request access to the **narrowest permissions** necessary. » |
| Usage limité des données | « Collection and use of web browsing activity is prohibited, except to the extent required for a **user-facing feature described prominently**. » |
| Transparence | Politique de confidentialité obligatoire + consentement explicite avant collecte. |
| MV3 — code lisible | « The full functionality of an extension must be easily discernible from its submitted code. » Pas de logique distante. |
| Video downloaders | Non promus (*not featured*), tolérés mais sous surveillance. |

## Cas réels de retrait

- **YouTube downloaders** : pas bannis systématiquement mais *unfeatured* par politique, retirés sur plainte DMCA ou signalement ToS. Vagues documentées lors des campagnes anti-adblockers 2024. (sources: CWS policies ; https://news.filehippo.com/2024/08/august-3-tech-news-roundup-chrome-may-soon-stop-supporting-old-extensions-youtube-frustrates-ad-blocker-users-apple-releases-security-updates-for-old-devices/)
- **Génération de faux avis / automation sociale** : retirées pour « supporting illegal activities » + spam automation. Un papier Arxiv 2025 note que celles qui *« automate actions like liking content »* échappent temporairement à la détection mais sont traquées activement. (source: https://arxiv.org/html/2503.04292v2)
- **Credential stuffing / création de faux comptes** : retrait immédiat, coopération avec les forces de l'ordre. (source: https://tryhoverify.com/blog/5-browser-extension-patterns-that-will-get-you-banned-from-the-chrome-store)
- **Code obfusqué** : retrait automatique sous MV3 si la logique n'est pas entièrement lisible dans le paquet soumis. (source: CWS policies, section MV3)

## Zone sûre — ce qu'une extension prudente peut livrer

1. **Lire le DOM de la page active avec `activeTab`** (pas `<all_urls>`) — la page est déjà chargée par l'utilisateur, l'extension en lit le texte affiché. Acceptable si divulgué ; ne constitue pas un « accès non autorisé ».
2. **Extraire la transcription YouTube depuis l'UI déjà rendue** (le texte est dans le DOM si l'utilisateur a ouvert la piste CC) — pas de fetch vers les APIs internes de YouTube, pas de boucle sur plusieurs vidéos sans geste utilisateur.
3. **Afficher, reformater ou annoter ce que l'utilisateur voit** (overlay, panneau) — le CWS punit l'extraction et la transmission, pas l'affichage enrichi.
4. **Envoyer au broker local (`127.0.0.1`)** plutôt qu'à un serveur tiers — réduit l'exposition à la politique *Limited Use* et le risque de fuite de session.
5. **Demander les permissions d'hôte à l'exécution** plutôt qu'au manifest — réduit la friction de revue et rassure l'utilisateur.

**À éviter absolument** : toute boucle automatisée sur des pages (scroll/fetch sans geste utilisateur), tout envoi de données de session ou de cookies vers l'extérieur, toute interaction automatisée (like, post, follow), et toute extraction de données structurées en volume, même sur du contenu « public », sous session connectée.
