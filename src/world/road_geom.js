// @ts-check
/** Profil en travers de la rue (metres, depuis l'axe). 2 voies, une par sens (on roule a droite). */
export const ROAD = {
  HW: 3.4, // demi-largeur de chaussee
  CURB: 3.4 + 0.25, // bordure de trottoir
  SW: 3.4 + 3.2, // bord exterieur du trottoir
  VERGE: 3.4 + 3.2 + 26, // bande de decor au-dela du trottoir
  LANE: 1.7, // axe de la voie de droite
};
