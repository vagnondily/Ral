/**
 * Devise du pays pour les exports Excel (multi-pays, étape 1b). La devise vient du profil du pays
 * (`country_profiles.currency`, code ISO) ; jumelle côté web de `lib/format.CURRENCY_SYMBOLS`.
 * Code connu → symbole local ; sinon le code ISO ; devise non renseignée → format sans suffixe.
 */
const { withTenantTransaction } = require('../../config/db');

const CURRENCY_SYMBOLS = { MGA: 'Ar', USD: '$', EUR: '€', KES: 'KSh', XOF: 'FCFA', XAF: 'FCFA' };

/** Suffixe d'affichage d'un code devise ('' si non renseignée). */
function currencySuffix(code) {
  const c = (code || '').toUpperCase().trim();
  return c ? (CURRENCY_SYMBOLS[c] || c) : '';
}

/** Format de nombre Excel pour les montants : `#,##0 "Ar"` (ou le symbole du pays), sans suffixe si vide. */
function moneyNumFmt(code) {
  const s = currencySuffix(code);
  return s ? `#,##0 "${s}"` : '#,##0';
}

/** Devise du pays courant (code ISO ou null) — lue DANS une transaction en cours. */
async function tenantCurrencyTx(client, tenantId) {
  const { rows } = await client.query('SELECT currency FROM country_profiles WHERE tenant_id = $1', [tenantId]);
  return rows[0] ? rows[0].currency : null;
}

/** Devise du pays courant (code ISO ou null) — ouvre sa propre transaction. */
async function tenantCurrency(tenantId) {
  return withTenantTransaction(tenantId, (client) => tenantCurrencyTx(client, tenantId));
}

module.exports = { CURRENCY_SYMBOLS, currencySuffix, moneyNumFmt, tenantCurrencyTx, tenantCurrency };
