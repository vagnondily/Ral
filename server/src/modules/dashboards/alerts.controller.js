const service = require('./alerts.service');

/** HTTP ↔ service : le tenant, l'utilisateur et son rôle viennent de la session (req.auth), jamais de la requête. */
async function list(req, res) {
  res.json(await service.alerts(req.auth));
}

module.exports = { list };
