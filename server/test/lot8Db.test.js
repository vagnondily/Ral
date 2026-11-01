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
  let freshTpm = null;
  try {
    made.push(await mk('Test lot 8 — suivie', '2026-01-12', 'realisee'));
    made.push(await mk('Test lot 8 — annulée', '2026-01-13', 'annulee'));
    made.push(await mk('Test lot 8 — absent', '2026-01-14', 'realisee'));
    await trainings.updateParticipants(T, made[2].id, [{ agentId: agent.id, attendance: 'absent' }]);
    const after = await count();
    for (const k of Object.keys(before)) assert.equal(after[k] - before[k], 1, `${k} : +1 (seule la session suivie compte)`);
    // Une formation à venir (planifiée, présence non saisie) n'est « suivie » NULLE PART ; la frise la
    // montre « prévue ».
    const future = await mk('Test lot 8 — à venir', '2099-01-05', 'planifiee');
    made.push(future);
    const withFuture = await count();
    for (const k of Object.keys(after)) assert.equal(withFuture[k], after[k] + (k === 'timeline' ? 1 : 0), `${k} : une formation à venir ne compte pas`);
    let tl = await partnersRepo.timeline(T, tpm.id);
    let item = tl.items.find((i) => i.ref === future.id);
    assert.ok(item && /prévue/.test(item.message.text), 'formation à venir : « prévue »');
    // « TPM formés » : un TPM NEUF dont la seule formation est à venir n'y entre pas (sous l'ancienne
    // règle il y entrait : +1).
    const [fresh] = await q(`INSERT INTO partners (tenant_id, partner_type_id, name)
                             SELECT $1, t.id, 'Test lot 8 — TPM neuf' FROM partner_types t WHERE t.tenant_id = $1 AND t.code = 'tpm' RETURNING id`, [T]);
    freshTpm = fresh.id;
    const [freshAgent] = await q("INSERT INTO tpm_agents (tenant_id, tpm_provider_id, name) VALUES ($1, $2, 'Test lot 8 — agent neuf') RETURNING id", [T, freshTpm]);
    const summaryBefore = await trainings.summary(T, {});
    made.push(await trainings.create(T, { title: 'Test lot 8 — à venir (TPM neuf)', startDate: '2099-03-02', endDate: '2099-03-02', status: 'planifiee', agentIds: [freshAgent.id] }, null));
    assert.equal((await trainings.summary(T, {})).providers, summaryBefore.providers, '« TPM formés » : le TPM neuf n\'y entre pas');
    assert.equal((await partners.sheet(T, freshTpm)).facts.trainings, 0, 'fiche du TPM neuf : 0 formation suivie');
    // Une session « réalisée » datée dans le futur : comptée partout ET « suivie » dans la frise (même règle heldSql).
    const doneFuture = await mk('Test lot 8 — réalisée datée au futur', '2099-02-01', 'realisee');
    made.push(doneFuture);
    const withDone = await count();
    for (const k of Object.keys(after)) assert.equal(withDone[k], withFuture[k] + 1, `${k} : une session réalisée compte, quelle que soit sa date`);
    tl = await partnersRepo.timeline(T, tpm.id);
    item = tl.items.find((i) => i.ref === doneFuture.id);
    assert.ok(item && /suivie/.test(item.message.text), 'réalisée : « suivie », jamais « prévue »');
    // Chiffres clés de la page Formations : en SQL sur toutes les sessions.
    const s = await trainings.summary(T, {});
    const [{ n }] = await q('SELECT count(*)::int AS n FROM training_sessions WHERE tenant_id = $1', [T]);
    assert.equal(s.sessions, n);
    assert.equal(s.limit, 500);
  } finally {
    await q('DELETE FROM training_sessions WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.map((m) => m.id)]);
    if (freshTpm) {
      await q('DELETE FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2', [T, freshTpm]);
      await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, freshTpm]);
    }
  }
});

test('type d\'un TPM changé par PATCH : le TPM des visites prévues de ses zones est recalculé (aller et retour)', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [ypa] = await q("SELECT p.id, p.partner_type_id AS type FROM partners p WHERE p.tenant_id = $1 AND p.name = 'YPA'", [T]);
  const [cabinet] = await q("SELECT id FROM partner_types WHERE tenant_id = $1 AND code = 'cabinet'", [T]);
  const [site] = await q(`SELECT v.site_id AS id FROM site_visits v WHERE v.tenant_id = $1 AND v.provider_id = $2 AND v.provider_source = 'zone'
                           AND v.provider_zone_state = 'contrat' ORDER BY v.site_id LIMIT 1`, [T, ypa.id]);
  assert.ok(site, 'un site de la zone d\'un contrat suivi par YPA');
  // Mois COURANT (la réestampille part du mois courant) : le contrat suivi par YPA est prolongé au besoin
  // pour le couvrir (le test ne dépend pas des dates figées du seed), puis rétabli.
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Indian/Antananarivo' }).format(new Date()).slice(0, 7);
  const [contract] = await q(`SELECT DISTINCT c.id, c.date_fin::text AS fin FROM contracts c JOIN tpm_reports r ON r.contract_id = c.id AND r.tenant_id = c.tenant_id
                               WHERE c.tenant_id = $1 AND r.partner_id = $2 AND c.status = 'actif' LIMIT 1`, [T, ypa.id]);
  if (contract.fin < `${month}-01`) await q("UPDATE contracts SET date_fin = ($3::date + interval '2 months')::date WHERE tenant_id = $1 AND id = $2", [T, contract.id, `${month}-01`]);
  const [{ id: visit }] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status)
                                   VALUES ($1, $2, $3::date, 'Test lot 8 réestampille', 'planifie') RETURNING id`, [T, site.id, `${month}-01`]);
  const tpmOf = async () => (await q('SELECT p.name FROM site_visits v LEFT JOIN partners p ON p.id = v.provider_id WHERE v.id = $1', [visit]))[0].name;
  const settings = require('../src/modules/settings/settings.repository');
  try {
    assert.equal(await tpmOf(), 'YPA');
    await settings.updatePartner(T, ypa.id, { partnerTypeId: cabinet.id });
    assert.notEqual(await tpmOf(), 'YPA', 'YPA n\'est plus un TPM : la visite prévue ne lui est plus attribuée');
    await settings.updatePartner(T, ypa.id, { partnerTypeId: ypa.type });
    assert.equal(await tpmOf(), 'YPA', 'type rétabli : la visite revient à YPA');
  } finally {
    await q('UPDATE partners SET partner_type_id = $3 WHERE tenant_id = $1 AND id = $2', [T, ypa.id, ypa.type]);
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND id = $2', [T, visit]);
    await q('UPDATE contracts SET date_fin = $3::date WHERE tenant_id = $1 AND id = $2', [T, contract.id, contract.fin]);
  }
});

test('agent : « hasHistory » = la règle de la suppression (une participation « absent » suffit) ; le bouton suit', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [tpm] = await q("SELECT id FROM partners WHERE tenant_id = $1 AND name = 'SAHY Monitoring'", [T]);
  const [agent] = await q("INSERT INTO tpm_agents (tenant_id, tpm_provider_id, name) VALUES ($1, $2, 'Test lot 8 — agent absent') RETURNING id", [T, tpm.id]);
  const trainings = require('../src/modules/trainings/trainings.service');
  const repo = require('../src/modules/partners/partners.repository');
  let session = null;
  try {
    const row = async () => (await repo.listAgents(T, tpm.id)).find((a) => a.id === agent.id);
    assert.equal((await row()).hasHistory, false, 'agent neuf : supprimable');
    session = await trainings.create(T, { title: 'Test lot 8 — absent', startDate: '2026-02-02', endDate: '2026-02-02', status: 'realisee', agentIds: [agent.id] }, null);
    await trainings.updateParticipants(T, session.id, [{ agentId: agent.id, attendance: 'absent' }]);
    const r = await row();
    assert.deepEqual([r.trainings, r.hasHistory], [0, true], 'aucune formation suivie, mais un historique');
    await assert.rejects(repo.deleteAgent(T, tpm.id, agent.id), (e) => e.statusCode === 409);
  } finally {
    if (session) await q('DELETE FROM training_sessions WHERE tenant_id = $1 AND id = $2', [T, session.id]);
    await q('DELETE FROM tpm_agents WHERE tenant_id = $1 AND id = $2', [T, agent.id]);
  }
});

test('Paramétrage › Partenaires pendant une écriture de l\'attribution, dans les deux ordres : ni interblocage ni échec (rôle changé, renommage)', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const types = Object.fromEntries((await q("SELECT code, id FROM partner_types WHERE tenant_id = $1 AND code IN ('tpm', 'prestataire')", [T])).map((r) => [r.code, r.id]));
  const name = 'Test lot 8 — TPM verrou';
  const [partner] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, types.tpm, name]);
  const [site] = await q('SELECT id FROM sites WHERE tenant_id = $1 ORDER BY id LIMIT 1', [T]);
  const [contract] = await q('SELECT id FROM contracts WHERE tenant_id = $1 AND partner_id <> $2 ORDER BY id LIMIT 1', [T, partner.id]);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Indian/Antananarivo' }).format(new Date()).slice(0, 7);
  const settings = require('../src/modules/settings/settings.repository');
  const { ATTRIBUTION_KEY } = require('../src/modules/tpm/tpmAttribution.repository');
  const { Client } = require('pg');
  const other = new Client({ connectionString: SU_URL }); // l'autre écrivain (attribution, visites, contrats)
  await other.connect();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const why = (e) => e && `${e.code} ${e.message}`;
  // Ce que l'écran Paramétrage › Partenaires envoie toujours : { name, partnerTypeId, active }.
  const update = (patch) => settings.updatePartner(T, partner.id, { active: true, ...patch }).then((ok) => ({ ok }), (err) => ({ err }));
  const lockAttribution = () => other.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ATTRIBUTION_KEY(T)]);
  const visits = []; let committed = 0; // visites validées (une transaction annulée n'en laisse aucune)
  const writeVisit = async (activity) => {
    const { rows } = await other.query(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_reason)
      VALUES ($1, $2, $3::date, $4, 'planifie', 'visite', $5, 'Écart motivé — test du lot 8') RETURNING id`, [T, site.id, `${month}-01`, activity, partner.id]);
    visits.push(rows[0].id);
  };
  const begin = async () => { await other.query('BEGIN'); await other.query("SET LOCAL lock_timeout = '15s'"); };
  const finish = async (fn, end = 'COMMIT') => {
    try { await fn(); await other.query(end); if (end === 'COMMIT') committed = visits.length; else visits.length = committed; return null; } catch (e) { await other.query('ROLLBACK'); visits.length = committed; return e; }
  };
  // La mise à jour attend-elle un verrou ? 'advisory' = le verrou d'attribution ; 'ligne' = la clé de l'autre.
  const waitsOn = async (kind) => {
    for (let i = 0; i < 200; i += 1) {
      const rows = await q(`SELECT wait_event FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
                              AND pid NOT IN ($1, pg_backend_pid())`, [other.processID]);
      if (rows.some((r) => (kind === 'advisory') === (r.wait_event === 'advisory'))) return true;
      await sleep(50);
    }
    return false;
  };
  const state = async () => (await q('SELECT partner_type_id AS type, name FROM partners WHERE id = $1', [partner.id]))[0];
  const settled = (label, writerErr, r) => {
    assert.equal(writerErr, null, `${label} — l'autre écrivain : ${why(writerErr)}`);
    assert.equal(r.err, undefined, `${label} — mise à jour : ${why(r.err)}`);
    assert.equal(r.ok, true, label);
  };
  // « Verrou d'abord » : l'écrivain tient le verrou d'attribution PUIS écrit provider_id = la fiche
  // (setOverrides, applyVisitRequestTx) ; la mise à jour, lancée entre les deux, attend le verrou AVANT la ligne.
  const lockThenWrite = async (label, patch) => {
    await begin();
    await lockAttribution();
    const pending = update(patch);
    const waited = await waitsOn('advisory');
    const writerErr = await finish(() => writeVisit(label));
    const r = await pending;
    assert.ok(waited, `${label} : la mise à jour attend le verrou d'attribution`);
    settled(label, writerErr, r);
  };
  // « Clé d'abord » : l'écrivain pose la clé étrangère PUIS prend le verrou d'attribution
  // (restampVisitsTx en fin d'écriture ; approbation d'un avenant : contrat puis restampFromNow).
  const writeThenLock = async (label, write, patch, { waitsForKey, end = 'COMMIT' }) => {
    await begin();
    await write();
    const pending = update(patch);
    let alone = null;
    if (waitsForKey) assert.ok(await waitsOn('ligne'), `${label} : renommage — la mise à jour attend la clé de l'autre (FOR UPDATE)`);
    else alone = await Promise.race([pending.then(() => true), sleep(10000).then(() => false)]);
    const writerErr = await finish(lockAttribution, end);
    const r = await pending;
    if (!waitsForKey) assert.ok(alone, `${label} : nom inchangé — la mise à jour n'attend pas la clé de l'autre`);
    settled(label, writerErr, r);
  };
  try {
    // 1. Verrou d'abord ; type changé, nom renvoyé inchangé (l'interblocage de la revue W1 : 40P01).
    await lockThenWrite('Test lot 8 verrou 1', { name, partnerTypeId: types.prestataire });
    assert.deepEqual(await state(), { type: types.prestataire, name });
    // 2. Verrou d'abord ; renommé ET type changé (le verrou d'attribution pris d'abord évite l'interblocage).
    await lockThenWrite('Test lot 8 verrou 2', { name: `${name} 2`, partnerTypeId: types.tpm });
    assert.deepEqual(await state(), { type: types.tpm, name: `${name} 2` });
    // 3. Clé d'abord ; type changé, nom inchangé : rien n'attend (l'UPDATE ne liste pas `name`).
    await writeThenLock('Test lot 8 verrou 3', () => writeVisit('Test lot 8 verrou 3'), { name: `${name} 2`, partnerTypeId: types.prestataire }, { waitsForKey: false });
    assert.deepEqual(await state(), { type: types.prestataire, name: `${name} 2` });
    // 4. Clé d'abord (visite) ; RENOMMAGE SEUL — rôle renvoyé inchangé : pas de verrou d'attribution, la
    //    mise à jour attend la fin de l'écrivain et passe (revue de 4b3d963 : 40P01).
    await writeThenLock('Test lot 8 verrou 4', () => writeVisit('Test lot 8 verrou 4'), { name: `${name} 4`, partnerTypeId: types.prestataire }, { waitsForKey: true });
    assert.deepEqual(await state(), { type: types.prestataire, name: `${name} 4` });
    // 5. Clé d'abord (contrat, comme l'approbation d'un avenant) ; renommage seul. Transaction de
    //    l'écrivain annulée à la fin (le contrat de démonstration reste tel quel ; un COMMIT ne prend
    //    aucun autre verrou ici).
    await writeThenLock('Test lot 8 verrou 5', () => other.query('UPDATE contracts SET partner_id = $3 WHERE tenant_id = $1 AND id = $2', [T, contract.id, partner.id]),
      { name: `${name} 5`, partnerTypeId: types.prestataire }, { waitsForKey: true, end: 'ROLLBACK' });
    assert.deepEqual(await state(), { type: types.prestataire, name: `${name} 5` });
  } finally {
    await other.query('ROLLBACK').catch(() => {});
    await other.end();
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, visits]);
    await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, partner.id]);
  }
});

test('approbation d\'un avenant (contrat verrouillé FOR NO KEY UPDATE, puis réestampille) face à un écrivain qui tient le verrou d\'attribution puis pose contract_id : ni interblocage ni échec', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: U }] = await q('SELECT id FROM users WHERE tenant_id = $1 ORDER BY email LIMIT 1', [T]);
  const types = Object.fromEntries((await q("SELECT code, id FROM partner_types WHERE tenant_id = $1 AND code IN ('tpm', 'prestataire')", [T])).map((r) => [r.code, r.id]));
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Indian/Antananarivo' }).format(new Date()).slice(0, 7);
  // Un site d'un district sans contrat de suivi ce mois-ci : le contrat K du test sera le seul à le couvrir.
  const sites = await q('SELECT id, zone_district_id AS d FROM sites WHERE tenant_id = $1 AND zone_district_id IS NOT NULL ORDER BY id LIMIT 400', [T]);
  const cells = await q('SELECT c_site_id AS s, c_area_id AS a, c_state AS st FROM mems_tpm_cells($1, $2::uuid[], $3::date[])',
    [T, sites.map((x) => x.id), sites.map(() => `${month}-01`)]);
  const site = sites.find((x) => cells.some((c) => c.s === x.id && c.st === 'sans_contrat' && c.a === x.d));
  assert.ok(site, 'un site d\'un district sans contrat de suivi');
  const [area] = await q('SELECT path FROM admin_areas WHERE id = $1', [site.d]);
  const contractsRepo = require('../src/modules/contracts/contracts.repository');
  const { restampVisitsTx } = require('../src/modules/tpm/tpmAttribution.repository');
  const field = require('../src/modules/tpm/field.repository');
  const settings = require('../src/modules/settings/settings.repository');
  const { Client } = require('pg');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const why = (e) => e && `${e.code} ${e.message}`;
  const settle = (p) => p.then((ok) => ({ ok }), (err) => ({ err }));
  // Contrat de suivi actif K du district, titulaire H ; W = decideAmendment : contrat verrouillé
  // (loadForUpdate) et mis à jour (saveContract), ENSUITE restampFromNow (verrou d'attribution).
  const scenario = async (label, holder, writer) => {
    const made = {};
    const other = new Client({ connectionString: SU_URL });
    await other.connect();
    try {
      const [H] = await q('INSERT INTO partners (tenant_id, partner_type_id, name, active) VALUES ($1, $2, $3, $4) RETURNING id, name',
        [T, types[holder.type], `Test lot 8 — titulaire (${label})`, holder.active]);
      made.partner = H.id;
      const [K] = await q(`INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
         VALUES ($1, $2, $3, $4, $5::date, ($5::date + interval '3 month')::date, 'actif', $6) RETURNING id`, [T, `TEST-LOT8-${label}`, H.id, H.name, `${month}-01`, U]);
      made.contract = K.id;
      await q(`INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
               VALUES ($1, $2, 'IV.suivi', 'Test lot 8', 1, 1000, '{}'::jsonb, 0)`, [K.id, T]);
      await q('INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order) VALUES ($1, $2, $3, $4, 2, 0)', [K.id, T, site.d, area.path]);
      const activity = `Test lot 8 avenant (${label})`;
      if (writer.visitBefore) await q("INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, $3::date, $4, 'planifie')", [T, site.id, `${month}-01`, activity]);
      await other.query('BEGIN');
      await other.query("SET LOCAL lock_timeout = '15s'");
      await other.query("SELECT set_config('app.tenant_id', $1, true)", [T]);
      const locked = await contractsRepo.getContract(other, T, K.id, { forUpdate: true });
      assert.equal(await contractsRepo.updateContract(other, T, K.id, locked.version, { amendmentCount: 1 }), true);
      const pending = settle(writer.run({ H, activity }));
      const alone = await Promise.race([pending.then(() => true), sleep(10000).then(() => false)]);
      let writerErr = null;
      try { await restampVisitsTx(other, T, { fromMonth: month }); await other.query('ROLLBACK'); } catch (e) { writerErr = e; await other.query('ROLLBACK'); }
      const r = await pending;
      assert.ok(alone, `${label} : l'écrivain n'attend pas le verrou du contrat`);
      assert.equal(writerErr, null, `${label} — approbation de l'avenant : ${why(writerErr)}`);
      assert.equal(r.err, undefined, `${label} — écrivain : ${why(r.err)}`);
      const [v] = await q('SELECT provider_id AS p, contract_id AS c FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, activity]);
      assert.deepEqual(v, { p: H.id, c: K.id }, `${label} : la visite prévue est à H, sur le contrat K`);
    } finally {
      await other.query('ROLLBACK').catch(() => {});
      await other.end();
      await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, `Test lot 8 avenant (${label})`]);
      if (made.contract) await q('DELETE FROM contracts WHERE tenant_id = $1 AND id = $2', [T, made.contract]);
      if (made.partner) await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, made.partner]);
    }
  };
  // 1. Écrivain réel « verrou d'abord » : nouvelle visite (verrou d'attribution, visite, réestampille →
  //    contract_id = K). Avec l'ancien FOR UPDATE du contrat : 40P01.
  await scenario('visite', { type: 'tpm', active: true }, { run: ({ activity }) => field.createVisit(T, U, { siteId: site.id, periodMonth: month, activity }) });
  // 2. Changement de rôle du titulaire, nom inchangé (revue de db91f65) : type, puis réactivation. Sa
  //    réestampille pose contract_id = K là où le titulaire n'était pas TPM (règle d'estampille du
  //    retour 114) ; avec la règle du lot 8 (titulaire retenu quel que soit son rôle) la visite est déjà
  //    à H : rien n'est réécrit, le cas doit passer de même.
  for (const [label, holder] of [['type', { type: 'prestataire', active: true }], ['reactivation', { type: 'tpm', active: false }]]) {
    await scenario(label, holder, { visitBefore: true, run: ({ H }) => settings.updatePartner(T, H.id, { name: H.name, partnerTypeId: types.tpm, active: true }) });
  }
});

test('colonnes de clé (index uniques sans prédicat ni expression, DEFERRABLE compris, colonnes INCLUDE exclues — la règle de Postgres pour FOR UPDATE) : contrats et partenaires', { skip: SKIP }, async () => {
  const keyColumns = async (table) => (await q(`SELECT DISTINCT a.attname AS col FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY ((i.indkey::int2[])[0:i.indnkeyatts - 1])
     WHERE i.indrelid = $1::regclass AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL ORDER BY 1`, [table])).map((r) => r.col);
  // Auto-contrôle de la requête sur une table temporaire : un UNIQUE DEFERRABLE compte ; une colonne
  // INCLUDE, un index unique partiel ou sur expression non (même règle que Postgres : les seules
  // indnkeyatts premières colonnes de clé).
  await q('CREATE TEMP TABLE zz_lot8_keys (id int PRIMARY KEY, code text, code2 text, code3 text, extra text, CONSTRAINT zz_lot8_code UNIQUE (code) INCLUDE (extra) DEFERRABLE INITIALLY IMMEDIATE)');
  try {
    await q('CREATE UNIQUE INDEX ON zz_lot8_keys (lower(code2))');
    await q('CREATE UNIQUE INDEX ON zz_lot8_keys (code3) WHERE code3 IS NOT NULL');
    assert.deepEqual(await keyColumns('zz_lot8_keys'), ['code', 'id'], 'ni extra (INCLUDE), ni code2 (expression), ni code3 (partiel)');
  } finally { await q('DROP TABLE zz_lot8_keys'); }
  const contractsRepo = require('../src/modules/contracts/contracts.repository');
  assert.deepEqual(await keyColumns('contracts'), [...contractsRepo.CONTRACT_KEY_COLUMNS].sort(), 'CONTRACT_KEY_COLUMNS = les colonnes de clé de contracts');
  assert.deepEqual(Object.values(contractsRepo.CONTRACT_UPDATE_COLUMNS).filter((c) => contractsRepo.CONTRACT_KEY_COLUMNS.includes(c)), []);
  // partners : seule `name` est modifiable parmi ses clés — listée seulement si elle change (partnerRole.nameChanges).
  assert.deepEqual(await keyColumns('partners'), ['id', 'name', 'tenant_id']);
});

// ---- Suppression d'un contrat : données reliées vues, rien de supprimé en silence, estampille à jour ----
async function deletionFixture(label, { status = 'actif', months = 1 } = {}) {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: admin }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const [{ id: other }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email <> 'admin@mems.mg' ORDER BY email LIMIT 1", [T]);
  const [tpm] = await q("SELECT id FROM partner_types WHERE tenant_id = $1 AND code = 'tpm'", [T]);
  const [P] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id, name', [T, tpm.id, `Test lot 8 — TPM (${label})`]);
  const [K] = await q(`INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
     VALUES ($1, $2, $3, $4, '2031-01-01'::date, ('2031-01-01'::date + make_interval(months => $5::int))::date - 1, $6, $7) RETURNING id`,
  [T, `TEST-LOT8-SUPPR-${label}`, P.id, P.name, months, status, admin]);
  const reports = require('../src/modules/tpm/reports.repository');
  await reports.generateMonthlyStubs(T, { contractId: K.id, partnerId: P.id, createdBy: admin });
  const stubs = (await q('SELECT id FROM tpm_reports WHERE tenant_id = $1 AND contract_id = $2 ORDER BY period_month', [T, K.id])).map((r) => r.id);
  const cleanup = async () => {
    await q('DELETE FROM contracts WHERE tenant_id = $1 AND id = $2', [T, K.id]); // rapports et postes par cascade
    await q('DELETE FROM document_deletions WHERE tenant_id = $1 AND doc_id = $2', [T, K.id]);
    await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, P.id]);
  };
  return { T, admin, other, P, K, stubs, reports, cleanup };
}
const JUSTIFICATION = 'Contrat saisi par erreur — test du lot 8.';
const settled = (p) => p.then((ok) => ({ ok }), (err) => ({ err }));

test('suppression d\'un contrat pendant qu\'on remplit un de ses gabarits : refus 409, la facture et ses postes restent (rapports verrouillés avant le décompte)', { skip: SKIP }, async () => {
  const f = await deletionFixture('course');
  const contracts = require('../src/modules/contracts/contracts.service');
  const { Client } = require('pg');
  const timing = new Client({ connectionString: SU_URL }); // ne fait que fixer l'ordre : tient la ligne du gabarit
  await timing.connect();
  const waiters = async () => (await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()
                                          AND wait_event_type = 'Lock' AND pid NOT IN ($1, pg_backend_pid())`, [timing.processID]))[0].n;
  const until = async (n) => { for (let i = 0; i < 200; i += 1) { if (await waiters() >= n) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  try {
    assert.equal(f.stubs.length, 1);
    await timing.query('BEGIN');
    await timing.query('SELECT id FROM tpm_reports WHERE id = $1 FOR UPDATE', [f.stubs[0]]);
    const fill = settled(f.reports.replaceReportItems(f.T, f.stubs[0],
      [{ lineCode: 'IV.suivi', designation: 'Collecte terrain', unitCount: 1, unitCost: 250000 }], { userId: f.other }));
    assert.ok(await until(1), 'le remplissage attend la ligne du gabarit');
    const del = settled(contracts.deleteDraft(f.T, { userId: f.admin, role: 'admin' }, f.K.id, { justification: JUSTIFICATION }));
    assert.ok(await until(2), 'la suppression attend aussi');
    await timing.query('ROLLBACK');
    const [filled, deleted] = [await fill, await del];
    assert.equal(filled.ok, f.stubs[0], 'gabarit rempli');
    assert.equal(deleted.err && deleted.err.statusCode, 409, `suppression refusée : ${deleted.err ? deleted.err.message : 'acceptée'}`);
    const [r] = await q(`SELECT r.reported_amount::float8 AS amount, (SELECT count(*)::int FROM contract_report_items i WHERE i.report_id = r.id) AS items
                           FROM tpm_reports r WHERE r.id = $1`, [f.stubs[0]]);
    assert.deepEqual(r, { amount: 250000, items: 1 }, 'la facture et son poste restent');
    assert.equal((await q('SELECT count(*)::int AS n FROM document_deletions WHERE doc_id = $1', [f.K.id]))[0].n, 0, 'rien de journalisé');
  } finally {
    await timing.query('ROLLBACK').catch(() => {});
    await timing.end();
    await f.cleanup();
  }
});

test('suppression d\'un contrat : une facture brouillon à la charge de l\'ONG (montant bailleur 0) est une donnée reliée ; un gabarit vierge ou « non applicable » non', { skip: SKIP }, async () => {
  const f = await deletionFixture('ong', { status: 'brouillon', months: 3 });
  const contracts = require('../src/modules/contracts/contracts.service');
  const actor = { userId: f.admin, role: 'admin' };
  try {
    assert.equal(f.stubs.length, 3);
    await f.reports.replaceReportItems(f.T, f.stubs[0],
      [{ lineCode: 'I.salaires_mt', designation: 'Salaire enquêteur (ONG)', unitCount: 3, unitCost: 150000, payBy: 'ong', bailleurPct: 0 }], { userId: f.other });
    const [ong] = await q('SELECT reported_amount::float8 AS a, status FROM tpm_reports WHERE id = $1', [f.stubs[0]]);
    assert.deepEqual(ong, { a: 0, status: 'attendu' }, 'facture ONG : montant bailleur 0, toujours « attendu »');
    await assert.rejects(contracts.deleteDraft(f.T, actor, f.K.id, {}), (e) => e.statusCode === 409 && /1 rapport/.test(e.message));
    await q('DELETE FROM tpm_reports WHERE id = $1', [f.stubs[0]]);
    // Restent un « non applicable » (avec son motif) et un gabarit vierge : ils ne retiennent pas la
    // suppression (règle documentée de contractLinks) et partent avec le contrat.
    assert.equal((await f.reports.markNotApplicable(f.T, f.stubs[1], f.other, 'Aucun suivi ce mois')).ok, true);
    await contracts.deleteDraft(f.T, actor, f.K.id, {});
    assert.equal((await q('SELECT count(*)::int AS n FROM tpm_reports WHERE id = ANY($1::uuid[])', [f.stubs.slice(1)]))[0].n, 0);
  } finally {
    await f.cleanup();
  }
});

test('suppression d\'un contrat ACTIF : les visites prévues de ses zones sont réestampillées après le COMMIT (plus de « à arbitrer » périmé) ; un échec de cette étape ne fait pas échouer la suppression', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: admin }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const [tpm] = await q("SELECT id FROM partner_types WHERE tenant_id = $1 AND code = 'tpm'", [T]);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Indian/Antananarivo' }).format(new Date()).slice(0, 7);
  const sites = await q('SELECT id, zone_district_id AS d FROM sites WHERE tenant_id = $1 AND zone_district_id IS NOT NULL ORDER BY id LIMIT 400', [T]);
  const cellsOf = async (ids) => q('SELECT c_site_id AS s, c_area_id AS a, c_state AS st, c_provider_id AS p, c_contract_id AS c FROM mems_tpm_cells($1, $2::uuid[], $3::date[])',
    [T, ids, ids.map(() => `${month}-01`)]);
  const cells = await cellsOf(sites.map((x) => x.id));
  const site = sites.find((x) => cells.some((c) => c.s === x.id && c.st === 'sans_contrat' && c.a === x.d));
  assert.ok(site, 'un site d\'un district sans contrat de suivi');
  const [area] = await q('SELECT path FROM admin_areas WHERE id = $1', [site.d]);
  const contracts = require('../src/modules/contracts/contracts.service');
  const made = { partners: [], contracts: [] };
  try {
    // K (début plus ancien, TPM H1) et L (plus récent, TPM H2) couvrent le district : la visite est « à arbitrer », sur L.
    for (const [label, start] of [['K', `${month}-01`], ['L', `${month}-02`]]) {
      const [H] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id, name', [T, tpm.id, `Test lot 8 — TPM ${label} (suppression)`]);
      made.partners.push(H.id);
      const [C] = await q(`INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
         VALUES ($1, $2, $3, $4, $5::date, ($5::date + interval '3 month')::date, 'actif', $6) RETURNING id`, [T, `TEST-LOT8-ARB-${label}`, H.id, H.name, start, admin]);
      made.contracts.push(C.id);
      await q(`INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
               VALUES ($1, $2, 'IV.suivi', 'Test lot 8', 1, 1000, '{}'::jsonb, 0)`, [C.id, T]);
      await q('INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order) VALUES ($1, $2, $3, $4, 2, 0)', [C.id, T, site.d, area.path]);
    }
    const [K, L] = made.contracts;
    const [v] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status)
                         VALUES ($1, $2, $3::date, 'Test lot 8 suppression', 'planifie') RETURNING id`, [T, site.id, `${month}-01`]);
    made.visit = v.id;
    const visit = async () => (await q('SELECT provider_zone_state AS st, provider_id AS p, contract_id AS c FROM site_visits WHERE id = $1', [v.id]))[0];
    assert.deepEqual(await visit(), { st: 'a_arbitrer', p: made.partners[1], c: L }, 'avant : deux contrats, L retenu');
    await contracts.deleteDraft(T, { userId: admin, role: 'admin' }, K, { justification: JUSTIFICATION });
    made.contracts.shift();
    const [cell] = await cellsOf([site.id]);
    assert.deepEqual(await visit(), { st: 'contrat', p: made.partners[1], c: L }, 'après : un seul contrat, L');
    assert.deepEqual({ st: cell.st, p: cell.p, c: cell.c }, { st: 'contrat', p: made.partners[1], c: L }, 'même chose que mems_tpm_cells');
    // Étape d'après COMMIT en échec (compte illisible) : journalisée, jamais renvoyée.
    assert.equal(await contracts.restampAfterContractDelete('pas-un-uuid', K), false);
  } finally {
    if (made.visit) await q('DELETE FROM site_visits WHERE id = $1', [made.visit]);
    for (const c of made.contracts) await q('DELETE FROM contracts WHERE tenant_id = $1 AND id = $2', [T, c]);
    await q("DELETE FROM document_deletions WHERE tenant_id = $1 AND doc_ref LIKE 'Contrat TEST-LOT8-ARB-%'", [T]);
    for (const p of made.partners) await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, p]);
  }
});

test('roleForUpdateTx en base : renommage seul sans verrou d\'attribution ; rôle changé entre la lecture et le verrou → ligne rendue, verrou d\'attribution, ligne reprise', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const types = Object.fromEntries((await q("SELECT code, id FROM partner_types WHERE tenant_id = $1 AND code IN ('tpm', 'prestataire')", [T])).map((r) => [r.code, r.id]));
  const name = 'Test lot 8 — TPM course';
  const [partner] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, types.tpm, name]);
  const { roleForUpdateTx } = require('../src/modules/partners/partnerRole');
  const { Client } = require('pg');
  const mine = new Client({ connectionString: SU_URL }); // la transaction observée
  const other = new Client({ connectionString: SU_URL });
  await mine.connect(); await other.connect();
  const held = async () => (await q('SELECT locktype FROM pg_locks WHERE pid = $1 AND granted', [mine.processID])).map((l) => l.locktype);
  const screen = { name: `${name} 2`, partnerTypeId: types.tpm, active: true }; // renommage, rôle renvoyé inchangé
  try {
    await mine.query('BEGIN');
    assert.equal((await roleForUpdateTx(mine, T, partner.id, screen)).partnerTypeId, types.tpm);
    assert.ok(!(await held()).includes('advisory'), 'renommage seul : pas de verrou d\'attribution');
    await mine.query('ROLLBACK');
    // Un autre enregistrement change le type APRÈS notre lecture sans verrou, AVANT notre verrou de ligne.
    let first = true;
    const racing = { query: async (text, params) => {
      const r = await mine.query(text, params);
      if (first) { first = false; await other.query('UPDATE partners SET partner_type_id = $2 WHERE id = $1', [partner.id, types.prestataire]); }
      return r;
    } };
    await mine.query('BEGIN');
    const row = await roleForUpdateTx(racing, T, partner.id, screen);
    assert.equal(row.partnerTypeId, types.prestataire, 'l\'état comparé est celui lu sous verrou');
    assert.ok((await held()).includes('advisory'), 'le rôle change désormais : verrou d\'attribution pris');
    await assert.rejects(other.query('SELECT 1 FROM partners WHERE id = $1 FOR NO KEY UPDATE NOWAIT', [partner.id]), (e) => e.code === '55P03', 'ligne reprise sous verrou');
    await other.query('SELECT 1 FROM partners WHERE id = $1 FOR KEY SHARE NOWAIT', [partner.id]); // une clé étrangère passe
  } finally {
    await mine.query('ROLLBACK').catch(() => {});
    await mine.end(); await other.end();
    await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, partner.id]);
  }
});

test('plan de collecte et facture : refusés pour un partenaire qui n\'est pas un TPM actif (400 + garde en base)', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [aina] = await q("SELECT id FROM partners WHERE tenant_id = $1 AND name = 'ASSOCIATION AINA'", [T]);
  const [contract] = await q("SELECT id FROM contracts WHERE tenant_id = $1 AND partner_id = $2 AND status = 'actif' LIMIT 1", [T, aina.id]);
  const planning = require('../src/modules/tpm/planning.repository');
  const reports = require('../src/modules/tpm/reports.repository');
  await assert.rejects(planning.createPlan(T, { partnerId: aina.id, contractId: contract.id, periodMonth: '2019-01-01', createdBy: null }), (e) => e.code === 'NOT_TPM');
  await assert.rejects(reports.insertReport(T, { partnerId: aina.id, contractId: contract.id, periodMonth: '2019-01-01', kind: 'technique', createdBy: null }), (e) => e.code === 'NOT_TPM');
  await assert.rejects(reports.generateMonthlyStubs(T, { partnerId: aina.id, contractId: contract.id, createdBy: null }), (e) => e.code === 'NOT_TPM');
  // La base refuse aussi (même écrite à la main) : déclencheur trg_tpm_document_partner (migration 089).
  await q('BEGIN');
  try {
    await assert.rejects(q(`INSERT INTO tpm_collection_plans (tenant_id, partner_id, contract_id, period_month, status) VALUES ($1, $2, $3, '2019-01-01', 'brouillon')`,
      [T, aina.id, contract.id]), (e) => e.code === '23514');
  } finally { await q('ROLLBACK'); }
  await q('BEGIN');
  try {
    await assert.rejects(q(`INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, status) VALUES ($1, $2, $3, '2019-01-01', 'technique', 'attendu')`,
      [T, aina.id, contract.id]), (e) => e.code === '23514');
  } finally { await q('ROLLBACK'); }
});

test('formulaires plan / facture : contrat sans TPM rattaché → aucun TPM proposé, jamais son titulaire non TPM (D1)', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  // Le contrat de MIARO (partenaire de mise en œuvre) est suivi par YPA ; YPA désactivé, il n'a plus
  // de TPM rattaché : l'ancienne règle (estampille) proposait alors MIARO lui-même.
  const [c] = await q(`SELECT c.id, to_char(c.date_debut, 'YYYY-MM') AS m FROM contracts c JOIN partners p ON p.id = c.partner_id
                        WHERE c.tenant_id = $1 AND p.name = 'MIARO' AND c.status = 'actif' LIMIT 1`, [T]);
  const [ypa] = await q("SELECT id FROM partners WHERE tenant_id = $1 AND name = 'YPA'", [T]);
  const service = require('../src/modules/tpm/tpmAttribution.service');
  const before = await service.providers(T, { period: { from: c.m, to: c.m } });
  assert.deepEqual(before.contractTpms[c.id].map((p) => p.id), [ypa.id], 'YPA, TPM rattaché');
  await q('UPDATE partners SET active = false WHERE tenant_id = $1 AND id = $2', [T, ypa.id]);
  try {
    const after = await service.providers(T, { period: { from: c.m, to: c.m } });
    assert.deepEqual(after.contractTpms[c.id], [], 'aucun TPM : suivi interne, jamais MIARO');
  } finally {
    await q('UPDATE partners SET active = true WHERE tenant_id = $1 AND id = $2', [T, ypa.id]);
  }
});

test('partenaire qui perd le rôle de TPM (type changé, fiche désactivée) : ses visites prévues « visite » reviennent à leur zone, journalisées ; réalisées, passées et facturées jamais', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: admin }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const types = Object.fromEntries((await q("SELECT code, id FROM partner_types WHERE tenant_id = $1 AND code IN ('tpm', 'prestataire')", [T])).map((r) => [r.code, r.id]));
  const [site] = await q('SELECT id FROM sites WHERE tenant_id = $1 ORDER BY id LIMIT 1', [T]);
  const [contract] = await q("SELECT id FROM contracts WHERE tenant_id = $1 AND status = 'actif' ORDER BY id LIMIT 1", [T]);
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const { addMonths } = require('../src/modules/common/period');
  const { ROLE_LOST_REASON } = require('../src/modules/partners/partnerRole');
  const attributionService = require('../src/modules/tpm/tpmAttribution.service');
  const m0 = currentMonth(); const prev = addMonths(m0, -1); const next = addMonths(m0, 1);
  const made = { partners: [], visits: [], reports: [] };
  const visit = async (partner, label, month, status = 'planifie') => {
    const [v] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_reason)
      VALUES ($1, $2, $3::date, $4, $5, 'visite', $6, 'Choix de visite — test xb #21') RETURNING id`, [T, site.id, `${month}-01`, `Test xb #21 ${label}`, status, partner]);
    made.visits.push(v.id);
    return v.id;
  };
  const stateOf = async (id) => (await q('SELECT provider_source AS src, provider_id AS p, provider_reason AS reason FROM site_visits WHERE id = $1', [id]))[0];
  try {
    const scenario = async (label, change) => {
      const [X] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id, name', [T, types.tpm, `Test xb #21 — ${label}`]);
      made.partners.push(X.id);
      const back = await visit(X.id, `${label} prévue`, m0);
      const kept = [await visit(X.id, `${label} réalisée`, m0, 'realise'), await visit(X.id, `${label} passée`, prev), await visit(X.id, `${label} facturée`, next)];
      const [r] = await q(`INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, status, reported_amount, created_by,
                                                     submitted_by, submitted_at, edited_by, edited_at)
        VALUES ($1, $2, $3, $4::date, 'financier', 'soumis', 0, $5, $5, now(), $5, now()) RETURNING id`, [T, X.id, contract.id, `${next}-01`, admin]);
      made.reports.push(r.id);
      await change(X);
      const b = await stateOf(back);
      assert.equal(b.src, 'zone', `${label} : la visite prévue suit sa zone`);
      assert.notEqual(b.p, X.id, `${label} : plus ce partenaire`);
      assert.equal(b.reason, null);
      for (const id of kept) assert.deepEqual(await stateOf(id), { src: 'visite', p: X.id, reason: 'Choix de visite — test xb #21' }, `${label} : réalisée, passée ou facturée inchangée`);
      const log = await q(`SELECT scope, action, reason, changed_by AS "by", visits_updated AS n, visit_id AS v, old_provider_id AS old
                             FROM tpm_attribution_log WHERE tenant_id = $1 AND batch_id IN
                               (SELECT batch_id FROM tpm_attribution_log WHERE tenant_id = $1 AND visit_id = $2) ORDER BY scope`, [T, back]);
      assert.deepEqual(log.map((l) => [l.scope, l.action]), [['lot', 'visite_zone'], ['visite', 'visite_zone']], `${label} : un lot et une ligne`);
      assert.equal(log[0].reason, ROLE_LOST_REASON, 'un code stable, jamais une phrase figée');
      const listed = await attributionService.listLog(T, { visitId: back });
      assert.deepEqual(listed.items.map((l) => [l.reasonKey, l.reason]), [['partner_not_tpm', null]], `${label} : l'écran traduit la raison du système`);
      assert.equal(log[0].by, admin, `${label} : l'auteur du changement`);
      assert.equal(log[0].n, 1);
      assert.deepEqual([log[1].v, log[1].old], [back, X.id]);
    };
    const settings = require('../src/modules/settings/settings.repository');
    const partnersRepo = require('../src/modules/partners/partners.repository');
    await scenario('type', (X) => settings.updatePartner(T, X.id, { name: X.name, partnerTypeId: types.prestataire, active: true }, { actorId: admin }));
    await scenario('désactivé', (X) => partnersRepo.updatePartner(T, X.id, { active: false }, { actorId: admin }));
  } finally {
    await q('DELETE FROM tpm_attribution_log WHERE tenant_id = $1 AND (visit_id = ANY($2::uuid[]) OR reason = $3)', [T, made.visits, ROLE_LOST_REASON]);
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.visits]);
    await q('DELETE FROM tpm_reports WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.reports]);
    await q('DELETE FROM partners WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.partners]);
  }
});

test('changement de rôle pendant la suppression d\'une de ses visites « visite » : la visite supprimée est sautée, les autres rendues à leur zone — jamais 500 (point C)', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: admin }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const [tpm] = await q("SELECT id FROM partner_types WHERE tenant_id = $1 AND code = 'tpm'", [T]);
  const [site] = await q('SELECT id FROM sites WHERE tenant_id = $1 ORDER BY id LIMIT 1', [T]);
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const { addMonths } = require('../src/modules/common/period');
  const partnersRepo = require('../src/modules/partners/partners.repository');
  const { Client } = require('pg');
  const month = addMonths(currentMonth(), 2); // aucune facture ce mois-là : les visites sont ré-estampillables
  const made = { partner: null, visits: [] };
  const other = new Client({ connectionString: SU_URL }); // l'écrivain qui supprime une visite en même temps
  await other.connect();
  try {
    const [X] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, tpm.id, 'Test xb C — TPM']);
    made.partner = X.id;
    for (const i of [1, 2, 3]) {
      const [v] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_reason)
        VALUES ($1, $2, $3::date, $4, 'planifie', 'visite', $5, 'Choix de visite — test xb C') RETURNING id`, [T, site.id, `${month}-01`, `Test xb C ${i}`, X.id]);
      made.visits.push(v.id);
    }
    const ids = [...made.visits].sort();
    // L'autre transaction supprime une des visites et la tient ; le changement de rôle l'attend, puis la saute.
    await other.query('BEGIN');
    await other.query('DELETE FROM site_visits WHERE id = $1', [ids[1]]);
    const pending = partnersRepo.updatePartner(T, X.id, { active: false }, { actorId: admin }).then(() => ({ ok: true }), (err) => ({ err }));
    let waited = false;
    for (let k = 0; k < 200 && !waited; k += 1) {
      const rows = await q(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
                              AND query LIKE '%FOR UPDATE%' AND query LIKE '%site_visits%'`);
      waited = rows.length > 0;
      if (!waited) await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(waited, 'le changement de rôle attend la visite tenue par l\'autre écrivain');
    await other.query('COMMIT');
    const res = await pending;
    assert.ok(res.ok, `aucune erreur (jamais 500) : ${res.err && `${res.err.statusCode || res.err.code} ${res.err.message}`}`);
    const after = await q('SELECT id, provider_source AS src FROM site_visits WHERE id = ANY($1::uuid[]) ORDER BY id', [ids]);
    assert.deepEqual(after.map((r) => [r.id, r.src]), [[ids[0], 'zone'], [ids[2], 'zone']], 'la supprimée a disparu, les deux autres suivent leur zone');
    const [{ active }] = await q('SELECT active FROM partners WHERE id = $1', [X.id]);
    assert.equal(active, false, 'la fiche est bien désactivée');
  } finally {
    await other.query('ROLLBACK').catch(() => {});
    await other.end();
    await q('DELETE FROM tpm_attribution_log WHERE tenant_id = $1 AND (visit_id = ANY($2::uuid[]) OR batch_id IN (SELECT batch_id FROM tpm_attribution_log WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])))', [T, made.visits]);
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.visits]);
    if (made.partner) await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, made.partner]);
  }
});

test('liste des partenaires : « Contrats actifs » et zones = contrats qui couvrent le mois (règle des dates), jamais un contrat échu encore « actif »', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: admin }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const [type] = await q("SELECT id FROM partner_types WHERE tenant_id = $1 AND code = 'prestataire'", [T]);
  const areas = await q('SELECT id, path FROM admin_areas WHERE tenant_id = $1 AND depth = 2 ORDER BY id LIMIT 2', [T]);
  const [{ m }] = await q("SELECT to_char(current_date, 'YYYY-MM') AS m");
  const { contractCoversMonth } = require('../src/modules/tpm/activeProvider');
  const service = require('../src/modules/partners/partners.service');
  const made = { contracts: [] };
  try {
    const [P] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id, name', [T, type.id, 'Test xb #12 — titulaire']);
    made.partner = P.id;
    // Échu le mois dernier mais encore « actif », puis un contrat qui couvre le mois ; une zone chacun.
    for (const [label, start, end, area] of [['ECHU', "date_trunc('month', current_date) - interval '13 months'", "date_trunc('month', current_date) - interval '1 day'", areas[0]],
      ['COURANT', "date_trunc('month', current_date)", "date_trunc('month', current_date) + interval '6 months'", areas[1]]]) {
      const [C] = await q(`INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
        VALUES ($1, $2, $3, $4, (${start})::date, (${end})::date, 'actif', $5) RETURNING id`, [T, `TEST-XB12-${label}`, P.id, P.name, admin]);
      made.contracts.push(C.id);
      await q('INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order) VALUES ($1, $2, $3, $4, 2, 0)', [C.id, T, area.id, area.path]);
    }
    const rows = await service.providers(T);
    const row = rows.find((r) => r.id === P.id);
    assert.deepEqual(row.heldContracts.map((c) => c.numero), ['TEST-XB12-COURANT'], 'seul le contrat qui couvre le mois');
    assert.equal(row.zonesActive, 1, 'seule sa zone');
    // Partout dans la liste : un contrat « actif » (tenu ou suivi) couvre le mois, selon la règle commune.
    const ids = [...new Set(rows.flatMap((r) => [...r.heldContracts, ...r.monitoredContracts].map((c) => c.id)))];
    const dates = await q(`SELECT id, status, date_debut::text AS "dateDebut", date_fin::text AS "dateFin", termination_date::text AS "terminationDate"
                             FROM contracts WHERE id = ANY($1::uuid[])`, [ids]);
    for (const c of dates) assert.ok(contractCoversMonth(c, m), `contrat ${c.id} listé sans couvrir ${m}`);
  } finally {
    await q('DELETE FROM contracts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.contracts]);
    if (made.partner) await q('DELETE FROM partners WHERE tenant_id = $1 AND id = $2', [T, made.partner]);
  }
});

test('fiche 360° d\'un titulaire : les visites suivies en interne de ses zones sont comptées à part (contrat sans TPM, puis TPM indisponible)', { skip: SKIP }, async () => {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: admin }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const types = Object.fromEntries((await q("SELECT code, id FROM partner_types WHERE tenant_id = $1 AND code IN ('tpm', 'prestataire')", [T])).map((r) => [r.code, r.id]));
  // Le mois de la fiche : le jour LOCAL de l'application (common/localDay), comme les tests voisins — jamais
  // la date UTC de la base, qui garde un mois de retard de 21 h à minuit UTC le dernier jour du mois.
  const m = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Indian/Antananarivo' }).format(new Date()).slice(0, 7);
  // Un district SANS AUCUNE visite ce mois-ci : les chiffres de la fiche ne comptent alors que les visites du
  // test, quel que soit l'ordre des identifiants tirés au hasard par le seed (seed.js a une visite interne
  // réalisée à Tsihombe ce mois-ci : vérification croisée, point L).
  const sites = await q(`SELECT id, zone_district_id AS d FROM sites x WHERE tenant_id = $1 AND zone_district_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM site_visits v JOIN sites s2 ON s2.tenant_id = v.tenant_id AND s2.id = v.site_id
                       WHERE v.tenant_id = $1 AND s2.zone_district_id = x.zone_district_id AND v.period_month = $2::date)
    ORDER BY id LIMIT 400`, [T, `${m}-01`]);
  const cells = await q('SELECT c_site_id AS s, c_area_id AS a, c_state AS st FROM mems_tpm_cells($1, $2::uuid[], $3::date[])',
    [T, sites.map((x) => x.id), sites.map(() => `${m}-01`)]);
  const site = sites.find((x) => cells.some((c) => c.s === x.id && c.st === 'sans_contrat' && c.a === x.d));
  assert.ok(site, 'un site d\'un district sans contrat de suivi');
  const [area] = await q('SELECT path FROM admin_areas WHERE id = $1', [site.d]);
  const { withTenantTransaction } = require('../src/config/db');
  const { restampVisitsTx } = require('../src/modules/tpm/tpmAttribution.repository');
  const service = require('../src/modules/partners/partners.service');
  const restamp = () => withTenantTransaction(T, (c) => restampVisitsTx(c, T, { fromMonth: m }));
  const made = { partners: [] };
  try {
    const [H] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id, name', [T, types.prestataire, 'Test xb #8 — titulaire']);
    const [X] = await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id, name', [T, types.tpm, 'Test xb #8 — TPM']);
    made.partners.push(H.id, X.id);
    const [K] = await q(`INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
       VALUES ($1, 'TEST-XB8', $2, $3, $4::date, ($4::date + interval '3 month')::date, 'actif', $5) RETURNING id`, [T, H.id, H.name, `${m}-01`, admin]);
    made.contract = K.id;
    await q(`INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
             VALUES ($1, $2, 'IV.suivi', 'Test xb #8', 1, 1000, '{}'::jsonb, 0)`, [K.id, T]);
    await q('INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order) VALUES ($1, $2, $3, $4, 2, 0)', [K.id, T, site.d, area.path]);
    for (const [i, status] of [[1, 'planifie'], [2, 'planifie'], [3, 'realise']]) {
      await q("INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, $3::date, $4, $5)", [T, site.id, `${m}-01`, `Test xb #8 ${i}`, status]);
    }
    const visits = async () => (await service.sheet(T, H.id)).facts.visits;
    const followed = async () => service.followups(T, H.id, { from: m, to: m }, m);
    // 1. Contrat sans TPM : visites internes (sans_tpm), comptées à part — fiche, 12 mois et onglet Suivis.
    let v = await visits();
    assert.deepEqual([v.assigned, v.internal, v.internalRealised], [0, 3, 1], 'sans TPM : 3 en suivi interne, dont 1 réalisée');
    assert.deepEqual(v.internalReasons, { sans_tpm: 3 }, 'raison : contrat sans TPM');
    assert.deepEqual([v.realised12, v.internalRealised12, v.sitesFollowed], [1, 1, 1], '12 mois : la réalisée interne comptée, dont 1 en interne');
    let f = await followed();
    assert.deepEqual([f.visits, f.internal], [[], [{ month: m, planned: 2, realised: 1, sites: 1 }]], 'onglet Suivis : la série interne à part');
    // 2. Un TPM rattaché (facture) : visites du TPM, sur le contrat — affectées, plus internes.
    const [r] = await q(`INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, status, reported_amount, created_by)
       VALUES ($1, $2, $3, $4::date, 'financier', 'attendu', 0, $5) RETURNING id`, [T, X.id, K.id, `${m}-01`, admin]);
    made.report = r.id;
    await restamp();
    v = await visits();
    // La réalisée garde son estampille (interne, sans TPM) : elle reste comptée en interne (point A).
    assert.deepEqual([v.assigned, v.internal, v.internalRealised], [2, 1, 1], 'TPM rattaché : prévues affectées, la réalisée reste interne');
    assert.deepEqual(v.internalReasons, { sans_tpm: 1 }, 'raison figée de la réalisée');
    f = await followed();
    assert.deepEqual(f.internal, [{ month: m, planned: 0, realised: 1, sites: 1 }], 'onglet Suivis : la réalisée interne reste');
    // 3. Ce TPM déclaré indisponible ce mois : ses zones repassent en interne.
    await q("INSERT INTO tpm_unavailability (tenant_id, provider_id, period_month, reason, batch_id) VALUES ($1, $2, $3::date, 'Indisponible — test xb #8', gen_random_uuid())", [T, X.id, `${m}-01`]);
    await restamp();
    v = await visits();
    assert.deepEqual([v.assigned, v.internal, v.internalRealised], [0, 3, 1], 'TPM indisponible : les zones repassent en interne, comptées à part');
    assert.deepEqual(v.internalReasons, { indisponible: 2, sans_tpm: 1 }, 'raisons : TPM indisponible (prévues), contrat sans TPM (réalisée)');
  } finally {
    await q("DELETE FROM site_visits WHERE tenant_id = $1 AND activity LIKE 'Test xb #8 %'", [T]);
    await q('DELETE FROM tpm_unavailability WHERE tenant_id = $1 AND provider_id = ANY($2::uuid[])', [T, made.partners]);
    if (made.report) await q('DELETE FROM tpm_reports WHERE id = $1', [made.report]);
    if (made.contract) await q('DELETE FROM contracts WHERE id = $1', [made.contract]);
    await q('DELETE FROM partners WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, made.partners]);
  }
});
