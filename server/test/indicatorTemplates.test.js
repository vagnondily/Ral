const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOG, templateForActivity, templateByKey, tenantCategoryFor, mmrKey, moduleLabel, suggestBindings, positiveFor, indicatorFromItem,
} = require('../src/modules/monitoring/indicatorTemplates');
const { resolveVariable } = require('../src/modules/monitoring/variableCatalog');
const { typeIssue } = require('../src/modules/monitoring/indicatorProposals');
// Variables des 5 XLSForm citées par les modèles (noms, types, listes, sous-tables ; aucun libellé).
const FIXTURE = require('./helpers/xlsformTemplateVars.json');

const GD = 'Unconditional resource transfers to support access to food';
// Formulaire réel de chaque modèle (docs/ANALYSE_XLSFORM.md).
const FORM_OF = {
  GD: 'MDG_Process_Monitoring_GD_PREVMA_v2',
  SMP: 'MDG_SMP_2025_2026',
  MAM: 'MDG_Process_Monitoring_NutritionAIM',
  STUNT: 'MDG_Process_Monitoring_MIARO_PROD_Janv2026',
  RES: 'MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1',
};

/** Variables d'un formulaire de la fixture : questions + options éclatées « X/k » des choix multiples. */
function formVariables(formId) {
  const f = FIXTURE.forms[formId];
  const byLower = new Map();
  for (const [name, type, list, repeat] of f.fields) {
    byLower.set(name.toLowerCase(), { name, type, list, repeat, codes: list ? f.lists[list].codes : [] });
    if (type === 'select_multiple') {
      for (const c of f.lists[list].codes) byLower.set(`${name}/${c}`.toLowerCase(), { name: `${name}/${c}`, type: 'option', list: null, repeat, codes: ['0', '1'] });
    }
  }
  return { byLower, names: [...byLower.values()].map((v) => v.name), lists: f.lists };
}

test('catalogue : 5 activités du MMR, codes uniques partout, aucune mention d\'organisation', () => {
  assert.deepEqual(CATALOG.activities.map((a) => a.key).sort(), ['GD', 'MAM', 'RES', 'SMP', 'STUNT']);
  const all = CATALOG.activities.flatMap((a) => a.items.map((i) => i.code));
  assert.equal(new Set(all).size, all.length, 'un code d\'élément est unique dans tout le catalogue (template_code)');
  for (const a of CATALOG.activities) {
    assert.ok(a.mmrCategory && Array.isArray(a.formHints) && a.formHints.length, a.key);
    for (const i of a.items) {
      assert.ok(['higher_better', 'lower_better'].includes(i.direction), i.code);
      assert.ok(['percent_yes', 'percent_value', 'mean', 'sum', 'count'].includes(i.agg), i.code);
      assert.ok(a.domains.some((d) => d.code === i.domain), `${i.code} → ${i.domain}`);
      // Bornes de l'API et de la base (code ≤ 60, domaine ≤ 80, libellé ≤ 200, valeur positive ≤ 80).
      assert.ok(i.code.length <= 60 && i.label.length <= 200 && moduleLabel(a, i.domain).length <= 80, i.code);
      assert.ok(i.positiveValue == null || String(i.positiveValue).length <= 80, i.code);
      assert.ok(i.target === undefined || Number.isFinite(i.target), i.code);
      assert.ok(i.variables.length > 0, `${i.code} : au moins une variable`);
      // « % = valeur » compte une valeur précise.
      if (i.agg === 'percent_value') assert.ok(i.positiveValue, i.code);
    }
  }
  assert.doesNotMatch(JSON.stringify(CATALOG), /\bPAM\b|WFP/);
});

test('notation : modules complémentaires (M…) et chiffres clés hors indice ; une moyenne sans cible n\'est pas notée', () => {
  for (const a of CATALOG.activities) {
    for (const i of a.items) {
      if (/^M\d|^KPI$/.test(i.domain)) assert.equal(i.scored, false, `${i.code} (${i.domain})`);
      if (['mean', 'sum', 'count'].includes(i.agg) && i.target == null) assert.equal(i.scored, false, i.code);
    }
  }
  // Seuils « Excellent » fixés par les formulaires eux-mêmes (classe calculée dans le XLSForm).
  const target = (code) => CATALOG.activities.flatMap((a) => a.items).find((i) => i.code === code).target;
  assert.equal(target('GD_SPI'), 75);      // SitePerformanceClass : ≥ 75 = Excellent
  assert.equal(target('MIARO_SPI'), 75);
  assert.equal(target('SMP_PERF'), 80);    // perf_tier : ≥ 80 = Vert
  assert.equal(target('MAM_SCORE_TOTAL'), 80);
  assert.equal(target('RES_FFA_SCORE'), 80); // FFA_class : ≥ 80 = Excellente
  assert.equal(target('SMP_DAYS_SERVED'), 20); // « sur les 20 derniers jours d'école »
});

test('chaque variable de chaque modèle se résout dans SON formulaire réel (resolveVariable), type et liste compris', () => {
  for (const a of CATALOG.activities) {
    const { byLower, names, lists } = formVariables(FORM_OF[a.key]);
    for (const i of a.items) {
      const resolved = i.variables.map((v) => resolveVariable(v, names)).find((r) => r.name);
      assert.ok(resolved, `${a.key}.${i.code} : aucune de ${i.variables.join(', ')} dans ${FORM_OF[a.key]}`);
      const v = byLower.get(resolved.name.toLowerCase());
      assert.equal(typeIssue(i.agg, v.type), null, `${i.code} : ${v.type} incompatible avec ${i.agg}`);
      // Sous-table (groupe répété) ⇔ avertissement « groupe » : jamais précoché tant que les sous-tables ne sont pas importées.
      assert.equal((i.warnings || []).includes('groupe'), Boolean(v.repeat), `${i.code} : sous-table ${v.repeat}`);
      if (!v.list || !['percent_yes', 'percent_value'].includes(i.agg)) continue;
      const list = lists[v.list];
      for (const p of String(i.positiveValue || '').split('|').filter(Boolean)) {
        assert.ok(list.codes.includes(p), `${i.code} : valeur comptée ${p} absente de ${v.list}`);
        assert.ok(!list.other.includes(p), `${i.code} : « Autre » compté positif`);
      }
      for (const na of i.naValues) {
        assert.ok(list.codes.includes(na), `${i.code} : hors base ${na} absent de ${v.list}`);
        // Retour 81 : « Autre » (999…) est une réponse — dans la base, jamais hors base.
        assert.ok(!list.other.includes(na), `${i.code} : « Autre » hors base`);
      }
    }
  }
});

test('« Autre » n\'est hors base nulle part, même hors des formulaires de la fixture', () => {
  for (const a of CATALOG.activities) {
    for (const i of a.items) assert.ok(!i.naValues.some((v) => ['999', '99', 'other'].includes(String(v))), i.code);
  }
});

test('corrections de l\'analyse des 5 XLSForm (docs/ANALYSE_XLSFORM.md § 2 à 6)', () => {
  const item = (code) => CATALOG.activities.flatMap((a) => a.items).find((i) => i.code === code);
  // GD : liaisons et libellés fidèles à la question.
  assert.equal(item('GD_DIGN_BREASTFEED'), undefined); // aucune option correspondante
  assert.equal(item('GD_DIGN_HEALTH'), undefined);
  assert.deepEqual(['GD_DIGN_HANDWASH', 'GD_DIGN_DISTANCE', 'GD_DIGN_PWD', 'GD_DIGN_HELPDESK', 'GD_DIGN_BOX'].map((c) => item(c).variables[0]),
    ['MODistPtsDign/5', 'MODistPtsDign/6', 'MODistPtsDign/9', 'MODistPtsDign/10', 'MODistPtsDign/11']);
  assert.match(item('GD_DPMC_TRAINED').label, /présents/);
  assert.match(item('GD_DPMC_EXISTS').label, /PV de nomination/);
  assert.equal(item('GD_WH_PALLETS').variables[0], 'MOWhStackPall/1');
  assert.deepEqual(item('GD_WH_PALLETS').warnings, ['base']); // question obligatoire sans condition
  assert.equal(item('GD_WH_STACKED').variables[0], 'MOWhStackProp');
  assert.match(item('GD_DUPLICATION').label, /présents dans la liste/);
  assert.deepEqual(item('GD_LIST_COMPLETE').variables, ['MODisListComplete']);
  assert.match(item('GD_TRAVEL_DAY').label, /avant la nuit/);
  assert.match(item('GD_MC_KNOW').label, /comité de gestion/);
  assert.match(item('GD_DIGN_QUEUE').label, /foules/);
  // « Je n'ai jamais reçu d'informations » : hors base pour « est-il affiché ? », réponse négative pour « avez-vous reçu ? ».
  assert.deepEqual(item('GD_HOTLINE_DISPLAYED').naValues, ['2']);
  assert.deepEqual(item('GD_INFO_RECEIVED').naValues, []);
  // SMP.
  assert.equal(item('SMP_COOKS_CONSENT'), undefined);
  assert.match(item('SMP_KITCHEN_CLEAN').label, /stockage/);
  assert.match(item('SMP_DEDICATED_STORAGE').label, /Gardien/);
  assert.match(item('SMP_DIVERSION').label, /directeur/);
  for (const c of ['SMP_STOCK_BALANCE', 'SMP_RECEIPT_MATCH', 'SMP_TEACHER_SATISF', 'SMP_TEACHER_INVOLVED']) assert.ok(item(c).warnings.includes('groupe'), c);
  assert.equal(item('SMP_RECEIPT_ANY').variables[0], 'any_received_match'); // repli « au moins une denrée »
  // MAM : libellés, FARNE.
  assert.match(item('MAM_CHILD_MUAC').label, /Bande MUAC/);
  assert.match(item('MAM_ADM_DISPLAYED').label, /Critères d'admission/);
  assert.match(item('MAM_EXIT_DISPLAYED').label, /Critères de sortie/);
  assert.ok(item('MAM_STOCK_MATCH').warnings.includes('groupe'));
  assert.ok(templateByKey('MAM').domains.some((d) => d.code === 'D6' && d.label === 'FARNE'));
  assert.ok(templateByKey('MAM').items.filter((i) => i.domain === 'D6').length >= 10);
  // MIARO : variables 0–100 et sans biais.
  assert.deepEqual([item('MIARO_NO_DELAY').variables[0], item('MIARO_NO_DELAY').agg, item('MIARO_NO_DELAY').positiveValue], ['r_no_delay', 'percent_yes', '1']);
  assert.equal(item('MIARO_SBCC_SATISF').variables[0], 'r_sbcc_satisf_pct');
  assert.equal(item('MIARO_DIGNITY').variables[0], 'r_dign_prop_pct');
  assert.deepEqual([item('MIARO_SBCC_APPLY').variables[0], item('MIARO_SBCC_APPLY').agg], ['r_sbcc_apply_pct', 'mean']);
  assert.ok(item('MIARO_ISSUES_OPEN').warnings.includes('groupe'));
  // « Nombre » compte toutes les réponses : la part des problèmes « En attente » (code 4) est un « % = valeur ».
  assert.deepEqual([item('MIARO_ISSUES_OPEN').agg, item('MIARO_ISSUES_OPEN').positiveValue, item('MIARO_ISSUES_OPEN').direction], ['percent_value', '4', 'lower_better']);
  // Jamais le parent d'un choix multiple (« 1 3 » n'est pas « 1 ») : seule l'option.
  assert.deepEqual(item('GD_WH_PALLETS').variables, ['MOWhStackPall/1']);
  // « PREVMA » seul = prévention (comme web/lib/activitySuggest) ; « GD_PREVMA » reste un indice GD.
  assert.ok(!templateByKey('GD').formHints.includes('PREVMA'));
  assert.ok(templateByKey('GD').formHints.includes('GD_PREVMA'));
  // « Moyenne × 100 » seulement sur une moyenne.
  for (const a of CATALOG.activities) for (const i of a.items) if ((i.warnings || []).includes('ratio')) assert.equal(i.agg, 'mean', i.code);
});

// Libellés des domaines au 14/10 : un domaine existant n'est JAMAIS renommé (les indicateurs déjà créés
// portent « D3 · … » dans `module` ; un autre libellé couperait le profil par module en deux).
const FROZEN_DOMAINS = {
  GD: { D1: 'Conformité gestion distribution', D2: 'Dignité et conditions site distribution', D3: 'AAP / redevabilité', D4: 'AAP / redevabilité', D5: 'Gouvernance du comité de gestion (DPMC)', D6: 'Entrepôt / stock', D7: 'Sécurité / intégrité', KPI: 'Chiffres clés', M1: 'Conditions de distribution', M2: 'Accès & transport', M3: 'Information & CFM', M4: 'Gestion nutrition', M5: 'Éléments de distribution', M7: 'Comité de gestion', M9: 'Sécurité' },
  SMP: { D1: 'Cuisine et préparation des repas', D3: 'Infrastructure WASH', D4: 'Stockage des vivres à l\'école', D5: 'Registres administratifs', D6: 'Gouvernance et organisation scolaire', D7: 'Perception programme (enseignants et ménages)', M1: 'Information & AAP', M2: 'Retour cuisinières', M4: 'Cuisine & équipement', M5: 'Pertes & gaspillage', M6: 'Stockage & documentation', M7: 'Service & distribution' },
  MAM: { D1: 'Documentation / traçabilité', D2: 'Protocole clinique / formation', D3: 'Distribution observée', D4: 'SBCC / sensibilisation', D5: 'Entrepôt / stock', M1: 'Mères (FGD/KII)', M2: 'Agent communautaire' },
  STUNT: { D1: 'Distribution / conformité', D3: 'Jardins potagers', KPI: 'Chiffres clés', M1: 'SBCC & sensibilisation', M2: 'AAP & gouvernance', M4: 'Distribution & SCOPE', M5: 'FARNE & nutrition', M6: 'Sécurité' },
};
// Codes du 14/10 : un code existant ne change jamais (template_code des indicateurs créés). Seuls trois sont retirés.
const FROZEN_CODES = `GD_DIST_LIST_NUT GD_LIST_MATCH GD_LIST_COMPLETE GD_BEN_CHECK_NUT GD_SCOPE_USE GD_ENT_MARKED_NUT GD_ENT_CALC
GD_DUPLICATION GD_SIGNED_LIST GD_BENEF_OTHER GD_BENEF_OTHER_ASSISTED GD_DIST_DIV_OBS GD_FRAUD_OBS GD_BEN_CHECK GD_BEN_CHECK_BIO
GD_DIST_LIST GD_DIGN_QUEUE GD_DIGN_SHADE GD_DIGN_SEATS GD_DIGN_LATRINES GD_DIGN_CHILDREN GD_DIGN_WATER GD_INFO_SESSION
GD_HOTLINE_DISPLAYED GD_CFM_VISIBLE GD_STAFF_VISIBLE GD_STAFF_MIXED GD_PRIOR_VULN GD_HELPDESK GD_VISIBILITY GD_KNOW_FREQ
GD_INFO_RECEIVED GD_MC_KNOW GD_RESPECT GD_NOT_PAID GD_PAY_TRANSPORT GD_TRAVEL_DAY GD_CFM_USED GD_CFM_KNOW GD_CFM_SUPPORT
GD_MC_REPORTS GD_NO_SECURITY_INCIDENT GD_WAIT_2H GD_ARMED GD_DIVERSION_HH GD_FRAUD_HH GD_SAFE_ACCESS GD_DPMC_PRESENT_DIST
GD_DPMC_EXISTS GD_DPMC_TRAINED GD_DPMC_ROLES GD_DPMC_REPORT GD_WH_CONDITION GD_WH_PALLETS GD_WH_STOCK_RECORD GD_WH_DELIVERY
GD_WH_DAMAGED_ISOL SMP_CFM_USED SMP_CFM_KNOW SMP_CFM_SUPPORT SMP_COOKS_INCENTIVE SMP_COOKS_CHALLENGE SMP_COOKS_SUGGEST
SMP_COOKS_TRAINED_FGD SMP_COOKS_RATION SMP_MGMT_COMMITTEE SMP_KITCHEN_ONSITE SMP_UTENSILS SMP_KITCHEN_VENT SMP_KITCHEN_CLEAN
SMP_INF_FREE SMP_HIGH_RISK_FOODS SMP_NO_PESTS SMP_COOK_WATER SMP_FRIDGE_TEMP SMP_FREEZER SMP_STORED_OPT_TEMP SMP_COOKED_OBS
SMP_FOOD_STORED_APPROP SMP_CLEAN_AGENT_LAB SMP_CLEAN_AGENT_USED SMP_CLEAN_AGENT_STORED SMP_EQUIP_CLEAN SMP_WASH_COOK_WATER
SMP_WASH_COOK_AREA SMP_WASH_EAT_AREA SMP_WASH_HANDWASH SMP_WASH_LATRINES SMP_FOOD_STORED SMP_ON_PALLETS SMP_STORE_SECURE
SMP_ADEQ_SIZE SMP_WH_DRAIN SMP_NO_EXPIRED SMP_WH_VENT SMP_WH_STACK_PROP SMP_STACK_CARDS SMP_WH_GRAIN_PRIOR SMP_WH_TARPS
SMP_WH_BAD_COM SMP_WH_BAD_COM_ISOL SMP_DISPOSAL SMP_STOCK_BALANCE SMP_RECEIPT_MATCH SMP_FOOD_DISTR_OBS SMP_FOOD_PREP_AGR
SMP_DOC_WAYBILL SMP_DOC_CONSUMPTION SMP_DOC_ATTENDANCE SMP_DOC_STOCK SMP_DOC_CASHBOOK SMP_DOC_NFI SMP_DOC_CONTRIB SMP_DOC_SUPPLIERS
SMP_MENU_DISPLAYED SMP_COOKS_TRAINED SMP_DEDICATED_STORAGE SMP_COMPL_ACT SMP_TEACHER_SATISF SMP_TEACHER_INVOLVED SMP_DIVERSION
MAM_ACCESS_DIFF MAM_TECH_LAST_VISIT MAM_SENSITIZED MAM_INFO MAM_KNOW_USE MAM_REC_ADOPT MAM_TECH_USEFUL MAM_TECH_VISIT
MAM_REG_VISITS MAM_CAPACITY MAM_AC_TRAINED MAM_REG_UPTODATE MAM_REG_EXITS MAM_DIST_LIST MAM_LIST_COMPLETE MAM_REGISTER MAM_ON_TIME
MAM_SITE_ORG MAM_SCREENING MAM_RATION MAM_SCREEN_CORRECT MAM_HEAD_TRAINED MAM_ADM_CRIT MAM_CHILD_MUAC MAM_PROTOCOL MAM_SCALE
MAM_ADM_DISPLAYED MAM_EXIT_DISPLAYED MAM_WOMEN_MUAC MAM_HEIGHT_BOARD MAM_AGENT_MASTERY MAM_MOTHERS_PARTICIPATE MAM_SBCC_LOCAL_LANG
MAM_SBCC_SESSION MAM_STOCK_MATCH MIARO_SBCC_MSG MIARO_SBCC_SATISF MIARO_SBCC_PARTIC MIARO_SBCC_APPLY MIARO_NO_DELAY MIARO_CFM_USED
MIARO_KNOW_RIGHTS MIARO_HELP_CFM MIARO_MC_FUNC MIARO_GARDEN_FENCED MIARO_GARDEN_IRRIG MIARO_GARDEN_SEED MIARO_DIGNITY
MIARO_SCOPE_OK MIARO_ON_TIME MIARO_NO_DIV_OBS MIARO_LIST_MATCH MIARO_FARNE_LOCAL MIARO_FARNE_MUAC MIARO_FARNE_REFCSB
MIARO_NO_SEC_INC MIARO_DIST_LIST MIARO_LIST_SIGNED MIARO_REGISTER MIARO_ENT_CALC MIARO_BEN_CHECK MIARO_SPI MIARO_ISSUES_OPEN`.split(/\s+/);

test('stabilité : codes et libellés de domaine du 14/10 inchangés (indicateurs déjà créés)', () => {
  for (const [key, domains] of Object.entries(FROZEN_DOMAINS)) {
    const t = templateByKey(key);
    for (const [code, label] of Object.entries(domains)) {
      assert.equal(t.domains.find((d) => d.code === code)?.label, label, `${key}.${code}`);
    }
  }
  const codes = new Set(CATALOG.activities.flatMap((a) => a.items.map((i) => i.code)));
  assert.deepEqual(FROZEN_CODES.filter((c) => !codes.has(c)), []);
});

test('éléments rangés par domaine : notés (D, R), puis complémentaires (M), puis chiffres clés', () => {
  for (const a of CATALOG.activities) {
    const rank = (d) => (/^KPI$/.test(d) ? 2 : /^M/.test(d) ? 1 : 0);
    const seen = [];
    for (const i of a.items) if (seen[seen.length - 1] !== i.domain) seen.push(i.domain);
    assert.equal(new Set(seen).size, seen.length, `${a.key} : un domaine en un seul bloc (${seen.join(' ')})`);
    assert.deepEqual(seen.map(rank), [...seen.map(rank)].sort(), a.key);
  }
});

test('modèle de l\'activité retrouvé par la catégorie du MMR : casse, accents, espaces, libellés équivalents', () => {
  assert.equal(templateForActivity(` ${GD.toUpperCase()} `).key, 'GD');
  assert.equal(templateForActivity('School  meal   Activities').key, 'SMP'); // espaces intérieurs (retour 85)
  assert.equal(templateForActivity('Activités de repas scolaires').key, 'SMP');
  assert.equal(templateForActivity('prévention de la malnutrition').key, 'STUNT');
  // Résilience : petits producteurs (principale), création d'actifs et adaptation au climat (alsoFor).
  assert.equal(templateForActivity('Smallholder agricultural market support activities').key, 'RES');
  assert.equal(templateForActivity('Asset creation and livelihood support activities').key, 'RES');
  assert.equal(templateForActivity('Climate adaptation and risk management activities').key, 'RES');
  assert.equal(templateForActivity('Activité inconnue'), null);
  assert.equal(templateForActivity(null), null);
  assert.equal(mmrKey('  École   Repas '), 'ecole repas');
});

test('catégorie du MMR du compte pour un modèle : la principale, sinon une couverte, sinon un équivalent ; sinon null', () => {
  const res = templateByKey('RES');
  assert.equal(tenantCategoryFor(res, ['School meal activities', 'Smallholder  agricultural market support activities']), 'Smallholder  agricultural market support activities');
  assert.equal(tenantCategoryFor(res, ['Asset creation and livelihood support activities']), 'Asset creation and livelihood support activities');
  assert.equal(tenantCategoryFor(templateByKey('SMP'), ['Cantines scolaires']), 'Cantines scolaires');
  assert.equal(tenantCategoryFor(templateByKey('SMP'), ['Nutrition treatment activities']), null);
});

const TPL = {
  domains: [{ code: 'D1', label: 'Conformité gestion distribution' }, { code: 'D7', label: 'Sécurité / intégrité' }],
  items: [
    { code: 'LIST', label: 'Liste bénéficiaires disponible', domain: 'D1', agg: 'percent_yes', positiveValue: '1', direction: 'higher_better', variables: ['MODistrList_nut', 'MODistrList'], naValues: [] },
    { code: 'ARMED', label: 'Personnel armé présent', domain: 'D7', agg: 'percent_yes', positiveValue: '1', direction: 'lower_better', variables: ['MOArmedPers'], naValues: ['9999'], scored: true },
    { code: 'DIGN', label: 'Toilettes séparées hommes / femmes', domain: 'D1', agg: 'percent_value', positiveValue: '1', direction: 'higher_better', variables: ['MODistPtsDign/4'], naValues: [] },
    { code: 'HELP', label: 'Un service d\'assistance est-il présent sur le site ?', domain: 'D1', agg: 'percent_yes', positiveValue: '1', direction: 'higher_better', variables: ['HelpDeskX'], naValues: ['9999'] },
    { code: 'NONE', label: 'Question absente du formulaire', domain: 'D1', agg: 'percent_yes', positiveValue: '1', direction: 'higher_better', variables: ['Zzz'], naValues: [] },
  ],
};
const YESNO = [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }];

test('variable proposée : nom du modèle, autre nom connu, colonne éclatée SPSS, libellé proche, ou rien', () => {
  const fields = [
    { name: 'MODistrList', label: 'Une liste complète de distribution est-elle utilisée ?', choices: YESNO },
    { name: 'moarmedpers', label: 'Du personnel armé est-il présent ?', choices: YESNO },
    { name: 'MODistPtsDign.4' },
    { name: 'MOHelpDesk', label: 'Un service d\'assistance est-il présent sur le site', choices: YESNO },
  ];
  const s = Object.fromEntries(suggestBindings(TPL, fields).map((x) => [x.code, x]));
  assert.deepEqual([s.LIST.field, s.LIST.confidence], ['MODistrList', 'probable']);
  assert.deepEqual([s.ARMED.field, s.ARMED.confidence], ['moarmedpers', 'sure']);
  assert.deepEqual([s.DIGN.field, s.DIGN.confidence], ['MODistPtsDign.4', 'sure']);
  assert.deepEqual([s.HELP.field, s.HELP.confidence], ['MOHelpDesk', 'a_verifier']);
  assert.deepEqual([s.NONE.field, s.NONE.confidence], [null, null]);
});

test('valeur positive : celle du modèle si la liste la contient, sinon le « Oui » de la liste', () => {
  const item = { agg: 'percent_yes', positiveValue: '1' };
  assert.equal(positiveFor(item, { choices: YESNO }), '1');
  assert.equal(positiveFor(item, { choices: [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }] }), 'yes');
  assert.equal(positiveFor({ agg: 'percent_value', positiveValue: '1|2' }, { choices: [{ value: '1' }, { value: '2' }, { value: '3' }] }), '1|2');
  assert.equal(positiveFor(item, null), '1');
  // « % = valeur » : la valeur du modèle, JAMAIS le « Oui » de la liste (« 0 » = « N'a pas payé » compterait l'inverse).
  const notPaid = { agg: 'percent_value', positiveValue: '0' };
  assert.equal(positiveFor(notPaid, { choices: [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }] }), '0');
  assert.equal(positiveFor(notPaid, { choices: [{ value: '1', label: 'Oui' }, { value: '2', label: 'Non' }] }), '0');
  assert.equal(positiveFor({ agg: 'mean', positiveValue: null }, { choices: YESNO }), null);
});

test('indicateur créé depuis le modèle : domaine lisible, sens, réponses hors base de la liste, cible, lien au modèle', () => {
  const ind = indicatorFromItem(TPL, TPL.items[1], { sourceField: 'MOArmedPers', positiveValue: '1' }, 3);
  assert.equal(ind.module, 'D7 · Sécurité / intégrité');
  assert.equal(ind.direction, 'lower_better');
  assert.deepEqual(ind.naValues, ['9999']);
  assert.equal(ind.templateCode, 'ARMED');
  assert.equal(ind.scored, true);
  assert.equal(ind.target, null);
  assert.equal(moduleLabel(TPL, 'X9'), 'X9');
  // Codes hors base retenus pour la liste réelle (« Autre » retiré) et cible du modèle.
  const smp = templateByKey('SMP');
  const days = smp.items.find((i) => i.code === 'SMP_DAYS_SERVED');
  const out = indicatorFromItem(smp, days, { sourceField: 'DIRNBSchMealsProvided', positiveValue: null, naValues: [] }, 0);
  assert.equal(out.target, 20);
  assert.deepEqual(out.naValues, []);
});
