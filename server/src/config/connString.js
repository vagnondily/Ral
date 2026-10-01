/**
 * Helpers around a Postgres connection string from the environment.
 *
 * `requireConnString` only rejects what is unambiguously wrong (missing or
 * malformed URL). It deliberately does NOT reject a URL without a password:
 * local setups legitimately use trust/peer auth over a Unix socket, where no
 * password is sent.
 *
 * A passwordless URL only fails when the *server* demands scram-sha-256, which
 * surfaces as the cryptic pg error « SASL: SCRAM-SERVER-FIRST-MESSAGE: client
 * password must be a string ». `explainConnError` turns that (caught at connect
 * time) into an actionable message pointing at the .env variable to fix.
 */
function requireConnString(varName) {
  const raw = process.env[varName];
  if (!raw) {
    throw new Error(
      `${varName} manquant. Copiez server/.env.example vers server/.env puis renseignez ${varName} `
      + '(ex. postgres://postgres:MOT_DE_PASSE@localhost:5432/mems2_tpm).',
    );
  }
  try {
    void new URL(raw);
  } catch {
    throw new Error(`${varName} invalide : attendu postgres://user:motdepasse@hote:port/base.`);
  }
  return raw;
}

/**
 * If `err` is the "client password must be a string" SASL failure, return a
 * clear message telling the user to add a password to `varName`; else null.
 */
function explainConnError(err, varName) {
  if (!err || !/password must be a string/i.test(err.message || '')) return null;
  let hint = `postgres://<user>:MOT_DE_PASSE@<hote>:<port>/<base>`;
  try {
    const url = new URL(process.env[varName] || '');
    hint = `postgres://${url.username || 'postgres'}:MOT_DE_PASSE@${url.host}${url.pathname}`;
  } catch { /* keep the generic hint */ }
  return (
    `${varName} n'a pas de mot de passe alors que PostgreSQL en exige un (scram-sha-256). `
    + `Corrigez ${varName} dans server/.env sous la forme ${hint} `
    + '(encodez les caractères spéciaux du mot de passe : @→%40, :→%3A, /→%2F, #→%23, ?→%3F).'
  );
}

module.exports = { requireConnString, explainConnError };
