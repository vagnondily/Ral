/**
 * Planification automatique (lot 5) — fonctions d'affichage PURES (testées depuis
 * server/test/webPlanGen.test.js) : libellés des raisons (pourquoi un site est proposé,
 * pourquoi il ne l'est pas), phrase de synthèse des besoins (agents, véhicules), propositions
 * mêlées aux coches manuelles de la grille, catalogue des paramètres du compte.
 * Le serveur rend des CODES et des nombres ; ce module en fait des phrases (passées
 * par `tr`, donc traduites) — jamais un texte figé côté serveur.
 */

/** Pourquoi une visite est proposée (code `why` du calcul). Ton + clé d'icône. */
export const WHY = {
  urgent: { label: 'Recommandation urgente', tone: 'red', icon: 'urgent' },
  echeance: { label: 'Dernier mois possible', tone: 'orange', icon: 'deadline' },
  du: { label: 'Visite due selon le MMR', tone: 'blue', icon: 'due' },
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
  plus_tard: { label: 'Prévu plus tard dans l\'exercice', tone: 'blue', icon: 'later' },
  intervalle: { label: 'Visité récemment (écart minimal)', tone: 'gray', icon: 'interval' },
  deja_couvert: { label: 'Déjà suivi sur l\'exercice', tone: 'green', icon: 'covered' },
  besoin_couvert: { label: 'Visites dues déjà faites ou prévues', tone: 'green', icon: 'covered' },
  non_du: { label: 'Priorité non retenue', tone: 'gray', icon: 'low' },
  acces: { label: 'Commune exclue (accès)', tone: 'gray', icon: 'access' },
  hors_calendrier: { label: 'L\'activité ne tourne pas ce mois', tone: 'gray', icon: 'calendar' },
  inactif: { label: 'Inactif ce mois', tone: 'gray', icon: 'inactive' },
  zone_interdite: { label: 'Zone interdite', tone: 'red', icon: 'forbidden' },
  annulee: { label: 'Visite annulée ce mois', tone: 'gray', icon: 'cancelled' },
  sans_mmr: { label: 'Activité absente du MMR', tone: 'gray', icon: 'unknown' },
};
export const POSTPONE_ORDER = Object.keys(POSTPONE);

/** Niveaux de priorité (couleur + libellé ; l'icône est choisie par l'écran). */
export const LEVELS = {
  haute: { label: 'Haute', tone: 'red', phrase: 'priorité haute', skipped: 'Priorité haute non retenue dans les critères' },
  moyenne: { label: 'Moyenne', tone: 'orange', phrase: 'priorité moyenne', skipped: 'Priorité moyenne non retenue dans les critères' },
  basse: { label: 'Basse', tone: 'green', phrase: 'priorité basse', skipped: 'Priorité basse non retenue dans les critères' },
};

/** Stratégies (retours 107 et 108) : une phrase chacune, à l'écran. */
export const STRATEGIES = {
  besoins: {
    label: 'Planifier selon les besoins du MMR',
    help: 'Chaque site reçoit les visites exigées par le MMR, à l\'écart minimal, dans ses mois actifs ; MEMS en déduit les agents et les véhicules nécessaires.',
  },
  capacite: {
    label: 'Limiter à la capacité déclarée',
    help: 'Le plan ne dépasse pas la capacité du MMR (agents × suivis par jour × jours ouvrés) ; les sites passent dans l\'ordre du RBM.',
  },
};

/** Ce que la planification reprend d'ailleurs (lecture seule) : titre, icône, lien. */
export const READ_ONLY_META = {
  univers: { title: 'Sites concernés', icon: 'sites', href: '#/processus/rbm/sites', link: 'Sites (actifs / inactifs)' },
  exigence: { title: 'Exigence du MMR', icon: 'mmr', href: '#/processus/rbm/configuration/mmr', link: 'Exigences (MMR)' },
  rythme: { title: 'Rythme de terrain', icon: 'pace', href: '#/processus/rbm/configuration/mmr', link: 'Exigences (MMR)' },
  priorite: { title: 'Ordre de priorité', icon: 'priority', href: '#/processus/rbm/priorites', link: 'Priorités du mois' },
  budget: { title: 'Plafond budgétaire TPM', icon: 'budget', href: null, link: null },
  prestataire: { title: 'Prestataire du contrat', icon: 'provider', href: null, link: null },
};

const RISK = { elevee: 'élevé', moyenne: 'moyen', faible: 'faible' };
const SIGNAL = {
  security: 'restriction stricte', fraud: 'fraude', issuesProcess: 'problème de suivi interne urgent',
  issuesPartnerReport: 'problème de rapport partenaire urgent', issuesCFM: 'plainte urgente (CFM)',
};

export const pendingKey = (siteId, month) => `${siteId}|${month}`;

/**
 * Phrase « pourquoi ce site est proposé » (info-bulle de la case et liste de l'aperçu).
 * @param {object} p proposition { why, reason, level, anchor, agent, fieldDay, date, detail:{since,last,gate,risk,signals,required,visitNo} }
 * @param {(phrase:string, vars?:object)=>string} tr
 * @param {(id:string)=>string|null} nameOf nom du site d'ancrage d'un regroupement
 */
export function proposalText(p, tr, nameOf = () => null) {
  const d = p.detail || {};
  const parts = [];
  const lvl = LEVELS[p.level];
  const risk = d.risk ? tr(RISK[d.risk] || d.risk) : null;
  if (p.reason === 'urgent' || p.why === 'urgent') {
    const sig = (d.signals || []).map((s) => tr(SIGNAL[s.code] || s.code)).join(', ');
    parts.push(sig ? tr('Recommandation urgente : {s}', { s: sig }) : tr('Recommandation urgente'));
  } else if (p.reason === 'echeance') {
    parts.push(tr('Dernier mois possible pour tenir les {r} visites du MMR (écart minimal {g} mois)', { r: d.required ?? '—', g: d.gate ?? '—' }));
  } else if (p.reason === 'couverture') {
    parts.push(tr('Objectif de couverture : pas encore suivi sur l\'exercice'));
  } else if (p.reason === 'anticipee' || p.why === 'anticipee') {
    parts.push(tr('Anticipée : due bientôt, place libre dans une journée déjà prévue'));
  } else if (d.required) {
    parts.push(tr('Visite {n} sur {r} exigées par le MMR', { n: d.visitNo ?? '—', r: d.required }));
    if (d.since == null) parts.push(risk ? tr('risque {r}, jamais visité', { r: risk }) : tr('jamais visité'));
    else parts.push(tr('dernière visite il y a {n} mois (écart minimal {g} mois)', { n: d.since, g: d.gate ?? '—' }));
  } else {
    if (d.since == null) parts.push(risk ? tr('Dû : risque {r}, jamais visité', { r: risk }) : tr('Dû : jamais visité'));
    else parts.push(tr('Dû : risque {r}, dernière visite il y a {n} mois (intervalle {g} mois)', { r: risk || '—', n: d.since, g: d.gate ?? '—' }));
  }
  if (lvl && p.reason !== 'couverture') parts.push(tr(lvl.phrase));
  const anchor = p.anchor ? nameOf(p.anchor) : null;
  if (p.why === 'meme_lieu') parts.push(anchor ? tr('regroupé avec {a} (même lieu)', { a: anchor }) : tr('regroupé (même lieu)'));
  if (p.why === 'meme_commune') parts.push(anchor ? tr('regroupé avec {a} (même commune)', { a: anchor }) : tr('regroupé (même commune)'));
  if (p.why === 'meme_district') parts.push(anchor ? tr('regroupé avec {a} (même district)', { a: anchor }) : tr('regroupé (même district)'));
  if (p.agent) parts.push(tr('Agent {a}, jour de terrain {f}', { a: p.agent, f: p.fieldDay }));
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
      if (d.since == null) return tr('L\'écart minimal de {g} mois ne laisse plus de place dans l\'exercice', { g: d.gate ?? '—' });
      return tr('Dernière visite il y a {n} mois : intervalle de {g} mois non atteint', { n: d.since ?? '—', g: d.gate ?? '—' });
    case 'plus_tard': return d.next ? tr('Prévu en {m} : la charge est répartie sur l\'exercice', { m: monthName(d.next) }) : tr('Prévu plus tard dans l\'exercice');
    case 'besoin_couvert': return tr('Les {r} visites exigées par le MMR sont déjà faites ou prévues', { r: d.required ?? '—' });
    case 'acces': return tr('Commune exclue de ce plan (accès)');
    case 'inactif': return mo ? tr('Inactif en {m} (grille Sites actifs / inactifs)', { m: mo }) : tr('Inactif ce mois (grille Sites actifs / inactifs)');
    case 'non_du': return LEVELS[d.level] ? tr(LEVELS[d.level].skipped) : tr('Pas prioritaire ce mois');
    case 'capacite_visites': return tr('Capacité de visites de l\'activité atteinte ce mois');
    case 'capacite_jours': return tr('Journées-agent de l\'activité épuisées ce mois');
    case 'capacite_exercice': return tr('Capacité de l\'exercice épuisée (faisable × durée)');
    case 'quota_couverture': return tr('Quota de couverture du mois atteint (réparti sur les mois restants)');
    case 'deja_couvert': return tr('Déjà suivi sur l\'exercice (une visite par site)');
    case 'hors_calendrier': return tr('L\'activité ne tourne pas ce mois (durée MMR)');
    case 'zone_interdite': return tr('Zone interdite : suivi à distance uniquement');
    case 'annulee': return tr('Visite annulée ce mois : décision respectée');
    case 'sans_mmr': return tr('Activité absente du MMR : à paramétrer');
    default: return tr((POSTPONE[u.code] || {}).label || u.code);
  }
}

/**
 * Synthèse des besoins (cœur de l'aperçu, retour 108) : phrases traduites, puis les écarts
 * par bureau et par mois (« Il manque 3 agents en novembre à Ampanihy »).
 * @param {object} result aperçu du serveur
 * @param {{ tr, monthName:(m:number)=>string, num:(n:number)=>string }} fmt
 * @returns {{ lead:string[], gaps:string[] }}
 */
export function needsStatement(result, { tr, monthName, num = (n) => String(n) }) {
  const t = result.totals || {};
  const n = result.needs;
  const lead = [];
  const end = monthName(result.toMonth);
  if (result.strategy === 'capacite') {
    lead.push(tr('La capacité déclarée au MMR limite le plan à {p} visites d\'ici {e} ; le MMR en demande {r} sur l\'exercice ({d} déjà faites ou prévues).',
      { p: num(t.proposals), e: end, r: num(t.requiredYear || 0), d: num(t.doneYear || 0) }));
  } else {
    lead.push(tr('Le MMR demande {r} visites sur l\'exercice pour {s} sites ({d} déjà faites ou prévues). D\'ici {e}, {p} visites sont planifiées, au moins {j} sites par mois selon le MMR.',
      { r: num(t.requiredYear || 0), s: num(t.eligible || 0), d: num(t.doneYear || 0), e: end, p: num(t.proposals), j: num(Math.ceil(t.mmrPerMonth || 0)) }));
    if (t.unmet > 0) lead.push(tr('{u} visite(s) ne tiennent plus dans l\'exercice : l\'écart minimal entre deux visites ne laisse plus de place.', { u: num(t.unmet) }));
  }
  if (n && n.months.length) {
    const days = n.months.reduce((a, m) => a + m.agentDays, 0);
    lead.push(tr('Regroupées par commune, toutes activités, elles demandent {d} journées-agent : {a} agent(s) au mois le plus chargé ({m}) et {v} véhicule(s) au jour le plus chargé ({k} agents par véhicule).',
      { d: num(days), a: num(n.peak.agents), m: n.peak.agentsMonth ? monthName(n.peak.agentsMonth) : '—', v: num(n.peak.vehicles), k: num(n.agentsPerVehicle) }));
    const peak = n.months.find((m) => m.month === n.peak.agentsMonth);
    if (peak && peak.declared != null) {
      lead.push(peak.gap > 0
        ? tr('Le MMR déclare {p} personne(s) : il en manque {g} ce mois-là.', { p: num(peak.declared), g: num(peak.gap) })
        : tr('Le MMR déclare {p} personne(s) : c\'est suffisant.', { p: num(peak.declared) }));
    } else lead.push(tr('Le MMR ne déclare pas de personnes : l\'écart n\'est pas calculé.'));
  }
  const gaps = [];
  for (const o of (n && n.offices) || []) {
    if (o.gap > 0) gaps.push(tr('Il manque {g} agent(s) en {m} à {b} ({a} nécessaires, {p} déclarés) ; {v} véhicule(s) au jour le plus chargé.',
      { g: num(o.gap), m: monthName(o.month), b: o.officeName || tr('Sans bureau'), a: num(o.agentsNeeded), p: num(o.declared), v: num(o.vehiclesPeak) }));
  }
  return { lead, gaps };
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

/**
 * Communes du registre pour les exclure d'un plan (accès) : couples district × commune
 * uniques, avec leur nombre de sites, triés par district puis commune.
 * @param {{district?:string, commune?:string}[]} sites lignes du Plan de suivi
 */
export function communeChoices(sites = []) {
  const map = new Map();
  for (const s of sites) {
    const commune = String(s.commune || '').trim(); if (!commune) continue;
    const district = String(s.district || '').trim();
    const k = `${district.toLowerCase()}|${commune.toLowerCase()}`;
    const cur = map.get(k) || { key: k, district, commune, sites: 0 };
    cur.sites += 1; map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => a.district.localeCompare(b.district, 'fr') || a.commune.localeCompare(b.commune, 'fr'));
}

/* ------------------------------------------------ Paramètres de la planification (§ 6.4) */

/**
 * Catalogue des paramètres enregistrés du compte (carte « Paramètres de la planification »).
 * Retours 107 et 108 : seulement ce que le MMR, le RBM et les contrats ne disent pas. Les
 * bornes viennent du serveur (`bounds`), jamais d'ici.
 */
export const SETTING_GROUPS = [
  {
    id: 'plan', title: 'Plan et ressources', fields: [
      { key: 'strategy', label: 'Stratégie par défaut', type: 'choice', options: [['besoins', STRATEGIES.besoins.label], ['capacite', STRATEGIES.capacite.label]] },
      { key: 'agentsPerVehicle', label: 'Agents par véhicule', type: 'number', unit: 'agents', help: 'Agents qui partent ensemble dans un véhicule : sert à compter les véhicules nécessaires.' },
      { key: 'fieldDaysPerMonth', label: 'Jours de terrain par agent et par mois', type: 'number', unit: 'jours', help: 'Utilisé seulement quand la colonne « jours ouvrés » du MMR est vide.' },
    ],
  },
];
export const SETTING_FIELDS = SETTING_GROUPS.flatMap((g) => g.fields);

/** Copie indépendante d'un jeu de paramètres. */
export const cloneSettings = (s) => ({ ...(s || {}) });

/** Clés dont la valeur diffère entre deux jeux, dans l'ordre du catalogue. */
export function settingsDiff(values = {}, base = {}) {
  return SETTING_FIELDS.map((f) => f.key).filter((k) => values[k] !== base[k]);
}

/**
 * Contrôle de saisie AVANT l'envoi (le serveur revérifie tout, et la base aussi) : nombres
 * entiers dans les bornes du serveur. @returns {{ [key]: { code, min?, max? } }} (vide = valide)
 */
export function settingsErrors(values = {}, bounds = {}) {
  const out = {};
  for (const f of SETTING_FIELDS) {
    if (f.type !== 'number') continue;
    const v = values[f.key];
    const [min, max] = bounds[f.key] || [-Infinity, Infinity];
    if (v === '' || v === null || v === undefined || !Number.isFinite(Number(v))) out[f.key] = { code: 'required', min, max };
    else if (Number(v) < min || Number(v) > max) out[f.key] = { code: 'range', min, max };
    else if (!Number.isInteger(Number(v))) out[f.key] = { code: 'integer', min, max };
  }
  return out;
}

/**
 * Valeur lisible d'un paramètre (valeur initiale affichée sous le champ).
 * @param {object} f entrée du catalogue  @param {*} v valeur
 * @param {(phrase:string, vars?:object)=>string} tr
 */
export function settingText(f, v, tr) {
  if (!f) return String(v);
  if (f.type === 'choice' || f.type === 'select') { const o = f.options.find(([k]) => k === v); return o ? tr(o[1]) : String(v); }
  if (f.unit === 'agents') return tr('{n} agent(s)', { n: v });
  if (f.unit === 'jours') return tr('{n} jour(s)', { n: v });
  return String(v);
}
