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
 *   6. ordre des verrous : « Appliquer », « Générer depuis le RBM », une coche du Plan de suivi et la
 *      modification groupée (coche et planification automatique) en même temps → aucun interblocage
 *      (40P01) ni attente expirée (55P03) ;
 *   7. exercices voisins : une visite PRÉVUE en décembre est lue comme ancrage quand on planifie
 *      l'exercice suivant (empreinte « visites » changée, intervalle respecté), et « Appliquer » attend
 *      le verrou de ce mois voisin ;
 *   8. attente des verrous : UNE échéance pour tous les mois (jamais 20 s par verrou) → 55P03 ;
 *   9. site supprimé du registre entre la relecture et l'écriture → 409 « registre », rien d'écrit ;
 *  10. périmètre « bureau » = le bureau et TOUTES ses antennes (3 niveaux), pour planifier comme pour
 *      effacer, comme officeTreeSql ; bureau national = tout le registre ;
 *  11. « Écrire les dates et les agents » en deux passages (un district, puis un autre) : jamais une date
 *      passée, jamais un agent dans deux communes le même jour ;
 *  12. créer ou modifier une visite (date, agent = créneau réservé) attend le verrou de son mois tenu
 *      ailleurs (« Appliquer » ne relit jamais une visite changée avant son écriture) ;
 *  13. jour courant (jour LOCAL) : il n'entre dans l'empreinte que si le mois courant est dans la période
 *      — un aperçu de l'exercice suivant fait un jour s'applique le lendemain ;
 *  14. visites existantes comptées pour le TPM qu'elles PORTENT (retour 114) : une visite confiée à un
 *      autre TPM avec une raison, une visite dont le TPM est retiré (suivi interne) — « Par unité de
 *      suivi » = la clé « qui suit » de chaque visite (provider_id, sinon équipe interne du bureau
 *      racine), jamais le TPM de la zone ; un changement de TPM d'une visite invalide l'aperçu.
 * Tout ce que le test crée est supprimé à la fin (visites, grille, site de test).
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
  const { generatePlan, mmrRule, rbmStep, tpmAt } = require('../src/modules/tpm/planAuto');
  const { officeScopeIds, rootOfficeOf } = require('../src/modules/common/officeScope');
  const { officeTreeSql } = require('../src/modules/common/siteActivitySql');
  const { lockVisitMonthsTx, monthLockKey } = require('../src/modules/tpm/visitLocks');
  const { checkInvariants } = require('../src/modules/tpm/planAutoInvariants');
  const { localDay } = require('../src/modules/common/localDay');
  const { changedSections } = require('../src/modules/tpm/planFingerprint');
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  // Les tests en base de la planification s'exécutent l'un après l'autre (node --test lance les
  // fichiers en parallèle ; ils touchent les mêmes visites) : verrou de session, libéré à la fin.
  await q("SELECT pg_advisory_lock(hashtext('mems-test-db:plan-auto'))");
  const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
  const before = new Set((await q('SELECT id FROM site_visits WHERE tenant_id = $1', [T])).map((r) => r.id));
  // Mois et jour LOCAUX de l'application (APP_TIMEZONE), comme l'horloge du plan (jamais le jour UTC).
  const now = localDay().slice(0, 7);
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
    const todayLocal = localDay();
    assert.ok(dated.every((v) => v.date >= todayLocal), 'jamais une date de visite passée (jour local)');
    const cleared = await service.clearPlanned(T, { year, from: Number(now.slice(5, 7)), to: 12 });
    assert.equal((await newVisits()).length, dated.length, '« Effacer » conserve les visites datées et affectées');
    assert.ok(cleared.kept >= dated.length);
    // Sans l'option, « Effacer » retire le plan généré.
    await dropNew();
    const p7 = await service.preview(T, body);
    await service.apply(T, U, { ...body, fingerprint: p7.fingerprint, sections: p7.sections });
    assert.ok((await newVisits()).length > 0);
    // « Effacer » suit le périmètre : un district seulement, les autres restent.
    const districtOf = new Map(inputs.sites.map((x) => [x.id, x.district]));
    const made7 = await newVisits();
    const dist = districtOf.get(made7[0].site_id);
    await service.clearPlanned(T, { year, from: Number(now.slice(5, 7)), to: 12, scope: { district: dist } });
    const after = await newVisits();
    assert.ok(after.length < made7.length, 'les visites du district sont effacées');
    assert.ok(after.some((v) => districtOf.get(v.site_id) !== dist), 'les autres districts restent');
    await service.clearPlanned(T, { year, from: Number(now.slice(5, 7)), to: 12 });
    // Seules restent les visites d'un mois couvert par une facture de leur TPM (jamais effacées, retour 82) — le
    // prédicat partagé (INVOICED_SQL : chaque mois d'une facture pluri-mensuelle, migration 108), jamais le seul premier mois.
    const { INVOICED_SQL } = require('../src/modules/tpm/tpmAttribution.repository');
    const left = (await newVisits()).map((x) => x.id);
    const notInvoiced = left.length ? (await q(
      `SELECT count(*)::int AS n FROM site_visits v WHERE v.id = ANY($1::uuid[]) AND NOT ${INVOICED_SQL}`, [left]))[0].n : 0;
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
    const bulkIds = [...new Set(p5.sample.slice(0, 20).map((a) => a.siteId))];
    const results = await Promise.allSettled([
      service.apply(T, U, { ...body, fingerprint: p5.fingerprint, sections: p5.sections }),
      field.generateFromRbm(T, U, next),
      field.setPlannedMonths(T, U, { year, changes: [{ siteId: tick.id, month: Number(next.slice(5, 7)), planned: true }] }),
      // Modification groupée : sites verrouillés APRÈS les mois (jamais l'inverse, revue du 16/10).
      field.bulkUpdateSites(T, U, { year, siteIds: bulkIds, plan: { month: 12, planned: true } }),
      field.bulkUpdateSites(T, U, { year, siteIds: bulkIds, plan: { auto: true, fromMonth: Number(now.slice(5, 7)) } }),
      service.apply(T, U, { ...body, fingerprint: p5.fingerprint, sections: p5.sections }),
    ]);
    for (const r of results) {
      if (r.status === 'fulfilled') continue;
      assert.ok(r.reason && r.reason.statusCode === 409, `seul un 409 (aperçu périmé) est permis : ${r.reason && (r.reason.code || r.reason.message)}`);
    }
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    for (const i of [1, 2, 3, 4]) assert.equal(results[i].status, 'fulfilled', `écrivain du Plan de suivi n° ${i} : ${results[i].reason && results[i].reason.message}`);
    await dropNew();

    // 7. Exercices voisins : une visite PRÉVUE en décembre ancre l'intervalle de l'exercice suivant.
    const nextYear = year + 1;
    const nb = { from: `${nextYear}-01`, to: `${nextYear}-12` };
    const before7 = await service.preview(T, nb);
    const inNext = await withTenantTransaction(T, (c) => repo.loadInputsTx(c, T, { year: nextYear }));
    const all12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const optsNext = { yearHasGrid: inNext.yearHasGrid, fromMonth: now };
    const planNext = generatePlan(inNext.sites, inNext.mmrByKey, {}, all12, nextYear, optsNext);
    const janSite = inNext.sites.find((x) => planNext.assignments.some((a) => a.siteId === x.id && a.month === `${nextYear}-01`)
      && !(x.outsideVisits || []).some((v) => v.month === `${year}-12`));
    assert.ok(janSite, 'un site planifié en janvier de l\'exercice suivant');
    await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, $3::date, $4, 'planifie')`,
      [T, janSite.id, `${year}-12-01`, `${TAG} voisin`]);
    const in2 = await withTenantTransaction(T, (c) => repo.loadInputsTx(c, T, { year: nextYear }));
    const s2 = in2.sites.find((x) => x.id === janSite.id);
    assert.ok(s2.outsideVisits.some((v) => v.month === `${year}-12` && v.status === 'planifie'), 'visite de décembre lue comme ancrage');
    const plan2 = generatePlan(in2.sites, in2.mmrByKey, {}, all12, nextYear, optsNext);
    assert.deepEqual(checkInvariants({ sites: in2.sites, mmrByKey: in2.mmrByKey, settings: {}, months: all12, year: nextYear, opts: optsNext }, plan2), []);
    const step = s2.parametered && s2.mmrKey && s2.required > 0
      ? mmrRule(in2.mmrByKey[s2.mmrKey] || {}, s2.required, false, s2.riskLevel).step : rbmStep(s2.riskLevel);
    const firstNext = plan2.assignments.filter((a) => a.siteId === janSite.id).map((a) => Number(a.month.slice(5, 7)))[0];
    assert.ok(firstNext == null || firstNext >= step, `1ʳᵉ visite ${firstNext} à moins de ${step} mois de décembre`);
    const after7 = await service.preview(T, nb);
    assert.notEqual(after7.sections.visites, before7.sections.visites, 'l\'empreinte « visites » couvre l\'exercice voisin');
    // « Appliquer » sur l'exercice suivant attend le verrou du mois voisin (décembre) tenu ailleurs.
    const holder = new Client({ connectionString: SU_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthLockKey(T, `${year}-12`)]);
      const t0 = Date.now();
      const pending = service.apply(T, U, { ...nb, fingerprint: after7.fingerprint, sections: after7.sections });
      await new Promise((r) => { setTimeout(r, 700); });
      await holder.query('COMMIT');
      const a7 = await pending;
      assert.ok(Date.now() - t0 >= 600, '« Appliquer » a attendu le verrou de décembre de l\'exercice voisin');
      assert.equal(a7.created, a7.planned);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      await holder.end();
    }
    await dropNew();
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, `${TAG} voisin`]);

    // 8. Une échéance pour TOUTE la phase des verrous : deux mois tenus ailleurs, 300 ms en tout.
    const h2 = new Client({ connectionString: SU_URL });
    await h2.connect();
    try {
      await h2.query('BEGIN');
      for (const m of [`${nextYear}-02`, `${nextYear}-05`]) await h2.query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthLockKey(T, m)]);
      const t1 = Date.now();
      await assert.rejects(withTenantTransaction(T, (c) => lockVisitMonthsTx(c, T, [`${nextYear}-01`, `${nextYear}-02`, `${nextYear}-05`], { deadline: Date.now() + 300 })),
        (e) => e.code === '55P03');
      assert.ok(Date.now() - t1 < 1500, `échéance commune : ${Date.now() - t1} ms`);
    } finally {
      await h2.query('ROLLBACK').catch(() => {});
      await h2.end();
    }

    // 9. Site supprimé du registre entre la relecture et l'écriture → 409 « registre », rien d'écrit.
    const [{ id: tmpSite }] = await q(
      `INSERT INTO sites (tenant_id, code, name, district, adm2, commune, adm3, activity)
       SELECT $1, $2, $3, s.district, s.adm2, s.commune, s.adm3, s.activity FROM sites s
        WHERE s.tenant_id = $1 AND s.activity IS NOT NULL AND COALESCE(s.security_situation, 0) < 99 ORDER BY s.id LIMIT 1
       RETURNING id`, [T, `TEST-PLANAUTO-${Date.now()}`, `${TAG} site`]);
    const p9 = await service.preview(T, body);
    const original = repo.lockPlanSitesTx;
    repo.lockPlanSitesTx = async (...args) => {
      await q('DELETE FROM sites WHERE id = $1', [tmpSite]);
      return original(...args);
    };
    try {
      const in9 = await withTenantTransaction(T, (c) => repo.loadInputsTx(c, T, { year }));
      const plan9 = generatePlan(in9.sites, in9.mmrByKey, {}, months, year, opts);
      assert.ok(plan9.assignments.some((a) => a.siteId === tmpSite), 'le site de test est dans le plan');
      await assert.rejects(service.apply(T, U, { ...body, fingerprint: p9.fingerprint, sections: p9.sections }),
        (e) => e.statusCode === 409 && e.details.code === 'plan_inputs_changed' && e.details.sections.includes('registre'));
      assert.equal((await newVisits()).length, 0, 'rien n\'est écrit');
    } finally {
      repo.lockPlanSitesTx = original;
      await q('DELETE FROM sites WHERE id = $1', [tmpSite]).catch(() => {});
    }

    // 10. Périmètre « bureau » à trois niveaux (Bureau › Antenne › Sous-antenne).
    await dropNew();
    const [tree3] = await q(
      `SELECT p.id AS root, g.id AS grand FROM field_offices g
         JOIN field_offices c ON c.id = g.parent_id AND c.tenant_id = g.tenant_id
         JOIN field_offices p ON p.id = c.parent_id AND p.tenant_id = g.tenant_id
        WHERE g.tenant_id = $1 AND EXISTS (SELECT 1 FROM sites s WHERE s.tenant_id = g.tenant_id AND s.field_office_id = g.id)
        ORDER BY p.id, g.id LIMIT 1`, [T]);
    assert.ok(tree3, 'données de démonstration : un bureau avec des sous-antennes qui portent des sites');
    const officesRows = await withTenantTransaction(T, (c) => repo.officesTx(c, T));
    const sqlTree = (await q(`WITH RECURSIVE ${officeTreeSql('$2').replace(/,\s*$/, '')} SELECT id FROM office_tree`, [T, tree3.root])).map((r) => r.id).sort();
    assert.deepEqual([...officeScopeIds(officesRows, tree3.root)].sort(), sqlTree, 'même sous-arbre que les tableaux de bord');
    const scopedIn = await withTenantTransaction(T, (c) => repo.loadInputsTx(c, T, { year, scope: { fieldOfficeId: tree3.root } }));
    const grandSites = new Set((await q('SELECT id FROM sites WHERE tenant_id = $1 AND field_office_id = $2', [T, tree3.grand])).map((r) => r.id));
    assert.ok(scopedIn.sites.filter((x) => grandSites.has(x.id)).every((x) => x.inScope), 'les sites de la sous-antenne sont dans le périmètre du bureau');
    const sb = { ...body, scope: { fieldOfficeId: tree3.root } };
    const p10 = await service.preview(T, sb);
    await service.apply(T, U, { ...sb, fingerprint: p10.fingerprint, sections: p10.sections });
    const made10 = await newVisits();
    assert.ok(made10.some((x) => grandSites.has(x.site_id)), 'la sous-antenne est planifiée avec son bureau');
    await service.clearPlanned(T, { year, from: Number(now.slice(5, 7)), to: 12, scope: { fieldOfficeId: tree3.root } });
    assert.ok(!(await newVisits()).some((x) => grandSites.has(x.site_id)), '« Effacer » du bureau retire aussi la sous-antenne');
    await dropNew();
    const [nat] = await q('SELECT id FROM field_offices WHERE tenant_id = $1 AND national LIMIT 1', [T]);
    if (nat) {
      const natIn = await withTenantTransaction(T, (c) => repo.loadInputsTx(c, T, { year, scope: { fieldOfficeId: nat.id } }));
      assert.equal(natIn.sites.filter((x) => x.inScope).length, natIn.sites.length, 'bureau national : tout le registre');
    }

    // 11. Dates et agents écrits en deux passages : un agent, un jour, une commune ; jamais une date passée.
    const dists = [...new Set(inputs.sites.filter((x) => !x.forbidden && x.district).map((x) => x.district))].sort();
    assert.ok(dists.length >= 2, 'au moins deux districts');
    for (const d of dists.slice(0, 2)) {
      const wb = { ...body, scope: { district: d }, settings: { writeSchedule: true } };
      const pw = await service.preview(T, wb);
      await service.apply(T, U, { ...wb, fingerprint: pw.fingerprint, sections: pw.sections });
    }
    const written = (await newVisits()).filter((x) => x.agent && x.date);
    assert.ok(written.length > 0);
    assert.ok(written.every((x) => x.date >= todayLocal), 'jamais une date passée');
    const siteById = new Map(inputs.sites.map((x) => [x.id, x]));
    const cells11 = new Map();
    for (const x of written) {
      const st = siteById.get(x.site_id);
      const unit = tpmAt(st, year, Number(x.month.slice(5, 7))).key;
      const k = `${unit}|${x.agent}|${x.date}`;
      if (!cells11.has(k)) cells11.set(k, new Set());
      cells11.get(k).add(`${String(st.district).trim().toLowerCase()}|${String(st.commune).trim().toLowerCase()}`);
    }
    const clash = [...cells11.entries()].filter(([, c]) => c.size > 1);
    assert.deepEqual(clash.slice(0, 3).map(([k, c]) => [k, [...c]]), [], 'aucun agent dans deux communes le même jour');
    await dropNew();

    // 12. Créer / modifier une visite (date, agent) attend le verrou de son mois tenu ailleurs.
    const lockMonth = `${nextYear}-03`;
    const vSite = inputs.sites.find((x) => !x.forbidden);
    const tagged = async () => q('SELECT id, agent FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, `${TAG} verrou`]);
    const h3 = new Client({ connectionString: SU_URL });
    await h3.connect();
    try {
      await h3.query('BEGIN');
      await h3.query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthLockKey(T, lockMonth)]);
      const t2 = Date.now();
      const creating = field.createVisit(T, U, { siteId: vSite.id, periodMonth: lockMonth, activity: `${TAG} verrou`, agent: 'Agent 1', visitDate: `${lockMonth}-03` });
      await new Promise((r) => { setTimeout(r, 700); });
      assert.equal((await tagged()).length, 0, 'la création attend le verrou du mois');
      await h3.query('COMMIT');
      const vid = await creating;
      assert.ok(Date.now() - t2 >= 600, `création : attente du verrou (${Date.now() - t2} ms)`);
      await h3.query('BEGIN');
      await h3.query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthLockKey(T, lockMonth)]);
      const t3 = Date.now();
      const updating = field.updateVisit(T, vid, { agent: 'Agent 2' }, U);
      await new Promise((r) => { setTimeout(r, 700); });
      assert.equal((await tagged())[0].agent, 'Agent 1', 'la modification attend le verrou du mois');
      await h3.query('COMMIT');
      assert.equal(await updating, true);
      assert.ok(Date.now() - t3 >= 600, `modification : attente du verrou (${Date.now() - t3} ms)`);
      assert.equal((await tagged())[0].agent, 'Agent 2');
      // Un autre mois n'est jamais attendu.
      await h3.query('BEGIN');
      await h3.query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthLockKey(T, `${nextYear}-04`)]);
      const t4 = Date.now();
      assert.equal(await field.updateVisit(T, vid, { agent: 'Agent 3' }, U), true);
      assert.ok(Date.now() - t4 < 600, 'le verrou d\'un autre mois ne bloque pas');
      await h3.query('COMMIT');
    } finally {
      await h3.query('ROLLBACK').catch(() => {});
      await h3.end();
    }
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, `${TAG} verrou`]);

    // 13. Jour courant : dans l'empreinte seulement quand le mois courant est dans la période.
    const dA = `${now}-01`; const dB = `${now}-02`;
    const nA = await service.preview(T, nb, { now, today: dA });
    const nB = await service.preview(T, nb, { now, today: dB });
    assert.equal(nA.fingerprint, nB.fingerprint, 'exercice suivant : le jour courant n\'entre pas dans l\'empreinte');
    const cA = await service.preview(T, body, { now, today: dA });
    const cB = await service.preview(T, body, { now, today: dB });
    assert.deepEqual(changedSections(cA.sections, cB.sections), ['parametres'], 'mois courant dans la période : le jour compte');
    // L'aperçu de l'exercice suivant fait « la veille » s'applique « le lendemain ».
    const a13 = await service.apply(T, U, { ...nb, fingerprint: nA.fingerprint, sections: nA.sections }, { now, today: dB });
    assert.equal(a13.created, a13.planned);
    await dropNew();

    // 14. Visites existantes : l'unité que la visite porte (retour 114), jamais le TPM de la zone.
    const m14 = Number(now.slice(5, 7));
    const ym14 = `${year}-${String(m14).padStart(2, '0')}`;
    const tpms = await q(
      `SELECT p.id, p.name FROM partners p JOIN partner_types pt ON pt.id = p.partner_type_id
        WHERE p.tenant_id = $1 AND pt.code = 'tpm' AND p.active ORDER BY p.name`, [T]);
    assert.ok(tpms.length >= 2, 'au moins deux TPM de démonstration');
    const in14 = await withTenantTransaction(T, (c) => repo.loadInputsTx(c, T, { year }));
    const free14 = in14.sites.filter((x) => !x.forbidden && !x.inactive && tpmAt(x, year, m14).assigned
      && !(x.visits || []).some((v) => v.month === m14) && !(x.cancelledMonths || []).includes(m14));
    assert.ok(free14.length >= 2, 'deux sites d\'une zone avec TPM, libres ce mois-ci');
    const [sA, sB] = free14;
    const other = tpms.find((p) => `id:${p.id}` !== tpmAt(sA, year, m14).key);
    const REASON = 'Écart motivé pour le test de la planification automatique (retour 114).';
    const vA = await field.createVisit(T, U, { siteId: sA.id, periodMonth: ym14, activity: `${TAG} unite`, providerId: other.id, providerReason: REASON });
    const vB = await field.createVisit(T, U, { siteId: sB.id, periodMonth: ym14, activity: `${TAG} unite` });
    const before14 = await service.preview(T, body);
    assert.equal(await field.updateVisit(T, vB, { providerId: null, providerReason: REASON }, U), true);
    const rows14 = await q('SELECT id, provider_id::text AS p, provider_source AS src, monitored_by AS mb FROM site_visits WHERE id = ANY($1::uuid[])', [[vA, vB]]);
    const byVisit = new Map(rows14.map((r) => [r.id, r]));
    assert.deepEqual([byVisit.get(vA).p, byVisit.get(vA).src, byVisit.get(vA).mb], [other.id, 'visite', 'tpm']);
    assert.deepEqual([byVisit.get(vB).p, byVisit.get(vB).src, byVisit.get(vB).mb], [null, 'visite', 'interne']);
    const p14 = await service.preview(T, body);
    assert.ok(changedSections(before14.sections, p14.sections).includes('visites'), 'TPM retiré d\'une visite : l\'aperçu est périmé');
    // Attendu, recompté en base : visites PRÉVUES de la période, par la clé « qui suit » de chaque visite.
    const offices14 = await withTenantTransaction(T, (c) => repo.officesTx(c, T));
    const siteOf = new Map(in14.sites.map((x) => [x.id, x]));
    const officeOf = new Map((await q('SELECT id, field_office_id FROM sites WHERE tenant_id = $1', [T])).map((r) => [r.id, r.field_office_id]));
    const planned14 = await q(
      `SELECT site_id, extract(month FROM period_month)::int AS m, provider_id::text AS p, monitored_by AS mb
         FROM site_visits WHERE tenant_id = $1 AND status = 'planifie' AND period_month BETWEEN $2::date AND $3::date`,
      [T, `${now}-01`, `${year}-12-01`]);
    const expected14 = new Map();
    for (const r of planned14) {
      const st = siteOf.get(r.site_id);
      const root = rootOfficeOf(offices14, officeOf.get(r.site_id) || null);
      const unit = r.p ? `id:${r.p}` : (r.mb === 'interne' ? `bureau:${root ? root.id : 'none'}` : tpmAt(st, year, r.m).key);
      expected14.set(unit, (expected14.get(unit) || 0) + 1);
    }
    const existing = new Map(p14.byTpm.map((u) => [u.unitKey, u.visits - u.planned]).filter(([, n]) => n > 0));
    assert.deepEqual([...existing.entries()].sort(), [...expected14.entries()].sort(), 'visites existantes par unité = clé « qui suit » de chaque visite');
    const rootB = rootOfficeOf(offices14, officeOf.get(sB.id) || null);
    assert.ok((existing.get(`id:${other.id}`) || 0) >= 1, 'la visite confiée à un autre TPM compte pour lui');
    assert.ok((existing.get(`bureau:${rootB ? rootB.id : 'none'}`) || 0) >= 1, 'la visite au TPM retiré compte pour l\'équipe interne');
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, `${TAG} unite`]);
  } finally {
    await dropNew().catch(() => {});
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity LIKE $2', [T, `${TAG} %`]).catch(() => {});
    if (gridAdded) await q('DELETE FROM site_month_status WHERE tenant_id = $1 AND year = $2', [T, year]).catch(() => {});
    await su.end();
    await pool.end();
  }
});
