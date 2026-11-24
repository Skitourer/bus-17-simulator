# Cahier des charges – Simulateur de bus « Bus World Tour »

> Document de référence destiné à une IA de développement (et aux humains).
> Langue du projet : français (interface, commentaires, documentation).
> Version : 2.0 – 22/11/2026 (redémarrage du projet).
> **Dépôt public** : https://github.com/Skitourer/bus-17-simulator (code sous licence MIT, données sous ODbL / Licence Ouverte), depuis le 24/11/2026.

## 0. Comment lire ce document

- Les exigences portent un identifiant (`GFX-01`, `GAME-03`…). Cite-les dans les commits et les PR.
- Priorités : **P0** = indispensable pour la prochaine version ; **P1** = version suivante ; **P2** = plus tard.
- Statuts : `FAIT` (présent dans le prototype), `À FAIRE`, `À DÉCIDER` (question ouverte : ne pas trancher seul, demander).
- En cas de doute ou de conflit entre deux exigences, **demander au propriétaire** plutôt que de choisir.
- Ordre de travail imposé : **le rendu graphique d'abord** (section 3), le gameplay ensuite.
- **Abandon de la pseudo-3D façon OutRun (24/11/2026)** : seul le moteur **HD-2D** (Three.js, conduite libre) est conservé. Les passages de ce document qui décrivent la pseudo-3D (§3.1, GFX-01, GFX-03, §7, §8, §9) sont **obsolètes** et seront réécrits lors de la traduction du document (issue #2).
- **Redémarrage du 22/11/2026** : la réalisation précédente (faite avec une autre IA) est abandonnée. Les colonnes « Statut » des tableaux ci-dessous ne sont **plus fiables** : seul le §10 (suivi d'avancement) fait foi.

---

## 1. Vision

Jeu de conduite de bus de ligne dans le navigateur, avec un rendu **pseudo-3D façon OutRun** (route par segments, parallaxe) et une **direction artistique pixel art 16 bits** dans l'esprit des décors de Street Fighter 2.

- **Public** : un garçon de 12 ans passionné de bus, puis tout joueur. Lisible et amusant sans manuel.
- **Contenu** : le joueur choisit une **ville** parmi des villes du monde, puis une **ligne de bus réelle** de cette ville.
- **Monde** : la **ville entière** (ou au moins une zone autour de la ligne) est représentée. Le joueur **n'est pas coincé sur sa ligne** : il conduit librement dans les rues, mais doit **suivre le bon parcours** de la ligne (écart signalé, pénalité).
- **Décor** : des **décors dessinés emblématiques** de chaque ville (monuments, panoramas), le reste généré **procéduralement** à partir des données cartographiques (OSM : bâti, parcs, eau, tram…).
- **Ligne de référence** : ligne **17** de Grenoble (réseau M réso), *Verdun – Préfecture ⇄ Lycée du Grésivaudan*. Le bus est imaginaire (pas de livrée officielle).
- **Deux modes** : **Simulation** (réaliste, horaires réels) et **Arcade** (court, nerveux, score).
- **Projet open source** (licence MIT), publié sur GitHub le 24/11/2026.

## 2. Contraintes générales

| ID | Exigence | Priorité | Statut |
|---|---|---|---|
| GEN-01 | Fonctionne dans un navigateur récent, sur **PC uniquement pour l'instant** (téléphone/paysage prévu plus tard). | P0 | FAIT (PC) |
| GEN-02 | Fonctionne hors ligne une fois chargé (aucune ressource externe obligatoire à l'exécution, hormis la police). | P1 | À FAIRE |
| GEN-03 | 60 images/s visées sur un PC moyen et un téléphone récent. | P0 | À FAIRE (à mesurer) |
| GEN-04 | Aucune dépendance lourde : canvas 2D natif, pas de moteur 3D. | P0 | FAIT |
| GEN-05 | Interface et textes en français ; noms d'arrêts dans la langue locale de la ville. | P0 | FAIT |
| GEN-06 | Publié sur GitHub le 24/11/2026 (conventions : `AGENTS.md`). **Moteur reparti de zéro en modules ES** (§7) le 22/11/2026 ; `bus17-outrun.html` conservé comme preuve de concept de référence (§9). | P0 | EN COURS |

---

## 3. Moteur graphique (priorité actuelle)

### 3.1 Principe de rendu

Route pseudo-3D par **segments** (technique OutRun / « Javascript Racer ») :

- La route est une liste de segments de longueur fixe. Chaque segment a une **courbure** (`curve`) et une **altitude** de fin (`y`).
- Les virages s'obtiennent en cumulant la courbure (décalage latéral `dx` croissant) ; les côtes en projetant l'altitude.
- Rendu de l'avant vers l'arrière pour la route (avec écrêtage `maxy`), puis de l'arrière vers l'avant pour les sprites et véhicules (algorithme du peintre, écrêtage par segment).
- Brouillard de distance par segment.

### 3.2 Paramètres de référence (prototype)

| Paramètre | Valeur | Commentaire |
|---|---|---|
| Résolution interne | 960 × 540 px (décidé 22/11/2026 ; 480×270 dans le PoC était trop pixellisé). Agrandie ×2 sans lissage (`image-rendering: pixelated`), canvas adaptatif 16:9 jusqu'à 1920×1080. |
| Ligne d'horizon | 40 % de la hauteur | |
| Échelle | 1 m ≈ 570 unités monde | Une voie = 2000 u ≈ 3,5 m. |
| Longueur de segment | 200 u (≈ 0,35 m) | |
| Distance d'affichage | 420 segments | |
| Champ de vision | 100° | |
| Caméra externe | hauteur 2600 u (≈ 4,5 m), recul 3800 u (≈ 6,7 m) derrière l'avant du bus | |
| Vitesse max | 50 km/h | Valeur simulation ; l'arcade pourra aller plus vite. |
| Bus standard | 12 m × 2,55 m × 3 m | |
| Voiture | 4,3 m × 1,8 m × 1,45 m | |
| Bus articulé | ≈ 18 m | À FAIRE |

### 3.3 Exigences graphiques

| ID | Exigence | Priorité | Statut |
|---|---|---|---|
| GFX-01 | Route pseudo-3D avec virages et côtes, 2 voies, trottoirs, marquage discontinu, bandes alternées. | P0 | EN COURS (route droite livrée Phase 0 ; virages/côtes en Phase 1) |
| GFX-02 | **Parallaxe sur deux axes** : 3 plans de décor qui glissent latéralement dans les virages et verticalement avec le relief (coefficients différents par plan). | P0 | FAIT (offset lié au xSum du rendu → tourne dans les virages ; vertical = altitude caméra × py) |
| GFX-03 | **Véhicules en volume** : chaque véhicule est une boîte qui suit la route (toit, flanc visible côté caméra, face avant ou arrière). Les bus ont vitres et bandeau de livrée sur les flancs. | P0 | FAIT — **sprites 2D style OutRun** (décision 22/11/2026 : la projection boîte 3D du bus était ratée). Bus joueur = sprite pixel art (arrière, vitre, bandeau livrée, feux, roues) avec lean dans les virages ; trafic en Phase 3 en sprites scalés. |
| GFX-04 | **Vue externe** : caméra haute derrière le bus, qui suit les changements de voie avec un léger retard (on voit le flanc du bus en tournant). | P0 | FAIT (camX lissé, retard exponentiel) |
| GFX-05 | **Vue interne (cabine)** : poste de conduite (volant, tableau de bord, pare-brise), route vue à hauteur du chauffeur. | P0 | À FAIRE |
| GFX-06 | Bouton / touche de **changement de caméra** externe ⇄ cabine. | P0 | À FAIRE |
| GFX-07 | **Rétroviseur en incrustation** dans une des deux vues, montrant la porte et les passagers qui montent et descendent. | P1 | À FAIRE |
| GFX-08 | Décor de bord de route : arbres (essence selon la ville), lampadaires, immeubles, abris de bus avec poteau d'arrêt. | P0 | FAIT |
| GFX-09 | Heure du jour : aube, jour, soir, nuit (ciel, couleurs, lampadaires et phares allumés la nuit). | P1 | Partiel (une ambiance fixe par ville) |
| GFX-10 | Carrefours et feux tricolores. | P1 | À FAIRE |
| GFX-11 | Ombres des véhicules, variété de décor par quartier. | P2 | À FAIRE |
| GFX-12 | Repère visuel du terminus : boucle de retournement, panneau « Terminus 17 », quai, abri chauffeurs, bus garés. | P1 | À FAIRE |
| GFX-13 | Monuments répétés assez souvent pour rester visibles dans les virages. | P1 | À FAIRE |
| GFX-14 | Petits éléments animés en arrière-plan (passants, pigeons, drapeaux). | P2 | À FAIRE |

### 3.4 Direction artistique

- **Style** : pixel art 16 bits, esprit décors de Street Fighter 2. Aplats, pas de dégradés lisses : ciels en **bandes horizontales tramées** (dithering), palettes limitées par ville.
- **Police** : pixel (« Press Start 2P » dans le prototype).
- **Identité par ville** : chaque ville a un **thème** (ciel, heure, palette sol/route, monuments, architecture, végétation, livrée des bus, trafic).
- **Monuments** dessinés procéduralement en pixels (pas d'images externes dans le prototype). Pour la version finale, des sprites dessinés à la main sont possibles (`À DÉCIDER`).

### 3.5 Thèmes de ville existants (prototype)

| Ville | Ambiance | Arrière-plan (loin → près) | Premier plan | Végétation | Livrée bus | Trafic |
|---|---|---|---|---|---|---|
| Paris | Coucher de soleil, ciel rose-orangé | Butte + Sacré-Cœur → tour Eiffel + toits | Façades haussmanniennes, toits zinc, lucarnes, balcons | Platanes | Blanc + vert | Couleurs sobres |
| München | Plein jour, nuages | Alpes enneigées → Frauenkirche, Alter Peter, toits rouges | Maisons pastel à pignons à redents | Feuillus | Blanc + bleu | Couleurs neutres |
| Roma | Heure dorée | Dôme Saint-Pierre + pins parasols → Colisée + cyprès | Immeubles ocre / terre cuite, volets verts | Pins parasols | Blanc + rouge | Couleurs vives |
| New York | Nuit étoilée | Skyline + Empire State + tour Art déco → châteaux d'eau | Brownstones, escaliers de secours, néons | Feuillus sombres | Blanc + bleu | Taxis jaunes, ligne jaune |

Arrêts de démonstration (fictifs, dans l'ordre) :
- Paris : Hôtel de Ville, Châtelet, Louvre, Concorde, Alma, Trocadéro, Tour Eiffel.
- München : Hauptbahnhof, Karlsplatz, Marienplatz, Odeonsplatz, Universität, Englischer Garten, Olympiapark.
- Roma : Termini, Piazza Venezia, Colosseo, Circo Massimo, Trastevere, San Pietro, Vaticano.
- New York : Battery Park, Wall Street, SoHo, Union Square, Empire State, Times Square, Central Park.

Structure d'un thème (à conserver dans le code) :

```js
{
  name, term: [7 noms d'arrêts],
  sky: [couleurs de bandes, haut → bas], sun|moon: [couleur, x, y, rayon], stars?, clouds?, night?,
  fog, grass: [2], side: [2], road: [2], curb: [2], lane,
  tree: { k: 'round'|'pine', trunk, dark, light }, lamp,
  bld: { cols: [], roof, win, lit? },
  livery: [caisse, bandeau], traffic: [couleurs voitures],
  layers: [[parallaxeX, parallaxeY, largeur, fonctionDeDessin], ...]  // 3 plans
}
```

---

## 4. Gameplay

### 4.1 Service et arrêts

| ID | Exigence | Priorité | Statut |
|---|---|---|---|
| GAME-01 | Menu de choix du service : **ville → ligne → direction → jour → heure de départ**. | P0 | Partiel (choix de ville seulement) |
| GAME-02 | Pour desservir un arrêt : s'arrêter (vitesse < 0,7 km/h) **le long du trottoir** (voie de droite) **à hauteur de l'abri**. Les portes s'ouvrent ≈ 2,4 s, les passagers montent et descendent. | P0 | FAIT (sans passagers visibles) |
| GAME-03 | Affichage : prochain arrêt, distance, vitesse en km/h, arrêts desservis. | P0 | FAIT |
| GAME-04 | **Synoptique des arrêts** (liste de la ligne avec position du bus) et **mini-carte**. | P0 | Partiel — mini-carte OK : **fond de carte OpenStreetMap** (routes, Isère, parcs, limites ; `lines/grenoble/map.json`, © OSM ODbL, attribution affichée), tracé de la ligne, arrêts, **bus au centre**, auto-fit initial (tout le secteur visible), zoom +/- et molette, M pour masquer. Synoptique à faire. |
| GAME-05 | Horaires réels et temps réaliste (simulation). | P1 | À FAIRE |
| GAME-06 | Terminus : fin de service, bilan, retour au menu ou service retour. | P0 | Partiel |

### 4.2 Trafic

| ID | Exigence | Priorité | Statut |
|---|---|---|---|
| TRAF-01 | Bus de la même ligne **en sens inverse**, calés si possible sur les vrais horaires. | P0 | FAIT (sans horaires) |
| TRAF-02 | Bus de la même ligne **devant et derrière**, eux aussi aux vrais horaires. | P0 | FAIT (sans horaires) |
| TRAF-03 | Voitures dans les deux sens ; un véhicule derrière le joueur ne le traverse pas, il attend. | P0 | FAIT |
| TRAF-04 | Après un accrochage, **le bus ne reste jamais coincé** : marche arrière disponible + bouton « replacer le bus sur la route ». | P0 | Partiel (marche arrière faite, bouton à faire) |

### 4.3 Véhicules et progression

| ID | Exigence | Priorité | Statut |
|---|---|---|---|
| VEH-01 | Choix entre **bus standard** (12 m) et **bus articulé** (accordéon, ≈ 18 m), idée du fils du propriétaire. | P1 | À FAIRE |
| PROG-01 | Points cumulés au fil des services, de chauffeur débutant à très expérimenté. Échelle de grades à proposer. | P1 | À DÉCIDER |
| PROG-02 | Les grades débloquent des contenus, notamment de **nouvelles lignes** (à Grenoble : C1 et 18 envisagées). | P1 | À FAIRE |

### 4.4 Commandes et son

| ID | Exigence | Priorité | Statut |
|---|---|---|---|
| CTRL-01 | PC : ZQSD ou flèches. Haut = accélérer ; Bas = freiner puis reculer à l'arrêt ; Gauche/Droite = tourner. | P0 | FAIT (ZQSD + WASD + flèches) |
| CTRL-02 | Téléphone : **volant tactile** (à la place des flèches) + pédales accélérateur / frein. **Reporté — PC uniquement pour l'instant.** | P2 | À FAIRE |
| CTRL-03 | Touche C / bouton « Ville » : changer de ville (prototype uniquement). | — | FAIT |
| CTRL-04 | Touche / bouton de changement de caméra (voir GFX-06). | P0 | À FAIRE |
| SND-01 | Son simple : moteur, freins, portes, annonce d'arrêt. Démarrage audio après une interaction utilisateur. | P1 | À FAIRE |

### 4.5 Physique (prototype, valeurs indicatives)

- Accélération : 0 → 50 km/h en ≈ 7 s ; freinage ≈ 1,1 s depuis 50 km/h ; décélération libre ≈ 6 s.
- Marche arrière limitée à ≈ 8 km/h.
- Hors route (|x| > 1,05 largeur de route) : forte décélération au-delà de 12 km/h.
- Force centrifuge dans les virages : le joueur doit contre-braquer.
- Collision avec un véhicule devant (même sens) : ralentissement + message « Distance de sécurité ! ».
- Collision avec un véhicule en sens inverse : recul + message « Accrochage ! ».

---

## 5. Modes de jeu

| | Simulation | Arcade |
|---|---|---|
| Objectif | Tenir l'horaire, desservir tous les arrêts | Meilleur score avant la fin du chrono |
| Temps | Réel, horaires du réseau | Compte à rebours avec bonus de temps |
| Vitesse max | Réaliste (50 km/h en ville) | Plus élevée, avec turbo |
| Accrochages | Pénalité, rapport d'incident | Ralentissement, perte de combo |
| Passagers | Confort, réclamations si freinage brusque | Bonus, combos |
| Durée d'une partie | Un service complet (20 à 40 min) | 3 à 5 min |

### Idées pour l'arcade (`À DÉCIDER` : en retenir 3 ou 4 pour la V1)

1. **Chrono et checkpoints** façon OutRun : chaque arrêt bien desservi rajoute des secondes.
2. **Embranchements** : à certains carrefours, choix de la branche (17, C1, 18…) menant à des terminus de difficulté différente.
3. **Arrêt parfait** : jauge de précision ; les arrêts parfaits enchaînés font monter un multiplicateur.
4. **Passagers en retard** qui courent en faisant signe : s'arrêter rapporte un bonus.
5. **Jauge de confort** : passagers debout qui chancellent ; trajet en douceur = bonus « chauffeur zen ».
6. **Turbo de voie réservée** : rester dans la voie bus remplit une jauge de turbo.
7. **Événements** : camion de livraison garé, travaux, cyclistes, neige, nuit.
8. **Fantôme** : course contre le meilleur trajet enregistré (bus translucide).
9. **Défis quotidiens** : « Le 7 h 32 bondé », « Zéro accrochage », « Tout en arrêts parfaits ».

---

## 6. Villes et lignes réelles

Une ligne n'est jouable que si son **tracé**, son **relief** et ses **horaires** sont disponibles. Les données sont converties hors jeu en un **fichier de ligne** compact (voir §7).

| Donnée | Source envisagée | Remarque |
|---|---|---|
| Horaires, arrêts, tracé de ligne | GTFS du réseau (`stops.txt`, `trips.txt`, `stop_times.txt`, `shapes.txt`) | Des milliers de réseaux publiés |
| Tracé fin de la voirie, fond de carte, occupation du sol | OpenStreetMap (Overpass) | `tools/build_map.py` → `data/grenoble/map.json`. Licence **ODbL**, attribution affichée. |
| Altitude | IGN Géoplateforme, RGE ALTI (`ign_rge_alti_wld`) ; Open-Meteo en secours (limité en débit) | Utilisé par `tools/build_line.py` (cache local `tools/cache/elevation_ign.json`). |
| Décor | OpenStreetMap (bâtiments, parcs) → « ambiances » de quartier | |

> Ces sources sont citées de mémoire : **vérifier licences, formats et modalités d'accès** avant de coder.

Questions ouvertes (`À DÉCIDER`) :
- Lignes préparées à l'avance (un fichier par ligne, livré avec le jeu) ou générées à la volée ?
- Liste des villes au lancement (Grenoble d'abord, puis Paris, Munich, Rome, New York ?).
- Simplification des carrefours complexes et ronds-points en pseudo-3D.
- Décor propre à chaque ville : thème global (comme le prototype) ou par quartier ?

---

## 7. Architecture technique (redémarrage 22/11/2026)

- **Jeu** : JavaScript vanilla en **modules ES**, canvas 2D, **aucun outil de build**, `// @ts-check` + JSDoc pour la vérification de types dans VS Code. Lancer : `python -m http.server 8000` puis http://localhost:8000 (les modules exigent http).
- **Données** : scripts **Python** hors jeu (bibliothèque standard uniquement), résultats JSON dans `data/`, cache des téléchargements dans `tools/cache/`.
- **Principe central** : l'**abscisse curviligne `s`** (mètres le long du parcours) est la seule référence ; route pseudo-3D, décor, arrêts et mini-carte en dérivent. Repère local en mètres (x = est, y = nord), origine = premier point de la ligne.

```
index.html             page d'accueil commune (direction, bus, jour, départ réel GTFS, moteur) — inspirée du prototype v2
outrun.html            prototype 1 : pseudo-3D façon OutRun (sur le tracé)
hd2d.html              prototype 2 : HD-2D (Three.js, conduite libre dans la ville)
vendor/three.module.min.js   Three.js r170 (local, fonctionne hors ligne)
src/
  menu.js, menu.css    page d'accueil
  common/service.js    services GTFS (libellés, service du jour), horloge de service, paramètres d'URL
  world/track.js       tracé réel : points tous les 2 m, cap, courbure, altitude ; pos(s, décalage)  [partagé]
  ui/minimap.js        carte OSM vectorielle zoomable / déplaçable, tracé, arrêts, bus             [partagé]
  outrun_main.js       prototype 1 : boucle, desserte
  world/road_geom.js, world/scenery.js, render/*, sim/bus.js, ui/hud.js   prototype 1
  hd2d/main.js         prototype 2 : boucle, caméras (HD-2D, poursuite, ciel), suivi du parcours, desserte, HUD façon SAE
  hd2d/heightfield.js  relief IGN (grille fine 40 m + grille large 300 m)
  hd2d/world.js        sol = carte OSM peinte en pixel art, rues en rubans, bâti OSM extrudé, arbres OSM en sprites, abris
  hd2d/bus3d.js        bus 12 m en volume, textures pixel art
  hd2d/drive.js        conduite libre (modèle bicyclette), pente, collisions avec le bâti
  hd2d/post.js         rendu basse résolution (300 lignes) + flou de mise au point, étalonnage, vignettage
tools/
  build_line.py        GTFS M réso + altitudes IGN → data/grenoble/17.json (tracé, arrêts + horaires, lignes de crête)
  build_map.py         OSM (Overpass) → data/grenoble/map.json (eau, parcs, bois, routes, tram, rail)
  build_terrain.py     IGN → data/grenoble/terrain.json (grille fine 40 m sur la ville, grille large 300 m sur 36 km)
  build_buildings.py   OSM → data/grenoble/buildings.json (5 598 bâtiments à 450 m de la ligne, 8 698 arbres)
data/grenoble/
```

### 7.1 Alternatives de rendu envisagées

Le prototype garde la **pseudo-3D façon OutRun**. Pistes pour plus tard (la 3D « classique » testée auparavant n'était pas satisfaisante) :

| Technique | Pour | Contre |
|---|---|---|
| Pseudo-3D par segments (OutRun) — **prototype actuel** | Look rétro, décors dessinés en parallaxe/sprites, léger | Carrefours, ronds-points et virages à 90° approximatifs |
| « Mode 7 » (sol plan texturé, Mario Kart SNES) | La carte OSM pixel art *est* le sol ; vrais carrefours | Sol plat : relief perdu ou triché |
| « HD-2D » (3D légère basse résolution + sprites 2D dessinés, façon Octopath) | Géométrie exacte (relief, carrefours) + direction artistique dessinée | Plus de travail, Three.js nécessaire — **retenu pour le second prototype** |
| Voxel space / raycasting (Comanche, Wolfenstein) | Relief réel spectaculaire | Peu adapté à la ville dense |
| Vue de dessus / isométrique (GTA 1, SimCity 2000) — envisagée puis écartée au profit du HD-2D | Conduite libre dans tout le réseau, tuiles générées depuis OSM | Moins de sensation de conduite |
| 3D photoréaliste (tuiles Google, Cesium) | — | Licences, pas de direction artistique, lourd |

## 8. Feuille de route (redémarrage)

1. **Socle ligne 17 en pseudo-3D** : tracé et altitude réels, mini-carte OSM zoomable, bus en sprites, décor généré, desserte des arrêts. *(livré, voir §10)*
2. **Graphe des rues** : `build_map.py` conserve la topologie OSM (rues + carrefours) ; conduite libre, choix de branche aux carrefours (clignotant / volant, façon embranchements OutRun) ; contrôle du respect du parcours (« Hors parcours ! »), recalcul d'itinéraire sur la mini-carte.
3. **Second prototype « HD-2D »** (décidé 22/11/2026, à la place de la vue GTA 1) : 3D légère basse résolution (Three.js) + sprites 2D dessinés, sur les mêmes données (`data/`). Conduite libre dans la ville, vraie géométrie des carrefours et du relief. *(première version livrée, voir §10)*
4. **Décor** : bâti OSM réel le long des rues, monuments dessinés (Bastille et téléphérique, Isère, Belledonne…), carrefours et feux, trafic.
5. **Gameplay** (§4, idées §12) : menu de service (sens, jour, horaire), horaires réels, vue cabine, rétroviseur, portes, annonces.
6. Arcade, progression, autres lignes et villes.

## 9. Archive : preuve de concept

- `bus17-outrun.html` : preuve de concept monofichier (thèmes Paris / München / Roma / New York, route fictive). Sert de **référence d'ambiance** uniquement.
- `bus17-simulateur-v2.html` : ancien prototype (vue cabine, SAE, rétroviseur, grades, bus articulé, horaires). **Référence d'interface** : la page d'accueil et le pupitre SAE du HD-2D s'en inspirent ; ses fonctions (cabine, rétro, portes, clignotants, grades) sont à reprendre.

## 10. Suivi d'avancement (fait foi)

- **22/11/2026 — Redémarrage, étape 1 livrée** :
  - Données : GTFS SMMAG/M réso (`data.mobilites-m.fr/api/gtfs/SEM`, ODbL) → 2 sens de la 17 (~7,2 km, 20–21 arrêts, départs par service et calendrier). Tracé lissé (gaussien 12 m) et rééchantillonné tous les 2 m. Altitudes **IGN RGE ALTI** (API Géoplateforme, MNT métrique) tous les 10 m, ponts comblés (fermeture morphologique 60 m), lissées sur 40 m : 210–289 m, pente max 9,4 %. Ligne de crête réelle en 2 plans : massifs lointains (7–31 km, depuis le centre) et reliefs proches (< 6,4 km) recalculés depuis 19 points de vue le long du tracé, interpolés selon la position de la caméra.
  - Mini-carte : fond OSM vectoriel (Overpass, ODbL, attribution affichée), nord en haut, molette/boutons, glisser, suivi du bus, 3 tailles (M).
  - Rendu : projection perspective réelle de chaque point du tracé (cap + altitude), caméra de poursuite avec tangage selon la pente, route par bandes imbriquées, brouillard, ciel tramé, sprites (bus 5 vues + feux stop, immeubles, arbres, lampadaires, abris + poteaux « 17 »).
  - Gameplay minimal : desserte (avant du bus à ±7 m du poteau, voie de droite, arrêt complet), arrêt manqué, terminus, pause, R pour replacer.
  - Test : `index.html?dir=0&s=1500&auto` démarre directement avec un pilote automatique.

- **22/11/2026 — Page d'accueil + prototype HD-2D (v0)** :
  - Accueil commun (`index.html`) inspiré du prototype v2 : direction (« ça monte / ça descend »), bus (articulé : bientôt), jour (services GTFS, service du jour présélectionné), grille des départs réels (prochain départ surligné), choix du moteur. Choix mémorisés localement.
  - Horloge de service dans les deux prototypes : heure de départ réelle, horaire théorique à chaque arrêt (stop_times GTFS), avance / retard.
  - HD-2D : rendu Three.js en 300 lignes pixelisées + flou de mise au point ; relief IGN réel (ville + massifs jusqu'à 18 km : Belledonne enneigée) ; sol = carte OSM peinte ; rues OSM en rubans (trottoirs, marquage) ; 5 598 bâtiments OSM extrudés (hauteurs OSM sinon estimées) ; 8 698 arbres OSM + semis dans les parcs ; abris aux vraies positions des arrêts ; bus 12 m en volume (portes à droite, feux stop) ; soleil + ombres.
  - Conduite libre (modèle bicyclette, braquage selon la vitesse, pente réelle), collisions avec le bâti (bâtiments touchant le parcours ignorés, pénétration > 1 m), suivi du parcours (« HORS PARCOURS »), guidage au sol (chevrons verts, G), synoptique des arrêts, pupitre SAE, 3 caméras (C), zoom molette, R pour replacer.
  - Tests : `hd2d.html?dir=1&day=x&dep=07:32&s=2900&auto&ff=60` (départ à 2 900 m, 60 s simulées d'un coup). Parcours complet des 2 sens au pilote automatique sans blocage.
  - Limites connues : rues = rubans superposés (carrefours sans traitement), pas de feux ni de trafic, abris sommaires, bâtiments OSM qui débordent parfois sur la chaussée.

## 11. Glossaire
- **Service** : un trajet complet d'un terminus à l'autre à une heure donnée.
- **Synoptique** : schéma linéaire des arrêts de la ligne avec la position du bus.
- **Segment** : tranche élémentaire de route dans le moteur pseudo-3D.
- **Parallaxe** : plans de décor qui défilent à des vitesses différentes selon leur distance.
- **GTFS** : format standard de données de transport (arrêts, horaires, tracés).
- **MNT** : modèle numérique de terrain (altitude).

## 12. Idées notées (idees.txt, 22/11/2026)

| Idée | Équivalent CDC |
|---|---|
| Page d'accueil : type de bus (accordéon / normal) | VEH-01 |
| Page d'accueil : horaire, sens de parcours, type de jour (vacances, semaine, samedi, dimanche, jours fériés) | GAME-01 + services (calendar/calendar_dates du GTFS) |
| Gestion jour/nuit | GFX-09 |
| Vue cabine | GFX-05 |
| Vue passager | à créer (P2) |
| Rétroviseur (passagers qui montent/descendent) | GFX-07 |
| Bouton pour les portes | GAME-02 |
| Cockpit : signalisation « arrêt demandé », heure d'arrivée prévue au prochain arrêt, nom du prochain arrêt, annonces sonores | GAME-03, SND-01 |
| Panneau d'information voyageur linéaire (précédente / prochaine / suivante) | GAME-04 (synoptique) |
| Abris de bus | GFX-08 |
