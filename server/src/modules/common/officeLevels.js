/**
 * Hiérarchie des bureaux à 6 niveaux (désagrégation) — source unique (jumelle web :
 * web/src/lib/officeLevels.js). Siège › Bureau régional › Bureau pays › Area Office ›
 * Sous-bureau › Antenne. Le `rank` ordonne du plus haut (1) au plus fin (6).
 * `national: true` = niveau qui couvre par défaut tous les sites (périmètre national).
 */
const OFFICE_LEVELS = [
  { code: 'hq', label: 'Siège', rank: 1, national: true },
  { code: 'regional', label: 'Bureau régional', rank: 2, national: true },
  { code: 'country', label: 'Bureau pays', rank: 3, national: true },
  { code: 'area', label: 'Area Office', rank: 4, national: false },
  { code: 'sub', label: 'Sous-bureau', rank: 5, national: false },
  { code: 'antenna', label: 'Antenne', rank: 6, national: false },
];
const LEVEL_CODES = OFFICE_LEVELS.map((l) => l.code);
const LEVEL_BY_CODE = new Map(OFFICE_LEVELS.map((l) => [l.code, l]));

/** `nature` ('pays'/'terrain') héritée pour compatibilité : les 3 niveaux hauts = 'pays'. */
function natureOfLevel(level) {
  const l = LEVEL_BY_CODE.get(level);
  return l && l.national ? 'pays' : 'terrain';
}

module.exports = { OFFICE_LEVELS, LEVEL_CODES, LEVEL_BY_CODE, natureOfLevel };
