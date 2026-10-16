const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Modification en ligne d'une visite (web/src/lib/fieldVisits.js) : la ligne affichée tout de
// suite suit les règles du PATCH serveur (champ absent = inchangé, vide = effacé).
const file = path.join(__dirname, '../../web/src/lib/fieldVisits.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

const V = { id: 'v1', siteName: 'Site', providerId: 'p1', providerName: 'Prest. A', agent: 'Agent 1', status: 'planifie', visitDate: '2026-10-05' };
const P = [{ id: 'p1', name: 'Prest. A' }, { id: 'p2', name: 'Prest. B' }];

test('visite modifiée : prestataire, rôle, statut, date — comme le serveur', async (t) => {
  const v = await load(t); if (!v) return;
  assert.deepEqual(v.applyVisitPatch(V, { providerId: 'p2' }, P), { ...V, providerId: 'p2', providerName: 'Prest. B' });
  assert.deepEqual(v.applyVisitPatch(V, { providerId: '' }, P), { ...V, providerId: null, providerName: null });
  assert.deepEqual(v.applyVisitPatch(V, { agent: '  Superviseur 1 ' }, P), { ...V, agent: 'Superviseur 1' });
  assert.deepEqual(v.applyVisitPatch(V, { status: 'realise' }, P), { ...V, status: 'realise' });
  assert.deepEqual(v.applyVisitPatch(V, { visitDate: '' }, P), { ...V, visitDate: null });
  assert.deepEqual(v.applyVisitPatch(V, { visitDate: '2026-10-12' }, P), { ...V, visitDate: '2026-10-12' });
});

test('visite modifiée : champ absent = inchangé ; la ligne d\'origine n\'est pas modifiée', async (t) => {
  const v = await load(t); if (!v) return;
  const before = { ...V };
  assert.deepEqual(v.applyVisitPatch(V, {}, P), V);
  assert.deepEqual(V, before);
  // Prestataire inconnu de la liste (ajouté ailleurs) : identifiant gardé, nom inconnu jusqu'à la relecture.
  assert.deepEqual(v.applyVisitPatch(V, { providerId: 'p9' }, P), { ...V, providerId: 'p9', providerName: null });
});
