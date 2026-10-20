/**
 * Migration 107 (retours 114 et 115) lue comme texte : les listes de la base sont celles de la règle
 * pure (états des visites, « ce que disait le contrat », suivi interne, journal), la colonne générée
 * monitored_by est la jumelle de tpmAttribution.monitoredByOf, D1 et les indisponibilités sont dans la
 * jumelle SQL mems_tpm_cells, la table des indisponibilités est isolée par compte, et la
 * ré-estampille ne touche que les visites prévues ré-estampillables (même filtre que le dépôt).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rule = require('../src/modules/tpm/tpmAttribution');
const off = require('../src/modules/tpm/tpmUnavailability');
const { MONITORING_LINE } = require('../src/modules/contracts/budgetCatalog');
const { REASON_MIN, REASON_MAX } = require('../src/modules/common/reasonText');
const { AUTO_RESTAMPABLE_SQL } = require('../src/modules/tpm/tpmAttribution.repository');

const SQL = fs.readFileSync(path.join(__dirname, '../src/db/migrations/107_tpm_internal_monitoring.sql'), 'utf8');
const flat = (t) => t.replace(/\s+/g, ' ');
const listIn = (re, text = SQL) => {
  const m = text.match(re);
  assert.ok(m, `motif introuvable : ${re}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

test('107 : listes de la base = listes de la règle pure', () => {
  assert.deepEqual(listIn(/site_visits_zone_state_ck CHECK \(provider_zone_state IS NULL OR provider_zone_state IN\s*\(([^)]*)\)/), rule.VISIT_ZONE_STATES);
  assert.deepEqual(listIn(/tpm_zone_overrides_expected_state_check\s+CHECK \(expected_state IN \(([^)]*)\)/), rule.DEFAULT_STATES);
  assert.deepEqual(listIn(/tpm_zone_overrides_useful_ck\s+CHECK \(expected_state NOT IN \(([^)]*)\) OR provider_id IS NOT NULL\)/), rule.INTERNAL_DEFAULT_STATES);
  assert.deepEqual(listIn(/tpm_attribution_log_scope_check CHECK \(scope IN \(([^)]*)\)/), rule.LOG_SCOPES);
  assert.deepEqual(listIn(/tpm_attribution_log_action_check CHECK \(action IN \(([^)]*)\)\)/), rule.LOG_ACTIONS);
  assert.deepEqual(listIn(/tpm_log_reason_ck\s+CHECK \(action IN \(([^)]*)\) OR reason IS NOT NULL\)/), rule.LOG_OPTIONAL_REASON);
  assert.deepEqual(listIn(/old_state IN \(([^)]*)\)/), off.AVAILABILITY_STATES);
  assert.deepEqual(listIn(/new_state IN \(([^)]*)\)/), off.AVAILABILITY_STATES);
});

test('107 : suivi interne explicite — colonne générée monitored_by, jumelle de monitoredByOf', () => {
  const col = flat(SQL.slice(SQL.indexOf('ADD COLUMN IF NOT EXISTS monitored_by'), SQL.indexOf('STORED;')));
  assert.match(col, /GENERATED ALWAYS AS \( CASE WHEN provider_id IS NOT NULL THEN 'tpm' WHEN provider_source = 'visite' THEN 'interne' WHEN provider_source = 'zone' AND provider_zone_state IN/);
  assert.deepEqual(listIn(/provider_source = 'zone' AND provider_zone_state IN \(([^)]*)\) THEN 'interne'/, col), rule.INTERNAL_VISIT_STATES);
  assert.match(col, /ELSE 'non_affecte' END\)/);
  assert.deepEqual(listIn(/site_visits_monitored_by_ck CHECK \(monitored_by IN \(([^)]*)\)\)/), rule.MONITORED_BY);
});

test('107 : indisponibilités — une ligne par TPM × mois, motif borné, RLS USING + WITH CHECK, même compte', () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS tpm_unavailability/);
  assert.match(SQL, /CONSTRAINT uq_tpm_unavailability UNIQUE \(tenant_id, provider_id, period_month\)/);
  assert.match(SQL, new RegExp(`reason\\s+text NOT NULL CHECK \\(char_length\\(btrim\\(reason\\)\\) BETWEEN ${REASON_MIN} AND ${REASON_MAX}\\)`));
  assert.match(SQL, /period_month date NOT NULL CHECK \(extract\(day FROM period_month\) = 1\)/);
  assert.match(SQL, /ALTER TABLE tpm_unavailability ENABLE ROW LEVEL SECURITY/);
  assert.match(SQL, /CREATE POLICY tenant_isolation ON tpm_unavailability\s+USING \(tenant_id::text = current_setting\('app.tenant_id', true\)\)\s+WITH CHECK/);
  assert.match(SQL, /SELECT mems_install_same_tenant\('tpm_unavailability'\);/);
  assert.match(SQL, /REVOKE UPDATE, DELETE, TRUNCATE ON tpm_attribution_log FROM mems2_app;/, 'journal toujours en inscription seule');
  assert.doesNotMatch(SQL, /mems_app\b/, 'jamais le rôle de l\'ancien système');
});

test('107 : jumelle SQL — D1 (titulaire seulement s il est un TPM actif), contrats sans TPM, indisponibilités', () => {
  const fn = flat(SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION mems_tpm_cells'), SQL.indexOf('$fn$;')));
  assert.match(fn, /JOIN partners hp ON hp\.tenant_id = p_tenant AND hp\.id = cc0\.partner_id AND hp\.active JOIN partner_types ht ON ht\.tenant_id = p_tenant AND ht\.id = hp\.partner_type_id AND ht\.code = 'tpm' WHERE NOT EXISTS \(SELECT 1 FROM tl WHERE tl\.contract_id = cc0\.id\)/);
  assert.match(fn, /NOT EXISTS \(SELECT 1 FROM tpm_unavailability u WHERE u\.tenant_id = p_tenant AND u\.provider_id = b\.partner_id AND u\.period_month = b\.m\)/);
  assert.match(fn, /WHEN bz\.site_id IS NOT NULL THEN 'sans_tpm'/);
  assert.match(fn, /WHEN o\.id IS NOT NULL AND o\.provider_id IS NOT NULL AND uo\.id IS NOT NULL THEN 'indisponible'/);
  assert.ok(fn.includes(`b.line_code = '${MONITORING_LINE}'`), 'même ligne de suivi que la Consolidation');
  // Chaque sous-requête filtre le compte.
  for (const t of ['contracts c', 'contract_areas z', 'admin_areas a', 'tpm_zone_overrides o', 'tpm_unavailability u', 'partners hp']) {
    assert.ok(fn.includes(`${t} `), t);
  }
  assert.doesNotMatch(fn, /tpm_unavailability \w+ WHERE (?!u\.tenant_id = p_tenant)/);
});

test('107 : ré-estampille — seules les visites prévues ré-estampillables (filtre du dépôt), journalisée', () => {
  const block = SQL.slice(SQL.indexOf('-- [r107-restamp:debut]'), SQL.indexOf('-- [r107-restamp:fin]'));
  assert.ok(block.length > 100);
  const f = flat(block);
  assert.ok(f.includes(`v.provider_source = 'zone' AND ${flat(AUTO_RESTAMPABLE_SQL).replace(/v\.tenant_id/g, 'v.tenant_id')}`.replace(/\( /g, '(').replace(/ \)/g, ')')),
    'même filtre que AUTO_RESTAMPABLE_SQL');
  assert.doesNotMatch(f, /'realise'|'annule'|provider_source = 'visite'|provider_source = 'reprise'/, 'jamais une visite réalisée, annulée, motivée ou reprise');
  assert.match(f, /INSERT INTO tpm_attribution_log .* VALUES \(t\.id, b, 'lot', 'reappliquer'/);
  assert.match(f, /'visite', 'visite_zone'/);
  assert.match(f, /WHERE c\.old_p IS DISTINCT FROM c\.new_p/);
});
