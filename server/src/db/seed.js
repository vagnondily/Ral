#!/usr/bin/env node
/**
 * Idempotent demo seed for MEMS 2.0.
 * Provisions one tenant with its configuration registries (partner types,
 * activities), partners (TPM + cooperating), sites, contracts whose budget is
 * the REAL FLA structure at item level (poste = qté × coût unitaire, réparti
 * par activité), and a few TPM monitoring reports.
 *
 * There is no daily rate ("barème journalier"): a partner is just a name +
 * type. The contract "barème" is its total (ceiling); the monthly plan uses
 * total ÷ number of months.
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');

const PARTNER_TYPES = [
  ['tpm', 'TPM (Tierce partie de suivi)', 1],
  ['prestataire', 'Prestataire', 2],
  ['cabinet', 'Cabinet', 3],
];
const ACTIVITIES = [
  ['suivi', 'Suivi', 1],
  ['ciblage', 'Ciblage', 2],
  ['pdm', 'Suivi post-distribution (PDM)', 3],
  ['distribution', 'Distribution', 4],
  ['evaluation', 'Évaluation', 5],
];
const TPM_PARTNERS = [
  ['YPA', [['H. Solo', 'Coordinateur de terrain'], ['R. Randria', 'Superviseur'], ['T. Fenoson', 'Agent de collecte']]],
  ['RANO Control', [['J. Fanomezantsoa', 'Superviseur'], ['L. Miora', 'Enquêteur']]],
  ['SAHY Monitoring', [['E. Tojo', 'Agent de collecte']]],
];
const COOP_PARTNERS = ['ASSOCIATION AINA', 'TOHANA', 'MIARO'];

// Évaluation des agents : formations suivies (thématique, date, jours), par nom d'agent.
const AGENT_FORMATIONS = {
  'H. Solo': [['Collecte de données mobiles (ODK)', '2025-11-05', 3], ['Sauvegarde et protection des bénéficiaires (PSEA)', '2026-01-20', 1]],
  'R. Randria': [['Techniques d\'échantillonnage', '2025-12-10', 2]],
  'J. Fanomezantsoa': [['Suivi post-distribution (PDM)', '2025-11-18', 2], ['Éthique et confidentialité des données', '2026-02-03', 1]],
  'L. Miora': [['Collecte de données mobiles (ODK)', '2026-01-15', 3]],
};

// Amorce du découpage administratif (Région → District) pour le tenant
// Madagascar, depuis le référentiel district/région fourni. L'import d'un
// shapefile/.dbf dans Paramétrage le remplace/complète (un fichier par pays).
const ADMIN_LEVELS = ['Région', 'District'];
const ADMIN_BREAKDOWN = [
  ['Anosy', ['Amboasary Sud', 'Amboasary-Atsimo', 'Betroka', 'Fort Dauphin', 'Taolagnaro']],
  ['Androy', ['Ambovombe', 'Ambovombe-Androy', 'Antanimora', 'Antanimora Sud', 'Bekily', 'Beloha', 'Tsihombe']],
  ['Atsimo Andrefana', ['Ampanihy', 'Ampanihy Ouest', 'Benenitra', 'Betioky Atsimo', 'Betioky Sud', 'Morombe', 'Sakaraha', 'Toliara II', 'Toliary-II']],
  ['Atsimo Atsinanana', ['Farafangana', 'Midongy-Atsimo', 'Vangaindrano', 'Vondrozo']],
  ['Fitovinany', ['Manakara', 'Manakara Atsimo']],
  ['Vatovavy', ['Mananjary', 'Nosy-Varika']],
];
// Districts affectés au prestataire par contrat (démo).
const CONTRACT_DISTRICTS = {
  'CTR-2026-0001': ['Bekily', 'Ambovombe', 'Beloha'],
  'CTR-2026-0002': ['Amboasary Sud', 'Betroka'],
  'CTR-2026-0003': ['Ampanihy', 'Betioky Atsimo'],
};

const SITES = [
  ['MDG-0398', 'EPP Ambatoloaka', 'Toliara II', 'Toliara II', 'SMP', 'faible'],
  ['MDG-0421', 'CSB Ankilimivory', 'Betioky Atsimo', 'Betioky Atsimo', 'GD', 'elevee'],
  ['MDG-0512', 'Site SAMS Analapatsy', 'Amboasary Sud', 'Amboasary Sud', 'RES', 'moyenne'],
  ['MDG-0600', 'EPP Beteza', 'Ampanihy', 'Ampanihy', 'PECMAM', 'moyenne'],
  ['MDG-0611', 'EPP Tsihombe', 'Tsihombe', 'Tsihombe', 'GD', 'elevee'],
];

// The exact Suivi (section IV) budget items of the real AINA FLA file
// (Détails Section IV) — total 41 164 000 Ar, allocated 100% to « suivi ».
const AINA_SUIVI = [
  ['FORMATION Indemnité coordinateur de terrain (avec collation)', 7, 40000],
  ['FORMATION Indemnité des superviseurs (avec toute collation)', 28, 40000],
  ['FORMATION Indemnité des agents (avec toute collation)', 140, 40000],
  ['FORMATION Marqueur', 7, 20000],
  ['FORMATION Stylo', 25, 1000],
  ['FORMATION Bloc note Petit format', 25, 3000],
  ['FORMATION Location salle avec vidéo projecteur', 7, 150000],
  ['FORMATION Connexion internet', 7, 50000],
  ['COLLECTE Indemnité coordinateur de terrain (Suivi-Évaluation)', 10, 80000],
  ['COLLECTE Indemnité des superviseurs', 40, 70000],
  ['COLLECTE Indemnité des agents', 200, 60000],
  ['COLLECTE Location voiture', 32, 300000],
  ['COLLECTE Carburant voiture', 360, 4900],
  ['COLLECTE Forfait 1st premium', 300, 10000],
  ['COLLECTE Groupe électrogène avec carburant', 32, 80000],
];

function items(line, act, rows) {
  return rows.map(([description, unitCount, unitCost]) => ({ line, act, description, unitCount, unitCost }));
}

// Contracts: partner, activities (codes), FLA ids, dates, management fee, the
// real budget items, and validated TPM monitoring reports.
const CONTRACTS = [
  {
    numero: 'CTR-2026-0001', partner: 'ASSOCIATION AINA', activities: ['suivi'],
    fla: 'FLA-2025-AIN-MULTI-003', po: 'PO-48213', vendor: 'VDR-10245',
    debut: '2025-10-01', fin: '2026-09-30', fee: 0.07, amendments: 2,
    items: items('IV.suivi', 'suivi', AINA_SUIVI),
    reports: [
      { tpm: 'RANO Control', month: '2025-11', kind: 'financier', amount: 3200000, ref: 'FAC-RANO-2025-11' },
      { tpm: 'RANO Control', month: '2025-11', kind: 'technique', ref: 'RAP-TECH-2025-11' },
      { tpm: 'RANO Control', month: '2025-12', kind: 'financier', amount: 3400000, ref: 'FAC-RANO-2025-12' },
    ],
  },
  {
    numero: 'CTR-2026-0002', partner: 'TOHANA', activities: ['suivi', 'ciblage'],
    fla: 'FLA-2025-TOH-SAMS-004', po: 'PO-49010', vendor: 'VDR-09877',
    debut: '2026-03-01', fin: '2026-11-30', fee: 0.07, amendments: 0,
    items: items('IV.suivi', 'suivi', [
      ['COLLECTE Indemnité des agents', 150, 60000],
      ['COLLECTE Location voiture', 10, 300000],
    ]),
    reports: [{ tpm: 'SAHY Monitoring', month: '2026-04', kind: 'financier', amount: 2500000, ref: 'FAC-SAHY-2026-04' }],
  },
  {
    numero: 'CTR-2026-0003', partner: 'MIARO', activities: ['suivi', 'pdm'],
    fla: 'FLA-2025-MIA-RES-007', po: 'PO-49155', vendor: 'VDR-10590',
    debut: '2026-02-01', fin: '2026-12-31', fee: 0.07, amendments: 0,
    items: items('IV.suivi', 'suivi', [
      ['COLLECTE Indemnité des agents', 130, 60000],
      ['COLLECTE Location voiture', 7, 300000],
    ]),
    // Monitoring OVERSPENT (11M > 9.9M) → contract flagged « Avenant requis »
    reports: [
      { tpm: 'YPA', month: '2026-03', kind: 'financier', amount: 6000000, ref: 'FAC-YPA-2026-03' },
      { tpm: 'YPA', month: '2026-04', kind: 'financier', amount: 5000000, ref: 'FAC-YPA-2026-04' },
    ],
  },
];

function monthsBetween(a, b) {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

async function upsertRefList(client, tenantId, table, rows) {
  const map = {};
  for (const [code, label, order] of rows) {
    const { rows: r } = await client.query(
      `INSERT INTO ${table} (tenant_id, code, label, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label RETURNING id`,
      [tenantId, code, label, order]
    );
    map[code] = r[0].id;
  }
  return map;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Idempotent : réutiliser le tenant démo existant s'il y en a un (tenants.name
    // n'a pas de contrainte UNIQUE — un ON CONFLICT créerait un doublon à chaque
    // exécution du seed). On sélectionne d'abord, on n'insère qu'à défaut.
    const existingTenant = await client.query('SELECT id FROM tenants WHERE name = $1 ORDER BY created_at LIMIT 1', ['Bureau de Toliara']);
    const tenantId = existingTenant.rows[0]
      ? existingTenant.rows[0].id
      : (await client.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', ['Bureau de Toliara'])).rows[0].id;

    const passwordHash = await bcrypt.hash('changeme123', 10);
    const users = {};
    for (const [email, role] of [['admin@mems.mg', 'admin'], ['validateur@mems.mg', 'manager']]) {
      await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, email) DO NOTHING`, [tenantId, email, passwordHash, role]);
      users[role] = (await client.query('SELECT id FROM users WHERE tenant_id=$1 AND email=$2', [tenantId, email])).rows[0].id;
    }
    const admin = users.admin;
    const validator = users.manager;

    const types = await upsertRefList(client, tenantId, 'partner_types', PARTNER_TYPES);
    const activityId = await upsertRefList(client, tenantId, 'activities', ACTIVITIES);

    // Partners — name + type only (no daily rate).
    const partnerId = {};
    for (const [name, agents] of TPM_PARTNERS) {
      const { rows } = await client.query(
        `INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, name) DO NOTHING RETURNING id`, [tenantId, types.tpm, name]);
      partnerId[name] = rows[0]?.id
        || (await client.query('SELECT id FROM partners WHERE tenant_id=$1 AND name=$2', [tenantId, name])).rows[0].id;
      for (const [agentName, fonction] of agents) {
        const { rows: ar } = await client.query(
          `INSERT INTO tpm_agents (tenant_id, tpm_provider_id, name, fonction)
           SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM tpm_agents WHERE tpm_provider_id=$2 AND name=$3)
           RETURNING id`,
          [tenantId, partnerId[name], agentName, fonction]);
        const agentId = ar[0]?.id
          || (await client.query('SELECT id FROM tpm_agents WHERE tpm_provider_id=$1 AND name=$2', [partnerId[name], agentName])).rows[0].id;
        for (const [thematique, dateF, jours] of (AGENT_FORMATIONS[agentName] || [])) {
          await client.query(
            `INSERT INTO tpm_agent_formations (tenant_id, agent_id, thematique, date_formation, jours)
             SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM tpm_agent_formations WHERE agent_id=$2 AND thematique=$3)`,
            [tenantId, agentId, thematique, dateF, jours]);
        }
      }
    }
    for (const name of COOP_PARTNERS) {
      const { rows } = await client.query(
        `INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, name) DO NOTHING RETURNING id`, [tenantId, types.prestataire, name]);
      partnerId[name] = rows[0]?.id
        || (await client.query('SELECT id FROM partners WHERE tenant_id=$1 AND name=$2', [tenantId, name])).rows[0].id;
    }

    for (const [code, name, district, commune, activity, risk] of SITES) {
      await client.query(
        `INSERT INTO sites (tenant_id, code, name, district, commune, activity, risk_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tenantId, code, name, district, commune, activity, risk]);
    }
    // Admin breakdown (Région → District), tenant-scoped. District name → id.
    const districtId = {};
    if ((await client.query('SELECT 1 FROM admin_levels WHERE tenant_id=$1 LIMIT 1', [tenantId])).rows.length === 0) {
      for (let i = 0; i < ADMIN_LEVELS.length; i += 1) {
        await client.query('INSERT INTO admin_levels (tenant_id, depth, label) VALUES ($1,$2,$3)', [tenantId, i + 1, ADMIN_LEVELS[i]]);
      }
      for (const [region, districts] of ADMIN_BREAKDOWN) {
        const { rows: [reg] } = await client.query(
          `INSERT INTO admin_areas (tenant_id, depth, name, parent_id, path) VALUES ($1,1,$2,NULL,$2) RETURNING id`,
          [tenantId, region]);
        for (const dist of districts) {
          const { rows: [d] } = await client.query(
            `INSERT INTO admin_areas (tenant_id, depth, name, parent_id, path) VALUES ($1,2,$2,$3,$4) RETURNING id`,
            [tenantId, dist, reg.id, `${region} > ${dist}`]);
          districtId[dist] = { id: d.id, path: `${region} > ${dist}` };
        }
      }
    }

    const period = new Date(); period.setUTCDate(1);
    const periodISO = period.toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO tpm_plans (tenant_id, period_month, status) VALUES ($1,$2,'draft')
       ON CONFLICT (tenant_id, period_month) DO NOTHING`, [tenantId, periodISO]);

    // Travail terrain de démo : affecter des sites à des agents + jours de
    // mission, pour que l'évaluation des agents s'appuie sur des données réelles.
    const planId = (await client.query('SELECT id FROM tpm_plans WHERE tenant_id=$1 AND period_month=$2', [tenantId, periodISO])).rows[0].id;
    if ((await client.query('SELECT 1 FROM tpm_assignments WHERE plan_id=$1 LIMIT 1', [planId])).rows.length === 0) {
      const siteRows = (await client.query('SELECT id FROM sites WHERE tenant_id=$1 ORDER BY code', [tenantId])).rows;
      const agentByName = async (nm) => (await client.query('SELECT id, tpm_provider_id FROM tpm_agents WHERE tenant_id=$1 AND name=$2', [tenantId, nm])).rows[0];
      // agent, sites index, mission-day offsets (days into the period month)
      const FIELD = [
        ['J. Fanomezantsoa', [0, 1], [2, 3, 4, 9, 10]],
        ['L. Miora', [2], [5, 6]],
        ['H. Solo', [3, 4], [1, 2, 3, 4]],
      ];
      for (const [nm, siteIdx, dayOffsets] of FIELD) {
        const ag = await agentByName(nm);
        if (!ag) continue;
        for (const si of siteIdx) {
          const site = siteRows[si];
          if (!site) continue;
          const { rows: [asg] } = await client.query(
            `INSERT INTO tpm_assignments (tenant_id, plan_id, site_id, tpm_provider_id, tpm_agent_id)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (plan_id, site_id) DO UPDATE SET tpm_agent_id = EXCLUDED.tpm_agent_id RETURNING id`,
            [tenantId, planId, site.id, ag.tpm_provider_id, ag.id]);
          for (const off of dayOffsets) {
            const d = new Date(period); d.setUTCDate(off);
            await client.query(
              `INSERT INTO tpm_mission_days (tenant_id, assignment_id, mission_date) VALUES ($1,$2,$3)
               ON CONFLICT (assignment_id, mission_date) DO NOTHING`,
              [tenantId, asg.id, d.toISOString().slice(0, 10)]);
          }
        }
        // Une évaluation d'exemple, adossée au travail terrain.
        const EVALS = { 'J. Fanomezantsoa': [16, 'Bon', 'Collecte régulière, quelques retards de transmission.'], 'H. Solo': [18, 'Excellent', 'Excellente couverture terrain et qualité des données.'] };
        if (EVALS[nm]) {
          const [note, appr, com] = EVALS[nm];
          await client.query(
            `INSERT INTO tpm_agent_evaluations (tenant_id, agent_id, periode, note, appreciation, commentaire, evaluated_by)
             SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT 1 FROM tpm_agent_evaluations WHERE agent_id=$2 AND periode=$3)`,
            [tenantId, ag.id, periodISO, note, appr, com, validator]);
        }
      }
    }

    // Visites de terrain de démo (module « Sites & visites ») : planification du
    // mois courant, affectée à des prestataires TPM avec un rôle générique
    // (Agent 1 / Superviseur 1) ; ~1/3 réalisées pour alimenter la couverture,
    // le tableau de bord et les alertes.
    if ((await client.query('SELECT 1 FROM site_visits WHERE tenant_id=$1 LIMIT 1', [tenantId])).rows.length === 0) {
      const siteRows = (await client.query('SELECT id, activity FROM sites WHERE tenant_id=$1 ORDER BY code', [tenantId])).rows;
      const tpmIds = TPM_PARTNERS.map(([nm]) => partnerId[nm]).filter(Boolean);
      const VISIT_ROLES = ['Agent 1', 'Agent 2', 'Superviseur 1'];
      for (let i = 0; i < siteRows.length; i += 1) {
        const s = siteRows[i];
        const prov = tpmIds.length ? tpmIds[i % tpmIds.length] : null;
        await client.query(
          `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, provider_id, agent, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
          [tenantId, s.id, periodISO, s.activity || 'Suivi', prov, VISIT_ROLES[i % VISIT_ROLES.length],
            i % 3 === 0 ? 'realise' : 'planifie', users.admin]);
      }
    }

    if ((await client.query('SELECT 1 FROM contracts WHERE tenant_id=$1 LIMIT 1', [tenantId])).rows.length === 0) {
      let counterMax = 0;
      for (const c of CONTRACTS) {
        counterMax = Math.max(counterMax, Number(c.numero.split('-')[2]));
        const months = monthsBetween(c.debut, c.fin);
        const { rows: [row] } = await client.query(
          `INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, activities, numero_fla, numero_po, numero_vendor,
                                  date_debut, date_fin, status, validator_id, submitted_by, submitted_at, decided_by, decided_at,
                                  amendment_count, management_fee_pct, period_months, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'actif',$11,$12,$13,$11,$14,$15,$16,$17,$12,$18) RETURNING id`,
          [tenantId, c.numero, partnerId[c.partner], c.partner, c.activities, c.fla, c.po, c.vendor,
            c.debut, c.fin, validator, admin, `${c.debut}T08:00:00+03:00`, `${c.debut}T15:00:00+03:00`,
            c.amendments, c.fee, months, `${c.debut}T07:30:00+03:00`]);
        const id = row.id;
        for (const code of c.activities) {
          await client.query('INSERT INTO contract_activities (contract_id, tenant_id, activity_id) VALUES ($1,$2,$3)',
            [id, tenantId, activityId[code]]);
        }
        let order = 0;
        let suiviTotal = 0;
        for (const it of c.items) {
          const alloc = JSON.stringify({ [activityId[it.act]]: 1 });
          await client.query(
            `INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, tenantId, it.line, it.description, it.unitCount, it.unitCost, alloc, order++]);
          if (it.line === 'IV.suivi') suiviTotal += it.unitCount * it.unitCost;
        }
        const hist = [
          ['creation', admin, null, `${c.debut}T07:30:00+03:00`],
          ['soumission', admin, null, `${c.debut}T08:00:00+03:00`],
          ['approbation', validator, 'Conforme au FLA signé.', `${c.debut}T15:00:00+03:00`],
        ];
        // Détermine le contenu des avenants. Pour AINA (CTR-2026-0001) le
        // premier avenant est enregistré au nouveau format { before, after }
        // afin de piloter le comparatif « avant / après » de la fiche contrat ;
        // le second reste à l'ancien format pour prouver la rétro-compatibilité.
        const amendData = (i) => {
          if (c.numero === 'CTR-2026-0001' && i === 0) {
            const toItems = (rows) => rows.map(([description, unitCount, unitCost]) =>
              ({ lineCode: 'IV.suivi', description, unitCount, unitCost }));
            const afterRows = AINA_SUIVI.map((r) =>
              r[0] === 'COLLECTE Indemnité des agents' ? [r[0], 220, r[2]] : r);
            const zones = ['Androy > Bekily', 'Androy > Ambovombe', 'Androy > Beloha'];
            const before = {
              activityLabels: ['Suivi'], areaPaths: zones.slice(0, 2),
              items: toItems(AINA_SUIVI), feePct: 0.07,
              dateDebut: '2025-10-01', dateFin: '2026-06-30',
              numeros: { fla: c.fla, po: c.po, vendor: c.vendor },
              directTotal: 41164000, grandTotal: 44045480,
            };
            const after = {
              activityLabels: ['Suivi'], areaPaths: zones,
              items: toItems(afterRows), feePct: 0.08,
              dateDebut: '2025-10-01', dateFin: '2026-09-30',
              numeros: { fla: c.fla, po: c.po, vendor: c.vendor },
              directTotal: 42364000, grandTotal: 45753120,
            };
            return {
              justification: 'Extension de la période, ajout du district de Beloha, révision de la commission (7 % → 8 %) et renforcement de l\'équipe de collecte.',
              newDateFin: '2026-09-30', changes: { before, after },
            };
          }
          return {
            justification: 'Révision de la commission de gestion.',
            newDateFin: null, changes: { newFeePct: 0.07 },
          };
        };
        for (let i = 0; i < c.amendments; i++) {
          const ad = amendData(i);
          await client.query(
            `INSERT INTO contract_amendments (tenant_id, contract_id, number, justification, new_date_fin, budget_changes, status,
                                              validator_id, created_by, created_at, decided_by, decided_at)
             VALUES ($1,$2,$3,$4,$5,$6,'approuve',$7,$8,$9,$7,$10)`,
            [tenantId, id, i + 1, ad.justification, ad.newDateFin, JSON.stringify(ad.changes),
              validator, admin, `2026-0${4 + i}-10T09:00:00+03:00`, `2026-0${4 + i}-12T11:00:00+03:00`]);
          hist.push(['avenant_demande', admin, null, `2026-0${4 + i}-10T09:00:00+03:00`]);
          hist.push(['avenant_approuve', validator, null, `2026-0${4 + i}-12T11:00:00+03:00`]);
        }
        for (const [action, actor, comment, at] of hist) {
          await client.query(
            `INSERT INTO contract_history (tenant_id, contract_id, action, actor_id, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
            [tenantId, id, action, actor, comment, at]);
        }
        // Zones affectées au prestataire (districts).
        let areaOrder = 0;
        for (const dist of CONTRACT_DISTRICTS[c.numero] || []) {
          const a = districtId[dist];
          if (a) {
            await client.query(
              `INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order)
               VALUES ($1,$2,$3,$4,2,$5)`,
              [id, tenantId, a.id, a.path, areaOrder++]);
          }
        }
        const planned = Math.round(suiviTotal / months);
        for (const r of c.reports || []) {
          await client.query(
            `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, planned_amount, reported_amount,
                                      reference, status, created_by, created_at, decided_by, decided_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'valide',$9,$10,$11,$12)`,
            [tenantId, partnerId[r.tpm], id, `${r.month}-01`, r.kind, planned,
              r.kind === 'financier' ? Math.round(r.amount) : null, r.ref, admin,
              `${r.month}-28T10:00:00+03:00`, validator, `${r.month}-28T14:00:00+03:00`]);
        }
      }
      await client.query(
        `INSERT INTO contract_counters (tenant_id, year, last_value) VALUES ($1, 2026, $2)
         ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = GREATEST(contract_counters.last_value, EXCLUDED.last_value)`,
        [tenantId, counterMax]);
    }

    logger.info({ tenantId, admin: 'admin@mems.mg / changeme123', validator: 'validateur@mems.mg / changeme123' }, 'seed complete');
  } finally {
    await client.end();
  }
}

main().catch((err) => { logger.error({ err }, 'seed failed'); process.exit(1); });
