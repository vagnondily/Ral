#!/usr/bin/env node
/**
 * Banc de période sous RLS (lot 1b, retour n° 47) — `npm run perf:period -- --db <url>`.
 *
 * Mesure les requêtes des écrans « période » sur un jeu synthétique déterministe
 * (scripts/perf/benchData.js) chargé dans une base JETABLE, en appelant les
 * fonctions des dépôts via withTenantTransaction connecté en mems2_app : la RLS
 * est active (en superutilisateur, la même requête des régions prend 59 ms au lieu
 * de 6 s — il masquerait le défaut).
 *
 * Sécurité :
 *  - la base cible doit s'appeler bench_… ; mems2_tpm et la base de DATABASE_URL
 *    sont refusées ; la base est créée, migrée, chargée puis SUPPRIMÉE (sauf --keep) ;
 *  - depuis cc89c57, migrer une base jetable ne remet plus le mot de passe de
 *    mems2_app ; le rôle mems_app (autre système) n'est jamais touché.
 *
 * Pour chaque cible et chaque plage (1, 6, 12, 24 et, pour le terrain, 60 mois
 * finissant en octobre 2026) : `--warmup` chauffes puis `--runs` mesures ; p50,
 * p95, max ; tas retenu (--expose-gc) ; taille de la réponse JSON. Chaque requête
 * capturée est rejouée en EXPLAIN (ANALYZE, FORMAT JSON) sous RLS et passée à la
 * garde (scripts/perf/explainGuard.js). Une requête « connue mauvaise » (l'ancienne
 * résolution des régions) DOIT être signalée par la garde, sinon la garde est cassée.
 *
 * Code de sortie 1 si un p95 dépasse son budget, si la garde signale un plan, ou si
 * la régression connue n'est pas détectée.
 *
 * Options : --db <url superutilisateur de la base bench_…> (obligatoire)
 *           --app-url <url mems2_app> (défaut : APP_DATABASE_URL / BENCH_APP_URL, base remplacée)
 *           --keep (garder la base) · --reuse (base déjà chargée : ni création ni chargement)
 *           --runs 20 · --warmup 3 · --only overview,coverage · --spans 1,6,12
 *           --jit on|off (PG_OPTIONS du pool de l'API) · --out <fichier.md>
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const pg = require('pg');
const { planIssues } = require('./perf/explainGuard');
const { T1, FORMS, DATA_END, loadBenchData } = require('./perf/benchData');

// ---- Arguments --------------------------------------------------------------------
function parseArgs(argv) {
  const out = { runs: 20, warmup: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--db') out.db = next();
    else if (a === '--app-url') out.appUrl = next();
    else if (a === '--keep') out.keep = true;
    else if (a === '--reuse') out.reuse = true;
    else if (a === '--runs') out.runs = Number(next());
    else if (a === '--warmup') out.warmup = Number(next());
    else if (a === '--only') out.only = next().split(',');
    else if (a === '--spans') out.spans = next().split(',').map(Number);
    else if (a === '--jit') out.jit = next();
    else if (a === '--out') out.out = next();
    else throw new Error(`Option inconnue : ${a}`);
  }
  return out;
}

const dbNameOf = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.href; };

function assertSafeTarget(dbUrl) {
  const name = dbNameOf(dbUrl);
  if (!/^bench_[a-z0-9_]+$/.test(name)) throw new Error(`Base refusée (« ${name} ») : le nom doit commencer par bench_ (base jetable).`);
  if (name === 'mems2_tpm') throw new Error('Base refusée : mems2_tpm est la base de l\'application.');
  for (const v of ['DATABASE_URL', 'APP_DATABASE_URL']) {
    if (process.env[v] && dbNameOf(process.env[v]) === name) throw new Error(`Base refusée : c'est la base de ${v}.`);
  }
  return name;
}

// ---- Cibles ------------------------------------------------------------------------
const monthsBack = (to, n) => { const [y, m] = to.split('-').map(Number); const i = y * 12 + (m - 1) - (n - 1); return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const periodOf = (span) => (span ? { from: monthsBack(DATA_END, span), to: DATA_END } : null);

/**
 * Budget p95 (ms). Analyse des soumissions (« volume ») : le budget de 12 mois,
 * la moitié pour un mois, proportionnel au-delà de 12 mois (lignes lues). Terrain et
 * listes (« plat ») : la moitié pour un mois, le budget sinon.
 */
function budgetFor(t, span) {
  if (!t.budget) return null;
  if (span === 1) return t.budget / 2;
  if (t.scale === 'volume' && span > 12) return Math.round(t.budget * (span / 12));
  return t.budget;
}

function targets({ mon, field, periodsService }) {
  const F1 = FORMS[0];
  const previewDef = { sourceField: 'q1', agg: 'percent_yes', positiveValue: null, naValues: ['NA'] };
  return [
    { key: 'overview', label: 'GET /monitoring/overview', budget: 600, scale: 'volume', spans: [1, 6, 12, 24],
      run: (p) => mon.processOverview(T1, p || {}) },
    { key: 'coverage', label: 'GET /monitoring/coverage-dashboard', budget: 1200, scale: 'volume', spans: [1, 6, 12, 24],
      run: (p) => mon.coverageDashboard(T1, p || {}) },
    { key: 'formDashboard', label: 'GET /monitoring/forms/:id/dashboard', budget: 500, scale: 'volume', spans: [1],
      run: (p) => mon.dashboard(T1, F1, { month: p.to }) },
    { key: 'formValues', label: 'GET /monitoring/forms/:id/values', budget: 500, scale: 'volume', spans: [1],
      run: (p) => mon.computeValues(T1, F1, { month: p.to }) },
    { key: 'preview', label: 'POST /monitoring/forms/:id/indicators/preview', budget: 300, scale: 'volume', spans: [1, 6, 12, 24],
      run: (p) => mon.indicatorPreview(T1, F1, previewDef, p || {}) },
    { key: 'formSubmissions', label: 'GET /monitoring/forms/:id/submissions', budget: 300, scale: 'flat', spans: [1],
      run: (p) => mon.formSubmissions(T1, F1, { month: p.to }) },
    { key: 'submissions', label: 'GET /monitoring/submissions', budget: 300, scale: 'flat', spans: [1],
      run: (p) => mon.listSubmissions(T1, { month: p.to }) },
    { key: 'reportMonitoring', label: 'reportMonitoringData (concepteur)', budget: 1500, scale: 'volume', spans: [1, 6, 12, 24],
      run: (p) => mon.reportMonitoringData(T1, p, { lang: 'fr' }) },
    { key: 'periods', label: 'GET /monitoring/periods', budget: 150, scale: 'flat', spans: [0],
      run: () => periodsService.periods(T1, { todayMonth: DATA_END }) },
    { key: 'fieldSummary', label: 'GET /tpm/field/summary', budget: 250, scale: 'flat', spans: [1],
      run: (p) => field.summary(T1, { month: p.to }) },
    { key: 'visits', label: 'GET /tpm/field/visits', budget: 300, scale: 'flat', spans: [1],
      run: (p) => field.listVisits(T1, { month: p.to }) },
    { key: 'coverageRecap', label: 'GET /tpm/field/coverage-recap', budget: 250, scale: 'flat', spans: [0],
      run: () => field.coverageRecapSummary(T1, {}) },
    { key: 'coverageMatrix', label: 'GET /tpm/field/coverage-matrix', budget: 250, scale: 'flat', spans: [0],
      run: () => field.coverageMatrix(T1, { year: 2026 }) },
    { key: 'reportField', label: 'reportFieldData (concepteur)', budget: 250, scale: 'flat', spans: [1, 6, 12, 24, 60],
      run: (p) => field.reportFieldData(T1, p, { lang: 'fr' }) },
    { key: 'rbmSites', label: 'GET /tpm/field/rbm/sites', budget: null, scale: 'flat', spans: [1],
      run: (p) => field.rbmSites(T1, { month: p.to }) },
  ];
}

// Ancienne résolution des régions (REGION_CTE, avant le lot 1b) : la garde DOIT la signaler.
const KNOWN_BAD_REGION_SQL = `WITH pcode_region AS (
         SELECT DISTINCT ON (pcode) pcode, region FROM (
           SELECT c.pcode, r.name AS region, 0 AS src FROM admin_areas c JOIN admin_areas r ON r.id = c.lineage[1]
            WHERE c.tenant_id = $1 AND c.pcode IS NOT NULL AND cardinality(c.lineage) >= 1
           UNION ALL
           SELECT r.pcode, r.name, 0 FROM admin_areas r WHERE r.tenant_id = $1 AND r.depth = 1 AND r.pcode IS NOT NULL
           UNION ALL
           SELECT adm3_pcode, adm1, 1 FROM sites WHERE tenant_id = $1 AND adm3_pcode IS NOT NULL AND NULLIF(adm1, '') IS NOT NULL
         ) x ORDER BY pcode, src)
       SELECT COALESCE(pr.region, pr1.region, NULLIF(s.admin1, ''), '(non renseigné)') AS region,
              count(*)::int AS submissions, count(DISTINCT NULLIF(s.admin3, ''))::int AS communes
         FROM monitoring_submissions s
         LEFT JOIN pcode_region pr ON pr.pcode = COALESCE(s.adm3_pcode, s.admin3)
         LEFT JOIN pcode_region pr1 ON pr1.pcode = upper(btrim(s.admin1))
        WHERE s.tenant_id = $1 AND NOT s.excluded AND s.period_month >= $2::date AND s.period_month < $3::date
        GROUP BY 1 ORDER BY submissions DESC`;

// ---- Mesure -------------------------------------------------------------------------
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
const ms = (ns) => Number(ns) / 1e6;
const mb = (b) => b / (1024 * 1024);

async function explainAll(appUrl, queries) {
  const client = new pg.Client({ connectionString: appUrl });
  await client.connect();
  const out = [];
  try {
    for (const q of queries) {
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [T1]);
        await client.query("SET LOCAL statement_timeout = '180s'");
        const { rows } = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${q.text}`, q.values);
        const plan = rows[0]['QUERY PLAN'];
        out.push({ ...q, issues: planIssues(plan), time: plan[0]['Execution Time'] });
      } catch (err) {
        out.push({ ...q, issues: [{ rule: 'explain_failed', message: err.message }] });
      } finally {
        await client.query('ROLLBACK').catch(() => {});
      }
    }
  } finally { await client.end(); }
  return out;
}

async function measure(t, span, opts, capture) {
  const p = periodOf(span);
  const budget = budgetFor(t, span);
  const times = [];
  let tooSlow = false;
  let queries = null; // requêtes SQL d'UN appel (le premier), rejouées ensuite en EXPLAIN
  const call = async () => {
    if (!queries) capture.list = [];
    const t0 = process.hrtime.bigint();
    const r = await t.run(p);
    const d = ms(process.hrtime.bigint() - t0);
    if (!queries) { queries = capture.list; capture.list = null; }
    return [d, r];
  };
  // Un appel 20 fois au-delà du budget arrête la mesure de cette cible (point de départ connu).
  for (let i = 0; i < opts.warmup && !tooSlow; i += 1) {
    const [d] = await call();
    if (budget && d > 20 * budget) { tooSlow = true; times.push(d); }
  }
  if (global.gc) global.gc();
  const heap0 = process.memoryUsage().heapUsed;
  let result;
  let alloc = null; // tas alloué par appel (borne basse : un GC pendant l'appel le réduit)
  for (let i = 0; i < opts.runs && !tooSlow; i += 1) {
    if (global.gc) { result = undefined; global.gc(); }
    const before = process.memoryUsage().heapUsed;
    const [d, r] = await call();
    if (global.gc) alloc = Math.max(alloc || 0, mb(process.memoryUsage().heapUsed - before));
    times.push(d); result = r;
  }
  let retained = null;
  if (global.gc && result !== undefined) { global.gc(); retained = mb(process.memoryUsage().heapUsed - heap0); }
  const bytes = result !== undefined ? Buffer.byteLength(JSON.stringify(result)) : null;
  const sorted = [...times].sort((a, b) => a - b);
  return {
    key: t.key, label: t.label, span, period: p, runs: times.length, tooSlow,
    p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted[sorted.length - 1], budget,
    retained, alloc, bytes, queries,
  };
}

function report(rows, extra) {
  const f = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));
  const lines = [
    `Banc de période (lot 1b) — ${new Date().toISOString().slice(0, 16)}Z — rôle mems2_app (RLS), jit=${extra.jit}`,
    '',
    '| Cible | Plage | p50 ms | p95 ms | max ms | budget p95 | tas alloué Mo | tas retenu Mo | réponse ko | garde EXPLAIN |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const r of rows) {
    const plage = r.span ? `${r.span} mois` : 'sans période';
    const over = r.budget && r.p95 > r.budget ? ' ⛔' : '';
    const guard = r.guard.length ? `⛔ ${r.guard.length} : ${r.guard[0].message}` : 'ok';
    lines.push(`| ${r.label} | ${plage}${r.tooSlow ? ' (arrêté : trop lent)' : ''} | ${f(r.p50, 1)} | ${f(r.p95, 1)}${over} | ${f(r.max, 1)} | ${f(r.budget)} | ${f(r.alloc, 1)} | ${f(r.retained, 1)} | ${r.bytes == null ? '—' : f(r.bytes / 1024)} | ${guard} |`);
  }
  lines.push('', `Régression connue (ancienne résolution des régions) : ${extra.regression}`);
  return lines.join('\n');
}

// ---- Programme ----------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.db) throw new Error('Option --db obligatoire (ex. postgres://postgres:…@localhost:5432/bench_periode).');
  const name = assertSafeTarget(opts.db);
  const appBase = opts.appUrl || process.env.BENCH_APP_URL || process.env.APP_DATABASE_URL;
  if (!appBase) throw new Error('URL mems2_app introuvable : --app-url ou APP_DATABASE_URL.');
  const appUrl = withDb(appBase, name);
  if (new URL(appUrl).username !== 'mems2_app') throw new Error('Le banc mesure sous mems2_app (RLS) : --app-url doit utiliser ce rôle.');
  const log = (s) => process.stdout.write(`${s}\n`);

  if (!opts.reuse) {
    const admin = new pg.Client({ connectionString: withDb(opts.db, 'postgres') });
    await admin.connect();
    try {
      const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (rows.length) throw new Error(`La base ${name} existe déjà : --reuse pour la réutiliser, ou supprimez-la.`);
      await admin.query(`CREATE DATABASE "${name}"`);
    } finally { await admin.end(); }
    log(`Base ${name} créée ; migrations…`);
    const mig = spawnSync(process.execPath, [path.join(__dirname, '../src/db/migrate.js')], {
      env: { ...process.env, DATABASE_URL: opts.db, LOG_LEVEL: 'warn' }, encoding: 'utf8',
    });
    if (mig.status !== 0) throw new Error(`Migrations en échec :\n${mig.stdout}\n${mig.stderr}`);
    const su = new pg.Client({ connectionString: opts.db });
    await su.connect();
    log('Chargement du jeu synthétique…');
    try { await loadBenchData(su, log); } finally { await su.end(); }
  }

  // Pool de l'API pointé sur la base de banc, en mems2_app. JIT : PG_OPTIONS du pool.
  process.env.APP_DATABASE_URL = appUrl;
  process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || '4';
  if (opts.jit === 'on' || opts.jit === 'off') process.env.PG_OPTIONS = `-c jit=${opts.jit}`;
  const capture = { list: null, keep: null };
  const origQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function captured(text, values, cb) {
    if (capture.list && typeof text === 'string' && /^\s*(WITH|SELECT)\b/i.test(text) && !/set_config\(/.test(text)) {
      capture.list.push({ text, values: Array.isArray(values) ? values : [] });
    }
    return origQuery.call(this, text, values, cb);
  };
  const { pool } = require('../src/config/db');
  const mon = require('../src/modules/monitoring/monitoring.repository');
  const field = require('../src/modules/tpm/field.repository');
  const periodsService = require('../src/modules/monitoring/periods.service');

  let failed = false;
  const rows = [];
  let jit = '?';
  try {
    const c = await pool.connect();
    try { jit = (await c.query('SHOW jit')).rows[0].jit; } finally { c.release(); }
    log(`Mesures sous mems2_app (jit=${jit}), ${opts.warmup} chauffes + ${opts.runs} mesures…`);
    for (const t of targets({ mon, field, periodsService })) {
      if (opts.only && !opts.only.includes(t.key)) continue;
      for (const span of t.spans) {
        if (opts.spans && span && !opts.spans.includes(span)) continue;
        const r = await measure(t, span, opts, capture);
        const explained = await explainAll(appUrl, r.queries);
        r.guard = explained.flatMap((q) => q.issues);
        delete r.queries;
        if ((r.budget && r.p95 > r.budget) || r.guard.length) failed = true;
        rows.push(r);
        log(`  ${t.label} [${span || '—'}] p95 ${r.p95.toFixed(1)} ms${r.guard.length ? ` · garde : ${r.guard.map((g) => g.message).join(' | ')}` : ''}`);
      }
    }
    // La garde doit signaler l'ancienne résolution des régions (mois presque vide : rapide).
    const [bad] = await explainAll(appUrl, [{ text: KNOWN_BAD_REGION_SQL, values: [T1, '2026-04-01', '2026-05-01'] }]);
    const detected = bad.issues.some((i) => i.rule !== 'explain_failed');
    if (!detected) failed = true;
    const regression = detected ? `détectée (${bad.issues[0].message})` : `NON détectée — garde cassée ${JSON.stringify(bad.issues)}`;
    const md = report(rows, { jit, regression });
    log(`\n${md}\n`);
    if (opts.out) fs.writeFileSync(opts.out, `${md}\n`);
  } finally {
    await pool.end();
    if (!opts.keep) {
      const admin = new pg.Client({ connectionString: withDb(opts.db, 'postgres') });
      await admin.connect();
      try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); log(`Base ${name} supprimée.`); } finally { await admin.end(); }
    }
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`Banc interrompu : ${err.message}\n`); process.exit(2); });
}

module.exports = { parseArgs, assertSafeTarget, budgetFor, periodOf };
