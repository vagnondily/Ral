/**
 * Libellés qui doivent dire la même chose partout (relecture croisée des branches) : contrats d'une
 * zone, visite non affectée, notes du plan auto, en-têtes de CSV — en français et en anglais.
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
const tr = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const src = (rel) => fs.readFileSync(path.join(WEB, rel), 'utf8');
// Littéraux tr('…') d'un écran (échappements \' rendus).
const literals = (rel) => [...src(rel).matchAll(/tr\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, '\''));

test('Affectation des TPM : une zone couverte par un contrat SANS TPM le montre (« sans TPM »), jamais « aucun contrat de suivi » ; CSV idem', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const withTpm = { contractId: 'k1', numero: 'CTR-1', contractLabel: 'FLA-1', providerName: 'YPA', endMonth: '2026-12' };
  const bare = { contractId: 'k2', numero: 'CTR-2', contractLabel: 'FLA-2026-FAN-SUIVI-010', holderName: 'ONG FANILO' };
  // Tsihombe : contrat sans TPM seul sur la période.
  const tsihombe = { contractSegments: [{ from: '2026-10', to: '2026-12', state: 'sans_tpm', candidates: [], noTpm: [bare] }] };
  assert.deepEqual(w.zoneContracts(tsihombe), [{ ...bare, noTpm: true }]);
  assert.equal(w.segmentContractLabel(tsihombe.contractSegments[0]), 'FLA-2026-FAN-SUIVI-010');
  // Contrat avec TPM puis sans TPM : chacun une fois, ceux qui donnent un TPM d'abord.
  const mixed = { contractSegments: [
    { from: '2026-10', to: '2026-10', state: 'sans_tpm', candidates: [], noTpm: [bare] },
    { from: '2026-11', to: '2026-11', state: 'contrat', contractLabel: 'FLA-1', candidates: [withTpm], noTpm: [] },
    { from: '2026-12', to: '2026-12', state: 'sans_tpm', candidates: [], noTpm: [bare] },
  ] };
  assert.deepEqual(w.zoneContracts(mixed).map((c) => [c.contractId, c.noTpm]), [['k1', false], ['k2', true]]);
  assert.equal(w.segmentContractLabel(mixed.contractSegments[1]), 'FLA-1');
  // Sans contrat : liste vide (« aucun contrat de suivi »), CSV vide.
  const none = { contractSegments: [{ from: '2026-10', to: '2026-10', state: 'sans_contrat', candidates: [], noTpm: [] }] };
  assert.deepEqual(w.zoneContracts(none), []);
  assert.equal(w.segmentContractLabel(none.contractSegments[0]), '');
  assert.equal(w.segmentContractLabel(undefined), '');
  assert.equal(w.segmentContractLabel({ noTpm: [{ numero: 'CTR-9' }] }), 'CTR-9', 'sans n° FLA : n° MEMS');
  // L'écran s'en sert (colonne et CSV) et l'étiquette a son anglais.
  const tab = src('pages/monitoring/TpmAttributionTab.jsx');
  assert.match(tab, /const contracts = zoneContracts\(row\);/);
  assert.match(tab, /segmentContractLabel\(c\), s\.providerName/);
  const en = (await load(t, 'locales/en.js')).default;
  assert.equal(en['sans TPM'], 'no TPM');
});

test('plan auto : la note et l\'en-tête disent la règle du retour 114 (sans TPM — aucun contrat, contrat sans TPM, TPM indisponible — suivi interne), en anglais aussi', async (t) => {
  const en = await load(t, 'locales/en.js'); if (!en) return;
  const lit = literals('pages/monitoring/PlanAutoDrawer.jsx');
  assert.ok(!lit.some((s) => /sans contrat, le suivi|sinon bureau\)/.test(s)), 'ancienne règle « sans contrat » seulement');
  const note = lit.find((s) => s.startsWith('Le TPM d\'un site = '));
  assert.match(note, /sans TPM \(aucun contrat, contrat sans TPM, TPM indisponible\), le suivi est interne : équipe S&E du bureau\./);
  const head = lit.find((s) => s.startsWith('Par unité de suivi'));
  assert.match(head, /sans TPM, suivi interne du bureau/);
  for (const s of [note, head]) assert.ok(Object.prototype.hasOwnProperty.call(en.default, s), `sans anglais — ${s}`);
  assert.match(en.default[note], /no contract, contract without a TPM, TPM unavailable/);
  assert.ok(!Object.values(en.default).some((v) => /without a contract, the office monitors it/.test(v)), 'aucune ancienne traduction');
});
