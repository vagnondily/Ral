/**
 * Badge « Indisponible … » des écrans partenaires et contrats (revue croisée #5) : lu dans la réponse
 * de GET /api/tpm/attribution/unavailability (web/src/lib/tpmAttribution.unavailabilityOf), au mois
 * courant du serveur — une seule source, rien de recalculé.
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

test('indisponibilité actuelle ou prochaine d\'un TPM : la période du serveur, au mois courant du serveur', async (t) => {
  const w = await load(t, 'lib/tpmAttribution.js'); if (!w) return;
  const data = { period: { from: '2026-10', to: '2027-09' }, periods: [
    { providerId: 'ypa', from: '2027-02', to: '2027-03', reason: 'Plus tard' },
    { providerId: 'ypa', from: '2026-10', to: '2026-11', reason: 'Équipe mobilisée' },
    { providerId: 'sahy', from: '2026-12', to: '2027-01', reason: 'Congés' },
    { providerId: 'rano', from: '2026-08', to: '2026-09', reason: 'Passée' },
  ] };
  assert.deepEqual(w.unavailabilityOf(data, 'ypa'), { from: '2026-10', to: '2026-11', reason: 'Équipe mobilisée', current: true }, 'la période en cours d\'abord');
  assert.deepEqual(w.unavailabilityOf(data, 'sahy'), { from: '2026-12', to: '2027-01', reason: 'Congés', current: false }, 'à venir');
  assert.equal(w.unavailabilityOf(data, 'rano'), null, 'passée : rien');
  assert.equal(w.unavailabilityOf(data, 'autre'), null);
  assert.equal(w.unavailabilityOf(null, 'ypa'), null, 'réponse pas encore arrivée');
  assert.equal(w.rangeLabel('2026-10', '2026-11').includes('–'), true);
});

test('les écrans ne recalculent pas l\'indisponibilité : ils lisent unavailabilityOf sur la réponse de l\'API', () => {
  for (const rel of ['pages/ProvidersPage.jsx', 'pages/tpm/ProviderSheetPage.jsx', 'pages/contracts/ContractDetailPage.jsx']) {
    const src = fs.readFileSync(path.join(WEB, rel), 'utf8');
    assert.match(src, /useTpmUnavailability\(/, `${rel} : une requête`);
    assert.match(src, /unavailabilityOf\(unavailability, /, `${rel} : lecture commune`);
  }
});
