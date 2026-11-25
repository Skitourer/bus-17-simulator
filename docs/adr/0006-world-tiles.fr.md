# ADR 0006 : Monde dessiné par tuiles autour du bus

_[English](0006-world-tiles.md)_ · Statut : acceptée · Date : 2026-11-25

## Contexte

Toute la ville était construite au démarrage en quelques maillages fusionnés (sol,
chaussées, trottoirs, marquages, bâtiments, arbres) : environ 1,8 million de triangles
dessinés à chaque image, puis de nouveau pour les ombres, quoi que voie la caméra (#12).

## Décision

- Les tuiles de données (500 m, `data/grenoble/tiles/`) sont aussi les tuiles de dessin.
  Chaque tuile a un sol léger (un point sur cinq de sa grille de 10 m) construit pour
  toutes les tuiles au démarrage, et des couches détaillées : sol fin, rues, arbres,
  bâtiments.
- Les couches détaillées sont construites quand le bus arrive à moins de
  `tiles.loadRadius`, les plus proches d'abord et quelques millisecondes par image
  (`tiles.buildBudget`), et libérées au-delà de `tiles.unloadRadius`. Sol fin, rues et
  arbres sont dessinés dans leurs propres distances ; plus loin, le sol léger remplace le
  sol fin.
- Les textures sont partagées par toutes les tuiles ; chaque tuile a ses propres
  géométries et matériaux, libérés avec elle. Les contours des bâtiments pour les
  collisions restent calculés pour toute la carte au démarrage (contours seuls, sans
  maillage).
- Le choix des tuiles et des niveaux est de la logique pure (`src/hd2d/tiling.js`),
  testée.

## Conséquences

- Environ 250 000 à 300 000 triangles dessinés au lieu de 1,8 million ; plus d'appels de
  dessin (environ 100 à 250 au lieu de 75), un nombre qui reste faible.
- Les bâtiments au-delà de `unloadRadius` ne sont pas dessinés ; la texture du sol garde
  le tracé des rues au loin. De petites jointures peuvent apparaître entre une tuile au
  sol fin et une tuile au sol léger, loin de la caméra.

## Alternatives rejetées

- **Construire les tuiles dans un Web Worker** : les constructeurs utilisent les outils
  de géométrie de Three.js et les hauteurs du sol ; les déplacer dans un worker oblige à
  les réécrire autour de tableaux transférables. La construction étalée sur plusieurs
  images garde l'affichage fluide pour l'instant ; à revoir si le chargement saccade.
- **Tuiles de 250 m** : quatre fois plus de maillages et d'appels de dessin pour les
  mêmes données ; il faudrait redécouper les tuiles de données.
- **Masquer seulement selon la distance, tout construire au démarrage** : même mémoire et
  même temps de démarrage qu'avant.
