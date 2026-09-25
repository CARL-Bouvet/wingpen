# Coati — palette de départ (2026-09-25)

Proposition de Romain : une seule couleur pour toute la barre latérale, le brun clair, beige et
roux du coati, chaude et légère. C'est un point de départ pour la maquette Penpot, que Romain
dessine ; rien n'est figé tant qu'elle n'existe pas.

## Valeurs proposées

| Rôle | Clair | Sombre |
|---|---|---|
| Fond | `#F7F0E6` beige | `#1E1712` brun nuit |
| Surface (cartes, champ de saisie) | `#EFE3D3` | `#2A2019` |
| Texte | `#3A2A1F` brun foncé | `#F4EADF` crème |
| Texte secondaire | `#6B5646` | `#C9B6A3` |
| Roux (accent, bouton principal) | `#A4502A` | `#E0894F` |
| Libellé sur le bouton | `#FFFFFF` | `#1E1712` |
| Erreur | `#B3261E` | `#F2B8B5` |

## Contrastes (WCAG, calculés)

Tous atteignent le niveau AA (4,5:1) pour du texte courant :

| Paire | Clair | Sombre |
|---|---|---|
| texte / fond | 12,1 | 14,9 |
| texte secondaire / fond | 6,1 | 9,0 |
| roux / fond | 4,9 | 6,6 |
| libellé / bouton | 5,6 | 6,6 |
| erreur / fond | 5,8 | 10,4 |

## Trois précautions

- **Une variante sombre est obligatoire.** Un panneau beige dans un navigateur en thème sombre
  éblouit. Le panneau suit `prefers-color-scheme`.
- **Le roux et le rouge d'erreur sont voisins** (contraste de 1,2:1 entre eux en clair). Une erreur
  se signale donc par une icône et un texte, jamais par la couleur seule. C'est aussi ce qui la rend
  lisible pour un daltonien.
- **Une teinte, pas une couleur.** Le roux sert aux seuls éléments d'action (bouton principal, lien,
  focus) ; tout le reste est beige, brun et crème. C'est ce qui garde la légèreté.
