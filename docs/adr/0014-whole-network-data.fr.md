# ADR 0014 : Données du réseau de bus complet

_[English](0014-whole-network-data.md)_ · Statut : acceptée · Date : 2026-11-28

## Contexte

Le jeu va contenir toutes les lignes de bus de l'agglomération grenobloise sauf les lignes
scolaires (#132, #133). Le couloir autour des lignes passe de 74 km² à environ 520 km², et les
tuiles pèsent environ 1 Mo par km² (triangles de chaussée et de trottoir, grille de sol à 5 m).
Les scripts de génération étaient écrits pour trois lignes : une seule requête Overpass pour toute
la carte, une grille d'altitude fine sur toute l'emprise (des millions de points), le cache des
altitudes réécrit après chaque requête, et le niveau de l'eau calculé sur une grille de 5 m sur
toute l'emprise (des centaines de Mo en mémoire).

## Décision

- Les données restent en JSON, versionnées dans git et servies par GitHub Pages comme avant. Les
  générations sont déterministes : une tuile qui ne change pas garde son blob et n'ajoute rien à
  l'historique.
- La carte, les routes, les bâtiments et les arbres sont demandés par carrés de 8 km
  (`lines.QUERY_BOX`), chacun en cache ; la carte ne garde que les éléments du couloir.
- La grille d'altitude fine ne demande à l'IGN que les nœuds des tuiles ; les autres viennent de
  la grille large, qui grandit avec les lignes (au moins 36 km de côté). Le cache des altitudes
  est écrit toutes les 40 requêtes.
- Le niveau de l'eau est calculé tuile par tuile, avec une marge aussi large que son flou.

## Conséquences

- Environ 500 Mo de données pour tout le réseau (environ 150 Mo compressés dans git par
  génération complète). GitHub Pages accepte 1 Go par site ; le dépôt doit rester sous quelques
  Go.
- Une génération complète demande environ une heure de requêtes d'altitude IGN la première fois ;
  les suivantes réutilisent les caches.
- Hors des tuiles, la grille fine est aussi lisse que la grille large (jamais vue de près).

## Alternatives rejetées

- **Données hors de git** (branche séparée, archive de version) : demande un workflow de
  déploiement et une branche réécrite de force ; gardé pour le jour où le dépôt deviendrait trop
  gros.
- **Tuiles compressées** (`.json.gz` lues avec `DecompressionStream`) : divise la taille publiée
  mais pas l'historique git ; gardé pour le jour où le site approcherait 1 Go.
- **Git LFS** : GitHub Pages ne sert pas les fichiers LFS.
