const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkRows, insertRows, MAX_PARAMS } = require('../src/db/batch');

test('lots sous la limite de paramètres PostgreSQL (65 535)', () => {
  const rows = Array.from({ length: 21000 }, (_, i) => i);
  const chunks = chunkRows(rows, 6);
  assert.ok(chunks.every((c) => c.length * 6 <= MAX_PARAMS));
  assert.equal(chunks.flat().length, 21000);
  assert.deepEqual(chunkRows([], 6), []);
});

test('insertRows : une instruction par lot, placeholders contigus, total des lignes', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: params.length / 2 }; } };
  const rows = Array.from({ length: 30001 }, (_, i) => ({ a: i, b: `v${i}` }));
  const n = await insertRows(client, { table: 't', columns: ['a', 'b'], rows, values: (r) => [r.a, r.b], suffix: 'ON CONFLICT DO NOTHING' });
  assert.equal(n, 30001);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.params.length <= MAX_PARAMS));
  assert.match(calls[1].sql, /^INSERT INTO t \(a, b\) VALUES \(\$1,\$2\) ON CONFLICT DO NOTHING$/);
});
