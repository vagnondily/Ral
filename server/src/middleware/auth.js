const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('./errors');

/**
 * Verifies the bearer JWT and attaches { userId, tenantId, role } to
 * req.auth. This is the ONLY place tenantId is allowed to come from — every
 * downstream repository call takes it from req.auth.tenantId, never from a
 * request body or query param, so a client can never ask to see another
 * tenant's data by passing a different tenant_id.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('Jeton manquant'));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
    return next();
  } catch (err) {
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

module.exports = { requireAuth, requireRole };
