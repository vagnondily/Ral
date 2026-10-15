/**
 * Synthèse RBM d'une liste de sites (lot 7a) — PURE, testée (test/rbmSummary.test.js).
 * Le calcul que le tableau de bord « Couverture & performance » fait aujourd'hui dans le
 * navigateur (sites suivis, à suivre, par niveau de risque), plus les compteurs du
 * concepteur de rapport : niveau calculé (finalScore), priorité, drapeaux urgents, zones
 * interdites, signaux de risque (raisons de rbmScore.scoreSite) — tout dérive des lignes de
 * field.repository.rbmSitesTx, rien n'est recalculé ici.
 */

const RISK_LEVELS = ['elevee', 'moyenne', 'faible'];
const RISK_LABELS = { elevee: 'Élevé', moyenne: 'Moyen', faible: 'Faible' };

/**
 * Sites d'un périmètre : bureau MEMS (lui ou ses antennes) et catégorie d'activité.
 * @param {object[]} sites lignes RBM (fieldOfficeId, activity)
 * @param {{ officeId?: string|null, activity?: string|null, parentOf?: Map<string,string|null> }} scope
 *   officeId 'unlinked' = sites sans bureau ; parentOf : bureau → bureau parent.
 */
function scopeSites(sites, { officeId = null, activity = null, parentOf = new Map() } = {}) {
  const act = activity ? String(activity).trim().toLowerCase() : null;
  return (sites || []).filter((s) => {
    if (officeId === 'unlinked' && s.fieldOfficeId) return false;
    if (officeId && officeId !== 'unlinked' && s.fieldOfficeId !== officeId && parentOf.get(s.fieldOfficeId) !== officeId) return false;
    if (act && String(s.activity || '').trim().toLowerCase() !== act) return false;
    return true;
  });
}

/**
 * Compteurs RBM d'une liste de sites (déjà filtrée).
 * @returns {{ total, due, upToDate, toPlan, neverVisited, urgent, forbidden, byRisk, byLevel, byPriority, flags }}
 *   byRisk : niveau de risque saisi (sites.risk_level) ; byLevel : niveau CALCULÉ (finalScore 0/1/2) ;
 *   flags  : [{ code, label, sites, urgent }] — sites par raison (scoreSite.reasons), urgents d'abord.
 */
function rbmSummary(sites) {
  const out = {
    total: 0, due: 0, upToDate: 0, toPlan: 0, neverVisited: 0, urgent: 0, forbidden: 0,
    byRisk: { elevee: 0, moyenne: 0, faible: 0 }, byLevel: { 0: 0, 1: 0, 2: 0 }, byPriority: { 0: 0, 1: 0, 2: 0 },
  };
  const flags = new Map();
  for (const s of sites || []) {
    out.total += 1;
    if (s.due) out.due += 1; else out.upToDate += 1;
    if (s.toPlan) out.toPlan += 1;
    if (s.neverVisited) out.neverVisited += 1;
    if (s.urgentFlags) out.urgent += 1;
    if (s.forbidden) out.forbidden += 1;
    if (RISK_LEVELS.includes(s.riskLevel)) out.byRisk[s.riskLevel] += 1;
    if (s.finalScore in out.byLevel) out.byLevel[s.finalScore] += 1;
    if (s.priority in out.byPriority) out.byPriority[s.priority] += 1;
    for (const r of s.reasons || []) {
      if (!flags.has(r.code)) flags.set(r.code, { code: r.code, label: r.label, sites: 0, urgent: 0 });
      const f = flags.get(r.code);
      f.sites += 1;
      if (r.urgent) f.urgent += 1;
    }
  }
  out.flags = [...flags.values()].sort((a, b) => b.urgent - a.urgent || b.sites - a.sites || a.code.localeCompare(b.code));
  return out;
}

/**
 * Compteurs de l'état RBM tels que les écrans les affichent (Synthèse, Couverture &
 * performance, Affectation & visites, Priorités du mois) — servis par
 * GET /api/tpm/field/rbm/counts au lieu de la liste complète des sites (≈ 1,3 Ko par site) :
 *   total, byRisk (niveau saisi), due (« à suivre », zones interdites comprises — Synthèse,
 *   Couverture), dueOpen (à suivre hors zones interdites — Priorités, même définition que
 *   « Générer »), toPlan (ce que « Générer » planifiera), upToDate = total − due.
 * Les drapeaux viennent des lignes de rbmSitesTx : rien n'est recalculé ici.
 */
function rbmCounts(sites) {
  const out = { total: 0, due: 0, dueOpen: 0, upToDate: 0, toPlan: 0, byRisk: { elevee: 0, moyenne: 0, faible: 0 } };
  for (const s of sites || []) {
    out.total += 1;
    if (s.due) { out.due += 1; if (!s.forbidden) out.dueOpen += 1; } else out.upToDate += 1;
    if (s.toPlan) out.toPlan += 1;
    if (RISK_LEVELS.includes(s.riskLevel)) out.byRisk[s.riskLevel] += 1;
  }
  return out;
}

/**
 * Sites à suivre, du plus prioritaire au moins prioritaire : drapeaux urgents, priorité,
 * niveau calculé, jamais visité, ancienneté de la dernière visite, nom — ordre déterministe.
 */
function dueSites(sites) {
  const last = (s) => s.lastVisitMonth || '';
  return (sites || []).filter((s) => s.due && !s.forbidden).sort((a, b) => (Number(b.urgentFlags) - Number(a.urgentFlags))
    || ((b.priority || 0) - (a.priority || 0)) || ((b.finalScore || 0) - (a.finalScore || 0))
    || last(a).localeCompare(last(b)) || String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
}

module.exports = { rbmSummary, rbmCounts, scopeSites, dueSites, RISK_LEVELS, RISK_LABELS };
