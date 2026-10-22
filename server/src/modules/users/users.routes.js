const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole, ADMIN_ROLES } = require('../../middleware/auth');
const { badRequest, notFound, conflict, forbidden } = require('../../middleware/errors');
const { ROLES, isAdmin: roleIsAdmin, isSuper, normalizeRole } = require('../common/accessRoles');
const repo = require('./users.repository');

/**
 * Utilisateurs & accès — admin uniquement. Création/modification des comptes et
 * de leurs droits (rôle), activation/désactivation, réinitialisation du mot de
 * passe. Un admin ne peut ni se désactiver, ni se rétrograder, ni se supprimer
 * lui-même (garde-fou de sécurité contre le verrouillage).
 */
const router = Router();
router.use(requireAuth);
const ADMIN = requireRole(...ADMIN_ROLES);
const t = (req) => req.auth.tenantId;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const ROLE = z.enum(ROLES); // viewer, editor, validator, admin, superuser
// Restrictions par écran : null = aucune ; tableau de clés d'écran = ces écrans seulement.
const pageAccessSchema = z.array(z.string().max(40)).max(50).nullable();

// Seul un super-utilisateur peut accorder le rôle administrateur ou super-utilisateur,
// ou modifier un compte qui porte déjà l'un de ces rôles (décision Q2 : le super-utilisateur
// gère les administrateurs). Un administrateur gère viewer / editor / validator.
function assertMayManageRole(actorRole, targetNewRole) {
  if (targetNewRole && roleIsAdmin(targetNewRole) && !isSuper(actorRole)) {
    throw forbidden('Seul un super-utilisateur peut accorder le rôle administrateur ou super-utilisateur.');
  }
}
async function assertMayTouchUser(actorRole, tenantId, userId) {
  const existing = await repo.getUserRole(tenantId, userId);
  if (existing && roleIsAdmin(normalizeRole(existing)) && !isSuper(actorRole)) {
    throw forbidden('Seul un super-utilisateur peut modifier un compte administrateur ou super-utilisateur.');
  }
}

router.get('/', ADMIN, asyncHandler(async (req, res) => res.json(await repo.listUsers(t(req)))));

const createSchema = z.object({
  email: z.string().email().max(160),
  fullName: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
  role: ROLE,
  password: z.string().min(10, 'Au moins 10 caractères').max(200),
  pageAccess: pageAccessSchema.optional(),
  fieldOfficeId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
});
router.post('/', ADMIN, body(createSchema), asyncHandler(async (req, res) => {
  assertMayManageRole(req.auth.role, req.valid.role);
  try { res.status(201).json({ id: await repo.createUser(t(req), req.valid) }); }
  catch (err) { if (err.code === '23505') throw conflict('Un compte avec cet e-mail existe déjà.'); throw err; }
}));

const updateSchema = z.object({
  fullName: z.string().trim().max(160).optional(),
  role: ROLE.optional(),
  active: z.boolean().optional(),
  password: z.string().min(10, 'Au moins 10 caractères').max(200).optional().or(z.literal('').transform(() => undefined)),
  pageAccess: pageAccessSchema.optional(),
  fieldOfficeId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
});
router.patch('/:id', ADMIN, body(updateSchema), asyncHandler(async (req, res) => {
  // Garde-fou : on ne se désactive ni ne se rétrograde soi-même (admin+ → verrouillage).
  if (req.params.id === req.auth.userId) {
    if (req.valid.active === false) throw badRequest('Vous ne pouvez pas désactiver votre propre compte.');
    if (req.valid.role && !roleIsAdmin(req.valid.role)) throw badRequest('Vous ne pouvez pas retirer votre propre rôle administrateur.');
  }
  await assertMayTouchUser(req.auth.role, t(req), req.params.id); // protège un admin/super d'un rôle inférieur
  assertMayManageRole(req.auth.role, req.valid.role);
  if (!(await repo.updateUser(t(req), req.params.id, req.valid))) throw notFound('Utilisateur introuvable');
  res.status(204).end();
}));

// Valider un compte auto-inscrit (« Comptes à valider ») : attribue rôle + accès par écran,
// active le compte. L'octroi du rôle admin/super reste réservé au super-utilisateur.
const approveSchema = z.object({ role: ROLE, pageAccess: pageAccessSchema.optional(), fieldOfficeId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)) });
router.post('/:id/approve', ADMIN, body(approveSchema), asyncHandler(async (req, res) => {
  assertMayManageRole(req.auth.role, req.valid.role);
  const status = await repo.getUserStatus(t(req), req.params.id);
  if (status === null) throw notFound('Utilisateur introuvable');
  if (status !== 'pending') throw conflict('Ce compte est déjà validé.');
  const ok = await repo.approveUser(t(req), req.params.id, {
    role: req.valid.role, pageAccess: req.valid.pageAccess ?? null, approverId: req.auth.userId, fieldOfficeId: req.valid.fieldOfficeId ?? null,
  });
  if (!ok) throw conflict('Ce compte est déjà validé.');
  res.status(204).end();
}));

router.delete('/:id', ADMIN, asyncHandler(async (req, res) => {
  if (req.params.id === req.auth.userId) throw badRequest('Vous ne pouvez pas supprimer votre propre compte.');
  await assertMayTouchUser(req.auth.role, t(req), req.params.id);
  if (!(await repo.deleteUser(t(req), req.params.id))) throw notFound('Utilisateur introuvable');
  res.status(204).end();
}));

module.exports = router;
