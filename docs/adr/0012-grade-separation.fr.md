# ADR 0012 : Hauteur libre sous les ponts qui franchissent une route

_[English](0012-grade-separation.md)_ · Statut : acceptée · Date : 2026-11-28

## Contexte

La grille du terrain est trop grossière pour porter les remblais et les déblais des croisements
de routes. Un tablier de pont, droit entre ses extrémités, était souvent à la hauteur de la route
en dessous : les deux niveaux se rejoignaient, les voitures de la route basse étaient happées par
le tablier, et le bus sur le tablier était bloqué par les voitures en dessous (#75).

## Décision

- `tools/overpasses.py` trouve chaque tronçon de pont au-dessus d'une route au sol qui n'est pas
  une de ses rampes, et la hauteur qui manque pour 5,55 m entre la route basse et le tablier
  (4,75 m de hauteur libre des routes françaises plus le tablier de 0,8 m dessiné par le jeu).
- Le tablier monte en dos d'âne à 6 % au plus, ses extrémités inchangées pour que les rampes
  rejoignent toujours les rues ; la route basse, avec les routes autour sauf les rampes du pont,
  descend du reste en déblai à 8 % au plus. Le sol suit les deux profils comme d'habitude.
- Dans le jeu, les voies de circulation sur un pont roulent sur le tablier (`Ground.deckAt`),
  les autres sur le sol ; les voitures ignorent les obstacles à plus de `traffic.levelGap` (3 m)
  au-dessus ou en dessous d'elles, et le bus ne heurte ni ne pousse les voitures d'un autre
  niveau.

## Conséquences

- 51 croisements, aucun avec la hauteur libre avant. Plus de triangles de chaussée penchés avant
  les terrasses (892 au lieu de 824) ; après elles, 218, dont 1 sur le trajet des lignes.

## Alternatives rejetées

- **Relever tout le pont et ses rampes** : les rampes sont des tronçons de toute longueur reliés
  à d'autres rues ; relever leurs extrémités déplace des carrefours, souvent en ville.
- **Abaisser seulement la route basse** : jusqu'à 5 m de déblai, sous le niveau de l'eau le long
  des quais.
- **Un modèle de terrain plus fin (RGE ALTI à 1 m) le long des routes** : lourd, et il ne porte
  toujours pas les tabliers pour lesquels déblais et remblais sont faits.
