const crypto = require('crypto');
const { z } = require('zod');
const { badRequest, payloadTooLarge } = require('../../middleware/errors');
const { imageInfo } = require('../common/imageInfo');
const { schemas, bandImageRefs, MAX_IMAGES } = require('./reportSchema');
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

// « Mes en-têtes » (retour 88) : la PAIRE 1re page / pages suivantes (retour du 15/10), validée par le
// MÊME schéma que dans un rapport. Un enregistrement ancien { header, footer } reste lisible (1re page identique).
const bandTemplateInput = z.object({
  name: z.string().trim().min(1).max(120),
  header: schemas.band,
  footer: schemas.band,
  firstPage: z.enum(['same', 'own', 'none']).optional(),
  firstHeader: schemas.band.optional(),
  firstFooter: schemas.band.optional(),
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
  const { name, header, footer, firstPage, firstHeader, firstFooter } = r.data;
  const content = { header, footer };
  if (firstPage) content.firstPage = firstPage;
  if (firstHeader) content.firstHeader = firstHeader;
  if (firstFooter) content.firstFooter = firstFooter;
  // Même limite que le document (reportSchema : MAX_IMAGES images citées, bandes de la 1re page comptées
  // si elles sont affichées) : une paire appliquée à un rapport ne fait jamais échouer son enregistrement.
  const images = bandImageRefs(content).length;
  if (images > MAX_IMAGES) {
    throw badRequest(`Trop d'images dans cet en-tête : ${images} logos (${MAX_IMAGES} au plus pour un rapport).`, { code: 'too_many_images', count: images, max: MAX_IMAGES });
  }
  await checkBandImages(tenantId, [header, footer, firstHeader, firstFooter].filter(Boolean));
  return repo.createBandTemplate(tenantId, { name, content }, userId);
}
const listBandTemplates = (tenantId) => repo.listBandTemplates(tenantId);
const deleteBandTemplate = (tenantId, id) => repo.deleteBandTemplate(tenantId, id);

module.exports = { uploadAsset, listAssets, getAsset, cleanName, saveBandTemplate, listBandTemplates, deleteBandTemplate, checkBandImages };
