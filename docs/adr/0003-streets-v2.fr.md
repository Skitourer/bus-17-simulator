# ADR 0003 : routes v2, tuiles de sol et de routes précalculées

_[English](0003-streets-v2.md)_ · Statut : acceptée · Date : 24/11/2026

## Contexte

Les routes étaient des rubans posés sur une grille de relief de 40 m : penchées sur le côté
dans les pentes, superposées aux carrefours, peintes sur les rivières au niveau des ponts,
et le bus, la caméra, les bâtiments et les arbres lisaient chacun un relief qui ne
correspondait pas à ce qui était dessiné.

## Décision

- `tools/build_streets.py` précalcule, avec shapely, des tuiles de 1 km dans
  `data/grenoble/tiles/` :
  - la hauteur des routes : le relief naturel lissé le long de chaque route, raccordé à
    une hauteur commune à chaque carrefour ; les ponts droits entre leurs extrémités ; les
    tunnels laissés de côté ;
  - une grille de sol de 10 m mise à la hauteur de la route sur la chaussée et 2,5 m à
    côté, puis raccordée au relief naturel sur 8 m (talus) ;
  - la chaussée : union de tous les tronçons à leur vraie largeur (carrefours et
    ronds-points propres), découpée selon les triangles du sol pour que chaque morceau
    soit dans le même plan que le sol ;
  - les tabliers des ponts, sous forme d'axes avec hauteurs ;
  - les bâtiments recoupés à 0,3 m de la chaussée, et les arbres (OSM et semés dans les
    parcs et bois) gardés à 1 m de la chaussée et hors des bâtiments. Les bâtiments
    reposent sur un socle en pierre depuis leur point le plus bas, donc aucun mur n'est
    coupé par la pente.
- Dans le jeu, `Ground` (`src/hd2d/ground.js`) est la seule source de hauteur : triangles
  du sol exactement comme affichés, tablier des ponts quand le véhicule est à leur niveau,
  grille IGN large hors des tuiles.
- Toutes les tuiles sont chargées au démarrage pour l'instant (49 fichiers, 9,5 Mo) ; le
  chargement autour du bus viendra avec #12.

## Conséquences

- Chaussées plates en travers, carrefours propres, ponts au-dessus de l'eau, et objets
  posés sur ce qui est dessiné.
- Environ 9,5 Mo de données générées dans le dépôt, reconstruites par le script après tout
  changement des routes ou du relief.

## Alternatives rejetées

- **Calculer la géométrie dans le navigateur** à chaque démarrage : plus lent et bien plus
  difficile sans bibliothèque de polygones.
- **Routes triangulées seulement sur leur contour** : leurs longs triangles traversent le
  sol dans les pentes (essayé, défauts visibles).
- **Routes peintes dans la texture du sol** : trop floues à 1 px pour 1,7 m, pas de ponts.
