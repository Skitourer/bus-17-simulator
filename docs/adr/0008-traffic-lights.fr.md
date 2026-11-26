# ADR 0008 : Feux tricolores d'OpenStreetMap à cycles fixes en deux phases

_[English](0008-traffic-lights.md)_ · Statut : accepté · Date : 2026-11-26

## Contexte

L'ADR 0007 écartait les feux, car peu semblaient renseignés et leurs cycles seraient inventés.
En réalité, 679 nœuds `highway=traffic_signals` se trouvent dans la zone de la carte (#77), et une
conduite en ville sans feux sonne faux. Les vrais plans de feux ne sont pas publiés en données
ouvertes.

## Décision

- `tools/build_roads.py` rattache chaque feu OSM au carrefour le plus proche à moins de 25 m et
  regroupe les carrefours à feux distants de moins de 30 m (chaussées séparées) en groupes à un
  seul cycle : `signals` dans `roads.json` (221 groupes).
- `src/hd2d/signals.js` (pur) : deux phases par groupe, séparées selon la direction des
  approches (l'axe principal et l'axe transversal) ; durées fixes tirées des règles françaises
  (IISR, 6e partie) : vert, orange de 3 s, rouge de dégagement. Chaque groupe démarre à un point
  différent de son cycle.
- Voitures et vélos s'arrêtent à la ligne d'arrêt au rouge, et à l'orange s'ils peuvent freiner
  confortablement ; ils ne bloquent pas le carrefour en attendant. Le joueur est averti quand le
  bus entre dans un carrefour au rouge.

## Conséquences

- Des files aux feux ; les durées sont plausibles, pas les vraies.
- Pas de phases de tourne-à-gauche, de feux piétons ni de feux à détection ; le pilote
  automatique et les autres bus de la ligne 17 ne s'arrêtent pas encore au rouge.

## Alternatives rejetées

- **Des feux à chaque grand carrefour** sans données OSM : mauvais emplacements, et les données
  existent.
- **Les vrais plans de feux** : non disponibles en données ouvertes.
