/**
 * Retour 110 — concordance des mesures de couverture EN BASE RÉELLE, sur demande.
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré : npm test reste sans base.
 *
 * Scénario (année 2019, sans autre donnée) : une grille des sites actifs pour 30 sites (actifs
 * toute la période, actifs puis « Non », sans case = inactifs), un site en zone interdite, des
 * visites prévues / réalisées / annulées (dont sur un site inactif), des soumissions rattachées à
 * un site (fiche compatible ou non) et une soumission de commune. On vérifie :
 *  - la réponse de GET /api/dashboards/coverage (service) = le jumeau pur (common/siteActivity +
 *    coverageDefinitions) recalculé sur les lignes brutes : univers, suivis (par données, par
 *    visites), sites prévus, visites prévues, à venir, état RBM, communes ;
 *  - chaque découpage (activité, bureau, district) se somme aux tuiles ; sites prévus ≤ univers ;
 *  - la carte (GET /api/map/districts) donne la MÊME couverture (actifs, suivis, par données) ;
 *  - la Synthèse et « Couverture & performance » lisent cette même réponse (test web, ailleurs).
 * Tout ce qui est inséré est supprimé à la fin ; le site mis en zone interdite est rétabli.
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
// Pool partagé de l'API : fermé une fois, après tous les tests du fichier.
if (enabled) test.after(() => require('../src/config/db').pool.end());
const PERIOD = { from: '2019-01', to: '2019-06' };
const MONTHS = ['2019-01', '2019-02', '2019-03', '2019-04', '2019-05', '2019-06'];
const TAG = 'Test r110';

test('couverture en base : service = jumeau pur, découpages sommés aux tuiles, même couverture que la carte', { skip: SKIP, timeout: 180000 }, async () => {
  const { Client } = require('pg');
  const { siteRangeFacts, activeAt } = require('../src/modules/common/siteActivity');
  const { siteCounts, groupRows, shapeCoverage, checkConsistency } = require('../src/modules/dashboards/coverageDefinitions');
  const coverageService = require('../src/modules/dashboards/coverage.service');
  const mapService = require('../src/modules/map/map.service');
  const fieldRepo = require('../src/modules/tpm/field.repository');
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  let T = null; let forbiddenSite = null; let forbiddenBefore = null;
  const insertedGrid = [];
  try {
    [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
    const already = await q(`SELECT (SELECT count(*)::int FROM site_month_status WHERE tenant_id = $1 AND year = 2019) AS g,
                                    (SELECT count(*)::int FROM site_visits WHERE tenant_id = $1 AND period_month BETWEEN '2019-01-01' AND '2019-12-01') AS v`, [T]);
    assert.deepEqual(already[0], { g: 0, v: 0 }, 'base jetable déjà utilisée pour 2019');
    const sites = await q(`SELECT id, adm3_pcode FROM sites WHERE tenant_id = $1 AND NULLIF(btrim(adm3_pcode), '') IS NOT NULL
                            ORDER BY activity NULLS LAST, id LIMIT 30`, [T]);
    assert.equal(sites.length, 30, 'au moins 30 sites avec une commune');
    const [form] = await q("SELECT id, NULLIF(btrim(activity_category), '') AS cat FROM monitoring_forms WHERE tenant_id = $1 ORDER BY (NULLIF(btrim(activity_category), '') IS NULL) DESC, id LIMIT 1", [T]);
    assert.ok(form, 'une fiche de suivi');

    // Grille 2019 : i % 3 = 0 actif janvier-juin ; 1 actif janvier-mars puis « Non » ; 2 sans case (inactif).
    const grid = [];
    sites.forEach((s, i) => {
      if (i % 3 === 2) return;
      MONTHS.forEach((m, k) => grid.push([s.id, k + 1, i % 3 === 0 ? true : k < 3]));
    });
    for (const [siteId, month, active] of grid) {
      const r = await q(`INSERT INTO site_month_status (tenant_id, site_id, year, month, active) VALUES ($1, $2, 2019, $3, $4)
                         ON CONFLICT DO NOTHING RETURNING site_id`, [T, siteId, month, active]);
      if (r.length) insertedGrid.push([siteId, month]);
    }
    // Zone interdite : le site 3 (actif toute la période selon la grille) sort de l'univers.
    forbiddenSite = sites[3].id;
    [{ security_situation: forbiddenBefore }] = await q('SELECT security_situation FROM sites WHERE id = $1', [forbiddenSite]);
    await q('UPDATE sites SET security_situation = 99 WHERE id = $1', [forbiddenSite]);
    // Visites : prévue en février (i % 4 = 0), réalisée en mars (1), annulée en avril (2) ; sur un site inactif aussi (i = 2).
    const visitOf = { 0: ['2019-02-01', 'planifie'], 1: ['2019-03-01', 'realise'], 2: ['2019-04-01', 'annule'] };
    for (const [i, s] of sites.entries()) {
      const v = visitOf[i % 4];
      if (!v) continue;
      await q('INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, $3, $4, $5)', [T, s.id, v[0], TAG, v[1]]);
    }
    await q("INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, '2019-05-01', $3, 'planifie')", [T, sites[2].id, `${TAG} inactif`]);
    // Données : rattachées au site en février (i % 5 = 0) et en mai (i = 4 : mois « Non » du site) ; une soumission de commune.
    const subs = [];
    sites.forEach((s, i) => { if (i % 5 === 0) subs.push([s.id, null, '2019-02-01']); });
    subs.push([sites[4].id, null, '2019-05-01']);
    subs.push([null, sites[7].adm3_pcode, '2019-06-01']);
    for (const [k, [siteId, pcode, m]] of subs.entries()) {
      await q(`INSERT INTO monitoring_submissions (tenant_id, form_id, external_id, period_month, source, site_id, adm3_pcode)
               VALUES ($1, $2, $3, $4, 'csv', $5, $6)`, [T, form.id, `${TAG}-${k}`, m, siteId, pcode]);
    }

    // ---- Réponse de l'API (rôle applicatif, RLS) ------------------------------------------
    const auth = { tenantId: T, role: 'admin' };
    const cov = await coverageService.coverage(auth, { period: PERIOD });
    assert.deepEqual(checkConsistency(cov), [], 'découpages sommés aux tuiles');
    assert.ok(cov.overall.plannedSites.planned <= cov.overall.sites, 'sites prévus ≤ univers');
    assert.equal(cov.universe.activation, 'grid');
    assert.equal(cov.overall.sites, 19, '20 sites avec un « Oui », moins la zone interdite');

    // ---- Jumeau pur sur les lignes brutes -----------------------------------------------
    const reg = await q(`SELECT s.id, s.activity, s.risk_level AS risk, COALESCE(s.security_situation, 0) >= 99 AS forbidden,
                                COALESCE(fo.name, '—') AS office, s.field_office_id AS office_id,
                                lower(COALESCE(NULLIF(btrim(s.adm3_pcode), ''), NULLIF(btrim(s.adm3), ''), NULLIF(btrim(s.commune), ''), '—')) AS ckey,
                                lower(NULLIF(btrim(s.activity), '')) AS act
                           FROM sites s LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
                          WHERE s.tenant_id = $1`, [T]);
    const gridRows = await q('SELECT site_id, month, active FROM site_month_status WHERE tenant_id = $1 AND year = 2019', [T]);
    const visits = await q(`SELECT site_id, to_char(period_month, 'YYYY-MM') AS month, status FROM site_visits
                             WHERE tenant_id = $1 AND period_month >= '2019-01-01' AND period_month < '2019-07-01'`, [T]);
    const data = await q(`SELECT ms.site_id, ms.adm3_pcode, to_char(ms.period_month, 'YYYY-MM') AS month,
                                 lower(NULLIF(btrim(mf.activity_category), '')) AS cat
                            FROM monitoring_submissions ms JOIN monitoring_forms mf ON mf.id = ms.form_id
                           WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.period_month >= '2019-01-01' AND ms.period_month < '2019-07-01'`, [T]);
    const rbm = await fieldRepo.rbmSites(T, { month: PERIOD.to, asOf: PERIOD.to });
    const due = new Set(rbm.filter((r) => r.due).map((r) => r.id));
    const by = (rows, k) => rows.reduce((m, r) => m.set(r[k], [...(m.get(r[k]) || []), r]), new Map());
    const gridBy = by(gridRows, 'site_id'); const visitBy = by(visits, 'site_id');
    const compatible = (cat, act) => cat == null || act == null || cat === act;
    const twin = reg.map((s) => {
      const statuses = new Map((gridBy.get(s.id) || []).map((g) => [`2019-${String(g.month).padStart(2, '0')}`, g.active]));
      const dataMonths = data.filter((d) => d.site_id === s.id && compatible(d.cat, s.act)).map((d) => d.month);
      const site = { statuses, gridYears: [2019], forbidden: s.forbidden, visits: visitBy.get(s.id) || [], dataMonths };
      const f = siteRangeFacts(site, PERIOD, { todayMonth: new Date().toISOString().slice(0, 7) });
      const activeRef = activeAt(statuses, PERIOD.to, site);
      return { ...s, f, counts: siteCounts({ ...f, forbidden: s.forbidden, activeRef, due: due.has(s.id), risk: s.risk }) };
    });
    const expected = shapeCoverage(groupRows(twin.map((s) => ({ counts: s.counts, activity: s.activity, office: s.office, district: '—' }))), { refMonth: PERIOD.to });
    assert.deepEqual(cov.overall, expected.overall, 'tuiles = jumeau pur');
    assert.deepEqual(cov.byActivity.map((a) => [a.key, a.sites, a.coverage, a.plannedSites, a.execution, a.rbm]),
      expected.byActivity.map((a) => [a.key, a.sites, a.coverage, a.plannedSites, a.execution, a.rbm]), 'par activité = jumeau pur');
    assert.deepEqual(cov.byOffice.map((a) => [a.key, a.sites, a.coverage.covered]), expected.byOffice.map((a) => [a.key, a.sites, a.coverage.covered]));
    assert.deepEqual([cov.universe.registry, cov.universe.forbidden, cov.universe.inactive],
      [expected.universe.registry, expected.universe.forbidden, expected.universe.inactive]);
    // Communes de l'univers → communes avec des données (rattachées, ou de commune avec une fiche compatible).
    const u = twin.filter((s) => s.f.active);
    const communes = new Set(u.map((s) => s.ckey).filter((k) => k !== '—'));
    const withData = new Set(u.filter((s) => s.ckey !== '—' && (s.f.realisedData
      || data.some((d) => !d.site_id && d.adm3_pcode && d.adm3_pcode.trim().toLowerCase() === s.ckey && compatible(d.cat, s.act)))).map((s) => s.ckey));
    assert.deepEqual([cov.communes.total, cov.communes.withData], [communes.size, withData.size]);
    assert.ok(cov.communes.withData >= 1, 'la soumission de commune compte');
    // Scénario : la donnée d'un mois « Non » (site 4, mai) n'est jamais un suivi ; la visite d'un site inactif non plus.
    assert.equal(twin.find((s) => s.id === sites[4].id).f.realisedData, false, 'site 4 : données en mai, mois « Non » : jamais un suivi');
    assert.equal(twin.find((s) => s.id === sites[0].id).f.realisedData, true, 'site 0 : données en février, mois actif');
    assert.equal(cov.overall.execution.planned, expected.overall.execution.planned);
    // Scénario compté à la main (fiche sans catégorie : compatible avec toute activité) — univers : i % 3 ∈ {0, 1}
    // sauf le site 3 ; suivis = visites déclarées en mars (1, 9, 13, 21, 25) ∪ données de février (0, 10, 15, 25).
    if (!form.cat) {
      const o = cov.overall;
      assert.deepEqual([o.coverage.covered, o.coverage.byData, o.coverage.byVisit, o.coverage.both], [8, 4, 5, 1]);
      assert.deepEqual([o.execution.planned, o.execution.covered, o.execution.byData, o.execution.byVisit], [11, 6, 1, 5]);
      assert.deepEqual([o.plannedSites.planned, o.plannedSites.covered], [11, 6]);
      assert.equal(o.rbm.sites, 9, 'actifs en juin : i % 3 = 0, sans la zone interdite');
      // Jamais comptés, dits à part : activité pendant un mois non actif (4 : données de mai « Non » ; 5, 17, 29 :
      // visites de mars sans case ; 20 : données de février sans case), visites annulées d'un mois actif (6, 18).
      assert.equal(o.outside, 5);
      assert.equal(o.execution.cancelled, 2);
    }

    // ---- « Sans bureau » (filtre du concepteur, section répétée par bureau) : sites sans bureau ----
    // Avant la correction : 42P01 « relation office_tree does not exist » (cdat filtrait par sous-arbre).
    const unl = await coverageService.coverage(auth, { period: PERIOD, officeId: 'unlinked' });
    assert.deepEqual(checkConsistency(unl), [], 'sans bureau : découpages sommés aux tuiles');
    const twinUnl = twin.filter((s) => s.office_id == null);
    const expUnl = shapeCoverage(groupRows(twinUnl.map((s) => ({ counts: s.counts, activity: s.activity, office: s.office, district: '—' }))), { refMonth: PERIOD.to });
    assert.deepEqual(unl.overall, expUnl.overall, 'sans bureau : tuiles = jumeau pur sur les sites sans bureau');
    assert.equal(unl.universe.registry, twinUnl.length, 'sans bureau : registre = sites sans bureau');

    // ---- La carte : même couverture ---------------------------------------------------------
    const map = await mapService.districts(auth, { period: PERIOD });
    assert.equal(map.totals.counts.active, cov.overall.sites, 'carte : sites actifs = univers');
    assert.equal(map.totals.counts.realised, cov.overall.coverage.covered, 'carte : suivis = couverture');
    assert.equal(map.totals.counts.realisedData, cov.overall.coverage.byData, 'carte : suivis par données');
  } finally {
    if (T) {
      await q('DELETE FROM monitoring_submissions WHERE tenant_id = $1 AND external_id LIKE $2', [T, `${TAG}-%`]);
      await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity LIKE $2', [T, `${TAG}%`]);
      for (const [siteId, month] of insertedGrid) {
        await q('DELETE FROM site_month_status WHERE tenant_id = $1 AND site_id = $2 AND year = 2019 AND month = $3', [T, siteId, month]);
      }
      if (forbiddenSite) await q('UPDATE sites SET security_situation = $2 WHERE id = $1', [forbiddenSite, forbiddenBefore]);
    }
    await su.end();
  }
});

test('visites à venir en base : « case vide » = ni « Oui » ni « Non » (année avec grille, hors zone interdite) — SQL = jumeau pur', { skip: SKIP, timeout: 120000 }, async () => {
  const { Client } = require('pg');
  const { siteRangeFacts } = require('../src/modules/common/siteActivity');
  const coverageService = require('../src/modules/dashboards/coverage.service');
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  const FUT = { from: '2099-01', to: '2099-03' };
  const TAGF = 'Test r110 futur';
  let T = null; let forbiddenSite = null; let forbiddenBefore = null;
  try {
    [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
    const already = await q(`SELECT (SELECT count(*)::int FROM site_month_status WHERE tenant_id = $1 AND year = 2099) AS g,
                                    (SELECT count(*)::int FROM site_visits WHERE tenant_id = $1 AND period_month >= '2099-01-01') AS v`, [T]);
    assert.deepEqual(already[0], { g: 0, v: 0 }, 'base jetable déjà utilisée pour 2099');
    const sites = await q(`SELECT id FROM sites WHERE tenant_id = $1 AND COALESCE(security_situation, 0) < 99 ORDER BY id LIMIT 5`, [T]);
    assert.equal(sites.length, 5);
    // Grille 2099 : 0 « Oui » janvier-mars ; 1 « Non » janvier-mars ; 2 sans case ; 3 sans case, zone interdite ;
    // 4 « Oui » en janvier, « Non » en février, rien en mars.
    const cells = [[0, 1, true], [0, 2, true], [0, 3, true], [1, 1, false], [1, 2, false], [1, 3, false], [4, 1, true], [4, 2, false]];
    for (const [i, month, active] of cells) {
      await q('INSERT INTO site_month_status (tenant_id, site_id, year, month, active) VALUES ($1, $2, 2099, $3, $4)', [T, sites[i].id, month, active]);
    }
    forbiddenSite = sites[3].id;
    [{ security_situation: forbiddenBefore }] = await q('SELECT security_situation FROM sites WHERE id = $1', [forbiddenSite]);
    await q('UPDATE sites SET security_situation = 99 WHERE id = $1', [forbiddenSite]);
    // Visites prévues : février pour chacun ; janvier et mars pour le site 4.
    const visits = [[0, '2099-02-01'], [1, '2099-02-01'], [2, '2099-02-01'], [3, '2099-02-01'], [4, '2099-01-01'], [4, '2099-02-01'], [4, '2099-03-01']];
    for (const [i, m] of visits) {
      await q("INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, $3, $4, 'planifie')", [T, sites[i].id, m, TAGF]);
    }
    const cov = await coverageService.coverage({ tenantId: T, role: 'admin' }, { period: FUT });
    // À venir (mois « Oui ») : site 0 février, site 4 janvier. Cases vides : site 2 février, site 4 mars.
    // Jamais comptés : site 1 (« Non »), site 3 (zone interdite), site 4 février (« Non ») — l'ancienne règle en comptait 5.
    assert.deepEqual([cov.overall.execution.upcoming, cov.overall.execution.upcomingUnset], [2, 2]);
    // Jumeau pur sur les lignes brutes de ces sites (les autres sites n'ont aucune visite en 2099).
    const grid = await q('SELECT site_id, month, active FROM site_month_status WHERE tenant_id = $1 AND year = 2099', [T]);
    const vis = await q("SELECT site_id, to_char(period_month, 'YYYY-MM') AS month, status FROM site_visits WHERE tenant_id = $1 AND period_month >= '2099-01-01'", [T]);
    let up = 0; let unset = 0;
    for (const [i, s] of sites.entries()) {
      const statuses = new Map(grid.filter((g) => g.site_id === s.id).map((g) => [`2099-${String(g.month).padStart(2, '0')}`, g.active]));
      const f = siteRangeFacts({ statuses, gridYears: [2099], forbidden: i === 3, visits: vis.filter((v) => v.site_id === s.id) }, FUT, { todayMonth: new Date().toISOString().slice(0, 7) });
      if (f.active) up += f.vUpcoming;
      unset += f.vUpcomingUnset;
    }
    assert.deepEqual([up, unset], [cov.overall.execution.upcoming, cov.overall.execution.upcomingUnset], 'SQL = jumeau pur');
  } finally {
    if (T) {
      await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, TAGF]);
      await q('DELETE FROM site_month_status WHERE tenant_id = $1 AND year = 2099', [T]);
      if (forbiddenSite) await q('UPDATE sites SET security_situation = $2 WHERE id = $1', [forbiddenSite, forbiddenBefore]);
    }
    await su.end();
  }
});
