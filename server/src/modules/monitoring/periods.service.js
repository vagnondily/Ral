const repo = require('./monitoring.repository');
const { defaultPeriod } = require('../common/period');

/**
 * Périodes des écrans d'analyse (GET /api/monitoring/periods) : volume de
 * données reçues par mois (et par fiche) pour le sélecteur de mois, et LA
 * période par défaut (common/period.defaultPeriod) — la même pour la Synthèse
 * et « Couverture & performance ».
 *
 * Volume = formulaires reçus (hors exclus). Les visites planifiées ne sont pas
 * des données : un mois entièrement planifié mais sans formulaire ne doit pas
 * rouvrir un écran vide (retour n° 16).
 */
async function periods(tenantId, { todayMonth }) {
  const rows = await repo.monthCounts(tenantId);
  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month, submissions: 0, byForm: {} });
    const m = byMonth.get(r.month);
    m.submissions += r.n;
    m.byForm[r.formId] = r.n;
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, future: m.month > todayMonth }));
  const def = defaultPeriod(months.map((m) => ({ month: m.month, n: m.submissions })), todayMonth);
  return { today: todayMonth, months, latestMonth: def.latestMonth, default: def };
}

module.exports = { periods };
