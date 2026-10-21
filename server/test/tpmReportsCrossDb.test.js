/**
 * Relecture des corrections croisées (points 1, 2, 3, 5 et 6) — rapports d'un TPM EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables les tests sont ignorés. Tout ce qu'un test écrit est supprimé à la fin.
 *
 * Contrat de test K (titulaire H, partenaire de mise en œuvre) suivi par le TPM Z : une visite réalisée en
 * M−3, un gabarit « attendu » pluri-mensuel M−3 → M−1.
 *  - point 5 : le gabarit est « en retard » partout (carte, liste, onglet, fiche 360°) — son PREMIER mois a
 *    une visite et son échéance est passée, même si celle de son dernier mois ne l'est pas ;
 *  - point 1 : la fiche du TITULAIRE H compte la facture en retard de son TPM (avant : 0) ;
 *  - point 2 : Z retypé en partenaire de mise en œuvre — « non applicable » partout, raison dite ;
 *  - points 3 et 6 : Z inactif — proposé pour une facture de mois passés (contexte des rapports) ; un
 *    gabarit du mois courant ne se soumet pas, une facture rejetée ne se prolonge pas jusqu'au mois courant ;
 *    une facture de mois passés se soumet.
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

test('rapports d un TPM : liste, onglet, fiche 360° (TPM et titulaire) et carte disent la même chose ; garde « TPM actif » des factures reprises',
  { skip: SKIP, timeout: 120000 }, async () => {
    require('../src/jobs/outbox').nudgeOutbox = async () => {}; // aucun Redis pendant le test
    const reports = require('../src/modules/tpm/reports.repository');
    const partnersRepo = require('../src/modules/partners/partners.repository');
    const partnersService = require('../src/modules/partners/partners.service');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const { addMonths } = require('../src/modules/common/period');
    const M = currentMonth(); const M3 = addMonths(M, -3); const M1 = addMonths(M, -1);
    const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
    const users = await q('SELECT id FROM users WHERE tenant_id = $1 ORDER BY email LIMIT 2', [T]);
    assert.equal(users.length, 2, 'deux utilisateurs (séparation des tâches)');
    const [U, V2] = users.map((u) => u.id);
    const types = Object.fromEntries((await q('SELECT code, id FROM partner_types WHERE tenant_id = $1', [T])).map((r) => [r.code, r.id]));
    const made = { partners: [], contract: null, visit: null };
    try {
      const mk = async (name, type) => (await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, types[type], name]))[0].id;
      const H = await mk('Test PP titulaire', 'prestataire');
      const Z = await mk('Test PP TPM', 'tpm');
      made.partners = [H, Z];
      // Contrat de test sans zone ni ligne de suivi : le lien n'estampille rien ailleurs.
      const [{ id: K }] = await q(`INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
                                    VALUES ($1, 'TEST-PP-0001', $2, 'Test PP titulaire', $3, $4, 'actif', $5) RETURNING id`,
      [T, H, `${addMonths(M, -6)}-01`, `${addMonths(M, 2)}-28`, U]);
      made.contract = K;
      const [site] = await q('SELECT id FROM sites WHERE tenant_id = $1 ORDER BY id LIMIT 1', [T]);
      await q('BEGIN');
      await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
      [{ id: made.visit }] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_zone_state, contract_id)
                                       VALUES ($1, $2, $3, 'Test PP', 'realise', 'zone', $4, 'contrat', $5) RETURNING id`, [T, site.id, `${M3}-01`, Z, K]);
      await q('COMMIT');
      // Gabarit pluri-mensuel M−3 → M−1 (enregistré sans être soumis, comme « Fin de période » + « Enregistrer »).
      const [{ id: R }] = await q(`INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, period_end, kind, reported_amount, status, created_by)
                                    VALUES ($1, $2, $3, $4, $5, 'financier', 0, 'attendu', $6) RETURNING id`, [T, Z, K, `${M3}-01`, `${M1}-01`, U]);

      const card = async () => (await reports.expectedReports(T, { period: { from: M3, to: M1 }, today: M })).rows.filter((r) => r.unit.providerId === Z);
      const listed = async () => (await reports.listReports(T, { period: { from: M3, to: M3 }, partnerId: Z, contractId: K })).find((r) => r.id === R);
      const tab = async (id) => (await partnersRepo.reportsOf(T, id)).find((r) => r.id === R);
      const sheetOf = async (id) => (await partnersService.sheet(T, id)).facts.reports;

      // Point 5 : la carte dit M−3 « en retard » ; la liste, l'onglet et la fiche aussi (jamais « Attendu »).
      const rows = await card();
      assert.deepEqual(rows.find((r) => r.month === M3).status, 'en_retard');
      // Point K : la case « Factures du mois » porte les drapeaux du document (ceux de la liste), jamais le seul statut brut.
      const doc = rows.find((r) => r.month === M3).reports.find((x) => x.id === R);
      assert.deepEqual([doc.status, doc.late, doc.autoNotApplicable, doc.partnerNotTpm], ['attendu', true, false, false]);
      assert.deepEqual(rows.filter((r) => r.month !== M3).map((r) => r.status), ['non_applicable', 'non_applicable'], 'mois sans visite');
      let l = await listed();
      assert.deepEqual([l.status, l.autoNotApplicable, l.partnerNotTpm, l.late], ['attendu', false, false, true], 'liste : en retard');
      for (const id of [Z, H]) {
        const tr = await tab(id);
        assert.deepEqual([tr.autoNotApplicable, tr.late], [false, true], `onglet Rapports (${id === Z ? 'TPM' : 'titulaire'}) : en retard`);
      }
      // Point 1 : la fiche du TPM ET celle du titulaire comptent la facture en retard (la carte).
      for (const id of [Z, H]) {
        const s = await sheetOf(id);
        assert.deepEqual([s.financier.en_retard || 0, s.financier.attendu || 0, s.late], [1, 0, 1], `fiche 360° (${id === Z ? 'TPM' : 'titulaire'})`);
      }

      // Point 2 : Z retypé en partenaire de mise en œuvre — « non applicable » d'office partout, raison dite.
      await q('UPDATE partners SET partner_type_id = $2 WHERE id = $1', [Z, types.prestataire]);
      assert.deepEqual((await card()).map((r) => [r.status, r.reason]), [['non_applicable', 'partner_not_tpm'], ['non_applicable', 'partner_not_tpm'], ['non_applicable', 'partner_not_tpm']]);
      const docNa = (await card())[0].reports.find((x) => x.id === R);
      assert.deepEqual([docNa.late, docNa.autoNotApplicable, docNa.partnerNotTpm], [false, true, true], 'case « Factures du mois » : non applicable d office');
      l = await listed();
      assert.deepEqual([l.autoNotApplicable, l.partnerNotTpm, l.late], [true, true, false], 'liste : non applicable d office (n est plus un TPM)');
      for (const id of [Z, H]) {
        const tr = await tab(id);
        assert.deepEqual([tr.autoNotApplicable, tr.partnerNotTpm, tr.late], [true, true, false], 'onglet : idem');
        const s = await sheetOf(id);
        assert.deepEqual([s.financier.non_applicable || 0, s.financier.en_retard || 0, s.financier.attendu || 0, s.late], [1, 0, 0, 0], 'fiche : dans « non applicable »');
      }
      await q('UPDATE partners SET partner_type_id = $2 WHERE id = $1', [Z, types.tpm]);

      // Points 3 et 6 : Z inactif.
      await q('UPDATE partners SET active = false WHERE id = $1', [Z]);
      const ctx = await reports.reportContext(T);
      assert.ok(!ctx.partners.some((p) => p.id === Z), 'TPM actifs seulement dans `partners`');
      assert.deepEqual(ctx.inactiveTpms.find((p) => p.id === Z), { id: Z, name: 'Test PP TPM', active: false }, 'proposé pour une facture de mois passés');
      assert.equal(ctx.today, M);
      // Gabarit du mois courant, rempli (montant) : ne se soumet pas.
      const [{ id: S }] = await q(`INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, reported_amount, status, created_by)
                                    VALUES ($1, $2, $3, $4, 'financier', 10, 'attendu', $5) RETURNING id`, [T, Z, K, `${M}-01`, U]);
      await assert.rejects(reports.submitReport(T, S, U), (e) => e.code === 'NOT_TPM', 'mois courant : TPM actif exigé');
      assert.equal((await q('SELECT status FROM tpm_reports WHERE id = $1', [S]))[0].status, 'attendu');
      // Facture rejetée d'un mois passé : prolongée jusqu'au mois courant → refusée, rien d'écrit ; resoumise telle quelle → acceptée.
      const [{ id: F }] = await q(`INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, reported_amount, status,
                                                            created_by, submitted_by, submitted_at, edited_by, edited_at, decided_by, decided_at)
                                    VALUES ($1, $2, $3, $4, 'financier', 10, 'rejete', $5, $5, now(), $5, now(), $6, now()) RETURNING id`,
      [T, Z, K, `${addMonths(M, -5)}-01`, U, V2]);
      await assert.rejects(reports.replaceReportItems(T, F, [], { periodEnd: `${M}-01`, userId: U }), (e) => e.code === 'NOT_TPM');
      assert.equal((await q('SELECT period_end FROM tpm_reports WHERE id = $1', [F]))[0].period_end, null, 'période inchangée');
      assert.deepEqual(await reports.submitReport(T, F, U), { ok: true }, 'mois passé : un TPM inactif facture les mois qu il a servis (D-b)');
    } finally {
      if (made.contract) {
        await q('DELETE FROM tpm_reports WHERE contract_id = $1', [made.contract]);
        if (made.visit) await q('DELETE FROM site_visits WHERE id = $1', [made.visit]);
        await q('DELETE FROM contracts WHERE id = $1', [made.contract]);
      }
      if (made.partners.length) await q('DELETE FROM partners WHERE id = ANY ($1::uuid[])', [made.partners]).catch(() => {});
    }
  });
