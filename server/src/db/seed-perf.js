/**
 * Base de VOLUME du concepteur de rapport (lot 7a) — `npm run seed:perf -- --target 50000`.
 *
 * Réplique les soumissions existantes du tenant (après `npm run seed` et `npm run
 * seed:test`) jusqu'à `--target` soumissions, réparties sur 12 mois finissant à `--to`
 * (mois courant par défaut) et entre les bureaux déjà présents. Pour garder une
 * cardinalité RÉALISTE (une valeur distincte par soumission environ pour une mesure
 * continue), les nombres des variables lues par une moyenne ou une somme, et tout
 * nombre > 20, sont perturbés (× 0,5 à 1,5, deux décimales) ; un texte libre
 * (plus de 15 caractères) reçoit un suffixe unique. Les réponses codées (oui/non,
 * choix) restent intactes : les indicateurs en % gardent leur sens.
 *
 * Garde-fous :
 *  - REFUSE toute base dont le nom ne finit pas par `_perf` (la base de dev, mems2_tpm,
 *    n'est jamais touchée) ;
 *  - idempotent : supprime d'abord ses propres lignes (external_id « perf-… ») ;
 *  - une seule transaction ; connexion superutilisateur (DATABASE_URL), comme seed.js.
 *
 * Options : --target 50000 · --to AAAA-MM · --tenant <uuid> (défaut : celui qui a le
 *           plus de soumissions)
 */
require('dotenv').config();
const pg = require('pg');

function parseArgs(argv) {
  const out = { target: 50000, to: new Date().toISOString().slice(0, 7) };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--target') out.target = Number(next());
    else if (a === '--to') out.to = next();
    else if (a === '--tenant') out.tenant = next();
    else throw new Error(`Option inconnue : ${a}`);
  }
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > 1_000_000) throw new Error('--target : entier de 1 à 1 000 000.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(out.to)) throw new Error('--to : mois AAAA-MM.');
  return out;
}

/** Nom de la base d'une URL PostgreSQL. */
const dbNameOf = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

/** Garde : seule une base « …_perf » est acceptée. */
function assertPerfDb(url) {
  if (!url) throw new Error('DATABASE_URL manquant.');
  const name = dbNameOf(url);
  if (!/_perf$/.test(name)) throw new Error(`Base refusée (« ${name} ») : seed:perf ne s'exécute que sur une base dont le nom finit par _perf.`);
  return name;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = assertPerfDb(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    let tenantId = args.tenant;
    if (!tenantId) {
      const { rows } = await client.query(
        "SELECT tenant_id FROM monitoring_submissions WHERE external_id IS NULL OR external_id NOT LIKE 'perf-%' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1");
      tenantId = rows[0] && rows[0].tenant_id;
    }
    if (!tenantId) throw new Error('Aucune soumission à répliquer : lancez d\'abord npm run seed et npm run seed:test.');
    const del = await client.query("DELETE FROM monitoring_submissions WHERE tenant_id = $1 AND external_id LIKE 'perf-%'", [tenantId]);
    const { rows: [{ n: base }] } = await client.query('SELECT count(*)::int AS n FROM monitoring_submissions WHERE tenant_id = $1', [tenantId]);
    if (!base) throw new Error('Aucune soumission à répliquer pour ce tenant.');
    const add = Math.max(0, args.target - base);
    // Variables lues par une moyenne ou une somme (minuscules) : mesures continues.
    const { rows: cont } = await client.query(
      "SELECT DISTINCT lower(source_field) AS k FROM monitoring_indicators WHERE tenant_id = $1 AND agg IN ('mean', 'sum')", [tenantId]);
    const t0 = Date.now();
    const ins = await client.query(
      `WITH src AS (
         SELECT s.*, row_number() OVER (ORDER BY s.id) AS rn, count(*) OVER () AS cnt
           FROM monitoring_submissions s WHERE s.tenant_id = $1),
       offs AS (
         SELECT array_agg(DISTINCT field_office) FILTER (WHERE field_office IS NOT NULL) AS codes
           FROM monitoring_submissions WHERE tenant_id = $1)
       INSERT INTO monitoring_submissions (tenant_id, form_id, external_id, period_month, submitted_at, field_office, field_office_id,
              admin1, admin2, admin3, admin4, adm3_pcode, site, site_id, site_status, partner, partner_id, agent, agent_id,
              source, data, excluded, geo_status, upload_month)
       SELECT s.tenant_id, s.form_id, 'perf-' || i, m.mo, m.mo + ((i % 27) || ' days')::interval,
              COALESCE(o.codes[1 + i % greatest(cardinality(o.codes), 1)], s.field_office), s.field_office_id,
              s.admin1, s.admin2, s.admin3, s.admin4, s.adm3_pcode, s.site, s.site_id, s.site_status, s.partner, s.partner_id, s.agent, s.agent_id,
              s.source,
              (SELECT COALESCE(jsonb_object_agg(e.key,
                 -- CASE imbriqué : le texte n'est converti en nombre que pour une valeur JSON numérique.
                 CASE WHEN jsonb_typeof(e.value) = 'number' THEN
                        CASE WHEN lower(e.key) = ANY($4::text[]) OR (e.value #>> '{}')::numeric > 20
                             THEN to_jsonb(round((e.value #>> '{}')::numeric * (0.5 + (abs(hashtext(i || e.key)) % 1000) / 1000.0), 2))
                             ELSE e.value END
                      WHEN jsonb_typeof(e.value) = 'string' AND length(e.value #>> '{}') > 15
                        THEN to_jsonb((e.value #>> '{}') || ' #' || i)
                      WHEN e.key = '_uuid' THEN to_jsonb(md5('perf' || i))
                      ELSE e.value END), '{}'::jsonb)
                 FROM jsonb_each(s.data) e),
              s.excluded, s.geo_status, date_trunc('month', m.mo)::date
         FROM generate_series(1, $2::int) AS i
         CROSS JOIN offs o
         JOIN src s ON s.rn = 1 + (i - 1) % s.cnt
         CROSS JOIN LATERAL (SELECT (to_date($3, 'YYYY-MM') - ((i % 12) * interval '1 month'))::date AS mo) m`,
      [tenantId, add, args.to, cont.map((r) => r.k)]);
    await client.query('COMMIT');
    await client.query('ANALYZE monitoring_submissions');
    console.log(`seed:perf (${name}) : ${del.rowCount} ancienne(s) ligne(s) perf supprimée(s), ${ins.rowCount} soumission(s) ajoutée(s) `
      + `(${base} existantes → ${base + ins.rowCount}) en ${Date.now() - t0} ms ; mesures continues perturbées : ${cont.map((r) => r.k).join(', ') || 'aucune'}.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
}

module.exports = { assertPerfDb, parseArgs };
