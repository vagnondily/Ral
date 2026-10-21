const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { pool } = require('../../config/db');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const { unauthorized, badRequest } = require('../../middleware/errors');
const { normalizeRole } = require('../common/accessRoles');

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Login is intentionally the one endpoint that queries `users` without a
// tenant filter from the JWT (there is no JWT yet) — it looks the user up
// by email alone. Multitenancy here means "this email belongs to exactly
// one tenant", enforced by the UNIQUE (tenant_id, email) constraint plus
// application logic: emails are expected to be unique enough in practice
// (staff / partner email addresses) that a plain lookup is safe; if two
// tenants ever needed the same email, this would move to a
// tenant-subdomain-first login flow instead.
router.post(
  '/login',
  asyncHandler(async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Email ou mot de passe invalide', parsed.error.flatten()));

    const { email, password } = parsed.data;
    // Goes through auth_lookup_user() (see migration 003/026/121), a SECURITY
    // DEFINER function — the one deliberate bypass of the users table's RLS
    // policy, needed because the tenant isn't known until after this lookup.
    const { rows } = await pool.query('SELECT * FROM auth_lookup_user($1)', [email]);
    const user = rows[0];
    if (!user) return next(unauthorized('Identifiants incorrects'));

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return next(unauthorized('Identifiants incorrects'));
    // Un compte auto-inscrit attend la validation d'un administrateur : il ne voit rien d'ici là.
    if (user.status === 'pending') {
      return next(unauthorized('Compte en attente de validation par un administrateur.'));
    }
    if (user.active === false) return next(unauthorized('Compte désactivé — contactez un administrateur.'));

    const role = normalizeRole(user.role);
    const token = jwt.sign(
      { sub: user.id, tenantId: user.tenant_id, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // tenants has no RLS (it holds no tenant-scoped data, only names), so
    // the restricted role can read the caller's own tenant name for display.
    const { rows: tenantRows } = await pool.query('SELECT name FROM tenants WHERE id = $1', [user.tenant_id]);
    // page_access (restrictions par écran) : lu sous le GUC tenant pour respecter la RLS.
    const access = await readPageAccess(user.tenant_id, user.id);

    res.json({
      token,
      user: { id: user.id, email, role, fullName: user.full_name || null, pageAccess: access, tenantName: tenantRows[0]?.name || null },
    });
  })
);

/** Lit page_access d'un compte en posant le GUC app.tenant_id (RLS). */
async function readPageAccess(tenantId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const { rows } = await client.query('SELECT page_access FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    return rows[0] ? rows[0].page_access : null;
  } catch {
    await client.query('ROLLBACK');
    return null;
  } finally {
    client.release();
  }
}

// Profil de la session : rôle et accès par écran (pour que l'interface n'affiche
// que ce que l'utilisateur a le droit de voir). Source d'autorité côté serveur.
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const access = await readPageAccess(req.auth.tenantId, req.auth.userId);
  res.json({ id: req.auth.userId, role: req.auth.role, pageAccess: access });
}));

// Liste publique des espaces (pays / tenants) — pour choisir son organisation à l'inscription.
router.get('/tenants', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name FROM tenants ORDER BY name');
  res.json(rows);
}));

// Auto-inscription : crée un compte EN ATTENTE (status 'pending', désactivé). L'utilisateur
// ne voit rien tant qu'un administrateur ne l'a pas validé et ne lui a pas attribué un rôle.
// Pas d'e-mail (aucun service configuré) : la validation par l'administrateur est le garde-fou
// anti-bot. Réponse volontairement neutre (ne révèle pas si l'e-mail existe déjà).
const registerSchema = z.object({
  tenantId: z.string().uuid('Choisissez une organisation'),
  email: z.string().email().max(160),
  fullName: z.string().trim().min(2, 'Nom requis').max(160),
  password: z.string().min(10, 'Au moins 10 caractères').max(200),
});
const NEUTRAL = { ok: true, message: 'Demande enregistrée. Un administrateur doit valider votre compte avant la première connexion.' };
router.post('/register', asyncHandler(async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
  const { tenantId, email, fullName, password } = parsed.data;
  const { rows: tr } = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
  if (!tr.length) return next(badRequest('Organisation inconnue.'));
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      `INSERT INTO users (tenant_id, email, full_name, role, password_hash, active, status)
       VALUES ($1, $2, $3, 'viewer', $4, false, 'pending')`,
      [tenantId, email, fullName, hash]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // 23505 = e-mail déjà pris : on répond quand même neutre (pas d'énumération de comptes).
    if (err.code !== '23505') { client.release(); return next(err); }
  } finally {
    client.release();
  }
  res.status(201).json(NEUTRAL);
}));

module.exports = router;
