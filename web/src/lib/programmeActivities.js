/**
 * Activités de programme (suivi de processus) côté écran — migration 105.
 *
 * Une seule source pour toutes les listes de saisie (sites, MMR, fiches, visites, gabarit du
 * plan…) : GET /api/programme-activities, mis en cache pour la session et rechargé après chaque
 * modification du Paramétrage. La valeur enregistrée reste le LIBELLÉ officiel de l'activité ;
 * une valeur existante est retrouvée par sa clé normalisée (même règle que le serveur :
 * server/src/modules/programmes/activityKey.js, parité testée).
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { activityKey } from './activityKey.js';

export { activityKey };

let cache = null;      // Promise<Array> partagée
const listeners = new Set();

/** Liste des activités (avec leurs sous-activités), une requête par session. */
export function loadProgrammeActivities({ force = false } = {}) {
  if (!cache || force) {
    cache = api.listProgrammeActivities().catch((e) => { cache = null; throw e; });
    cache.then((list) => listeners.forEach((fn) => fn(list))).catch(() => {});
  }
  return cache;
}

/** À appeler après une modification du référentiel : les listes ouvertes se rechargent. */
export function invalidateProgrammeActivities() {
  cache = null;
  if (listeners.size) loadProgrammeActivities().catch(() => {});
}

/**
 * Hook : { activities, error } — activities = null pendant le chargement.
 * Les activités désactivées restent dans la liste (valeur courante d'un formulaire) ; les
 * sélecteurs ne les proposent pas pour une nouvelle saisie.
 */
export function useProgrammeActivities() {
  const [activities, setActivities] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    const onList = (list) => { if (alive) setActivities(list); };
    listeners.add(onList);
    loadProgrammeActivities().then(onList).catch((e) => { if (alive) { setError(e); setActivities([]); } });
    return () => { alive = false; listeners.delete(onList); };
  }, []);
  return { activities, error };
}

/** Activité désignée par un texte (libellé, code ou libellé court), ou null. */
export function findActivity(activities, text) {
  const k = activityKey(text);
  if (!k || !activities) return null;
  return activities.find((a) => activityKey(a.label) === k || activityKey(a.code) === k || (a.shortLabel && activityKey(a.shortLabel) === k)) || null;
}

/** Sous-activité (Activity_tag) d'un code, avec son activité ; null sinon. */
export function findSubActivity(activities, code) {
  const k = activityKey(code);
  if (!k || !activities) return null;
  for (const a of activities) {
    const s = (a.subActivities || []).find((x) => activityKey(x.code) === k);
    if (s) return { ...s, activity: a };
  }
  return null;
}

/** Libellé affiché d'une activité : « Libellé officiel » (libellé court entre parenthèses s'il existe). */
export const activityOptionLabel = (a) => (a.shortLabel ? `${a.label} (${a.shortLabel})` : a.label);

/** Clés « Utilisé par » (mêmes clés que le serveur, activityRef.USAGE_LABELS) → phrase à traduire. */
export const USAGE_TEXT = {
  sites: ['{n} site', '{n} sites'],
  mmr: ['{n} exigence MMR', '{n} exigences MMR'],
  forms: ['{n} fiche de suivi', '{n} fiches de suivi'],
  visits: ['{n} visite de terrain', '{n} visites de terrain'],
  pdd: ['{n} ligne du PDD', '{n} lignes du PDD'],
  subActivities: ['{n} sous-activité', '{n} sous-activités'],
  contracts: ['{n} contrat', '{n} contrats'],
  budgetLines: ['{n} ligne de budget FLA', '{n} lignes de budget FLA'],
  postes: ['{n} poste de facture ou de plan', '{n} postes de facture ou de plan'],
};

/** « 12 sites, 3 exigences MMR » traduit, depuis [{ key, count }] (détails d'un refus 409). */
export function usagePhrase(tr, linked = []) {
  return linked.map((l) => {
    const pair = USAGE_TEXT[l.key];
    return pair ? tr(pair[l.count === 1 ? 0 : 1], { n: l.count }) : `${l.count} ${l.label || l.key}`;
  }).join(', ');
}

/**
 * Message d'une erreur d'API sur une activité, dans la langue de l'écran : activité inconnue
 * (avec propositions), sous-activité d'une autre activité, données reliées ; sinon le message
 * du serveur.
 */
export function activityErrorText(tr, e) {
  const d = e && e.details;
  if (d && d.code === 'unknown_activity') {
    return d.suggestions && d.suggestions.length
      ? tr('Activité inconnue « {value} » — vouliez-vous dire {suggestions} ? Créez-la dans Paramétrage › Activités.',
        { value: d.value, suggestions: d.suggestions.map((s) => `« ${s} »`).join(tr(' ou ')) })
      : tr('Activité inconnue « {value} ». Créez-la dans Paramétrage › Activités.', { value: d.value });
  }
  if (d && d.code === 'unknown_sub_activity') return tr('Sous-activité inconnue « {value} ». Créez-la dans Paramétrage › Activités.', { value: d.value });
  if (d && d.code === 'sub_activity_mismatch') {
    return tr('La sous-activité « {value} » appartient à « {owner} », pas à « {activity} ».', { value: d.value, owner: d.owner, activity: d.activity });
  }
  if (d && d.code === 'activity_required') return tr('Activité requise : choisissez-la dans la liste (Paramétrage › Activités).');
  if (d && d.reason === 'linked_data' && Array.isArray(d.linked)) {
    return tr('Suppression impossible : utilisé par {what}.', { what: usagePhrase(tr, d.linked) });
  }
  return (e && e.message) || tr('Erreur inattendue.');
}
