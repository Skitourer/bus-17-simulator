# ADR 0013 : Sons enregistrés du moteur et des portes

_[English](0013-recorded-sounds.md)_ · Statut : acceptée · Date : 2026-11-28

## Contexte

Les premiers sons du jeu étaient synthétisés avec la Web Audio API (#115). Même avec des
harmoniques de diesel, des voix désaccordées et un battement des cylindres, le propriétaire a
trouvé le moteur de mauvaise qualité, et accepté de vrais enregistrements.

## Décision

- Deux enregistrements d'un bus urbain MAN SG 220 du projet Work With Sounds sur Wikimedia
  Commons, CC BY 4.0 : le moteur (94 s, 0,8 Mo) et les portes (20 s, 0,3 Mo), gardés tels quels en
  Ogg Vorbis dans `assets/audio/` avec `CREDITS.md` ; crédités dans les README et les crédits du
  menu.
- Le moteur joue en boucle la partie au ralenti de son enregistrement (`loopStart`/`loopEnd`),
  plus vite avec la vitesse et l'accélérateur (`playbackRate`), derrière un filtre passe-bas qui
  s'ouvre en charge. Les portes jouent la partie ouverture ou fermeture du leur. La position de
  ces parties dans les fichiers est dans le groupe `audio` de `game.json`.
- Les bips d'avertissement, la sonnette d'arrêt demandé et l'annonce vocale restent synthétisés.

## Conséquences

- 1,1 Mo de plus pour le site statique, chargé à la première touche ou au premier clic.
- Ogg Vorbis est décodé par Chrome, Edge et Firefox ; Safari le décode depuis la version 17.
- L'attribution doit suivre les fichiers partout où le jeu est publié.

## Alternatives rejetées

- **Garder la synthèse** : le propriétaire l'a trouvée de mauvaise qualité.
- **Des enregistrements Freesound** : le téléchargement demande un compte et beaucoup sont en
  CC BY-NC.
- **Couper les enregistrements aux parties jouées** : pas d'outil audio dans la chaîne ; les
  parties sont choisies par leur temps dans les réglages.
