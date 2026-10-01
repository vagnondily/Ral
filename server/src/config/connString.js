/**
 * Validate a Postgres connection string from the environment and turn the
 * cryptic pg error « SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be
 * a string » into an actionable message. That error happens when the URL names
 * a user but no password and PostgreSQL uses scram-sha-256 auth (the modern
 * default) — pg then sends an undefined password. We fail fast here, before
 * connecting, pointing at the exact .env variable to fix.
 */
function requireConnString(varName) {
  const raw = process.env[varName];
  if (!raw) {
    throw new Error(
      `${varName} manquant. Copiez server/.env.example vers server/.env puis renseignez ${varName} `
      + '(ex. postgres://postgres:MOT_DE_PASSE@localhost:5432/mems2_tpm).',
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${varName} invalide : attendu postgres://user:motdepasse@hote:port/base.`);
  }
  // pg falls back to PGPASSWORD when the URL omits the password, so that still counts.
  const hasPassword = url.password !== '' || Boolean(process.env.PGPASSWORD);
  if (!hasPassword) {
    const user = url.username || 'postgres';
    throw new Error(
      `${varName} n'a pas de mot de passe : « ${url.protocol}//${url.username}@${url.host}${url.pathname} ». `
      + 'PostgreSQL (scram-sha-256) exige un mot de passe. '
      + `Corrigez ${varName} dans server/.env sous la forme `
      + `postgres://${user}:MOT_DE_PASSE@${url.host}${url.pathname} `
      + '(encodez les caractères spéciaux du mot de passe : @→%40, :→%3A, /→%2F, #→%23, ?→%3F).',
    );
  }
  return raw;
}

module.exports = { requireConnString };
