/**
 * Migration 061 (lecture du fichier SQL, comme pddMigration057.test.js) : la règle
 * SQL de la position GPS reprend EXACTEMENT les motifs de submissionGps.js, protège
 * chaque conversion, choisit dans le même ordre ; la règle est évaluée une fois par
 * ligne réellement insérée (AFTER INSERT : jamais pour une ligne en conflit d'un
 * ré-import) ou dont les réponses changent (BEFORE UPDATE) ; map_shape_links est
 * isolée par compte (RLS forcée, même compte).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LAT_KEY_RE, GEOPOINT_RE } = require('../src/modules/map/submissionGps');

const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/061_map_geo.sql'), 'utf8');

test('motifs de clé de latitude et de geopoint identiques aux constantes JS', () => {
  assert.ok(sql.includes(`e.key ~* '${LAT_KEY_RE.source}'`), 'clé de latitude');
  assert.ok(sql.includes(`'${GEOPOINT_RE.source}'`), 'geopoint');
});

test('chaque conversion ::numeric est gardée par un CASE (ou un motif déjà vérifié)', () => {
  const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION mems_submission_gps('), sql.indexOf('$$;'));
  const casts = body.match(/::numeric/g).length;
  const guarded = body.match(/THEN \([^)]*\)::numeric|THEN \(d[^\n]*::numeric/g) || [];
  // 3 conversions de la paire + 2 de _geolocation sont dans un CASE ; les 3 du geopoint
  // portent sur les groupes d'un motif déjà vérifié (m[1], m[2], m[4]).
  assert.equal(body.match(/m\[\d\]::numeric/g).length, 3);
  assert.ok(guarded.length >= 5, `${guarded.length} conversions gardées`);
  assert.equal(casts, guarded.length + 3 + 1); // + NULL::numeric
});

test('ordre de choix aligné sur JavaScript ; préfiltres ; une évaluation par ligne', () => {
  assert.match(sql, /ORDER BY c\.src, c\.kl, c\.key COLLATE "C"/);
  assert.match(sql, /e\.key ILIKE '%atitude%'/);
  assert.match(sql, /strpos\(e\.value #>> '\{\}', ' '\) > 0 AND strpos\(e\.value #>> '\{\}', '\.'\) > 0/);
  assert.match(sql, /g := mems_submission_gps\(NEW\.data\);/);
  // Une évaluation dans chacune des deux fonctions (insertion, mise à jour), jamais deux par ligne.
  assert.equal((sql.match(/mems_submission_gps\(NEW\.data\)/g) || []).length, 2);
  // PostgreSQL déclenche les BEFORE INSERT avant le contrôle de conflit : jamais de BEFORE INSERT
  // (un ré-import ON CONFLICT DO UPDATE évaluerait la règle pour chaque ligne déjà présente).
  assert.doesNotMatch(sql, /CREATE TRIGGER[^;]*BEFORE INSERT/);
  assert.match(sql, /BEFORE UPDATE OF data, gps_lat, gps_lng, gps_accuracy_m ON monitoring_submissions\s+FOR EACH ROW EXECUTE FUNCTION mems_submission_gps_fill\(\);/);
  assert.match(sql, /AFTER INSERT ON monitoring_submissions\s+FOR EACH ROW EXECUTE FUNCTION mems_submission_gps_insert\(\);/);
  // L'insertion n'écrit que si la position lue diffère (aucune écriture pour une soumission sans GPS),
  // sur la ligne de SON compte ; l'écriture qu'elle fait n'est pas réévaluée (profondeur > 1, mêmes réponses).
  assert.match(sql, /IF v_lat IS DISTINCT FROM NEW\.gps_lat OR v_lng IS DISTINCT FROM NEW\.gps_lng OR v_acc IS DISTINCT FROM NEW\.gps_accuracy_m THEN/);
  assert.match(sql, /WHERE id = NEW\.id AND tenant_id = NEW\.tenant_id;/);
  assert.match(sql, /IF NEW\.data IS NOT DISTINCT FROM OLD\.data AND \(pg_trigger_depth\(\) > 1 OR \(/);
  assert.doesNotMatch(sql, /GENERATED ALWAYS/);
  assert.match(sql, /CASE WHEN g\[3\] IS NULL THEN NULL/); // LEAST ignore les NULL
  // Rattrapage AVANT la création du déclencheur : une seule évaluation par ligne.
  assert.ok(sql.indexOf('UPDATE monitoring_submissions s') < sql.indexOf('CREATE TRIGGER trg_mon_sub_gps'));
  assert.ok(sql.indexOf('DROP TRIGGER IF EXISTS trg_mon_sub_gps ') < sql.indexOf('UPDATE monitoring_submissions s'));
  assert.ok(sql.indexOf('DROP TRIGGER IF EXISTS trg_mon_sub_gps_ins') < sql.indexOf('UPDATE monitoring_submissions s'));
});

test('map_shape_links : RLS activée et forcée, politique, GRANT mems2_app, contrôle même compte ; jamais mems_app', () => {
  assert.match(sql, /ALTER TABLE map_shape_links ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE map_shape_links FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY tenant_isolation ON map_shape_links/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON map_shape_links TO mems2_app;/);
  assert.match(sql, /SELECT mems_install_same_tenant\('map_shape_links'\);/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, shape_set, area_pcode\)/);
  assert.doesNotMatch(sql, /\bmems_app\b/);
});
