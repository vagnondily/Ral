#!/usr/bin/env node
/**
 * Banc du concepteur de rapport (lot 7a) — `npm run bench:report -- [options]`.
 * LECTURE SEULE : aucune écriture en base.
 *
 * Mesure, sous le rôle mems2_app (RLS ACTIVE : en superutilisateur, les plans sont
 * différents et masquent les défauts — le banc refuse de tourner autrement) :
 *   - par fiche : les résultats d'indicateurs lus en flux (indicatorFacts : curseur, réponses
 *     utiles, décomptes additifs) et, avec --check, l'ancien calcul ligne à ligne (toutes les
 *     soumissions en mémoire) ;
 *   - par modèle système : le rendu complet d'un rapport (reports.service.renderReport) ;
 * minimum, médiane et p95 sur `--runs` passes, tas maximal observé.
 *
 * --check compare le calcul en flux au calcul ligne à ligne sur TOUTES les fiches du tenant
 * (global, par bureau, par mois ; valeur, base, classe, présents, hors base, explication) :
 * 0 écart exigé, sinon code de sortie 1.
 *
 * Options : --tenant <uuid> (défaut : le tenant qui a le plus de soumissions, lu avec
 *             DATABASE_URL en lecture seule) · --period 2026-01:2026-10 · --runs 5
 *           · --check · --json · --only forms|templates
 * Environnement : APP_DATABASE_URL = mems2_app sur la base à mesurer (obligatoire).
 */
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const pg = require('pg');
const { pool, withTenantTransaction } = require('../src/config/db');
const { computeAll, explainIndicator, keyIndex, namesFor } = require('../src/modules/monitoring/monitoringMath');
const { computeCalcFields } = require('../src/modules/monitoring/calcFields');
const { formFactsTx, formResultsTx, resultsOf, calcDefsTx, activeIndicatorsTx } = require('../src/modules/monitoring/indicatorFacts.repository');
const { explainOf, mergeAll } = require('../src/modules/monitoring/indicatorTallies');
const monitoringRepo = require('../src/modules/monitoring/monitoring.repository');
const { parsePeriod } = require('../src/modules/common/period');
const { monthWithin } = require('../src/modules/common/periodSql');

function parseArgs(argv) {
  const out = { runs: 5, period: null, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--tenant') out.tenant = next();
    else if (a === '--period') { const [from, to] = next().split(':'); out.period = { from, to: to || from }; }
    else if (a === '--runs') out.runs = Math.max(1, Number(next()) || 5);
    else if (a === '--check') out.check = true;
    else if (a === '--json') out.json = true;
    else if (a === '--only') out.only = next();
    else if (a === '--cold' || a === '--warm') out.mode = a.slice(2); // cache : lot 7a C10
    else throw new Error(`Option inconnue : ${a}`);
  }
  if (out.period) {
    const r = parsePeriod(out.period);
    if (!r.ok) throw new Error(r.message);
  }
  return out;
}

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (xs) => ({ min: Math.min(...xs), p50: q(xs, 50), p95: q(xs, 95), runs: xs.length });

let heapPeak = 0;
const sampler = setInterval(() => { heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed); }, 10);
sampler.unref();

async function timed(runs, fn) {
  const ms = [];
  let last;
  if (global.gc) global.gc();
  const base = process.memoryUsage().heapUsed;
  heapPeak = base;
  for (let i = 0; i < runs; i += 1) {
    const t0 = process.hrtime.bigint();
    last = await fn();
    ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  }
  // Tas : crête observée AU-DESSUS du tas de départ (données de la requête).
  return { ...stats(ms), last, heapMb: Math.round((heapPeak - base) / 1e5) / 10 };
}

/** Calcul ligne à ligne de RÉFÉRENCE (l'ancien chemin) : toutes les soumissions lues, groupées en JS. */
async function legacyRows(client, tenantId, formId, period, officeLabels) {
  const params = [tenantId, formId];
  const office = monitoringRepo.officeLabelSql(officeLabels, 's', params);
  const within = period ? ` AND ${monthWithin('s.period_month', period, params)}` : '';
  const { rows } = await client.query(
    `SELECT s.data, ${office.key} AS bureau, to_char(s.period_month, 'YYYY-MM') AS month
       FROM monitoring_submissions s ${office.join}
      WHERE s.tenant_id = $1 AND s.form_id = $2 AND NOT s.excluded${within}`, params);
  return rows;
}

const pick = (r) => ({ value: r.value, base: r.base, rating: r.rating, present: r.present, naCount: r.naCount, answered: r.answered });
function diff(label, a, b, out) {
  const ja = JSON.stringify(a); const jb = JSON.stringify(b);
  if (ja !== jb) out.push({ label, flux: a, rows: b });
}

async function checkForm(tenantId, form, period, officeLabels) {
  const issues = [];
  await withTenantTransaction(tenantId, async (client) => {
    const facts = await formFactsTx(client, tenantId, form.id, {
      period, group: 'bureau_month', officeSql: (p) => monitoringRepo.officeLabelSql(officeLabels, 's', p),
    });
    const rows = await legacyRows(client, tenantId, form.id, period, officeLabels);
    const defs = facts.defs;
    const subs = rows.map((r) => ({ ...r, data: defs.length ? { ...r.data, ...computeCalcFields(defs, r.data || {}) } : r.data }));
    const cmp = (label, histResults, list) => {
      const ref = computeAll(facts.inds, list);
      histResults.forEach((h, i) => diff(`${label} · ${h.code || h.label}`, pick(h), pick(ref[i]), issues));
    };
    cmp('global', resultsOf(facts, facts.overall), subs);
    // Par bureau et par mois : réunions de groupes « bureau|mois » (décompte additif).
    const by = (keyOf) => {
      const m = new Map();
      for (const [k, g] of facts.groups) { const kk = keyOf(k); if (!m.has(kk)) m.set(kk, []); m.get(kk).push(g); }
      return m;
    };
    const n = facts.inds.length;
    for (const [b, gs] of by((k) => k.slice(0, k.lastIndexOf('|')))) cmp(`bureau ${b}`, resultsOf(facts, mergeAll(gs, n)), subs.filter((x) => x.bureau === b));
    for (const [mo, gs] of by((k) => k.slice(k.lastIndexOf('|') + 1))) cmp(`mois ${mo}`, resultsOf(facts, mergeAll(gs, n)), subs.filter((x) => (x.month || '') === mo));
    // Explication (« Comment c'est calculé ») : même décompte, objet complet.
    const idx = keyIndex(subs);
    for (const [i, ind] of facts.inds.entries()) {
      const e1 = explainOf(ind, facts.overall[i]);
      const e2 = explainIndicator(ind, subs, namesFor(ind.sourceField, idx));
      diff(`explication · ${ind.code || ind.label}`, e1, e2, issues);
    }
  });
  return issues;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const who = await pool.query('SELECT current_user AS u');
  if (who.rows[0].u !== 'mems2_app') {
    throw new Error(`Le banc doit tourner sous mems2_app (RLS active), pas « ${who.rows[0].u} » : définissez APP_DATABASE_URL.`);
  }
  let tenantId = args.tenant;
  if (!tenantId) {
    if (!process.env.DATABASE_URL) throw new Error('--tenant requis (ou DATABASE_URL pour le trouver).');
    const su = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await su.connect();
    try {
      const { rows } = await su.query('SELECT tenant_id FROM monitoring_submissions GROUP BY 1 ORDER BY count(*) DESC LIMIT 1');
      tenantId = rows[0] && rows[0].tenant_id;
    } finally { await su.end(); }
    if (!tenantId) throw new Error('Aucune soumission dans la base.');
  }
  const period = args.period;
  const report = { tenantId, period, forms: [], templates: [], check: null };
  const forms = await withTenantTransaction(tenantId, async (c) => (await c.query(
    `SELECT f.id, f.label, (SELECT count(*)::int FROM monitoring_submissions s WHERE s.tenant_id = f.tenant_id AND s.form_id = f.id) AS n,
            (SELECT count(*)::int FROM monitoring_indicators i WHERE i.tenant_id = f.tenant_id AND i.form_id = f.id AND i.active) AS inds
       FROM monitoring_forms f WHERE f.tenant_id = $1 AND f.active ORDER BY f.label`, [tenantId])).rows);
  const officeLabels = await withTenantTransaction(tenantId, (c) => monitoringRepo.officeLabelsTx(c, tenantId));

  if (!args.only || args.only === 'forms') {
    for (const f of forms) {
      const h = await timed(args.runs, () => withTenantTransaction(tenantId, (c) => formResultsTx(c, tenantId, f.id, period)));
      const row = { form: f.label, submissions: f.n, indicators: f.inds, flux: { min: h.min, p50: h.p50, p95: h.p95 }, heapMb: h.heapMb };
      if (args.check) {
        // Ancien chemin (référence) : toutes les soumissions lues, champs calculés, computeAll.
        const l = await timed(1, () => withTenantTransaction(tenantId, async (c) => {
          const rows = await legacyRows(c, tenantId, f.id, period, officeLabels);
          const defs = await calcDefsTx(c, tenantId, f.id);
          const inds = await activeIndicatorsTx(c, tenantId, f.id);
          return computeAll(inds, rows.map((r) => ({ data: defs.length ? { ...r.data, ...computeCalcFields(defs, r.data || {}) } : r.data })));
        }));
        row.rowsRead = { ms: l.min, heapMb: l.heapMb };
      }
      report.forms.push(row);
    }
  }

  if (!args.only || args.only === 'templates') {
    const service = require('../src/modules/reports/reports.service');
    const { SYSTEM_TEMPLATES, templateDocument } = require('../src/modules/reports/reportTemplates');
    const p = period || { from: `${new Date().getFullYear()}-01`, to: new Date().toISOString().slice(0, 7) };
    for (const t of SYSTEM_TEMPLATES) {
      const doc = templateDocument(t, p);
      let failed = 0; let blocks = 0;
      const r = await timed(args.runs, async () => {
        const out = await service.renderReport(tenantId, doc, { lang: 'fr' });
        blocks = Object.keys(out.blocks).length;
        failed = Object.values(out.blocks).filter((b) => !b.ok).length;
      });
      report.templates.push({ template: t.key, blocks, failed, min: r.min, p50: r.p50, p95: r.p95, heapMb: r.heapMb });
    }
  }

  if (args.check) {
    const all = [];
    for (const f of forms) {
      const issues = await checkForm(tenantId, f, period, officeLabels);
      all.push({ form: f.label, issues: issues.length, sample: issues.slice(0, 3) });
    }
    report.check = { forms: all.length, issues: all.reduce((s, x) => s + x.issues, 0), detail: all };
  }

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    const r1 = (x) => Math.round(x * 10) / 10;
    console.log(`Tenant ${tenantId} · période ${period ? `${period.from} → ${period.to}` : 'toutes'} · ${args.runs} passe(s), rôle mems2_app`);
    for (const f of report.forms) {
      console.log(`  fiche « ${f.form} » (${f.submissions} soumissions, ${f.indicators} indicateurs) : en flux min ${r1(f.flux.min)} · p50 ${r1(f.flux.p50)} · p95 ${r1(f.flux.p95)} ms · tas ${f.heapMb} Mo`
        + (f.rowsRead ? ` | ligne à ligne (ancien chemin) ${r1(f.rowsRead.ms)} ms · tas ${f.rowsRead.heapMb} Mo` : ''));
    }
    for (const t of report.templates) console.log(`  modèle ${t.template} (${t.blocks} blocs, ${t.failed} en erreur) : min ${r1(t.min)} · p50 ${r1(t.p50)} · p95 ${r1(t.p95)} ms · tas ${t.heapMb} Mo`);
    if (report.check) {
      console.log(`  contrôle calcul en flux = ligne à ligne : ${report.check.issues} écart(s) sur ${report.check.forms} fiche(s)`);
      for (const d of report.check.detail) if (d.issues) console.log(`    ${d.form} : ${d.issues} écart(s), ex. ${JSON.stringify(d.sample[0])}`);
    }
  }
  await pool.end();
  if (report.check && report.check.issues > 0) process.exitCode = 1;
}

main().catch(async (e) => { console.error(e.message || e); try { await pool.end(); } catch { /* fermé */ } process.exitCode = 1; });
