/**
 * Planification automatique (lot 5) — traduction HTTP ↔ service. Le compte et l'auteur
 * viennent UNIQUEMENT du jeton (req.auth), jamais du corps de la requête.
 */
const service = require('./plan.service');

const tenant = (req) => req.auth.tenantId;
const user = (req) => req.auth.userId || req.auth.sub;

async function getSettings(req, res) { res.json(await service.getSettings(tenant(req))); }
async function saveSettings(req, res) { res.json(await service.saveSettings(tenant(req), user(req), req.valid)); }
async function preview(req, res) { res.json(await service.preview(tenant(req), req.valid)); }
async function apply(req, res) { res.json(await service.apply(tenant(req), user(req), req.valid)); }

module.exports = { getSettings, saveSettings, preview, apply };
