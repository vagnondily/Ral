const crypto = require('crypto');
const { badRequest, payloadTooLarge } = require('../../middleware/errors');
const { imageInfo } = require('../common/imageInfo');
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

module.exports = { uploadAsset, listAssets, getAsset, cleanName };
