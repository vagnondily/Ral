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
  // Niveaux administratifs alignés sur Paramétrage › Localités (vérifié sur les exports réels :
  // admin1 = région MG51, admin2 = district MG51507, admin3 = commune MG51507090).
  // Le CODE (pcode) passe avant le nom : c'est lui qui relie une soumission aux sites.
  { key: 'admin1', label: 'Région', mems: 'Localités (niveau 1)', aliases: ['admin1', 'admin1_pcode', 'admin1pcode', 'adm1_pcode', 'admin1name', 'region', 'region_name', 'niveau régional'] },
  { key: 'admin2', label: 'District', mems: 'Localités (niveau 2)', aliases: ['admin2', 'admin2_pcode', 'admin2pcode', 'adm2_pcode', 'admin2name', 'district', 'district_name'] },
  { key: 'admin3', label: 'Commune', mems: 'Localités (niveau 3)', aliases: ['admin3', 'admin3_pcode', 'admin3pcode', 'adm3_pcode', 'admin3name', 'commune', 'commune_name'] },
  { key: 'admin4', label: 'Fokontany / localité', mems: 'Localités (niveau 4)', aliases: ['admin4', 'admin4_pcode', 'admin4pcode', 'admin4name', 'fokontany', 'community'] },
  { key: 'site', label: 'Site / établissement', mems: 'Référentiel de sites', aliases: ['site', 'sitename', 'site_name', 'epp', 'etablissement', 'établissement'] },
  { key: 'partner', label: 'Partenaire / ONG', mems: 'Partenaires', aliases: ['enupartner', 'partner', 'organisation', 'ong'] },
  { key: 'agent', label: 'Agent / énumérateur', mems: 'Prestataires TPM (agents)', aliases: ['enuname', 'enumerator', 'agent', 'énumérateur', 'nom_enqueteur', 'enqueteur'] },
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
