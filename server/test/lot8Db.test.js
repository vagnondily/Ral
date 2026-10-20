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

test('note du TPM : la validation lit les notes validées des agents de la période (ancienne /20 comprise) ; version vue exigée', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const users = await q("SELECT id, email FROM users WHERE tenant_id = $1 AND email IN ('admin@mems.mg', 'validateur@mems.mg')", [T]);
  const admin = users.find((u) => u.email === 'admin@mems.mg').id; const validator = users.find((u) => u.email === 'validateur@mems.mg').id;
  const [tpm] = await q("SELECT p.id FROM partners p JOIN partner_types t ON t.id = p.partner_type_id WHERE p.tenant_id = $1 AND t.code = 'tpm' AND p.name = 'YPA'", [T]);
  const agents = await q('SELECT id FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2 AND active ORDER BY name LIMIT 2', [T, tpm.id]);
  const service = require('../src/modules/evaluation/evaluation.service');
  const legacy = await q(`INSERT INTO tpm_agent_evaluations (tenant_id, agent_id, periode, period_to, status, legacy, note, evaluated_by)
                          VALUES ($1, $2, '2019-02-01', '2019-02-01', 'validee', true, 14, $3), ($1, $4, '2018-06-01', '2018-06-01', 'validee', true, 6, $3)
                          RETURNING id`, [T, agents[0].id, validator, agents[1].id]);
  let evalId = null;
  try {
    // Le brouillon voit déjà la note de l'agent (aperçu), la validation la fige.
    const criteria = (await service.listCriteria(T, 'prestataire')).filter((c) => c.active);
    const draft = await service.createProviderEvaluation(T, tpm.id, { periodFrom: '2019-01', periodTo: '2019-06', evaluatedOn: '2019-07-01',
      ratings: criteria.map((c) => ({ code: c.code, rating: 3 })) }, admin);
    evalId = draft.id;
    const shown = await service.getProviderEvaluation(T, tpm.id, evalId);
    assert.equal(shown.preview.agentsCount, 1, 'une note d\'agent dans la période (l\'autre, de 2018, hors période)');
    assert.equal(shown.preview.agentsScore, 14);
    // Version vue périmée → 409, rien n'est figé.
    await assert.rejects(service.validateProviderEvaluation(T, tpm.id, evalId, validator, '2000-01-01T00:00:00.000Z'), (e) => e.statusCode === 409);
    // Un autre gestionnaire ne supprime pas le brouillon d'un autre (403) ; seul l'évaluateur ou un administrateur.
    await assert.rejects(service.deleteProviderEvaluation(T, tpm.id, evalId, { userId: validator, role: 'manager' }), (e) => e.statusCode === 403);
    const done = await service.validateProviderEvaluation(T, tpm.id, evalId, validator, new Date(shown.updatedAt).toISOString());
    assert.deepEqual([done.status, done.agentsCount, done.agentsScore], ['validee', 1, 14]);
    assert.equal(done.detail.basis, 'both');
  } finally {
    await q('BEGIN');
    await q("SET LOCAL session_replication_role = 'replica'"); // évaluation validée = figée : nettoyage du test seulement
    if (evalId) {
      await q('DELETE FROM tpm_provider_evaluation_scores WHERE tenant_id = $1 AND evaluation_id = $2', [T, evalId]);
      await q('DELETE FROM tpm_provider_evaluations WHERE tenant_id = $1 AND id = $2', [T, evalId]);
    }
    await q('DELETE FROM tpm_agent_evaluations WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, legacy.map((r) => r.id)]);
    await q('COMMIT');
  }
});

test('088 : une évaluation d\'agent validée (hors ancienne) sans évaluateur est refusée par la base', { skip: SKIP }, async () => {
  const [agent] = await q('SELECT tenant_id, id FROM tpm_agents ORDER BY created_at LIMIT 1');
  await q('BEGIN');
  try {
    await assert.rejects(q(`INSERT INTO tpm_agent_evaluations (tenant_id, agent_id, periode, period_to, status, legacy, final_score, band, validated_by, validated_at)
                            SELECT $1, $2, '2019-01-01', '2019-01-01', 'validee', false, 12, 'bon', u.id, now() FROM users u WHERE u.tenant_id = $1 LIMIT 1`,
    [agent.tenant_id, agent.id]), (e) => e.code === '23514' && /agent_eval_duty_chk/.test(e.constraint || e.message));
  } finally { await q('ROLLBACK'); }
});

test('critères : une lecture n\'écrit rien (critères par défaut non enregistrés) ; la première évaluation les enregistre', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const before = await q("SELECT count(*)::int AS n FROM evaluation_criteria WHERE tenant_id = $1 AND scope = 'agent'", [T]);
  const list = await require('../src/modules/evaluation/evaluation.service').listCriteria(T, 'agent');
  const after = await q("SELECT count(*)::int AS n FROM evaluation_criteria WHERE tenant_id = $1 AND scope = 'agent'", [T]);
  assert.equal(after[0].n, before[0].n, 'GET sans écriture');
  if (before[0].n === 0) assert.ok(list.length > 0 && list.every((c) => c.id === null && c.isDefault));
});

test('listes de choix d\'un TPM sur les données de démonstration : aucun titulaire dont le contrat a un TPM rattaché', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const repo = require('../src/modules/tpm/activeProvider.repository');
  const { monthsOf } = require('../src/modules/tpm/activeProvider');
  const sel = await repo.selectable(T, monthsOf('2025-10', '2026-09'));
  const contrat = sel.groups.find((g) => g.key === 'contrat').providers;
  const holdersWithTpm = await q(`SELECT DISTINCT c.partner_id AS id FROM contracts c
      WHERE c.tenant_id = $1 AND EXISTS (SELECT 1 FROM tpm_reports r JOIN partners p ON p.id = r.partner_id JOIN partner_types t ON t.id = p.partner_type_id
                                          WHERE r.contract_id = c.id AND t.code = 'tpm' AND p.active AND r.partner_id <> c.partner_id)`, [T]);
  for (const h of holdersWithTpm) {
    const shown = contrat.find((p) => p.id === h.id);
    assert.ok(!shown || shown.typeCode === 'tpm', `titulaire ${h.id} absent du groupe « contrat »`);
  }
  assert.ok(contrat.length > 0 && contrat.every((p) => p.typeCode === 'tpm'), contrat.map((p) => `${p.name}[${p.typeCode}]`).join(', '));
});

test('formations : fiche, agents, frise, Évaluation des agents et rapport comptent la même chose (ni annulée, ni absent) ; chiffres clés en SQL', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [tpm] = await q("SELECT p.id FROM partners p WHERE p.tenant_id = $1 AND p.name = 'SAHY Monitoring'", [T]);
  const [agent] = await q('SELECT id FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2 ORDER BY name LIMIT 1', [T, tpm.id]);
  const trainings = require('../src/modules/trainings/trainings.service');
  const partners = require('../src/modules/partners/partners.service');
  const partnersRepo = require('../src/modules/partners/partners.repository');
  const tpmRepo = require('../src/modules/tpm/tpm.repository');
  const count = async () => {
    const sheet = await partners.sheet(T, tpm.id);
    const agents = await partnersRepo.listAgents(T, tpm.id);
    const prov = (await tpmRepo.listProviders(T)).find((p) => p.id === tpm.id);
    const report = await tpmRepo.listFormationsReport(T, { partnerId: tpm.id });
    const tl = await partnersRepo.timeline(T, tpm.id);
    return {
      sheet: sheet.facts ? (sheet.facts.trainings ?? sheet.counts?.trainings) : null,
      agent: agents.find((a) => a.id === agent.id).trainings,
      evalAgent: prov.agents.find((a) => a.id === agent.id).formations.length,
      report: report.filter((r) => r.agentId === agent.id).length,
      timeline: tl.items.filter((i) => i.kind === 'formation').length,
    };
  };
  const before = await count();
  const mk = (title, startDate, status) => trainings.create(T, { title, startDate, endDate: startDate, status, agentIds: [agent.id] }, null);
  const made = [];
  try {
    made.push(await mk('Test lot 8 — suivie', '2026-01-12', 'realisee'));
    made.push(await mk('Test lot 8 — annulée', '2026-01-13', 'annulee'));
    made.push(await mk('Test lot 8 — absent', '2026-01-14', 'realisee'));
    await trainings.updateParticipants(T, made[2].id, [{ agentId: agent.id, attendance: 'absent' }]);
    const after = await count();
    for (const k of Object.keys(before)) assert.equal(after[k] - before[k], 1, `${k} : +1 (seule la session suivie compte)`);
    // Frise : une formation à venir est « prévue », jamais « suivie ».
    const future = await mk('Test lot 8 — à venir', '2099-01-05', 'planifiee');
    made.push(future);
    const tl = await partnersRepo.timeline(T, tpm.id);
    const item = tl.items.find((i) => i.ref === future.id);
    assert.ok(item && /prévue/.test(item.message.text), 'formation à venir : « prévue »');
    // Chiffres clés de la page Formations : en SQL sur toutes les sessions.
    const s = await trainings.summary(T, {});
    const [{ n }] = await q('SELECT count(*)::int AS n FROM training_sessions WHERE tenant_id = $1', [T]);
    assert.equal(s.sessions, n);
    assert.equal(s.limit, 500);
  } finally {
    await q('DELETE FROM training_sessions WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.map((m) => m.id)]);
  }
});
