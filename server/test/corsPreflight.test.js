/**
 * Pré-vol CORS (performance) : l'interface (port 5173) appelle l'API (port 9000) avec un
 * en-tête Authorization, donc chaque appel est précédé d'une requête OPTIONS. Sans
 * Access-Control-Max-Age, le navigateur ne la garde que 5 s : un aller-retour de plus
 * devant presque chaque appel. L'API la fait garder 10 minutes. Sans base (pas d'appel
 * à la base pour un OPTIONS).
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-du-pre-vol-cors-0123456789-abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../src/app');

test('OPTIONS /api/… : pré-vol accepté et mis en cache 10 minutes', async () => {
  const res = await request(createApp()).options('/api/tpm/field/rbm/counts')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'GET')
    .set('Access-Control-Request-Headers', 'authorization,content-type');
  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-max-age'], '600');
  assert.match(res.headers['access-control-allow-headers'] || '', /authorization/i);
});
