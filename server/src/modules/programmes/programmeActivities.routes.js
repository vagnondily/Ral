/**
 * Activités de programme (suivi de processus) — routes (migration 105), montées sur
 * /api/programme-activities. Lecture pour tout utilisateur du compte ; écritures réservées à
 * l'administrateur (Paramétrage). Le compte vient toujours du jeton (req.auth).
 *
 *   GET    /                       activités et sous-activités pour les listes de saisie
 *   GET    /referential            écran Paramétrage › Activités (Utilisé par, alias, À classer, non reconnus)
 *   POST   /                       créer
 *   PATCH  /:id                    renommer (ancien libellé gardé), code, libellé court, description, ordre, état
 *   DELETE /:id                    supprimer — refusé (409, Utilisé par) dès qu'une donnée la désigne
 *   POST   /:id/merge              fusionner dans { targetId } (libellés et sous-activités suivent)
 *   POST   /:id/convert            ranger comme sous-activité de { targetId } (code facultatif)
 *   POST   /aliases                relier un libellé non reconnu { label, programmeActivityId }
 *   DELETE /:id/aliases/:key       retirer un libellé relié (jamais s'il est encore écrit dans des données)
 *   POST   /reprise                reprendre les libellés encore inconnus
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const service = require('./programmeActivities.service');

const router = Router();
router.use(requireAuth);
const ADMIN = requireRole('admin');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId || req.auth.sub;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const uuid = z.string().uuid();
const idParam = (req) => {
  if (!uuid.safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  return req.params.id;
};
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : (v || null)));
const label = z.string().trim().min(2).max(160);
const code = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/, 'Code : lettre ou chiffre en tête, puis lettres, chiffres, « . », « _ » ou « - ».');

router.get('/', asyncHandler(async (req, res) => res.json(await service.listForSelect(t(req)))));
router.get('/referential', asyncHandler(async (req, res) => res.json(await service.referential(t(req)))));

router.post('/', ADMIN, body(z.object({
  label,
  code: code.optional(),
  shortLabel: optText(60),
  description: optText(2000),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
}).strict()), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createActivity(t(req), req.valid, uid(req)));
}));

router.patch('/:id', ADMIN, body(z.object({
  label: label.optional(),
  code: code.optional(),
  shortLabel: optText(60),
  description: optText(2000),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Rien à modifier')), asyncHandler(async (req, res) => {
  res.json(await service.updateActivity(t(req), idParam(req), req.valid, uid(req)));
}));

router.delete('/:id', ADMIN, asyncHandler(async (req, res) => {
  res.json(await service.deleteActivity(t(req), idParam(req)));
}));

router.post('/:id/merge', ADMIN, body(z.object({ targetId: uuid }).strict()), asyncHandler(async (req, res) => {
  res.json(await service.mergeActivities(t(req), idParam(req), req.valid.targetId));
}));

router.post('/:id/convert', ADMIN, body(z.object({
  targetId: uuid,
  code: z.string().trim().min(1).max(60).optional(),
  label: z.string().trim().min(1).max(160).optional(),
}).strict()), asyncHandler(async (req, res) => {
  const { targetId, ...sub } = req.valid;
  res.json(await service.convertToSubActivity(t(req), idParam(req), targetId, sub));
}));

router.post('/aliases', ADMIN, body(z.object({
  label: z.string().trim().min(1).max(160),
  programmeActivityId: uuid,
}).strict()), asyncHandler(async (req, res) => {
  res.status(201).json(await service.linkLabel(t(req), req.valid, uid(req)));
}));

router.delete('/:id/aliases/:key', ADMIN, asyncHandler(async (req, res) => {
  if (!/^[a-z0-9]{1,160}$/.test(req.params.key)) throw badRequest('Libellé invalide');
  res.json(await service.unlinkAlias(t(req), idParam(req), req.params.key));
}));

router.post('/reprise', ADMIN, asyncHandler(async (req, res) => res.json(await service.reprise(t(req)))));

module.exports = router;
