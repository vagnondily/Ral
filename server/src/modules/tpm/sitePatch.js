/**
 * Mise à jour PARTIELLE d'un site — logique PURE (testée, sans I/O).
 * Seuls les champs présents dans le patch sont modifiés : `undefined` = inchangé.
 * `null` efface une colonne facultative ; sur une colonne obligatoire, il est
 * ignoré (jamais d'effacement silencieux d'un critère ou du nom).
 * Changer le district ou la commune met aussi à jour adm2 / adm3, pour que tous
 * les écrans (carte, synthèses) lisent la même géographie.
 */
const COLUMNS = {
  name: ['name', false], district: ['district', true], commune: ['commune', true], fokontany: ['fokontany', true],
  activity: ['activity', true], riskLevel: ['risk_level', true],
  security: ['security_situation', false], synergies: ['programme_synergies', false], beneficiaryOver200: ['beneficiary_over_200', false],
  newPartner: ['new_partner', false], issuesProcess: ['issues_process', false], issuesPartnerReport: ['issues_partner_report', false],
  issuesCFM: ['issues_cfm', false], fraud: ['fraud_suspected', false], experiencedPartner: ['experienced_partner', false],
  beneficiaryNumber: ['beneficiary_number', true], modalityType: ['modality_type', true], poiSubtype: ['poi_subtype', true],
  urbanArea: ['urban_area', true], lastVisitDate: ['last_visit_date', true],
};
const MIRROR = { district: 'adm2', commune: 'adm3' };

/**
 * @param {object} patch  champs du site (noms de l'API)
 * @param {number} firstParam  numéro du premier paramètre SQL libre (ex. 3 après tenant_id, id)
 * @returns {{ sets: string[], values: any[] }}  clauses « col = $n » et leurs valeurs
 */
function sitePatchSql(patch = {}, firstParam = 3) {
  const sets = []; const values = [];
  const add = (col, v) => { values.push(v); sets.push(`${col} = $${firstParam + values.length - 1}`); };
  for (const [key, [col, nullable]] of Object.entries(COLUMNS)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const v = patch[key];
    if (v === null && !nullable) continue;
    add(col, v === '' && nullable ? null : v);
    if (MIRROR[key] && v) add(MIRROR[key], v);
  }
  return { sets, values };
}

module.exports = { sitePatchSql, SITE_PATCH_COLUMNS: COLUMNS };
