const logger = require('../../config/logger');
const consolidationRepo = require('../tpm/consolidation.repository');
const contractsService = require('../contracts/contracts.service');
const reportsRepo = require('../tpm/reports.repository');
const fieldRepo = require('../tpm/field.repository');
const coverageService = require('./coverage.service');
const { reportActions, canWriteReports } = require('../tpm/reportWorkflow');
const { buildAlerts, countAlerts } = require('./alertsMath');
const { single, spanMonths, periodInfo, addMonths } = require('../common/period');

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
const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * @param {object} auth  req.auth (tenant, utilisateur, rôle)
 * @param {{ today?: string, period?: {from,to}|null }} [opts]
 *   period (lot 1b, Centre d'alertes) : vaut pour le TERRAIN (résumé des visites de la
 *   période) et les RAPPORTS à valider (chevauchement de leur période) ; sans période
 *   (la cloche) : terrain du mois courant, tous les rapports — sortie inchangée. Le
 *   budget et les échéances de contrat sont toujours calculés à date (scope 'a_date').
 */
async function alerts(auth, { today = isoDay(new Date()), period = null } = {}) {
  const { tenantId, userId, role } = auth;
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
  // Rapports en retard (retour 114) : la période choisie, sinon les six derniers mois (la cloche).
  const expected = await read('rapports', () => reportsRepo.expectedReports(tenantId, { period: period || { from: addMonths(month, -6), to: month }, today: month }), null);
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
  return { today, month, period: periodInfo(fieldPeriod), counts: countAlerts(items), items, unavailable: [...new Set(unavailable)] };
}

module.exports = { alerts };
