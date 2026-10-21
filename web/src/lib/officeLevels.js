// Hiérarchie des bureaux à 6 niveaux (jumelle de server/src/modules/common/officeLevels.js).
// Siège › Bureau régional › Bureau pays › Area Office › Sous-bureau › Antenne.
// `national: true` = niveau qui couvre par défaut tous les sites (périmètre national).
export const OFFICE_LEVELS = [
  { code: 'hq', label: 'Siège (Headquarter)', short: 'Siège', rank: 1, national: true },
  { code: 'regional', label: 'Bureau régional', short: 'Bureau régional', rank: 2, national: true },
  { code: 'country', label: 'Bureau pays', short: 'Bureau pays', rank: 3, national: true },
  { code: 'area', label: 'Area Office', short: 'Area Office', rank: 4, national: false },
  { code: 'sub', label: 'Sous-bureau (Sub Office)', short: 'Sous-bureau', rank: 5, national: false },
  { code: 'antenna', label: 'Antenne', short: 'Antenne', rank: 6, national: false },
];
export const LEVEL_BY_CODE = Object.fromEntries(OFFICE_LEVELS.map((l) => [l.code, l]));
export const levelLabel = (code) => (LEVEL_BY_CODE[code] ? LEVEL_BY_CODE[code].label : null);
// Terme court pour l'étiquette « {niveau} de {bureau parent} » (ex. « Sous-bureau de … »,
// « Area Office de … ») — lève l'ambiguïté de l'ancien « antenne de … » qui s'affichait pour tous.
export const levelShort = (code) => (LEVEL_BY_CODE[code] ? LEVEL_BY_CODE[code].short : null);
export const levelIsNational = (code) => Boolean(LEVEL_BY_CODE[code] && LEVEL_BY_CODE[code].national);
