/**
 * Révocation de session (constat n° 1) : `requireAuth` revérifie en base, avec
 * cache court, qu'un compte est toujours actif et rafraîchit son rôle — quand
 * SESSION_ACTIVE_CHECK=1. Base injoignable → on laisse passer (repli sur le jeton).
 *
 * Sans base : l'état est injecté via setFetchState.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-revocation-session-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const session = require('../src/modules/auth/sessionCheck');
const { requireAuth, requireRole } = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/errors');

const TENANT = '11111111-1111-1111-1111-111111111111';
const sign = (sub, role) => jwt.sign({ sub, tenantId: TENANT, role }, process.env.JWT_SECRET);

function appWith() {
  const app = express();
  app.get('/whoami', requireAuth, (req, res) => res.json({ role: req.auth.role }));
  app.post('/validate', requireAuth, requireRole('validator', 'admin', 'superuser'), (req, res) => res.status(204).end());
  app.use(errorHandler);
  return app;
}

test.afterEach(() => { session.setFetchState(); session.invalidate('u1'); process.env.SESSION_ACTIVE_CHECK = ''; });

test('désactivé par défaut (pas de SESSION_ACTIVE_CHECK) : aucun contrôle en base', async () => {
  let called = 0; session.setFetchState(async () => { called += 1; return { active: true, role: 'editor' }; });
  const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${sign('u1', 'editor')}`);
  assert.equal(res.status, 200);
  assert.equal(called, 0, 'la base ne doit pas être consultée quand le contrôle est désactivé');
});

test('activé : compte actif → autorisé, rôle rafraîchi depuis la base', async () => {
  process.env.SESSION_ACTIVE_CHECK = '1';
  session.setFetchState(async () => ({ active: true, status: 'active', role: 'viewer' }));
  // Le jeton prétend « admin » ; la base dit « viewer » → la route admin doit être refusée.
  const res = await request(appWith()).post('/validate').set('Authorization', `Bearer ${sign('u1', 'admin')}`);
  assert.equal(res.status, 403, 'le rôle rafraîchi (viewer) doit primer sur le jeton (admin)');
});

test('activé : compte désactivé → 401 même avec un jeton valide', async () => {
  process.env.SESSION_ACTIVE_CHECK = '1';
  session.setFetchState(async () => ({ active: false, status: 'active', role: 'admin' }));
  const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${sign('u1', 'admin')}`);
  assert.equal(res.status, 401);
});

test('activé : compte supprimé (absent) → 401', async () => {
  process.env.SESSION_ACTIVE_CHECK = '1';
  session.setFetchState(async () => null);
  const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${sign('u1', 'editor')}`);
  assert.equal(res.status, 401);
});

test('activé : base injoignable → on laisse passer (repli sur le jeton)', async () => {
  process.env.SESSION_ACTIVE_CHECK = '1';
  session.setFetchState(async () => { throw new Error('db down'); });
  const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${sign('u1', 'editor')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'editor');
});

test('cache : une lecture par fenêtre TTL, invalidate force une relecture', async () => {
  const states = [{ active: true, role: 'editor' }, { active: false, role: 'editor' }];
  let i = 0; session.setFetchState(async () => states[Math.min(i++, states.length - 1)]);
  const t0 = 1_000_000;
  const a = await session.userSessionState('u1', TENANT, t0);
  assert.equal(a.ok, true);
  // Dans la fenêtre : valeur en cache (pas de 2e lecture), toujours ok.
  const b = await session.userSessionState('u1', TENANT, t0 + session.TTL_MS - 1);
  assert.equal(b.ok, true);
  assert.equal(i, 1, 'une seule lecture dans la fenêtre');
  // Après invalidate : relecture → nouvel état (désactivé).
  session.invalidate('u1');
  const c = await session.userSessionState('u1', TENANT, t0 + 1);
  assert.equal(c.ok, false);
  assert.equal(i, 2);
});
