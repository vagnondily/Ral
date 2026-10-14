const service = require('./map.service');

/** HTTP ↔ service : le tenant et le rôle viennent de la session (req.auth), jamais de la requête. */
async function districts(req, res) {
  res.json(await service.districts(req.auth, req.valid));
}

async function points(req, res) {
  res.json(await service.points(req.auth, req.valid));
}

async function search(req, res) {
  res.json(await service.search(req.auth, req.valid));
}

async function shapeLinks(req, res) {
  res.json(await service.shapeLinks(req.auth));
}

async function setShapeLink(req, res) {
  await service.setShapeLink(req.auth, req.params.pcode, req.valid.shapeKey);
  res.status(204).end();
}

async function clearShapeLink(req, res) {
  await service.clearShapeLink(req.auth, req.params.pcode);
  res.status(204).end();
}

async function fillCentres(req, res) {
  res.json(await service.fillCentres(req.auth));
}

module.exports = { districts, points, search, shapeLinks, setShapeLink, clearShapeLink, fillCentres };
