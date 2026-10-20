const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { followedSql, timelineTrainingSql, heldSql } = require('../src/modules/trainings/trainingSql');

// « Formation suivie » : UNE définition SQL (revue du lot 8 : trois définitions coexistaient).
test('formation suivie : session tenue (réalisée ou commencée), non annulée, participant non absent', () => {
  assert.equal(heldSql('s'), "(s.status = 'realisee' OR s.start_date <= current_date)");
  assert.equal(followedSql('s', 'p'),
    "(s.status <> 'annulee' AND (p.attendance IS NULL OR p.attendance <> 'absent') AND (s.status = 'realisee' OR s.start_date <= current_date))");
  // La frise montre aussi les formations à venir (« prévue pour … ») : sans la condition de date.
  assert.equal(timelineTrainingSql('s', 'p'), "(s.status <> 'annulee' AND (p.attendance IS NULL OR p.attendance <> 'absent'))");
});

/**
 * Garde : dans un fichier source, chaque requête (gabarit `…`) qui COMPTE des participations
 * (count( … FROM training_participants) applique followedSql ; timelineTrainingSql n'est admise QUE
 * dans la frise (gabarit qui porte l'événement 'formation') et heldSql y fixe le libellé.
 * @returns {string[]} les fautes
 */
function counterFaults(src) {
  const faults = [];
  for (const tpl of src.match(/`[^`]*`/g) || []) {
    const timeline = /'formation', CASE WHEN/.test(tpl);
    if (/timelineTrainingSql\(/.test(tpl) && !timeline) faults.push(`timelineTrainingSql hors de la frise : ${tpl.slice(0, 90)}`);
    if (timeline) { if (!/heldSql\(/.test(tpl)) faults.push('frise : libellé sans heldSql'); continue; }
    // Statistiques d'UNE session (inscrits, présents…) : exemption explicite, écrite dans la requête.
    if (/\/\* inscriptions : /.test(tpl)) continue;
    if (/count\(/.test(tpl) && /FROM training_participants/.test(tpl) && !/followedSql\(/.test(tpl)) faults.push(`compteur sans followedSql : ${tpl.slice(0, 90)}`);
    if (/status <> 'annulee'|attendance <> 'absent'/.test(tpl)) faults.push(`règle écrite à la main : ${tpl.slice(0, 90)}`);
  }
  return faults;
}

test('garde : chaque compteur de formations applique followedSql ; la règle de la frise reste dans la frise', () => {
  for (const f of ['modules/partners/partners.repository.js', 'modules/tpm/tpm.repository.js', 'modules/trainings/trainings.repository.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
    assert.deepEqual(counterFaults(src), [], f);
  }
});

test('la garde attrape un compteur écrit avec la règle de la frise (formations à venir comptées)', () => {
  const bad = "const X = `SELECT count(*) FROM training_participants p JOIN training_sessions s ON s.id = p.session_id WHERE ${timelineTrainingSql('s', 'p')}`;";
  assert.ok(counterFaults(bad).some((f) => /hors de la frise/.test(f)));
  const bad2 = "const Y = `SELECT count(*) FROM training_participants p WHERE p.attendance <> 'absent'`;";
  assert.ok(counterFaults(bad2).length >= 1);
  const good = "const Z = `SELECT count(*) FROM training_participants p JOIN training_sessions s ON s.id = p.session_id WHERE ${followedSql('s', 'p')}`;";
  assert.deepEqual(counterFaults(good), []);
});
