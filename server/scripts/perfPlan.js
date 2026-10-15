#!/usr/bin/env node
/**
 * Banc du générateur de plan (lot 5, § 7) — `npm run perf:plan [-- options]`.
 *
 * 1. Partie pure (toujours) : jeu synthétique déterministe (scripts/perf/planSynth.js) de
 *    --sites sites (défaut 2 200, puis 3 000) sur un exercice complet (12 mois) ; assemblage +
 *    calcul mesurés séparément (--runs mesures après --warmup chauffes : médiane, p95, max),
 *    visites proposées, invariants vérifiés indépendamment (planInvariants : 0 violation
 *    exigée) et déterminisme (deux ordres d'entrée → même empreinte).
 * 2. Partie base (option --db <nom>) : chargeur + assemblage + calcul sur une base EXISTANTE
 *    en LECTURE SEULE, connecté en mems2_app (RLS active) ; mems2_tpm est refusée.
 *
 * Code de sortie 1 si une violation d'invariant, un écart de déterminisme ou un p95 du calcul
 * au-delà de --budget ms (défaut 450).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { performance } = require('node:perf_hooks');
const { synthRaw } = require('./perf/planSynth');
const { assemble } = require('../src/modules/tpm/planInputs');
const { generatePlan } = require('../src/modules/tpm/planGenerator');
const { checkInvariants } = require('../src/modules/tpm/planInvariants');
const { fingerprintResult } = require('../src/modules/tpm/planFingerprint');
const { fromRow } = require('../src/modules/tpm/planSettings');

function args(argv) {
  const o = { runs: 9, warmup: 2, sites: [2200, 3000], budget: 450, db: null, year: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === '--runs') o.runs = Number(next());
    else if (a === '--warmup') o.warmup = Number(next());
    else if (a === '--sites') o.sites = next().split(',').map(Number);
    else if (a === '--budget') o.budget = Number(next());
    else if (a === '--db') o.db = next();
    else if (a === '--year') o.year = Number(next());
  }
  return o;
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const r1 = (x) => Math.round(x * 10) / 10;

function measure(label, raw, opts, o) {
  const settings = fromRow(null);
  const tA = []; const tG = []; let res; let asm;
  for (let i = 0; i < o.warmup + o.runs; i += 1) {
    const a0 = performance.now();
    asm = assemble(raw, { ...opts, settings });
    const a1 = performance.now();
    res = generatePlan(asm.input);
    const a2 = performance.now();
    if (i >= o.warmup) { tA.push(a1 - a0); tG.push(a2 - a1); }
  }
  const violations = checkInvariants(asm.input, res);
  const shuffled = { ...asm.input, sites: [...asm.input.sites].reverse() };
  const same = fingerprintResult(generatePlan(shuffled)) === fingerprintResult(res);
  const json = JSON.stringify({ proposals: res.proposals, sites: res.sites.map((s) => ({ siteId: s.siteId, main: s.main })) }).length;
  console.log(`${label} : ${asm.input.sites.length} sites × ${asm.input.toMonth - asm.input.fromMonth + 1} mois · assemblage p50 ${r1(q(tA, 0.5))} ms · `
    + `calcul p50 ${r1(q(tG, 0.5))} ms p95 ${r1(q(tG, 0.95))} ms max ${r1(Math.max(...tG))} ms · ${res.proposals.length} visites proposées, `
    + `${res.stats.journees} journées, ${res.stats.tours} tournées · violations ${violations.length} · déterministe ${same ? 'oui' : 'NON'} · réponse ≈ ${Math.round(json / 1024)} Ko`);
  if (violations.length) console.log('   ', JSON.stringify(violations.slice(0, 5)));
  return { p95: q(tG, 0.95), violations: violations.length, same };
}

async function dbPart(o) {
  if (/^mems2_tpm$/.test(o.db)) throw new Error('Base refusée : mems2_tpm (utilisez une copie jetable).');
  const appUrl = (process.env.APP_DATABASE_URL || '').replace(/\/[^/]+$/, `/${o.db}`);
  if (!appUrl) throw new Error('APP_DATABASE_URL manquant');
  process.env.APP_DATABASE_URL = appUrl;
  const { withTenantTransaction, pool } = require('../src/config/db');
  const repo = require('../src/modules/tpm/plan.repository');
  const pg = require('pg');
  const c = new pg.Client({ connectionString: appUrl }); await c.connect();
  const { rows: [t] } = await c.query('SELECT current_user AS u'); await c.end();
  const { rows: tenants } = await pool.query("SELECT id FROM tenants ORDER BY created_at LIMIT 1").catch(() => ({ rows: [] }));
  const tenantId = tenants[0] && tenants[0].id;
  if (!tenantId) throw new Error('Aucun compte lisible (RLS : passez par un compte connu).');
  const now = new Date();
  const year = o.year || now.getUTCFullYear();
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const tL = []; let raw;
  for (let i = 0; i < 5; i += 1) {
    const a0 = performance.now();
    raw = await withTenantTransaction(tenantId, (client) => repo.loadPlanInputsTx(client, tenantId, { year }));
    tL.push(performance.now() - a0);
  }
  console.log(`Base ${o.db} (rôle ${t.u}, RLS) : chargeur p50 ${r1(q(tL, 0.5))} ms max ${r1(Math.max(...tL))} ms — ${raw.sites.length} sites, ${raw.visits.length} visites, ${raw.grid.length} cases de grille`);
  const res = measure(`Base ${o.db} ${year}`, raw, { year, todayMonth: today, from: 1, to: 12 }, o);
  await pool.end();
  return res;
}

(async () => {
  const o = args(process.argv.slice(2));
  let fail = false;
  for (const n of o.sites) {
    for (const grid of [0, 1]) {
      const raw = synthRaw({ n, seed: 42 + n, year: 2027, gridShare: grid });
      const r = measure(`Synthétique ${n} sites, grille ${grid ? 'connue' : 'absente'}`, raw, { year: 2027, todayMonth: '2026-10', from: 1, to: 12 }, o);
      if (r.violations || !r.same || r.p95 > o.budget) fail = true;
    }
  }
  if (o.db) { const r = await dbPart(o); if (r.violations || !r.same) fail = true; }
  if (fail) { console.log('ÉCHEC du banc'); process.exit(1); }
  console.log('Banc OK');
})().catch((e) => { console.error(e); process.exit(1); });
