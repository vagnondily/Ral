const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionOptions, pool } = require('../src/config/db');

test('pool de l\'API : JIT désactivé par défaut (-c jit=off), PG_OPTIONS le remplace', () => {
  assert.equal(sessionOptions({}), '-c jit=off');
  assert.equal(sessionOptions({ PG_OPTIONS: '-c jit=on' }), '-c jit=on');
  assert.equal(sessionOptions({ PG_OPTIONS: '  -c jit=off -c work_mem=8MB ' }), '-c jit=off -c work_mem=8MB');
  assert.equal(sessionOptions({ PG_OPTIONS: '' }), undefined, 'vide : réglages du serveur');
  assert.equal(sessionOptions({ PG_OPTIONS: '   ' }), undefined);
});

test('le pool partagé transmet les options de session à chaque connexion', () => {
  const expected = sessionOptions();
  assert.equal(pool.options.options, expected);
});
