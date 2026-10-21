/**
 * Retour 114, re-relecture (point 1) — ordre des verrous EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré.
 *
 * Un écrivain de contrat (ligne du contrat verrouillée, puis le verrou d'attribution dans restampFromNow)
 * et un écrivain du lien TPM ↔ contrat sur le MÊME contrat (facture, plan de collecte, gabarits mensuels)
 * ne s'interbloquent jamais : l'écrivain du lien prend la ligne du contrat (FOR KEY SHARE) AVANT le
 * verrou d'attribution (lockTpmLinkTx).
 *   - « avenant », « résiliation » : les vrais services. Les écrivains de contrats (avenant, décision,
 *     résiliation, renouvellement) verrouillent leur ligne FOR NO KEY UPDATE (lot 8,
 *     contracts.repository.getContract), qui ne bloque jamais le FOR KEY SHARE de l'écrivain du lien :
 *     il ne l'attend pas du tout. Une 3ᵉ connexion retarde l'écrivain de contrat APRÈS sa ligne de
 *     contrat (ligne de l'avenant, ou table de l'historique).
 *   - « verrou » : seule la suppression d'un brouillon (deleteDraft) prend la ligne FOR UPDATE ; simulée
 *     ici par un écrivain qui la tient puis prend le verrou d'attribution. Le FOR KEY SHARE étant pris AVANT,
 *     l'écrivain du lien ATTEND la ligne SANS tenir le verrou d'attribution du compte. Avant la
 *     correction : 40P01 « deadlock detected » (503).
 * Et la suppression du dernier document du lien (deleteReport) pendant celle du contrat : même ordre —
 * contrat (FOR KEY SHARE), verrou d'attribution, puis la ligne du rapport (lockLinkDocumentTx).
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
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
test.after(async () => { if (enabled) await require('../src/config/db').pool.end(); });

test('lien TPM ↔ contrat × écrivain de contrat sur le même contrat : jamais d interblocage (avenant, résiliation × facture, plan, gabarits)',
  { skip: SKIP, timeout: 180000 }, async () => {
    const { Client } = require('pg');
    // Sans Redis : le réveil de la boîte d'envoi (après COMMIT) ne compte pas ici et garderait le processus ouvert.
    require('../src/jobs/outbox').nudgeOutbox = async () => {};
    const contracts = require('../src/modules/contracts/contracts.service');
    const reports = require('../src/modules/tpm/reports.repository');
    const planning = require('../src/modules/tpm/planning.repository');
    const { ATTRIBUTION_KEY } = require('../src/modules/tpm/tpmAttribution.repository');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const su = new Client({ connectionString: SU_URL });
    const c3 = new Client({ connectionString: SU_URL });
    const c4 = new Client({ connectionString: SU_URL });
    await su.connect(); await c3.connect(); await c4.connect();
    const q = async (sql, params) => (await su.query(sql, params)).rows;
    const made = [];
    try {
      const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
      const [{ id: ADMIN }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY email LIMIT 1", [T]);
      const [{ id: VALIDATOR }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND id <> $2 AND role IN ('admin', 'manager') ORDER BY email LIMIT 1", [T, ADMIN]);
      const [{ id: P }] = await q(`SELECT p.id FROM partners p JOIN partner_types t ON t.tenant_id = p.tenant_id AND t.id = p.partner_type_id
                                    WHERE p.tenant_id = $1 AND t.code = 'tpm' AND p.active ORDER BY p.name LIMIT 1`, [T]);
      const [src] = await q(`SELECT id FROM contracts WHERE tenant_id = $1 AND status = 'actif'
                               AND date_debut <= current_date AND date_fin >= current_date ORDER BY numero LIMIT 1`, [T]);
      assert.ok(src, 'un contrat actif aujourd hui (npm run seed)');
      const M = currentMonth();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Indian/Antananarivo' }).format(new Date());

      // Backend bloqué par `pid` (attente de verrou), ou null.
      const blockedBy = async (pid) => {
        const rows = await q("SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND $1 = ANY (pg_blocking_pids(pid))", [pid]);
        return rows.length ? rows[0].pid : null;
      };
      const waitBlockedBy = async (pid, label) => {
        for (let i = 0; i < 250; i += 1) {
          const b = await blockedBy(pid);
          if (b) return b;
          await sleep(20);
        }
        throw new Error(`${label} : jamais bloqué`);
      };
      // Bloqué par `pid`, ou terminé sans jamais l'attendre (null).
      const waitBlockedByOrDone = async (pid, done, label) => {
        for (let i = 0; i < 250; i += 1) {
          if (done()) return null;
          const b = await blockedBy(pid);
          if (b) return b;
          await sleep(20);
        }
        throw new Error(`${label} : ni bloqué ni terminé`);
      };
      const attributionHeldBy = async (pid) => (await q(
        `SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND granted
            AND objid = (hashtext($2)::bigint & 4294967295)::oid`, [pid, ATTRIBUTION_KEY(T)]))[0].n;

      for (const side of ['verrou', 'avenant', 'resiliation']) {
        for (const doc of ['facture', 'plan', 'gabarits']) {
          const label = `${side} × ${doc}`;
          const [{ id: K }] = await q(
            `INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, period_months, status, management_fee_pct, created_by, validator_id)
             SELECT tenant_id, 'TEST-R114L-' || substr(md5(random()::text), 1, 8), partner_id, partner_name, date_debut, date_fin, period_months, 'actif',
                    management_fee_pct, created_by, $2 FROM contracts WHERE id = $1 RETURNING id`, [src.id, VALIDATOR]);
          made.push(K);
          let amendmentId = null;
          if (side === 'avenant') {
            [{ id: amendmentId }] = await q(
              `INSERT INTO contract_amendments (tenant_id, contract_id, number, justification, budget_changes, status, validator_id, created_by)
               VALUES ($1, $2, 1, 'Avenant de test (retour 114)', '{}', 'en_validation', $3, $4) RETURNING id`, [T, K, VALIDATOR, ADMIN]);
          }
          const outcome = (p) => p.then(() => null, (e) => e);
          let a = Promise.resolve(null);
          let aPid;
          if (side === 'verrou') {
            // Écrivain qui tient la ligne du contrat FOR UPDATE ; il prendra le verrou d'attribution ensuite.
            await c4.query('BEGIN');
            await c4.query('SELECT 1 FROM contracts WHERE id = $1 FOR UPDATE', [K]);
            aPid = c4.processID;
          } else {
            // 3ᵉ connexion : retarde l'écrivain de contrat APRÈS sa ligne de contrat.
            await c3.query('BEGIN');
            if (side === 'avenant') await c3.query('SELECT 1 FROM contract_amendments WHERE id = $1 FOR UPDATE', [amendmentId]);
            else await c3.query('LOCK TABLE contract_history IN SHARE MODE');
            a = outcome(side === 'avenant'
              ? contracts.decideAmendment(T, { userId: VALIDATOR, role: 'manager' }, K, amendmentId, { approve: true, comment: 'ok' })
              : contracts.terminate(T, { userId: ADMIN, role: 'admin' }, K, { reason: 'Résiliation de test (retour 114)', effectiveDate: today }));
            aPid = await waitBlockedBy(c3.processID, `${label} : écrivain de contrat`);
          }
          let bDone = false;
          const b = outcome(doc === 'facture'
            ? reports.insertReport(T, { partnerId: P, contractId: K, periodMonth: `${M}-01`, kind: 'financier', reportedAmount: 10, createdBy: ADMIN })
            : doc === 'plan'
              ? planning.createPlan(T, { partnerId: P, contractId: K, periodMonth: `${M}-01`, title: 'Test r114 verrous', items: [], createdBy: ADMIN })
              : reports.generateMonthlyStubs(T, { contractId: K, partnerId: P, createdBy: ADMIN }))
            .then((e) => { bDone = true; return e; });
          const bPid = await waitBlockedByOrDone(aPid, () => bDone, `${label} : écrivain du lien`);
          if (side === 'verrou') assert.ok(bPid, `${label} : l'écrivain du lien attend la ligne du contrat tenue FOR UPDATE`);
          // S'il attend la ligne du contrat, c'est SANS tenir le verrou d'attribution du compte.
          if (bPid) assert.equal(await attributionHeldBy(bPid), 0, `${label} : verrou d'attribution pas encore pris pendant l'attente du contrat`);
          if (side === 'verrou') {
            await c4.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ATTRIBUTION_KEY(T)]); // comme restampFromNow
            await c4.query('COMMIT');
          } else await c3.query('COMMIT');
          const [ea, eb] = await Promise.all([a, b]);
          assert.equal(ea, null, `${label} — écrivain de contrat : ${ea && `${ea.code} ${ea.message}`}`);
          assert.equal(eb, null, `${label} — écrivain du lien : ${eb && `${eb.code} ${eb.message}`}`);
          const [{ n }] = await q(`SELECT (SELECT count(*) FROM tpm_reports WHERE contract_id = $1)
                                        + (SELECT count(*) FROM tpm_collection_plans WHERE contract_id = $1) AS n`, [K]);
          assert.ok(Number(n) >= 1, `${label} : document écrit`);
        }
      }
    } finally {
      await c3.query('ROLLBACK').catch(() => {});
      await c4.query('ROLLBACK').catch(() => {});
      for (const K of made) {
        await q('DELETE FROM tpm_reports WHERE contract_id = $1', [K]).catch(() => {});
        await q('DELETE FROM tpm_collection_plans WHERE contract_id = $1', [K]).catch(() => {});
        await q('DELETE FROM contracts WHERE id = $1', [K]).catch(() => {});
      }
      await c3.end(); await c4.end(); await su.end();
    }
  });

test('dernier gabarit supprimé pendant la suppression du contrat : jamais d interblocage (contrat → attribution → rapport)',
  { skip: SKIP, timeout: 120000 }, async () => {
    // Le cycle d'avant : deleteReport tenait le verrou d'attribution et la ligne du rapport, puis sa
    // ré-estampille écrivait site_visits.contract_id = K (clé étrangère → K FOR KEY SHARE) ; la suppression
    // du contrat tenait K FOR UPDATE puis attendait ses rapports. Simulée ici telle quelle (contrat FOR
    // UPDATE, puis ses rapports FOR UPDATE) ; une 3ᵉ connexion tient la visite pour croiser les deux.
    const { Client } = require('pg');
    const reports = require('../src/modules/tpm/reports.repository');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const su = new Client({ connectionString: SU_URL });
    const c2 = new Client({ connectionString: SU_URL }); // la suppression du contrat (simulée)
    const c3 = new Client({ connectionString: SU_URL }); // tient la visite
    await su.connect(); await c2.connect(); await c3.connect();
    const q = async (sql, params) => (await su.query(sql, params)).rows;
    const made = { contract: null, visit: null, partners: [] };
    try {
      const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
      const [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY email LIMIT 1", [T]);
      const [{ id: tpmType }] = await q("SELECT id FROM partner_types WHERE tenant_id = $1 AND code = 'tpm'", [T]);
      const M = currentMonth();
      // District sans contrat de suivi ce mois.
      const sites = await q('SELECT id, zone_district_id AS d FROM sites WHERE tenant_id = $1 AND zone_district_id IS NOT NULL ORDER BY id LIMIT 400', [T]);
      const cells = await q('SELECT c_site_id AS s, c_area_id AS a, c_state AS st FROM mems_tpm_cells($1, $2::uuid[], $3::date[])',
        [T, sites.map((x) => x.id), sites.map(() => `${M}-01`)]);
      const free = new Set(cells.filter((c) => c.st === 'sans_contrat').map((c) => c.s));
      const site = sites.find((x) => free.has(x.id));
      assert.ok(site, 'un site d un district sans contrat de suivi');
      const [area] = await q('SELECT id, path FROM admin_areas WHERE tenant_id = $1 AND id = $2', [T, site.d]);
      const mk = async (name) => (await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, tpmType, name]))[0].id;
      const H = await mk('Test r114 verrous titulaire'); const P = await mk('Test r114 verrous TPM');
      made.partners = [H, P];
      // Contrat de suivi K du mois, titulaire H (TPM actif), sur ce district.
      const [{ id: K }] = await q(
        `INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
         VALUES ($1, 'TEST-R114L-DEL', $2, 'Test r114 verrous titulaire', $3, ($3::date + interval '1 month' - interval '1 day')::date, 'actif', $4) RETURNING id`,
        [T, H, `${M}-01`, U]);
      made.contract = K;
      await q(`INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
               VALUES ($1, $2, 'IV.suivi', 'Suivi (test r114 verrous)', 1, 1000, '{}'::jsonb, 0)`, [K, T]);
      await q('INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order) VALUES ($1, $2, $3, $4, 2, 0)', [K, T, area.id, area.path]);
      // Gabarit unique de P (dernier document du lien) ; P indisponible ce mois : la visite est « indisponible », sans contrat.
      assert.equal((await reports.generateMonthlyStubs(T, { contractId: K, partnerId: P, createdBy: U })).created, 1);
      const [{ id: R }] = await q('SELECT id FROM tpm_reports WHERE tenant_id = $1 AND contract_id = $2', [T, K]);
      await q(`INSERT INTO tpm_unavailability (tenant_id, provider_id, period_month, reason, batch_id)
               VALUES ($1, $2, $3, 'Indisponibilité de test (retour 114)', gen_random_uuid())`, [T, P, `${M}-01`]);
      await q('BEGIN');
      await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
      const [{ id: V }] = await q(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_zone_state)
         VALUES ($1, $2, $3, 'Test r114 verrous', 'planifie', 'zone', 'indisponible') RETURNING id`, [T, site.id, `${M}-01`]);
      await q('COMMIT');
      made.visit = V;
      const [cell] = await q('SELECT c_state AS st, c_contract_id AS k FROM mems_tpm_cells($1, $2::uuid[], $3::date[])', [T, [site.id], [`${M}-01`]]);
      assert.deepEqual([cell.st, cell.k], ['indisponible', null]);

      // La 3ᵉ connexion tient la visite : deleteReport s'y arrêtera, dans sa ré-estampille.
      await c3.query('BEGIN');
      await c3.query('SELECT 1 FROM site_visits WHERE id = $1 FOR UPDATE', [V]);
      const del = reports.deleteReport(T, R, { actorId: U, isAdmin: true }).then((v) => ({ v }), (err) => ({ err }));
      let reportPid = null;
      for (let i = 0; i < 250 && !reportPid; i += 1) {
        const rows = await q("SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND $1 = ANY (pg_blocking_pids(pid))", [c3.processID]);
        if (rows.length) reportPid = rows[0].pid; else await sleep(20);
      }
      assert.ok(reportPid, 'deleteReport attend la visite');
      // Suppression du contrat (simulée) : K FOR UPDATE, puis ses rapports FOR UPDATE.
      await c2.query('BEGIN');
      await c2.query("SET LOCAL lock_timeout = '15s'");
      const draft = (async () => {
        try {
          await c2.query('SELECT id FROM contracts WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [T, K]);
          const { rows } = await c2.query('SELECT id FROM tpm_reports WHERE tenant_id = $1 AND contract_id = $2 FOR UPDATE', [T, K]);
          await c2.query('ROLLBACK');
          return { reports: rows.length };
        } catch (err) { await c2.query('ROLLBACK').catch(() => {}); return { err }; }
      })();
      // Elle attend le contrat, que deleteReport tient (FOR KEY SHARE) AVANT le verrou d'attribution et le rapport.
      let waits = false;
      for (let i = 0; i < 250 && !waits; i += 1) {
        const rows = await q('SELECT pg_blocking_pids($1) AS b', [c2.processID]);
        waits = (rows[0].b || []).includes(reportPid); if (!waits) await sleep(20);
      }
      assert.ok(waits, 'la suppression du contrat attend le contrat tenu par deleteReport');
      await c3.query('ROLLBACK');
      const [rd, rc] = await Promise.all([del, draft]);
      assert.equal(rd.err, undefined, `deleteReport : ${rd.err && `${rd.err.code} ${rd.err.message}`}`);
      assert.equal(rd.v, 'ok');
      assert.equal(rc.err, undefined, `suppression du contrat : ${rc.err && `${rc.err.code} ${rc.err.message}`}`);
      assert.equal(rc.reports, 0, 'le rapport supprimé ne bloque plus la suppression du contrat');
      const [v] = await q('SELECT provider_zone_state AS st, provider_id AS p, contract_id AS k FROM site_visits WHERE id = $1', [V]);
      assert.deepEqual([v.st, v.p, v.k], ['contrat', H, K], 'dernier document supprimé : la visite suit le titulaire TPM de K');
    } finally {
      await c3.query('ROLLBACK').catch(() => {});
      await c2.query('ROLLBACK').catch(() => {});
      if (made.visit) await q('DELETE FROM site_visits WHERE id = $1', [made.visit]).catch(() => {});
      await q('DELETE FROM tpm_unavailability WHERE provider_id = ANY ($1::uuid[])', [made.partners]).catch(() => {});
      if (made.contract) {
        await q('DELETE FROM tpm_reports WHERE contract_id = $1', [made.contract]).catch(() => {});
        await q('DELETE FROM contract_areas WHERE contract_id = $1', [made.contract]).catch(() => {});
        await q('DELETE FROM contract_budget_items WHERE contract_id = $1', [made.contract]).catch(() => {});
        await q('DELETE FROM contracts WHERE id = $1', [made.contract]).catch(() => {});
      }
      if (made.partners.length) await q('DELETE FROM partners WHERE id = ANY ($1::uuid[])', [made.partners]).catch(() => {});
      await c3.end(); await c2.end(); await su.end();
    }
  });
