const crypto = require('crypto');
const { z } = require('zod');
const { badRequest, payloadTooLarge } = require('../../middleware/errors');
const { imageInfo } = require('../common/imageInfo');
const { schemas } = require('./reportSchema');
const repo = require('./reportAssets.repository');

/**
 * Images des en-têtes et pieds de page (logos) — règles : format reconnu par les octets (PNG ou
 * JPEG), 512 Ko et 4 000 px au plus (common/imageInfo, pur), une seule copie par compte
 * (SHA-256), nom d'affichage nettoyé. Le compte vient TOUJOURS de req.auth (routes).
 */
const cleanName = (name) => {
  if (typeof name !== 'string') return null;
  const s = [...name].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim().slice(0, 120);
  return s || null;
};

/** @returns {Promise<{ asset: { id, mime, width, height, bytes, name, createdAt }, created: boolean }>} */
async function uploadAsset(tenantId, buf, { name, userId } = {}) {
  const info = imageInfo(buf);
  if (!info.ok) {
    if (info.code === 'too_large') throw payloadTooLarge(info.message, { code: info.code });
    throw badRequest(info.message, { code: info.code, format: info.label || null });
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return repo.createAsset(tenantId, { sha256, mime: info.mime, width: info.width, height: info.height, bytes: info.bytes, data: buf, name: cleanName(name) }, userId);
}

const listAssets = (tenantId) => repo.listAssets(tenantId);
const getAsset = (tenantId, id) => repo.getAssetData(tenantId, id);

// « Mes en-têtes » (retour 88) : un en-tête et un pied validés par le MÊME schéma que dans un rapport.
const bandTemplateInput = z.object({
  name: z.string().trim().min(1).max(120),
  header: schemas.band,
  footer: schemas.band,
}).strict();

/** Logos cités par des bandes : ceux du compte seulement (jamais pris pour vrais). */
async function checkBandImages(tenantId, bands) {
  const ids = [...new Set(bands.flatMap((b) => (b.elements || []).filter((e) => e.kind === 'image' && e.assetId).map((e) => e.assetId)))];
  if (!ids.length) return;
  const known = await repo.existingAssetIds(tenantId, ids);
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw badRequest('Image introuvable dans ce compte : téléversez-la à nouveau.', { code: 'asset_missing', ids: missing });
}

async function saveBandTemplate(tenantId, body, userId) {
  const r = bandTemplateInput.safeParse(body);
  if (!r.success) throw badRequest('En-tête invalide', r.error.flatten());
  const { name, header, footer } = r.data;
  await checkBandImages(tenantId, [header, footer]);
  return repo.createBandTemplate(tenantId, { name, content: { header, footer } }, userId);
}
const listBandTemplates = (tenantId) => repo.listBandTemplates(tenantId);
const deleteBandTemplate = (tenantId, id) => repo.deleteBandTemplate(tenantId, id);

module.exports = { uploadAsset, listAssets, getAsset, cleanName, saveBandTemplate, listBandTemplates, deleteBandTemplate, checkBandImages };
