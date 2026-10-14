#!/usr/bin/env node
/**
 * Banc de la carte du suivi (lot 6a) — `node scripts/bench-map.js --db <url superutilisateur> [options]`.
 *
 * Mesure GET /api/map/districts (et /points dès qu'il existe) en appelant le SERVICE
 * via le pool de l'API connecté en mems2_app (RLS active) : `--runs` mesures après
 * `--warmup` chauffes, p50 / p95 / max par cas, plus un EXPLAIN (ANALYZE, SUMMARY)
 * de la requête de faits.
 *
 * Cas : plages de 1, 10, 24 et 36 mois finissant à `--to` (défaut 2026-10), filtre
 * bureau (le bureau qui a le plus de sites), filtre activité (la plus fréquente).
 *
 * Options :
 *   --app-url <url mems2_app>   (défaut : APP_DATABASE_URL, base remplacée par celle de --db)
 *   --tenant <uuid>             (défaut : le compte qui a le plus de sites)
 *   --scale <k>                 multiplie le registre par k (copies marquées « bench6a- », SUPPRIMÉES
 *                               à la fin ; base 6a_… ou bench_… seulement)
 *   --verify                    parité SQL ↔ règle pure : faits par district recalculés en JS
 *                               (common/siteActivity.siteRangeFacts, mode « données ») sur les
 *                               mêmes lignes ; écart = code de sortie 1
 *   --import-cost <n>           coût du déclencheur GPS (migration 061) : insère n soumissions
 *                               synthétiques DANS UNE TRANSACTION ANNULÉE, avec puis sans le
 *                               déclencheur (base 6a_… ou bench_… seulement)
 *   --runs 20 · --warmup 3 · --to 2026-10 · --spans 1,10,24,36
 * Budgets : p95 ≤ 150 ms (≤ 400 ms avec --scale) ; import ≤ 6 s pour 10 000 lignes.
 */
const path = require('path');
const pg = require('pg');

function parseArgs(argv) {
  const out = { runs: 20, warmup: 3, to: '2026-10', spans: [1, 10, 24, 36], scale: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--db') out.db = next();
    else if (a === '--app-url') out.appUrl = next();
    else if (a === '--tenant') out.tenant = next();
    else if (a === '--scale') out.scale = Number(next());
    else if (a === '--verify') out.verify = true;
    else if (a === '--import-cost') out.importCost = Number(next());
    else if (a === '--runs') out.runs = Number(next());
    else if (a === '--warmup') out.warmup = Number(next());
    else if (a === '--to') out.to = next();
    else if (a === '--spans') out.spans = next().split(',').map(Number);
    else throw new Error(`Option inconnue : ${a}`);
  }
  if (!out.db) throw new Error('--db <url superutilisateur> est requis');
  return out;
}

const dbName = (url) => new URL(url).pathname.replace(/^\//, '');
const writable = (url) => /^(6a_|bench_)/.test(dbName(url));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (dbName(args.db) === 'mems2_tpm' && (args.scale > 1 || args.importCost)) throw new Error('Écriture refusée sur mems2_tpm.');
  if ((args.scale > 1 || args.importCost) && !writable(args.db)) throw new Error('--scale / --import-cost : base 6a_… ou bench_… seulement.');
  const appUrl = new URL(args.appUrl || process.env.APP_DATABASE_URL || 'postgres://mems2_app:mems2_app_change_me@localhost:5432/x');
  appUrl.pathname = `/${dbName(args.db)}`;
  process.env.APP_DATABASE_URL = appUrl.toString();
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  const su = new pg.Client({ connectionString: args.db });
  await su.connect();
  const { addMonths } = require(path.join(__dirname, '../src/modules/common/period'));
  const service = require(path.join(__dirname, '../src/modules/map/map.service'));
  const repo = require(path.join(__dirname, '../src/modules/map/map.repository'));
  const { pool } = require(path.join(__dirname, '../src/config/db'));
  let failed = false;
  try {
    const tenantId = args.tenant || (await su.query('SELECT tenant_id FROM sites GROUP BY 1 ORDER BY count(*) DESC LIMIT 1')).rows[0].tenant_id;
    if (args.scale > 1) await scaleUp(su, tenantId, args.scale);
    const office = (await su.query('SELECT field_office_id AS id FROM sites WHERE tenant_id = $1 AND field_office_id IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1', [tenantId])).rows[0]?.id || null;
    const activity = (await su.query("SELECT btrim(activity) AS a FROM sites WHERE tenant_id = $1 AND NULLIF(btrim(activity), '') IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1", [tenantId])).rows[0]?.a || null;
    const sites = Number((await su.query('SELECT count(*) FROM sites WHERE tenant_id = $1', [tenantId])).rows[0].count);
    const budget = args.scale > 1 ? 400 : 150;
    const cases = [
      ...args.spans.map((n) => ({ name: `${n} mois`, opts: { period: { from: addMonths(args.to, -(n - 1)), to: args.to } } })),
      { name: '1 mois · bureau', opts: { period: { from: args.to, to: args.to }, officeId: office } },
      { name: '10 mois · activité', opts: { period: { from: addMonths(args.to, -9), to: args.to }, activity } },
    ];
    console.log(`Compte ${tenantId} · ${sites} sites · budget p95 ${budget} ms`);
    for (const c of cases) {
      for (let i = 0; i < args.warmup; i += 1) await service.districts({ tenantId }, c.opts);
      const ms = [];
      let out = null;
      for (let i = 0; i < args.runs; i += 1) {
        const t0 = process.hrtime.bigint();
        out = await service.districts({ tenantId }, c.opts);
        ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      const p95 = pct(ms, 0.95);
      if (p95 > budget) failed = true;
      console.log(`${c.name.padEnd(20)} p50 ${pct(ms, 0.5).toFixed(1).padStart(6)} ms · p95 ${p95.toFixed(1).padStart(6)} ms · max ${Math.max(...ms).toFixed(1).padStart(6)} ms · ${JSON.stringify(out).length} o · contours ${out.shapes.length}${p95 > budget ? '  ✗ BUDGET' : ''}`);
    }
    await explainFacts(su, tenantId, { from: addMonths(args.to, -11), to: args.to }, repo);
    if (args.verify) failed = (await verifyParity(su, tenantId, { from: addMonths(args.to, -9), to: args.to }, repo)) || failed;
    if (args.importCost) failed = (await importCost(su, tenantId, args.importCost)) || failed;
  } finally {
    if (args.scale > 1) {
      await su.query("DELETE FROM sites WHERE code LIKE 'bench6a-%'");
      console.log('Copies du banc supprimées.');
    }
    await su.end();
    await pool.end();
  }
  process.exit(failed ? 1 : 0);
}

/** Registre ×k : copies des sites (mêmes rattachements), visites et soumissions rattachées copiées. */
async function scaleUp(su, tenantId, k) {
  await su.query("DELETE FROM sites WHERE code LIKE 'bench6a-%'");
  await su.query(
    `INSERT INTO sites (tenant_id, code, name, district, commune, adm1, adm2, adm3, adm2_pcode, adm3_pcode, admin_area_id,
                        risk_level, field_office_id, activity, security_situation)
     SELECT s.tenant_id, 'bench6a-' || g || '-' || s.code, s.name, s.district, s.commune, s.adm1, s.adm2, s.adm3, s.adm2_pcode, s.adm3_pcode,
            s.admin_area_id, s.risk_level, s.field_office_id, s.activity, s.security_situation
       FROM sites s CROSS JOIN generate_series(2, $2::int) g
      WHERE s.tenant_id = $1 AND s.code NOT LIKE 'bench6a-%'`, [tenantId, k]);
  await su.query(
    `INSERT INTO site_visits (tenant_id, site_id, period_month, status, activity)
     SELECT v.tenant_id, c.id, v.period_month, v.status, v.activity
       FROM site_visits v JOIN sites o ON o.id = v.site_id
       JOIN sites c ON c.tenant_id = o.tenant_id AND c.code LIKE 'bench6a-%-' || o.code
      WHERE v.tenant_id = $1 ON CONFLICT DO NOTHING`, [tenantId]);
  const n = (await su.query("SELECT count(*) FROM sites WHERE code LIKE 'bench6a-%'")).rows[0].count;
  console.log(`Registre ×${k} : ${n} copies ajoutées (supprimées à la fin).`);
}

/** EXPLAIN de la requête de faits, sous mems2_app (RLS), avec la même transaction que l'API. */
async function explainFacts(su, tenantId, period, repo) {
  const app = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await app.connect();
  try {
    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await app.query('SET LOCAL jit = off');
    let captured = null;
    await repo.factsByZoneTx({ query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; } }, tenantId, { period });
    const { rows } = await app.query(`EXPLAIN (ANALYZE, SUMMARY, FORMAT JSON) ${captured.sql}`, captured.params);
    const plan = rows[0]['QUERY PLAN'][0];
    console.log(`EXPLAIN faits (12 mois) : exécution ${plan['Execution Time'].toFixed(1)} ms · planification ${plan['Planning Time'].toFixed(1)} ms`);
    await app.query('ROLLBACK');
  } finally {
    await app.end();
  }
}

/**
 * Parité SQL ↔ règle pure : relit les lignes brutes (sites, grille, visites, soumissions
 * rattachées compatibles) et replie chaque site avec siteRangeFacts ; compare par district.
 */
async function verifyParity(su, tenantId, period, repo) {
  const { siteRangeFacts } = require(path.join(__dirname, '../src/modules/common/siteActivity'));
  const { monthsOf } = require(path.join(__dirname, '../src/modules/common/period'));
  const { rows: sites } = await su.query(
    `SELECT s.id, COALESCE(s.security_situation, 0) >= 99 AS forbidden, lower(NULLIF(btrim(s.activity), '')) AS act, ad.id::text AS did
       FROM sites s LEFT JOIN admin_areas ad ON ad.tenant_id = s.tenant_id AND ad.pcode = s.adm2_pcode WHERE s.tenant_id = $1`, [tenantId]);
  const { rows: grid } = await su.query('SELECT site_id, year, month, active FROM site_month_status WHERE tenant_id = $1', [tenantId]);
  const { rows: visits } = await su.query("SELECT site_id, to_char(period_month, 'YYYY-MM') AS month, status FROM site_visits WHERE tenant_id = $1", [tenantId]);
  const { rows: data } = await su.query(
    `SELECT ms.site_id, to_char(ms.period_month, 'YYYY-MM') AS month, lower(NULLIF(btrim(mf.activity_category), '')) AS cat
       FROM monitoring_submissions ms JOIN monitoring_forms mf ON mf.id = ms.form_id
      WHERE ms.tenant_id = $1 AND ms.site_id IS NOT NULL AND NOT ms.excluded`, [tenantId]);
  const gridYears = new Set(grid.map((g) => g.year));
  const by = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const gridBy = by(grid, 'site_id'); const visBy = by(visits, 'site_id'); const datBy = by(data, 'site_id');
  const months = new Set(monthsOf(period));
  const js = new Map();
  for (const s of sites) {
    const statuses = new Map((gridBy.get(s.id) || []).filter((g) => g.active).map((g) => [`${g.year}-${String(g.month).padStart(2, '0')}`, true]));
    const dataMonths = (datBy.get(s.id) || []).filter((d) => months.has(d.month) && (d.cat == null || s.act == null || d.cat === s.act)).map((d) => d.month);
    const f = siteRangeFacts({ statuses, gridYears, forbidden: s.forbidden, visits: visBy.get(s.id) || [], dataMonths }, period);
    const k = s.did || '';
    const z = js.get(k) || { active: 0, realised: 0, realisedData: 0, planned: 0, visitsPlanned: 0, visitsPlannedRealised: 0, visitsOffPlan: 0 };
    z.active += f.active ? 1 : 0; z.realised += f.realisedAny ? 1 : 0; z.realisedData += f.realisedData ? 1 : 0;
    z.planned += f.planned ? 1 : 0; z.visitsPlanned += f.vPlanned; z.visitsPlannedRealised += f.vPlannedRealised; z.visitsOffPlan += f.vOffPlan;
    js.set(k, z);
  }
  const { withTenantTransaction } = require(path.join(__dirname, '../src/config/db'));
  const rows = await withTenantTransaction(tenantId, (c) => repo.factsByZoneTx(c, tenantId, { period }));
  const sqlBy = new Map();
  for (const r of rows.filter((x) => x.dim === 'district')) {
    const k = r.did || '';
    const z = sqlBy.get(k) || { active: 0, realised: 0, realisedData: 0, planned: 0, visitsPlanned: 0, visitsPlannedRealised: 0, visitsOffPlan: 0 };
    for (const key of Object.keys(z)) z[key] += Number(r[key]) || 0;
    sqlBy.set(k, z);
  }
  let diffs = 0;
  for (const k of new Set([...js.keys(), ...sqlBy.keys()])) {
    const a = JSON.stringify(js.get(k) || null); const b = JSON.stringify(sqlBy.get(k) || null);
    if (a !== b) { diffs += 1; if (diffs <= 5) console.log(`  écart district ${k || '(aucun)'} : JS ${a} · SQL ${b}`); }
  }
  console.log(`Parité SQL ↔ pur (${period.from} → ${period.to}) : ${js.size} districts, ${diffs} écart(s)`);
  return diffs > 0;
}

/** Coût d'écriture du déclencheur GPS : n soumissions synthétiques, transaction ANNULÉE. */
async function importCost(su, tenantId, n) {
  const form = (await su.query('SELECT form_id FROM monitoring_submissions WHERE tenant_id = $1 GROUP BY 1 ORDER BY count(*) DESC LIMIT 1', [tenantId])).rows[0];
  if (!form) { console.log('Import : aucune soumission modèle.'); return false; }
  const run = async (withTrigger) => {
    await su.query('BEGIN');
    try {
      if (!withTrigger) await su.query('ALTER TABLE monitoring_submissions DISABLE TRIGGER trg_mon_sub_gps');
      const t0 = process.hrtime.bigint();
      await su.query(
        `INSERT INTO monitoring_submissions (tenant_id, form_id, external_id, period_month, data, source)
         SELECT $1, $2, 'bench6a-' || g, '2026-01-01', ms.data, 'csv'
           FROM generate_series(1, $3::int) g
           JOIN LATERAL (SELECT data FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 ORDER BY id OFFSET (g % 50) LIMIT 1) ms ON true`,
        [tenantId, form.form_id, n]);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    } finally {
      await su.query('ROLLBACK');
    }
  };
  const withT = await run(true);
  const without = await run(false);
  const perRow = (withT - without) / n;
  const budget = (6000 * n) / 10000;
  console.log(`Import ${n} soumissions : ${withT.toFixed(0)} ms avec le déclencheur GPS, ${without.toFixed(0)} ms sans (≈ ${perRow.toFixed(3)} ms/ligne ; budget ${budget.toFixed(0)} ms)${withT > budget ? '  ✗ BUDGET' : ''}`);
  return withT > budget;
}

main().catch((e) => { console.error(e); process.exit(1); });
