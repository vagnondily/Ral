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
  // Date d'ENQUÊTE : elle fixe le MOIS DE COLLECTE (collectionDate.collectionMonth). La date saisie
  // par l'enquêteur (SvyDate, réelle dans les exports GD, SMP, Nutrition, MIARO, Résilience), à
  // défaut la date du jour de la tablette (today), puis le début et la fin du formulaire.
  // Seule date que l'on peut choisir à la main dans « Mapping MEMS ».
  { key: 'survey_date', label: 'Date de collecte', mems: 'Mois de collecte', aliases: ['svydate', 'survey_date', 'surveydate', 'date_enquete', 'today', 'start', 'end'] },
  // Date de RÉCEPTION par le serveur Kobo : repli quand la date d'enquête manque ou n'est pas
  // plausible. « @_submission_time » : le même horodatage dans un export SPSS (qui interdit le
  // « _ » initial). Détectée, jamais choisie à la main (c'est le serveur qui l'écrit).
  { key: 'submitted_at', label: 'Date de réception (serveur)', mems: 'Mois de réception', aliases: ['_submission_time', '@_submission_time', 'submissiondate'] },
  { key: 'field_office', label: 'Bureau / sous-bureau', mems: 'Bureaux & antennes', aliases: ['field_office', 'fieldoffice', 'sous bureau', 'sousbureau'] },
  // Niveaux administratifs alignés sur Paramétrage › Localités (vérifié sur les exports réels :
  // admin1 = région MG51, admin2 = district MG51507, admin3 = commune MG51507090).
  // Le CODE (pcode) passe avant le nom : c'est lui qui relie une soumission aux sites.
  // Noms réels des exports Kobo du pays (12/10/2026) : Adm1Code (Résilience), Adm1Code_gd (GD),
  // Adm1Code_MAM (Nutrition), Adm1Code_SMP (cantines), Adm1Name… (MIARO, qui y met des codes).
  // Adm3Code_SMP est exclu : ce sont des numéros de ZAP (éducation), pas des communes.
  { key: 'admin1', label: 'Région', mems: 'Localités (niveau 1)', aliases: ['admin1', 'admin1_pcode', 'admin1pcode', 'adm1_pcode', 'adm1code', 'adm1code_gd', 'adm1code_mam', 'adm1code_smp', 'admin1name', 'adm1name', 'region', 'region_name', 'niveau régional'] },
  { key: 'admin2', label: 'District', mems: 'Localités (niveau 2)', aliases: ['admin2', 'admin2_pcode', 'admin2pcode', 'adm2_pcode', 'adm2code', 'adm2code_gd', 'adm2code_mam', 'adm2code_smp', 'admin2name', 'adm2name', 'district', 'district_name'] },
  { key: 'admin3', label: 'Commune', mems: 'Localités (niveau 3)', aliases: ['admin3', 'admin3_pcode', 'admin3pcode', 'adm3_pcode', 'adm3code', 'adm3code_gd', 'adm3code_mam', 'admin3name', 'adm3name', 'commune', 'commune_name'] },
  { key: 'admin4', label: 'Fokontany / localité', mems: 'Localités (niveau 4)', aliases: ['admin4', 'admin4_pcode', 'admin4pcode', 'adm4code', 'adm4code_mam', 'admin4name', 'fokontany', 'community'] },
  // Site : point d'intérêt (MIARO POIName), point de distribution (GD/Nutrition DPName,
  // Résilience ADMIN5Name_DP), école (cantines Adm4Code_SMP, code + nom dans l'export).
  { key: 'site', label: 'Site / établissement', mems: 'Référentiel de sites', aliases: ['site', 'sitename', 'site_name', 'poiname', 'dpname', 'admin5name_dp', 'adm4code_smp', 'epp', 'etablissement', 'établissement', 'frsitename'] },
  // EnuPartner : organisation de l'enquêteur ; CPList : prestataire de suivi (exports GD, SMP, MIARO).
  { key: 'partner', label: 'Partenaire / ONG', mems: 'Partenaires', aliases: ['enupartner', 'cplist', 'partner', 'organisation', 'ong'] },
  { key: 'agent', label: 'Agent / énumérateur', mems: 'Agents des TPM', aliases: ['enuname', 'enumerator', 'agent', 'énumérateur', 'nom_enqueteur', 'enqueteur'] },
];

// Identifiant technique de déduplication (pas une dimension MEMS).
// Identifiant Kobo de la soumission, le même quel que soit le format d'export :
// « _uuid » (Excel/CSV/API), « @_uuid » (SPSS, qui interdit le « _ » initial),
// « instanceID » / « meta/instanceID » (« uuid: » + le même identifiant).
// L'identifiant numérique « _id » ne vient qu'en dernier recours.
const EXTERNAL_ID_ALIASES = ['_uuid', '@_uuid', 'meta/instanceid', 'instanceid', 'uuid', '_id'];

/** Identifiant Kobo canonique : sans le préfixe « uuid: » de instanceID (même clé pour tous les formats). */
/** « uuid: » seul ne désigne rien : null (sinon toutes ces lignes partageraient la clé '' et se fondraient en une). */
const canonicalExternalId = (v) => {
  if (v == null) return null;
  const s = String(v).trim().replace(/^uuid:/i, '').trim();
  return s || null;
};

// Réponse « autre » d'un choix (999, autre…) : la précision saisie est dans une colonne voisine.
const OTHER_VALUES = new Set(['999', 'other', 'autre', 'autres']);
const OTHER_SUFFIXES = ['_other', '_oth', '_autre', '_autres'];
// Voisines au nom irrégulier vues dans les exports réels (Résilience : Adm4Code → Adm_4_autres).
const OTHER_EXTRA = { adm4code: ['adm_4_autres'], adm3code: ['adm_3_autres'] };

// Table d'alias consommée par submissionsImport (clé → alias[]). external_id
// d'abord, puis chaque dimension — comportement identique à l'ancienne table.
const MAP = {
  external_id: EXTERNAL_ID_ALIASES,
  ...Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.aliases])),
};

// Colonne de la table monitoring_submissions alimentée par chaque dimension (valeur recopiée).
// Les dates ne sont pas recopiées : period_month / submitted_at / upload_month sont DÉRIVÉS
// des deux dates par collectionDate.collectionMonth (voir DATE_KEYS).
const DIMENSION_COLUMN = {
  field_office: 'field_office',
  admin1: 'admin1', admin2: 'admin2', admin3: 'admin3', admin4: 'admin4',
  site: 'site', partner: 'partner', agent: 'agent',
};
// Dimensions de date : date d'enquête (choisie à la main ou automatique) et date de réception.
const DATE_KEYS = { survey: 'survey_date', upload: 'submitted_at' };
// Dimensions qu'on peut (re)mapper manuellement : les valeurs recopiées + la date d'enquête.
const EDITABLE_KEYS = [...Object.keys(DIMENSION_COLUMN), DATE_KEYS.survey];

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

module.exports = {
  canonicalExternalId, OTHER_VALUES, OTHER_SUFFIXES, OTHER_EXTRA, DIMENSIONS, MAP, DIMENSION_COLUMN, DATE_KEYS, EDITABLE_KEYS, detectMapping, norm };
