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

test('visite que personne ne suit : UN nom — « Non affectée (ni TPM ni suivi interne) » — dans la matrice, l\'alerte, la carte, la cellule et le CSV ; une visite interne n\'en est jamais une', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const en = (await load(t, 'locales/en.js')).default;
  const { UNIT_LABELS } = require('../src/modules/tpm/fieldMath');
  const { PHRASES } = require('../src/modules/reports/phrases');
  const NA = 'Non affectée (ni TPM ni suivi interne)';
  assert.equal(w.UNASSIGNED_LABEL, NA);
  assert.equal(UNIT_LABELS.non_affecte, NA, 'matrice et résumé « par TPM »');
  assert.equal(PHRASES.fr.unassigned, NA, 'rapports');
  assert.equal(en[NA], 'Unassigned (neither TPM nor internal monitoring)');
  // Qui suit une visite (CSV et tri de la grille) : jamais un blanc, jamais « sans TPM » pour une interne.
  assert.equal(w.visitWho(tr, { providerId: 'p1', providerName: 'YPA', monitoredBy: 'tpm' }), 'YPA');
  assert.equal(w.visitWho(tr, { providerId: null, monitoredBy: 'interne' }), 'Interne');
  assert.equal(w.visitWho(tr, { providerId: null, monitoredBy: 'non_affecte', providerZoneState: 'anterieur' }), NA);
  assert.equal(w.visitWho(tr, { providerId: null, providerSource: 'zone', providerZoneState: 'sans_tpm' }), 'Interne', 'repli sans la colonne');
  assert.equal(w.visitWho(tr, { providerId: null, providerSource: 'zone', providerZoneState: 'anterieur' }), NA);
  assert.equal(w.visitUnassigned({ providerId: null, monitoredBy: 'interne' }), false);
  assert.equal(w.visitUnassigned({ providerId: null, monitoredBy: 'non_affecte' }), true);
  assert.equal(w.visitUnassigned({ providerId: 'p1', monitoredBy: 'tpm' }), false);
  // Alerte et signal de la carte : le même nom, jamais « sans TPM » (qui décrit aussi les visites internes).
  const { fieldAlerts } = require('../src/modules/dashboards/alertsMath');
  const { signalsOf } = require('../src/modules/map/mapThemes');
  const field = { byProvider: [{ key: 'interne', label: 'Interne', active: 19, realise: 12, rate: 12 / 19, total: 19 }, { key: 'non_affecte', label: NA, active: 1, realise: 0, rate: 0, total: 1 }] };
  for (const opts of [{}, { month: '2026-09' }, { range: true }]) {
    const [a] = fieldAlerts(field, opts).filter((x) => x.kind === 'visits_unassigned');
    assert.equal(a.params.n, 1, 'les visites internes ne comptent pas');
    assert.match(a.detail, /^Ni TPM ni suivi interne/);
    assert.ok(en[a.title] && en[a.detail], `anglais : ${a.detail}`);
  }
  const sig = signalsOf({ active: 3, visitsUnassigned: 2 }).find((x) => x.kind === 'visits_unassigned');
  assert.equal(sig.title, '{n} visite(s) non affectée(s) (ni TPM ni suivi interne)');
  assert.ok(en[sig.title]);
  // Cellule : jamais le même libellé deux fois (nom + origine, infobulle) ; CSV : visitWho.
  const cell = src('pages/monitoring/TpmFields.jsx');
  assert.match(cell, /title=\{origin && origin !== label \? `\$\{label\} — \$\{origin\}` : label\}/);
  assert.match(cell, /origin && origin !== shown && <span className="pb-tpm-origin">/);
  assert.match(cell, /tr\(UNASSIGNED_LABEL\)/);
  assert.match(src('pages/monitoring/FieldVisitsPage.jsx'), /csv: \(v\) => visitWho\(tr, v\)/);
});

test('Rapports attendus (CSV) : la colonne du mois de remise s\'appelle « À remettre au plus tard » / « Due by », jamais « Échéance » (« Expiry » = fin d\'un contrat)', async (t) => {
  const en = await load(t, 'locales/en.js'); if (!en) return;
  const csv = src('pages/tpm/ExpectedReports.jsx');
  const head = csv.slice(csv.indexOf('function exportCsv()'), csv.indexOf('downloadCsv(', csv.indexOf('function exportCsv()')));
  assert.match(head, /tr\('Pourquoi'\), tr\('À remettre au plus tard'\), tr\('Factures'\)/);
  assert.ok(!head.includes("tr('Échéance')"));
  assert.equal(en.default['À remettre au plus tard'], 'Due by');
  assert.equal(en.default['Échéance'], 'Expiry', 'le libellé des contrats reste inchangé');
});
