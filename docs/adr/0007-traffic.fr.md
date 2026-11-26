# ADR 0007 : modèle de circulation

_[English](0007-traffic.md)_ · Statut : acceptée · Date : 26/11/2026

## Contexte

Les rues étaient vides (#49). Voitures et vélos doivent rouler sur le vrai graphe routier
(ADR 0002), garder leurs distances, traverser les carrefours sans se rentrer dedans et
s'arrêter pour le bus du joueur, pour quelques dizaines de véhicules à 60 pas par seconde
dans le navigateur.

## Décision

- `src/hd2d/traffic.js` (pur) : chaque sens d'une rue de `roads.json` est une voie, à
  droite ; voies bus, voies de desserte et tunnels sont exclus.
- Poursuite avec l'**Intelligent Driver Model** (Treiber, Hennecke et Helbing, 2000) : une
  seule formule pour rouler, suivre et s'arrêter, avec des paramètres documentés dans
  `game.json`.
- Carrefours : **un véhicule à la fois** (une réservation par nœud, premier arrivé ; les
  véhicules déjà dans un rond-point passent d'abord ; libérée une fois le carrefour franchi,
  ou après un délai).
- Les obstacles (les bus) sont des disques ; un véhicule teste des points de son chemin
  devant lui.
- Les véhicules apparaissent et disparaissent hors de vue autour du bus ; leur nombre est
  une préférence du joueur (aucune, fluide, normale, dense).

## Conséquences

- Pas de moteur physique ni de changement de voie : des files se forment derrière un bus
  arrêté, les voitures ne doublent les vélos que sur les routes larges.
- Les carrefours écoulent moins que dans la réalité ; suffisant pour la densité du jeu.
- Les piétons aux passages piétons attendent ceux de #50.

## Alternatives rejetées

- **Feux tricolores d'OSM** : peu sont renseignés, et leurs cycles seraient inventés.
- **Une bibliothèque de trafic (SUMO et autres)** : native, bien trop lourde pour un jeu
  dans le navigateur.
- **Modèles de Gipps ou de Krauss** : pas plus simples, et l'IDM est la référence usuelle
  avec des paramètres publiés.
