/**
 * Dépôt des indicateurs SANS base (retour n° 20) : un faux client joue la
 * table monitoring_indicators. On vérifie le SQL réellement envoyé :
 *   - une modification partielle n'écrit que les colonnes présentes (les
 *     autres gardent leur valeur : plus d'effacement de module / valeur
 *     comptée / cible), le code se modifie ;
 *   - la variable source est contrôlée contre la fiche (nom exact, casse,
 *     colonnes des données) avec la variable la plus proche en cas d'erreur ;
 *   - réappliquer le modèle n'écrase jamais un indicateur déjà créé.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const { templateForActivity, CATALOG } = require('../src/modules/monitoring/indicatorTemplates');

const T = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';
const IND = '33333333-3333-3333-3333-333333333333';
const GD = CATALOG.activities.find((a) => /GD/.test(a.key || a.label)) || CATALOG.activities[0];

// État simulé de la base.
let state;
function reset() {
  state = {
    calls: [],
    form: { id: FORM, activityCategory: GD.mmrCategory },
    ind: {
      id: IND, form_id: FORM, code: 'GD_INFO_SESSION', label: 'Session info', module: 'D4 · AAP', source_field: 'MOInfoSession',
      agg: 'percent_yes', positive_value: '1', target: '80.0000', direction: 'higher_better', sort_order: 3, active: true,
      na_values: ['9999'], scored: true, template_code: 'GD_INFO_SESSION',
    },
    catalog: ['MOInfoSession', 'MODistPtsDign', ...GD.items.slice(0, 3).map((it) => (it.variables || [])[0]).filter(Boolean)],
    calc: ['score_dign'],
    dataKeys: ['MODistPtsDign.1', 'Field_office'],
    existingTemplateCodes: [],
    inserted: [],
  };
}
reset();

// Interprète « col = CASE WHEN $i::boolean THEN $j::type ELSE col END » sur la ligne simulée.
function applyUpdate(sql, params) {
  const re = /(\w+) = CASE WHEN \$(\d+)::boolean THEN \$(\d+)::[\w[\]]+ ELSE \1 END/g;
  let m; let n = 0;
  while ((m = re.exec(sql))) {
    n += 1;
    if (params[Number(m[2]) - 1]) state.ind[m[1]] = params[Number(m[3]) - 1];
  }
  return n;
}

db.withTenantTransaction = async (tenantId, fn) => fn({
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: s, params });
    if (/^SELECT id, form_id AS "formId", source_field/.test(s)) {
      return { rows: params[1] === IND ? [{ id: IND, formId: FORM, sourceField: state.ind.source_field, agg: state.ind.agg, positiveValue: state.ind.positive_value, target: state.ind.target, naValues: state.ind.na_values }] : [] };
    }
    if (/^SELECT name FROM monitoring_form_fields .* UNION SELECT name FROM monitoring_calc_fields/.test(s)) {
      return { rows: [...state.catalog, ...state.calc].map((name) => ({ name })) };
    }
    if (/^SELECT DISTINCT jsonb_object_keys\(data\)/.test(s)) return { rows: state.dataKeys.map((name) => ({ name })) };
    if (/^SELECT name, label FROM monitoring_calc_fields WHERE tenant_id = \$1 AND form_id = \$2 ORDER BY name$/.test(s)) return { rows: state.calc.map((name) => ({ name, label: name })) };
    if (/^UPDATE monitoring_indicators SET/.test(s)) {
      const cols = applyUpdate(s, params);
      assert.equal(cols, 12, 'toutes les colonnes modifiables passent par un drapeau');
      return { rowCount: 1, rows: [] };
    }
    if (/^SELECT id FROM monitoring_forms .* FOR UPDATE/.test(s)) return { rows: params[1] === FORM ? [{ id: FORM }] : [] };
    if (/^INSERT INTO monitoring_indicators \( ?tenant_id, form_id, code, label, module, source_field, agg, positive_value, target/.test(s)) {
      state.inserted.push(params);
      return { rows: [{ id: 'new-id' }], rowCount: 1 };
    }
    if (/^SELECT id, code, label, activity_category AS "activityCategory" FROM monitoring_forms WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE$/.test(s)) {
      return { rows: [{ ...state.form, code: 'GD_FORM', label: 'Fiche GD' }] };
    }
    if (/^SELECT name, label, type, group_path AS "group", list_name AS "listName", relevant FROM monitoring_form_fields/.test(s)) {
      return { rows: state.catalog.map((name) => ({ name, label: name, type: 'select_one', group: null, listName: null })) };
    }
    if (/^SELECT code, template_code AS "templateCode" FROM monitoring_indicators WHERE tenant_id = \$1 AND form_id = \$2 FOR UPDATE$/.test(s)) {
      return { rows: state.existingTemplateCodes.map((c) => ({ code: c, templateCode: c })) };
    }
    if (/^INSERT INTO monitoring_indicators \(tenant_id, form_id, code, label, module, source_field, agg, positive_value, direction, na_values, target, scored, template_code, sort_order\)/.test(s)) {
      const per = 14;
      const rows = params.length / per;
      state.inserted.push(...Array.from({ length: rows }, (_, i) => params.slice(i * per, (i + 1) * per)));
      return { rowCount: rows, rows: [] };
    }
    if (/^UPDATE monitoring_forms SET updated_at/.test(s)) return { rowCount: 1, rows: [] };
    throw new Error(`requête inattendue : ${s.slice(0, 120)}`);
  },
});
const repo = require('../src/modules/monitoring/monitoring.repository'); // après le remplacement (déstructuré au chargement)

test('modification partielle : { active: false } ne touche ni au module, ni à la valeur comptée, ni à la cible', async () => {
  reset();
  assert.equal(await repo.updateIndicator(T, IND, { active: false }), true);
  assert.equal(state.ind.active, false);
  assert.equal(state.ind.module, 'D4 · AAP');
  assert.equal(state.ind.positive_value, '1');
  assert.equal(state.ind.target, '80.0000');
  assert.deepEqual(state.ind.na_values, ['9999']);
  // Ni la variable ni la définition n'ont été recontrôlées (rien de changé de ce côté).
  assert.equal(state.calls.filter((c) => /monitoring_form_fields/.test(c.sql)).length, 0);
});

test('modification : null efface, le code change, les codes hors base sont nettoyés', async () => {
  reset();
  await repo.updateIndicator(T, IND, { module: null, target: null, code: 'GD_INFO_2', naValues: [' 9999', '9999', '888'] });
  assert.equal(state.ind.module, null);
  assert.equal(state.ind.target, null);
  assert.equal(state.ind.code, 'GD_INFO_2');
  assert.deepEqual(state.ind.na_values, ['9999', '888']);
  assert.equal(state.ind.positive_value, '1');
  assert.equal(state.ind.template_code, 'GD_INFO_SESSION'); // le lien au modèle reste
  assert.equal(await repo.updateIndicator(T, '44444444-4444-4444-4444-444444444444', { label: 'x' }), false);
});

test('modification de la variable : contrôlée contre la fiche (casse, colonnes des données), sinon 400 avec suggestion', async () => {
  reset();
  await repo.updateIndicator(T, IND, { sourceField: 'modistptsdign.1' }); // colonne éclatée vue dans les données, autre casse
  assert.equal(state.ind.source_field, 'MODistPtsDign.1');
  await repo.updateIndicator(T, IND, { sourceField: 'SCORE_DIGN' }); // champ calculé
  assert.equal(state.ind.source_field, 'score_dign');
  await assert.rejects(repo.updateIndicator(T, IND, { sourceField: 'MOInfoSesion' }), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /vouliez-vous dire « MOInfoSession »/);
    assert.equal(err.details.suggestion, 'MOInfoSession');
    // Détails structurés : l'interface refait la phrase dans sa langue.
    assert.equal(err.details.code, 'unknown_variable');
    assert.equal(err.details.name, 'MOInfoSesion');
    assert.equal(err.details.field, 'sourceField');
    return true;
  });
  assert.equal(state.ind.source_field, 'score_dign'); // rien d'écrit
});

test('modification de la méthode : « % = valeur » sans valeur comptée refusé (définition effective)', async () => {
  reset();
  state.ind.positive_value = null;
  await assert.rejects(repo.updateIndicator(T, IND, { agg: 'percent_value' }), (err) => {
    assert.match(err.message, /précisez la valeur comptée/);
    assert.deepEqual(err.details, { code: 'positive_required', field: 'positiveValue' });
    return true;
  });
  state.ind.positive_value = '1';
  await assert.rejects(repo.updateIndicator(T, IND, { naValues: ['1'] }), (err) => {
    assert.deepEqual(err.details, { code: 'positive_is_na', field: 'naValues', value: '1' });
    return true;
  });
  assert.equal(state.ind.agg, 'percent_yes');
  await repo.updateIndicator(T, IND, { agg: 'percent_value', positiveValue: '1|2' });
  assert.equal(state.ind.agg, 'percent_value');
  assert.equal(state.ind.positive_value, '1|2');
});

test('création : variable contrôlée, rangée après les autres, fiche verrouillée ; fiche inconnue → null', async () => {
  reset();
  const id = await repo.createIndicator(T, FORM, { code: 'N1', label: 'Nouveau', sourceField: 'field_office', agg: 'percent_value', positiveValue: '6', naValues: ['9999', ' 9999'] });
  assert.equal(id, 'new-id');
  const [params] = state.inserted;
  assert.equal(params[5], 'Field_office'); // nom réel de la colonne
  assert.equal(params[10], null);           // rang : max + 1 calculé en SQL
  assert.deepEqual(params[12], ['9999']);
  assert.ok(state.calls.some((c) => /FROM monitoring_forms WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE/.test(c.sql)));
  assert.ok(state.calls.some((c) => /COALESCE\(\$11, \(SELECT max\(sort_order\) \+ 1/.test(c.sql)));
  await assert.rejects(repo.createIndicator(T, FORM, { code: 'N2', label: 'x', sourceField: 'inexistante' }), /introuvable/);
  await assert.rejects(repo.createIndicator(T, FORM, { code: 'N3', label: 'x', sourceField: 'MOInfoSession', agg: 'percent_value' }), /précisez/);
  assert.equal(await repo.createIndicator(T, '99999999-9999-9999-9999-999999999999', { code: 'N4', label: 'x', sourceField: 'q' }), null);
});

test('réappliquer le modèle : seuls les éléments manquants sont créés, aucun indicateur existant n\'est modifié', async () => {
  reset();
  const tpl = templateForActivity(GD.mmrCategory);
  const items = tpl.items.slice(0, 3).filter((it) => (it.variables || [])[0]);
  assert.ok(items.length >= 2);
  state.existingTemplateCodes = [items[0].code];
  const out = await repo.applyTemplate(T, FORM, { items: items.map((it) => ({ code: it.code, sourceField: it.variables[0] })) });
  assert.equal(out.kept, 1);
  assert.equal(out.applied, items.length - 1);
  assert.equal(out.conflicts, 0);
  assert.deepEqual(state.inserted.map((p) => p[2]), items.slice(1).map((it) => it.code));
  const insert = state.calls.find((c) => /^INSERT INTO monitoring_indicators/.test(c.sql));
  assert.match(insert.sql, /ON CONFLICT \(form_id, code\) DO NOTHING$/);
  assert.doesNotMatch(insert.sql, /DO UPDATE/);
  // Tout déjà créé : aucune écriture.
  reset();
  state.existingTemplateCodes = items.map((it) => it.code);
  const none = await repo.applyTemplate(T, FORM, { items: items.map((it) => ({ code: it.code, sourceField: it.variables[0] })) });
  assert.deepEqual({ applied: none.applied, kept: none.kept }, { applied: 0, kept: items.length });
  assert.equal(state.calls.filter((c) => /^INSERT|^UPDATE/.test(c.sql)).length, 0);
});
