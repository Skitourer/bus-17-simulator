# Simulateur Bus 17

_[English](README.md)_

Un jeu de conduite de bus dans le navigateur, sur les vrais parcours des lignes de bus 17
(Verdun – Préfecture ⇄ Meylan, Lycée du Grésivaudan), 18 (Poisat ⇄ Meylan) et N62
(Grenoble ⇄ Col de Porte, en Chartreuse) de Grenoble : vraies rues, vrai relief,
vrais arrêts et horaires. Pensé d'abord pour un passionné de bus de 12 ans, puis pour tous.

C'est un prototype en **HD-2D** : une ville en 3D basse résolution au rendu pixel art,
où l'on conduit librement dans les rues.

![Prototype HD-2D : le bus à Verdun – Préfecture, avec le panneau du prochain arrêt et la mini-carte](docs/screenshot-hd2d.png)

**Jouer en ligne : <https://skitourer.github.io/bus-17-simulator/>** (navigateur sur PC).

## Démarrage rapide

Il faut Python 3 (une version récente) et un navigateur récent sur PC.

```sh
git clone https://github.com/Skitourer/bus-17-simulator.git
cd bus-17-simulator
python -m http.server 8017
```

Puis ouvrir <http://localhost:8017/>, choisir une ligne, un sens, un jour et un départ, et conduire.
Touches : Z/↑ accélérer · S/↓ freiner, rappuyer à l'arrêt pour reculer · Q D/← → tourner · M carte · P pause.

## Développement

Il faut Node.js 22+ et [uv](https://docs.astral.sh/uv/).

```sh
npm ci && uv sync
uv run pre-commit install
npm run check        # Prettier, vérification des types, tests JavaScript
uv run poe check     # ruff, pyright, tests Python
uv run poe serve     # http://localhost:8017/ sans cache navigateur
```

Mode debug, pour tester la carte : l'activer dans Réglages, ou appuyer sur F9 en jeu, ou ouvrir
`http://localhost:8017/hd2d.html?debug&stop=saint-laurent` (n'importe quel nom d'arrêt de
la ligne ; `line=18&route=2` pour une autre ligne et un autre parcours, numérotés comme dans
`data/grenoble/lines/<ligne>.json`). Maj : turbo · N / B : arrêt suivant / précédent ·
clic sur la mini-carte : téléporter n'importe où · K : collisions oui/non · F : vol libre (flèches ou
ZQSD, Espace / X pour monter et descendre, souris pour regarder, Entrée pose le bus sous la
caméra).

Les fichiers JSON de `data/grenoble/` sont produits par les scripts de `tools/` (accès
réseau nécessaire ; les téléchargements sont mis en cache dans `tools/cache/`) :

```sh
uv run poe build-data                  # toutes les étapes, avec une barre de progression
uv run poe build-data --from streets   # reprendre à une étape
```

Les étapes (`build_line`, `build_map`, `build_terrain`, `build_buildings`, `build_roads`,
`build_streets`, `build_landmarks`) se lancent aussi une à une avec `uv run python tools/<étape>.py`.
La première génération du réseau complet demande environ une heure de requêtes d'altitude IGN
(ADR 0014).

## Documentation

- Cahier des charges : [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md)
- Décisions : [docs/adr/](docs/adr/)
- Paramètres du jeu (unités, sens, sources) : [src/settings/game.json](src/settings/game.json)
- Contribuer : [CONTRIBUTING.md](CONTRIBUTING.md) · Sécurité : [SECURITY.md](SECURITY.md)

## Licence et données

- Code source : [MIT](LICENSE). Three.js (`vendor/`) : MIT, © auteurs de Three.js.
- Tracé, arrêts, horaires : GTFS M réso (SMMAG), [ODbL](https://opendatacommons.org/licenses/odbl/).
- Rues, bâtiments, arbres, eau, parcs : © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL.
- Altitude : IGN RGE ALTI ; bâtiments : IGN BD TOPO, complétée par OpenStreetMap ; [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- Sons du moteur et des portes : Work With Sounds sur [Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Work_With_Sounds), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (voir `assets/audio/CREDITS.md`).

Les fichiers de `data/` sont des bases de données dérivées et restent sous ODbL /
Licence Ouverte. La livrée du bus est imaginaire ; ce projet n'est pas affilié à M réso
ni au SMMAG.

Développé avec l'aide de Claude (Anthropic).
