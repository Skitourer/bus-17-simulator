# ADR 0005 : Surfaces d'eau découpées dans le sol

_[English](0005-water.md)_ · Statut : acceptée · Date : 2026-11-25

## Contexte

L'Isère et les autres surfaces d'eau OSM étaient seulement peintes sur la texture du sol
(#15). Le relief IGN sous une rivière donne sa surface, mais sa grille de 40 m mélange la
rivière et ses berges, et les routes des quais sont façonnées dans la même grille du sol.

## Décision

- `tools/water.py` précalcule, dans les tuiles de rues (`tools/build_streets.py`) :
  - l'union des surfaces d'eau OSM d'au moins 20 m² ;
  - un niveau d'eau par nœud de la grille du sol (5 m) : le relief sous l'eau lissé sur 60 m
    (à partir des points à au moins 15 m d'une berge), maintenu 3 m sous la berge la plus
    basse dans un rayon de 60 m (quais) ;
  - les triangles du sol qui touchent l'eau (`wet`), l'eau découpée selon eux (`water`),
    leurs parties sèches (`dry`) et les berges (`banks`).
- Dans le jeu, les triangles du sol mouillés ne sont pas dessinés et leurs parties sèches
  sont dessinées à la place : ni le sol ni une route ne traversent l'eau. L'eau est
  dessinée à son niveau avec un shader pixel art (reflet du ciel avec effet de Fresnel,
  vaguelettes, écume à moins de `foamWidth` d'une berge) ; des murs de quai en pierre
  longent les berges, du sol jusque sous l'eau.
- Les piles de pont descendent sous la surface de l'eau.

## Conséquences

- Une eau plane bordée de quais ; les routes et immeubles au bord de la rivière ne
  changent pas.
- Les tuiles grossissent d'environ 2,5 Mo (grilles de niveau et morceaux dans 80 des
  182 tuiles).
- L'eau arrête le bus comme un bâtiment (#34) : `Ground` retrouve les morceaux d'eau par
  triangle du sol, sauf sur un tablier de pont à la hauteur du bus, élargi de
  `world.deckMargin` (3 m) car les tabliers OSM sont aussi étroits que la chaussée et les
  berges sont en biais aux extrémités des ponts. Un tablier à portée du bus l'emporte
  désormais sur le sol, qui descend en pente sous les ponts.

## Alternatives rejetées

- **Abaisser le sol sous l'eau** : les triangles à cheval sur une berge descendraient du
  quai jusqu'au fond et traverseraient l'eau près des berges, et les routes des quais
  partagent ces nœuds de grille.
- **Un seul niveau plat par surface d'eau** : l'Isère descend d'environ 5 m sur la carte.
- **Cacher le sol avec le tampon de profondeur ou de stencil** : cache aussi le sol situé
  devant l'eau à l'écran.
