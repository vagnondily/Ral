const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { followedSql, timelineTrainingSql } = require('../src/modules/trainings/trainingSql');

// « Formation suivie » : UNE définition SQL (revue du lot 8 : trois définitions coexistaient).
test('formation suivie : session tenue (réalisée ou commencée), non annulée, participant non absent', () => {
  assert.equal(followedSql('s', 'p'),
    "(s.status <> 'annulee' AND (p.attendance IS NULL OR p.attendance <> 'absent') AND (s.status = 'realisee' OR s.start_date <= current_date))");
  // La frise montre aussi les formations à venir (« prévue pour … ») : sans la condition de date.
  assert.equal(timelineTrainingSql('s', 'p'), "(s.status <> 'annulee' AND (p.attendance IS NULL OR p.attendance <> 'absent'))");
});

test('garde : aucun compteur de formations n\'écrit sa propre règle (followedSql partout)', () => {
  const files = ['modules/partners/partners.repository.js', 'modules/tpm/tpm.repository.js', 'modules/trainings/trainings.repository.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
    assert.doesNotMatch(src, /status <> 'annulee'|attendance <> 'absent'/, `${f} : règle écrite à la main`);
    assert.match(src, /followedSql\(/, `${f} : utilise followedSql`);
  }
  // Toute requête qui COMPTE des participations (training_participants) passe par la règle, sauf
  // les décomptes « inscrits » explicites (liste des sessions, chiffres clés).
  const partners = fs.readFileSync(path.join(__dirname, '../src/modules/partners/partners.repository.js'), 'utf8');
  for (const m of partners.matchAll(/count\([^)]*\)[^`]*?FROM training_participants[\s\S]*?(?=\)::int|`)/g)) {
    assert.match(m[0], /followedSql|timelineTrainingSql/, `compteur sans la règle : ${m[0].slice(0, 120)}`);
  }
});
