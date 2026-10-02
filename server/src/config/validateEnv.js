const logger = require('./logger');

/**
 * Validation de la configuration au démarrage — échoue vite plutôt que de
 * tourner avec une config dangereuse (sécurité niveau entreprise).
 *
 * En production : JWT_SECRET et APP_DATABASE_URL sont OBLIGATOIRES, et le
 * secret doit être assez long. En développement, on se contente d'avertir
 * pour ne pas bloquer un démarrage local rapide.
 */
function validateEnv() {
  const prod = process.env.NODE_ENV === 'production';
  const problems = [];
  const warnings = [];

  const secret = process.env.JWT_SECRET;
  if (!secret) problems.push('JWT_SECRET manquant (obligatoire pour signer les jetons).');
  else if (secret.length < 32) {
    const msg = `JWT_SECRET trop court (${secret.length} caractères, 32 minimum recommandés).`;
    (prod ? problems : warnings).push(msg);
  }
  const weak = ['secret', 'changeme', 'change-me', 'dev', 'test', 'password'];
  if (secret && weak.includes(secret.toLowerCase())) problems.push('JWT_SECRET est une valeur par défaut faible — changez-le.');

  if (prod && !process.env.APP_DATABASE_URL) {
    problems.push('APP_DATABASE_URL manquant : l\'API doit tourner via le rôle restreint mems2_app pour que la RLS soit appliquée.');
  }
  if (prod && (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*')) {
    warnings.push('CORS_ORIGIN non restreint (« * ») en production — fixez-le à l\'origine du front.');
  }

  warnings.forEach((w) => logger.warn({ config: true }, w));
  if (problems.length) {
    problems.forEach((p) => logger.error({ config: true }, p));
    throw new Error(`Configuration invalide au démarrage :\n- ${problems.join('\n- ')}`);
  }
}

module.exports = { validateEnv };
