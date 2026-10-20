/**
 * Retours 114 et 115 — EN BASE RÉELLE, sur demande (comme tpmRepairDb.test.js) :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré.
 *
 * Scénario, sur un district qui a des sites mais aucun contrat de suivi avec un TPM : un contrat de
 * suivi K (test) y est posé, titulaire un partenaire de MISE EN ŒUVRE H, sans TPM rattaché.
 *  1. Ré-estampille de la migration 107 (le bloc du fichier, rejoué tel quel) sur des visites
 *     estampillées « à l'ancienne » (titulaire H retenu comme TPM) : seule la visite PRÉVUE passe en
 *     suivi interne « sans_tpm » ; réalisée, annulée, figée « antérieur », facturée et motivée ne
 *     changent pas ; journal (un lot + une ligne pour la visite qui change) ; rejoué : rien.
 *  2. Rôle d'un partenaire (partnerRole.restampIfRoleChangedTx appelle restampVisitsTx({ fromMonth })) :
 *     titulaire TPM X → la zone le suit ; X devient partenaire de mise en œuvre → ses visites
 *     prévues libres passent « Interne ».
 *  3. Indisponibilité de X (service, rôle applicatif, verrous des mois puis d'attribution) : aperçu =
 *     enregistrement ; la visite prévue passe « indisponible » (interne), la réalisée ne change pas ;
 *     journal avant → après ; rapports attendus : X « non applicable d'office (TPM indisponible) »,
 *     rapport interne attendu ; fin de l'indisponibilité : la visite revient à X.
 *  4. Base : motif trop court refusé (CHECK), journal en inscription seule pour le rôle applicatif,
 *     parité de la jumelle SQL mems_tpm_cells avec la règle pure sur tous les sites × 4 mois.
 *  5. Lien TPM ↔ contrat (U2) : le premier plan de collecte d'un TPM sur le contrat en fait le TPM de
 *     la zone (visite prévue ré-estampillée), la suppression du dernier l'en retire.
 */
const fs = require('node:fs');
const path = require('node:path');

const SU_URL = process.env.MEMS_TEST_DATABASE_URL;
const APP_URL = process.env.MEMS_TEST_APP_DATABASE_URL;
const dbName = (u) => { try { return decodeURIComponent(new URL(u).pathname.slice(1)); } catch { return ''; } };
const enabled = Boolean(SU_URL && APP_URL && /test/i.test(dbName(SU_URL)) && dbName(SU_URL) === dbName(APP_URL));
if (enabled) process.env.APP_DATABASE_URL = APP_URL;
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');

const SKIP = enabled ? false : 'base jetable absente (MEMS_TEST_DATABASE_URL / MEMS_TEST_APP_DATABASE_URL, nom contenant « test »)';
const MIGRATION = fs.readFileSync(path.join(__dirname, '../src/db/migrations/107_tpm_internal_monitoring.sql'), 'utf8');
const RESTAMP_BLOCK = MIGRATION.slice(MIGRATION.indexOf('-- [r107-restamp:debut]'), MIGRATION.indexOf('-- [r107-restamp:fin]'));
const MOTIF = 'Écart motivé pour ce test du retour 114.';

const addMonth = (m, n) => {
  const [y, mm] = m.split('-').map(Number);
  const i = y * 12 + (mm - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

test('retour 114 en base : D1 dans l estampille, rôle changé, indisponibilité, rapports attendus, parité', { skip: SKIP, timeout: 180000 }, async () => {
  const { Client } = require('pg');
  const { pool, withTenantTransaction } = require('../src/config/db');
  const tpm = require('../src/modules/tpm/tpmAttribution.repository');
  const unavailability = require('../src/modules/tpm/tpmUnavailability.service');
  const reports = require('../src/modules/tpm/reports.repository');
  const planning = require('../src/modules/tpm/planning.repository');
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  const made = { visits: [], reports: [], plans: [], contract: null, partners: [], unavailability: [] };
  try {
    const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
    const [{ id: U }] = await q('SELECT id FROM users WHERE tenant_id = $1 ORDER BY email LIMIT 1', [T]);
    const M1 = currentMonth(); const M2 = addMonth(M1, 1);
    const types = Object.fromEntries((await q('SELECT code, id FROM partner_types WHERE tenant_id = $1', [T])).map((r) => [r.code, r.id]));
    assert.ok(types.tpm && types.prestataire, 'types « tpm » et « prestataire » (npm run seed)');

    // District avec des sites, sans contrat de suivi ces deux mois (mems_tpm_cells : « sans_contrat »).
    const sites = await q('SELECT id, zone_district_id AS d FROM sites WHERE tenant_id = $1 AND zone_district_id IS NOT NULL ORDER BY id LIMIT 400', [T]);
    const cells = await q(`SELECT c_site_id AS s, c_area_id AS a, c_state AS st FROM mems_tpm_cells($1, $2::uuid[], $3::date[])`,
      [T, [...sites.map((s) => s.id), ...sites.map((s) => s.id)], [...sites.map(() => `${M1}-01`), ...sites.map(() => `${M2}-01`)]]);
    const ok = new Map();
    for (const c of cells) { const k = c.s; if (!ok.has(k)) ok.set(k, []); ok.get(k).push(c); }
    const pick = sites.find((s) => (ok.get(s.id) || []).length === 2 && ok.get(s.id).every((c) => c.st === 'sans_contrat' && c.a === s.d));
    assert.ok(pick, 'un site d un district sans contrat de suivi (base de test peuplée)');
    const S = pick.id; const D = pick.d;
    const [area] = await q('SELECT id, path, depth FROM admin_areas WHERE tenant_id = $1 AND id = $2', [T, D]);
    assert.equal(Number(area.depth), 2);

    // Partenaires de test : H (mise en œuvre), X (TPM, titulaire), Q (TPM, pour l'écart motivé).
    const mk = async (name, type) => (await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, types[type], name]))[0].id;
    const H = await mk('Test r114 Mise en oeuvre', 'prestataire');
    const X = await mk('Test r114 TPM titulaire', 'tpm');
    const Q = await mk('Test r114 TPM autre', 'tpm');
    made.partners = [H, X, Q];

    // Contrat de suivi K (titulaire H, aucun TPM rattaché) sur le district D, couvrant M1 et M2.
    const [{ id: K }] = await q(
      `INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
       VALUES ($1, 'TEST-R114-0001', $2, 'Test r114 Mise en oeuvre', $3, ($4::date + interval '1 month' - interval '1 day')::date, 'actif', $5) RETURNING id`,
      [T, H, `${M1}-01`, `${M2}-01`, U]);
    made.contract = K;
    await q(`INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
             VALUES ($1, $2, 'IV.suivi', 'Suivi (test r114)', 1, 1000, '{}'::jsonb, 0)`, [K, T]);
    await q('INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order) VALUES ($1, $2, $3, $4, 2, 0)', [K, T, D, area.path]);

    // La règle (D1) : contrat sans TPM → suivi interne « sans_tpm », jamais H.
    const [cell] = await q('SELECT c_state AS st, c_provider_id AS p, c_contract_id AS k FROM mems_tpm_cells($1, $2::uuid[], $3::date[])', [T, [S], [`${M1}-01`]]);
    assert.deepEqual([cell.st, cell.p, cell.k], ['sans_tpm', null, null]);

    // 1. Visites estampillées « à l'ancienne » (H retenu comme TPM, contrat K), sous le drapeau de l'estampille.
    await q('BEGIN');
    await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
    const ins = await q(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_zone_state, contract_id, provider_reason)
       SELECT $1, $2, u.m, u.act, u.st, u.src, u.p, u.zs, u.k, u.why
         FROM unnest($3::date[], $4::text[], $5::text[], $6::text[], $7::uuid[], $8::text[], $9::uuid[], $10::text[])
              AS u(m, act, st, src, p, zs, k, why)
       RETURNING id, activity`,
      [T, S,
        [`${M1}-01`, `${M1}-01`, `${M1}-01`, `${M1}-01`, `${M1}-01`, `${M2}-01`],
        ['Test r114 a', 'Test r114 b', 'Test r114 c', 'Test r114 d', 'Test r114 e', 'Test r114 f'],
        ['planifie', 'realise', 'annule', 'planifie', 'planifie', 'planifie'],
        ['zone', 'zone', 'zone', 'zone', 'visite', 'zone'],
        [H, H, H, null, Q, H],
        ['contrat', 'contrat', 'contrat', 'anterieur', null, 'contrat'],
        [K, K, K, null, null, K],
        [null, null, null, null, MOTIF, null]]);
    await q('COMMIT');
    made.visits = ins.map((r) => r.id);
    const id = Object.fromEntries(ins.map((r) => [r.activity.slice(-1), r.id]));
    // f : H a soumis sa facture du mois M2 (« déjà facturée »).
    const rep = await q(
      `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, reported_amount, status, created_by, submitted_by, submitted_at, edited_by, edited_at)
       VALUES ($1, $2, $3, $4, 'financier', 0, 'soumis', $5, $5, now(), $5, now()) RETURNING id`, [T, H, K, `${M2}-01`, U]);
    made.reports = rep.map((r) => r.id);
    // Parité de la jumelle SQL (mems_tpm_cells) avec la règle pure : tous les sites × 4 mois ; `state` doit apparaître.
    const parity = async (state) => {
      const all = (await q('SELECT id FROM sites WHERE tenant_id = $1', [T])).map((r) => r.id);
      const months = [addMonth(M1, -1), M1, M2, addMonth(M2, 1)];
      const pairs = all.flatMap((s) => months.map((m) => ({ siteId: s, month: m })));
      const js = await withTenantTransaction(T, (client) => tpm.cellsForSitesTx(client, T, pairs));
      const sql = await q(`SELECT c_site_id AS "siteId", to_char(c_month, 'YYYY-MM') AS month, c_state AS state, c_provider_id AS "providerId", c_contract_id AS "contractId"
                             FROM mems_tpm_cells($1, $2::uuid[], $3::date[])`, [T, pairs.map((p) => p.siteId), pairs.map((p) => `${p.month}-01`)]);
      const diff = sql.filter((r) => {
        const j = js.get(`${r.siteId}|${r.month}`);
        return !j || j.state !== r.state || (j.providerId || null) !== (r.providerId || null) || (j.contractId || null) !== (r.contractId || null);
      });
      assert.deepEqual(diff.slice(0, 5), [], `${diff.length} écart(s) entre la règle pure et mems_tpm_cells`);
      assert.ok(sql.some((r) => r.state === state), `la parité couvre l état « ${state} »`);
    };
    const read = async () => Object.fromEntries((await q(
      `SELECT activity, status, provider_source AS src, provider_id AS p, provider_zone_state AS st, contract_id AS k, monitored_by AS by
         FROM site_visits WHERE id = ANY ($1::uuid[])`, [made.visits])).map((r) => [r.activity.slice(-1), r]));
    const before = await read();
    assert.deepEqual([before.a.p, before.a.st, before.a.by], [H, 'contrat', 'tpm'], 'avant : H estampillé comme TPM (règle d avant D1)');

    const [{ t0 }] = await q('SELECT clock_timestamp() AS t0');
    await q(RESTAMP_BLOCK);
    const v = await read();
    assert.deepEqual([v.a.src, v.a.st, v.a.p, v.a.k, v.a.by], ['zone', 'sans_tpm', null, null, 'interne'], 'a : prévue → suivi interne (D1)');
    for (const k of ['b', 'c', 'd', 'e', 'f']) assert.deepEqual(v[k], before[k], `${k} : jamais touchée`);
    assert.equal(v.d.by, 'non_affecte', 'd : figée « antérieur », sans TPM connu');
    assert.equal(v.e.by, 'tpm');
    const logs = await q(`SELECT scope, action, visit_id, old_provider_id, new_provider_id, new_state, changed_by_name FROM tpm_attribution_log
                           WHERE tenant_id = $1 AND changed_at >= $2 ORDER BY scope`, [T, t0]);
    const lot = logs.filter((l) => l.scope === 'lot');
    assert.equal(lot.length, 1);
    assert.deepEqual([lot[0].action, lot[0].changed_by_name], ['reappliquer', 'Migration 107']);
    assert.deepEqual(logs.filter((l) => l.scope === 'visite').map((l) => [l.visit_id, l.old_provider_id, l.new_provider_id, l.new_state]), [[id.a, H, null, 'sans_tpm']]);
    // Rejoué : rien ne change, aucun nouveau lot.
    const [{ t1 }] = await q('SELECT clock_timestamp() AS t1');
    await q(RESTAMP_BLOCK);
    assert.deepEqual(await read(), v);
    assert.equal((await q('SELECT count(*)::int AS n FROM tpm_attribution_log WHERE tenant_id = $1 AND changed_at >= $2', [T, t1]))[0].n, 0);
    await parity('sans_tpm');

    // 2. Titulaire TPM : X suit la zone ; X devient partenaire de mise en œuvre → « Interne ».
    await q("UPDATE contracts SET partner_id = $2, partner_name = 'Test r114 TPM titulaire' WHERE id = $1", [K, X]);
    await withTenantTransaction(T, (client) => tpm.restampVisitsTx(client, T, { fromMonth: M1 }));
    let w = await read();
    assert.deepEqual([w.a.st, w.a.p, w.a.k, w.a.by], ['contrat', X, K, 'tpm'], 'TPM titulaire de son contrat : le TPM de la zone');
    await withTenantTransaction(T, async (client) => {
      await client.query('UPDATE partners SET partner_type_id = $3 WHERE tenant_id = $1 AND id = $2', [T, X, types.prestataire]);
      await tpm.restampVisitsTx(client, T, { fromMonth: M1 }); // ce que fait partnerRole.restampIfRoleChangedTx
    });
    w = await read();
    assert.deepEqual([w.a.st, w.a.p, w.a.by], ['sans_tpm', null, 'interne'], 'type changé en mise en œuvre : visite prévue libre « Interne »');
    for (const k of ['b', 'c', 'd', 'e', 'f']) assert.deepEqual(w[k], before[k], `${k} : jamais touchée`);
    await withTenantTransaction(T, async (client) => {
      await client.query('UPDATE partners SET partner_type_id = $3 WHERE tenant_id = $1 AND id = $2', [T, X, types.tpm]);
      await tpm.restampVisitsTx(client, T, { fromMonth: M1 });
    });
    assert.equal((await read()).a.p, X);

    // 3. Indisponibilité de X en M1 (service, rôle applicatif) : aperçu = enregistrement.
    const REASON = 'Équipe de test mobilisée sur une urgence';
    const prev = await unavailability.preview(T, { providerId: X, from: M1, to: M1, mode: 'poser', reason: REASON });
    assert.equal(prev.counts.created, 1);
    assert.ok(prev.visits.changed >= 1, JSON.stringify(prev.visits));
    assert.ok(prev.zones.toInternal >= 1, JSON.stringify(prev.zones));
    const saved = await unavailability.setUnavailable(T, { userId: U, role: 'admin' }, { providerId: X, from: M1, to: M1, reason: REASON, stamp: prev.stamp });
    assert.equal(saved.visits.changed, prev.visits.changed, 'aperçu = enregistrement');
    made.unavailability = (await q('SELECT id FROM tpm_unavailability WHERE tenant_id = $1 AND provider_id = $2', [T, X])).map((r) => r.id);
    assert.equal(made.unavailability.length, 1);
    w = await read();
    assert.deepEqual([w.a.st, w.a.p, w.a.k, w.a.by], ['indisponible', null, null, 'interne'], 'TPM indisponible : suivi interne');
    assert.deepEqual(w.b, before.b, 'réalisée : jamais touchée');
    const offLog = await q(`SELECT scope, action, old_state, new_state, reason FROM tpm_attribution_log WHERE tenant_id = $1 AND batch_id = $2 ORDER BY scope`, [T, saved.batchId]);
    assert.deepEqual(offLog.map((l) => [l.scope, l.action, l.old_state, l.new_state, l.reason]),
      [['lot', 'indispo_poser', null, null, REASON], ['tpm', 'indispo_poser', 'disponible', 'indisponible', REASON]]);
    // Une 2e déclaration avec l'empreinte d'avant : 409.
    await assert.rejects(unavailability.setUnavailable(T, { userId: U, role: 'admin' }, { providerId: X, from: M1, to: M1, reason: `${REASON} (bis)`, stamp: prev.stamp }),
      (e) => e.statusCode === 409);

    // Rapports attendus : X n'a plus de visite en M1 → non applicable d'office (TPM indisponible) ; rapport interne attendu.
    const exp = await reports.expectedReports(T, { period: { from: M1, to: M1 }, today: M1 });
    const xRow = exp.rows.find((r) => r.unit.kind === 'tpm' && r.unit.providerId === X);
    assert.deepEqual([xRow.status, xRow.auto, xRow.reason], ['non_applicable', true, 'tpm_indisponible']);
    const own = exp.rows.find((r) => r.unit.kind === 'interne');
    assert.ok(own && own.visits.planned >= 1, 'rapport interne attendu');
    assert.ok(!exp.rows.some((r) => r.status === 'en_retard' && r.unit.providerId === X));

    // 4. Base : motif trop court refusé ; journal en inscription seule pour le rôle applicatif.
    await assert.rejects(q("INSERT INTO tpm_unavailability (tenant_id, provider_id, period_month, reason, batch_id) VALUES ($1, $2, $3, 'court', gen_random_uuid())",
      [T, Q, `${M2}-01`]), (e) => e.code === '23514');
    await assert.rejects(withTenantTransaction(T, (client) => client.query('DELETE FROM tpm_attribution_log WHERE tenant_id = $1 AND batch_id = $2', [T, saved.batchId])),
      (e) => e.code === '42501', 'journal inaltérable');

    await parity('indisponible');

    // Fin de l'indisponibilité : la visite prévue revient à X.
    const back = await unavailability.preview(T, { providerId: X, from: M1, to: M1, mode: 'retirer' });
    const ended = await unavailability.endUnavailable(T, { userId: U, role: 'admin' }, { providerId: X, from: M1, to: M1, reason: null, stamp: back.stamp });
    assert.equal(ended.counts.deleted, 1);
    w = await read();
    assert.deepEqual([w.a.st, w.a.p, w.a.k], ['contrat', X, K]);
    made.unavailability = [];

    // 5. Lien TPM ↔ contrat (U2) : titulaire H (mise en œuvre) → « sans_tpm » ; le premier plan de
    //    collecte de Q sur K fait de Q le TPM du contrat (la visite prévue le suit) ; le supprimer : retour.
    await q("UPDATE contracts SET partner_id = $2, partner_name = 'Test r114 Mise en oeuvre' WHERE id = $1", [K, H]);
    await withTenantTransaction(T, (client) => tpm.restampVisitsTx(client, T, { fromMonth: M1 }));
    w = await read();
    assert.deepEqual([w.a.st, w.a.p], ['sans_tpm', null], 'titulaire de mise en œuvre, aucun TPM rattaché');
    const planId = await planning.createPlan(T, { partnerId: Q, contractId: K, periodMonth: `${M1}-01`, title: 'Test r114 plan', items: [], createdBy: U });
    made.plans = [planId];
    w = await read();
    assert.deepEqual([w.a.st, w.a.p, w.a.k, w.a.by], ['contrat', Q, K, 'tpm'], 'premier plan de Q sur K : Q est le TPM de la zone');
    for (const k of ['b', 'c', 'd', 'e']) assert.deepEqual(w[k], before[k], `${k} : jamais touchée`);
    assert.equal(await planning.deletePlan(T, planId, { actorId: U, isAdmin: true }), 'ok');
    made.plans = [];
    w = await read();
    assert.deepEqual([w.a.st, w.a.p, w.a.k, w.a.by], ['sans_tpm', null, null, 'interne'], 'dernier plan supprimé : de nouveau sans TPM');
  } finally {
    // Base jetable : on retire ce que le test a créé (le journal, inaltérable, garde ses lignes).
    if (made.visits.length) await q('DELETE FROM site_visits WHERE id = ANY ($1::uuid[])', [made.visits]);
    if (made.reports.length) await q('DELETE FROM tpm_reports WHERE id = ANY ($1::uuid[])', [made.reports]);
    if (made.plans.length) await q('DELETE FROM tpm_collection_plans WHERE id = ANY ($1::uuid[])', [made.plans]);
    await q('DELETE FROM tpm_unavailability WHERE provider_id = ANY ($1::uuid[])', [made.partners]).catch(() => {});
    if (made.contract) {
      await q('DELETE FROM contract_areas WHERE contract_id = $1', [made.contract]);
      await q('DELETE FROM contract_budget_items WHERE contract_id = $1', [made.contract]);
      await q('DELETE FROM contracts WHERE id = $1', [made.contract]);
    }
    if (made.partners.length) await q('DELETE FROM partners WHERE id = ANY ($1::uuid[])', [made.partners]).catch(() => {});
    await su.end();
    await pool.end();
  }
});
