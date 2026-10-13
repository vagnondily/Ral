/**
 * Catalogue des variables d'une fiche, pour choisir la variable d'un
 * indicateur (et compléter une formule) — logique PURE, sans I/O, testée.
 *
 * Une fiche a quatre sortes de variables :
 *   - question : un champ du XLSForm (ou du .sav) avec son libellé ;
 *   - option   : une colonne « éclatée » d'une question à choix multiples —
 *                « X.k » (export SPSS) ou « X/k » (export Excel/CSV) vaut 1 si
 *                le choix k est coché, 0 sinon. Libellée « question — choix »
 *                depuis la liste de choix du XLSForm, elle devient choisissable ;
 *   - data     : une colonne vue dans les données importées, absente du catalogue ;
 *   - calc     : un champ calculé de la fiche (ƒ).
 * Même identité de variable que le calcul : le nom exact d'abord, puis une
 * variante de casse (monitoringMath.namesFor) ; « X/k » et « X.k » désignent
 * la même option (indicatorTemplates.nameKey).
 */
const { closest } = require('./calcFields');

const SELECT_MULTIPLE = /^select_multiple\b/i;
// Colonne éclatée : « parent.choix » ou « parent/choix » (le choix ne contient ni « . » ni « / »).
const OPTION_NAME = /^(.+)[./]([^./]+)$/;
// Valeurs d'une colonne éclatée (libellés traduits à l'affichage).
const OPTION_CHOICES = Object.freeze([{ value: '1', label: 'sélectionné' }, { value: '0', label: 'non sélectionné' }]);
const DEFAULT_MAX_CHOICES = 40;

const lower = (s) => String(s == null ? '' : s).toLowerCase();

function choicesOf(choicesByList, list) {
  if (!list || !choicesByList) return [];
  const c = choicesByList instanceof Map ? choicesByList.get(list) : choicesByList[list];
  return Array.isArray(c) ? c : [];
}

/**
 * Décrit toutes les variables d'une fiche.
 * @param {object} input
 * @param {Array<{name, label?, type?, group?, listName?}>} [input.catalog]  champs du XLSForm / .sav
 * @param {Map<string, Array<{value,label}>>|object} [input.choicesByList]  listes de choix
 * @param {string[]} [input.dataKeys]  colonnes vues dans les soumissions
 * @param {Array<{name, label?, id?}>} [input.calcFields]  champs calculés
 * @param {Map<string, number>|object} [input.fill]  réponses renseignées par variable (échantillon)
 * @param {number} [input.maxChoices]  au-delà, la liste de choix n'est pas jointe (lieux, écoles…)
 * @returns {Array<{ name, label, kind: 'question'|'option'|'data'|'calc', type, group, choices,
 *   filled: number|null, parent?: string, choice?: string }>}
 */
function describeVariables({ catalog = [], choicesByList = null, dataKeys = [], calcFields = [], fill = null, maxChoices = DEFAULT_MAX_CHOICES } = {}) {
  const byLower = new Map();
  for (const f of catalog) if (f && f.name && !byLower.has(lower(f.name))) byLower.set(lower(f.name), f);
  const filledOf = (name) => {
    if (!fill) return null;
    const v = fill instanceof Map ? fill.get(name) : fill[name];
    return v == null ? 0 : Number(v);
  };
  const optionOf = (name) => {
    const m = OPTION_NAME.exec(String(name));
    if (!m) return null;
    const parent = byLower.get(lower(m[1]));
    if (!parent || !SELECT_MULTIPLE.test(String(parent.type || ''))) return null;
    const choice = choicesOf(choicesByList, parent.listName).find((c) => String(c.value) === m[2]);
    return { parent, value: m[2], label: choice && choice.label ? String(choice.label) : null };
  };
  const optionEntry = (name, opt, own = {}) => ({
    name,
    label: own.label && own.label !== name ? own.label : `${opt.parent.label || opt.parent.name} — ${opt.label || opt.value}`,
    kind: 'option',
    type: 'option',
    group: opt.parent.group || own.group || null,
    choices: OPTION_CHOICES.map((c) => ({ ...c })),
    filled: filledOf(name),
    parent: opt.parent.name,
    choice: opt.value,
  });

  const out = [];
  const seen = new Set();
  for (const f of catalog) {
    if (!f || !f.name || seen.has(lower(f.name))) continue;
    seen.add(lower(f.name));
    const opt = optionOf(f.name);
    if (opt) { out.push(optionEntry(f.name, opt, f)); continue; }
    const choices = choicesOf(choicesByList, f.listName);
    out.push({
      name: f.name,
      label: f.label || null,
      kind: 'question',
      type: f.type || null,
      group: f.group || null,
      choices: choices.length <= maxChoices ? choices.map((c) => ({ value: String(c.value), label: c.label == null ? null : String(c.label) })) : [],
      filled: filledOf(f.name),
    });
  }
  for (const k of dataKeys || []) {
    if (!k || seen.has(lower(k))) continue;
    seen.add(lower(k));
    const opt = optionOf(k);
    out.push(opt ? optionEntry(k, opt) : { name: k, label: null, kind: 'data', type: null, group: null, choices: [], filled: filledOf(k) });
  }
  for (const c of calcFields || []) {
    if (!c || !c.name) continue;
    // Un champ calculé du même nom qu'une colonne la remplace dans le calcul (withCalc) : il est listé comme tel.
    const at = out.findIndex((v) => lower(v.name) === lower(c.name));
    const entry = { name: c.name, label: c.label || null, kind: 'calc', type: 'calculate', group: null, choices: [], filled: c.filled == null ? null : Number(c.filled) };
    if (at >= 0) out.splice(at, 1, entry); else out.push(entry);
  }
  return out;
}

/**
 * Variable d'un indicateur parmi les variables connues de la fiche : le nom
 * exact d'abord, puis une variante de casse (même règle que le calcul). Sinon,
 * erreur lisible avec la variable la plus proche.
 * @param {string} name
 * @param {Iterable<string>} known
 * @returns {{ name: string } | { error: string, suggestion: string|null }}
 */
function resolveVariable(name, known) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return { error: 'Choisissez la variable source.', suggestion: null };
  const list = [...(known || [])].filter(Boolean).map(String);
  if (list.includes(n)) return { name: n };
  const ci = list.find((k) => k.toLowerCase() === n.toLowerCase());
  if (ci) return { name: ci };
  const hint = closest(n, list);
  return {
    error: `Variable « ${n} » introuvable dans cette fiche${hint ? ` — vouliez-vous dire « ${hint} » ?` : ' (ni dans le formulaire, ni dans les données, ni parmi les champs calculés).'}`,
    suggestion: hint || null,
  };
}

/** Nom du parent d'une colonne éclatée (« X.3 » → « X »), sinon null. */
function optionParentName(name) {
  const m = OPTION_NAME.exec(String(name || ''));
  return m ? m[1] : null;
}

module.exports = { describeVariables, resolveVariable, optionParentName, OPTION_CHOICES, SELECT_MULTIPLE };
