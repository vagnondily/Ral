/**
 * Jeu de démonstration — activités de programme (suivi de processus) › sous-activités
 * (Activity_tag) (migration 105). Idempotent : une activité est retrouvée par la clé de son
 * libellé (mems_activity_key), une sous-activité par la clé de son code ; rien n'est dupliqué
 * quand la reprise de la migration a déjà créé la ligne.
 *
 * Les graphies de démonstration écrites dans les données (« SMP », « GD », « GD drought »…)
 * sont rattachées ici, sciemment, à leur activité (alias « manuel ») : c'est le travail que
 * l'administrateur fait dans Paramétrage › Activités sur des données réelles. Ce qui reste
 * inconnu est repris par mems_programme_activity_reprise (activité « à vérifier »).
 */

// [code, libellé officiel, libellé court, n° d'ordre, description, graphies de démonstration à rattacher]
const PROGRAMME_ACTIVITIES = [
  ['URT', 'Unconditional resource transfers to support access to food', 'Transferts inconditionnels', 1,
    'Assistance alimentaire ou monétaire sans condition (distributions générales, prévention de la malnutrition aiguë).',
    ['GD', 'GD drought', 'GFD Cyclone']],
  ['ACL', 'Asset creation and livelihood support activities', 'Création d\'actifs', 2,
    'Assistance contre création ou réhabilitation d\'actifs communautaires et appui aux moyens d\'existence.', []],
  ['CAR', 'Climate adaptation and risk management activities', 'Adaptation au climat', 3,
    'Adaptation au changement climatique et gestion des risques (assurance, alerte précoce, actions anticipatoires).', []],
  ['SMP', 'School meal activities', 'Repas scolaires', 4,
    'Repas servis à l\'école (cantines scolaires), achats locaux compris.', ['SMP']],
  ['NUT', 'Nutrition treatment activities', 'Traitement nutritionnel', 5,
    'Prise en charge de la malnutrition aiguë modérée.', ['PECMAM']],
  ['PREV', 'Malnutrition prevention activities', 'Prévention de la malnutrition', 6,
    'Prévention de la malnutrition chronique et du retard de croissance.', []],
  ['SAMS', 'Smallholder agricultural market support activities', 'Appui aux petits producteurs', 7,
    'Accès des petits producteurs aux marchés (groupements, achats locaux, post-récolte).', ['RES']],
  ['EPR', 'Emergency preparedness activities', 'Préparation aux urgences', 8,
    'Préparation et réponse aux urgences (stocks pré-positionnés, plans de contingence).', []],
  ['AAM', 'Analysis, assessment and monitoring activities', 'Analyse et suivi', 9,
    'Analyses de vulnérabilité, évaluations et suivi.', []],
];

// [code de l'activité, code de la sous-activité (Activity_tag), libellé, information]
const SUB_ACTIVITIES = [
  ['URT', 'GD', 'Distribution générale', 'Distribution générale de vivres ou de cash aux ménages ciblés.'],
  ['URT', 'PREVMA', 'Prévention de la malnutrition aiguë', 'Supplémentation des enfants de 6 à 59 mois et des femmes enceintes ou allaitantes, en complément de la distribution générale.'],
  ['SMP', 'SMP', 'Alimentation scolaire', 'Repas chaud quotidien dans les écoles primaires publiques.'],
  ['NUT', 'MAM', 'Traitement de la MAM', 'Traitement de la malnutrition aiguë modérée des enfants de 6 à 59 mois.'],
  ['NUT', 'PECMAM', 'Prise en charge communautaire de la MAM', 'Dépistage et prise en charge au niveau des centres de santé de base.'],
  ['PREV', 'STUNT', 'Prévention du retard de croissance', 'Programme des 1 000 premiers jours.'],
  ['PREV', 'MIARO', 'MIARO', 'Prévention de la malnutrition (programme MIARO).'],
  ['ACL', 'FFA', 'Assistance contre création d\'actifs', 'Travaux communautaires rémunérés en vivres ou en cash.'],
  ['SAMS', 'RES', 'Résilience des petits producteurs', 'Appui aux organisations de producteurs (SAMS).'],
];

/** Activité de programme par la clé de son libellé ; créée, ou complétée si la reprise l'a créée. */
async function upsertActivity(client, tenantId, [code, label, shortLabel, order, description]) {
  const { rows: found } = await client.query(
    `SELECT id FROM programme_activities
      WHERE tenant_id = $1 AND NOT bucket AND mems_activity_key(label) = mems_activity_key($2)`, [tenantId, label]);
  if (found.length) {
    await client.query(
      `UPDATE programme_activities SET short_label = $3, description = $4, sort_order = $5, origin = 'saisie', updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [tenantId, found[0].id, shortLabel, description, order]);
    // Code de démonstration s'il est libre (sinon, celui de la reprise reste).
    await client.query(
      `UPDATE programme_activities SET code = $3 WHERE tenant_id = $1 AND id = $2
          AND NOT EXISTS (SELECT 1 FROM programme_activities o WHERE o.tenant_id = $1 AND lower(o.code) = lower($3))`,
      [tenantId, found[0].id, code]);
    return found[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO programme_activities (tenant_id, code, label, short_label, description, sort_order, origin)
     VALUES ($1, $2, $3, $4, $5, $6, 'saisie') RETURNING id`, [tenantId, code, label, shortLabel, description, order]);
  return rows[0].id;
}

/** Alias (clé → activité) : jamais au détriment d'une clé déjà prise. */
async function addAlias(client, tenantId, activityId, text, source) {
  await client.query(
    `INSERT INTO programme_activity_aliases (tenant_id, alias_key, programme_activity_id, source, label)
     SELECT $1, left(mems_activity_key($3), 160), $2, $4, left(btrim($3), 160)
      WHERE mems_activity_key($3) <> ''
     ON CONFLICT (tenant_id, alias_key) DO NOTHING`, [tenantId, activityId, text, source]);
}

/**
 * Référentiel de démonstration, puis reprise de tout libellé encore inconnu.
 * @returns {Promise<{ activities: number, subActivities: number, reprise: object }>}
 */
async function seedProgrammeReferential(client, tenantId) {
  const idByCode = {};
  for (const def of PROGRAMME_ACTIVITIES) {
    const id = await upsertActivity(client, tenantId, def);
    idByCode[def[0]] = id;
    await addAlias(client, tenantId, id, def[1], 'libelle');
    await addAlias(client, tenantId, id, def[0], 'code');
    for (const spelling of def[5]) await addAlias(client, tenantId, id, spelling, 'manuel');
  }
  for (const [actCode, code, label, info] of SUB_ACTIVITIES) {
    const { rows: found } = await client.query(
      'SELECT id FROM sub_activities WHERE tenant_id = $1 AND mems_activity_key(code) = mems_activity_key($2)', [tenantId, code]);
    if (found.length) {
      await client.query(
        `UPDATE sub_activities SET programme_activity_id = $3, label = $4, info = COALESCE(info, $5), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`, [tenantId, found[0].id, idByCode[actCode], label, info]);
    } else {
      await client.query(
        `INSERT INTO sub_activities (tenant_id, programme_activity_id, code, label, info) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, idByCode[actCode], code, label, info]);
    }
  }
  const { rows: [{ r }] } = await client.query('SELECT mems_programme_activity_reprise($1) AS r', [tenantId]);
  return { activities: PROGRAMME_ACTIVITIES.length, subActivities: SUB_ACTIVITIES.length, reprise: r };
}

module.exports = { seedProgrammeReferential, PROGRAMME_ACTIVITIES, SUB_ACTIVITIES };
