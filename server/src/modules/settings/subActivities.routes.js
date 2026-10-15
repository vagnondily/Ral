/**
 * Sous-activités (retour n° 92 ; rattachées aux activités de programme, migration 105) — routes
 * du référentiel « activité de programme › sous-activité (Activity_tag) › information ».
 *
 * Mapping des retours du dépôt → HTTP :
 *   NOACT       → 404 (activité de programme absente)
 *   BUCKET      → 400 (« À classer » n'est pas une activité : choisissez-en une)
 *   DUP         → 409 (code déjà pris par une autre sous-activité, casse et ponctuation ignorées)
 *   not_found   → 404
 *   linked      → 409 (code porté par des sites → désactiver, pas supprimer ; comptes joints)
 *   code_locked → 409 (code figé car porté par des sites)
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, conflict, notFound } = require('../../middleware/errors');
const repo = require('./subActivities.repository');
const { activityKey } = require('../programmes/activityKey');
const { usageSummary, usageText } = require('../programmes/activityRef');

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
// Le code = l'Activity_tag porté par les sites (sites.tag_code) : libre mais borné, avec au moins
// une lettre ou un chiffre (sinon il ne désignerait rien).
const code = z.string().trim().min(1).max(60).refine((v) => activityKey(v) !== '', 'Le code doit contenir une lettre ou un chiffre.');
const label = z.string().trim().min(2).max(160);
const info = z.string().trim().max(2000).optional().or(z.literal('').transform(() => ''));
const uuid = z.string().uuid();

const BUCKET_MSG = 'Choisissez une activité de programme : « À classer » n\'est qu\'un rangement d\'attente.';
const DUP_MSG = 'Ce code de sous-activité existe déjà (à la casse ou à la ponctuation près).';

// Liste (toutes, ou d'une activité via ?programmeActivityId=, ou seulement actives via ?active=true).
router.get('/', asyncHandler(async (req, res) => {
  const programmeActivityId = req.query.programmeActivityId;
  if (programmeActivityId !== undefined && !uuid.safeParse(programmeActivityId).success) throw badRequest('programmeActivityId invalide');
  res.json(await repo.listSubActivities(t(req), {
    programmeActivityId: programmeActivityId || null,
    activeOnly: req.query.active === 'true',
  }));
}));

// Création : rattachée à une activité de programme existante ; code unique par compte.
router.post('/', ADMIN, body(z.object({
  programmeActivityId: uuid,
  code,
  label,
  info,
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
})), asyncHandler(async (req, res) => {
  try {
    res.status(201).json(await repo.createSubActivity(t(req), req.valid));
  } catch (err) {
    if (err.code === 'NOACT') throw notFound('Activité de programme introuvable');
    if (err.code === 'BUCKET') throw badRequest(BUCKET_MSG);
    if (err.code === 'DUP') throw conflict(DUP_MSG);
    throw err;
  }
}));

// Modification partielle (label, info, ordre, état, activité de programme — « ranger sous… » —
// et code si aucun site ne le porte).
router.patch('/:id', ADMIN, body(z.object({
  programmeActivityId: uuid.optional(),
  code: code.optional(),
  label: label.optional(),
  info,
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Rien à modifier')), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  const r = await repo.updateSubActivity(t(req), req.params.id, req.valid);
  if (r === 'not_found') throw notFound('Sous-activité introuvable');
  if (r === 'NOACT') throw notFound('Activité de programme introuvable');
  if (r === 'BUCKET') throw badRequest(BUCKET_MSG);
  if (r === 'DUP') throw conflict(DUP_MSG);
  if (r === 'code_locked') throw conflict('Ce code est porté par des sites : il ne peut plus être modifié. Créez plutôt une nouvelle sous-activité.', { reason: 'code_locked' });
  return res.status(204).end();
}));

// Suppression — refusée (409) si des sites portent le code ; désactiver à la place.
router.delete('/:id', ADMIN, asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  const r = await repo.deleteSubActivity(t(req), req.params.id);
  if (r.outcome === 'not_found') throw notFound('Sous-activité introuvable');
  if (r.outcome === 'linked') {
    const linked = usageSummary({ sites: r.sites });
    throw conflict(`Cette sous-activité est utilisée (${usageText(linked)}) : suppression impossible. Désactivez-la plutôt.`,
      { reason: 'linked_data', linked });
  }
  return res.status(204).end();
}));

module.exports = router;
