const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { errorHandler, badRequest, payloadTooLarge } = require('../src/middleware/errors');

/** Appelle le gestionnaire d'erreurs avec une fausse réponse ; renvoie { status, body }. */
function handle(err) {
  const out = {};
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  const logged = [];
  errorHandler(err, { log: { error: (...a) => logged.push(a) } }, res, () => {});
  return { ...out, logged };
}

test('AppError : statut et message transmis tels quels (400, 413)', () => {
  assert.deepEqual(handle(badRequest('Date illisible à la ligne 4.', { invalidDates: [] })),
    { status: 400, body: { error: 'Date illisible à la ligne 4.', details: { invalidDates: [] } }, logged: [] });
  assert.equal(handle(payloadTooLarge('trop gros')).status, 413);
});

test('corps trop gros (body-parser) → 413 avec la limite, jamais 500', () => {
  const err = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413, statusCode: 413, limit: 80 * 1024 * 1024 });
  const r = handle(err);
  assert.equal(r.status, 413);
  assert.match(r.body.error, /taille maximale acceptée est de 80 Mo/); // la limite « 80mb » des routes
  assert.equal(r.logged.length, 0);
});

test('JSON mal formé → 400', () => {
  const r = handle(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /JSON valide/);
});

test('PostgreSQL : 22007 / 22008 (date invalide) → 400 clair ; 23505 → 409 ; inconnu → 500 générique', () => {
  for (const code of ['22007', '22008']) {
    const r = handle(Object.assign(new Error('invalid input syntax for type timestamp with time zone: "NaN-NaN"'), { code }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Date invalide.*AAAA-MM-JJ/);
    assert.doesNotMatch(r.body.error, /timestamp|NaN/); // aucun détail technique
  }
  assert.equal(handle(Object.assign(new Error('dup'), { code: '23505' })).status, 409);
  assert.equal(handle(Object.assign(new Error('fk'), { code: '23503' })).status, 400);
  const boom = handle(new Error('secret interne'));
  assert.deepEqual(boom.body, { error: 'Erreur interne du serveur.' });
  assert.equal(boom.status, 500);
  assert.equal(boom.logged.length, 1);
});

test('bout en bout : express.raw au-delà de sa limite renvoie 413 (et non 500)', async () => {
  const app = express();
  app.post('/upload', express.raw({ type: '*/*', limit: '1kb' }), (req, res) => res.json({ size: req.body.length }));
  app.post('/json', express.json(), (req, res) => res.json(req.body));
  app.use(errorHandler);
  const big = await request(app).post('/upload').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(4096));
  assert.equal(big.status, 413);
  assert.match(big.body.error, /Envoi trop volumineux/);
  const ok = await request(app).post('/upload').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(100));
  assert.deepEqual([ok.status, ok.body.size], [200, 100]); // le serveur répond toujours
  const malformed = await request(app).post('/json').set('Content-Type', 'application/json').send('{"a":');
  assert.equal(malformed.status, 400);
});
