const { withTenantTransaction } = require('../../config/db');
const { insertRows } = require('../../db/batch');
const { periodBounds } = require('../common/period');

/**
 * Formations en sessions (lot 8, retour 28.2) — SEUL fichier du module qui écrit du SQL.
 * Chaque requête filtre tenant_id = $1 (RLS en plus) ; une écriture sur plusieurs instructions
 * passe par withTenantTransaction (tout ou rien), les listes s'écrivent en UNE instruction
 * multi-lignes. Les règles (présence, notes ≤ barème, bilan) sont dans trainingMath.js.
 */

const SESSION_COLS = `s.id, s.title, s.objective, s.start_date AS "startDate", s.end_date AS "endDate", s.place, s.trainer,
  s.organiser_partner_id AS "organiserId", o.name AS "organiserName", s.status, s.score_max::float8 AS "scoreMax",
  s.pass_mark::float8 AS "passMark", s.feedback_summary AS "feedbackSummary", s.origin, s.created_at AS "createdAt",
  s.updated_at AS "updatedAt"`;
const SESSION_FROM = `training_sessions s LEFT JOIN partners o ON o.id = s.organiser_partner_id AND o.tenant_id = s.tenant_id`;
const THEMES_SQL = `COALESCE((SELECT json_agg(json_build_object('id', t.id, 'label', t.label, 'hours', st.hours) ORDER BY st.sort_order, t.label)
   FROM training_session_themes st JOIN training_themes t ON t.id = st.theme_id AND t.tenant_id = st.tenant_id
  WHERE st.tenant_id = s.tenant_id AND st.session_id = s.id), '[]'::json)`;

/**
 * Sessions (liste) avec leurs agrégats SQL : participants, prestataires, présence renseignée et
 * suivie, sommes des notes en DIXIÈMES de % (une note arrondie par participant, comme
 * trainingMath.participantResult), réussites (comparaison exacte), satisfaction.
 * Filtres : période (chevauchement des dates), prestataire (un de ses agents y participe), thème, statut.
 */
async function listSessions(tenantId, { period = null, providerId = null, themeId = null, status = null } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = [];
    if (period) {
      const { lo, hiExcl } = periodBounds(period);
      params.push(hiExcl, lo);
      where.push(`s.start_date < $${params.length - 1}::date AND s.end_date >= $${params.length}::date`);
    }
    if (providerId) { params.push(providerId); where.push(`EXISTS (SELECT 1 FROM training_participants x WHERE x.tenant_id = s.tenant_id AND x.session_id = s.id AND x.provider_id = $${params.length}::uuid)`); }
    if (themeId) { params.push(themeId); where.push(`EXISTS (SELECT 1 FROM training_session_themes x WHERE x.tenant_id = s.tenant_id AND x.session_id = s.id AND x.theme_id = $${params.length}::uuid)`); }
    if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT ${SESSION_COLS}, ${THEMES_SQL} AS themes,
              COALESCE(pa.providers, '[]'::json) AS providers,
              COALESCE(pa.n, 0) AS participants, COALESCE(pa.recorded, 0) AS recorded, COALESCE(pa.attended, 0) AS attended,
              COALESCE(pa.with_pre, 0) AS "withPre", COALESCE(pa.sum_pre, 0)::float8 AS "sumPre",
              COALESCE(pa.with_post, 0) AS "withPost", COALESCE(pa.sum_post, 0)::float8 AS "sumPost",
              COALESCE(pa.passed, 0) AS passed, COALESCE(pa.with_sat, 0) AS "withSat", COALESCE(pa.sum_sat, 0) AS "sumSat"
         FROM ${SESSION_FROM}
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n,
                  count(*) FILTER (WHERE p.attendance IS NOT NULL)::int AS recorded,
                  count(*) FILTER (WHERE p.attendance IN ('present', 'partiel'))::int AS attended,
                  count(p.pre_score)::int AS with_pre, sum(round(p.pre_score * 1000 / p.score_max)) AS sum_pre,
                  count(p.post_score)::int AS with_post, sum(round(p.post_score * 1000 / p.score_max)) AS sum_post,
                  count(*) FILTER (WHERE p.post_score IS NOT NULL AND p.post_score * 100 >= s.pass_mark * p.score_max)::int AS passed,
                  count(p.satisfaction)::int AS with_sat, COALESCE(sum(p.satisfaction), 0)::int AS sum_sat,
                  (SELECT json_agg(json_build_object('id', q.id, 'name', q.name) ORDER BY q.name)
                     FROM partners q WHERE q.tenant_id = s.tenant_id
                      AND q.id IN (SELECT DISTINCT y.provider_id FROM training_participants y
                                    WHERE y.tenant_id = s.tenant_id AND y.session_id = s.id)) AS providers
             FROM training_participants p WHERE p.tenant_id = s.tenant_id AND p.session_id = s.id) pa ON true
        WHERE s.tenant_id = $1${where.length ? ` AND ${where.join(' AND ')}` : ''}
        ORDER BY s.start_date DESC, s.title LIMIT 500`, params);
    return rows;
  });
}

async function sessionTx(client, tenantId, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${SESSION_COLS}, ${THEMES_SQL} AS themes FROM ${SESSION_FROM}
      WHERE s.tenant_id = $1 AND s.id = $2 ${lock ? 'FOR UPDATE OF s' : ''}`, [tenantId, id]);
  return rows[0] || null;
}

async function participantsTx(client, tenantId, id) {
  const { rows } = await client.query(
    `SELECT p.agent_id AS "agentId", a.name AS "agentName", a.code AS "agentCode", a.fonction, a.active AS "agentActive",
            p.provider_id AS "providerId", pr.name AS "providerName", p.attendance, p.days_present::float8 AS "daysPresent",
            p.pre_score::float8 AS "preScore", p.post_score::float8 AS "postScore", p.satisfaction, p.feedback
       FROM training_participants p
       JOIN tpm_agents a ON a.id = p.agent_id AND a.tenant_id = p.tenant_id
       LEFT JOIN partners pr ON pr.id = p.provider_id AND pr.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.session_id = $2
      ORDER BY pr.name NULLS LAST, a.name`, [tenantId, id]);
  return rows;
}

/** Une session : informations, thèmes et participants (agent, prestataire au moment de la session). */
async function getSession(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const session = await sessionTx(client, tenantId, id);
    if (!session) return null;
    return { ...session, participants: await participantsTx(client, tenantId, id) };
  });
}

/** Thèmes par libellé : créés au besoin (même clé de doublon que la base), rendus dans l'ordre demandé. */
async function themeIdsTx(client, tenantId, labels) {
  if (!labels.length) return [];
  await insertRows(client, {
    table: 'training_themes', columns: ['tenant_id', 'label'], rows: labels, values: (l) => [tenantId, l],
    suffix: 'ON CONFLICT (tenant_id, label_key) DO NOTHING',
  });
  const { rows } = await client.query(
    `SELECT id, label_key AS key FROM training_themes
      WHERE tenant_id = $1 AND label_key = ANY (SELECT lower(btrim(regexp_replace(x, '\\s+', ' ', 'g'))) FROM unnest($2::text[]) x)`,
    [tenantId, labels]);
  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  return labels.map((l) => byKey.get(l.replace(/\s+/g, ' ').trim().toLowerCase())).filter(Boolean);
}

async function replaceThemesTx(client, tenantId, sessionId, labels) {
  await client.query('DELETE FROM training_session_themes WHERE tenant_id = $1 AND session_id = $2', [tenantId, sessionId]);
  const ids = [...new Set(await themeIdsTx(client, tenantId, labels))];
  if (!ids.length) return;
  await insertRows(client, {
    table: 'training_session_themes', columns: ['tenant_id', 'session_id', 'theme_id', 'sort_order'],
    rows: ids.map((id, i) => ({ id, i })), values: (r) => [tenantId, sessionId, r.id, (r.i + 1) * 10],
  });
}

/**
 * Ajoute des participants (une instruction) : les agents désignés, et/ou tous les agents ACTIFS
 * d'un prestataire ; le prestataire de chaque agent est recopié (prestataire au moment de la
 * session). Un agent déjà inscrit n'est pas dupliqué. Rend le nombre d'agents ajoutés.
 */
async function addParticipantsTx(client, tenantId, session, { agentIds = [], providerId = null }) {
  const { rowCount } = await client.query(
    `INSERT INTO training_participants (tenant_id, session_id, score_max, agent_id, provider_id)
     SELECT $1, $2, $3, a.id, a.tpm_provider_id FROM tpm_agents a
      WHERE a.tenant_id = $1 AND (a.id = ANY($4::uuid[]) OR ($5::uuid IS NOT NULL AND a.tpm_provider_id = $5::uuid AND a.active))
     ON CONFLICT (session_id, agent_id) DO NOTHING`,
    [tenantId, session.id, session.scoreMax, agentIds, providerId]);
  return rowCount;
}

/** Crée une session, ses thèmes et ses participants en UNE transaction. */
async function createSession(tenantId, s, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO training_sessions (tenant_id, title, objective, start_date, end_date, place, trainer, organiser_partner_id,
                                      status, score_max, pass_mark, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 100), COALESCE($11, 70), $12) RETURNING id`,
      [tenantId, s.title, s.objective ?? null, s.startDate, s.endDate, s.place ?? null, s.trainer ?? null, s.organiserId ?? null,
        s.status || 'planifiee', s.scoreMax ?? null, s.passMark ?? null, userId]);
    await replaceThemesTx(client, tenantId, id, s.themes || []);
    const session = await sessionTx(client, tenantId, id);
    if ((s.agentIds || []).length || s.providerId) await addParticipantsTx(client, tenantId, session, s);
    return id;
  });
}

const SESSION_FIELDS = { title: 'title', objective: 'objective', startDate: 'start_date', endDate: 'end_date', place: 'place',
  trainer: 'trainer', organiserId: 'organiser_partner_id', status: 'status', scoreMax: 'score_max', passMark: 'pass_mark',
  feedbackSummary: 'feedback_summary' };

/**
 * Mise à jour PARTIELLE sous verrou : `check(current, next)` (service) contrôle les règles sur
 * l'état complet (dates et participants) avant l'écriture. Un barème abaissé sous une note
 * déjà saisie est refusé par la base (clé étrangère composite → 400).
 */
async function updateSession(tenantId, id, patch, check) {
  return withTenantTransaction(tenantId, async (client) => {
    const current = await sessionTx(client, tenantId, id, { lock: true });
    if (!current) return null;
    check(current, { ...current, ...patch }, await participantsTx(client, tenantId, id));
    const sets = []; const values = [];
    for (const [k, col] of Object.entries(SESSION_FIELDS)) {
      if (patch[k] === undefined) continue;
      values.push(patch[k]); sets.push(`${col} = $${values.length + 2}`);
    }
    if (sets.length) {
      await client.query(`UPDATE training_sessions SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...values]);
    }
    if (patch.themes) await replaceThemesTx(client, tenantId, id, patch.themes);
    return id;
  });
}

async function addParticipants(tenantId, id, input) {
  return withTenantTransaction(tenantId, async (client) => {
    const session = await sessionTx(client, tenantId, id, { lock: true });
    if (!session) return null;
    return { added: await addParticipantsTx(client, tenantId, session, input) };
  });
}

/**
 * Présences, notes et avis de plusieurs participants en UNE instruction, sous verrou de la
 * session ; `validate(session, rows)` (service, trainingMath.checkParticipant) refuse avant toute
 * écriture. Rend le nombre de lignes mises à jour.
 */
async function updateParticipants(tenantId, id, rows, validate) {
  return withTenantTransaction(tenantId, async (client) => {
    const session = await sessionTx(client, tenantId, id, { lock: true });
    if (!session) return null;
    validate(session, rows);
    if (!rows.length) return { updated: 0 };
    const params = [tenantId, id];
    const tuples = rows.map((r) => {
      params.push(r.agentId, r.attendance ?? null, r.daysPresent ?? null, r.preScore ?? null, r.postScore ?? null, r.satisfaction ?? null, r.feedback ?? null);
      const b = params.length - 7;
      return `($${b + 1}::uuid, $${b + 2}::text, $${b + 3}::numeric, $${b + 4}::numeric, $${b + 5}::numeric, $${b + 6}::smallint, $${b + 7}::text)`;
    });
    const { rowCount } = await client.query(
      `UPDATE training_participants p SET attendance = v.att, days_present = v.days, pre_score = v.pre, post_score = v.post,
              satisfaction = v.sat, feedback = v.fb
         FROM (VALUES ${tuples.join(',')}) AS v(agent_id, att, days, pre, post, sat, fb)
        WHERE p.tenant_id = $1 AND p.session_id = $2 AND p.agent_id = v.agent_id`, params);
    await client.query('UPDATE training_sessions SET updated_at = now() WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return { updated: rowCount };
  });
}

/** Retire un participant SANS donnée saisie (présence, notes, avis) ; sinon 'has_data'. */
async function removeParticipant(tenantId, id, agentId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT (attendance IS NOT NULL OR pre_score IS NOT NULL OR post_score IS NOT NULL OR satisfaction IS NOT NULL
               OR NULLIF(btrim(feedback), '') IS NOT NULL) AS has_data
         FROM training_participants WHERE tenant_id = $1 AND session_id = $2 AND agent_id = $3 FOR UPDATE`, [tenantId, id, agentId]);
    if (!rows.length) return 'not_found';
    if (rows[0].has_data) return 'has_data';
    await client.query('DELETE FROM training_participants WHERE tenant_id = $1 AND session_id = $2 AND agent_id = $3', [tenantId, id, agentId]);
    return 'deleted';
  });
}

/**
 * Supprime une session sans donnée saisie (aucune présence, note ni avis) ; sinon rend le
 * décompte de ce qui est relié (le service répond 409 : « annulez-la plutôt »).
 */
async function deleteSession(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT s.id, s.origin,
              (SELECT count(*) FROM training_participants p WHERE p.tenant_id = $1 AND p.session_id = s.id
                 AND (p.attendance IS NOT NULL OR p.pre_score IS NOT NULL OR p.post_score IS NOT NULL OR p.satisfaction IS NOT NULL))::int AS recorded
         FROM training_sessions s WHERE s.tenant_id = $1 AND s.id = $2 FOR UPDATE`, [tenantId, id]);
    if (!rows.length) return { status: 'not_found' };
    if (rows[0].recorded > 0 || rows[0].origin === 'reprise') return { status: 'linked', recorded: rows[0].recorded, origin: rows[0].origin };
    await client.query('DELETE FROM training_sessions WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return { status: 'deleted' };
  });
}

/** Thèmes du compte (filtre, saisie) avec le nombre de sessions qui les couvrent. */
async function listThemes(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT t.id, t.label, t.active,
              (SELECT count(*) FROM training_session_themes st WHERE st.tenant_id = t.tenant_id AND st.theme_id = t.id)::int AS sessions
         FROM training_themes t WHERE t.tenant_id = $1 ORDER BY t.label`, [tenantId]);
    return rows;
  });
}

/**
 * Formations suivies par les agents d'un prestataire (onglet Formations de sa fiche) : une ligne
 * par participant, avec la session (dates, thèmes, statut, barème).
 */
async function providerParticipations(tenantId, providerId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT s.id AS "sessionId", s.title, s.start_date AS "startDate", s.end_date AS "endDate", s.status, s.place,
              s.score_max::float8 AS "scoreMax", s.pass_mark::float8 AS "passMark", ${THEMES_SQL} AS themes,
              p.agent_id AS "agentId", a.name AS "agentName", p.attendance, p.pre_score::float8 AS "preScore",
              p.post_score::float8 AS "postScore", p.satisfaction
         FROM training_participants p
         JOIN training_sessions s ON s.id = p.session_id AND s.tenant_id = p.tenant_id
         JOIN tpm_agents a ON a.id = p.agent_id AND a.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.provider_id = $2
        ORDER BY s.start_date DESC, s.title, a.name LIMIT 1000`, [tenantId, providerId]);
    return rows;
  });
}

module.exports = {
  listSessions, getSession, createSession, updateSession, addParticipants, updateParticipants, removeParticipant,
  deleteSession, listThemes, providerParticipations, SESSION_FIELDS,
};
