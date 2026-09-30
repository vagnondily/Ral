/** Typed application error — controllers throw this for expected failure
 * cases (not found, validation, forbidden) so the central handler below can
 * pick the right HTTP status without string-matching messages. */
class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const notFound = (message = 'Ressource introuvable') => new AppError(404, message);
const badRequest = (message = 'Requête invalide', details) => new AppError(400, message, details);
const forbidden = (message = 'Accès refusé') => new AppError(403, message);
const unauthorized = (message = 'Authentification requise') => new AppError(401, message);
const conflict = (message = 'Conflit de modification') => new AppError(409, message);

// Centralized error handler — must be registered last, after all routes.
// Anything not thrown as an AppError is treated as a bug: logged with full
// detail, but the client only ever sees a generic message, never a stack
// trace or a raw database error (which can leak schema/tenant details).
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  // Postgres unique_violation -> surfaced as a 409, since it is almost
  // always a legitimate "this already exists" client-facing condition
  // (e.g. two requests racing to create the same month's plan).
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Cette ressource existe déjà.' });
  }
  // CHECK / foreign-key / invalid-uuid violations are client input errors
  // that slipped past validation: 400, never a 500.
  if (err.code === '23514' || err.code === '23503' || err.code === '22P02') {
    return res.status(400).json({ error: 'Données invalides.' });
  }

  req.log?.error({ err }, 'unhandled error');
  return res.status(500).json({ error: 'Erreur interne du serveur.' });
}

module.exports = { AppError, notFound, badRequest, forbidden, unauthorized, conflict, errorHandler };
