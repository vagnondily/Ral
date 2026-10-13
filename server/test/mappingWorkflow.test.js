const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  TRANSITIONS, STATUSES, EDITABLE, canTransition, editError, transitionError, mappingActions, transitionPatch,
} = require('../src/modules/monitoring/mappingWorkflow');

test('machine d\'états du mapping : exactement les transitions autorisées', () => {
  const allowed = new Set(['brouillon>soumis', 'soumis>valide', 'soumis>brouillon', 'valide>brouillon']);
  assert.deepEqual([...STATUSES].sort(), ['brouillon', 'soumis', 'valide']);
  for (const from of STATUSES) {
    for (const to of STATUSES) assert.equal(canTransition(from, to), allowed.has(`${from}>${to}`), `${from} → ${to}`);
  }
  assert.equal(canTransition('toString', 'soumis'), false, 'pas de clé héritée');
  assert.deepEqual(EDITABLE, ['brouillon']);
});

test('modification d\'une dimension : seulement en brouillon', () => {
  assert.equal(editError({ status: 'brouillon' }), null);
  assert.match(editError({ status: 'soumis' }).message, /figé pendant la validation/);
  assert.match(editError({ status: 'valide' }).message, /validé : réinitialisez-le/);
  assert.equal(editError({ status: 'valide' }).code, 'status');
});

test('soumettre / valider / réinitialiser : statut requis et séparation des tâches', () => {
  assert.equal(transitionError('submit', { status: 'brouillon' }, 'a'), null);
  assert.match(transitionError('submit', { status: 'soumis' }, 'a').message, /déjà soumis/);
  assert.match(transitionError('submit', { status: 'valide' }, 'a').message, /réinitialisez-le d'abord/);
  assert.match(transitionError('validate', { status: 'brouillon' }, 'b').message, /Seul un mapping soumis/);
  // Le soumetteur ne valide pas son propre mapping (403) ; une autre personne, si.
  const own = transitionError('validate', { status: 'soumis', submittedBy: 'a' }, 'a');
  assert.equal(own.code, 'self');
  assert.match(own.message, /Séparation des tâches/);
  assert.equal(transitionError('validate', { status: 'soumis', submittedBy: 'a' }, 'b'), null);
  // Soumetteur supprimé (ON DELETE SET NULL) : la validation reste possible.
  assert.equal(transitionError('validate', { status: 'soumis', submittedBy: null }, 'a'), null);
  assert.equal(transitionError('reset', { status: 'soumis' }, 'a'), null);
  assert.equal(transitionError('reset', { status: 'valide' }, 'a'), null);
  assert.match(transitionError('reset', { status: 'brouillon' }, 'a').message, /déjà en brouillon/);
  assert.equal(transitionError('publier', { status: 'brouillon' }, 'a').code, 'action');
  assert.equal(transitionError('toString', { status: 'brouillon' }, 'a').code, 'action');
});

test('actions offertes = règles de l\'écriture ; lecture seule sans rôle d\'écriture', () => {
  const W = (userId) => ({ userId, canWrite: true });
  const pick = (a) => [a.edit, a.submit, a.validate, a.reset, a.apply];
  assert.deepEqual(pick(mappingActions({ status: 'brouillon' }, W('a'))), [true, true, false, false, true]);
  const mine = mappingActions({ status: 'soumis', submittedBy: 'a' }, W('a'));
  assert.deepEqual(pick(mine), [false, false, false, true, true]);
  assert.match(mine.validateReason, /Séparation des tâches/);
  const other = mappingActions({ status: 'soumis', submittedBy: 'a' }, W('b'));
  assert.deepEqual(pick(other), [false, false, true, true, true]);
  assert.equal(other.validateReason, null);
  // Validé : lecture seule, sauf réinitialiser (et appliquer aux soumissions).
  assert.deepEqual(pick(mappingActions({ status: 'valide', submittedBy: 'a' }, W('b'))), [false, false, false, true, true]);
  const viewer = mappingActions({ status: 'brouillon' }, { userId: 'v', canWrite: false });
  assert.deepEqual(pick(viewer), [false, false, false, false, false]);
});

test('transitionPatch : auteurs et horodatages du cycle en cours', () => {
  const now = new Date('2026-10-13T08:00:00Z');
  assert.deepEqual(transitionPatch('submit', 'a', now), { status: 'soumis', submittedBy: 'a', submittedAt: now, validatedBy: null, validatedAt: null });
  assert.deepEqual(transitionPatch('validate', 'b', now), { status: 'valide', validatedBy: 'b', validatedAt: now });
  assert.deepEqual(transitionPatch('reset', 'a', now), { status: 'brouillon', submittedBy: null, submittedAt: null, validatedBy: null, validatedAt: null });
});

// Écran (web/src/lib/mappingWorkflow.js, module ES pur) : un badge par statut du serveur, avec
// une icône connue de STATUS_ICONS (couleur + icône + libellé), et les mêmes clés de date.
test('web : statuts affichés = statuts du serveur ; comptes « mois de collecte »', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/mappingWorkflow.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const { pathToFileURL } = require('url');
  const web = await import(pathToFileURL(file).href);
  const { DATE_KEYS } = require('../src/modules/monitoring/memsMapping');
  assert.deepEqual(Object.keys(web.MAPPING_STATUS).sort(), [...STATUSES].sort());
  const icons = ['check', 'x', 'clock', 'ban', 'draft', 'dot', 'warn', 'na'];
  for (const d of Object.values(web.MAPPING_STATUS)) {
    assert.ok(d.label && icons.includes(d.icon), JSON.stringify(d));
  }
  assert.deepEqual(web.DATE_KEYS, DATE_KEYS);
  // Serveur ancien : tout le mois de réception inconnu est « à appliquer ».
  assert.deepEqual(web.dateStats({ total: 10, withUpload: 8, monthDiffers: 2 }), { total: 10, differs: 2, pendingUpload: 2, withoutUpload: 0, pct: 25 });
  // Lignes sans date de réception dans leurs données : comptées à part, jamais « à appliquer ».
  assert.deepEqual(web.dateStats({ total: 50, withUpload: 10, monthDiffers: 1, uploadPending: 0, withoutUpload: 40 }),
    { total: 50, differs: 1, pendingUpload: 0, withoutUpload: 40, pct: 10 });
  assert.deepEqual(web.dateStats({ total: 50, withUpload: 10, monthDiffers: 0, uploadPending: 15, withoutUpload: 25 }),
    { total: 50, differs: 0, pendingUpload: 15, withoutUpload: 25, pct: 0 });
  assert.deepEqual(web.dateStats(null), { total: 0, differs: 0, pendingUpload: 0, withoutUpload: 0, pct: null });
});

// La base impose les mêmes règles (migration 060) : transitions et statuts modifiables du SQL
// identiques à ceux du module pur.
test('migration 060 : transitions et statut modifiable identiques à mappingWorkflow', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/060_mapping_workflow.sql'), 'utf8');
  const start = sql.indexOf('-- transitions: mappingWorkflow.TRANSITIONS');
  const block = sql.slice(sql.indexOf('NOT IN (', start), sql.indexOf(') THEN', sql.indexOf('NOT IN (', start)));
  const pairs = [...block.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const expected = STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => `${from}>${to}`)).sort();
  assert.deepEqual(pairs, expected);
  const editable = [...sql.matchAll(/-- editable: mappingWorkflow\.EDITABLE\n[^\n]*NOT IN \(([^)]*)\)/g)]
    .map((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort());
  assert.equal(editable.length, 1);
  assert.deepEqual(editable[0], [...EDITABLE].sort());
  assert.match(sql, /CHECK \(mapping_status IN \('brouillon', 'soumis', 'valide'\)\)/);
  assert.match(sql, /SELECT mems_install_same_tenant\('monitoring_forms'\);/);
});
