# ADR 0003 : routes v2, tuiles de sol et de routes précalculées

_[English](0003-streets-v2.md)_ · Statut : acceptée · Date : 24/11/2026

## Contexte

Les routes étaient des rubans posés sur une grille de relief de 40 m : penchées sur le côté
dans les pentes, superposées aux carrefours, peintes sur les rivières au niveau des ponts,
et le bus, la caméra, les bâtiments et les arbres lisaient chacun un relief qui ne
correspondait pas à ce qui était dessiné.

## Décision

- `tools/build_streets.py` précalcule, avec shapely, des tuiles de 500 m (chaque fichier sous 1 Mo) dans
  `data/grenoble/tiles/` :
  - la hauteur des routes : le relief naturel lissé le long de chaque route, raccordé à
    une hauteur commune à chaque carrefour, les deux chaussées d'une route à chaussées séparées à
    leur hauteur moyenne, et une rue latérale qui part de la surface de la route qu'elle rejoint
    (classe supérieure, puis route qui continue tout droit, puis plus large) avant de retrouver son
    propre profil sur 15 m (#92) ; les ponts droits entre leurs extrémités ; les
    tunnels laissés de côté (une entrée en béton est dessinée où ils rejoignent une route à
    l'air libre ; les passages sous immeuble sont des rues, la partie du bâtiment au-dessus
    dessinée à partir de 4,5 m, #14) ;
  - une grille de sol de 5 m (10 m avant #92) mise à la hauteur de la route sur la chaussée et 2,5 m à
    côté, puis raccordée au relief naturel sur 8 m (talus) ; tous les coins d'un triangle
    qui touche la chaussée sont à la hauteur de la route, qui est donc plate en travers (#76),
    et la construction liste les triangles de chaussée encore inclinés de plus de 7 % en
    travers (routes plus proches que la grille à des hauteurs différentes, comme les lacets
    serrés) ;
  - la chaussée : union de tous les tronçons à leur vraie largeur (carrefours et
    ronds-points propres), découpée selon les triangles du sol pour que chaque morceau
    soit dans le même plan que le sol ;
  - les tabliers des ponts, sous forme d'axes avec hauteurs ;
  - des trottoirs de 2,5 m (surélevés de 15 cm, avec bordures) le long des rues hors voies
    de desserte et voies bus, des lignes axiales discontinues sur les rues à double sens
    d'au moins 5,5 m, et des passages piétons sur les grands axes près des carrefours ;
  - les bâtiments recoupés à 0,3 m de la chaussée, et les arbres (OSM et semés dans les
    parcs et bois) gardés à 1 m de la chaussée et hors des bâtiments. La façade d'un
    bâtiment part de son point le plus bas, sur un socle bas d'une teinte plus sombre que
    son mur, et entre dans la pente du côté haut (#16 : un socle en pierre jusqu'au point
    le plus haut faisait de hauts murs gris dans les pentes).
- Dans le jeu, `Ground` (`src/hd2d/ground.js`) est la seule source de hauteur : triangles
  du sol exactement comme affichés, tablier des ponts quand le véhicule est à leur niveau,
  grille IGN large hors des tuiles.
- Toutes les tuiles sont chargées au démarrage pour l'instant (182 fichiers, 20 Mo,
  environ un cinquième une fois compressés par le serveur web) ; le chargement autour du
  bus viendra avec #12.

## Conséquences

- Chaussées plates en travers, carrefours propres, ponts au-dessus de l'eau, et objets
  posés sur ce qui est dessiné.
- Environ 75 Mo de tuiles générées dans le dépôt (21 Mo compressés tels que servis),
  reconstruites par le script après tout changement des routes ou du relief. La grille de
  5 m (#92, 28/11/2026) les a doublées, ainsi que les triangles de sol dessinés près du bus
  (1,5 à 2 fois), et a réduit d'environ 60 % la surface de chaussée inclinée de plus de 7 %
  en travers ; les chaussées séparées à la même hauteur et les rues latérales qui partent de la
  route principale (#92) l'ont encore divisée par deux (824 triangles, et environ moitié moins
  dans les carrefours) ; il reste les endroits où deux branches d'un lacet ou deux routes superposées
  sont plus proches que la largeur d'une route, qu'une grille plus fine ne sépare pas.

## Alternatives rejetées

- **Calculer la géométrie dans le navigateur** à chaque démarrage : plus lent et bien plus
  difficile sans bibliothèque de polygones.
- **Routes triangulées seulement sur leur contour** : leurs longs triangles traversent le
  sol dans les pentes (essayé, défauts visibles).
- **Routes peintes dans la texture du sol** : trop floues à 1 px pour 1,7 m, pas de ponts.
