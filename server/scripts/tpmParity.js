/**
 * Parité de la règle « TPM d'un site » (retour 58) : la règle PURE (tpmAttribution.js, lue par
 * tpmAttribution.repository.cellsForSitesTx — onglet, plan de suivi, aperçus, lot 5) et sa
 * jumelle SQL (mems_tpm_cells, migration 070 — estampille des visites en base) doivent rendre la
 * MÊME cellule (état, TPM, contrat) pour chaque site × mois. Lecture seule.
 *
 * Usage : node scripts/tpmParity.js [AAAA-MM] [AAAA-MM]   (défaut : l'année en cours)
 * Base : DATABASE_URL (superutilisateur) ; tous les comptes ; la transaction est annulée.
 * Code de sortie 1 au premier écart (affiché), 0 sinon.
 */
require('dotenv').config();
const { Client } = require('pg');
const { cellsForSitesTx } = require('../src/modules/tpm/tpmAttribution.repository');

const year = new Date().getFullYear();
const [from = `${year}-01`, to = `${year}-12`] = process.argv.slice(2);

function monthsOf(a, b) {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k === b || out.length > 60) return out;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let bad = 0; let total = 0;
  try {
    await client.query('BEGIN READ ONLY');
    const { rows: tenants } = await client.query('SELECT id FROM tenants ORDER BY created_at');
    const months = monthsOf(from, to);
    for (const t of tenants) {
      const { rows: sites } = await client.query('SELECT id FROM sites WHERE tenant_id = $1', [t.id]);
      const pairs = sites.flatMap((s) => months.map((m) => ({ siteId: s.id, month: m })));
      if (!pairs.length) continue;
      const t0 = Date.now();
      const js = await cellsForSitesTx(client, t.id, pairs);
      const t1 = Date.now();
      const { rows: sql } = await client.query(
        `SELECT c_site_id AS "siteId", to_char(c_month, 'YYYY-MM') AS month, c_state AS state, c_provider_id AS "providerId", c_contract_id AS "contractId"
           FROM mems_tpm_cells($1, $2::uuid[], $3::date[])`,
        [t.id, pairs.map((p) => p.siteId), pairs.map((p) => `${p.month}-01`)]);
      const t2 = Date.now();
      for (const r of sql) {
        total += 1;
        const j = js.get(`${r.siteId}|${r.month}`);
        const same = j && j.state === r.state && (j.providerId || null) === (r.providerId || null) && (j.contractId || null) === (r.contractId || null);
        if (!same) {
          bad += 1;
          if (bad <= 10) console.log('ÉCART', r.siteId, r.month, 'SQL', r.state, r.providerId, r.contractId, '· JS', j && j.state, j && j.providerId, j && j.contractId);
        }
      }
      console.log(`compte ${t.id} : ${sites.length} sites × ${months.length} mois — JS ${t1 - t0} ms, SQL ${t2 - t1} ms`);
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
  console.log(`${total} cellules comparées · ${bad} écart(s)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
