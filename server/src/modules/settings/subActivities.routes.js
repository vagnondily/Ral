/**
 * Sous-activités (retour n° 92) — routes du référentiel « activité ›
 * sous-activité (activity_tag) › information ». Fichier NEUF, monté à part
 * (comme sitesAdmin.routes → /api/site-registry) pour ne pas toucher
 * settings.routes.js (modifié par un autre chantier).
 *
 * Mapping des retours du dépôt → HTTP :
 *   NOACT       → 404 (activité parente absente)
 *   DUP         → 409 (code déjà pris par une autre sous-activité)
 *   not_found   → 404
 *   linked      → 409 (code utilisé par des sites → désactiver, pas supprimer)
 *   code_locked → 409 (code figé car utilisé par des sites)
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, conflict } = require('../../middleware/errors');
const repo = require('./subActivities.repository');

const router = Router();
router.use(requireAuth);
const ADMIN = requireRole('admin');

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const t = (req) => req.auth.tenantId;
// Le code = l'« activity_tag » porté par les sites (sites.tag_code) : libre mais borné.
const code = z.string().trim().min(1).max(60);
const label = z.string().trim().min(2).max(160);
const info = z.string().trim().max(2000).optional().or(z.literal('').transform(() => ''));
const uuid = z.string().uuid();

// Liste (toutes, ou d'une activité via ?activityId=, ou seulement actives via ?active=true).
router.get('/', asyncHandler(async (req, res) => {
  const activityId = req.query.activityId;
  if (activityId !== undefined && !uuid.safeParse(activityId).success) throw badRequest('activityId invalide');
  res.json(await repo.listSubActivities(t(req), {
    activityId: activityId || null,
    activeOnly: req.query.active === 'true',
  }));
}));

// Création : rattachée à une activité existante ; code unique par compte.
router.post('/', ADMIN, body(z.object({
  activityId: uuid,
  code,
  label,
  info,
  sortOrder: z.number().int().optional(),
})), asyncHandler(async (req, res) => {
  try {
    res.status(201).json(await repo.createSubActivity(t(req), req.valid));
  } catch (err) {
    if (err.code === 'NOACT') return res.status(404).json({ error: 'Activité introuvable' });
    if (err.code === 'DUP') throw conflict('Ce code de sous-activité existe déjà.');
    throw err;
  }
}));

// Modification partielle (label, info, sortOrder, active, et code si aucun site ne l'utilise).
router.patch('/:id', ADMIN, body(z.object({
  code: code.optional(),
  label: label.optional(),
  info,
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Rien à modifier')), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  const r = await repo.updateSubActivity(t(req), req.params.id, req.valid);
  if (r === 'not_found') return res.status(404).json({ error: 'Sous-activité introuvable' });
  if (r === 'DUP') throw conflict('Ce code de sous-activité existe déjà.');
  if (r === 'code_locked') throw conflict('Ce code est utilisé par des sites : il ne peut plus être modifié. Créez plutôt une nouvelle sous-activité.');
  return res.status(204).end();
}));

// Suppression — refusée (409) si des sites portent le code ; désactiver à la place.
router.delete('/:id', ADMIN, asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  const r = await repo.deleteSubActivity(t(req), req.params.id);
  if (r === 'not_found') return res.status(404).json({ error: 'Sous-activité introuvable' });
  if (r === 'linked') throw conflict('Des sites utilisent cette sous-activité : désactivez-la plutôt que de la supprimer.');
  return res.status(204).end();
}));

module.exports = router;
