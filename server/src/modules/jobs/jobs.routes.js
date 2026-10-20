const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const service = require('./jobs.service');

/**
 * Tâches de fond (avancement d'un import, indicateur « tâches en cours » de l'en-tête).
 * Lecture pour tout utilisateur connecté, limitée à SON compte (req.auth).
 */
const router = Router();
router.use(requireAuth);

const listQuery = z.object({ recent: z.coerce.number().int().min(0).max(1440).optional() }).passthrough();
router.get('/', asyncHandler(async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) throw badRequest('Paramètre invalide : recent (minutes, 0 à 1440).');
  res.json({ items: await service.listJobs(req.auth, { recentMinutes: q.data.recent ?? 10 }) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) throw badRequest('Identifiant de tâche invalide');
  const job = await service.getJob(req.auth, req.params.id);
  if (!job) throw notFound('Tâche introuvable');
  res.json(job);
}));

module.exports = router;
