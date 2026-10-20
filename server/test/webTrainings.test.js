const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Grille des participants d'une formation (web/src/lib/trainings.js) — revue du lot 8 : seuls les
// champs modifiés partent (C8), une cellule illisible est refusée (C7), une saisie en cours survit
// à un rechargement de la page (C6).
const file = path.join(__dirname, '../../web/src/lib/trainings.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const P = (o) => ({ agentId: 'a1', agentName: 'H. Solo', attendance: 'present', daysPresent: 3, preScore: 8, postScore: 15, satisfaction: 4, feedback: 'Utile', ...o });

test('saisie : seuls les participants et les champs MODIFIÉS sont envoyés', async (t) => {
  const w = await load(t); if (!w) return;
  const loaded = [P(), P({ agentId: 'a2', agentName: 'R. Randria', preScore: null, postScore: null })];
  const rows = loaded.map(w.editableParticipant);
  assert.deepEqual(w.participantPatches(rows, loaded), { patches: [], errors: [], dirty: false });
  rows[1] = { ...rows[1], preScore: '12,5' };
  assert.deepEqual(w.participantPatches(rows, loaded).patches, [{ agentId: 'a2', preScore: 12.5 }], 'a1 et les autres champs de a2 ne partent pas');
  rows[0] = { ...rows[0], feedback: '', attendance: '' };
  assert.deepEqual(w.participantPatches(rows, loaded).patches[0], { agentId: 'a1', attendance: null, feedback: null }, 'vider = effacer, explicitement');
});

test('saisie : une cellule illisible est refusée (agent et colonne), rien n\'est envoyé', async (t) => {
  const w = await load(t); if (!w) return;
  const loaded = [P()];
  for (const bad of ['15/20', '1 5', 'abc', '2j']) {
    const rows = [{ ...w.editableParticipant(loaded[0]), postScore: bad }];
    const r = w.participantPatches(rows, loaded);
    assert.deepEqual([r.patches, r.errors, r.dirty], [[], [{ agentId: 'a1', agentName: 'H. Solo', field: 'postScore' }], true], bad);
  }
  assert.deepEqual(w.readNumber(' 15,5 '), { ok: true, value: 15.5 });
  assert.deepEqual(w.readNumber(''), { ok: true, value: null });
  assert.equal(w.readNumber('NaN').ok, false);
});

test('rechargement pendant une saisie : les champs saisis restent, ajouts et retraits suivis', async (t) => {
  const w = await load(t); if (!w) return;
  const before = [P(), P({ agentId: 'a2', agentName: 'R. Randria', preScore: null })];
  const rows = before.map(w.editableParticipant);
  rows[1] = { ...rows[1], preScore: '11' };            // saisie en cours sur a2
  const after = [P({ feedback: 'Très utile' }), P({ agentId: 'a2', agentName: 'R. Randria', preScore: null }), P({ agentId: 'a3', agentName: 'L. Miora' })];
  const merged = w.mergeParticipantRows(rows, before, after);
  assert.deepEqual(merged.map((r) => [r.agentId, r.preScore, r.feedback]), [['a1', '8', 'Très utile'], ['a2', '11', 'Utile'], ['a3', '8', 'Utile']]);
  assert.deepEqual(w.participantPatches(merged, after).patches, [{ agentId: 'a2', preScore: 11 }], 'toujours à enregistrer');
  assert.deepEqual(w.mergeParticipantRows(merged, after, [after[2]]).map((r) => r.agentId), ['a3'], 'retirés : disparus');
});

test('après un enregistrement : ce qui a été saisi PENDANT l\'envoi et le rechargement est gardé', async (t) => {
  const w = await load(t); if (!w) return;
  const before = [P({ preScore: null }), P({ agentId: 'a2', agentName: 'R. Randria', postScore: null })];
  let rows = before.map(w.editableParticipant);
  rows[0] = { ...rows[0], preScore: '12' };
  const sent = w.participantPatches(rows, before).patches;          // envoyé : a1 preScore 12
  assert.deepEqual(sent, [{ agentId: 'a1', preScore: 12 }]);
  rows = rows.map((r) => (r.agentId === 'a2' ? { ...r, postScore: '15' } : r)); // saisi pendant l'envoi
  rows[0] = { ...rows[0], feedback: 'Très utile' };                  // et sur la ligne envoyée
  const after = [P({ preScore: 12 }), P({ agentId: 'a2', agentName: 'R. Randria', postScore: null })];
  const merged = w.rowsAfterSave(rows, before, sent, after);
  assert.deepEqual(merged.map((r) => [r.agentId, r.preScore, r.postScore, r.feedback]), [['a1', '12', '15', 'Très utile'], ['a2', '8', '15', 'Utile']]);
  assert.deepEqual(w.participantPatches(merged, after).patches, [{ agentId: 'a1', feedback: 'Très utile' }, { agentId: 'a2', postScore: 15 }],
    'les saisies du pendant restent à enregistrer ; ce qui a été enregistré ne l\'est plus');
});

test('« 15,5 » saisi puis enregistré (15.5 en base) : plus rien à enregistrer', async (t) => {
  const w = await load(t); if (!w) return;
  const before = [P({ preScore: null })];
  const rows = [{ ...w.editableParticipant(before[0]), preScore: '15,5' }];
  const sent = w.participantPatches(rows, before).patches;
  const after = [P({ preScore: 15.5 })];
  assert.equal(w.participantPatches(w.rowsAfterSave(rows, before, sent, after), after).dirty, false);
});
