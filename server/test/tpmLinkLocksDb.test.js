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
 *   - « verrou » : un écrivain qui tient la ligne FOR UPDATE (la suppression d'un brouillon, ou tout
 *     écrivain futur) puis prend le verrou d'attribution — l'écrivain du lien ATTEND la ligne sans tenir
 *     le verrou d'attribution du compte. Avant la correction : 40P01 « deadlock detected » (503).
 *   - « avenant », « résiliation » : les vrais services. Leur ligne de contrat est FOR NO KEY UPDATE
 *     (lot 8, contracts.repository.getContract) : l'écrivain du lien ne l'attend pas du tout ; s'il
 *     l'attendait (FOR UPDATE), ce serait sans tenir le verrou d'attribution. Une 3ᵉ connexion retarde
 *     l'écrivain de contrat APRÈS sa ligne de contrat (ligne de l'avenant, ou table de l'historique).
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

test('lien TPM ↔ contrat × écrivain de contrat sur le même contrat : jamais d interblocage (avenant, résiliation × facture, plan, gabarits)',
  { skip: SKIP, timeout: 180000 }, async () => {
    const { Client } = require('pg');
    const { pool } = require('../src/config/db');
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
      await pool.end();
    }
  });
