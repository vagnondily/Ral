const service = require('./alerts.service');
const { readPeriod } = require('../../middleware/period');

/** Même plafond que le résumé des visites (faits site × mois) : 24 mois. */
const ALERTS_MAX_SPAN = 24;

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
