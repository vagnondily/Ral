const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { roleOf, contractNo } = require('../src/modules/tpm/contractTpm');

// Glossaire des rôles (retour 113) : web/src/lib/roles.js, jumeau de tpm/contractTpm.js, et garde
// « aucun écran n'écrit plus Prestataire seul » (titulaire ≠ TPM, un seul mot pour chaque rôle).
const WEB = path.join(__dirname, '../../web/src');
const file = path.join(WEB, 'lib/roles.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('rôle d\'un partenaire : même règle côté écran et côté serveur', async (t) => {
  const r = await load(t); if (!r) return;
  for (const code of ['tpm', 'prestataire', 'cabinet', '', null, undefined]) assert.equal(r.roleOf(code), roleOf(code), String(code));
  assert.equal(r.typeLabelOf('prestataire', 'Prestataire'), 'Partenaire de mise en œuvre');
  assert.equal(r.typeLabelOf('tpm', 'TPM (Tierce partie de suivi)'), 'TPM — tierce partie de suivi');
  assert.equal(r.typeLabelOf('cabinet', 'Cabinet'), 'Cabinet');
});

test('identité d\'un contrat : « n° · titulaire », n° FLA d\'abord, jamais de « · » en trop', async (t) => {
  const r = await load(t); if (!r) return;
  const c = { numero: 'CTR-2026-0001', numeroFla: 'FLA-2025-AIN-MULTI-003', partnerName: 'ASSOCIATION AINA' };
  assert.equal(r.contractIdentity(c), 'FLA-2025-AIN-MULTI-003 · ASSOCIATION AINA');
  assert.equal(r.contractNo(c), contractNo(c));
  assert.equal(r.internalNo(c), 'CTR-2026-0001');
  assert.equal(r.contractIdentity({ numero: 'CTR-TEST-0001' }), 'CTR-TEST-0001', 'titulaire absent : pas de « · » final');
  assert.equal(r.internalNo({ numero: 'CTR-TEST-0001' }), null, 'sans FLA, le n° interne est déjà le n° affiché');
  assert.equal(r.contractNo({ contractNumero: 'CTR-9', contractFla: 'FLA-9', reference: 'REF-RAPPORT' }), 'FLA-9', 'rapport : jamais sa propre référence');
  assert.equal(r.contractNo({ contractNumero: 'CTR-9', contractFla: null }), 'CTR-9');
  assert.equal(r.contractNo({ numero: 'CTR-1', numeroFla: 'FLA-1', reference: 'FLA-1-AM02' }), 'FLA-1-AM02', 'contrat : référence d\'avenant');
  assert.equal(r.contractIdentity({ contractNumero: 'CTR-9', contractFla: 'FLA-9', partnerName: 'RANO Control', contractPartner: 'AINA' }), 'FLA-9 · AINA',
    'rapport : le titulaire, jamais le TPM du rapport');
  assert.equal(r.joinParts('A', '', null, ' ', 'B'), 'A · B');
  assert.equal(r.joinParts('CTR-TEST-0001', ''), 'CTR-TEST-0001');
});

/** Fichiers .js / .jsx de web/src, hors dictionnaires. */
function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'locales') sources(p, out); } else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Libellés interdits : « Prestataire » seul ou ses variantes (titulaire et TPM confondus).
const BANNED = [
  /tr\(\s*'Prestataire'\s*\)/, /tr\(\s*'Prestataires'\s*\)/, /tr\(\s*'Prestataire TPM'\s*\)/, /tr\(\s*'Prestataire \(TPM\)'\s*\)/,
  /tr\(\s*'Tous les prestataires'\s*\)/, /label:\s*'Prestataire(?: TPM)?'/, /'Prestataires TPM'/,
  /tr\(\s*'Autres prestataires TPM/, /tr\(\s*'(?:Choisir|Rechercher) un prestataire/, /tr\(\s*'Choisissez un prestataire/,
  /tr\(\s*'Ce prestataire n\\'est pas le TPM/, /tr\(\s*'Réalisé par prestataire/, /tr\(\s*'Sans prestataire'/,
];
// Écrans retirés du menu, conservés sans être importés (CLAUDE.md : AssignmentPage).
const PENDING_MERGE = new Set([
  'pages/AssignmentPage.jsx', 'pages/MissionCalendarDrawer.jsx',
]);

test('aucun écran n\'écrit « Prestataire » seul : Titulaire, Partenaire de mise en œuvre ou TPM (glossaire lib/roles.js)', (t) => {
  if (!fs.existsSync(WEB)) { t.skip('web/ absent'); return; }
  const hits = [];
  for (const f of sources(WEB)) {
    const rel = path.relative(WEB, f).split(path.sep).join('/');
    if (PENDING_MERGE.has(rel)) continue;
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => { for (const re of BANNED) if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, []);
});
