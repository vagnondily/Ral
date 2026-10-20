const { pool, withTenantTransaction } = require('../../config/db');

/**
 * Tâches de fond (migration 081) — SEUL fichier de modules/jobs qui écrit du SQL.
 * Opérations d'un compte : dans withTenantTransaction (RLS) ; opérations de l'exécuteur,
 * tous comptes confondus (prendre, battement de cœur, échecs, ménage) : fonctions
 * SECURITY DEFINER app_jobs_*, en une instruction.
 */
const JOB_COLS = `j.id, j.tenant_id AS "tenantId", j.kind, j.status, j.payload, j.progress, j.result, j.error,
  j.dedupe_key AS "dedupeKey", j.attempts, j.created_by AS "createdBy", j.created_at AS "createdAt",
  j.started_at AS "startedAt", j.heartbeat_at AS "heartbeatAt", j.finished_at AS "finishedAt"`;

const camel = (r) => r && ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, status: r.status, payload: r.payload, progress: r.progress,
  result: r.result, error: r.error, dedupeKey: r.dedupe_key, attempts: r.attempts, createdBy: r.created_by,
  createdAt: r.created_at, startedAt: r.started_at, heartbeatAt: r.heartbeat_at, finishedAt: r.finished_at,
});

/**
 * Met une tâche en file, dans la transaction de l'appelant (écriture et tâche : tout ou rien).
 * `dedupeKey` : une tâche identique déjà EN FILE (pas commencée) est réutilisée.
 * `input` : fichier (Buffer) gardé jusqu'à la fin de la tâche.
 * @returns {Promise<{ id: string, status: string, deduped: boolean }>}
 */
async function enqueueTx(client, tenantId, { kind, payload = {}, dedupeKey = null, createdBy = null, input = null }) {
  // Deux essais au plus : la tâche identique trouvée en conflit a pu démarrer entre l'insertion
  // et sa lecture (elle n'est alors plus « en file ») — on en met une nouvelle en file.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { rows } = await client.query(
      `INSERT INTO app_jobs (tenant_id, kind, payload, dedupe_key, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, kind, dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL DO NOTHING
       RETURNING id, status`,
      [tenantId, kind, JSON.stringify(payload), dedupeKey, createdBy]);
    if (rows[0]) {
      if (input) {
        await client.query('INSERT INTO app_job_inputs (job_id, tenant_id, data) VALUES ($1, $2, $3)', [rows[0].id, tenantId, input]);
      }
      return { ...rows[0], deduped: false };
    }
    const { rows: [q] } = await client.query(
      `SELECT id, status FROM app_jobs WHERE tenant_id = $1 AND kind = $2 AND dedupe_key = $3 AND status = 'queued'`,
      [tenantId, kind, dedupeKey]);
    if (q) return { ...q, deduped: true };
  }
  throw new Error('Tâche : mise en file impossible (conflit répété).');
}

async function enqueue(tenantId, spec) {
  return withTenantTransaction(tenantId, (client) => enqueueTx(client, tenantId, spec));
}

/** Prend la prochaine tâche (tous comptes, au plus une en cours par compte) ou null. */
async function claim(runner) {
  const { rows } = await pool.query('SELECT * FROM app_jobs_claim($1)', [runner]);
  return camel(rows[0]) || null;
}

async function heartbeat(runner, ids) {
  if (!ids.length) return 0;
  const { rows: [r] } = await pool.query('SELECT app_jobs_heartbeat($1, $2::uuid[]) AS n', [runner, ids]);
  return r.n;
}

/** Tâches en cours qui ne tournent plus (cet exécuteur au démarrage, ou battement de cœur tu) → échec. */
async function failStale(runner, staleSeconds) {
  const { rows: [r] } = await pool.query('SELECT app_jobs_fail_stale($1, $2) AS n', [runner, staleSeconds]);
  return r.n;
}

async function purge(days) {
  const { rows: [r] } = await pool.query('SELECT app_jobs_purge($1) AS n', [days]);
  return r.n;
}

/** Avancement d'une tâche en cours (ignoré si elle ne l'est plus). */
async function setProgress(tenantId, id, progress) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE app_jobs SET progress = $3, heartbeat_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
      [tenantId, id, JSON.stringify(progress)]);
    return rowCount;
  });
}

/**
 * Tâche réussie, DANS la transaction de son écriture (l'écriture et « terminée » : tout ou
 * rien). Sans effet si elle n'est plus en cours (déjà terminée).
 */
async function completeTx(client, tenantId, id, result) {
  const { rowCount } = await client.query(
    `UPDATE app_jobs SET status = 'done', result = $3, finished_at = now(), progress = progress || '{"step":"done"}'::jsonb
      WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
    [tenantId, id, JSON.stringify(result === undefined ? null : result)]);
  return rowCount;
}

async function complete(tenantId, id, result) {
  return withTenantTransaction(tenantId, (client) => completeTx(client, tenantId, id, result));
}

/** Tâche en échec (en file ou en cours ; sans effet si déjà terminée). */
async function fail(tenantId, id, error) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE app_jobs SET status = 'failed', error = $3, finished_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status IN ('queued', 'running')`,
      [tenantId, id, JSON.stringify(error)]);
    return rowCount;
  });
}

/** Une tâche du compte (avec le nom de son auteur), ou null. */
async function get(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT ${JOB_COLS}, COALESCE(NULLIF(btrim(u.full_name), ''), u.email::text) AS "createdByName"
         FROM app_jobs j LEFT JOIN users u ON u.id = j.created_by AND u.tenant_id = j.tenant_id
        WHERE j.tenant_id = $1 AND j.id = $2`, [tenantId, id]);
    return rows[0] || null;
  });
}

/**
 * Tâches du compte : en file ou en cours, et terminées depuis `recentMinutes` (pour que
 * l'écran voie « terminé » avant de rafraîchir). Plus récentes d'abord, `limit` au plus.
 */
async function list(tenantId, { recentMinutes = 10, limit = 20 } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT ${JOB_COLS}, COALESCE(NULLIF(btrim(u.full_name), ''), u.email::text) AS "createdByName"
         FROM app_jobs j LEFT JOIN users u ON u.id = j.created_by AND u.tenant_id = j.tenant_id
        WHERE j.tenant_id = $1
          AND (j.status IN ('queued', 'running') OR j.finished_at > now() - make_interval(mins => $2))
        ORDER BY j.created_at DESC LIMIT $3`, [tenantId, recentMinutes, limit]);
    return rows;
  });
}

/** Fichier d'une tâche (Buffer), ou null s'il n'existe plus. */
async function loadInput(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT data FROM app_job_inputs WHERE tenant_id = $1 AND job_id = $2', [tenantId, id]);
    return rows[0] ? rows[0].data : null;
  });
}

module.exports = {
  enqueueTx, enqueue, claim, heartbeat, failStale, purge, setProgress, completeTx, complete, fail, get, list, loadInput,
};
