# Étude — un module payant pour les annonces immobilières (2026-09-25)

Question de Romain : un module payant qui « fait le lien avec tous les éléments importants de
l'annonce », à la manière de lacquereur.fr, a-t-il sa place dans Wingpen ?
Recherches brutes : `notes/recherche_immo_concurrents.md`, `notes/recherche_immo_donnees.md`.

## Avis

Oui, sous une condition : que la lecture gratuite d'une annonce soit fiable d'abord. Le 25/09,
sur une fiche bienici, l'extension a lu le bandeau de consentement au lieu de l'annonce
(`notes/BUG_extraction_le_bandeau_de_consentement_*`).

Le module s'inscrit dans ce qui est déjà décidé :
- le gratuit lit n'importe quelle page, le payant vise des sites nommés (T15) ;
- ce qui se vend, c'est la fraîcheur des recettes et la commodité (P17) ;
- le choix de la verticale payante était reporté au jalon 2 (P15) : l'immobilier serait ce choix,
  à inscrire dans DECISIONS quand Romain tranchera.

## Ce qui existe

| Outil | Forme | Ce qu'il fait | Ce qu'il ne fait pas | Prix |
|---|---|---|---|---|
| lacquereur.fr | site web : on colle l'adresse de l'annonce | prix au m² comparé aux ventes DVF, arguments de négociation, DPE ADEME et travaux pour atteindre D, rendement locatif, tendance du quartier (IRIS) | pas de Géorisques ; oblige à quitter l'annonce | se dit gratuit |
| Castorus | extension | historique des prix et des baisses d'une annonce | ni DVF, ni DPE, ni risques | gratuit |
| Lokimo | extension | beaucoup de sources (Géorisques, PLU, cadastre) | données brutes, sans lecture pour l'acheteur ; plutôt professionnel | freemium |

Sources : `notes/recherche_immo_concurrents.md` (lacquereur.fr/methodologie et les pages des outils).

## Les données publiques utilisables

Toutes sous Licence Ouverte 2.0, sans clé d'API : DVF (ventes réelles, téléchargement en masse,
**six mois de retard**), Géorisques (API, par coordonnées ou par commune), DPE de l'ADEME (API,
recherche par adresse), cadastre (API Carto de l'IGN), urbanisme (Géoportail de l'urbanisme),
géocodage (Base Adresse Nationale). Détail et adresses : `notes/recherche_immo_donnees.md`.

Deux limites structurent le produit :
- **L'adresse exacte manque presque toujours.** Sans elle, on dispose des statistiques de la
  commune (prix médian DVF, risques, répartition des DPE). Avec elle, on a le rapport Géorisques
  au point, le DPE du logement et la parcelle.
- **DVF interdit la ré-identification et l'indexation par les moteurs.** Les agrégats sont sûrs.
  L'historique d'une parcelle précise reste ambigu, même si c'est la pratique courante.

## Où serait la valeur payante

Trois choses, dont aucune n'est tenue aujourd'hui par un seul outil :
1. **Aucune friction** : un clic sur l'annonce, sans rien copier ni coller.
2. **La discrétion** : la recherche reste sur la machine de l'acheteur, sans serveur Wingpen. Les
   appels aux services publics (Géorisques, ADEME) transmettent la commune ou l'adresse : il faut
   le dire, ou télécharger les jeux de données en local quand c'est possible (DVF).
3. **La lecture pour un acheteur** : interpréter les risques, dresser la liste des documents de
   copropriété à réclamer, rapprocher la surface annoncée du DPE et du cadastre, et en tirer des
   questions pour la visite et des arguments pour la négociation.

Les outils existants sont gratuits : le payant doit apporter nettement plus, et la maintenance
d'une recette par portail (bienici, SeLoger, leboncoin, PAP…) justifie l'abonnement (P17).

## Garde-fous

- Ton factuel, « à vérifier », jamais un avis d'expert ni un jugement de légalité (invariant de
  `MEMORY.md`).
- Règle du geste : les appels aux données partent du broker, sur le clic de l'utilisateur, pour la
  seule annonce affichée. Jamais de balayage des résultats de recherche.
- Les portails interdisent l'aspiration de leurs pages : on lit uniquement ce que l'utilisateur
  regarde, sur son geste (T15).

## Suite proposée

Un goal séparé, après le chantier « pages hors YouTube » : prototype sur bienici et SeLoger,
statistiques de commune d'abord, adresse quand l'annonce la donne.
