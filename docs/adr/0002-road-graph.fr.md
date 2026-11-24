# ADR 0002 : données du graphe routier et shapely

_[English](0002-road-graph.md)_ · Statut : acceptée · Date : 24/11/2026

## Contexte

Le monde HD-2D dessine chaque voie OpenStreetMap comme un ruban isolé, de largeur fixe
par catégorie. Il n'y a ni carrefours, ni ponts, ni largeurs réelles, et certaines rues
empruntées par le bus manquent : `map.json` ne garde que les grandes catégories, donc la
voie de desserte et la boucle bus du terminus Lycée du Grésivaudan sont absentes (le
parcours quitte les rues dessinées sur environ 50 m). Les surfaces de carrefour, le
découpage des routes et les talus demandent des opérations sur les polygones.

## Décision

- `tools/build_roads.py` écrit `data/grenoble/roads.json` : un graphe dont les nœuds sont
  les extrémités de voies et les nœuds OSM partagés, et dont les arêtes sont des tronçons
  avec catégorie, largeur (balise `width`, sinon `lanes` × 3,25 m, sinon une valeur par
  catégorie), niveau et indicateurs (sens unique, rond-point, pont, tunnel, couloir bus,
  bretelle). Les voies de desserte et les voies bus sont incluses, pas les allées de
  parking.
- Des tableaux compacts (tables des catégories et indicateurs en tête de fichier,
  coordonnées en décimètres) gardent le fichier sous la limite de 1 Mo du pre-commit
  (840 ko pour la zone actuelle).
- La construction vérifie que chaque mètre des deux sens de la ligne est à moins de 8 m
  d'une route et liste les trous.
- **shapely** (BSD-3-Clause) est la bibliothèque de géométrie des scripts de données
  uniquement ; le jeu ne la charge pas.

## Conséquences

- Le rendu pourra construire carrefours, largeurs, ponts et tunnels à partir d'une seule
  source de données (issues #10 à #14).
- Les scripts de données gagnent une dépendance compilée (paquets shapely et numpy,
  installés par uv).

## Alternatives rejetées

- **Écrire les opérations sur les polygones à la main** : tampons, unions et découpages
  sont faciles à rater ; shapely est la référence.
- **Construire le graphe dans le navigateur** : démarrage plus lent et le même calcul à
  chaque partie ; les données sont statiques.
- **osmnx** : plus lourd (pandas, networkx, ses propres téléchargements) pour ce que fait
  un simple découpage en graphe.
