const service = require('./coverage.service');

/**
 * Mesures de couverture des tableaux de bord : HTTP ↔ service. Entrées déjà validées par la
 * route (req.valid) ; le compte vient du jeton (req.auth), jamais de la requête.
 */
async function coverage(req, res) {
  res.json(await service.coverage(req.auth, req.valid));
}

module.exports = { coverage };
