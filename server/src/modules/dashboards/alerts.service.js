const logger = require('../../config/logger');
const consolidationRepo = require('../tpm/consolidation.repository');
const contractsService = require('../contracts/contracts.service');
const reportsRepo = require('../tpm/reports.repository');
const fieldRepo = require('../tpm/field.repository');
const { reportActions, canWriteReports } = require('../tpm/reportWorkflow');
const { buildAlerts, countAlerts } = require('./alertsMath');

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

async function alerts(auth, { today = isoDay(new Date()) } = {}) {
  const { tenantId, userId, role } = auth;
  const month = today.slice(0, 7);
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
    return (await reportsRepo.listReports(tenantId, {})).map((r) => ({ ...r, actions: reportActions(r, { userId, canWrite }) }));
  }, []);
  const field = await read('terrain', () => fieldRepo.summary(tenantId, { month }), null);

  const items = buildAlerts({ consolidationRows: cons ? cons.rows : [], contracts, reports, field, today });
  return { today, month, counts: countAlerts(items), items, unavailable };
}

module.exports = { alerts };
