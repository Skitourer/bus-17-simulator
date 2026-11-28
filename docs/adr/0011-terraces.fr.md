# ADR 0011 : Terrasses et murs de soutènement entre routes proches

_[English](0011-terraces.md)_ · Statut : acceptée · Date : 2026-11-28

## Contexte

Le sol est une grille de 5 m et la chaussée est découpée selon ses triangles (ADR 0003). Là où
deux routes plus proches qu'un triangle de sol sont à des hauteurs différentes (les branches d'un
lacet, une route au-dessus d'une autre à flanc de coteau), un triangle portait les deux routes et
la chaussée penchait en travers, jusqu'à 120 % (#92, #108). Un talus ne peut pas les séparer : il
n'y a pas de place entre les routes.

## Décision

- `tools/terraces.py` repère les portions de route à plus de 0,5 m au-dessus d'une route à moins
  de 7,5 m à côté, et garde celles où le contrôle du build trouve un triangle de chaussée penché.
  Chacune, avec 10 m de plus à chaque bout et hors des carrefours, devient une **terrasse**.
- Une terrasse garde les hauteurs du profil de sa route, à plat en travers. Le sol sous elle et
  entre elle et la route basse est façonné par les autres routes seules, et ne monte jamais
  au-dessus de la terrasse.
- Les tuiles reçoivent une liste `terraces` au format des ponts (`[largeur, x, y, z, ...]`), la
  largeur couvrant la chaussée et ses trottoirs. Les morceaux de chaussée et de trottoir sont
  découpés selon ses bords.
- Dans le jeu, `Ground.h()` renvoie la hauteur de la terrasse à l'intérieur d'une terrasse : le
  bus, la circulation, le marquage et la chaussée s'y posent. Un mur de soutènement en pierre avec
  un muret se dresse le long de ses côtés là où le sol est plus bas (réglages
  `world.retainingWall*`).

## Conséquences

- Triangles de chaussée penchés de plus de 7 % en travers : 824 avant, 219 après, 1 sur le trajet
  des lignes (7 %) ; 258 terrasses, 8,3 km de murs ; les tuiles grossissent de 0,3 %.
- Le build se fait en deux passes : la première façonne le sol de chaque tuile et trouve les
  triangles penchés, la seconde le refaçonne autour des terrasses ; il prend toujours environ
  3 minutes.

## Alternatives rejetées

- **Une grille de sol plus fine là où les routes sont proches** : il faudrait environ 2 m entre
  les branches des lacets, une grille variable partout dans les données et le jeu.
- **Des ponts au-dessus de la route basse** : les tabliers ont des piles et des parapets, et les
  véhicules ne prennent leur hauteur que s'ils en sont proches ; une terrasse est du sol.
- **Des terrasses partout où deux routes proches diffèrent en hauteur** : 39 km de murs, surtout
  le long des voies de service et en ville, là où le sol partagé convient déjà.
