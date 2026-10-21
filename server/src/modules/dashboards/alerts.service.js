const logger = require('../../config/logger');
const consolidationRepo = require('../tpm/consolidation.repository');
const contractsService = require('../contracts/contracts.service');
const reportsRepo = require('../tpm/reports.repository');
const fieldRepo = require('../tpm/field.repository');
const coverageService = require('./coverage.service');
const { reportActions, canWriteReports } = require('../tpm/reportWorkflow');
const { buildAlerts, countAlerts, LATE_REPORTS_LOOKBACK } = require('./alertsMath');
const { single, spanMonths, periodInfo, addMonths } = require('../common/period');
const { localDay } = require('../common/localDay');

/**
 * Centre d'alertes — UNE source pour la page et la cloche de l'en-tête.
 * Lit chaque module par son propre point d'entrée (consolidation, contrats,
 * rapports, résumé des visites), toujours pour le tenant de la session, puis
 * applique les règles pures d'alertsMath. Une source indisponible n'empêche
 * pas les autres : elle est signalée dans `unavailable`.
 *
 * Lectures l'une après l'autre (pas en parallèle) : chaque source prend son
 * propre client du pool partagé ; la cloche ne doit pas en monopoliser quatre.
 *
 * « À valider » : seulement ce que l'utilisateur peut décider — même liste de
 * rôles d'écriture que les routes des rapports (reportWorkflow.REPORT_WRITE_ROLES).
 */
/**
 * @param {object} auth  req.auth (tenant, utilisateur, rôle)
 * @param {{ today?: string, period?: {from,to}|null }} [opts]
 *   period (lot 1b, Centre d'alertes) : vaut pour le TERRAIN (résumé des visites de la
 *   période) et les RAPPORTS à valider (chevauchement de leur période) ; sans période
 *   (la cloche) : terrain du mois courant, tous les rapports — sortie inchangée. Le
 *   budget et les échéances de contrat sont toujours calculés à date (scope 'a_date').
 */
async function alerts(auth, { today = localDay(), period = null } = {}) {
  const { tenantId, userId, role } = auth;
  // UN mois courant : le jour LOCAL de l'application (common/localDay, = rbmMath.currentMonth), le même que
  // la carte « Rapports attendus » (GET /reports/expected) — jamais le jour UTC (relecture croisée, point 14).
  const month = today.slice(0, 7);
  const fieldPeriod = period || single(month);
  const unavailable = [];
  const read = async (source, fn, fallback) => {
    try { return await fn(); } catch (err) {
      logger.warn({ err, source }, 'alertes : source indisponible');
      unavailable.push(source);
      return fallback;
    }
  };
  const cons = await read('budget', () => consolidationRepo.consolidation(tenantId, {}), null);
  const contracts = await read('contrats', () => contractsService.listContracts(tenantId, {}), []);
  const reports = await read('rapports', async () => {
    const canWrite = canWriteReports(role);
    return (await reportsRepo.listReports(tenantId, period ? { period } : {})).map((r) => ({ ...r, actions: reportActions(r, { userId, canWrite }) }));
  }, []);
  // Rapports en retard (retour 114) : la période choisie, sinon les LATE_REPORTS_LOOKBACK derniers mois,
  // mois courant compris (la cloche) — la page le dit.
  const lateWindow = period || { from: addMonths(month, -(LATE_REPORTS_LOOKBACK - 1)), to: month };
  const expected = await read('rapports', () => reportsRepo.expectedReports(tenantId, { period: lateWindow, today: month }), null);
  // Terrain : exécution du plan = mesures communes (retour 110) ; prestataires et visites non affectées = visites.
  // Sans l'état RBM (rbm: false) : l'alerte ne lit que l'exécution, et la cloche sonde toutes les 5 minutes.
  const coverage = await read('terrain', () => coverageService.coverage({ tenantId }, { period: fieldPeriod, rbm: false }), null);
  const field = await read('terrain', () => fieldRepo.summary(tenantId, { period: fieldPeriod }), null);

  const items = buildAlerts({
    consolidationRows: cons ? cons.rows : [], contracts, reports, expected, field, coverage, today,
    // « ce mois » seulement sans période (la cloche) ; un mois choisi est nommé ; une plage : « sur la période ».
    range: spanMonths(fieldPeriod) > 1, month: period && spanMonths(period) === 1 ? period.from : null, reportsInPeriod: !!period,
    period: fieldPeriod,
  });
  return { today, month, period: periodInfo(fieldPeriod), lateReportsWindow: { from: lateWindow.from, to: lateWindow.to },
    counts: countAlerts(items), items, unavailable: [...new Set(unavailable)] };
}

module.exports = { alerts };
