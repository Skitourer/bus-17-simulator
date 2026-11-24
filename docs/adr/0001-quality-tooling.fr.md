# ADR 0001 : outillage qualité pour le JavaScript pur et les scripts de données Python

_[English](0001-quality-tooling.md)_ · Statut : acceptée · Date : 24/11/2026

## Contexte

Le jeu est écrit en modules ES JavaScript purs servis comme fichiers statiques, sans
étape de build (choix déjà validé pour le prototype). Les conventions communes listent des
outils pour TypeScript, pas pour le JavaScript pur. Les scripts de données de `tools/` sont
en Python, bibliothèque standard uniquement.

## Décision

- **JavaScript** : Prettier pour le formatage ; le compilateur TypeScript en mode
  `checkJs`, `strict`, uniquement comme vérificateur de types (`noEmit`), avec des types
  écrits en commentaires JSDoc ; Vitest pour les tests unitaires. `@types/three` (même
  version que le Three.js embarqué) fournit les types du moteur 3D. Les tests unitaires
  couvrent la logique de jeu pure ; les modules de rendu et d'interface sont vérifiés dans
  le navigateur.
- **Python** : ruff (formatage et analyse, règles de sécurité `S` comprises), pyright
  strict, pytest avec un plancher de couverture de 80 %, uv pour l'environnement et poe
  comme lanceur de tâches. Les fonctions pures sont dans `tools/geo.py`, les accès réseau
  et le cache dans `tools/sources.py`.
- **Les deux** : hooks pre-commit (dont gitleaks) et un workflow GitHub Actions qui lance
  les mêmes vérifications.

## Conséquences

- Pas de build ni de bundler : le navigateur exécute toujours les fichiers sources tels
  quels.
- Les types sont vérifiés strictement mais vivent dans des commentaires, ce qui allonge
  les signatures.
- Node.js n'est nécessaire que pour développer, pas pour jouer.

## Alternatives rejetées

- **Passer à TypeScript** : impose un build (ou un serveur de développement) pour lancer
  le jeu, pour peu de gain par rapport à `checkJs`.
- **ESLint** : le vérificateur de types et Prettier couvrent déjà l'essentiel ; une
  configuration de plus à maintenir.
- **Jest** : demande une configuration supplémentaire pour les modules ES natifs ; Vitest
  les gère directement.
