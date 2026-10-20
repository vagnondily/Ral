/**
 * Migration 087 (formations en sessions, lot 8) — la reprise des formations saisies par agent ne
 * doit JAMAIS arrêter `npm run migrate` sur des données réelles :
 *  - statique (toujours) : la limite d'un thème vaut 200 caractères dans la base (CHECK) ET au bord
 *    (zod), comme l'ancienne saisie (thématique, max 200) ;
 *  - en base (sur demande, MEMS_TEST_DATABASE_URL : superutilisateur d'une base JETABLE, nom
 *    contenant « test », migrée) : le bloc « REPRISE 087 » de la migration, rejoué dans une
 *    transaction annulée, reprend une thématique de 200 caractères (et une plus longue, venue
 *    d'ailleurs, bornée à 200) en thème + session + participant.
 */
const SU_URL = process.env.MEMS_TEST_DATABASE_URL;
const dbName = (u) => { try { return decodeURIComponent(new URL(u).pathname.slice(1)); } catch { return ''; } };
const enabled = Boolean(SU_URL && /test/i.test(dbName(SU_URL)));
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isRealIsoDate } = require('../src/modules/common/isoDate');

const MIGRATION = fs.readFileSync(path.join(__dirname, '../src/db/migrations/087_training_sessions.sql'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '../src/modules/trainings/trainings.routes.js'), 'utf8');

test('087 : un thème accepte 200 caractères, en base comme au bord (ancienne saisie : 200)', () => {
  const themes = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS training_themes'), MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS training_sessions'));
  assert.match(themes, /length\(btrim\(label\)\) BETWEEN 2 AND 200/);
  assert.match(ROUTES, /const THEME_MAX = 200;/);
  assert.match(ROUTES, /\.max\(THEME_MAX\)/);
  // La reprise borne le libellé à 200 partout (thème, session, participant) : même expression.
  const block = MIGRATION.slice(MIGRATION.indexOf('-- REPRISE 087 — début'), MIGRATION.indexOf('-- REPRISE 087 — fin'));
  assert.equal((block.match(/left\(btrim\(regexp_replace\(f\.thematique, '\\s\+', ' ', 'g'\)\), 200\)/g) || []).length, 6);
});

test('dates réelles : 2026-02-31 et 2026-13-01 refusées, 2028-02-29 acceptée', () => {
  assert.equal(isRealIsoDate('2026-02-28'), true);
  assert.equal(isRealIsoDate('2028-02-29'), true);
  for (const bad of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-1-01', '26-01-01', '', null, '1899-12-31']) {
    assert.equal(isRealIsoDate(bad), false, String(bad));
  }
});

test('087 en base : une thématique de 200 caractères (et une plus longue) est reprise sans erreur', { skip: enabled ? false : 'base jetable absente (MEMS_TEST_DATABASE_URL, nom contenant « test »)' }, async () => {
  const { Client } = require('pg');
  const block = MIGRATION.slice(MIGRATION.indexOf('-- REPRISE 087 — début'), MIGRATION.indexOf('-- REPRISE 087 — fin'));
  const su = new Client({ connectionString: SU_URL });
  await su.connect();
  try {
    await su.query('BEGIN');
    const { rows: [agent] } = await su.query('SELECT tenant_id, id FROM tpm_agents ORDER BY created_at, id LIMIT 1');
    assert.ok(agent, 'un agent dans la base jetable');
    const t200 = `Formation longue ${'x'.repeat(183)}`; // 200 caractères
    const t230 = `Formation   trop  longue ${'y'.repeat(205)}`; // 230 caractères, espaces multiples
    assert.equal(t200.length, 200);
    await su.query(
      `INSERT INTO tpm_agent_formations (tenant_id, agent_id, thematique, date_formation, jours)
       VALUES ($1, $2, $3, '2019-03-04', 2), ($1, $2, $4, '2019-03-05', 1)`, [agent.tenant_id, agent.id, t200, t230]);
    await su.query(block); // le bloc de la migration, tel quel
    const { rows } = await su.query(
      `SELECT t.label, s.title, s.start_date::text AS d, s.end_date::text AS e, p.days_present::float8 AS days
         FROM training_themes t
         JOIN training_session_themes st ON st.theme_id = t.id
         JOIN training_sessions s ON s.id = st.session_id
         JOIN training_participants p ON p.session_id = s.id AND p.agent_id = $2
        WHERE t.tenant_id = $1 AND s.origin = 'reprise' AND t.label LIKE 'Formation % longue%' ORDER BY s.start_date`,
      [agent.tenant_id, agent.id]);
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].label, rows[0].title, rows[0].d, rows[0].e, rows[0].days], [t200, t200, '2019-03-04', '2019-03-05', 2]);
    assert.equal(rows[1].label.length, 200, 'libellé venu d\'ailleurs : borné à 200');
    assert.ok(rows[1].label.startsWith('Formation trop longue y'), 'espaces fusionnés');
    // Rejouable : un 2ᵉ passage n'ajoute rien.
    const count = async () => (await su.query("SELECT count(*)::int AS n FROM training_sessions WHERE tenant_id = $1 AND origin = 'reprise'", [agent.tenant_id])).rows[0].n;
    const n1 = await count();
    await su.query(block);
    assert.equal(await count(), n1);
  } finally {
    await su.query('ROLLBACK').catch(() => {});
    await su.end();
  }
});
