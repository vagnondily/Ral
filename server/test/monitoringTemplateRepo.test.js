/**
 * Modèle d'indicateurs d'une fiche, côté dépôt et SANS base (retours 66 et 85) :
 * un faux client joue les tables. On vérifie le SQL réellement envoyé :
 *   - l'import d'une définition rattache seul une fiche sans activité au modèle
 *     reconnu (marquée « proposée automatiquement »), jamais une fiche déjà
 *     rattachée, jamais hors brouillon du Mapping MEMS ;
 *   - une fiche sans activité montre le modèle proposé (jamais une carte vide) ;
 *   - « Créer les N indicateurs proposés » crée les éléments précochés seulement,
 *     rattache l'activité si la fiche n'en a aucune (sans jamais la remplacer),
 *     et ne réécrit aucun indicateur existant ;
 *   - un modèle autre que celui de l'activité est refusé (400).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const FIXTURE = require('./helpers/xlsformTemplateVars.json');

const T = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';
const SMP_ID = 'MDG_SMP_2025_2026';
const SMP_CAT = 'School meal activities';

/** Définition XLSForm reconstituée depuis la fixture (sans libellés réels). */
function smpDefinition() {
  const f = FIXTURE.forms[SMP_ID];
  const choices = {};
  for (const [list, l] of Object.entries(f.lists)) {
    choices[list] = l.codes.map((v) => ({ value: v, label: l.yes.includes(v) ? 'Oui' : l.other.includes(v) ? 'Autre' : l.na.includes(v) ? 'Sans objet' : `choix ${v}` }));
  }
  const fields = f.fields.map(([name, type, listName]) => ({ name, type, label: name, listName, group: null, relevant: null, required: false }));
  return { fields, choices };
}

let state;
function reset(over = {}) {
  const def = smpDefinition();
  state = {
    calls: [], inserted: [], siteRelinks: 0, lockTaken: 0,
    form: { id: FORM, code: SMP_ID, label: 'Suivi SMP', activityCategory: null, mappingStatus: 'brouillon', submissions: 150 },
    exists: true,
    def,
    mmr: [SMP_CAT, 'Nutrition treatment activities'],
    indicators: [], // { code, templateCode }
    ...over,
  };
}
reset();

db.withTenantTransaction = async (tenantId, fn) => fn({
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: s, params });
    if (/^SELECT pg_try_advisory_xact_lock/.test(s)) { state.lockTaken += 1; return { rows: [{ ok: true }] }; }
    // ---- import de la définition
    if (/^SELECT id FROM monitoring_forms WHERE tenant_id = \$1 AND code = \$2$/.test(s)) return { rows: state.exists ? [{ id: FORM }] : [] };
    if (/^INSERT INTO monitoring_forms \(tenant_id, code, label\)/.test(s)) return { rows: [{ id: FORM }] };
    if (/^UPDATE monitoring_forms SET label = \$3, active = true/.test(s)) return { rowCount: 1, rows: [] };
    if (/^DELETE FROM monitoring_(form_fields|choices)/.test(s)) return { rowCount: 0, rows: [] };
    if (/^INSERT INTO monitoring_(form_fields|choices) /.test(s)) return { rowCount: 1, rows: [] };
    if (/^UPDATE monitoring_form_fields f SET list_name = c.list_name/.test(s)) return { rowCount: 0, rows: [] };
    // ---- fiche, MMR, rattachement
    if (/^SELECT activity_category AS "activityCategory", mapping_status AS "mappingStatus", .* FOR UPDATE$/.test(s)) {
      return { rows: [{ activityCategory: state.form.activityCategory, mappingStatus: state.form.mappingStatus, submissions: state.form.submissions }] };
    }
    if (/^SELECT f.id, f.code, f.label, f.activity_category AS "activityCategory"/.test(s)) {
      return { rows: [{ ...state.form, activityAuto: false, indicators: state.indicators.length }] };
    }
    if (/^SELECT id, code, label, activity_category AS "activityCategory", .* FOR UPDATE$/.test(s)) {
      return { rows: [{ id: FORM, code: state.form.code, label: state.form.label, activityCategory: state.form.activityCategory, submissions: state.form.submissions }] };
    }
    if (/^SELECT DISTINCT btrim\(activity_category\) AS c FROM mmr_parameters/.test(s)) return { rows: state.mmr.map((c) => ({ c })) };
    if (/^UPDATE monitoring_forms SET activity_category = \$3, activity_auto_at = (now\(\)|NULL)/.test(s)) {
      state.form.activityCategory = params[2];
      state.form.auto = /activity_auto_at = now\(\)/.test(s);
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE monitoring_forms SET updated_at/.test(s)) return { rowCount: 1, rows: [] };
    // ---- variables de la fiche (catalogTx + colonnes des données)
    if (/^SELECT name, label, type, group_path AS "group", list_name AS "listName", relevant FROM monitoring_form_fields/.test(s)) {
      return { rows: state.def.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, group: null, listName: f.listName, relevant: null })) };
    }
    if (/^SELECT list_name AS "listName", value, label FROM monitoring_choices/.test(s)) {
      return { rows: Object.entries(state.def.choices).filter(([l]) => params[2].includes(l)).flatMap(([listName, cs]) => cs.map((c) => ({ listName, ...c }))) };
    }
    if (/^SELECT DISTINCT jsonb_object_keys\(data\)/.test(s)) return { rows: [] };
    // ---- indicateurs
    if (/^SELECT id, code, label, template_code AS "templateCode", source_field/.test(s)) {
      return { rows: state.indicators.map((i, k) => ({ id: `ind-${k}`, code: i.code, label: i.code, templateCode: i.templateCode, sourceField: 'x', positiveValue: '1' })) };
    }
    if (/^SELECT code, template_code AS "templateCode" FROM monitoring_indicators .* FOR UPDATE$/.test(s)) return { rows: state.indicators };
    if (/^INSERT INTO monitoring_indicators \(tenant_id, form_id, code, label, module, source_field, agg, positive_value, direction, na_values, target, scored, template_code, sort_order\)/.test(s)) {
      const per = 14;
      const n = params.length / per;
      const rows = Array.from({ length: n }, (_, i) => params.slice(i * per, (i + 1) * per));
      state.inserted.push(...rows);
      return { rowCount: n, rows: [] };
    }
    throw new Error(`requête inattendue : ${s.slice(0, 140)}`);
  },
});
// Relecture des sites des soumissions (verrou des liens) : comptée, sans base.
const places = require('../src/modules/settings/placeMatch.repository');
places.applySubmissionSitesTx = async () => { state.siteRelinks += 1; return {}; };
const repo = require('../src/modules/monitoring/monitoring.repository'); // après les remplacements

test('import de la définition : fiche sans activité rattachée seule au modèle reconnu, marquée « proposée automatiquement »', async () => {
  reset();
  const { fields, choices } = state.def;
  const out = await repo.importDefinition(T, { code: SMP_ID, label: 'MDG SMP 2025 - 2026' }, fields, choices);
  assert.equal(out.activity.reason, 'attached');
  assert.equal(out.activity.attach, SMP_CAT);
  assert.equal(out.activity.template, 'SMP');
  assert.ok(out.activity.coverage >= 0.95);
  assert.equal(state.form.activityCategory, SMP_CAT);
  assert.equal(state.form.auto, true);           // activity_auto_at = now()
  assert.equal(state.siteRelinks, 1);            // la fiche a des soumissions : sites candidats relus
  assert.ok(state.lockTaken >= 1);               // sous le verrou des liens des soumissions
});

test('import : une activité déjà choisie n\'est jamais remplacée ; un Mapping MEMS validé bloque le rattachement automatique', async () => {
  reset({ form: { id: FORM, code: SMP_ID, label: 'x', activityCategory: 'Nutrition treatment activities', mappingStatus: 'brouillon', submissions: 0 } });
  const kept = await repo.importDefinition(T, { code: SMP_ID, label: 'x' }, state.def.fields, state.def.choices);
  assert.equal(kept.activity.reason, 'already_attached');
  assert.equal(state.form.activityCategory, 'Nutrition treatment activities');
  assert.equal(state.calls.filter((c) => /^UPDATE monitoring_forms SET activity_category/.test(c.sql)).length, 0);
  reset({ form: { id: FORM, code: SMP_ID, label: 'x', activityCategory: null, mappingStatus: 'valide', submissions: 0 } });
  const locked = await repo.importDefinition(T, { code: SMP_ID, label: 'x' }, state.def.fields, state.def.choices);
  assert.equal(locked.activity.reason, 'mapping_locked');
  assert.equal(state.form.activityCategory, null);
  // Activité absente du MMR du compte : rien n'est rattaché, la raison est rendue.
  reset({ mmr: ['Nutrition treatment activities'] });
  const missing = await repo.importDefinition(T, { code: SMP_ID, label: 'x' }, state.def.fields, state.def.choices);
  assert.deepEqual([missing.activity.reason, missing.activity.category], ['not_in_mmr', SMP_CAT]);
});

test('carte du modèle : une fiche sans activité montre le modèle proposé, ses comptes et l\'activité du MMR à rattacher', async () => {
  reset();
  const out = await repo.formTemplate(T, FORM);
  assert.equal(out.source, 'proposal');
  assert.equal(out.template.key, 'SMP');
  assert.equal(out.template.tenantCategory, SMP_CAT);
  assert.equal(out.proposal.best.key, 'SMP');
  assert.equal(out.proposal.best.tenantCategory, SMP_CAT);
  assert.ok(out.summary.proposed >= 70, JSON.stringify(out.summary));
  assert.equal(out.summary.subtable, out.template.items.filter((i) => i.warnings.includes('groupe')).length);
  const teacher = out.template.items.find((i) => i.code === 'SMP_TEACHER_SATISF');
  assert.deepEqual([teacher.suggestion.subtable, teacher.suggestion.preselect], [true, false]);
  // Modèle demandé autre que celui de l'activité : refusé.
  reset({ form: { id: FORM, code: SMP_ID, label: 'x', activityCategory: SMP_CAT, mappingStatus: 'brouillon', submissions: 0 } });
  await assert.rejects(repo.formTemplate(T, FORM, { template: 'GD' }), (err) => {
    assert.equal(err.statusCode, 400);
    assert.equal(err.details.code, 'activity_template');
    return true;
  });
});

test('un clic : éléments proposés seulement, activité rattachée si aucune, rien de réécrit', async () => {
  reset({ indicators: [{ code: 'SMP_MENU_DISPLAYED', templateCode: 'SMP_MENU_DISPLAYED' }, { code: 'SMP_KITCHEN_VENT', templateCode: null }] });
  const out = await repo.applyTemplate(T, FORM, { proposed: true, attach: true });
  assert.equal(out.template, 'SMP');
  assert.equal(out.attached, SMP_CAT);
  assert.equal(out.attachReason, 'attached');
  assert.equal(state.form.auto, false); // geste de l'utilisateur : activity_auto_at = NULL
  const codes = state.inserted.map((p) => p[2]);
  assert.equal(out.applied, codes.length);
  assert.ok(codes.length >= 70, `${codes.length}`);
  assert.ok(!codes.includes('SMP_MENU_DISPLAYED'));  // déjà créé : jamais réécrit
  assert.ok(!codes.includes('SMP_KITCHEN_VENT'));    // code pris par un indicateur manuel
  assert.ok(!codes.includes('SMP_TEACHER_SATISF'));  // sous-table : pas précoché
  const insert = state.calls.find((c) => /^INSERT INTO monitoring_indicators/.test(c.sql));
  assert.match(insert.sql, /ON CONFLICT \(form_id, code\) DO NOTHING$/);
  // Cible du modèle écrite ; « Autre » jamais hors base.
  const days = state.inserted.find((p) => p[2] === 'SMP_DAYS_SERVED');
  assert.equal(days[10], 20);
  assert.ok(state.lockTaken >= 1);
  // Fiche déjà rattachée : l'activité n'est jamais remplacée.
  reset({ form: { id: FORM, code: SMP_ID, label: 'x', activityCategory: SMP_CAT, mappingStatus: 'valide', submissions: 0 } });
  const again = await repo.applyTemplate(T, FORM, { proposed: true, attach: true });
  assert.deepEqual([again.attached, again.attachReason], [null, 'already_attached']);
  assert.ok(again.applied > 0); // un Mapping MEMS validé ne bloque pas les indicateurs (il ne fige que les dimensions)
});

test('aucun modèle : 400 explicite (créer les indicateurs un par un)', async () => {
  reset({ def: { fields: [{ name: 'q1', type: 'select_one', label: 'q1', listName: null }], choices: {} } });
  await assert.rejects(repo.applyTemplate(T, FORM, { proposed: true }), (err) => {
    assert.equal(err.statusCode, 400);
    assert.equal(err.details.code, 'no_template');
    return true;
  });
  const out = await repo.formTemplate(T, FORM);
  assert.deepEqual([out.template, out.source, out.proposal.best], [null, null, null]);
});
