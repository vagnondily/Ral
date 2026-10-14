const service = require('./alerts.service');
const { readPeriod } = require('../../middleware/period');
const { PERIOD_CAPS } = require('../common/periodCaps');

/** Même plafond que le résumé des visites (faits site × mois, common/periodCaps.facts). */
const ALERTS_MAX_SPAN = PERIOD_CAPS.facts;

/**
 * HTTP ↔ service : le tenant, l'utilisateur et son rôle viennent de la session (req.auth),
 * jamais de la requête. ?from&to (ou ?month) facultatif : période du terrain et des rapports
 * (Centre d'alertes) ; sans paramètre, la cloche (mois courant).
 */
async function list(req, res) {
  const period = readPeriod(req.query, { maxSpan: ALERTS_MAX_SPAN });
  res.json(await service.alerts(req.auth, { period }));
}

module.exports = { list };
