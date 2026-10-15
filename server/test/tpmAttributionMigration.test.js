/**
 * Migration 070 (retour 58) lue comme texte : les listes de la règle pure et celles des CHECK
 * de la base sont LES MÊMES ; le journal est en inscription seule (REVOKE indispensable : les
 * privilèges par défaut des migrations 002 / 012 donnent UPDATE et DELETE) ; RLS avec USING et
 * WITH CHECK ; contrôle « même compte » réinstallé ; filet de sécurité au COMMIT.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rule = require('../src/modules/tpm/tpmAttribution');
const { MONITORING_LINE } = require('../src/modules/contracts/budgetCatalog');
const { REASON_MIN, REASON_MAX } = require('../src/modules/common/reasonText');

const SQL = fs.readFileSync(path.join(__dirname, '../src/db/migrations/070_tpm_zone_attribution.sql'), 'utf8');
const listIn = (re) => {
  const m = SQL.match(re);
  assert.ok(m, `motif introuvable : ${re}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

test('070 : états des visites, origines et « ce que disait le contrat » = listes de la règle pure', () => {
  assert.deepEqual(listIn(/site_visits_zone_state_ck CHECK \(provider_zone_state IS NULL OR provider_zone_state IN\s*\(([^)]*)\)/), rule.VISIT_ZONE_STATES);
  assert.deepEqual(listIn(/site_visits_provider_source_ck CHECK \(provider_source IN \(([^)]*)\)/), rule.VISIT_SOURCES);
  assert.deepEqual(listIn(/expected_state\s+text NOT NULL CHECK \(expected_state IN \(([^)]*)\)/), rule.DEFAULT_STATES);
  assert.deepEqual(listIn(/action\s+text NOT NULL CHECK \(action IN \(([^)]*)\)\)/), rule.LOG_ACTIONS);
  assert.deepEqual(listIn(/provider_zone_state IN \(([^)]*)\)\) = \(provider_id IS NOT NULL\)/), rule.WITH_PROVIDER);
});

test('070 : raison bornée comme common/reasonText ; ligne de suivi = budgetCatalog', () => {
  assert.match(SQL, new RegExp(`reason\\s+text NOT NULL CHECK \\(char_length\\(btrim\\(reason\\)\\) BETWEEN ${REASON_MIN} AND ${REASON_MAX}\\)`));
  assert.match(SQL, new RegExp(`BETWEEN ${REASON_MIN} AND ${REASON_MAX} END\\)`), 'raison d\'une visite « visite » / « reprise »');
  assert.ok(SQL.includes(`b.line_code = '${MONITORING_LINE}'`), 'la jumelle SQL lit la même ligne de suivi que la Consolidation');
});

test('070 : journal en inscription seule, RLS USING + WITH CHECK, même compte', () => {
  assert.match(SQL, /GRANT SELECT, INSERT ON tpm_attribution_log TO mems2_app;/);
  assert.match(SQL, /REVOKE UPDATE, DELETE, TRUNCATE ON tpm_attribution_log FROM mems2_app;/);
  for (const t of ['tpm_zone_overrides', 'tpm_attribution_log']) {
    assert.match(SQL, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
    assert.match(SQL, new RegExp(`CREATE POLICY tenant_isolation ON ${t}\\s+USING \\(tenant_id::text = current_setting\\('app.tenant_id', true\\)\\)\\s+WITH CHECK`));
  }
  for (const t of ['tpm_zone_overrides', 'site_visits', 'sites']) assert.match(SQL, new RegExp(`SELECT mems_install_same_tenant\\('${t}'\\);`));
  assert.doesNotMatch(SQL, /mems_app\b/, 'jamais le rôle de l\'ancien système');
});

test('070 : une modification diffère du contrat ; « aucun TPM » seulement là où un contrat couvre ; une par zone × mois', () => {
  assert.match(SQL, /tpm_zone_overrides_differs_ck\s+CHECK \(expected_state <> 'contrat' OR provider_id IS DISTINCT FROM expected_provider_id\)/);
  assert.match(SQL, /tpm_zone_overrides_useful_ck\s+CHECK \(expected_state <> 'sans_contrat' OR provider_id IS NOT NULL\)/);
  assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS uq_tpm_zone_override\s+ON tpm_zone_overrides \(tenant_id, admin_area_id, period_month\) WHERE admin_area_id IS NOT NULL/);
});

test('070 : filet de sécurité — garde AVANT écriture, estampille DIFFÉRÉE au COMMIT, sous le verrou d\'attribution', () => {
  assert.match(SQL, /CREATE TRIGGER trg_site_visits_tpm_guard BEFORE INSERT OR UPDATE ON site_visits/);
  assert.match(SQL, /CREATE CONSTRAINT TRIGGER trg_site_visits_tpm_stamp\s+AFTER INSERT OR UPDATE ON site_visits DEFERRABLE INITIALLY DEFERRED/);
  assert.match(SQL, /WHEN \(NEW\.provider_source = 'zone' AND NEW\.provider_zone_state IS NULL\)/);
  assert.match(SQL, /pg_advisory_xact_lock\(hashtext\('tpm-attribution:' \|\| p_tenant::text\)\)/);
  const { ATTRIBUTION_KEY } = require('../src/modules/tpm/tpmAttribution.repository');
  assert.equal(ATTRIBUTION_KEY('T'), 'tpm-attribution:T', 'même clé de verrou en JS et en SQL');
  // La garde est créée APRÈS la reprise de l'existant (les UPDATE de reprise ne la déclenchent pas).
  assert.ok(SQL.indexOf("provider_source = 'reprise'") < SQL.indexOf('CREATE TRIGGER trg_site_visits_tpm_guard'));
});
