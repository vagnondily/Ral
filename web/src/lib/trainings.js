// Formations en sessions (lot 8, retour 28.2) : statuts (couleur + icône + libellé), présence,
// format des pourcentages. Les chiffres viennent du serveur (trainingMath.js).

export const TRAINING_STATUS = {
  planifiee: { label: 'Planifiée', tone: 'blue', icon: 'clock' },
  realisee: { label: 'Réalisée', tone: 'green', icon: 'check' },
  annulee: { label: 'Annulée', tone: null, icon: 'ban' },
};

export const ATTENDANCE = [
  { id: 'present', label: 'Présent' },
  { id: 'partiel', label: 'Partiel' },
  { id: 'absent', label: 'Absent' },
];

/** « 75 % » (format de la langue via tr), « — » sans valeur. */
export const formatPct = (x, tr) => (x == null ? '—' : tr('{p} %', { p: x }));

// ---- Grille des participants (présence, jours, notes, avis) — logique PURE, testée
// (server/test/webTrainings.test.js). Revue du lot 8 :
//  - on n'envoie QUE les champs modifiés de chaque ligne (deux personnes qui saisissent la même
//    formation ne s'écrasent plus : le serveur garde ce qui n'est pas envoyé) ;
//  - une cellule illisible (« 15/20 », « 2j ») est REFUSÉE, jamais envoyée comme « vide » ;
//  - une saisie en cours survit au rechargement de la page (ajout, retrait, synthèse).
export const PARTICIPANT_FIELDS = ['attendance', 'daysPresent', 'preScore', 'postScore', 'satisfaction', 'feedback'];
const NUMERIC_FIELDS = new Set(['daysPresent', 'preScore', 'postScore']);
const cell = (v) => (v == null ? '' : String(v));
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

/** Ligne éditable (chaînes) d'un participant tel que rendu par le serveur. */
export function editableParticipant(p) {
  return { ...p, attendance: p.attendance || '', daysPresent: cell(p.daysPresent), preScore: cell(p.preScore), postScore: cell(p.postScore),
    satisfaction: cell(p.satisfaction), feedback: p.feedback || '' };
}

/** Nombre saisi : vide → null ; « 15,5 » → 15.5 ; illisible → { ok: false } (jamais null en silence). */
export function readNumber(v) {
  const t = cell(v).trim().replace(',', '.');
  if (t === '') return { ok: true, value: null };
  return NUMBER_RE.test(t) ? { ok: true, value: Number(t) } : { ok: false, value: null };
}

function fieldValue(k, v) {
  if (NUMERIC_FIELDS.has(k)) return readNumber(v);
  if (k === 'satisfaction') return { ok: true, value: cell(v) === '' ? null : Number(v) };
  if (k === 'attendance') return { ok: true, value: v || null };
  return { ok: true, value: cell(v).trim() || null };
}
const changedFields = (row, loaded) => PARTICIPANT_FIELDS.filter((k) => cell(row[k]) !== cell(loaded[k]));

/**
 * Ce qu'il faut envoyer : pour chaque participant MODIFIÉ, ses seuls champs modifiés. Une cellule
 * illisible donne une erreur (agent, champ) et RIEN n'est envoyé.
 * @param {object[]} rows          lignes éditées (editableParticipant + saisie)
 * @param {object[]} participants  participants chargés du serveur
 * @returns {{ patches: object[], errors: Array<{agentId, agentName, field}>, dirty: boolean }}
 */
export function participantPatches(rows, participants) {
  const loaded = new Map((participants || []).map((p) => [p.agentId, editableParticipant(p)]));
  const patches = []; const errors = [];
  for (const r of rows || []) {
    const l = loaded.get(r.agentId);
    if (!l) continue;
    const ks = changedFields(r, l);
    if (!ks.length) continue;
    const patch = { agentId: r.agentId };
    for (const k of ks) {
      const v = fieldValue(k, r[k]);
      if (v.ok) patch[k] = v.value; else errors.push({ agentId: r.agentId, agentName: r.agentName, field: k });
    }
    patches.push(patch);
  }
  return { patches: errors.length ? [] : patches, errors, dirty: patches.length > 0 || errors.length > 0 };
}

/**
 * Rechargement de la formation (ajout, retrait, synthèse, informations) PENDANT une saisie : les
 * champs saisis localement (différents de l'état chargé précédent) sont GARDÉS, le reste prend les
 * valeurs du serveur ; un participant ajouté apparaît, un retiré disparaît.
 */
export function mergeParticipantRows(rows, prevParticipants, nextParticipants) {
  const prev = new Map((prevParticipants || []).map((p) => [p.agentId, editableParticipant(p)]));
  const mine = new Map((rows || []).map((r) => [r.agentId, r]));
  return (nextParticipants || []).map((p) => {
    const fresh = editableParticipant(p);
    const r = mine.get(p.agentId); const before = prev.get(p.agentId);
    if (!r || !before) return fresh;
    return { ...fresh, ...Object.fromEntries(changedFields(r, before).map((k) => [k, r[k]])) };
  });
}
