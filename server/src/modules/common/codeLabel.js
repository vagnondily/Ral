/**
 * « Jamais un code sans son nom » (retour n° 19) — règle PURE, sans I/O, testée
 * (server/test/codeLabel.test.js), d'affichage d'une valeur codée d'un
 * formulaire reçu (bureau aujourd'hui ; partenaire, agent demain) :
 *
 *   1. 'relie'     — un objet MEMS est rattaché (correspondance manuelle ou lien
 *                    automatique déjà stocké sur la soumission) : son NOM ;
 *   2. 'libelle'   — pas de rattachement, mais la fiche donne un libellé (liste
 *                    « sav: » de l'export SPSS ou liste du XLSForm) : ce libellé ;
 *   3. 'non_relie' — le code seul : « Code 6 (non relié) », avec la fiche, pour
 *                    proposer de le relier dans ses Correspondances ;
 *   4. 'vide'      — valeur absente : « (non renseigné) ».
 *
 * Clé de regroupement : `id:<uuid>` / `lib:<libellé normalisé>` /
 * `code:<formId>:<code>` / `vide`. Un code non relié n'est JAMAIS fusionné
 * d'une fiche à l'autre : le bureau 6 de la fiche GD (Ambovombe) n'est pas le
 * bureau 6 de la fiche Résilience (Toliara).
 *
 * La requête SQL (monitoring.repository.officeLabelSql) applique exactement la
 * même règle ; ce module est la référence lisible et celle des traitements JS.
 */

const NOT_SET = '(non renseigné)';

const clean = (v) => (v == null ? '' : String(v).trim());
/** Libellé normalisé pour la clé : casse et espaces sans effet (même règle que le SQL). */
const normLabel = (v) => clean(v).toLowerCase().replace(/\s+/g, ' ');

/**
 * @param {{ raw?:string, linkedId?:string|null, linkedName?:string|null,
 *           choiceLabel?:string|null, formId?:string|null }} v
 * @returns {{ key:string, name:string|null, status:'relie'|'libelle'|'non_relie'|'vide',
 *             code:string|null, formId:string|null }}
 */
function resolveCodeLabel({ raw, linkedId = null, linkedName = null, choiceLabel = null, formId = null } = {}) {
  const code = clean(raw) || null;
  if (linkedId) return { key: `id:${linkedId}`, name: clean(linkedName) || code, status: 'relie', code, formId: null };
  const label = clean(choiceLabel);
  // Un « libellé » identique au code n'apprend rien : la valeur reste un code non relié.
  if (label && label !== code) return { key: `lib:${normLabel(label)}`, name: label, status: 'libelle', code, formId: null };
  if (code) return { key: `code:${formId || ''}:${code}`, name: null, status: 'non_relie', code, formId: formId || null };
  return { key: 'vide', name: null, status: 'vide', code: null, formId: null };
}

/** Vrai pour un code numérique (« 6 ») ; un texte (« Bureau terrain Sud ») se lit déjà comme un nom. */
const isNumericCode = (code) => /^\d+$/.test(clean(code));

/**
 * Texte lisible (français, langue de référence) d'une valeur résolue :
 * le nom, sinon « Code 6 (non relié) » (ou le texte saisi, s'il n'est pas un
 * code numérique : « Bureau terrain Sud (non relié) »), sinon « (non renseigné) ».
 * `formLabel` précise la fiche d'un code non relié quand plusieurs fiches sont mêlées.
 */
function codeLabelText(v, { formLabel = null } = {}) {
  if (!v || v.status === 'vide') return NOT_SET;
  if (v.name) return v.name;
  const base = isNumericCode(v.code) ? `Code ${v.code} (non relié)` : `${v.code} (non relié)`;
  return formLabel ? `${base} · ${formLabel}` : base;
}

/**
 * Additionne les lignes qui partagent une clé (`key`), dans l'ordre de première
 * apparition ; les champs numériques listés sont sommés, les autres gardés.
 */
function mergeByKey(rows, numericFields) {
  const out = new Map();
  for (const r of rows || []) {
    const cur = out.get(r.key);
    if (!cur) { out.set(r.key, { ...r }); continue; }
    for (const f of numericFields) cur[f] = (Number(cur[f]) || 0) + (Number(r[f]) || 0);
  }
  return [...out.values()];
}

module.exports = { resolveCodeLabel, codeLabelText, mergeByKey, normLabel, isNumericCode, NOT_SET };
