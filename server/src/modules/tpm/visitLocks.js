/**
 * Verrous des mois de visites — UNE clé par mois pour les écrivains de plan qui la prennent
 * (« Générer depuis le RBM », coches du Plan de suivi, modification groupée du Plan de suivi,
 * plan généré automatiquement et son effacement, création et modification d'une visite — sa date
 * et son agent réservent des créneaux du plan) : deux écritures du même site × mois ne se
 * croisent jamais. Verrous consultatifs de transaction, pris dans l'ordre CROISSANT des mois
 * (aucun interblocage entre ces écrivains), réentrants dans la même transaction, libérés au
 * COMMIT / ROLLBACK. Toujours AVANT les verrous de lignes (sites FOR UPDATE) et avant le verrou
 * d'attribution (retour 58).
 *
 * Attente BORNÉE : UNE échéance pour tout l'appel (20 s par défaut, ou `deadline` partagée par
 * l'appelant), jamais 20 s par verrou ; au-delà, 55P03 → 503 « réessayez ». Le `lock_timeout` de
 * l'appelant est rétabli ensuite.
 */
const LOCK_WAIT_MS = 20000;

const monthLockKey = (tenantId, month) => `rbm-generate:${tenantId}:${String(month).slice(0, 7)}`;

/** Erreur « attente expirée » au code PostgreSQL (55P03) : le gestionnaire central répond 503. */
function lockTimeout() {
  const e = new Error('Attente d\'un verrou expirée');
  e.code = '55P03';
  return e;
}

/**
 * Verrous consultatifs `keys`, dans l'ordre donné, sous une échéance commune. Essai non bloquant
 * d'abord (aucune attente, un aller-retour) ; sinon attente limitée au temps restant.
 * @param {string[]} keys
 * @param {{ deadline?: number }} opts  échéance (Date.now() + ms) partagée entre plusieurs appels
 */
async function lockKeysTx(client, keys, { deadline } = {}) {
  const end = deadline || Date.now() + LOCK_WAIT_MS;
  let prior = null;
  for (const key of keys) {
    const { rows } = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [key]);
    if (rows && rows[0] && rows[0].ok === true) continue;
    const left = end - Date.now();
    if (left <= 0) throw lockTimeout();
    if (prior == null) {
      const { rows: cur } = await client.query("SELECT current_setting('lock_timeout') AS prior");
      prior = (cur && cur[0] && cur[0].prior) || '0';
    }
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${Math.ceil(left)}ms`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  }
  if (prior != null) await client.query("SELECT set_config('lock_timeout', $1, true)", [prior]);
}

/**
 * @param {string[]} months « AAAA-MM »
 * @param {{ deadline?: number }} opts
 * @returns les mois verrouillés, triés
 */
async function lockVisitMonthsTx(client, tenantId, months, opts = {}) {
  const list = [...new Set((months || []).map((m) => String(m).slice(0, 7)))].sort();
  await lockKeysTx(client, list.map((m) => monthLockKey(tenantId, m)), opts);
  return list;
}

/** Les 12 mois « AAAA-MM » d'un exercice, croissants. */
const yearMonths = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

module.exports = { monthLockKey, lockKeysTx, lockVisitMonthsTx, yearMonths, LOCK_WAIT_MS };
