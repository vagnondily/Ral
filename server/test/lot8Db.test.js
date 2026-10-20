/**
 * Lot 8 (Partenaires & TPM) — contrôles EN BASE RÉELLE, sur demande (revue de 4f66a46).
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables les tests sont ignorés : npm test reste sans base. Tout ce qu'un test écrit est
 * annulé ou supprimé à la fin.
 */
const SU_URL = process.env.MEMS_TEST_DATABASE_URL;
const APP_URL = process.env.MEMS_TEST_APP_DATABASE_URL;
const dbName = (u) => { try { return decodeURIComponent(new URL(u).pathname.slice(1)); } catch { return ''; } };
const enabled = Boolean(SU_URL && APP_URL && /test/i.test(dbName(SU_URL)) && dbName(SU_URL) === dbName(APP_URL));
if (enabled) process.env.APP_DATABASE_URL = APP_URL; // pool partagé de l'API (config/db) sur la base jetable
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');

const SKIP = enabled ? false : 'base jetable absente (MEMS_TEST_DATABASE_URL / MEMS_TEST_APP_DATABASE_URL, nom contenant « test »)';

let su = null;
async function q(sql, params) {
  if (!su) {
    const { Client } = require('pg');
    su = new Client({ connectionString: SU_URL });
    await su.connect();
  }
  return (await su.query(sql, params)).rows;
}
test.after(async () => {
  if (su) await su.end();
  if (enabled) await require('../src/config/db').pool.end();
});

test('seed : les formations de démonstration sont des SESSIONS (page Formations, onglet de la fiche, compteurs)', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const sessions = await q("SELECT id FROM training_sessions WHERE tenant_id = $1 AND legacy_key LIKE 'seed|%'", [T]);
  assert.ok(sessions.length >= 6, `sessions du seed : ${sessions.length}`);
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM training_participants p JOIN training_sessions s ON s.id = p.session_id
                            WHERE s.tenant_id = $1 AND s.legacy_key LIKE 'seed|%' AND p.provider_id IS NOT NULL AND p.attendance = 'present'`, [T]);
  assert.ok(n >= 6, `participants présents avec leur TPM : ${n}`);
  const trainings = require('../src/modules/trainings/trainings.service');
  const list = await trainings.list(T, {});
  assert.ok(list.rows ? list.rows.length >= 6 : list.length >= 6, 'la liste des formations n\'est pas vide');
});

test('formation : PATCH partiel d\'un participant (pré-test seul) garde présence, jours, post-test et avis', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [agent] = await q('SELECT id, tpm_provider_id AS p FROM tpm_agents WHERE tenant_id = $1 AND active ORDER BY name LIMIT 1', [T]);
  const service = require('../src/modules/trainings/trainings.service');
  const created = await service.create(T, { title: 'Test lot 8 — saisie partielle', startDate: '2019-05-06', endDate: '2019-05-08', scoreMax: 20, agentIds: [agent.id] }, null);
  try {
    await service.updateParticipants(T, created.id, [{ agentId: agent.id, attendance: 'present', daysPresent: 3, preScore: 8, postScore: 15, satisfaction: 4, feedback: 'Utile' }]);
    await service.updateParticipants(T, created.id, [{ agentId: agent.id, preScore: 9 }]);
    const p = (await service.get(T, created.id)).participants[0];
    assert.deepEqual([p.attendance, p.daysPresent, p.preScore, p.postScore, p.satisfaction, p.feedback], ['present', 3, 9, 15, 4, 'Utile']);
    // L'état COMPLET est contrôlé : « absent » sur une ligne qui a un post-test → 400.
    await assert.rejects(service.updateParticipants(T, created.id, [{ agentId: agent.id, attendance: 'absent' }]), (e) => e.statusCode === 400);
  } finally {
    await q('DELETE FROM training_sessions WHERE tenant_id = $1 AND id = $2', [T, created.id]);
  }
});
