/**
 * Mapping « export de suivi ↔ référentiels MEMS » — logique pure, testée.
 *
 * Une seule source de vérité pour :
 *  - l'import des soumissions (`submissionsImport.js` lit `MAP` pour lever les
 *    colonnes Kobo bien connues en champs typés),
 *  - l'écran « Mapping MEMS » du Suivi de processus (quel champ du formulaire
 *    alimente quelle dimension MEMS : bureau, région→commune, site, partenaire,
 *    agent, date), afin de ne pas dupliquer la table d'alias.
 *
 * Les alias sont comparés en forme normalisée (sans accents, minuscules).
 */

// Dimensions MEMS reconnues, dans l'ordre d'affichage. `mems` = le référentiel
// MEMS correspondant (pour guider l'utilisateur vers le bon paramétrage).
const DIMENSIONS = [
  { key: 'submitted_at', label: 'Date de collecte', mems: 'Période (mois)', aliases: ['_submission_time', 'end', 'submissiondate', 'today', 'svydate'] },
  { key: 'field_office', label: 'Bureau / sous-bureau', mems: 'Bureaux & antennes', aliases: ['field_office', 'fieldoffice', 'sous bureau', 'sousbureau'] },
  { key: 'admin1', label: 'Région', mems: 'Localités (adm1)', aliases: ['admin1name', 'admin1', 'region', 'niveau régional'] },
  { key: 'admin2', label: 'Province / Faritany', mems: 'Localités (adm2)', aliases: ['admin2name', 'admin2', 'province'] },
  { key: 'admin3', label: 'District', mems: 'Localités (adm3)', aliases: ['admin3name', 'admin3', 'district'] },
  { key: 'admin4', label: 'Commune', mems: 'Localités (adm4)', aliases: ['admin4name', 'admin4', 'commune', 'community'] },
  { key: 'site', label: 'Site / établissement', mems: 'Référentiel de sites', aliases: ['site', 'sitename', 'site_name', 'epp', 'etablissement', 'établissement'] },
  { key: 'partner', label: 'Partenaire / ONG', mems: 'Partenaires', aliases: ['enupartner', 'partner', 'organisation', 'ong'] },
  { key: 'agent', label: 'Agent / énumérateur', mems: 'Prestataires TPM (agents)', aliases: ['enuname', 'enumerator', 'agent', 'énumérateur'] },
];

// Identifiant technique de déduplication (pas une dimension MEMS).
const EXTERNAL_ID_ALIASES = ['_uuid', '_id', 'uuid', 'meta/instanceid'];

// Table d'alias consommée par submissionsImport (clé → alias[]). external_id
// d'abord, puis chaque dimension — comportement identique à l'ancienne table.
const MAP = {
  external_id: EXTERNAL_ID_ALIASES,
  ...Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.aliases])),
};

// Colonne de la table monitoring_submissions alimentée par chaque dimension.
// `submitted_at` est une date dérivée à l'import : non surchargeable à la main.
const DIMENSION_COLUMN = {
  field_office: 'field_office',
  admin1: 'admin1', admin2: 'admin2', admin3: 'admin3', admin4: 'admin4',
  site: 'site', partner: 'partner', agent: 'agent',
};
// Dimensions qu'on peut (re)mapper manuellement.
const EDITABLE_KEYS = Object.keys(DIMENSION_COLUMN);

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Détecte, pour chaque dimension MEMS, la colonne du formulaire qui l'alimente.
 * @param {string[]} fieldNames noms techniques des champs (catalogue + données)
 * @returns {Array<{key,label,mems,column:string|null}>}
 */
function detectMapping(fieldNames) {
  const byNorm = new Map();
  for (const name of fieldNames || []) {
    const n = norm(name);
    if (n && !byNorm.has(n)) byNorm.set(n, name); // garde le 1ᵉʳ nom original
  }
  return DIMENSIONS.map((d) => {
    let column = null;
    for (const a of d.aliases) { if (byNorm.has(norm(a))) { column = byNorm.get(norm(a)); break; } }
    return { key: d.key, label: d.label, mems: d.mems, column };
  });
}

module.exports = { DIMENSIONS, MAP, DIMENSION_COLUMN, EDITABLE_KEYS, detectMapping, norm };
