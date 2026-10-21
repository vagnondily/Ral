// Hiérarchie des bureaux à 6 niveaux (jumelle de server/src/modules/common/officeLevels.js).
// Siège › Bureau régional › Bureau pays › Area Office › Sous-bureau › Antenne.
// `national: true` = niveau qui couvre par défaut tous les sites (périmètre national).
export const OFFICE_LEVELS = [
  { code: 'hq', label: 'Siège (Headquarter)', rank: 1, national: true },
  { code: 'regional', label: 'Bureau régional', rank: 2, national: true },
  { code: 'country', label: 'Bureau pays', rank: 3, national: true },
  { code: 'area', label: 'Area Office', rank: 4, national: false },
  { code: 'sub', label: 'Sous-bureau (Sub Office)', rank: 5, national: false },
  { code: 'antenna', label: 'Antenne', rank: 6, national: false },
];
export const LEVEL_BY_CODE = Object.fromEntries(OFFICE_LEVELS.map((l) => [l.code, l]));
export const levelLabel = (code) => (LEVEL_BY_CODE[code] ? LEVEL_BY_CODE[code].label : null);
export const levelIsNational = (code) => Boolean(LEVEL_BY_CODE[code] && LEVEL_BY_CODE[code].national);
