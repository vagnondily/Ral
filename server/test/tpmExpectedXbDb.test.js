/**
 * Relecture croisée (lot 8 × retour 114 × plan auto) — rapports attendus EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables les tests sont ignorés. Tout ce qu'un test écrit est supprimé à la fin.
 */
const SU_URL = process.env.MEMS_TEST_DATABASE_URL;
const APP_URL = process.env.MEMS_TEST_APP_DATABASE_URL;
const dbName = (u) => { try { return decodeURIComponent(new URL(u).pathname.slice(1)); } catch { return ''; } };
const enabled = Boolean(SU_URL && APP_URL && /test/i.test(dbName(SU_URL)) && dbName(SU_URL) === dbName(APP_URL));
if (enabled) process.env.APP_DATABASE_URL = APP_URL;
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
const tenant = async () => (await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1'))[0].id;

test('suivi interne (points 6, 18, 23) : l équipe d un site est son bureau RACINE, comme le plan automatique', { skip: SKIP }, async () => {
  const T = await tenant();
  const reports = require('../src/modules/tpm/reports.repository');
  const { rootOfficeOf } = require('../src/modules/common/officeScope');
  // Antenne de 3ᵉ niveau (antenne › antenne › bureau) et un de ses sites.
  const [chain] = await q(`SELECT o3.id AS o3, o2.name AS n2, o1.name AS n1, s.id AS site
                             FROM field_offices o3 JOIN field_offices o2 ON o2.id = o3.parent_id JOIN field_offices o1 ON o1.id = o2.parent_id
                             JOIN sites s ON s.tenant_id = o3.tenant_id AND s.field_office_id = o3.id
                            WHERE o3.tenant_id = $1 AND NOT o1.national ORDER BY o3.name, s.id LIMIT 1`, [T]);
  assert.ok(chain, 'un bureau à trois niveaux (npm run seed:test)');
  const offices = await q('SELECT id, parent_id AS "parentId", name, national FROM field_offices WHERE tenant_id = $1', [T]);
  assert.equal(rootOfficeOf(offices, chain.o3).name, chain.n1);
  // Une visite prévue d'un mois sans aucun contrat : suivi interne.
  const M = '2031-01';
  const [{ id: V }] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source)
                                VALUES ($1, $2, $3, 'Test point 6', 'planifie', 'zone') RETURNING id`, [T, chain.site, `${M}-01`]);
  try {
    const [v] = await q('SELECT monitored_by AS by FROM site_visits WHERE id = $1', [V]);
    assert.equal(v.by, 'interne');
    const own = (await reports.expectedReports(T, { period: { from: M, to: M }, today: '2026-10' })).rows.find((r) => r.unit.kind === 'interne');
    assert.ok(own, 'rapport interne attendu');
    assert.deepEqual(own.unit.offices, [chain.n1], `équipe : le bureau racine (${chain.n1}), jamais l'antenne intermédiaire (${chain.n2})`);
  } finally {
    await q('DELETE FROM site_visits WHERE id = $1', [V]);
  }
});

test('fiche 360° (point 14) : mois courant LOCAL de l application, jamais la date UTC de la session', { skip: SKIP }, (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-31T22:30:00Z') }); // 1 h 30 le 1ᵉʳ novembre à Antananarivo
  return (async () => {
    const T = await tenant();
    const partners = require('../src/modules/partners/partners.repository');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const [p] = await q("SELECT p.id FROM partners p JOIN partner_types t ON t.id = p.partner_type_id WHERE p.tenant_id = $1 AND t.code = 'tpm' ORDER BY p.name LIMIT 1", [T]);
    const raw = await partners.sheet(T, p.id);
    assert.equal(currentMonth(), '2026-11');
    assert.deepEqual([raw.counts.month, raw.counts.today], ['2026-11', '2026-11-01'], 'même mois que les rapports attendus et les alertes');
  })();
});

test('gabarit en retard (points 15 et 4) : même verdict dans la liste, l onglet et les compteurs de la fiche 360°, la carte', { skip: SKIP }, async () => {
  const T = await tenant();
  const reports = require('../src/modules/tpm/reports.repository');
  const partners = require('../src/modules/partners/partners.repository');
  const partnersService = require('../src/modules/partners/partners.service');
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const { addMonths } = require('../src/modules/common/period');
  const M = currentMonth(); const Mp = addMonths(M, -3); // échéance Mp + 1 : dépassée
  // Un site suivi par un TPM de contrat en Mp, sans document de ce TPM sur ce contrat ce mois-là.
  const sites = await q('SELECT id FROM sites WHERE tenant_id = $1 AND zone_district_id IS NOT NULL ORDER BY id LIMIT 600', [T]);
  const cells = await q(`SELECT c_site_id AS s, c_provider_id AS p, c_contract_id AS k FROM mems_tpm_cells($1, $2::uuid[], $3::date[])
                          WHERE c_state = 'contrat'`, [T, sites.map((x) => x.id), sites.map(() => `${Mp}-01`)]);
  let pick = null;
  for (const c of cells) {
    const [{ n }] = await q('SELECT count(*)::int AS n FROM tpm_reports WHERE tenant_id = $1 AND partner_id = $2 AND contract_id = $3 AND period_month = $4', [T, c.p, c.k, `${Mp}-01`]);
    if (n === 0) { pick = c; break; }
  }
  assert.ok(pick, 'un TPM de contrat sans document ce mois-là');
  const Y = pick.p; const K = pick.k;
  await q('BEGIN');
  await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
  const [{ id: V }] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_zone_state, contract_id)
                                VALUES ($1, $2, $3, 'Test point 15', 'realise', 'zone', $4, 'contrat', $5) RETURNING id`, [T, pick.s, `${Mp}-01`, Y, K]);
  await q('COMMIT');
  const [{ id: R }] = await q(`INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, reported_amount, status, created_by)
                                SELECT $1, $2, $3, $4, 'financier', 0, 'attendu', u.id FROM users u WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1 RETURNING id`,
  [T, Y, K, `${Mp}-01`]);
  try {
    // Carte « Rapports attendus » : en retard.
    const card = (await reports.expectedReports(T, { period: { from: Mp, to: Mp }, today: M })).rows
      .find((r) => r.unit.providerId === Y && r.contract && r.contract.id === K);
    assert.deepEqual([card.status, card.reason], ['en_retard', 'echeance_depassee']);
    // Liste des rapports et onglet de la fiche : le gabarit est « en retard » (late), jamais « attendu ».
    const listed = (await reports.listReports(T, { period: { from: Mp, to: Mp }, partnerId: Y, contractId: K })).find((r) => r.id === R);
    assert.deepEqual([listed.status, listed.autoNotApplicable, listed.late], ['attendu', false, true]);
    const tab = (await partners.reportsOf(T, Y)).find((r) => r.id === R);
    assert.deepEqual([tab.autoNotApplicable, tab.late], [false, true]);
    // Compteurs de la fiche 360° : factures attendues / en retard = rapports attendus de ce TPM sur 12 mois.
    const sheet = await partnersService.sheet(T, Y);
    const exp = (await reports.expectedReports(T, { period: { from: addMonths(M, -11), to: M }, today: M })).rows
      .filter((r) => r.unit.kind === 'tpm' && r.unit.providerId === Y);
    const count = (st) => exp.filter((r) => r.status === st).length;
    const f = sheet.facts.reports.financier;
    assert.deepEqual([f.attendu || 0, f.en_retard || 0], [count('attendu'), count('en_retard')], 'même source que la carte');
    assert.ok((f.en_retard || 0) >= 1);
    assert.equal(sheet.facts.reports.late, count('en_retard'));
  } finally {
    await q('DELETE FROM tpm_reports WHERE id = $1', [R]);
    await q('DELETE FROM site_visits WHERE id = $1', [V]);
  }
});

test('D-b (point 21) : TPM inactif encore attendu et facturable pour les mois passés ; devenu non-TPM : « non applicable », sans alerte', { skip: SKIP }, async () => {
  const T = await tenant();
  const reports = require('../src/modules/tpm/reports.repository');
  const planning = require('../src/modules/tpm/planning.repository');
  const { lateReportAlerts } = require('../src/modules/dashboards/alertsMath');
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const { addMonths } = require('../src/modules/common/period');
  const M = currentMonth(); const Mp = addMonths(M, -3);
  const [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY email LIMIT 1", [T]);
  const types = Object.fromEntries((await q('SELECT code, id FROM partner_types WHERE tenant_id = $1', [T])).map((r) => [r.code, r.id]));
  const [{ id: Z }] = await q("INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, 'Test XB D-b TPM') RETURNING id", [T, types.tpm]);
  // Contrat de test sans zone ni ligne de suivi : le lien n'estampille rien ailleurs.
  const [{ id: K }] = await q(`INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
                                VALUES ($1, 'TEST-XB-21', $2, 'Test XB D-b TPM', $3, $4, 'actif', $5) RETURNING id`, [T, Z, `${Mp}-01`, `${M}-28`, U]);
  const [site] = await q('SELECT id FROM sites WHERE tenant_id = $1 ORDER BY id LIMIT 1', [T]);
  await q('BEGIN');
  await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
  const [{ id: V }] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_zone_state, contract_id)
                                VALUES ($1, $2, $3, 'Test point 21', 'realise', 'zone', $4, 'contrat', $5) RETURNING id`, [T, site.id, `${Mp}-01`, Z, K]);
  await q('COMMIT');
  const rowOf = async () => (await reports.expectedReports(T, { period: { from: Mp, to: Mp }, today: M })).rows.find((r) => r.unit.providerId === Z);
  try {
    assert.equal((await rowOf()).status, 'en_retard');
    // Fiche désactivée (contrat fini) : encore attendu pour le mois servi, et il peut le facturer.
    await q('UPDATE partners SET active = false WHERE id = $1', [Z]);
    assert.equal((await rowOf()).status, 'en_retard', 'TPM inactif : encore attendu');
    const F = await reports.insertReport(T, { partnerId: Z, contractId: K, periodMonth: `${Mp}-01`, kind: 'financier', reportedAmount: 10, createdBy: U });
    assert.equal((await rowOf()).status, 'soumis', 'facture d un mois servi acceptée (type seul exigé)');
    assert.equal(await reports.deleteReport(T, F, { actorId: U, isAdmin: true }), 'ok');
    await assert.rejects(reports.insertReport(T, { partnerId: Z, contractId: K, periodMonth: `${M}-01`, kind: 'financier', reportedAmount: 10, createdBy: U }),
      (e) => e.code === 'NOT_TPM', 'mois courant : TPM actif exigé');
    await assert.rejects(planning.createPlan(T, { partnerId: Z, contractId: K, periodMonth: `${Mp}-01`, title: 'Test XB', items: [], createdBy: U }),
      (e) => e.code === 'NOT_TPM', 'plan : TPM actif exigé');
    // Devenu partenaire de mise en œuvre : plus de facture attendue, aucune alerte.
    await q('UPDATE partners SET partner_type_id = $2, active = true WHERE id = $1', [Z, types.prestataire]);
    const row = await rowOf();
    assert.deepEqual([row.status, row.reason, row.auto], ['non_applicable', 'partner_not_tpm', true]);
    const late = lateReportAlerts(await reports.expectedReports(T, { period: { from: Mp, to: Mp }, today: M }));
    assert.ok(!late.some((a) => a.params.provider === 'Test XB D-b TPM'), 'aucune alerte « Rapport en retard »');
  } finally {
    await q('DELETE FROM site_visits WHERE id = $1', [V]);
    await q('DELETE FROM tpm_reports WHERE contract_id = $1', [K]);
    await q('DELETE FROM contracts WHERE id = $1', [K]);
    await q('DELETE FROM partners WHERE id = $1', [Z]).catch(() => {});
  }
});
