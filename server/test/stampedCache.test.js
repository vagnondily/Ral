const test = require('node:test');
const assert = require('node:assert/strict');
const { createStampedCache } = require('../src/modules/common/stampedCache');

test('cache par empreinte : rendu seulement pour la même empreinte, reconstruit sinon', () => {
  const c = createStampedCache({ max: 2 });
  assert.equal(c.get('t1', 'a'), undefined);
  const v = { index: 1 };
  assert.equal(c.set('t1', 'a', v), v);
  assert.equal(c.get('t1', 'a'), v);
  assert.equal(c.get('t1', 'b'), undefined, 'données changées : pas de valeur périmée');
  c.set('t1', 'b', { index: 2 });
  assert.equal(c.get('t1', 'a'), undefined, 'l\'ancienne empreinte est oubliée');
  assert.deepEqual(c.get('t1', 'b'), { index: 2 });
});

test('cache par empreinte : au plus `max` comptes, le moins récemment servi sort', () => {
  const c = createStampedCache({ max: 2 });
  c.set('t1', 's', 1); c.set('t2', 's', 2);
  assert.equal(c.get('t1', 's'), 1); // t1 servi : t2 devient le plus ancien
  c.set('t3', 's', 3);
  assert.equal(c.size, 2);
  assert.equal(c.get('t2', 's'), undefined);
  assert.equal(c.get('t1', 's'), 1);
  assert.equal(c.get('t3', 's'), 3);
  c.delete('t1');
  assert.equal(c.get('t1', 's'), undefined);
});
