/**
 * Lecture d'un XLSForm (Kobo/ODK) — logique pure. Extrait le catalogue de
 * champs (nom, type, libellé FR/EN, groupe) et les listes de choix depuis les
 * feuilles « survey » / « choices » / « settings ». Sert à alimenter le
 * « mapping paramétrable » du Suivi de processus : on peut configurer les
 * indicateurs d'une fiche dès l'import du formulaire, avant toute soumission.
 *
 * On ne garde que les champs de données réels : on ignore les begin/end group
 * et repeat, les notes et la structure. Le libellé privilégie le français.
 */

const SKIP_TYPES = new Set(['begin_group', 'end_group', 'begin_repeat', 'end_repeat', 'note', 'start', 'end', 'today', 'deviceid', 'audit']);

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
}

/** Index des colonnes par en-tête (ligne 1), tolérant aux variantes de langue. */
function headerIndex(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => { const k = String(h || '').trim().toLowerCase(); if (k) idx[k] = i; });
  const find = (...names) => {
    for (const n of names) if (idx[n] != null) return idx[n];
    // match par préfixe (label::French (fr) …)
    for (const key of Object.keys(idx)) if (names.some((n) => key.startsWith(n))) return idx[key];
    return -1;
  };
  return { idx, find };
}

/**
 * @param {Array<Array>} surveyRows   lignes brutes de la feuille survey (incl. en-tête)
 * @param {Array<Array>} choicesRows  lignes brutes de la feuille choices (incl. en-tête)
 * @param {Array<Array>} settingsRows lignes brutes de la feuille settings (incl. en-tête)
 */
function parseXlsformRows(surveyRows, choicesRows = [], settingsRows = []) {
  if (!surveyRows || surveyRows.length < 2) return { title: null, formId: null, fields: [], choices: {} };

  // ---- settings : form_title, form_id
  let title = null;
  let formId = null;
  if (settingsRows.length >= 2) {
    const { find } = headerIndex((settingsRows[0] || []).map(cellText));
    const r = settingsRows[1] || [];
    const ti = find('form_title'); const fi = find('form_id');
    if (ti >= 0) title = cellText(r[ti]) || null;
    if (fi >= 0) formId = cellText(r[fi]) || null;
  }

  // ---- choices : list_name → [{value, label}]
  const choices = {};
  if (choicesRows.length >= 2) {
    const { find } = headerIndex(choicesRows[0].map(cellText));
    const cList = find('list_name'); const cName = find('name');
    const cLabel = find('label::french (fr)', 'label::french', 'label', 'label::english (en)');
    for (let i = 1; i < choicesRows.length; i += 1) {
      const row = choicesRows[i] || [];
      const at = (c) => (c >= 0 ? cellText(row[c]) : '').trim();
      const list = at(cList);
      const val = at(cName);
      if (!list || !val) continue;
      if (!choices[list]) choices[list] = [];
      choices[list].push({ value: val, label: at(cLabel) || val });
    }
  }

  // ---- survey : champs de données + chemin de groupe
  const { find } = headerIndex(surveyRows[0].map(cellText));
  const cType = find('type'); const cName = find('name');
  const cLabel = find('label::french (fr)', 'label::french', 'label', 'label::english (en)');
  const fields = [];
  const groupStack = [];
  for (let i = 1; i < surveyRows.length; i += 1) {
    const row = surveyRows[i] || [];
    const at = (c) => (c >= 0 ? cellText(row[c]) : '').trim();
    const rawType = at(cType);
    if (!rawType) continue;
    const type = rawType.split(/\s+/)[0];
    const name = at(cName);
    const label = at(cLabel);
    if (type === 'begin_group' || type === 'begin_repeat') { groupStack.push(label || name); continue; }
    if (type === 'end_group' || type === 'end_repeat') { groupStack.pop(); continue; }
    if (SKIP_TYPES.has(type) || !name) continue;
    const listName = (type === 'select_one' || type === 'select_multiple') ? (rawType.split(/\s+/)[1] || null) : null;
    fields.push({ name, type, label: label || name, group: groupStack.join(' › ') || null, listName });
  }

  return { title, formId, fields, choices };
}

module.exports = { parseXlsformRows, cellText, headerIndex };
