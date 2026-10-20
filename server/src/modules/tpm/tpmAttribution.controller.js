const service = require('./tpmAttribution.service');
const unavailability = require('./tpmUnavailability.service');

/**
 * Affectation des TPM (retour 58) — HTTP ↔ service. Le tenant et l'auteur viennent de la session
 * (req.auth), jamais du corps ni de la requête ; les entrées sont déjà validées (req.valid).
 */
const tenant = (req) => req.auth.tenantId;
const actor = (req) => ({ userId: req.auth.userId, role: req.auth.role });

async function table(req, res) { res.json(await service.getTable(tenant(req), req.valid)); }
async function providers(req, res) { res.json(await service.providers(tenant(req), req.valid)); }
async function resolve(req, res) { res.json(await service.resolve(tenant(req), req.valid)); }
async function log(req, res) { res.json(await service.listLog(tenant(req), req.valid)); }
async function preview(req, res) { res.json(await service.preview(tenant(req), req.valid)); }
async function saveOverrides(req, res) { res.json(await service.setOverrides(tenant(req), actor(req), req.valid)); }
async function revert(req, res) { res.json(await service.revert(tenant(req), actor(req), req.valid)); }
async function reapply(req, res) { res.json(await service.reapply(tenant(req), actor(req), req.valid)); }
async function visits(req, res) { res.json(await service.setVisitsProvider(tenant(req), actor(req), req.valid)); }
// Indisponibilités des TPM (retour 114).
async function unavailabilityList(req, res) { res.json(await unavailability.list(tenant(req), req.valid)); }
async function unavailabilityPreview(req, res) { res.json(await unavailability.preview(tenant(req), req.valid)); }
async function unavailabilitySet(req, res) { res.json(await unavailability.setUnavailable(tenant(req), actor(req), req.valid)); }
async function unavailabilityEnd(req, res) { res.json(await unavailability.endUnavailable(tenant(req), actor(req), req.valid)); }

module.exports = {
  table, providers, resolve, log, preview, saveOverrides, revert, reapply, visits,
  unavailabilityList, unavailabilityPreview, unavailabilitySet, unavailabilityEnd,
};
