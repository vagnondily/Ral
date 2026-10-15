const service = require('./performance.service');

/**
 * Tableau de bord « Couverture & performance du suivi » : HTTP ↔ service. Entrées déjà
 * validées par les routes (req.valid) ; le compte vient du jeton (req.auth), jamais de la requête.
 */
async function performance(req, res) {
  res.json(await service.performance(req.auth, req.valid));
}

async function trend(req, res) {
  res.json(await service.trend(req.auth, req.valid));
}

async function agents(req, res) {
  res.json(await service.agents(req.auth, req.valid));
}

module.exports = { performance, trend, agents };
