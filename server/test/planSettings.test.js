/**
 * Paramètres de la planification automatique (lot 5, § 6.4 ; retours 107 et 108) : seulement
 * ce que le MMR, le RBM et les contrats ne disent pas (stratégie, agents par véhicule, jours de
 * terrain de repli) ; valeurs initiales identiques en JS et en base (lecture de la migration
 * 077), chaque paramètre a une source, contrôles, marque « modifié », réglages internes fixés,
 * et l'intervalle de revisite effectif (une seule définition).
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
    if (typeof v === 'string') assert.match(def, new RegExp(`DEFAULT '${v}'`), k);
    else assert.match(def, new RegExp(`DEFAULT ${v}\\b`), k);
  }
});

test('bornes : CHECK de la migration 077 = BOUNDS du code ; énumérations identiques', () => {
  for (const [k, [lo, hi]] of Object.entries(S.BOUNDS)) {
    assert.match(colDef(S.COLUMNS[k]), new RegExp(`BETWEEN ${lo} AND ${hi}`), k);
  }
  assert.match(colDef('strategy'), new RegExp(`CHECK \\(strategy IN \\(${S.STRATEGIES.map((o) => `'${o}'`).join(', ')}\\)\\)`));
});

test('retour 107 : aucun paramètre ne redemande ce que le MMR ou le RBM donnent déjà', () => {
  // Suivis par jour, part minimale, niveaux, « non visités depuis N mois », regroupement… : jamais réglables.
  for (const k of ['defaultVisitsPerDay', 'coverageTargetPct', 'levels', 'minMonthsSinceVisit', 'capacityMarginPct', 'travelDaysPerTour',
    'urgentMinGapMonths', 'anticipationMonths', 'generalRowMode', 'dayGrouping', 'objective']) {
    assert.ok(!S.KEYS.includes(k), `${k} ne doit pas être un paramètre du compte`);
    assert.doesNotMatch(sql, new RegExp(`\\b${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}\\b`), `${k} absent de 077`);
  }
  assert.deepEqual([...S.KEYS].sort(), ['agentsPerVehicle', 'fieldDaysPerMonth', 'strategy']);
  // Réglages internes fixés, dits dans les notes : une seule valeur, jamais demandée.
  const gp = S.generatorParams(S.fromRow(null));
  assert.equal(gp.strategy, 'besoins');
  assert.equal(gp.objective, 'mmr_complet');
  assert.equal(gp.dayGrouping, 'commune');
  assert.equal(gp.defaultVisitsPerDay, 1);
  assert.equal(gp.agentsPerVehicle, 4);
  assert.equal(S.generatorParams({ ...S.fromRow(null), strategy: 'capacite' }).objective, 'auto');
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
  const bad = { ...S.fromRow(null), strategy: 'tout', agentsPerVehicle: 0, fieldDaysPerMonth: 27 };
  assert.deepEqual(S.validateSettings(bad).map((e) => e.field).sort(), ['agentsPerVehicle', 'fieldDaysPerMonth', 'strategy']);
  assert.equal(S.validateSettings({ ...S.fromRow(null), agentsPerVehicle: 3.5 })[0].field, 'agentsPerVehicle');
  assert.deepEqual(S.validateSettings({ ...S.fromRow(null), strategy: 'capacite', agentsPerVehicle: 10, fieldDaysPerMonth: 1 }), []);
});

test('fromRow : colonne nulle → défaut ; changedKeys', () => {
  const s = S.fromRow({ strategy: 'capacite', agents_per_vehicle: 3, field_days_per_month: null });
  assert.equal(s.strategy, 'capacite');
  assert.equal(s.agentsPerVehicle, 3);
  assert.equal(s.fieldDaysPerMonth, 20);
  assert.deepEqual(S.changedKeys(s).sort(), ['agentsPerVehicle', 'strategy']);
  assert.deepEqual(S.changedKeys(S.fromRow(null)), []);
});

test('withOverrides : seules les clés connues, copie (les paramètres du compte restent intacts)', () => {
  const base = S.fromRow(null);
  const o = S.withOverrides(base, { strategy: 'capacite', inconnu: 1 });
  assert.equal(o.strategy, 'capacite');
  assert.equal(o.inconnu, undefined);
  assert.equal(base.strategy, 'besoins');
});

test('exceptions d\'un aperçu : communes exclues dédoublonnées (casse), vides ignorées, triées, au plus 500', () => {
  const { adjust, errors } = S.normalizeAdjust({ excludedCommunes: [
    { district: 'Ampanihy', commune: 'Ankilizato' }, { district: 'ampanihy', commune: 'ANKILIZATO' }, { district: 'Bekily', commune: '' },
    { district: 'Ambovombe', commune: 'Ambazoa' },
  ] });
  assert.deepEqual(errors, []);
  assert.deepEqual(adjust.excludedCommunes, [{ district: 'Ambovombe', commune: 'Ambazoa' }, { district: 'Ampanihy', commune: 'Ankilizato' }]);
  const many = Array.from({ length: 501 }, (_, i) => ({ district: 'D', commune: `C${i}` }));
  assert.equal(S.normalizeAdjust({ excludedCommunes: many }).errors[0].field, 'excludedCommunes');
  assert.deepEqual(S.normalizeAdjust({}).adjust, { excludedCommunes: [] });
});

test('lecture seule : univers, exigence, rythme, priorité, budget, prestataire — chacun avec sa source', () => {
  assert.deepEqual(S.READ_ONLY.map((r) => r.key), ['univers', 'exigence', 'rythme', 'priorite', 'budget', 'prestataire']);
  for (const r of S.READ_ONLY) assert.ok(['classeur', 'retour', 'mems'].includes(r.source.kind) && r.source.label && r.source.ref, r.key);
  assert.match(S.READ_ONLY.find((r) => r.key === 'budget').source.label, /non vérifié/);
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
