/**
 * Relecture croisée, point 20 — EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré.
 *
 * Une facture PLURI-MENSUELLE soumise (M0 → M1) protège les visites prévues de son TPM sur CHACUN de ses
 * mois (INVOICED_SQL, mems_tpm_stamp migration 108) : déclarer le TPM indisponible, changer son rôle, et
 * « Effacer les planifications » ne touchent ni la visite de M0 ni celle de M1 ; la visite témoin de M2
 * (hors facture) change, elle — preuve que chaque écriture a bien agi.
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
const addMonth = (m, n) => {
  const [y, mm] = m.split('-').map(Number);
  const i = y * 12 + (mm - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

test('facture pluri-mensuelle : indisponibilité, changement de rôle et effacement du plan épargnent les visites de CHACUN de ses mois',
  { skip: SKIP, timeout: 180000 }, async () => {
    const { Client } = require('pg');
    const { pool, withTenantTransaction } = require('../src/config/db');
    const tpm = require('../src/modules/tpm/tpmAttribution.repository');
    const unavailability = require('../src/modules/tpm/tpmUnavailability.service');
    const planAuto = require('../src/modules/tpm/planAuto.service');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const su = new Client({ connectionString: SU_URL });
    await su.connect();
    const q = async (sql, params) => (await su.query(sql, params)).rows;
    const made = { visits: [], report: null, provider: null, typeBack: null };
    try {
      const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
      const [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY email LIMIT 1", [T]);
      const types = Object.fromEntries((await q('SELECT code, id FROM partner_types WHERE tenant_id = $1', [T])).map((r) => [r.code, r.id]));
      const M0 = currentMonth(); const M1 = addMonth(M0, 1); const M2 = addMonth(M0, 2);
      // Un site dont la zone a le MÊME TPM de contrat les trois mois.
      const sites = await q("SELECT id, district FROM sites WHERE tenant_id = $1 AND zone_district_id IS NOT NULL AND district IS NOT NULL ORDER BY id LIMIT 600", [T]);
      const cells = await q('SELECT c_site_id AS s, to_char(c_month, \'YYYY-MM\') AS m, c_state AS st, c_provider_id AS p, c_contract_id AS k FROM mems_tpm_cells($1, $2::uuid[], $3::date[])',
        [T, [M0, M1, M2].flatMap(() => sites.map((x) => x.id)), [M0, M1, M2].flatMap((m) => sites.map(() => `${m}-01`))]);
      const by = new Map();
      for (const c of cells) { if (!by.has(c.s)) by.set(c.s, []); by.get(c.s).push(c); }
      const site = sites.find((x) => {
        const cs = by.get(x.id) || [];
        return cs.length === 3 && cs.every((c) => c.st === 'contrat' && c.p && c.p === cs[0].p && c.k === cs[0].k);
      });
      assert.ok(site, 'un site suivi par le même TPM de contrat trois mois de suite (npm run seed:test)');
      const Y = by.get(site.id)[0].p; const K = by.get(site.id)[0].k;
      made.provider = Y;

      // Visites prévues « zone » de M0, M1 (couvertes par la facture) et M2 (témoin), estampillées au COMMIT.
      const { rows: ins } = await su.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source)
         SELECT $1, $2, m::date, 'Test point 20 ' || to_char(m::date, 'YYYY-MM'), 'planifie', 'zone' FROM unnest($3::text[]) AS m RETURNING id, period_month`,
        [T, site.id, [`${M0}-01`, `${M1}-01`, `${M2}-01`]]);
      made.visits = ins.map((r) => r.id);
      const read = async () => Object.fromEntries((await q(
        `SELECT to_char(period_month, 'YYYY-MM') AS m, provider_id AS p, provider_zone_state AS st FROM site_visits WHERE id = ANY ($1::uuid[])`,
        [made.visits])).map((r) => [r.m, [r.st, r.p]]));
      assert.deepEqual(await read(), { [M0]: ['contrat', Y], [M1]: ['contrat', Y], [M2]: ['contrat', Y] });

      // Facture pluri-mensuelle soumise de Y sur K, de M0 à M1.
      const [{ id: F }] = await q(
        `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, period_end, kind, reported_amount, status, created_by, submitted_by, submitted_at, edited_by, edited_at)
         VALUES ($1, $2, $3, $4, $5, 'financier', 0, 'soumis', $6, $6, now(), $6, now()) RETURNING id`, [T, Y, K, `${M0}-01`, `${M1}-01`, U]);
      made.report = F;

      // (a) Indisponibilité de Y en M1 et M2 : M1 (facturé) garde Y ; M2 passe en suivi interne.
      const REASON = 'Indisponibilité de test (point 20)';
      const prev = await unavailability.preview(T, { providerId: Y, from: M1, to: M2, mode: 'poser', reason: REASON });
      await unavailability.setUnavailable(T, { userId: U, role: 'admin' }, { providerId: Y, from: M1, to: M2, reason: REASON, stamp: prev.stamp });
      let v = await read();
      assert.deepEqual(v[M1], ['contrat', Y], 'M1 couvert par la facture : jamais ré-estampillé');
      assert.deepEqual(v[M2], ['indisponible', null], 'M2 hors facture : l indisponibilité agit');
      const back = await unavailability.preview(T, { providerId: Y, from: M1, to: M2, mode: 'retirer' });
      await unavailability.endUnavailable(T, { userId: U, role: 'admin' }, { providerId: Y, from: M1, to: M2, reason: null, stamp: back.stamp });
      assert.deepEqual((await read())[M2], ['contrat', Y]);

      // (b) Rôle de Y changé (partenaire de mise en œuvre) — partnerRole.restampIfRoleChangedTx = restampVisitsTx({ fromMonth }).
      const [{ t: typeBefore }] = await q('SELECT partner_type_id AS t FROM partners WHERE id = $1', [Y]);
      made.typeBack = typeBefore;
      await withTenantTransaction(T, async (client) => {
        await client.query('UPDATE partners SET partner_type_id = $3 WHERE tenant_id = $1 AND id = $2', [T, Y, types.prestataire]);
        await tpm.restampVisitsTx(client, T, { fromMonth: M0 });
      });
      v = await read();
      assert.deepEqual([v[M0], v[M1]], [['contrat', Y], ['contrat', Y]], 'M0 et M1 couverts par la facture : jamais ré-estampillés');
      assert.notDeepEqual(v[M2], ['contrat', Y], 'M2 hors facture : le changement de rôle agit');
      await withTenantTransaction(T, async (client) => {
        await client.query('UPDATE partners SET partner_type_id = $3 WHERE tenant_id = $1 AND id = $2', [T, Y, typeBefore]);
        await tpm.restampVisitsTx(client, T, { fromMonth: M0 });
      });
      made.typeBack = null;
      assert.deepEqual((await read())[M2], ['contrat', Y]);

      // (c) « Effacer les planifications » sur le district du site, M0 à M2 : seule la visite témoin (M2) part.
      for (const m of [M0, M1, M2]) {
        await planAuto.clearPlanned(T, { year: Number(m.slice(0, 4)), from: Number(m.slice(5, 7)), to: Number(m.slice(5, 7)), scope: { district: site.district } });
      }
      v = await read();
      assert.deepEqual([v[M0], v[M1]], [['contrat', Y], ['contrat', Y]], 'M0 et M1 couverts par la facture : jamais effacés');
      assert.equal(v[M2], undefined, 'M2 hors facture : effacée');
    } finally {
      if (made.typeBack) await q('UPDATE partners SET partner_type_id = $2 WHERE id = $1', [made.provider, made.typeBack]).catch(() => {});
      if (made.provider) await q("DELETE FROM tpm_unavailability WHERE provider_id = $1 AND reason = 'Indisponibilité de test (point 20)'", [made.provider]).catch(() => {});
      if (made.visits.length) await q('DELETE FROM site_visits WHERE id = ANY ($1::uuid[])', [made.visits]).catch(() => {});
      if (made.report) await q('DELETE FROM tpm_reports WHERE id = $1', [made.report]).catch(() => {});
      await su.end();
      await pool.end();
    }
  });
