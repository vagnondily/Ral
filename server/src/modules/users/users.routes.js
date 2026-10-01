const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const repo = require('./users.repository');

/**
 * Utilisateurs & accès — admin uniquement. Création/modification des comptes et
 * de leurs droits (rôle), activation/désactivation, réinitialisation du mot de
 * passe. Un admin ne peut ni se désactiver, ni se rétrograder, ni se supprimer
 * lui-même (garde-fou de sécurité contre le verrouillage).
 */
const router = Router();
router.use(requireAuth);
const ADMIN = requireRole('admin');
const t = (req) => req.auth.tenantId;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const ROLE = z.enum(['admin', 'manager', 'viewer']);

router.get('/', ADMIN, asyncHandler(async (req, res) => res.json(await repo.listUsers(t(req)))));

const createSchema = z.object({
  email: z.string().email().max(160),
  fullName: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
  role: ROLE,
  password: z.string().min(10, 'Au moins 10 caractères').max(200),
});
router.post('/', ADMIN, body(createSchema), asyncHandler(async (req, res) => {
  try { res.status(201).json({ id: await repo.createUser(t(req), req.valid) }); }
  catch (err) { if (err.code === '23505') throw conflict('Un compte avec cet e-mail existe déjà.'); throw err; }
}));

const updateSchema = z.object({
  fullName: z.string().trim().max(160).optional(),
  role: ROLE.optional(),
  active: z.boolean().optional(),
  password: z.string().min(10, 'Au moins 10 caractères').max(200).optional().or(z.literal('').transform(() => undefined)),
});
router.patch('/:id', ADMIN, body(updateSchema), asyncHandler(async (req, res) => {
  // Garde-fou : un admin ne se désactive ni ne se rétrograde lui-même.
  if (req.params.id === req.auth.userId) {
    if (req.valid.active === false) throw badRequest('Vous ne pouvez pas désactiver votre propre compte.');
    if (req.valid.role && req.valid.role !== 'admin') throw badRequest('Vous ne pouvez pas retirer votre propre rôle administrateur.');
  }
  if (!(await repo.updateUser(t(req), req.params.id, req.valid))) throw notFound('Utilisateur introuvable');
  res.status(204).end();
}));

router.delete('/:id', ADMIN, asyncHandler(async (req, res) => {
  if (req.params.id === req.auth.userId) throw badRequest('Vous ne pouvez pas supprimer votre propre compte.');
  if (!(await repo.deleteUser(t(req), req.params.id))) throw notFound('Utilisateur introuvable');
  res.status(204).end();
}));

module.exports = router;
