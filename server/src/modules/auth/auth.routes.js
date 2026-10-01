const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { pool } = require('../../config/db');
const asyncHandler = require('../../middleware/asyncHandler');
const { unauthorized, badRequest } = require('../../middleware/errors');

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
    // Goes through auth_lookup_user() (see migration 003), a SECURITY
    // DEFINER function — the one deliberate bypass of the users table's RLS
    // policy, needed because the tenant isn't known until after this lookup.
    const { rows } = await pool.query('SELECT * FROM auth_lookup_user($1)', [email]);
    const user = rows[0];
    if (!user) return next(unauthorized('Identifiants incorrects'));

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return next(unauthorized('Identifiants incorrects'));
    if (user.active === false) return next(unauthorized('Compte désactivé — contactez un administrateur.'));

    const token = jwt.sign(
      { sub: user.id, tenantId: user.tenant_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // tenants has no RLS (it holds no tenant-scoped data, only names), so
    // the restricted role can read the caller's own tenant name for display.
    const { rows: tenantRows } = await pool.query('SELECT name FROM tenants WHERE id = $1', [user.tenant_id]);

    res.json({
      token,
      user: { id: user.id, email, role: user.role, tenantName: tenantRows[0]?.name || null },
    });
  })
);

module.exports = router;
