/**
 * Verrous des mois de visites — UNE clé pour tous les écrivains de plan (« Générer depuis le
 * RBM », coches du Plan de suivi et modification groupée, plan généré automatiquement) :
 * deux écritures du même site × mois ne se croisent jamais. Verrous consultatifs de
 * transaction, pris dans l'ordre CROISSANT des mois (aucun interblocage entre écrivains),
 * réentrants dans la même transaction, libérés au COMMIT / ROLLBACK.
 */
const monthLockKey = (tenantId, month) => `rbm-generate:${tenantId}:${String(month).slice(0, 7)}`;

/** @param {string[]} months « AAAA-MM » ; @returns les mois verrouillés, triés */
async function lockVisitMonthsTx(client, tenantId, months) {
  const list = [...new Set((months || []).map((m) => String(m).slice(0, 7)))].sort();
  for (const m of list) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthLockKey(tenantId, m)]);
  return list;
}

module.exports = { monthLockKey, lockVisitMonthsTx };
