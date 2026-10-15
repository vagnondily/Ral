/**
 * Planification automatique (lot 5) — fonctions d'affichage PURES (testées depuis
 * server/test/webPlanGen.test.js) : libellés des raisons (pourquoi un site est proposé,
 * pourquoi il ne l'est pas), propositions mêlées aux coches manuelles de la grille.
 * Le serveur rend des CODES et des nombres ; ce module en fait des phrases (passées
 * par `tr`, donc traduites) — jamais un texte figé côté serveur.
 */

/** Pourquoi une visite est proposée (code `why` du générateur). Ton + clé d'icône. */
export const WHY = {
  urgent: { label: 'Recommandation urgente', tone: 'red', icon: 'urgent' },
  du: { label: 'Dû selon le RBM et le MMR', tone: 'blue', icon: 'due' },
  meme_lieu: { label: 'Même lieu (multi-activités)', tone: 'blue', icon: 'place' },
  meme_commune: { label: 'Même commune', tone: 'blue', icon: 'commune' },
  meme_district: { label: 'Même district (tournée)', tone: 'blue', icon: 'district' },
  couverture: { label: 'Objectif de couverture', tone: 'green', icon: 'coverage' },
  anticipee: { label: 'Anticipée', tone: 'orange', icon: 'ahead' },
};

/** Pourquoi un site n'est pas proposé (code de report), du plus actionnable au moins. */
export const POSTPONE = {
  capacite_visites: { label: 'Capacité de visites atteinte', tone: 'orange', icon: 'capacity' },
  capacite_jours: { label: 'Journées-agent épuisées', tone: 'orange', icon: 'days' },
  capacite_exercice: { label: 'Capacité de l\'exercice épuisée', tone: 'orange', icon: 'year' },
  quota_couverture: { label: 'Quota de couverture du mois atteint', tone: 'gray', icon: 'coverage' },
  intervalle: { label: 'Visité récemment (intervalle)', tone: 'gray', icon: 'interval' },
  deja_couvert: { label: 'Déjà suivi sur l\'exercice', tone: 'green', icon: 'covered' },
  non_du: { label: 'Priorité non retenue', tone: 'gray', icon: 'low' },
  hors_calendrier: { label: 'L\'activité ne tourne pas ce mois', tone: 'gray', icon: 'calendar' },
  inactif: { label: 'Inactif ce mois', tone: 'gray', icon: 'inactive' },
  zone_interdite: { label: 'Zone interdite', tone: 'red', icon: 'forbidden' },
  annulee: { label: 'Visite annulée ce mois', tone: 'gray', icon: 'cancelled' },
  sans_mmr: { label: 'Activité absente du MMR', tone: 'gray', icon: 'unknown' },
};
export const POSTPONE_ORDER = Object.keys(POSTPONE);

/** Niveaux de priorité (couleur + libellé ; l'icône est choisie par l'écran). */
export const LEVELS = {
  haute: { label: 'Haute', tone: 'red' },
  moyenne: { label: 'Moyenne', tone: 'orange' },
  basse: { label: 'Basse', tone: 'green' },
};

const RISK = { elevee: 'élevé', moyenne: 'moyen', faible: 'faible' };
const SIGNAL = {
  security: 'restriction stricte', fraud: 'fraude', issuesProcess: 'problème de suivi interne urgent',
  issuesPartnerReport: 'problème de rapport partenaire urgent', issuesCFM: 'plainte urgente (CFM)',
};

export const pendingKey = (siteId, month) => `${siteId}|${month}`;

/**
 * Phrase « pourquoi ce site est proposé » (info-bulle de la case et liste de l'aperçu).
 * @param {object} p proposition { why, reason, level, anchor, detail:{since,last,gate,risk,signals} }
 * @param {(phrase:string, vars?:object)=>string} tr
 * @param {(id:string)=>string|null} nameOf nom du site d'ancrage d'un regroupement
 */
export function proposalText(p, tr, nameOf = () => null) {
  const d = p.detail || {};
  const parts = [];
  const lvl = LEVELS[p.level];
  if (p.reason === 'urgent' || p.why === 'urgent') {
    const sig = (d.signals || []).map((s) => tr(SIGNAL[s.code] || s.code)).join(', ');
    parts.push(sig ? tr('Recommandation urgente : {s}', { s: sig }) : tr('Recommandation urgente'));
  } else if (p.reason === 'couverture') {
    parts.push(tr('Objectif de couverture : pas encore suivi sur l\'exercice'));
  } else if (p.reason === 'anticipee' || p.why === 'anticipee') {
    parts.push(tr('Anticipée : due bientôt, place libre dans une journée déjà prévue'));
  } else {
    const risk = d.risk ? tr(RISK[d.risk] || d.risk) : null;
    if (d.since == null) parts.push(risk ? tr('Dû : risque {r}, jamais visité', { r: risk }) : tr('Dû : jamais visité'));
    else parts.push(tr('Dû : risque {r}, dernière visite il y a {n} mois (intervalle {g} mois)', { r: risk || '—', n: d.since, g: d.gate ?? '—' }));
  }
  if (lvl && p.reason !== 'couverture') parts.push(tr('priorité {l}', { l: tr(lvl.label).toLowerCase() }));
  const anchor = p.anchor ? nameOf(p.anchor) : null;
  if (p.why === 'meme_lieu') parts.push(anchor ? tr('regroupé avec {a} (même lieu)', { a: anchor }) : tr('regroupé (même lieu)'));
  if (p.why === 'meme_commune') parts.push(anchor ? tr('regroupé avec {a} (même commune)', { a: anchor }) : tr('regroupé (même commune)'));
  if (p.why === 'meme_district') parts.push(anchor ? tr('regroupé avec {a} (même district)', { a: anchor }) : tr('regroupé (même district)'));
  return parts.join(' · ');
}

/**
 * Phrase « pourquoi ce site n'est pas proposé » (raison principale de l'horizon).
 * @param {object} u { code, month, detail }
 * @param {(m:string)=>string} monthName libellé d'un mois « AAAA-MM »
 */
export function postponeText(u, tr, monthName = (m) => m, year = null) {
  const d = u.detail || {};
  const mo = u.month && year ? monthName(`${year}-${String(u.month).padStart(2, '0')}`) : null;
  switch (u.code) {
    case 'intervalle':
      if (d.next) return tr('Visite déjà prévue en {m} : trop proche (intervalle {g} mois)', { m: monthName(d.next), g: d.gate ?? '—' });
      return tr('Dernière visite il y a {n} mois : intervalle de {g} mois non atteint', { n: d.since ?? '—', g: d.gate ?? '—' });
    case 'inactif': return mo ? tr('Inactif en {m} (grille Sites actifs / inactifs)', { m: mo }) : tr('Inactif ce mois (grille Sites actifs / inactifs)');
    case 'non_du': return d.level ? tr('Priorité {l} non retenue dans les critères', { l: tr((LEVELS[d.level] || {}).label || d.level).toLowerCase() }) : tr('Pas prioritaire ce mois');
    case 'capacite_visites': return tr('Capacité de visites de l\'activité atteinte ce mois');
    case 'capacite_jours': return tr('Journées-agent de l\'activité épuisées ce mois');
    case 'capacite_exercice': return tr('Capacité de l\'exercice épuisée (faisable × durée)');
    case 'quota_couverture': return tr('Quota de couverture du mois atteint (réparti sur les mois restants)');
    case 'deja_couvert': return tr('Déjà suivi sur l\'exercice (une visite par site)');
    case 'hors_calendrier': return tr('L\'activité ne tourne pas ce mois (durée MMR)');
    case 'zone_interdite': return tr('Zone interdite : suivi à distance uniquement');
    case 'annulee': return tr('Visite annulée ce mois : décision respectée');
    case 'sans_mmr': return tr('Activité absente du MMR : aucune capacité');
    default: return tr((POSTPONE[u.code] || {}).label || u.code);
  }
}

/**
 * Coches de la grille = coches manuelles + propositions encore cochées. Une case manuelle
 * l'emporte sur une proposition. @returns {{ [key]: boolean }}
 */
export function mergePending(pending = {}, proposals = new Map(), excluded = new Set()) {
  const out = {};
  for (const [k] of proposals) if (!excluded.has(k)) out[k] = true;
  return { ...out, ...pending };
}

/** Propositions gardées (pour « Appliquer ») : ni décochées, ni remplacées par une coche manuelle. */
export function keptProposals(proposals = new Map(), excluded = new Set(), pending = {}) {
  const keep = [];
  for (const [k, p] of proposals) if (!excluded.has(k) && pending[k] === undefined) keep.push({ siteId: p.siteId, month: p.month });
  return keep;
}

/** Comptes par raison principale (sites non planifiés), dans l'ordre d'actionnabilité. */
export function countByReason(unplanned = []) {
  const counts = new Map();
  for (const u of unplanned) counts.set(u.code, (counts.get(u.code) || 0) + 1);
  return POSTPONE_ORDER.filter((c) => counts.has(c)).map((code) => ({ code, count: counts.get(code) }))
    .concat([...counts.keys()].filter((c) => !POSTPONE[c]).map((code) => ({ code, count: counts.get(code) })));
}

/** Part en % arrondie à l'unité (null si rien à mesurer). */
export const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);

/** Mois planifiables d'un exercice : du mois courant (exercice en cours) ou de janvier (à venir) à décembre. */
export function defaultHorizon(year, today = new Date()) {
  const y = today.getFullYear(); const m = today.getMonth() + 1;
  if (year < y) return null;
  return { from: year === y ? m : 1, to: 12 };
}
