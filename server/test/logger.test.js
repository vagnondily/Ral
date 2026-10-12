const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('stream');
const express = require('express');
const pinoHttp = require('pino-http');
const request = require('supertest');
const { createLogger } = require('../src/config/logger');

function capture() {
  const lines = [];
  const destination = new Writable({ write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); } });
  return { lines, logger: createLogger({ destination, level: 'info' }) };
}

test('journaux HTTP : Authorization et Cookie masqués (pino-http, comme dans app.js)', async () => {
  const { lines, logger } = capture();
  const app = express();
  app.use(pinoHttp({ logger }));
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  await request(app).get('/api/x').set('Authorization', 'Bearer eyJ.secret-jwt.sig').set('Cookie', 'sid=s3cret-cookie');
  await new Promise((r) => setImmediate(r));
  const out = lines.join('');
  assert.ok(out.includes('"url":"/api/x"'), 'la requête est bien journalisée');
  assert.equal(out.includes('secret-jwt'), false, 'aucun jeton dans les journaux');
  assert.equal(out.includes('s3cret-cookie'), false, 'aucun cookie dans les journaux');
  assert.match(out, /"authorization":"\[masqué\]"/);
});

test('journaux applicatifs : champs mot de passe / jeton masqués jusqu\'à trois niveaux', () => {
  const { lines, logger } = capture();
  logger.info({
    password: 'p0', body: { email: 'a@mems.mg', password: 'p1', newPassword: 'p2' },
    link: { url: 'https://kf.example/api', token: 'kobo-token' }, ctx: { headers: { Authorization: 'Token abc' } },
  }, 'contexte');
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.password, '[masqué]');
  assert.equal(entry.body.password, '[masqué]');
  assert.equal(entry.body.newPassword, '[masqué]');
  assert.equal(entry.body.email, 'a@mems.mg'); // le reste est conservé
  assert.equal(entry.link.token, '[masqué]');
  assert.equal(entry.link.url, 'https://kf.example/api');
  assert.equal(entry.ctx.headers.Authorization, '[masqué]');
});
