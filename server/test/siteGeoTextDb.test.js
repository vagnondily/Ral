/**
 * Géographie d'un site EN BASE RÉELLE (relecture « verrous », point 1), sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré.
 *
 * Par les chemins de l'application (Localités, Registre des sites) :
 *   1. le district « Ambovombe-Androy » reçoit un P-code ;
 *   2. un site de Tsihombe y est déplacé (le pipeline lui pose ce P-code) ;
 *   3. il est corrigé vers Tsihombe.
 * Avant la correction, le site gardait le P-code d'Ambovombe-Androy (COALESCE : « jamais remplacé ») ;
 * seul vote d'accord pour la graphie « tsihombe » (siteActivitySql.sdvote), il rangeait les 103 sites de
 * Tsihombe dans Ambovombe-Androy, et la ré-estampille perdait la modification « Tsihombe → YPA ».
 * Avec un P-code formé (MG…), il gagnait même la résolution du site. Dans un découpage entièrement
 * codé, le déplacement voulu (étape 2) était ignoré.
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
test.after(async () => { if (enabled) await require('../src/config/db').pool.end(); });

test('site déplacé puis corrigé : jamais le P-code de son ancien district ; Tsihombe reste Tsihombe, sa modification de TPM tient ; le déplacement voulu est suivi',
  { skip: SKIP, timeout: 300000 }, async () => {
    const { Client } = require('pg');
    require('../src/jobs/outbox').nudgeOutbox = async () => {};
    const loc = require('../src/modules/settings/localities.repository');
    const sitesAdmin = require('../src/modules/settings/sitesAdmin.repository');
    const places = require('../src/modules/settings/placeMatch.repository');
    const field = require('../src/modules/tpm/field.repository');
    const attribution = require('../src/modules/tpm/tpmAttribution.service');
    const { siteDistrictCtes } = require('../src/modules/common/siteActivitySql');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const su = new Client({ connectionString: SU_URL });
    await su.connect();
    const q = async (sql, params) => (await su.query(sql, params)).rows;
    const REASON = 'Test géographie des sites : YPA suit Tsihombe ce mois-ci.';
    const made = { visit: null, override: false, pcodes: null, sites: null, s0: null };
    let T; let D;
    try {
      [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
      const [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY email LIMIT 1", [T]);
      const districts = await q(`SELECT d.id, d.name, d.pcode FROM admin_areas d JOIN admin_areas r ON r.id = d.lineage[1]
                                  WHERE d.tenant_id = $1 AND d.depth = 2 AND r.name = 'Androy' ORDER BY d.name`, [T]);
      D = Object.fromEntries(districts.map((d) => [d.name, d]));
      const AMB = D['Ambovombe-Androy']; const TSI = D.Tsihombe;
      assert.ok(AMB && TSI, 'districts Ambovombe-Androy et Tsihombe (base peuplée)');
      // État d'origine à rétablir (base partagée par les tests en série) : P-codes des districts et géographie dérivée des sites.
      made.pcodes = districts.map((d) => ({ id: d.id, pcode: d.pcode }));
      made.sites = await q(`SELECT id, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode, admin_area_id, geo_status FROM sites WHERE tenant_id = $1`, [T]);
      const tsi = await q("SELECT id FROM sites WHERE tenant_id = $1 AND adm1 = 'Androy' AND COALESCE(adm2, district) = 'Tsihombe' ORDER BY name, id", [T]);
      assert.ok(tsi.length >= 3, 'sites de Tsihombe');
      const S0 = tsi[Math.floor(tsi.length / 2)].id; const S1 = tsi.find((s) => s.id !== S0).id;
      made.s0 = S0;
      const M = currentMonth();
      await places.withSubmissionLinks(T, (c) => places.afterSitesChangedTx(c, T));
      // Modification motivée « Tsihombe → YPA » ce mois, puis une visite prévue sur UN AUTRE site de Tsihombe.
      const [YPA] = await q("SELECT id FROM partners WHERE tenant_id = $1 AND name = 'YPA'", [T]);
      const target = { areaIds: [TSI.id], regionIds: [], from: M, to: M };
      const pv = await attribution.preview(T, { target, mode: 'modifier', providerId: YPA.id, reason: REASON });
      await attribution.setOverrides(T, { userId: U }, { target, providerId: YPA.id, reason: REASON, stamp: pv.stamp });
      made.override = true;
      made.visit = await field.createVisit(T, U, { siteId: S1, periodMonth: M, activity: 'test-geo-texte' });

      const site = async (id) => (await q(`SELECT s.adm2, s.adm2_pcode, s.admin_area_id, s.zone_district_id, s.geo_status, a.lineage
                                            FROM sites s LEFT JOIN admin_areas a ON a.id = s.admin_area_id WHERE s.id = $1`, [id]))[0];
      const inDistrict = (s, d) => s.admin_area_id === d.id || (s.lineage || []).includes(d.id);
      const tsihombeState = async () => {
        const zones = await q(`SELECT zone_district_id AS z, count(*)::int AS n FROM sites
                                WHERE tenant_id = $1 AND adm1 = 'Androy' AND COALESCE(adm2, district) = 'Tsihombe' GROUP BY 1`, [T]);
        const shown = await q(`WITH ${siteDistrictCtes()} SELECT sd.dname, count(*)::int AS n FROM sdist sd JOIN sites s ON s.id = sd.site_id
                                WHERE s.adm1 = 'Androy' AND COALESCE(s.adm2, s.district) = 'Tsihombe' GROUP BY 1`, [T]);
        const [v] = await q(`SELECT v.provider_id, v.monitored_by, v.provider_zone_state FROM site_visits v WHERE v.id = $1`, [made.visit]);
        return { zones, shown, visit: v };
      };
      const assertTsihombeKept = async (label) => {
        const st = await tsihombeState();
        assert.deepEqual(st.zones, [{ z: TSI.id, n: tsi.length }], `${label} : tous les sites de Tsihombe gardent la zone Tsihombe`);
        assert.deepEqual(st.shown.map((r) => r.dname), ['Tsihombe'], `${label} : les tableaux de bord les montrent sous Tsihombe`);
        assert.deepEqual([st.visit.provider_id, st.visit.monitored_by, st.visit.provider_zone_state], [YPA.id, 'tpm', 'modifie'],
          `${label} : la modification « Tsihombe → YPA » garde son TPM`);
      };
      await assertTsihombeKept('départ');

      // Découpage partiellement codé, P-code non formé puis formé.
      for (const code of ['TEST-AMBA', 'ZZ25101']) {
        await loc.updateArea(T, AMB.id, { pcode: code });
        await sitesAdmin.updateSite(T, S0, { district: AMB.name });
        let s = await site(S0);
        assert.deepEqual([s.adm2_pcode, inDistrict(s, AMB), s.zone_district_id], [code, true, AMB.id], `${code} : le site déplacé prend Ambovombe-Androy`);
        await sitesAdmin.updateSite(T, S0, { district: 'Tsihombe' });
        s = await site(S0);
        assert.equal(s.adm2_pcode, null, `${code} : le site corrigé ne garde pas le P-code d'Ambovombe-Androy`);
        assert.deepEqual([inDistrict(s, TSI), s.zone_district_id], [true, TSI.id], `${code} : le site corrigé est à Tsihombe (rattachement et zone)`);
        assert.notEqual(s.geo_status, 'code', `${code} : rattaché par son nom, plus par l'ancien code`);
        await assertTsihombeKept(`${code}, après correction`);
        await loc.updateArea(T, AMB.id, { pcode: null });
      }

      // Découpage ENTIÈREMENT codé : le déplacement voulu est suivi (avant : ignoré, le code du site primait).
      const codeOf = new Map(districts.map((d, i) => [d.id, `ZZ2510${i + 1}`]));
      for (const d of districts) await loc.updateArea(T, d.id, { pcode: codeOf.get(d.id) });
      let s = await site(S0);
      assert.equal(s.adm2_pcode, codeOf.get(TSI.id), 'découpage codé : chaque site reçoit le code de son district');
      await sitesAdmin.updateSite(T, S0, { district: AMB.name });
      s = await site(S0);
      assert.deepEqual([s.adm2_pcode, inDistrict(s, AMB), s.zone_district_id], [codeOf.get(AMB.id), true, AMB.id],
        'déplacement voulu (Tsihombe → Ambovombe-Androy) : code, rattachement et zone du nouveau district');
      const others = await q(`SELECT count(*)::int AS n FROM sites WHERE tenant_id = $1 AND adm1 = 'Androy' AND COALESCE(adm2, district) = 'Tsihombe'
                                AND zone_district_id = $2`, [T, TSI.id]);
      assert.equal(others[0].n, tsi.length - 1, 'les autres sites de Tsihombe ne bougent pas');
      await sitesAdmin.updateSite(T, S0, { district: 'Tsihombe' });
      s = await site(S0);
      assert.deepEqual([s.adm2_pcode, inDistrict(s, TSI), s.zone_district_id], [codeOf.get(TSI.id), true, TSI.id], 'et retour à Tsihombe');
      await assertTsihombeKept('découpage codé, après retour');
      // Le P-code de COMMUNE (clé des données reçues, importé du Master Data) n'est jamais réécrit par ces passages.
      const p3 = new Map((await q('SELECT id, adm3_pcode FROM sites WHERE tenant_id = $1', [T])).map((r) => [r.id, r.adm3_pcode]));
      assert.deepEqual(made.sites.filter((r) => p3.get(r.id) !== r.adm3_pcode).map((r) => r.id), [], 'aucun adm3_pcode modifié');
    } finally {
      // Base jetable partagée : on rétablit ce que le test a changé (le journal, inaltérable, garde ses lignes).
      if (made.visit) await q('DELETE FROM site_visits WHERE id = $1', [made.visit]);
      if (made.override) await q('DELETE FROM tpm_zone_overrides WHERE tenant_id = $1 AND reason = $2', [T, REASON]);
      if (made.s0) await q("UPDATE sites SET adm2 = 'Tsihombe', district = 'Tsihombe' WHERE id = $1", [made.s0]);
      for (const d of made.pcodes || []) await q('UPDATE admin_areas SET pcode = $2 WHERE id = $1', [d.id, d.pcode]);
      if (made.sites) {
        await q(`UPDATE sites s SET adm1_pcode = v.adm1_pcode, adm2_pcode = v.adm2_pcode, adm3_pcode = v.adm3_pcode, adm4_pcode = v.adm4_pcode,
                        admin_area_id = v.admin_area_id, geo_status = v.geo_status
                   FROM jsonb_to_recordset($2::jsonb) AS v(id uuid, adm1_pcode text, adm2_pcode text, adm3_pcode text, adm4_pcode text,
                        admin_area_id uuid, geo_status text)
                  WHERE s.tenant_id = $1 AND s.id = v.id`, [T, JSON.stringify(made.sites)]);
      }
      if (T) await places.withSubmissionLinks(T, (c) => places.afterSitesChangedTx(c, T));
      await su.end();
    }
  });
