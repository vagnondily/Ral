/**
 * Migration 105 — activités de programme (lecture du fichier SQL, comme mapMigration061.test.js) :
 * isolation par compte (RLS forcée, politique, droits mems2_app, contrôle « même compte »),
 * reprise idempotente qui ne réécrit AUCUN texte métier, sous-activités rattachées aux activités
 * de programme (l'ancien lien vers les prestations contractuelles disparaît dans la même migration).
 *
 * Si MEMS_TEST_DATABASE_URL désigne une base migrée jusqu'à 105, on vérifie en plus, sur ses
 * données, que CHAQUE libellé existant (sites, MMR, fiches, visites, PDD) et chaque Tag_code des
 * sites se résolvent, et que la reprise rejouée ne crée plus rien.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/105_programme_activities.sql'), 'utf8');
// Le code SQL seul (commentaires « -- » retirés) : les règles portent sur ce qui s'exécute.
const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

test('tables isolées par compte : RLS activée et forcée, politique, droits mems2_app, même compte ; jamais mems_app', () => {
  for (const t of ['programme_activities', 'programme_activity_aliases']) {
    assert.match(code, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`));
    assert.match(code, new RegExp(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`));
    assert.match(code, new RegExp(`CREATE POLICY tenant_isolation ON ${t} USING \\(tenant_id::text = current_setting\\('app\\.tenant_id', true\\)\\);`));
    assert.match(code, new RegExp(`SELECT mems_install_same_tenant\\('${t}'\\);`));
  }
  assert.match(code, /GRANT SELECT, INSERT, UPDATE, DELETE ON programme_activities, programme_activity_aliases TO mems2_app;/);
  assert.doesNotMatch(sql, /\bmems_app\b(?!.*jamais)/);
  assert.doesNotMatch(code, /\bmems_app\b/);
});

test('une activité par clé de libellé et par code ; un seul « À classer » ; alias à clé normalisée', () => {
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS uq_programme_activities_key ON programme_activities \(tenant_id, mems_activity_key\(label\)\);/);
  assert.match(code, /UNIQUE \(tenant_id, code\)/);
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS uq_programme_activities_bucket ON programme_activities \(tenant_id\) WHERE bucket;/);
  assert.match(code, /alias_key\s+text NOT NULL CHECK \(alias_key ~ '\^\[a-z0-9\]\{1,160\}\$'\)/);
  assert.match(code, /PRIMARY KEY \(tenant_id, alias_key\)/);
  assert.match(code, /programme_activity_id\s+uuid NOT NULL REFERENCES programme_activities\(id\) ON DELETE CASCADE/);
});

test('la reprise ne réécrit aucun texte métier et ne reprend jamais une clé déjà reconnue', () => {
  for (const t of ['sites', 'mmr_parameters', 'monitoring_forms', 'site_visits', 'pdd_distributions']) {
    assert.doesNotMatch(code, new RegExp(`UPDATE ${t}\\b`), `${t} jamais modifiée`);
    assert.doesNotMatch(code, new RegExp(`DELETE FROM ${t}\\b`), `${t} jamais vidée`);
  }
  // Les cinq colonnes de texte sont lues.
  for (const col of ['s.activity', 'm.activity_category', 'f.activity_category', 'v.activity', 'd.activity']) {
    assert.ok(code.includes(col), `colonne lue : ${col}`);
  }
  assert.match(code, /NOT EXISTS \(SELECT 1 FROM programme_activity_aliases a WHERE a\.tenant_id = p_tenant AND a\.alias_key = x\.k\)/);
  // Les alias et créations tolèrent un second passage.
  assert.ok((code.match(/ON CONFLICT DO NOTHING/g) || []).length >= 5);
});

test('sous-activités : rattachées à une activité de programme, ancien lien supprimé dans la même migration', () => {
  const add = code.indexOf('ALTER TABLE sub_activities ADD COLUMN IF NOT EXISTS programme_activity_id uuid REFERENCES programme_activities(id) ON DELETE RESTRICT;');
  const map = code.indexOf('UPDATE sub_activities sa SET programme_activity_id = m.pa');
  const bucket = code.indexOf('UPDATE sub_activities SET programme_activity_id = mems_programme_activity_bucket(t.id)');
  const notNull = code.indexOf('ALTER TABLE sub_activities ALTER COLUMN programme_activity_id SET NOT NULL;');
  const drop = code.indexOf('ALTER TABLE sub_activities DROP COLUMN IF EXISTS activity_id;');
  const reinstall = code.lastIndexOf("SELECT mems_install_same_tenant('sub_activities');");
  assert.ok(add > 0 && add < map && map < bucket && bucket < notNull && notNull < drop && drop < reinstall,
    'colonne ajoutée → rattachement par les sites → « À classer » → NOT NULL → ancien lien supprimé → contrôle même compte régénéré');
  // Rattachement par les sites qui portent le code (même clé), activité la plus fréquente.
  assert.match(code, /mems_activity_key\(s\.tag_code\) = mems_activity_key\(sa2\.code\)/);
  assert.match(code, /ORDER BY x\.id, x\.n DESC, x\.pa/);
  // Un code ne désigne qu'une sous-activité, à la casse et à la ponctuation près.
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_activities_code_key ON sub_activities \(tenant_id, mems_activity_key\(code\)\)/);
  assert.match(code, /RAISE EXCEPTION 'Codes de sous-activité en double/);
});

test('base réelle (MEMS_TEST_DATABASE_URL) : chaque libellé et chaque Tag_code existants se résolvent ; reprise sans effet', async (t) => {
  const url = process.env.MEMS_TEST_DATABASE_URL;
  if (!url) { t.skip('MEMS_TEST_DATABASE_URL absent'); return; }
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `WITH src AS (
         SELECT tenant_id, 'sites' AS m, activity AS x FROM sites WHERE NULLIF(btrim(activity), '') IS NOT NULL
         UNION ALL SELECT tenant_id, 'mmr', activity_category FROM mmr_parameters
         UNION ALL SELECT tenant_id, 'fiches', activity_category FROM monitoring_forms WHERE activity_category IS NOT NULL
         UNION ALL SELECT tenant_id, 'visites', activity FROM site_visits WHERE NULLIF(btrim(activity), '') IS NOT NULL
         UNION ALL SELECT tenant_id, 'pdd', activity FROM pdd_distributions)
       SELECT m, count(*)::int AS total,
              count(*) FILTER (WHERE mems_activity_key(x) <> '' AND NOT EXISTS (
                SELECT 1 FROM programme_activity_aliases a JOIN programme_activities p ON p.id = a.programme_activity_id AND NOT p.bucket
                 WHERE a.tenant_id = src.tenant_id AND a.alias_key = left(mems_activity_key(x), 160)))::int AS unresolved
         FROM src GROUP BY m`);
    for (const r of rows) assert.equal(r.unresolved, 0, `${r.m} : ${r.unresolved} libellé(s) sur ${r.total} non résolu(s)`);
    const { rows: [tags] } = await client.query(
      `SELECT count(*)::int AS n FROM sites s
        WHERE mems_activity_key(s.tag_code) <> '' AND length(btrim(s.tag_code)) <= 60
          AND NOT EXISTS (SELECT 1 FROM sub_activities sa WHERE sa.tenant_id = s.tenant_id AND mems_activity_key(sa.code) = mems_activity_key(s.tag_code))`);
    assert.equal(tags.n, 0, 'Tag_code de sites sans sous-activité');
    const { rows: [orphans] } = await client.query('SELECT count(*)::int AS n FROM sub_activities WHERE programme_activity_id IS NULL');
    assert.equal(orphans.n, 0);
    // Rejouée dans une transaction annulée : plus rien à reprendre.
    await client.query('BEGIN');
    try {
      const { rows: again } = await client.query('SELECT mems_programme_activity_reprise(id) AS r FROM tenants');
      for (const a of again) assert.deepEqual({ ...a.r }, { activities: 0, aliases: 0, subActivities: 0 });
    } finally { await client.query('ROLLBACK'); }
  } finally { await client.end(); }
});
