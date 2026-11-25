# ADR 0004 : Paramètres du jeu dans un fichier JSON documenté

_[English](0004-game-settings.md)_ · Statut : acceptée · Date : 2026-11-25

## Contexte

Les valeurs réglables du jeu (physique du bus, caméras, rendu, règles de desserte,
géométrie des rues) étaient des constantes dispersées dans `src/hd2d/`, parfois en ligne,
peu documentées, et les modules purs importaient la taille du bus depuis un module de
rendu (#28).

## Décision

- Toutes les valeurs réglables sont dans `src/settings/game.json`, regroupées par thème.
  Chaque entrée porte sa documentation : `{value, unit, doc, source?, min, max, integer?}`
  pour les nombres, `{value, unit, doc}` pour les couleurs `#rrggbb`.
- `src/settings/settings.js` valide le fichier au démarrage (type, plage, entier, champs
  obligatoires, champs inconnus) et renvoie des valeurs simples ; un fichier invalide
  arrête l'écran de chargement avec un message qui liste tous les problèmes.
- Les modules du jeu reçoivent leur groupe en argument, par exemple
  `new Drive(settings.drive, settings.bus)`, ainsi les modules purs restent testables
  sans rien télécharger.
- Le type des réglages est dérivé du fichier JSON : `tsc` refuse la lecture d'un paramètre
  qui n'existe pas. Un test unitaire vérifie que chaque paramètre est lu par le code et
  qu'il ne reste aucune constante numérique `MAJUSCULES` dans `src/`.
- Les constantes de construction de `tools/` restent en Python : le jeu n'en voit que le
  résultat dans `data/`.

## Conséquences

- Régler le jeu ne demande aucun changement de code, et chaque valeur indique son unité,
  son sens et sa source.
- Un fichier de plus téléchargé au démarrage, avant les données de la ville.
- Les palettes artistiques (couleurs des immeubles, des toits et du bus) et les
  coordonnées de texture restent dans le code.

## Alternatives rejetées

- **Module JavaScript de constantes** : pas de validation des modifications à la main, et
  les commentaires ne sont pas des données qu'un test peut vérifier.
- **Valeurs seules dans le JSON, documentation dans une page à part** : les deux
  divergeraient.
- **JSON importé comme module** (`import … with { type: 'json' }`) : un fichier invalide
  échoue en silence, avant qu'une erreur puisse s'afficher.

## Mise à jour du 2026-11-25 : préférences du joueur (#46)

- L'écran des réglages garde les choix du joueur (langue, qualité graphique, distance
  d'affichage, difficulté, touche principale de chaque action) dans le navigateur
  (`localStorage`, `src/settings/preferences.js`) ; une entrée absente, bloquée ou
  invalide revient aux valeurs par défaut.
- Chaque choix a trois niveaux. Celui du milieu garde les valeurs de `game.json` ; les
  deux autres sont des préréglages documentés dans le groupe `presets` de `game.json` et
  recopiés sur les valeurs qu'ils remplacent : toutes les valeurs réglables restent dans
  un seul fichier.
- Rejeté : un jeu complet de valeurs par niveau (le niveau du milieu dupliquerait les
  valeurs de base et finirait par en diverger).
