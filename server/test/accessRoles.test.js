const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ROLES, normalizeRole, canWrite, canValidate, isAdmin, isSuper,
  WRITE_ROLES, VALIDATE_ROLES, ADMIN_ROLES, SUPER_ROLES,
} = require('../src/modules/common/accessRoles');

test('cinq rôles, du moins au plus étendu', () => {
  assert.deepEqual(ROLES, ['viewer', 'editor', 'validator', 'admin', 'superuser']);
});

test('compat : l\'ancien « manager » est lu comme « validator »', () => {
  assert.equal(normalizeRole('manager'), 'validator');
  assert.equal(normalizeRole('admin'), 'admin');
  assert.equal(normalizeRole('inconnu'), 'inconnu');
});

test('capacités cumulatives (un rôle supérieur a celles des inférieurs)', () => {
  // viewer : rien.
  assert.deepEqual([canWrite('viewer'), canValidate('viewer'), isAdmin('viewer'), isSuper('viewer')], [false, false, false, false]);
  // editor : écrit seulement.
  assert.deepEqual([canWrite('editor'), canValidate('editor'), isAdmin('editor'), isSuper('editor')], [true, false, false, false]);
  // validator : écrit + valide.
  assert.deepEqual([canWrite('validator'), canValidate('validator'), isAdmin('validator'), isSuper('validator')], [true, true, false, false]);
  // admin : + administre.
  assert.deepEqual([canWrite('admin'), canValidate('admin'), isAdmin('admin'), isSuper('admin')], [true, true, true, false]);
  // superuser : tout.
  assert.deepEqual([canWrite('superuser'), canValidate('superuser'), isAdmin('superuser'), isSuper('superuser')], [true, true, true, true]);
  // legacy manager = validator.
  assert.deepEqual([canWrite('manager'), canValidate('manager'), isAdmin('manager')], [true, true, false]);
  // rôle inconnu / absent : aucune capacité.
  assert.equal(canWrite(undefined), false);
  assert.equal(canWrite('n’importe'), false);
});

test('ensembles de rôles cohérents avec les capacités', () => {
  assert.deepEqual(WRITE_ROLES, ['editor', 'validator', 'admin', 'superuser']);
  assert.deepEqual(VALIDATE_ROLES, ['validator', 'admin', 'superuser']);
  assert.deepEqual(ADMIN_ROLES, ['admin', 'superuser']);
  assert.deepEqual(SUPER_ROLES, ['superuser']);
});
