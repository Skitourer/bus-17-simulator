# ADR 0010 : Plusieurs lignes dans un seul monde

_[English](0010-lines-shared-world.md)_ · Statut : acceptée · Date : 2026-11-27

## Contexte

Le jeu ne connaissait qu'une ligne : `data/grenoble/17.json` fixait l'origine du repère local et
l'emprise de tous les autres fichiers, et chaque sens n'avait qu'un parcours, alors que la
plupart des courses de la 17 font demi-tour à Montfleury. Les lignes 18 (Poisat ⇄ Meylan) et N62
(Grenoble ⇄ Col de Porte, jusqu'à 1 330 m) sont demandées aussi (#88). Elles partagent des rues
avec la 17, et la N62 monte 9 km au nord dans la montagne.

## Décision

- Un seul monde pour toutes les lignes. L'origine du repère local est une constante
  (`tools/lines.py`, `ORIGIN`, l'ancienne origine de la 17) : ajouter une ligne ne déplace pas
  les autres.
- `tools/build_line.py` écrit un fichier par ligne, `data/grenoble/lines/<ligne>.json`, et
  `lines/index.json` (origine, emprise, couleurs, terminus). Chaque schéma de course du GTFS
  (même sens, mêmes arrêts) est un parcours à part, avec ses arrêts et ses départs : les
  services partiels et les branches de la N62 suivent leur vrai trajet.
- La carte, le relief et la grille des tuiles couvrent l'emprise de toutes les lignes ; les
  routes et les tuiles n'existent qu'à moins de 1 500 m d'un parcours (le couloir), les
  bâtiments à moins de 450 m.
- Le jeu charge la ligne choisie, puis seulement les tuiles à moins de `tiles.lineMargin` de ses
  parcours. Le menu choisit d'abord la ligne ; un type de jour montre l'horaire de sa prochaine
  date, réunion des services GTFS qui circulent ce jour-là.

## Conséquences

- Données : 23 Mo de tuiles pour la seule ligne 17, 29 Mo (355 tuiles) pour les trois lignes, 34 Mo de données en tout ;
  GitHub Pages accepte jusqu'à 1 Go par site et 100 Mo par fichier, le site statique suffit
  pour l'instant.
- Hors du couloir, il n'y a pas de tuile : la grille IGN large y est dessinée.
- `buildings.json` dépassait la limite de 1 Mo par fichier ; le jeu ne le chargeait pas, c'est
  désormais un fichier intermédiaire dans `tools/cache/`, découpé dans les tuiles par
  `build_streets.py`.
- Les lignes de crête de l'horizon de l'ancien fichier de ligne ne servaient plus au jeu ;
  elles disparaissent.

## Alternatives rejetées

- **Un monde par ligne** : la 17 et la 18 auraient chacune une copie des mêmes rues, et on ne
  croiserait jamais un bus d'une autre ligne.
- **Toute l'emprise rectangulaire des lignes** : environ 550 tuiles, surtout du flanc de
  montagne vide.
- **Variantes de parcours comme portions du plus long** : la branche de la N62 vers Pont du Croz
  ne fait pas partie des autres parcours.

Si les données dépassent ce que permet GitHub Pages, les tuiles pourront passer dans un asset de
release ou un stockage objet (Cloudflare R2, sortie gratuite), lues par URL ; le format ne change
pas.
