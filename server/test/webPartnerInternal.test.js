/**
 * Vérification croisée, point B (écrans) :
 *  - B : l'infobulle du suivi interne d'un titulaire dit la vraie raison (contrat sans TPM, TPM
 *    indisponible ou retiré avec motif…), jamais la phrase fixe « aucun TPM rattaché » ; l'onglet
 *    « Suivis effectués » montre les visites internes à part ;
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, '../../web/src');
const load = async (t, rel) => {
  const file = path.join(WEB, rel);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const source = (t, rel) => {
  const file = path.join(WEB, rel);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return fs.readFileSync(file, 'utf8');
};
const tr = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? `{${k}}` : String(v[k])));

test('B : infobulle du suivi interne — les raisons du serveur, jamais « aucun TPM rattaché » d\'office', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const { INTERNAL_REASONS } = require('../src/modules/partners/partnerSheet');
  assert.deepEqual(Object.keys(w.INTERNAL_REASON_LABELS), INTERNAL_REASONS, 'mêmes raisons côté écran et côté serveur');
  assert.equal(w.internalReasonsHint(tr, { indisponible: 3 }), 'Suivi interne (équipe S&E) : TPM indisponible (3)');
  assert.equal(w.internalReasonsHint(tr, { sans_tpm: 1, retire: 2, indisponible: 0 }),
    'Suivi interne (équipe S&E) : contrat sans TPM (1) · TPM retiré avec motif (2)');
  assert.equal(w.internalReasonsHint(tr, {}), w.INTERNAL_HINT, 'sans raison connue : l\'aide générique');
  const sheet = source(t, 'pages/tpm/ProviderSheetPage.jsx'); if (!sheet) return;
  assert.match(sheet, /title=\{internalReasonsHint\(tr, v\.internalReasons\)\}/);
  assert.doesNotMatch(sheet, /title=\{tr\(ROLE_LABELS\.noTpmHint\)\}>\s*\{tr\('\{n\} visite\(s\) en suivi interne/, 'plus la phrase fixe sur la ligne interne');
  assert.match(sheet, /dont \{n\} en suivi interne/, '12 mois : la part interne dite');
  const tab = source(t, 'pages/tpm/provider/ProviderFollowupsTab.jsx'); if (!tab) return;
  assert.match(tab, /data\.internal/, 'onglet Suivis : la série interne du serveur');
  assert.match(tab, /En suivi interne \(équipe S&E\)/);
});
