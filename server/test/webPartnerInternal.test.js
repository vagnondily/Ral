/**
 * Vérification croisée, points B et E (écrans) :
 *  - B : l'infobulle du suivi interne d'un titulaire dit la vraie raison (contrat sans TPM, TPM
 *    indisponible ou retiré avec motif…), jamais la phrase fixe « aucun TPM rattaché » ; l'onglet
 *    « Suivis effectués » montre les visites internes à part ;
 *  - E : une raison écrite par le système au journal est un CODE traduit par l'écran ; les anciennes
 *    lignes (phrase française) sont reconnues et traduites de même.
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

test('E : raison du système au journal = code traduit ; les anciennes phrases arrivent avec le même code', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const rule = require('../src/modules/tpm/tpmAttribution');
  const { ROLE_LOST_REASON } = require('../src/modules/partners/partnerRole');
  assert.deepEqual(Object.keys(w.SYSTEM_LOG_REASONS), Object.keys(rule.SYSTEM_LOG_REASONS), 'mêmes codes des deux côtés');
  for (const [k, d] of Object.entries(rule.SYSTEM_LOG_REASONS)) {
    assert.ok(d.code.length >= 10 && d.code.length <= 500, `${k} : CHECK de la base (10 à 500 caractères)`);
    assert.equal(rule.systemReasonKey(d.code), k);
    for (const old of d.legacy) assert.equal(rule.systemReasonKey(old), k, 'ancienne ligne reconnue');
    assert.equal(w.SYSTEM_LOG_REASONS[k], d.legacy[0], 'l\'écran affiche la phrase d\'avant, traduite');
  }
  assert.equal(ROLE_LOST_REASON, rule.SYSTEM_LOG_REASONS.partner_not_tpm.code, 'le changement de rôle écrit le code');
  assert.doesNotMatch(ROLE_LOST_REASON, /\s/, 'un code, pas une phrase');
  assert.equal(rule.systemReasonKey('Zone confiée à RANO pour la saison des pluies'), null, 'une raison saisie reste telle quelle');
  assert.equal(rule.systemReasonKey(null), null);
  // Écran : traduite, ou telle quelle ; portée « N visite(s) » traduite elle aussi.
  assert.equal(w.logReasonText(tr, { reasonKey: 'partner_not_tpm', reason: null }), w.SYSTEM_LOG_REASONS.partner_not_tpm);
  assert.equal(w.logReasonText(tr, { reason: 'Saison des pluies, accès difficile' }), 'Saison des pluies, accès difficile');
  assert.equal(w.logReasonText(tr, { reason: null }), null);
  assert.equal(w.logLabelText((s, v) => `EN:${tr(s, v)}`, { label: '2 visite(s)' }), 'EN:2 visite(s)');
  assert.equal(w.logLabelText(tr, { label: 'Betroka' }), 'Betroka');
  const log = source(t, 'pages/monitoring/TpmAttributionLog.jsx'); if (!log) return;
  assert.match(log, /logReasonText\(tr, l\)/);
  assert.doesNotMatch(log, /\{l\.reason\}/, 'plus la raison brute');
  const en = await load(t, 'locales/en/tpmInternal.js'); if (!en) return;
  assert.ok(en.default[w.SYSTEM_LOG_REASONS.partner_not_tpm], 'traduction anglaise de la raison du système');
});

test('E : le journal du service rend `reasonKey` et retire la phrase brute (lot et anciennes lignes)', async () => {
  const repoPath = require.resolve('../src/modules/tpm/tpmAttribution.repository');
  const dbPath = require.resolve('../src/config/db');
  const savedRepo = require.cache[repoPath]; const savedDb = require.cache[dbPath];
  const rule = require('../src/modules/tpm/tpmAttribution');
  const items = [
    { id: 1, reason: rule.SYSTEM_LOG_REASONS.partner_not_tpm.code },
    { id: 2, reason: rule.SYSTEM_LOG_REASONS.partner_not_tpm.legacy[0] },
    { id: 3, reason: 'Saison des pluies, accès difficile' },
  ];
  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: { listLogTx: async () => ({ items, total: 3 }) } };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withTenantTransaction: async (_t, fn) => fn({}) } };
  const svcPath = require.resolve('../src/modules/tpm/tpmAttribution.service');
  delete require.cache[svcPath];
  try {
    const out = await require('../src/modules/tpm/tpmAttribution.service').listLog('t', {});
    assert.deepEqual(out.items.map((l) => [l.id, l.reasonKey || null, l.reason]),
      [[1, 'partner_not_tpm', null], [2, 'partner_not_tpm', null], [3, null, 'Saison des pluies, accès difficile']]);
    assert.equal(out.total, 3);
  } finally {
    delete require.cache[svcPath];
    if (savedRepo) require.cache[repoPath] = savedRepo; else delete require.cache[repoPath];
    if (savedDb) require.cache[dbPath] = savedDb; else delete require.cache[dbPath];
  }
});
