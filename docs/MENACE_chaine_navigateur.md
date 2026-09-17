# La chaîne page → assistant → machine

Noté le 2026-09-17, à la fin de la session Pyramid qui a créé ce projet. Ce document existe parce
que la menace décrite ici ne vit dans les notes d'**aucun** des deux projets pris séparément.

## La chaîne

Un assistant dans le navigateur lit le contenu des pages et le donne à un modèle. Ce contenu est
rédigé par quelqu'un d'autre. Une page peut donc contenir du texte écrit pour être **obéi** plutôt
que lu — et l'assistant n'a aucun moyen intrinsèque de distinguer « ce que je lis » de « ce qu'on me
demande ».

Sur cette machine, le maillon suivant existe déjà : Pyramid y fait tourner des workers qui ont
`Write`, `Edit` et `Bash`. La chaîne complète est donc :

    page malveillante → assistant navigateur → modèle → utilisateur qui fait confiance → Pyramid

Le saut le plus faible n'est pas technique, c'est le troisième : un résumé de page qui oriente
subtilement une décision, une « recommandation » glissée dans un texte, une commande présentée
comme la solution évidente à un problème inventé par la page elle-même.

## Ce qui est déjà en place

**Côté Wingpen** : le system prompt du broker (`broker/src/model.ts`) traite explicitement le contenu
de page comme une donnée inerte, jamais comme une instruction, y compris quand il prétend le
contraire. C'est la même clause que celle ajoutée à Pyramid le 16/09.

**Côté Pyramid** : `UNTRUSTED_CONTENT_CLAUSE` sur les six rôles. Avec une limite mesurée et
importante : il n'existe **aucun point d'interception** du contenu externe côté Pyramid — le
résultat d'un outil part du processus MCP et rejoint le modèle par la boucle interne du SDK. Pas de
délimiteur possible, pas d'étiquette d'origine. La défense repose entièrement sur la consigne.

Wingpen, lui, **a** ce point d'interception : c'est son broker qui assemble le prompt. C'est un
avantage structurel à ne pas gâcher — ce qui entre depuis une page doit être délimité
mécaniquement, pas seulement annoncé.

## Ce qui reste ouvert

1. **L'exfiltration par le navigateur** (Pyramid, non corrigé au 17/09). Le Bash d'un worker a une
   liste blanche de domaines ; son navigateur n'en a aucune. Un worker peut faire sortir n'importe
   quoi par une simple navigation vers une URL portant la donnée. Piste : le MCP accepte
   `--proxy-server`, donc un proxy local appliquant au navigateur la même liste qu'à Bash.
2. **Le JS tiers des pages visitées.** Une page ne se contente pas d'être lue : elle exécute du code
   dans le navigateur qui la charge. Pour Wingpen, cela veut dire que le content script lit un DOM
   qu'un script hostile peut avoir préparé pour lui. D'où la règle déjà écrite dans `CLAUDE.md` :
   extraire du **texte** assaini, jamais du HTML, et ne jamais faire confiance à la forme.
3. **Le pouvoir de l'agent sur la machine.** Même compte utilisateur, donc même pouvoir. Ni Pyramid
   ni Wingpen ne franchissent cette frontière ; seule l'isolation en conteneur le ferait
   (chantier 2026 côté Pyramid).

## À faire un jour, à froid

Un audit du **durcissement système** — ce que la machine elle-même oppose à un agent compromis :
cloisonnement des processus, filtrage réseau sortant, ce que le groupe `docker` accorde déjà
gratuitement. Recherché le 17/09 dans les notes des deux projets : cet audit n'existe pas encore.
