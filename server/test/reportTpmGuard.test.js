/**
 * Relecture des corrections croisées, point 6 — la garde « TPM actif » de la création (décision D-b) vaut
 * aussi pour une facture REPRISE : un gabarit rempli puis soumis, une facture rejetée dont la période est
 * prolongée. SANS base : un faux client joue les tables et vérifie le SQL envoyé —
 *  - verrous dans l'ordre des écrivains du lien : contrat (FOR KEY SHARE) → verrou d'attribution → ligne du
 *    rapport (FOR UPDATE) → fiche du partenaire lue (jamais une ligne de partenaire avant le verrou) ;
 *  - TPM inactif : soumission et période prolongée refusées (NOT_TPM) dès qu'un mois touche le mois courant,
 *    rien n'est écrit ; facture de mois passés : acceptée ; période inchangée : aucune garde à la sauvegarde.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const { currentMonth } = require('../src/modules/tpm/rbmMath');

const T = '11111111-1111-1111-1111-111111111111';
const K = 'c0000000-0000-0000-0000-000000000001';
const P = 'b0000000-0000-0000-0000-000000000001';
const R = 'd0000000-0000-0000-0000-000000000001';
const U = 'e0000000-0000-0000-0000-000000000001';
const shift = (m, n) => { const [y, mm] = m.split('-').map(Number); const i = y * 12 + (mm - 1) + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const M = currentMonth();

let state;
const reset = (over = {}) => {
  state = { calls: [], partner: { active: false, code: 'tpm' }, report: { status: 'attendu', periodMonth: `${shift(M, -2)}-01`, periodEnd: null, ...over }, items: 2 };
};

db.withTenantTransaction = async (tenantId, fn) => {
  assert.equal(tenantId, T);
  return fn({
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: s, params });
      const r = state.report;
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(s)) return { rows: [] };
      if (/lock_timeout/.test(s)) return { rows: [{ prior: '0' }] };
      if (/^SELECT pg_advisory_xact_lock/.test(s)) return { rows: [] };
      assert.ok(/tenant_id = \$1/.test(s), `requête sans filtre de compte : ${s.slice(0, 100)}`);
      assert.equal(params[0], T);
      if (/^SELECT contract_id AS "contractId" FROM tpm_reports/.test(s)) return { rows: [{ contractId: K }] };
      if (/^SELECT 1 FROM contracts WHERE tenant_id = \$1 AND id = \$2 FOR KEY SHARE$/.test(s)) return { rows: [{}] };
      if (/FOR UPDATE OF r$/.test(s)) {
        return { rows: [{ id: R, partnerId: P, contractId: K, kind: 'financier', status: r.status, editedBy: null, createdBy: U, periodMonth: r.periodMonth, periodEnd: r.periodEnd, reportedAmount: '0' }] };
      }
      if (/^SELECT status, kind, reported_amount AS "reportedAmount", edited_by AS "editedBy", partner_id/.test(s)) {
        return { rows: [{ status: r.status, kind: 'financier', reportedAmount: '0', editedBy: null, partnerId: P, contractId: K, periodMonth: r.periodMonth, periodEnd: r.periodEnd }] };
      }
      if (/^SELECT p\.active, t\.code FROM partners p/.test(s)) return { rows: [state.partner] };
      if (/^SELECT count\(\*\)::int AS n FROM contract_report_items/.test(s)) return { rows: [{ n: state.items }] };
      if (/^(DELETE FROM contract_report_items|UPDATE tpm_reports)/.test(s)) return { rows: [], rowCount: 1 };
      throw new Error(`requête inattendue : ${s.slice(0, 140)}`);
    },
  });
};

const repo = require('../src/modules/tpm/reports.repository');
const at = (re) => state.calls.findIndex((c) => re.test(c.sql));
const ORDER = [/FOR KEY SHARE$/, /^SELECT pg_advisory_xact_lock/, /FOR UPDATE( OF r)?$/, /^SELECT p\.active, t\.code FROM partners p/];
const assertOrder = (label) => {
  const idx = ORDER.map(at);
  assert.ok(idx.every((i) => i >= 0), `${label} : contrat, attribution, ligne, fiche — ${idx}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `${label} : dans l'ordre`);
};

test('soumettre (point 6) : gabarit d un TPM inactif pour le mois courant → NOT_TPM, rien d écrit ; verrous dans l ordre du lien', async () => {
  reset({ periodMonth: `${M}-01` });
  await assert.rejects(repo.submitReport(T, R, U), (e) => e.code === 'NOT_TPM');
  assertOrder('soumission');
  assert.equal(at(/^UPDATE tpm_reports/), -1, 'jamais soumis');
  // Une facture d'un mois passé : acceptée (décision D-b), après la même garde.
  reset();
  assert.deepEqual(await repo.submitReport(T, R, U), { ok: true });
  assertOrder('soumission, mois passé');
  assert.ok(at(/^UPDATE tpm_reports SET status = 'soumis'/) > at(/^SELECT p\.active, t\.code FROM partners p/));
  // Facture pluri-mensuelle qui touche le mois courant : refusée.
  reset({ periodEnd: `${M}-01` });
  await assert.rejects(repo.submitReport(T, R, U), (e) => e.code === 'NOT_TPM');
  // TPM actif : toujours accepté.
  reset({ periodMonth: `${shift(M, 2)}-01` }); state.partner = { active: true, code: 'tpm' };
  assert.deepEqual(await repo.submitReport(T, R, U), { ok: true });
});

test('enregistrer l état des dépenses (point 6) : période prolongée jusqu au mois courant par un TPM inactif → NOT_TPM avant toute écriture', async () => {
  reset({ status: 'rejete' });
  await assert.rejects(repo.replaceReportItems(T, R, [], { periodEnd: `${shift(M, 1)}-01`, userId: U }), (e) => e.code === 'NOT_TPM');
  assertOrder('sauvegarde');
  assert.equal(at(/^DELETE FROM contract_report_items/), -1, 'rien d écrit');
  // Prolongée, mais encore avant le mois courant : acceptée.
  reset({ status: 'rejete' });
  assert.equal(await repo.replaceReportItems(T, R, [], { periodEnd: `${shift(M, -1)}-01`, userId: U }), R);
  assertOrder('sauvegarde, mois passés');
  // Période inchangée : la sauvegarde d'un brouillon ne repasse pas la garde (la soumission le fera).
  reset({ periodMonth: `${M}-01`, periodEnd: `${M}-01` });
  assert.equal(await repo.replaceReportItems(T, R, [], { periodEnd: `${M}-01`, userId: U }), R);
  assert.equal(at(/^SELECT p\.active, t\.code FROM partners p/), -1);
  assert.ok(at(/FOR KEY SHARE$/) < at(/^SELECT pg_advisory_xact_lock/) && at(/^SELECT pg_advisory_xact_lock/) < at(/FOR UPDATE OF r$/), 'mêmes verrous, même ordre');
});
