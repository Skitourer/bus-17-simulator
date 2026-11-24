# Simulateur Bus 17

_[English](README.md)_

Un jeu de conduite de bus dans le navigateur, sur le vrai parcours de la ligne 17 de
Grenoble (Verdun – Préfecture ⇄ Meylan, Lycée du Grésivaudan) : vraies rues, vrai relief,
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

Puis ouvrir <http://localhost:8017/>, choisir un sens, un jour et un départ, et conduire.
Touches : Z/↑ accélérer · S/↓ freiner puis reculer · Q D/← → tourner · M carte · P pause.

## Développement

Il faut Node.js 22+ et [uv](https://docs.astral.sh/uv/).

```sh
npm ci && uv sync
uv run pre-commit install
npm run check        # Prettier, vérification des types, tests JavaScript
uv run poe check     # ruff, pyright, tests Python
uv run poe serve     # http://localhost:8017/ sans cache navigateur
```

Les fichiers JSON de `data/grenoble/` sont produits par les scripts de `tools/` (accès
réseau nécessaire ; les téléchargements sont mis en cache dans `tools/cache/`) :

```sh
uv run python tools/build_line.py
uv run python tools/build_map.py
uv run python tools/build_terrain.py
uv run python tools/build_buildings.py
```

## Documentation

- Cahier des charges : [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md)
- Décisions : [docs/adr/](docs/adr/)
- Contribuer : [CONTRIBUTING.md](CONTRIBUTING.md) · Sécurité : [SECURITY.md](SECURITY.md)

## Licence et données

- Code source : [MIT](LICENSE). Three.js (`vendor/`) : MIT, © auteurs de Three.js.
- Tracé, arrêts, horaires : GTFS M réso (SMMAG), [ODbL](https://opendatacommons.org/licenses/odbl/).
- Rues, bâtiments, arbres, eau, parcs : © [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL.
- Altitude : IGN RGE ALTI, [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).

Les fichiers de `data/` sont des bases de données dérivées et restent sous ODbL /
Licence Ouverte. La livrée du bus est imaginaire ; ce projet n'est pas affilié à M réso
ni au SMMAG.

Développé avec l'aide de Claude (Anthropic).
