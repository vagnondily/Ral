/**
 * Planification automatique du suivi SUR UNE PÉRIODE (retour n° 82) — logique
 * PURE, testée, sans I/O. Répartit les visites à planifier sur les mois d'une
 * période « du … au … » selon des critères CONFIGURABLES, au lieu de ne générer
 * que le mois courant (`generateFromRbm`).
 *
 * Critères (`settings`) — tous facultatifs, valeurs par défaut = le comportement
 * RBM actuel :
 *   frequency        { elevee, moyenne, faible } : mois entre deux visites par
 *                    niveau de risque (défaut 1 / 2 / 3, comme rbmMath).
 *   capacityPerMonth nombre maximum de visites planifiées par mois (null = illimité).
 *   excludeMonths    ['YYYY-MM'] : mois où l'on ne planifie jamais (saison, congés).
 *   targetCoverage   objectif de couverture (0..1, défaut 0.8) — informatif (résumé).
 *
 * Entrée `sites` : [{ id, activity, riskLevel, forbidden, lastVisitMonth,
 *   busyMonths: ['YYYY-MM'…] (visite déjà présente, quel que soit le statut),
 *   inactiveMonths: ['YYYY-MM'…] (grille d'activation : site inactif ce mois) }].
 * `months` : les mois de la période, croissants ['YYYY-MM', …].
 *
 * Règles (cohérentes avec rbmMath / generateFromRbm) :
 *   - un site `forbidden` (zone interdite) n'est jamais planifié ;
 *   - cadence : 1ʳᵉ visite = max(lastVisit + fréquence, début de période) ; jamais
 *     avant la dernière visite réelle ; puis tous les `fréquence` mois ;
 *   - un mois exclu, inactif ou déjà occupé (busy) est sauté → reporté au prochain
 *     mois autorisé ; on ne crée jamais deux visites le même mois pour un site ;
 *   - priorité (pour la capacité) : risque élevé d'abord, puis le plus en retard
 *     (jamais visité avant tout), puis l'ordre d'entrée — la capacité d'un mois va
 *     aux sites les plus prioritaires ; le surplus glisse au prochain mois libre.
 */
const { frequencyFor, monthsBetween, addMonths, toMonth, DEFAULT_FREQUENCY } = require('./rbmMath');

const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };

function normalizeSettings(s = {}) {
  const f = s.frequency || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  const cap = s.capacityPerMonth;
  return {
    frequency: {
      elevee: num(f.elevee, DEFAULT_FREQUENCY.elevee),
      moyenne: num(f.moyenne, DEFAULT_FREQUENCY.moyenne),
      faible: num(f.faible, DEFAULT_FREQUENCY.faible),
    },
    capacityPerMonth: cap == null || cap === '' || !(Number(cap) > 0) ? null : Math.floor(Number(cap)),
    excludeMonths: [...new Set((s.excludeMonths || []).map(toMonth).filter(Boolean))],
    targetCoverage: Number.isFinite(Number(s.targetCoverage)) ? Math.min(1, Math.max(0, Number(s.targetCoverage))) : 0.8,
  };
}

/** Rang de priorité d'un site (élevé = traité d'abord pour la capacité). */
function priorityOf(site, firstMonth) {
  const risk = RISK_RANK[site.riskLevel] || RISK_RANK.moyenne;
  // Mois de retard au début de période : jamais visité = très en retard.
  const last = toMonth(site.lastVisitMonth);
  const overdue = last ? monthsBetween(last, firstMonth) : 9999;
  return { risk, overdue };
}

/**
 * Mois « cadencés » d'un site sur la période (avant capacité) : suite théorique
 * tous les `freq` mois, à partir de max(lastVisit+freq, début de période),
 * bornée à la période, hors mois exclus/inactifs/occupés (reportés au prochain
 * mois autorisé). Renvoie une liste croissante de 'YYYY-MM'.
 */
function cadenceMonths(site, months, freq, blocked) {
  if (!months.length) return [];
  const first = months[0];
  const last = months[months.length - 1];
  const allowed = months.filter((m) => !blocked.has(m) && !(site.inactiveMonths || []).includes(m) && !(site.busyMonths || []).includes(m));
  if (!allowed.length) return [];
  const lastVisit = toMonth(site.lastVisitMonth);
  // Mois « dû » de départ : lastVisit + fréquence, sinon le début de période.
  let due = lastVisit ? addMonths(lastVisit, freq) : first;
  if (!due || due < first) due = first;
  const out = [];
  let cursor = due;
  // Garde-fou : au plus un passage par mois de la période.
  for (let guard = 0; guard <= months.length && cursor && cursor <= last; guard += 1) {
    // Premier mois AUTORISÉ ≥ cursor.
    const m = allowed.find((x) => x >= cursor && !out.includes(x));
    if (!m) break;
    out.push(m);
    const next = addMonths(m, freq);
    if (!next || next <= m) break;
    cursor = next;
  }
  return out;
}

/**
 * Génère le plan de la période. Renvoie :
 *   assignments : [{ siteId, month, activity }] (croissant par mois puis priorité) ;
 *   perMonth    : [{ month, count }] pour chaque mois de la période ;
 *   summary     : compteurs (sites considérés, interdits, planifiés, non placés
 *                 faute de capacité, sites couverts au moins une fois, cible).
 */
function generatePlan(sites = [], settings = {}, months = []) {
  const cfg = normalizeSettings(settings);
  const mList = [...new Set((months || []).map(toMonth).filter(Boolean))].sort();
  const blocked = new Set(cfg.excludeMonths);
  const capacity = cfg.capacityPerMonth;
  const perMonthCount = new Map(mList.map((m) => [m, 0]));
  const openMonths = mList.filter((m) => !blocked.has(m));

  const considered = (sites || []).filter((s) => s && s.id);
  const forbidden = considered.filter((s) => s.forbidden);
  const active = considered.filter((s) => !s.forbidden);

  // Candidats (site, mois voulu), triés par priorité de site.
  const firstMonth = mList[0] || null;
  const ranked = active
    .map((s) => ({ s, p: priorityOf(s, firstMonth) }))
    .sort((a, b) => b.p.risk - a.p.risk || b.p.overdue - a.p.overdue);

  const assignments = [];
  const coveredSites = new Set();
  let unplaced = 0;
  const hasRoom = (m) => capacity == null || (perMonthCount.get(m) || 0) < capacity;

  for (const { s } of ranked) {
    const freq = frequencyFor(s.riskLevel, cfg.frequency);
    const wanted = cadenceMonths(s, mList, freq, blocked);
    const taken = new Set(); // mois déjà pris pour CE site dans ce plan
    for (const w of wanted) {
      let placed = null;
      if (hasRoom(w)) placed = w;
      else {
        // Glisser au prochain mois autorisé avec de la place, sans doubler ce site.
        placed = openMonths.find((m) => m >= w && hasRoom(m)
          && !taken.has(m) && !(s.busyMonths || []).includes(m) && !(s.inactiveMonths || []).includes(m));
      }
      if (!placed || taken.has(placed)) { if (!placed) unplaced += 1; continue; }
      taken.add(placed);
      perMonthCount.set(placed, (perMonthCount.get(placed) || 0) + 1);
      assignments.push({ siteId: s.id, month: placed, activity: s.activity || null, riskLevel: s.riskLevel || null });
      coveredSites.add(s.id);
    }
  }

  assignments.sort((a, b) => a.month.localeCompare(b.month)
    || (RISK_RANK[b.riskLevel] || 0) - (RISK_RANK[a.riskLevel] || 0)
    || String(a.siteId).localeCompare(String(b.siteId)));

  return {
    settings: cfg,
    months: mList,
    assignments,
    perMonth: mList.map((m) => ({ month: m, count: perMonthCount.get(m) || 0 })),
    summary: {
      sitesConsidered: considered.length,
      forbidden: forbidden.length,
      planned: assignments.length,
      sitesCovered: coveredSites.size,
      sitesActivePlannable: active.length,
      unplaced,
      targetCoverage: cfg.targetCoverage,
      coverageRate: active.length ? Math.round((coveredSites.size / active.length) * 1000) / 10 : null,
    },
  };
}

module.exports = { generatePlan, normalizeSettings, cadenceMonths, priorityOf, DEFAULT_SETTINGS: normalizeSettings() };
