const service = require('./map.service');

/** HTTP ↔ service : le tenant et le rôle viennent de la session (req.auth), jamais de la requête. */
async function districts(req, res) {
  res.json(await service.districts(req.auth, req.valid));
}

module.exports = { districts };
