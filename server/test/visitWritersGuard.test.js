/**
 * Garde statique du retour 58 : tout fichier du serveur qui écrit des visites (INSERT INTO
 * site_visits, ou UPDATE site_visits qui change le statut, le site, le mois ou le TPM) appelle
 * aussi restampVisitsTx — le TPM des visites « zone » est celui de leur zone, compté dans le
 * compte rendu et pris sous le verrou d'attribution (ordre des verrous). La base garde un filet
 * de sécurité (migration 070 : estampille différée au COMMIT), mais un écrivain qui l'oublie
 * prend le verrou trop tard : ce test le signale avant qu'il ne soit publié.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'migrations' ? [] : files(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

const WRITES = [
  /INSERT INTO site_visits\b/,
  /UPDATE site_visits\b[\s\S]{0,400}?\bSET\b[\s\S]{0,600}?\b(status|site_id|period_month|provider_id|provider_source)\s*=/,
];

test('retour 58 : tout écrivain de visites appelle restampVisitsTx (seeds compris)', () => {
  const writers = files(SRC).filter((f) => WRITES.some((re) => re.test(fs.readFileSync(f, 'utf8'))));
  assert.ok(writers.length >= 3, `écrivains trouvés : ${writers.length}`);
  const missing = writers.filter((f) => !/\brestampVisitsTx\b/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(missing.map((f) => path.relative(SRC, f)), [],
    'Ces fichiers écrivent des visites sans restampVisitsTx (server/src/modules/tpm/tpmAttribution.repository.js)');
});
