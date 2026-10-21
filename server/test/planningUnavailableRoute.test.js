/**
 * Décision D-c (relecture croisée, point 25) — POST /api/tpm/planning SANS base : un TPM déclaré
 * indisponible tout le mois du plan → 400 net (code tpm_unavailable), jamais 500.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-planification-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/tpm/planning.repository');

repo.createPlan = async () => { const e = new Error('Ce TPM est déclaré indisponible ce mois-là : aucun plan de collecte ne peut lui être confié (Affectation des TPM › Indisponibilités).'); e.code = 'TPM_UNAVAILABLE'; throw e; };
const routes = require('../src/modules/tpm/planning.routes');
const { errorHandler } = require('../src/middleware/errors');

const app = express();
app.use(express.json());
app.use('/api/tpm/planning', routes);
app.use(errorHandler);
const manager = jwt.sign({ sub: 'u1', tenantId: '11111111-1111-1111-1111-111111111111', role: 'manager' }, process.env.JWT_SECRET);

test('plan d un TPM indisponible : 400 tpm_unavailable, message lisible', async () => {
  const res = await request(app).post('/api/tpm/planning').set({ Authorization: `Bearer ${manager}` })
    .send({ partnerId: '44444444-4444-4444-4444-444444444444', contractId: '55555555-5555-5555-5555-555555555555', periodMonth: '2026-12' });
  assert.equal(res.status, 400);
  assert.equal(res.body.details && res.body.details.code, 'tpm_unavailable');
  assert.match(res.body.error || res.body.message || '', /indisponible/);
});
