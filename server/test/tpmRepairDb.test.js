/**
 * Reprise du retour 58 au démarrage (réparation r58_tpm_zones) — EN BASE RÉELLE, sur demande.
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré : npm test reste sans base. Exemple :
 *   createdb r58_repair_test
 *   DATABASE_URL=postgres://postgres:…@localhost/r58_repair_test npm run migrate (puis seed, seed:test)
 *   MEMS_TEST_DATABASE_URL=postgres://postgres:…@localhost/r58_repair_test \
 *   MEMS_TEST_APP_DATABASE_URL=postgres://mems2_app:…@localhost/r58_repair_test node --test test/tpmRepairDb.test.js
 *
 * Scénario : un site d'une zone couverte deux mois par un contrat de suivi (TPM P) ; sur ces deux
 * mois, la zone est ensuite confiée à Q avec une raison (modification de zone). Visites de test :
 *   a prévue « zone »            → Q (suit la décision de sa zone)
 *   b prévue « reprise » (TPM R saisi avant la règle, sans raison) → rendue à sa zone : Q
 *   c prévue « visite » (R choisi AVEC une raison)                 → jamais touchée
 *   d réalisée « reprise » (R)   → jamais touchée
 *   e réalisée « zone » (P)      → jamais touchée
 *   g annulée « zone » (P)       → jamais touchée
 *   h prévue « zone » figée « antérieur à la règle » (migration 070 b), sans TPM → jamais touchée
 *   f prévue « zone » (P) d'un mois déjà FACTURÉ par P (facture soumise) → jamais touchée
 * Deux démarrages simultanés ne jouent la réparation qu'une fois ; rejouée, elle ne change rien ;
 * l'action « Appliquer les TPM des contrats » (même fonction, avec une période) ne touche pas
 * davantage une visite réalisée ; et mems_tpm_stamp refuse, en base, de ré-estampiller une visite
 * réalisée, annulée, figée ou facturée qu'on lui demanderait (défense en profondeur).
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
const LABEL = 'Reprise : TPM des contrats appliqué aux visites existantes (retour 58)';
const REPRISE = 'Reprise : TPM saisi avant la règle (test r58).';
const MOTIF = 'Écart motivé pour ce test du retour 58.';

test('reprise r58 en base : deux démarrages simultanés = une exécution, rejouée = 0 changement ; TPM motivé, visites réalisées, annulées et facturées jamais touchées', { skip: SKIP, timeout: 120000 }, async () => {
  const { Client } = require('pg');
  const { runDataRepairs, REPAIRS, repairTpmZones } = require('../src/db/dataRepairs');
  const { pool, withTenantTransaction } = require('../src/config/db');
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  const made = { visits: [], overrides: [], reports: [] };
  try {
    const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
    await q("DELETE FROM site_visits WHERE tenant_id = $1 AND activity LIKE 'Test r58 %'", [T]);

    // 1. Site et deux mois « selon contrat » (même TPM P, même contrat K), sans aucune facture de P ces
    // mois-là. Recherche ÉTROITE (une base neuve n'a pas encore de statistiques : jamais la règle sur
    // tous les sites × tous les mois) : quelques sites d'une zone liée d'un contrat de suivi actif, ses
    // 12 premiers mois au plus, puis la règle (mems_tpm_cells) sur ces seuls couples.
    await q('ANALYZE sites, site_visits, contracts, contract_areas, contract_budget_items, admin_areas, tpm_reports, tpm_collection_plans, partners');
    const cand = await q(
      `SELECT s.id AS site_id, to_char(gs.m, 'YYYY-MM-DD') AS m
         FROM (SELECT c.id, c.date_debut, c.date_fin FROM contracts c
                WHERE c.tenant_id = $1 AND c.status = 'actif'
                  AND EXISTS (SELECT 1 FROM contract_budget_items b WHERE b.tenant_id = $1 AND b.contract_id = c.id
                                AND b.line_code = 'IV.suivi' AND b.unit_count * b.unit_cost > 0)
                ORDER BY c.date_debut, c.id) k
         JOIN LATERAL (SELECT s.id FROM contract_areas z
                         JOIN sites s ON s.tenant_id = $1 AND s.zone_district_id = z.admin_area_id
                        WHERE z.tenant_id = $1 AND z.contract_id = k.id AND z.admin_area_id IS NOT NULL
                        ORDER BY s.id LIMIT 3) s ON true
         CROSS JOIN LATERAL generate_series(date_trunc('month', k.date_debut), LEAST(date_trunc('month', k.date_fin),
                                            date_trunc('month', k.date_debut) + interval '11 months'), interval '1 month') AS gs(m)
        LIMIT 240`, [T]);
    const [pick] = await q(
      `WITH cells AS (
         SELECT * FROM mems_tpm_cells($1, $2::uuid[], $3::date[])
          WHERE c_state = 'contrat'
            AND NOT EXISTS (SELECT 1 FROM tpm_reports r WHERE r.tenant_id = $1 AND r.partner_id = c_provider_id
                              AND r.period_month = c_month AND r.kind = 'financier'))
       SELECT c_site_id AS "siteId", c_provider_id AS "providerId", c_contract_id AS "contractId",
              (array_agg(to_char(c_month, 'YYYY-MM-DD') ORDER BY c_month))[1:2] AS months, (array_agg(c_area_id ORDER BY c_month))[1:2] AS areas
         FROM cells GROUP BY 1, 2, 3 HAVING count(*) >= 2
        ORDER BY count(*) DESC, 1 LIMIT 1`, [T, cand.map((x) => x.site_id), cand.map((x) => x.m)]);
    assert.ok(pick, 'la base de test doit avoir une zone couverte deux mois par un contrat de suivi (npm run seed)');
    const { siteId: S, providerId: P, contractId: K, months: [M1, M2], areas: [A1, A2] } = pick;
    const others = await q('SELECT id FROM partners WHERE tenant_id = $1 AND active AND id <> $2 ORDER BY name, id LIMIT 2', [T, P]);
    assert.equal(others.length, 2, 'deux autres prestataires actifs');
    const [Q, R] = others.map((o) => o.id);
    const [{ id: U }] = await q('SELECT id FROM users WHERE tenant_id = $1 ORDER BY email LIMIT 1', [T]);

    // 2. Visites de test (une transaction : les visites « zone » sont estampillées au COMMIT → P).
    await q('BEGIN');
    const ins = await q(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_id, provider_reason)
       SELECT $1, $2, u.m, u.act, u.st, u.src, u.p, u.why
         FROM unnest($3::date[], $4::text[], $5::text[], $6::text[], $7::uuid[], $8::text[]) AS u(m, act, st, src, p, why)
       RETURNING id, activity`,
      [T, S,
        [M1, M1, M1, M1, M1, M1, M2],
        ['Test r58 a', 'Test r58 b', 'Test r58 c', 'Test r58 d', 'Test r58 e', 'Test r58 g', 'Test r58 f'],
        ['planifie', 'planifie', 'planifie', 'realise', 'planifie', 'planifie', 'planifie'],
        ['zone', 'reprise', 'visite', 'reprise', 'zone', 'zone', 'zone'],
        [null, R, R, R, null, null, null],
        [null, REPRISE, MOTIF, REPRISE, null, null, null]]);
    // h : figée « antérieur à la règle », comme l'a fait la reprise de la migration 070 (b) — écrite
    // sous le drapeau de l'estampille (la garde AVANT la laisse telle quelle).
    await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
    const frozen = await q(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_zone_state)
       VALUES ($1, $2, $3, 'Test r58 h', 'planifie', 'zone', 'anterieur') RETURNING id, activity`, [T, S, M1]);
    await q('COMMIT');
    ins.push(...frozen);
    const id = Object.fromEntries(ins.map((r) => [r.activity.slice(-1), r.id]));
    made.visits = ins.map((r) => r.id);
    // e réalisée, g annulée (leur TPM reste P) ; f : P a soumis sa facture du mois M2.
    await q('BEGIN');
    await q("UPDATE site_visits SET status = 'realise' WHERE id = $1", [id.e]);
    await q("UPDATE site_visits SET status = 'annule' WHERE id = $1", [id.g]);
    const rep = await q(
      `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, reported_amount, status,
                                created_by, submitted_by, submitted_at, edited_by, edited_at)
       VALUES ($1, $2, $3, $4, 'financier', 0, 'soumis', $5, $5, now(), $5, now()) RETURNING id`, [T, P, K, M2, U]);
    made.reports = rep.map((r) => r.id);
    await q('COMMIT');
    const stamped = await q('SELECT provider_id AS p, provider_zone_state AS st FROM site_visits WHERE id = ANY ($1::uuid[])', [[id.a, id.e, id.g, id.f]]);
    assert.ok(stamped.every((v) => v.p === P && v.st === 'contrat'), 'visites « zone » estampillées au COMMIT : TPM du contrat');

    // 3. La zone est confiée à Q ces deux mois (décision motivée, écrite sans ré-estampiller).
    const ov = await q(
      `INSERT INTO tpm_zone_overrides (tenant_id, admin_area_id, area_path, area_depth, period_month, provider_id,
                                       expected_state, expected_provider_id, reason, batch_id)
       SELECT $1, a.id, a.path, a.depth, u.m, $4, 'contrat', $5, 'Test r58 : zone confiée à un autre prestataire.', gen_random_uuid()
         FROM unnest($2::uuid[], $3::date[]) AS u(aid, m) JOIN admin_areas a ON a.tenant_id = $1 AND a.id = u.aid
       RETURNING id`, [T, [A1, A2], [M1, M2], Q, P]);
    assert.equal(ov.length, 2);
    made.overrides = ov.map((r) => r.id);

    // 4. Deux démarrages de l'API en même temps (deux connexions du pool, rôle applicatif).
    await q("DELETE FROM data_repairs WHERE key = 'r58_tpm_zones'");
    const [{ t0 }] = await q('SELECT clock_timestamp() AS t0');
    const r58 = REPAIRS.find((r) => r.key === 'r58_tpm_zones');
    const [ra, rb] = await Promise.all([runDataRepairs({ repairs: [r58] }), runDataRepairs({ repairs: [r58] })]);
    const mine = [...ra, ...rb].filter((r) => r.tenant === T);
    assert.deepEqual(mine.map((r) => r.status).sort(), ['done', 'skipped'], 'une seule exécution');
    const done = mine.find((r) => r.status === 'done').result;
    assert.ok(done.changed >= 2, `au moins a et b changent (${done.changed})`);
    assert.ok(done.kept.reasoned >= 1 && done.kept.done >= 3 && done.kept.anterieur >= 1 && done.kept.invoiced >= 1, JSON.stringify(done.kept));
    const [{ n: marks }] = await q("SELECT count(*)::int AS n FROM data_repairs WHERE tenant_id = $1 AND key = 'r58_tpm_zones'", [T]);
    assert.equal(marks, 1);
    const [{ n: lots }] = await q(
      "SELECT count(*)::int AS n FROM tpm_attribution_log WHERE tenant_id = $1 AND scope = 'lot' AND label = $2 AND changed_at >= $3", [T, LABEL, t0]);
    assert.equal(lots, 1, 'un seul lot au journal');

    // 5. Résultat visite par visite.
    const read = async () => Object.fromEntries((await q(
      `SELECT activity, status, provider_source AS src, provider_id AS p, provider_zone_state AS st, provider_reason AS why, contract_id AS k
         FROM site_visits WHERE id = ANY ($1::uuid[])`, [made.visits])).map((r) => [r.activity.slice(-1), r]));
    const v = await read();
    assert.deepEqual([v.a.src, v.a.st, v.a.p], ['zone', 'modifie', Q], 'a : suit la décision de sa zone');
    assert.deepEqual([v.b.src, v.b.st, v.b.p, v.b.why], ['zone', 'modifie', Q, null], 'b : reprise rendue à sa zone');
    assert.deepEqual([v.c.src, v.c.p, v.c.why, v.c.status], ['visite', R, MOTIF, 'planifie'], 'c : TPM motivé jamais touché');
    assert.deepEqual([v.d.src, v.d.p, v.d.why, v.d.status], ['reprise', R, REPRISE, 'realise'], 'd : réalisée jamais touchée');
    assert.deepEqual([v.e.src, v.e.st, v.e.p, v.e.k, v.e.status], ['zone', 'contrat', P, K, 'realise'], 'e : réalisée jamais touchée');
    assert.deepEqual([v.g.src, v.g.st, v.g.p, v.g.status], ['zone', 'contrat', P, 'annule'], 'g : annulée jamais touchée');
    assert.deepEqual([v.f.src, v.f.st, v.f.p, v.f.status], ['zone', 'contrat', P, 'planifie'], 'f : déjà facturée, jamais touchée');
    assert.deepEqual([v.h.src, v.h.st, v.h.p, v.h.status], ['zone', 'anterieur', null, 'planifie'], 'h : figée « antérieur », jamais touchée');
    // Journal : l'ancien TPM de b (saisi avant la règle) reste lisible.
    const [logB] = await q(
      "SELECT old_provider_id AS old, new_provider_id AS new FROM tpm_attribution_log WHERE tenant_id = $1 AND visit_id = $2 AND changed_at >= $3", [T, id.b, t0]);
    assert.deepEqual([logB.old, logB.new], [R, Q]);

    // 6. Rejouée (sans la marque) : aucun changement ; démarrage suivant : rien ne tourne.
    const again = await withTenantTransaction(T, (client) => repairTpmZones(client, T));
    assert.deepEqual([again.zones, again.converted, again.changed], [0, 0, 0], JSON.stringify(again));
    assert.deepEqual(await read(), v, 'visites identiques après la seconde exécution');
    const third = await runDataRepairs({ repairs: [r58] });
    assert.deepEqual(third.filter((r) => r.tenant === T).map((r) => r.status), ['skipped']);

    // 7. Action « Appliquer les TPM des contrats » sur la période (rôle applicatif, un auteur) : la
    // visite réalisée au TPM saisi à la main (d), l'annulée, la figée et la facturée ne bougent pas.
    const tpm = require('../src/modules/tpm/tpmAttribution.repository');
    const period = { from: M1.slice(0, 7), to: M2.slice(0, 7) };
    const action = await withTenantTransaction(T, (client) => tpm.applyContractsTx(client, T, U, { period }));
    assert.equal(action.changed, 0, JSON.stringify(action));
    assert.ok(action.kept.done >= 3 && action.kept.anterieur >= 1 && action.kept.invoiced >= 1 && action.kept.reasoned >= 1, JSON.stringify(action.kept));
    assert.deepEqual(await read(), v, 'action : visites identiques');

    // 8. En base, même si on les lui demande : réalisée, annulée, figée, facturée → jamais ré-estampillées.
    const asked = [id.c, id.d, id.e, id.g, id.h, id.f];
    const restamped = await withTenantTransaction(T, async (client) => (await client.query(
      'SELECT o_id FROM mems_tpm_stamp($1, $2::uuid[])', [T, asked])).rows);
    assert.deepEqual(restamped, [], 'mems_tpm_stamp : aucune visite demandée ré-estampillée');
    assert.deepEqual(await read(), v);
  } finally {
    // Base jetable : on retire ce que le test a créé (le journal, inaltérable, garde ses lignes).
    if (made.visits.length) await q('DELETE FROM site_visits WHERE id = ANY ($1::uuid[])', [made.visits]);
    if (made.overrides.length) await q('DELETE FROM tpm_zone_overrides WHERE id = ANY ($1::uuid[])', [made.overrides]);
    if (made.reports.length) await q('DELETE FROM tpm_reports WHERE id = ANY ($1::uuid[])', [made.reports]);
    await su.end();
    await pool.end();
  }
});
