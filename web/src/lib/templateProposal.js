/**
 * Carte du modèle d'indicateurs d'une fiche (retours 66 et 85) — fonctions PURES
 * de l'interface, sans DOM ni API, testées depuis server/test/templateProposalView.test.js.
 *
 * La RÈGLE (quel modèle, quelle variable, ce qui est coché d'office, ce qui a
 * changé depuis la création) est au serveur : server/src/modules/monitoring/
 * indicatorProposals.js. Ici seulement :
 *  - les mots affichés pour chaque code renvoyé (jamais un code nu à l'écran :
 *    un code inconnu prend un libellé générique) ;
 *  - l'état des cases, avec UNE fonction (rowSelectable) pour la case, le compte
 *    du bouton et l'envoi : on envoie exactement ce que la carte montre coché.
 * Phrases françaises traduites par tr() à l'affichage.
 */
import { formatInt } from './format.js';

/** Méthodes de calcul (mêmes mots que l'éditeur d'indicateur). */
export const AGG_LABEL = { percent_yes: '% de « oui »', percent_value: '% = valeur', mean: 'Moyenne', sum: 'Somme', count: 'Nombre' };

/** Qualité de la variable proposée (indicatorTemplates.suggestBindings) : couleur + icône + libellé. */
export const CONFIDENCE = {
  sure: { label: 'Trouvée', tone: 'green', icon: 'check' },
  probable: { label: 'Probable', tone: 'blue', icon: 'link' },
  a_verifier: { label: 'À vérifier', tone: 'orange', icon: 'warn' },
};
export const NO_CONFIDENCE = { label: 'Sans variable', tone: null, icon: 'none' };

/**
 * Avertissements des éléments du modèle (indicatorTemplates.json `warnings`).
 *  - sens : le sens « plus haut = mieux » n'est pas évident pour cette question ;
 *  - groupe : question d'un groupe répété, que l'import ne lit pas encore ;
 *  - base : % calculé sur toutes les visites (question obligatoire) ;
 *  - ratio : moyenne d'une part, affichée × 100.
 */
export const WARNING_LABEL = {
  sens: 'Sens à confirmer : un taux plus élevé n\'est pas forcément meilleur',
  groupe: 'Question d\'un sous-tableau : pas encore importée',
  base: 'Base : toutes les visites (question obligatoire)',
  ratio: 'Moyenne × 100',
};
const WARNING_FALLBACK = 'Avertissement du modèle : à vérifier';

/** Défauts de la variable proposée (indicatorProposals.bindItem `issues`). */
export const ISSUE_LABEL = {
  type: 'Type de la variable incompatible avec la méthode',
  positive: 'Valeur comptée absente de la liste de choix',
};
const ISSUE_FALLBACK = 'Variable à vérifier';

export const warningLabel = (code) => WARNING_LABEL[code] || WARNING_FALLBACK;
export const issueLabel = (code) => ISSUE_LABEL[code] || ISSUE_FALLBACK;

/** Types XLSForm en mots (message d'une variable refusée). Un type inconnu reste tel que le formulaire le nomme. */
export const TYPE_LABEL = {
  select_one: 'choix unique',
  select_multiple: 'choix multiples',
  option: 'option d\'un choix multiple',
  integer: 'nombre entier',
  decimal: 'nombre décimal',
  calculate: 'calcul',
  range: 'échelle',
  text: 'texte',
  date: 'date',
  datetime: 'date et heure',
  geopoint: 'point GPS',
  note: 'note',
};
/** Type d'une variable en mots, traduit ; un type que l'interface ne connaît pas reste tel que le formulaire le nomme. */
export function typeText(type, tr) {
  const t = String(type == null ? '' : type).trim();
  const base = t.toLowerCase().split(/\s+/)[0];
  if (TYPE_LABEL[base]) return tr(TYPE_LABEL[base]);
  return t || tr('type inconnu');
}

/** Ce qui diffère entre un indicateur créé et le modèle actuel (indicatorProposals.templateDrift). */
export const DRIFT_KEY_LABEL = {
  sourceField: 'variable',
  agg: 'méthode',
  positiveValue: 'valeur comptée',
  naValues: 'réponses hors base',
  target: 'cible',
  direction: 'sens',
  label: 'libellé',
};
export const driftKeyLabel = (key) => DRIFT_KEY_LABEL[key] || 'définition';

/** Valeur lisible d'un élément de l'écart (méthode, sens, liste de codes, vide). */
export function driftValue(key, value, tr) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (key === 'agg') return AGG_LABEL[value] ? tr(AGG_LABEL[value]) : String(value);
  if (key === 'direction') return tr(value === 'lower_better' ? 'plus bas = mieux' : 'plus haut = mieux');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/**
 * État d'un indicateur à mettre à jour.
 *  - blocked : la variable du modèle n'est pas (encore) dans cette fiche — la
 *    mise à jour n'est pas proposée d'un clic : appliquer le reste (méthode,
 *    valeur comptée) à l'ANCIENNE variable donnerait un indicateur faux ;
 *  - updatable : une modification à envoyer par PATCH existe et rien ne bloque.
 * @returns {null|{ kind, former, blocked, updatable, changes, patch }}
 */
export function driftState(item) {
  const drift = item && item.existing && item.existing.drift;
  if (!drift) return null;
  const changes = drift.changes || [];
  const patch = drift.patch || {};
  const blocked = changes.some((c) => c.key === 'sourceField' && c.to == null);
  return { kind: drift.kind, former: Boolean(drift.former), blocked, updatable: !blocked && Object.keys(patch).length > 0, changes, patch };
}

/** Part des éléments d'un modèle trouvés dans la fiche, en pourcentage entier (0–100). */
export function coveragePct(ratio) {
  return formatInt(Math.round((Number(ratio) || 0) * 100));
}

/** Cases de départ : SEULEMENT la précoche du serveur (jamais une sous-table, jamais un type incompatible). */
export function initialRows(items) {
  const rows = {};
  for (const it of items || []) {
    const s = it.suggestion || {};
    rows[it.code] = {
      on: Boolean(s.preselect) && !it.existing && !it.taken,
      field: (it.existing && it.existing.sourceField) || s.field || '',
      positive: (it.existing ? it.existing.positiveValue : s.positiveValue) ?? '',
    };
  }
  return rows;
}

/**
 * Une ligne peut-elle être cochée ? La même réponse pour la case, le compte du
 * bouton « Créer N indicateur(s) » et l'envoi.
 * @returns {{ ok: boolean, reason: null|'locked'|'no_field'|'unknown_field'|'positive_required' }}
 */
export function rowSelectable(item, row, fieldNames) {
  if (!item || item.existing || item.taken) return { ok: false, reason: 'locked' };
  const field = row && row.field ? String(row.field) : '';
  if (!field) return { ok: false, reason: 'no_field' };
  if (!fieldNames.has(field)) return { ok: false, reason: 'unknown_field' };
  // « % = valeur » sans valeur comptée serait refusé par l'éditeur : à choisir d'abord.
  if (item.agg === 'percent_value' && !String(row.positive ?? '').trim()) return { ok: false, reason: 'positive_required' };
  return { ok: true, reason: null };
}

export const isChecked = (item, row, fieldNames) => Boolean(row && row.on) && rowSelectable(item, row, fieldNames).ok;

/** Ce qui est envoyé à « Créer » : exactement les lignes cochées à l'écran. */
export function checkedPayload(items, rows, fieldNames) {
  return (items || []).filter((it) => isChecked(it, rows[it.code], fieldNames)).map((it) => {
    const r = rows[it.code];
    const positive = String(r.positive ?? '').trim();
    return { code: it.code, sourceField: r.field, positiveValue: positive === '' ? null : positive };
  });
}

/**
 * Refus de « Créer » qui nomme un élément (400 `type_mismatch` de applyTemplate) :
 * { item, field, type, agg } pour l'afficher sur SA ligne, sinon null.
 */
export function itemError(err) {
  const d = err && err.details;
  if (!d || typeof d !== 'object' || !d.item) return null;
  return { code: d.code || null, item: String(d.item), field: d.field || null, type: d.type || null, agg: d.agg || null };
}
