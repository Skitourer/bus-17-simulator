# ADR 0009 : Bâtiments de la BD TOPO de l'IGN, complétés par OpenStreetMap

_[English](0009-buildings-bdtopo.md)_ · Statut : accepté · Date : 2026-11-26

## Contexte

Les emprises et hauteurs des bâtiments venaient d'OpenStreetMap : la plupart des hauteurs
manquaient et étaient devinées, et tous les bâtiments se ressemblaient (#56). La BD TOPO de l'IGN
couvre toute la France avec les emprises, une hauteur mesurée, le nombre d'étages, l'usage, les
matériaux du toit et des murs et les points bas et haut du toit, sous Licence Ouverte 2.0.

## Décision

- `tools/build_buildings.py` lit la couche `batiment` de la BD TOPO par le WFS de la
  Géoplateforme (par pages, en cache dans `tools/cache/`) et garde les bâtiments à moins de
  450 m de la ligne.
- Emprises et hauteurs viennent de la BD TOPO ; à défaut, le nombre d'étages, puis les tags OSM,
  puis l'ancienne estimation. Le bâtiment OSM qui couvre au moins la moitié d'une emprise lui
  prête ses tags (type, `roof:shape`).
- `tools/buildings.py` (pur, testé) en déduit une famille de façade (vieille ville, grand
  ensemble, moderne, maison, hangar, édifice public) et la hauteur d'un toit en pente à partir
  des points du toit (1,5 m ou plus, pas en béton, au plus environ 30°), et une forme de toit
  (#16) : `roof:shape` d'OSM quand il est connu, sinon un tirage stable entre quatre pans et
  deux pans par famille de façade. Les enregistrements deviennent
  `[hauteur, type, style, hauteur_toit, forme_toit, contour...]`.
- Le jeu dessine les familles à partir d'un seul atlas de façades (un shader choisit la colonne)
  et des toits à quatre ou deux pans selon le grand axe de chaque emprise (`src/hd2d/roofs.js`,
  testé), aux couleurs de tuile, d'ardoise ou de zinc variées d'un bâtiment à l'autre.

## Conséquences

- De vraies hauteurs presque partout (5 678 bâtiments sur 5 818), des rues variées, des toits
  en pente.
- `buildings.json` mêle des données sous Licence Ouverte et sous ODbL : il reste une base
  dérivée sous ODbL, avec les deux attributions.
- La construction des données a besoin du WFS de l'IGN une fois (puis du cache).

## Alternatives rejetées

- **Reporter les hauteurs BD TOPO sur les emprises OSM** : deux géométries à réconcilier, et OSM
  n'a pas tous les bâtiments de la BD TOPO.
- **Des bâtiments détourés sur les photos aériennes de la BD ORTHO** : un projet de vision par
  ordinateur à part entière.
