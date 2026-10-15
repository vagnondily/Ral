/**
 * Paramètres de la planification automatique (lot 5, § 6) : valeurs initiales identiques
 * en JS et en base (lecture de la migration 077), chaque paramètre a une source, contrôles,
 * marque « modifié », et l'intervalle de revisite effectif (une seule définition).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/modules/tpm/planSettings');

const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/077_plan_settings.sql'), 'utf8');
const colDef = (col) => {
  const m = new RegExp(`\\n\\s+${col}\\s+([^\\n]+(?:\\n\\s{20,}[^\\n]+)*)`).exec(sql);
  assert.ok(m, `colonne ${col} absente de 077`);
  return m[1];
};

test('valeurs initiales : DEFAULT de la migration 077 = DEFAULTS du code', () => {
  for (const k of S.KEYS) {
    const def = colDef(S.COLUMNS[k]);
    const v = S.DEFAULTS[k];
    if (Array.isArray(v)) assert.match(def, new RegExp(`DEFAULT ARRAY\\[${v.map((x) => `'${x}'`).join(', ')}\\]`), k);
    else if (typeof v === 'string') assert.match(def, new RegExp(`DEFAULT '${v}'`), k);
    else assert.match(def, new RegExp(`DEFAULT ${v}\\b`), k);
  }
});

test('bornes : CHECK de la migration 077 = BOUNDS du code ; énumérations identiques', () => {
  for (const [k, [lo, hi]] of Object.entries(S.BOUNDS)) {
    assert.match(colDef(S.COLUMNS[k]), new RegExp(`BETWEEN ${lo} AND ${hi}`), k);
  }
  assert.match(colDef('objective'), new RegExp(S.OBJECTIVES.map((o) => `'${o}'`).join(', ')));
  assert.match(colDef('day_grouping'), new RegExp(S.DAY_GROUPINGS.map((o) => `'${o}'`).join(', ')));
  assert.match(colDef('general_row_mode'), new RegExp(S.GENERAL_ROW_MODES.map((o) => `'${o}'`).join(', ')));
  assert.match(sql, new RegExp(`levels <@ ARRAY\\[${S.LEVELS.map((x) => `'${x}'`).join(', ')}\\]`));
});

test('migration 077 : RLS activée et forcée, politique USING + WITH CHECK, droits mems2_app, même compte ; jamais mems_app', () => {
  assert.match(sql, /ALTER TABLE plan_settings ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE plan_settings FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /USING \(tenant_id::text = current_setting\('app\.tenant_id', true\)\)\s+WITH CHECK/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON plan_settings TO mems2_app/);
  assert.match(sql, /SELECT mems_install_same_tenant\('plan_settings'\);/);
  assert.doesNotMatch(sql, /\bmems_app\b/);
});

test('chaque paramètre a une source (classeur, retour ou MEMS) avec un libellé', () => {
  for (const k of S.KEYS) {
    const src = S.SOURCES[k];
    assert.ok(src, `source manquante : ${k}`);
    assert.ok(['classeur', 'retour', 'mems'].includes(src.kind), k);
    assert.ok(src.label && src.ref, k);
  }
  assert.deepEqual(Object.keys(S.SOURCES).sort(), [...S.KEYS].sort());
});

test('validateSettings : défauts valides ; chaque erreur nomme son champ', () => {
  assert.deepEqual(S.validateSettings(S.fromRow(null)), []);
  const bad = {
    ...S.fromRow(null), objective: 'tout', coverageTargetPct: 0, levels: [], coverageCatchUp: 'oui', dayGrouping: 'region',
    capacityMarginPct: 300, travelDaysPerTour: -1, urgentMinGapMonths: 0, anticipationMonths: 7, defaultVisitsPerDay: 0.7, generalRowMode: 'x',
  };
  const fields = S.validateSettings(bad).map((e) => e.field).sort();
  assert.deepEqual(fields, ['anticipationMonths', 'capacityMarginPct', 'coverageCatchUp', 'coverageTargetPct', 'dayGrouping', 'defaultVisitsPerDay',
    'generalRowMode', 'levels', 'objective', 'travelDaysPerTour', 'urgentMinGapMonths'].sort());
  assert.equal(S.validateSettings({ ...S.fromRow(null), levels: ['haute', 'haute'] })[0].field, 'levels');
  assert.equal(S.validateSettings({ ...S.fromRow(null), coverageTargetPct: 80.5 })[0].field, 'coverageTargetPct');
  assert.deepEqual(S.validateSettings({ ...S.fromRow(null), defaultVisitsPerDay: 2.5 }), []);
});

test('fromRow : colonne nulle → défaut ; niveaux dans l\'ordre canonique ; changedKeys', () => {
  const s = S.fromRow({ objective: 'couverture', coverage_target_pct: 90, levels: ['moyenne', 'haute'], default_visits_per_day: '1.5', fill_district: null });
  assert.equal(s.objective, 'couverture');
  assert.equal(s.coverageTargetPct, 90);
  assert.deepEqual(s.levels, ['haute', 'moyenne']);
  assert.equal(s.defaultVisitsPerDay, 1.5);
  assert.equal(s.fillDistrict, true);
  assert.deepEqual(S.changedKeys(s).sort(), ['coverageTargetPct', 'defaultVisitsPerDay', 'levels', 'objective']);
  assert.deepEqual(S.changedKeys(S.fromRow(null)), []);
  assert.deepEqual(S.changedKeys({ ...S.fromRow(null), levels: ['basse', 'moyenne', 'haute'] }), []);
});

test('withOverrides : seules les clés connues, copie (les paramètres du compte restent intacts)', () => {
  const base = S.fromRow(null);
  const o = S.withOverrides(base, { objective: 'mmr_complet', levels: ['haute'], inconnu: 1 });
  assert.equal(o.objective, 'mmr_complet');
  assert.deepEqual(o.levels, ['haute']);
  assert.equal(o.inconnu, undefined);
  assert.deepEqual(base.levels, ['haute', 'moyenne', 'basse']);
});

// Valeurs de la capture MMR du 14/10 (repas scolaires : durée 10, 824 sites, risque 2, faisable 52).
const SCHOOL = { operationDuration: 10, numberOfSites: 824, riskLevel: 2, feasible: 52 };

test('effectiveInterval : MMR complet = ⌈durée ÷ risque⌉ ; couverture = une visite par exercice', () => {
  const full = S.effectiveInterval(SCHOOL, 'mmr_complet');
  assert.equal(full.mode, 'mmr_complet');
  assert.equal(full.due, 5);
  assert.equal(full.coverage, 5);
  const cov = S.effectiveInterval(SCHOOL, 'couverture');
  assert.equal(cov.mode, 'couverture');
  assert.equal(cov.due, null);
  assert.equal(cov.coverage, 5);
  // Intervalle fractionnaire : arrondi au mois supérieur (4,5 → 5).
  assert.equal(S.effectiveInterval({ ...SCHOOL, operationDuration: 9 }, 'mmr_complet').due, 5);
});

test('effectiveInterval auto : capacité insuffisante → intervalle ajusté (15,85 → 16) ; suffisante → MMR complet', () => {
  const a = S.effectiveInterval(SCHOOL, 'auto');
  assert.equal(a.mode, 'ajuste');
  assert.equal(a.reason, 'capacite_insuffisante');
  assert.equal(a.adjustedInterval, 15.85);
  assert.equal(a.due, 16);
  assert.equal(a.coverage, 5);
  const enough = S.effectiveInterval({ ...SCHOOL, numberOfSites: 100 }, 'auto');
  assert.equal(enough.mode, 'mmr_complet');
  assert.equal(enough.reason, 'capacite_suffisante');
  const unknown = S.effectiveInterval({ ...SCHOOL, feasible: null }, 'auto');
  assert.equal(unknown.mode, 'mmr_complet');
  assert.equal(unknown.reason, 'capacite_inconnue');
});

test('effectiveInterval : durée 0 ou risque absent → ne tourne pas (jamais un intervalle 0)', () => {
  for (const row of [{ ...SCHOOL, operationDuration: 0 }, { ...SCHOOL, riskLevel: 0 }, null]) {
    const r = S.effectiveInterval(row, 'auto');
    assert.equal(r.running, false);
    assert.equal(r.mode, 'non_planifiable');
    assert.equal(r.due, null);
    assert.equal(r.coverage, null);
  }
});
