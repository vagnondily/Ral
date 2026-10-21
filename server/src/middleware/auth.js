const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('./errors');
const {
  normalizeRole, WRITE_ROLES, VALIDATE_ROLES, ADMIN_ROLES, SUPER_ROLES,
} = require('../modules/common/accessRoles');

/**
 * Verifies the bearer JWT and attaches { userId, tenantId, role } to
 * req.auth. This is the ONLY place tenantId is allowed to come from — every
 * downstream repository call takes it from req.auth.tenantId, never from a
 * request body or query param, so a client can never ask to see another
 * tenant's data by passing a different tenant_id.
 *
 * `role` is normalised here (the legacy `manager` becomes `validator`) so every
 * downstream guard reasons about the five current roles only.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('Jeton manquant'));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = { userId: payload.sub, tenantId: payload.tenantId, role: normalizeRole(payload.role) };
    return next();
  } catch {
    return next(unauthorized('Jeton invalide ou expiré'));
  }
}

/** Route guard for role-gated actions (e.g. validating a plan). */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
      return next(forbidden(`Rôle requis : ${allowedRoles.join(' ou ')}`));
    }
    return next();
  };
}

// Gardes par capacité (préconstruits) — utilisés par les routes à la place des
// listes de rôles en dur. requireWrite = éditer ; requireValidate = valider /
// décider ; requireAdmin = administrer ; requireSuper = réglages réservés.
const requireWrite = requireRole(...WRITE_ROLES);
const requireValidate = requireRole(...VALIDATE_ROLES);
const requireAdmin = requireRole(...ADMIN_ROLES);
const requireSuper = requireRole(...SUPER_ROLES);

module.exports = {
  requireAuth, requireRole,
  requireWrite, requireValidate, requireAdmin, requireSuper,
  WRITE_ROLES, VALIDATE_ROLES, ADMIN_ROLES, SUPER_ROLES,
};
