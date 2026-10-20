/**
 * « Effacer les planifications » (planification automatique, retour 82) — EN BASE RÉELLE, sur demande.
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré : npm test reste sans base.
 *
 * Scénario, sur un site du premier compte, au mois suivant (et au mois précédent quand il est du même
 * exercice) — une visite par cas, chacune sous sa propre activité de test :
 *   libre       prévue, TPM de sa zone, sans date ni agent          → effacée
 *   motivee     prévue, TPM choisi avec une raison (« visite »)      → conservée
 *   reprise     prévue, TPM saisi avant la règle (« reprise »)       → conservée
 *   anterieur   prévue « zone » figée « antérieur à la règle »       → conservée
 *   datee       prévue « zone » avec une date de visite              → conservée
 *   agent       prévue « zone » affectée à « Agent 1 »               → conservée
 *   realisee    réalisée                                             → conservée
 *   echue       prévue « zone » libre d'un mois échu                 → conservée
 * La réponse compte les conservées ; un 2ᵉ effacement ne supprime plus rien de ces lignes.
 * Mois courant = celui de l'APPLICATION (jour local, APP_TIMEZONE), jamais now() de la base : une
 * prévue libre du mois qui vient de s'achever (horloge injectée un mois plus tard) est conservée.
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
const TAG = 'Test effacement plan auto';
const MOTIF = 'TPM choisi avec une raison pour ce test.';

test('effacer les planifications : seules les prévues libres d\'un mois à venir sont supprimées', { skip: SKIP, timeout: 120000 }, async () => {
  const { Client } = require('pg');
  const { pool } = require('../src/config/db');
  const { clearPlanned } = require('../src/modules/tpm/planAuto.service');
  const { localDay } = require('../src/modules/common/localDay');
  const shift = (m, d) => { const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  const q = async (sql, params) => (await su.query(sql, params)).rows;
  // Les tests en base de la planification s'exécutent l'un après l'autre (node --test lance les
  // fichiers en parallèle ; ils touchent les mêmes visites) : verrou de session, libéré à la fin.
  await q("SELECT pg_advisory_lock(hashtext('mems-test-db:plan-auto'))");
  try {
    const [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
    await q('DELETE FROM site_visits WHERE tenant_id = $1 AND activity LIKE $2', [T, `${TAG} %`]);
    const [site] = await q('SELECT id FROM sites WHERE tenant_id = $1 ORDER BY created_at, id LIMIT 1', [T]);
    assert.ok(site, 'un site de démonstration est nécessaire (npm run seed:test)');
    const [tpm] = await q(
      `SELECT p.id FROM partners p JOIN partner_types pt ON pt.id = p.partner_type_id
        WHERE p.tenant_id = $1 AND pt.code = 'tpm' ORDER BY p.name LIMIT 1`, [T]);
    assert.ok(tpm, 'un prestataire TPM de démonstration est nécessaire');

    // Mois voisins du mois courant LOCAL (celui de l'écran et de l'aperçu).
    const nowM = localDay().slice(0, 7);
    const next = `${shift(nowM, 1)}-01`; const prev = `${shift(nowM, -1)}-01`;
    const sameYear = prev.slice(0, 4) === next.slice(0, 4);
    const year = Number(next.slice(0, 4));
    const add = (name, extra = {}) => ({ name, month: next, status: 'planifie', source: 'zone', ...extra });
    const cases = [
      add('libre'),
      add('motivee', { source: 'visite', provider: tpm.id, reason: MOTIF }),
      add('reprise', { source: 'reprise', provider: tpm.id, reason: MOTIF }),
      add('anterieur', { zoneState: 'anterieur' }),
      add('datee', { visitDate: next }),
      add('agent', { agent: 'Agent 1' }),
      add('realisee', { status: 'realise' }),
    ];
    if (sameYear) cases.push(add('echue', { month: prev }));
    // Écriture en une transaction : le déclencheur différé (retour 58) estampille au COMMIT.
    await q('BEGIN');
    for (const c of cases) {
      await q(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source,
                                  provider_id, provider_reason, provider_zone_state, visit_date, agent)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10::date, $11)`,
        [T, site.id, c.month, `${TAG} ${c.name}`, c.status, c.source, c.provider || null, c.reason || null,
          c.zoneState || null, c.visitDate || null, c.agent || null]);
    }
    // « Antérieur à la règle » ne s'écrit qu'en estampillant (garde mems_site_visit_tpm_guard) : comme la
    // migration 070 b, on le pose sous mems.tpm_stamping.
    await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
    await q("UPDATE site_visits SET provider_zone_state = 'anterieur' WHERE tenant_id = $1 AND activity = $2", [T, `${TAG} anterieur`]);
    await q("SELECT set_config('mems.tpm_stamping', 'off', true)");
    await q('COMMIT');
    const [{ st }] = await q('SELECT provider_zone_state AS st FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, `${TAG} anterieur`]);
    assert.equal(st, 'anterieur', 'cas « antérieur » bien préparé');

    const fromMonth = sameYear ? Number(prev.slice(5, 7)) : Number(next.slice(5, 7));
    const res = await clearPlanned(T, { year, from: fromMonth, to: Number(next.slice(5, 7)) });
    const left = new Set((await q('SELECT activity FROM site_visits WHERE tenant_id = $1 AND activity LIKE $2', [T, `${TAG} %`]))
      .map((r) => r.activity.slice(TAG.length + 1)));
    assert.equal(left.has('libre'), false, 'la prévue libre d\'un mois à venir est effacée');
    for (const c of cases.filter((x) => x.name !== 'libre')) assert.ok(left.has(c.name), `« ${c.name} » est conservée`);
    assert.ok(res.deleted >= 1, 'au moins la prévue libre est comptée');
    assert.ok(res.kept >= cases.filter((c) => c.name !== 'libre' && c.status === 'planifie').length, 'les prévues conservées sont comptées');

    const again = await clearPlanned(T, { year, from: fromMonth, to: Number(next.slice(5, 7)) });
    assert.equal(again.deleted, 0, 'rejoué, l\'effacement ne supprime plus rien');

    // Mois qui vient de s'achever à l'heure LOCALE (horloge injectée : le mois courant est déjà le
    // suivant, alors que la base, en UTC, est encore dans ce mois) : sa prévue libre est conservée.
    const nextM = next.slice(0, 7);
    await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source)
             VALUES ($1, $2, $3::date, $4, 'planifie', 'zone')`, [T, site.id, next, `${TAG} libre-echue-locale`]);
    const has = async () => (await q('SELECT 1 FROM site_visits WHERE tenant_id = $1 AND activity = $2', [T, `${TAG} libre-echue-locale`])).length === 1;
    const past = await clearPlanned(T, { year, from: Number(nextM.slice(5, 7)), to: Number(nextM.slice(5, 7)) }, { now: shift(nextM, 1) });
    assert.ok(await has(), 'mois échu à l\'heure locale : la prévue libre est conservée');
    assert.equal(past.deleted, 0);
    assert.ok(past.kept >= 1);
    // Le même mois, quand il est le mois courant : effacée.
    const cur = await clearPlanned(T, { year, from: Number(nextM.slice(5, 7)), to: Number(nextM.slice(5, 7)) }, { now: nextM });
    assert.equal(await has(), false, 'mois courant : la prévue libre est effacée');
    assert.ok(cur.deleted >= 1);
  } finally {
    await q('ROLLBACK').catch(() => {});
    await q('DELETE FROM site_visits WHERE tenant_id = (SELECT id FROM tenants ORDER BY created_at, id LIMIT 1) AND activity LIKE $1', [`${TAG} %`]).catch(() => {});
    await su.end();
    await pool.end();
  }
});
