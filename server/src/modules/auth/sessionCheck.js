/**
 * Révocation de session (constat n° 1 de docs/SECURITE.md).
 *
 * Le JWT est sans état : sans ce contrôle, un compte désactivé, un rôle abaissé
 * ou un mot de passe changé ne prennent effet qu'à la prochaine connexion — le
 * jeton déjà émis reste valable jusqu'à expiration (JWT_EXPIRES_IN, 8 h par
 * défaut). Ici, `requireAuth` revérifie en base, à chaque requête mais avec un
 * cache court par utilisateur (SESSION_ACTIVE_TTL_MS), que :
 *   - le compte existe toujours et est actif (sinon 401) ;
 *   - le rôle courant (rafraîchi depuis la base ; une rétrogradation prend effet
 *     dans la fenêtre du cache sans attendre une reconnexion).
 *
 * Activation : SESSION_ACTIVE_CHECK=1 (recommandé en production). Désactivé par
 * défaut pour ne rien changer au comportement sans configuration explicite.
 *
 * Disponibilité d'abord : si la base est injoignable, on NE bloque PAS (repli sur
 * le jeton signé, comportement d'origine) — une panne de base ne doit pas
 * déconnecter tout le monde ; l'API renvoie déjà 503 ailleurs quand elle est down.
 */
const { pool } = require('../../config/db');
const { normalizeRole } = require('../common/accessRoles');

const TTL_MS = Number(process.env.SESSION_ACTIVE_TTL_MS || 30_000);
const cache = new Map(); // userId -> { at, state }

/** Lecture en base de l'état courant du compte, sous le GUC tenant (RLS). */
async function defaultFetchState(userId, tenantId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const { rows } = await client.query('SELECT active, status, role FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    return rows[0] || null; // null = compte introuvable (supprimé)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let fetchState = defaultFetchState;
/** Injection pour les tests ; sans argument, rétablit la lecture en base. */
function setFetchState(fn) { fetchState = fn || defaultFetchState; }

function classify(row) {
  if (!row) return { ok: false, reason: 'absent' };
  if (row.active === false || row.status === 'pending') return { ok: false, reason: 'inactive' };
  return { ok: true, role: normalizeRole(row.role) };
}

/**
 * État de session mis en cache. Renvoie `{ ok: true, role }`,
 * `{ ok: false, reason }`, ou `{ unknown: true }` si la base est injoignable
 * (l'appelant doit alors laisser passer : repli sur le jeton).
 */
async function userSessionState(userId, tenantId, now = Date.now()) {
  const hit = cache.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.state;
  let state;
  try {
    state = classify(await fetchState(userId, tenantId));
  } catch {
    return { unknown: true }; // non mis en cache : on réessaiera à la prochaine requête
  }
  cache.set(userId, { at: now, state });
  return state;
}

/** Oublie l'entrée d'un utilisateur (effet immédiat après désactivation / changement de rôle). */
function invalidate(userId) { cache.delete(userId); }

const enabled = () => process.env.SESSION_ACTIVE_CHECK === '1';

module.exports = { userSessionState, invalidate, setFetchState, enabled, TTL_MS };
