/**
 * Retour 102 — les filtres du CONCEPTEUR DE RAPPORT prouvés PAR LES CHIFFRES, en base réelle, sur
 * demande (même mécanisme que coverageDb.test.js) :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test ») ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré : npm test reste sans base.
 *
 * Scénario (année 2018, sans autre donnée) : un bureau X, son antenne Y, la sous-antenne Z de Y ;
 * trois sites (s1 sur X, s2 sur Y, s3 sur Z ; activités A, A, B ; districts Alpha, Beta, Beta), une
 * visite réalisée par site (janvier, mars, juin ; prestataires P1, P2, P1), trois soumissions (janvier
 * sur Z par P1 en district Beta, mars sur Y par P2 en district Alpha, juin sur X par P1). Chaque filtre
 * passe par le rendu RÉEL d'un rapport (reports.service.renderReport : plan, catalogue, sources) :
 *  - période : plage janvier–juin ≠ janvier ≠ janvier + juin (mois cochés) ;
 *  - bureau : X compte Y ET Z (sous-arbre complet), Y compte Z, Z seul ;
 *  - activité (posée sur UN bloc) : A → s1 et s2 ; les autres blocs ne bougent pas ;
 *  - prestataire (TPM) : visites et soumissions de P1 ≠ P2 ;
 *  - district : Beta → s2 et s3, une soumission ; Alpha → s1, une soumission.
 * Tout ce qui est inséré est supprimé à la fin.
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
const TAG = 'Test r102';
const H1 = { from: '2018-01', to: '2018-06' };

test('filtres du concepteur en base : période (plage, mois cochés), bureau et sous-antennes, activité d\'un bloc, TPM, district', { skip: SKIP, timeout: 240000 }, async () => {
  const { Client } = require('pg');
  const service = require('../src/modules/reports/reports.service');
  const { pool } = require('../src/config/db');
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  let T = null;
  const ids = { offices: [], sites: [] };
  try {
    [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
    const busy = await q(`SELECT (SELECT count(*)::int FROM site_visits WHERE tenant_id = $1 AND period_month BETWEEN '2018-01-01' AND '2018-12-01') AS v,
                                 (SELECT count(*)::int FROM monitoring_submissions WHERE tenant_id = $1 AND period_month BETWEEN '2018-01-01' AND '2018-12-31') AS s,
                                 (SELECT count(*)::int FROM site_month_status WHERE tenant_id = $1 AND year = 2018) AS g`, [T]);
    assert.deepEqual(busy[0], { v: 0, s: 0, g: 0 }, 'base jetable déjà utilisée pour 2018');
    const partners = await q('SELECT id, name FROM partners WHERE tenant_id = $1 ORDER BY name LIMIT 2', [T]);
    assert.equal(partners.length, 2, 'deux partenaires');
    const [P1, P2] = partners.map((p) => p.id);
    const [form] = await q('SELECT id FROM monitoring_forms WHERE tenant_id = $1 ORDER BY id LIMIT 1', [T]);
    assert.ok(form, 'une fiche de suivi');

    // Bureaux : X → Y → Z (sous-antenne).
    const office = async (code, name, parent) => {
      const [r] = await q('INSERT INTO field_offices (tenant_id, code, name, parent_id) VALUES ($1, $2, $3, $4) RETURNING id', [T, code, name, parent]);
      ids.offices.push(r.id);
      return r.id;
    };
    const X = await office('T102-X', `${TAG} bureau X`, null);
    const Y = await office('T102-Y', `${TAG} antenne Y`, X);
    const Z = await office('T102-Z', `${TAG} sous-antenne Z`, Y);
    const site = async (code, officeId, activity, district) => {
      const [r] = await q(`INSERT INTO sites (tenant_id, code, name, activity, district, commune, field_office_id)
                           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [T, code, `${TAG} ${code}`, activity, district, `${TAG} commune`, officeId]);
      ids.sites.push(r.id);
      return r.id;
    };
    const ACT_A = `${TAG} activité A`; const ACT_B = `${TAG} activité B`;
    const ALPHA = `${TAG} Alpha`; const BETA = `${TAG} Beta`;
    const s1 = await site('T102-S1', X, ACT_A, ALPHA);
    const s2 = await site('T102-S2', Y, ACT_A, BETA);
    const s3 = await site('T102-S3', Z, ACT_B, BETA);
    // Une visite réalisée par site, chacune avec son prestataire (TPM).
    for (const [s, m, p] of [[s1, '2018-01-01', P1], [s2, '2018-03-01', P2], [s3, '2018-06-01', P1]]) {
      await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_id, provider_source, provider_reason)
               VALUES ($1, $2, $3, $4, 'realise', $5, 'visite', $6)`, [T, s, m, TAG, p, `${TAG} — prestataire du scénario`]);
    }
    for (const [i, m, off, p, adm2] of [[1, '2018-01-01', Z, P1, BETA], [2, '2018-03-01', Y, P2, ALPHA], [3, '2018-06-01', X, P1, null]]) {
      await q(`INSERT INTO monitoring_submissions (tenant_id, form_id, external_id, period_month, source, field_office_id, partner_id, admin2)
               VALUES ($1, $2, $3, $4, 'csv', $5, $6, $7)`, [T, form.id, `${TAG}-${i}`, m, off, p, adm2]);
    }

    // ---- Rendu RÉEL d'un rapport (plan, catalogue, sources), un bloc par mesure -------------------
    const render = async ({ period = H1, filters = {}, kpiFilters = {} } = {}) => {
      const doc = {
        schemaVersion: 2, title: TAG, period, filters,
        blocks: [
          { id: 'k', type: 'kpis', params: { metrics: ['sites_active', 'sites_realised', 'submissions'] } },
          { id: 'c', type: 'data', params: { dataset: 'cov.kpis', view: 'table', filters: kpiFilters } },
          { id: 'p', type: 'data', params: { dataset: 'cov.visits_by_provider', view: 'table' } },
        ],
      };
      const r = await service.renderReport(T, doc, { lang: 'fr' });
      for (const b of Object.values(r.blocks)) assert.equal(b.ok, true, JSON.stringify(b.error || {}));
      const k = r.blocks.k.data.values;
      const c = r.blocks.c.data.rows[0] || {};
      const prov = Object.fromEntries(r.blocks.p.data.rows.map((x) => [x._key, x.realise]));
      return { sites: k.sites_active, suivis: k.sites_realised, subs: k.submissions, blockSites: c.sitesActive, blockSuivis: c.sitesRealised, blockNote: r.blocks.c.data.meta.note, prov, label: r.periodLabel };
    };
    const office$ = (id) => ({ office: `id:${id}` });

    // ---- Bureau : le bureau et TOUTES ses antennes (retour 78) -----------------------------------
    const x = await render({ filters: office$(X) });
    const y = await render({ filters: office$(Y) });
    const z = await render({ filters: office$(Z) });
    assert.deepEqual([x.sites, x.suivis, x.subs], [3, 3, 3], 'X compte Y et la sous-antenne Z');
    assert.deepEqual([y.sites, y.suivis, y.subs], [2, 2, 2], 'Y compte Z');
    assert.deepEqual([z.sites, z.suivis, z.subs], [1, 1, 1], 'Z seul');
    const all = await render();
    assert.ok(all.sites > x.sites, 'tous les bureaux ≠ bureau X');

    // ---- Période : plage, un mois, mois cochés (retour 68) ---------------------------------------
    const jan = await render({ period: { from: '2018-01', to: '2018-01' }, filters: office$(X) });
    const janJun = await render({ period: { from: '2018-01', to: '2018-06', months: ['2018-01', '2018-06'] }, filters: office$(X) });
    assert.deepEqual([jan.suivis, jan.subs], [1, 1], 'janvier : s1, une soumission');
    assert.deepEqual([x.suivis, x.subs], [3, 3], 'janvier–juin : trois');
    assert.deepEqual([janJun.suivis, janJun.subs], [2, 2], 'janvier + juin (mois cochés) : s1 et s3, deux soumissions — ni la plage, ni janvier');
    assert.equal(janJun.label, 'Janvier et juin 2018');
    const mar = await render({ period: { from: '2018-01', to: '2018-06', months: ['2018-03'] }, filters: office$(X) });
    assert.deepEqual([mar.suivis, mar.subs, mar.label], [1, 1, 'Mars 2018'], 'un seul mois coché = ce mois');

    // ---- Activité posée sur UN bloc : ce bloc seulement ------------------------------------------
    const a = await render({ filters: office$(X), kpiFilters: { activity: ACT_A } });
    assert.deepEqual([a.blockSites, a.blockSuivis], [2, 2], 'activité A : s1 et s2');
    assert.equal(a.sites, 3, 'les chiffres clés du rapport ne bougent pas');
    const b = await render({ filters: office$(X), kpiFilters: { activity: ACT_B.toUpperCase() } });
    assert.deepEqual([b.blockSites, b.blockSuivis], [1, 1], 'activité B (casse ignorée) : s3');

    // ---- Prestataire (TPM) ----------------------------------------------------------------------
    assert.deepEqual(x.prov, { [P1]: 2, [P2]: 1 }, 'visites réalisées par prestataire');
    const p1 = await render({ filters: { ...office$(X), partnerId: P1 } });
    const p2 = await render({ filters: { ...office$(X), partnerId: P2 } });
    assert.deepEqual(p1.prov, { [P1]: 2 });
    assert.deepEqual(p2.prov, { [P2]: 1 });
    assert.deepEqual([p1.subs, p2.subs], [2, 1], 'soumissions de P1 (janvier, juin) et de P2 (mars)');

    // ---- District (retour 102) ------------------------------------------------------------------
    const beta = await render({ filters: { ...office$(X), district: BETA } });
    const alpha = await render({ filters: { ...office$(X), district: ALPHA.toLowerCase() } });
    assert.deepEqual([beta.sites, beta.suivis, beta.subs], [2, 2, 1], 'Beta : s2 et s3, la soumission de janvier');
    assert.deepEqual([alpha.sites, alpha.suivis, alpha.subs], [1, 1, 1], 'Alpha (casse ignorée) : s1, la soumission de mars');
    // Activité ET district sur une couverture : une note, jamais un total faux.
    const both = await render({ filters: { ...office$(X), district: BETA }, kpiFilters: { activity: ACT_A } });
    assert.match(both.blockNote, /activité ET un district/);
  } finally {
    if (T) {
      await q('DELETE FROM monitoring_submissions WHERE tenant_id = $1 AND external_id LIKE $2', [T, `${TAG}-%`]);
      await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, TAG]);
      if (ids.sites.length) await q('DELETE FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [T, ids.sites]);
      for (const id of [...ids.offices].reverse()) await q('DELETE FROM field_offices WHERE tenant_id = $1 AND id = $2', [T, id]);
    }
    await su.end();
    await pool.end();
  }
});
