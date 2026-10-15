/**
 * Service de la planification automatique (lot 5), SANS base : transaction et dépôts
 * remplacés par des espions. Vérifie l'ordre « verrous des mois → rechargement → empreinte »,
 * le 409 quand les données ont changé (avec les sections), le refus d'une proposition inconnue,
 * la coche manuelle qui l'emporte, le verrou optimiste des paramètres, et qu'aucune visite
 * générée ne porte de prestataire (retour 58 : la base l'estampille d'après les contrats).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const repo = require('../src/modules/tpm/plan.repository');
const fieldRepo = require('../src/modules/tpm/field.repository');
const { synthRaw } = require('../scripts/perf/planSynth');

const log = [];
let raw = synthRaw({ n: 120, seed: 11, year: 2027, gridShare: 1 });
let savedRow = null;
db.withTenantTransaction = async (tenantId, fn) => fn({ tenantId });
repo.getSettingsTx = async () => savedRow;
repo.lockSettingsTx = async () => (savedRow ? savedRow.revision : 0);
repo.saveSettingsTx = async (client, tenantId, userId, s) => { log.push(['save', s]); savedRow = { revision: (savedRow ? savedRow.revision : 0) + 1, objective: s.objective }; return savedRow.revision; };
repo.lockMonthsTx = async (client, tenantId, months) => { log.push(['lock', [...new Set(months)].sort()]); };
repo.loadPlanInputsTx = async () => { log.push(['load']); return raw; };
repo.insertRunTx = async (client, tenantId, userId, run) => { log.push(['run', run]); return 'run-1'; };
repo.insertGeneratedTx = async (client, tenantId, userId, a) => { log.push(['insert', a]); return a.visits.length; };
repo.setRunCreatedTx = async (client, tenantId, runId, n) => { log.push(['created', runId, n]); };
fieldRepo.planMonthsTx = async (client, tenantId, userId, year, changes) => { log.push(['manual', changes]); return { added: changes.length, removed: 0, skippedInactive: 0 }; };
const service = require('../src/modules/tpm/plan.service');

const NOW = new Date('2026-10-15T08:00:00Z');
const T = 't1';
const body = { year: 2027, from: 1, to: 3, officeId: null, activity: null, district: null, params: {} };

test('aperçu : rien n\'est écrit ; empreinte, propositions avec raison, sites non planifiés avec raison', async () => {
  log.length = 0;
  const p = await service.preview(T, body, { now: NOW });
  assert.match(p.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(p.proposals.length > 0);
  assert.ok(p.proposals.every((x) => x.why && x.month >= 1 && x.month <= 3));
  assert.ok(p.unplanned.every((x) => x.code));
  assert.deepEqual(log.map((l) => l[0]), ['load']);
  assert.ok(p.pools.length > 0 && p.totals.proposals === p.proposals.length);
});

test('aperçu : un site inactif ce mois n\'est jamais proposé, il apparaît avec la raison « inactif »', async () => {
  const site = raw.sites[0].id;
  const saved = raw;
  raw = { ...raw, grid: [...raw.grid.filter((g) => !(g.siteId === site && g.month <= 3)), ...[1, 2, 3].map((m) => ({ siteId: site, month: m, active: false }))] };
  const p = await service.preview(T, body, { now: NOW });
  assert.ok(!p.proposals.some((x) => x.siteId === site));
  assert.equal(p.unplanned.find((x) => x.siteId === site).code, 'inactif');
  raw = saved;
});

test('application : verrous des mois AVANT le rechargement ; visites générées sans prestataire ; manuel prioritaire', async () => {
  const p = await service.preview(T, body, { now: NOW });
  const keep = p.proposals.slice(0, 5).map((x) => ({ siteId: x.siteId, month: x.month }));
  const manual = [{ siteId: keep[0].siteId, month: keep[0].month, planned: true }];
  log.length = 0;
  const r = await service.apply(T, 'u1', { ...body, fingerprint: p.fingerprint, sections: p.sections, keep, changes: manual }, { now: NOW });
  const order = log.map((l) => l[0]);
  assert.deepEqual(order, ['lock', 'load', 'manual', 'run', 'insert', 'created']);
  const months = log[0][1];
  assert.deepEqual(months, [...new Set(keep.map((k) => `2027-0${k.month}`))].sort());
  const ins = log.find((l) => l[0] === 'insert')[1];
  assert.equal(ins.visits.length, 4, 'la case cochée à la main n\'est pas aussi générée');
  assert.ok(ins.visits.every((v) => v.why && !('providerId' in v) && !('provider_id' in v)));
  assert.equal(ins.runId, 'run-1');
  assert.equal(r.created, 4);
  assert.equal(log.find((l) => l[0] === 'run')[1].kept, 4);
});

test('application : données changées depuis l\'aperçu → 409 avec les sections, rien d\'écrit', async () => {
  const p = await service.preview(T, body, { now: NOW });
  const keep = p.proposals.slice(0, 2).map((x) => ({ siteId: x.siteId, month: x.month }));
  const saved = raw;
  raw = { ...raw, visits: [...raw.visits, { siteId: raw.sites[5].id, month: 2, status: 'planifie' }] };
  log.length = 0;
  await assert.rejects(service.apply(T, 'u1', { ...body, fingerprint: p.fingerprint, sections: p.sections, keep, changes: [] }, { now: NOW }),
    (e) => e.statusCode === 409 && e.details.code === 'plan_inputs_changed' && e.details.sections.includes('visites'));
  assert.deepEqual(log.map((l) => l[0]), ['lock', 'load']);
  raw = saved;
  // Le mois courant change entre l'aperçu et l'application : l'empreinte change aussi (jamais de visite au passé).
  const p2 = await service.preview(T, { ...body, year: 2026, from: 10, to: 12 }, { now: NOW });
  if (p2.proposals.length) {
    await assert.rejects(service.apply(T, 'u1', { ...body, year: 2026, from: 10, to: 12, fingerprint: p2.fingerprint, keep: [{ siteId: p2.proposals[0].siteId, month: p2.proposals[0].month }], changes: [] },
      { now: new Date('2026-11-02T08:00:00Z') }), (e) => e.statusCode === 409 && e.details.sections.includes('parametres'));
  }
});

test('application : proposition absente de l\'aperçu → 400, rien d\'écrit', async () => {
  const p = await service.preview(T, body, { now: NOW });
  const outside = raw.sites.find((s) => !p.proposals.some((x) => x.siteId === s.id && x.month === 1));
  log.length = 0;
  await assert.rejects(service.apply(T, 'u1', { ...body, fingerprint: p.fingerprint, keep: [{ siteId: outside.id, month: 1 }], changes: [] }, { now: NOW }),
    (e) => e.statusCode === 400 && e.details.code === 'proposition_inconnue');
  assert.ok(!log.some((l) => ['manual', 'run', 'insert'].includes(l[0])));
});

test('critères ajustés pour un aperçu : revalidés, signalés « ajustés », dans l\'empreinte', async () => {
  const a = await service.preview(T, body, { now: NOW });
  const b = await service.preview(T, { ...body, params: { levels: ['haute'], minMonthsSinceVisit: 6 } }, { now: NOW });
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.deepEqual(b.overridden.sort(), ['levels', 'minMonthsSinceVisit']);
  assert.ok(b.proposals.length <= a.proposals.length);
  await assert.rejects(service.preview(T, { ...body, params: { coverageTargetPct: 0 } }, { now: NOW }), (e) => e.statusCode === 400);
});

test('paramètres : verrou optimiste (révision périmée → 409), valeurs contrôlées avant toute écriture', async () => {
  savedRow = null; log.length = 0;
  const { DEFAULTS } = require('../src/modules/tpm/planSettings');
  const r1 = await service.saveSettings(T, 'u1', { ...DEFAULTS, levels: ['haute', 'moyenne'], revision: 0 });
  assert.equal(r1.revision, 1);
  await assert.rejects(service.saveSettings(T, 'u1', { ...DEFAULTS, revision: 0 }), (e) => e.statusCode === 409 && e.details.code === 'revision' && e.details.current === 1);
  const before = log.length;
  await assert.rejects(service.saveSettings(T, 'u1', { ...DEFAULTS, objective: 'x', revision: 1 }), (e) => e.statusCode === 400);
  assert.equal(log.length, before);
  savedRow = null;
});
