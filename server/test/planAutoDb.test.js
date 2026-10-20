/**
 * Planification automatique (« Générer le plan de suivi ») — EN BASE RÉELLE, sur demande.
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré : npm test reste sans base.
 *
 * Sur le premier compte, du mois courant à décembre :
 *   1. l'aperçu = le moteur sur les entrées relues ; 0 violation d'invariant (planAutoInvariants) ;
 *      l'aperçu ne renvoie qu'un échantillon ;
 *   2. une donnée change entre l'aperçu et « Appliquer » → 409 plan_inputs_changed (« visites ») ;
 *      la donnée revient à l'identique → l'empreinte de l'aperçu est de nouveau acceptée ;
 *   3. « Appliquer » : créées = prévues, jamais un mois échu, jamais deux visites du même site × mois,
 *      TPM de zone estampillé ; rejoué : 409 (l'aperçu est périmé) ; nouvel aperçu : 0 à créer ;
 *   4. une demande qui commence en janvier : les mois échus sont signalés, jamais planifiés ;
 *   5. règle unique « actif au mois M » + mois annulé : une grille où seul un site a des « Oui » →
 *      seul ce site est planifié, jamais le mois de sa visite annulée ;
 *   6. ordre des verrous : « Appliquer », « Générer depuis le RBM » et une coche du Plan de suivi en
 *      même temps → aucun interblocage (40P01) ni attente expirée (55P03).
 * Tout ce que le test crée est supprimé à la fin (visites, grille).
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
const TAG = 'Test plan auto';

test('planification automatique : aperçu, empreinte, application, idempotence, règle unique, verrous', { skip: SKIP, timeout: 300000 }, async () => {
  const { Client } = require('pg');
  const { pool, withTenantTransaction } = require('../src/config/db');
  const service = require('../src/modules/tpm/planAuto.service');
  const repo = require('../src/modules/tpm/planAuto.repository');
  const field = require('../src/modules/tpm/field.repository');
  const { generatePlan } = require('../src/modules/tpm/planAuto');
  const { checkInvariants } = require('../src/modules/tpm/planAutoInvariants');
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  // Les tests en base de la planification s'exécutent l'un après l'autre (node --test lance les
  // fichiers en parallèle ; ils touchent les mêmes visites) : verrou de session, libéré à la fin.
  await q("SELECT pg_advisory_lock(hashtext('mems-test-db:plan-auto'))");
  const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
  const before = new Set((await q('SELECT id FROM site_visits WHERE tenant_id = $1', [T])).map((r) => r.id));
  const now = currentMonth();
  const year = Number(now.slice(0, 4));
  const gridBefore = Number((await q('SELECT count(*)::int AS n FROM site_month_status WHERE tenant_id = $1 AND year = $2', [T, year]))[0].n);
  let gridAdded = false;
  const newVisits = async () => (await q(
    `SELECT id, site_id, to_char(period_month, 'YYYY-MM') AS month, status, provider_zone_state AS state,
            to_char(visit_date, 'YYYY-MM-DD') AS date, agent
       FROM site_visits WHERE tenant_id = $1`, [T])).filter((v) => !before.has(v.id));
  const dropNew = async () => {
    const ids = (await newVisits()).map((v) => v.id);
    if (ids.length) await q('DELETE FROM site_visits WHERE id = ANY($1::uuid[])', [ids]);
  };
  try {
    const [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY created_at LIMIT 1", [T]);
    const body = { from: now, to: `${year}-12` };
    const months = []; for (let m = Number(now.slice(5, 7)); m <= 12; m += 1) months.push(m);

    // 1. Aperçu = moteur sur les mêmes entrées ; invariants ; échantillon seulement.
    const p1 = await service.preview(T, body);
    assert.ok(p1.summary.planned > 0, 'des visites à planifier (npm run seed:test)');
    assert.equal(p1.assignments, undefined, 'l\'aperçu ne renvoie pas tout le plan');
    assert.ok(p1.sample.length <= service.SAMPLE_SIZE && p1.sampleTotal === p1.summary.planned);
    assert.match(p1.fingerprint, /^[0-9a-f]{64}$/);
    const inputs = await withTenantTransaction(T, (c) => repo.loadInputsTx(c, T, { year }));
    const opts = { yearHasGrid: inputs.yearHasGrid, fromMonth: now };
    const plan = generatePlan(inputs.sites, inputs.mmrByKey, {}, months, year, opts);
    assert.deepEqual(checkInvariants({ sites: inputs.sites, mmrByKey: inputs.mmrByKey, settings: {}, months, year, opts }, plan), []);
    assert.equal(plan.summary.planned, p1.summary.planned);

    // 2. Donnée changée entre l'aperçu et « Appliquer » → 409 nommant la section.
    const target = inputs.sites.find((s) => !s.forbidden && !(s.visits || []).some((v) => v.month === Number(now.slice(5, 7))));
    const [{ id: extra }] = await q(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, $3::date, $4, 'planifie') RETURNING id`,
      [T, target.id, `${now}-01`, `${TAG} 409`]);
    const expected = { ...body, fingerprint: p1.fingerprint, sections: p1.sections };
    await assert.rejects(service.apply(T, U, expected), (e) => e.statusCode === 409 && e.details.code === 'plan_inputs_changed'
      && e.details.sections.includes('visites'));
    assert.equal((await newVisits()).filter((v) => v.id !== extra).length, 0, 'rien n\'est écrit sur un 409');
    await q('DELETE FROM site_visits WHERE id = $1', [extra]);

    // 3. Appliquer : créées = prévues ; jamais un mois échu ni deux visites du même site × mois ; TPM estampillé.
    const a1 = await service.apply(T, U, expected);
    assert.equal(a1.planned, p1.summary.planned);
    assert.equal(a1.created, a1.planned, `créées ${a1.created} sur ${a1.planned} prévues (${JSON.stringify(a1.skipped)})`);
    const created = await newVisits();
    assert.equal(created.length, a1.created);
    assert.ok(created.every((v) => v.month >= now && v.status === 'planifie'), 'jamais un mois échu');
    assert.ok(created.every((v) => v.state != null), 'TPM de zone estampillé (retour 58)');
    // Option « Écrire les dates et les agents » NON cochée (défaut) : le mois seul.
    assert.ok(created.every((v) => v.date == null && v.agent == null), 'sans l\'option : ni date ni agent');
    const dup = await q(
      `SELECT v.site_id, v.period_month FROM site_visits v WHERE v.tenant_id = $1 AND v.id = ANY($2::uuid[])
          AND EXISTS (SELECT 1 FROM site_visits o WHERE o.tenant_id = v.tenant_id AND o.site_id = v.site_id
                        AND o.period_month = v.period_month AND o.id <> v.id)`, [T, created.map((v) => v.id)]);
    assert.deepEqual(dup, [], 'jamais deux visites du même site × mois');
    await assert.rejects(service.apply(T, U, expected), (e) => e.statusCode === 409, 'rejoué avec l\'ancien aperçu : 409');
    const p2 = await service.preview(T, body);
    assert.equal(p2.summary.planned, 0, 'un 2ᵉ passage sur la même période n\'ajoute rien');
    const a2 = await service.apply(T, U, { ...body, fingerprint: p2.fingerprint, sections: p2.sections });
    assert.equal(a2.created, 0);

    // 3 b. Option cochée : chaque visite a la date de son jour de terrain (dans son mois) et un rôle
    //      générique « Agent N » ; « Effacer les planifications » les conserve (datées, affectées).
    await dropNew();
    const ws = { ...body, settings: { writeSchedule: true } };
    const p6 = await service.preview(T, ws);
    assert.equal(p6.writeSchedule, true);
    assert.ok(p6.sample.every((a) => a.agent && a.date && a.date.startsWith(a.month)), 'l\'échantillon montre les créneaux');
    const a6 = await service.apply(T, U, { ...ws, fingerprint: p6.fingerprint, sections: p6.sections });
    assert.equal(a6.created, a6.planned);
    const dated = await newVisits();
    assert.equal(dated.length, a6.created);
    assert.ok(dated.every((v) => v.date && v.date.startsWith(v.month) && /^Agent \d+$/.test(v.agent)), 'date du mois et « Agent N »');
    const cleared = await service.clearPlanned(T, { year, from: Number(now.slice(5, 7)), to: 12 });
    assert.equal((await newVisits()).length, dated.length, '« Effacer » conserve les visites datées et affectées');
    assert.ok(cleared.kept >= dated.length);
    // Sans l'option, « Effacer » retire le plan généré.
    await dropNew();
    const p7 = await service.preview(T, body);
    await service.apply(T, U, { ...body, fingerprint: p7.fingerprint, sections: p7.sections });
    assert.ok((await newVisits()).length > 0);
    await service.clearPlanned(T, { year, from: Number(now.slice(5, 7)), to: 12 });
    // Seules restent les visites d'un mois déjà facturé par leur TPM (jamais effacées, retour 82).
    const left = (await newVisits()).map((x) => x.id);
    const notInvoiced = left.length ? (await q(
      `SELECT count(*)::int AS n FROM site_visits v WHERE v.id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM tpm_reports r WHERE r.tenant_id = v.tenant_id AND r.partner_id = v.provider_id
                            AND r.period_month = v.period_month AND r.kind = 'financier' AND r.status IN ('soumis', 'valide'))`, [left]))[0].n : 0;
    assert.equal(notInvoiced, 0, '« Effacer » retire le plan généré sans dates ni agents (hors mois facturés)');

    // 4. Demande depuis janvier : mois échus signalés, jamais planifiés.
    if (now > `${year}-01`) {
      const p3 = await service.preview(T, { from: `${year}-01`, to: `${year}-12` });
      assert.equal(p3.period.pastMonths.length, Number(now.slice(5, 7)) - 1);
      assert.ok(p3.sample.every((a) => a.month >= now));
      assert.equal(p3.period.from, now);
    }
    await dropNew();

    // 5. Règle unique + mois annulé : grille où seul s1 a des « Oui » (mois courant → décembre).
    if (gridBefore === 0) {
      const s1 = inputs.sites.find((s) => !s.forbidden && s.activity && s.inScope !== false
        && !(s.visits || []).some((v) => v.month >= Number(now.slice(5, 7))));
      assert.ok(s1, 'un site libre sur la période');
      await q(`INSERT INTO site_month_status (tenant_id, site_id, year, month, active)
               SELECT $1, $2, $3, m, true FROM generate_series($4::int, 12) AS m`, [T, s1.id, year, Number(now.slice(5, 7))]);
      gridAdded = true;
      await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, $3::date, $4, 'annule')`,
        [T, s1.id, `${now}-01`, `${TAG} annulee`]);
      const p4 = await service.preview(T, body);
      assert.equal(p4.yearHasGrid, true);
      const a4 = await service.apply(T, U, { ...body, fingerprint: p4.fingerprint, sections: p4.sections });
      const made = (await newVisits()).filter((v) => v.status === 'planifie');
      assert.equal(made.length, a4.created);
      assert.ok(made.length > 0, 'le site actif est planifié');
      assert.ok(made.every((v) => v.site_id === s1.id), 'une case vide n\'est jamais planifiable : seul le site avec des « Oui »');
      assert.ok(made.every((v) => v.month !== now), 'jamais le mois de la visite annulée');
      await dropNew();
      await q('DELETE FROM site_month_status WHERE tenant_id = $1 AND year = $2', [T, year]);
      gridAdded = false;
    }

    // 6. Ordre des verrous : trois écrivains de plan en même temps, aucun interblocage.
    const p5 = await service.preview(T, body);
    const next = months.length > 1 ? `${year}-${String(months[1]).padStart(2, '0')}` : now;
    const tick = inputs.sites.find((s) => !s.forbidden && !(s.visits || []).some((v) => v.month === Number(next.slice(5, 7))));
    const results = await Promise.allSettled([
      service.apply(T, U, { ...body, fingerprint: p5.fingerprint, sections: p5.sections }),
      field.generateFromRbm(T, U, next),
      field.setPlannedMonths(T, U, { year, changes: [{ siteId: tick.id, month: Number(next.slice(5, 7)), planned: true }] }),
      service.apply(T, U, { ...body, fingerprint: p5.fingerprint, sections: p5.sections }),
    ]);
    for (const r of results) {
      if (r.status === 'fulfilled') continue;
      assert.ok(r.reason && r.reason.statusCode === 409, `seul un 409 (aperçu périmé) est permis : ${r.reason && (r.reason.code || r.reason.message)}`);
    }
    assert.ok(results.some((r) => r.status === 'fulfilled'));
  } finally {
    await dropNew().catch(() => {});
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity LIKE $2', [T, `${TAG} %`]).catch(() => {});
    if (gridAdded) await q('DELETE FROM site_month_status WHERE tenant_id = $1 AND year = $2', [T, year]).catch(() => {});
    await su.end();
    await pool.end();
  }
});
