#!/usr/bin/env node
/**
 * Jeu de données de TEST end-user pour MEMS 2.0.
 *
 * Complète le seed de démo (`npm run seed`) avec des données variées pour
 * exercer les modules récents et pouvoir inspecter le rendu :
 *   • Taux de change horodatés (vue Ar/USD)
 *   • Bureaux & antennes (périmètre communes + rattachement sites)
 *   • Plans de collecte (Planifié de la consolidation)
 *   • Rapports financiers (factures) + techniques, statuts variés
 *   • Un contrat en brouillon (test de suppression + prévision)
 *   • Fiche de suivi de processus + indicateurs + ~40 soumissions
 *     (Tableau de bord : données versées, conformité, tendance)
 *
 * Idempotent : chaque exécution supprime d'abord SES propres lignes de test
 * (marquées), puis les ré-insère. Lancer après `npm run seed`.
 *
 *   npm run seed            # base (tenant, users, contrats, visites…)
 *   npm run seed:test       # ce fichier
 */
require('dotenv').config();
const { Client } = require('pg');
const logger = require('../config/logger');
const { requireConnString, explainConnError } = require('../config/connString');

const MONITORING_LINE = 'IV.suivi';
const r2 = (n) => Math.round(n * 100) / 100;

function monthISO(offset = 0) {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const client = new Client({ connectionString: requireConnString('DATABASE_URL') });
  await client.connect();
  try {
    const t = (await client.query("SELECT id FROM tenants WHERE name = $1 ORDER BY created_at LIMIT 1", ['Bureau de Toliara'])).rows[0];
    if (!t) throw new Error('Tenant démo introuvable — lancez d\'abord `npm run seed`.');
    const tenantId = t.id;
    const admin = (await client.query("SELECT id FROM users WHERE tenant_id=$1 AND email='admin@mems.mg'", [tenantId])).rows[0]?.id;
    const validator = (await client.query("SELECT id FROM users WHERE tenant_id=$1 AND email='validateur@mems.mg'", [tenantId])).rows[0]?.id;
    if (!admin) throw new Error('Utilisateur admin introuvable — lancez d\'abord `npm run seed`.');

    // ---- 0) Données RÉELLES du Plan de suivi (bureaux, sites, MMR) --------
    // Extrait des fichiers « Plan de suivi » + « Master Data » (adm1-adm3,
    // rattachement bureau, paramètres MMR). Permet de voir l'app fonctionner
    // sur des données réalistes. Idempotent (marqueurs 'seed-plan' / PLAN-).
    const plan = require('./fixtures/planData.json');
    const officeIdByCode = {};
    await client.query('DELETE FROM field_offices WHERE tenant_id=$1 AND code = ANY($2)', [tenantId, plan.offices.map((o) => o.code)]);
    // Les bureaux sont listés parents avant enfants → parent_id déjà connu.
    // Hiérarchie : Fort Dauphin > Ambovombe > {Bekily, Tsihombe}, > Amboasary.
    for (const o of plan.offices) {
      const parentId = o.parent ? (officeIdByCode[o.parent] || null) : null;
      const { rows } = await client.query(
        `INSERT INTO field_offices (tenant_id, code, name, nature, parent_id, national, responsible)
         VALUES ($1,$2,$3,$4,$5,$6,'Responsable S&E') RETURNING id`,
        [tenantId, o.code, o.name, o.nature || 'terrain', parentId, o.nature === 'pays']);
      officeIdByCode[o.code] = rows[0].id;
      // Périmètre communes en un seul INSERT multi-lignes (pas de boucle de requêtes).
      const perim = (o.communes || []).slice(0, 1500);
      if (perim.length) {
        const params = [tenantId, rows[0].id]; const vals = [];
        for (const c of perim) { params.push(c.district || null, c.commune); vals.push(`($1,$2,$${params.length - 1},$${params.length})`); }
        await client.query(`INSERT INTO field_office_communes (tenant_id, office_id, district, commune) VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`, params);
      }
    }
    // Sites réels du Plan de suivi (feuille « Risk-based site selection ») :
    // géographie du Master Data + critères/score/activité/GPS du Co-Monitoring.
    await client.query("DELETE FROM sites WHERE tenant_id=$1 AND code LIKE 'PLAN-%'", [tenantId]);
    const COLS = 21; // colonnes par ligne (hors tenant_id partagé $1)
    const CH = 250;
    const lastVisits = []; // { code, month } → visites réalisées (dernière visite du plan)
    for (let i = 0; i < plan.sites.length; i += CH) {
      const slice = plan.sites.slice(i, i + CH);
      const params = [tenantId]; const vals = [];
      slice.forEach((s, j) => {
        const code = `PLAN-${String(i + j + 1).padStart(4, '0')}`;
        if (s.lastVisit) lastVisits.push({ code, month: s.lastVisit });
        params.push(code, s.name, s.district, s.commune, s.region, s.district, s.commune, s.fokontany || null,
          s.risk || 'moyenne', officeIdByCode[s.office] || null, s.activity || null, s.gpsLat ?? null, s.gpsLng ?? null,
          s.security || 0, s.synergies || 0, s.beneficiaryOver200 || 0, s.newPartner || 0,
          s.issuesProcess || 0, s.issuesPartnerReport || 0, s.issuesCFM || 0, s.fraud || 0);
        const b = params.length; const p = (k) => `$${b - COLS + 1 + k}`;
        vals.push(`($1,${Array.from({ length: COLS }, (_, k) => p(k)).join(',')})`);
      });
      await client.query(
        `INSERT INTO sites (tenant_id, code, name, district, commune, adm1, adm2, adm3, fokontany,
           risk_level, field_office_id, activity, gps_lat, gps_lng,
           security_situation, programme_synergies, beneficiary_over_200, new_partner,
           issues_process, issues_partner_report, issues_cfm, fraud_suspected)
         VALUES ${vals.join(',')} ON CONFLICT (tenant_id, code) DO NOTHING`, params);
    }
    // Dernières visites du plan → une visite réalisée datée, pour que le RBM et
    // la couverture reflètent l'historique (idempotent : marquées via la source).
    if (lastVisits.length) {
      const codeIds = new Map((await client.query("SELECT id, code FROM sites WHERE tenant_id=$1 AND code LIKE 'PLAN-%'", [tenantId])).rows.map((r) => [r.code, r.id]));
      for (let i = 0; i < lastVisits.length; i += CH) {
        const slice = lastVisits.slice(i, i + CH).filter((x) => codeIds.get(x.code));
        if (!slice.length) continue;
        const params = [tenantId, admin]; const vals = [];
        slice.forEach((x) => { params.push(codeIds.get(x.code), `${x.month}-01`); const b = params.length; vals.push(`($1,$${b - 1},$${b},'realise',$2)`); });
        await client.query(
          `INSERT INTO site_visits (tenant_id, site_id, period_month, status, created_by)
           VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`, params);
      }
    }
    logger.info({ offices: plan.offices.length, sites: plan.sites.length, lastVisits: lastVisits.length }, 'seed-test: données réelles du plan insérées');

    const tpms = (await client.query("SELECT p.id, p.name FROM partners p JOIN partner_types pt ON pt.id=p.partner_type_id WHERE p.tenant_id=$1 AND pt.code='tpm' ORDER BY p.name", [tenantId])).rows;
    const contracts = (await client.query("SELECT id, numero, partner_name AS \"partnerName\", period_months AS \"periodMonths\" FROM contracts WHERE tenant_id=$1 AND status='actif' ORDER BY numero", [tenantId])).rows;
    const activities = (await client.query("SELECT id, code FROM activities WHERE tenant_id=$1 ORDER BY sort_order", [tenantId])).rows;
    const actId = activities[0]?.id || null;
    const sites = (await client.query("SELECT id, commune, district FROM sites WHERE tenant_id=$1 AND commune IS NOT NULL ORDER BY code", [tenantId])).rows;
    logger.info({ tpms: tpms.length, contracts: contracts.length, sites: sites.length }, 'seed-test: contexte');

    // ---- 1) Taux de change horodatés ------------------------------------
    await client.query("DELETE FROM exchange_rates WHERE tenant_id=$1 AND note='seed-test'", [tenantId]);
    for (const [m, rate] of [[monthISO(-9), 4500], [monthISO(-5), 4650], [monthISO(-1), 4720]]) {
      await client.query(
        `INSERT INTO exchange_rates (tenant_id, effective_month, usd_rate, note, created_by)
         VALUES ($1,$2,$3,'seed-test',$4) ON CONFLICT (tenant_id, effective_month)
         DO UPDATE SET usd_rate=EXCLUDED.usd_rate, note='seed-test', updated_at=now()`,
        [tenantId, m, rate, admin]);
    }

    // ---- 2) Bureaux & antennes : déjà insérés à l'étape 0 depuis le plan. --

    // ---- 2b) Paramètres MMR — « un seul plan général, modifiable par bureau »
    // depuis la feuille « Overarching parameters » (valeurs réelles). Le plan
    // général (field_office_id NULL) reprend le bureau de référence ; les autres
    // bureaux ayant des sites deviennent des dérogations.
    await client.query("DELETE FROM mmr_parameters WHERE tenant_id=$1 AND note='seed-plan'", [tenantId]);
    const upsertMmrRow = async (officeId, cat, dur, nb, risk, feasRaw) => {
      const feas = feasRaw == null ? null : Math.round(Number(feasRaw));
      const target = officeId ? '(tenant_id, field_office_id, activity_category) WHERE field_office_id IS NOT NULL'
        : '(tenant_id, activity_category) WHERE field_office_id IS NULL';
      await client.query(
        `INSERT INTO mmr_parameters (tenant_id, field_office_id, activity_category, operation_duration, number_of_sites, risk_level, feasible, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'seed-plan',$8)
         ON CONFLICT ${target} DO UPDATE SET
           operation_duration=EXCLUDED.operation_duration, number_of_sites=EXCLUDED.number_of_sites,
           risk_level=EXCLUDED.risk_level, feasible=EXCLUDED.feasible, note='seed-plan', updated_at=now()`,
        [tenantId, officeId, cat, dur, nb, risk, feas, admin]);
    };
    const REF = 'FDA'; // bureau de référence (Fort Dauphin) pour le plan général
    for (const row of (plan.mmrByOffice[REF] || [])) {
      if (row.dur > 0 || row.sites > 0) await upsertMmrRow(null, row.cat, row.dur, row.sites, row.risk, row.feas);
    }
    // Dérogations : chaque autre bureau ayant des sites budgétés.
    for (const code of Object.keys(plan.mmrByOffice)) {
      if (code === REF || !officeIdByCode[code]) continue;
      for (const row of plan.mmrByOffice[code]) {
        if (row.sites > 0) await upsertMmrRow(officeIdByCode[code], row.cat, row.dur, row.sites, row.risk, row.feas);
      }
    }

    // ---- 2c) Critères RBM : désormais issus des vraies données du plan
    // (feuille Risk-based site selection), insérés avec les sites à l'étape 0.

    // ---- 3) Plans de collecte (Planifié) --------------------------------
    await client.query("DELETE FROM tpm_collection_plans WHERE tenant_id=$1 AND title LIKE 'Test —%'", [tenantId]);
    if (tpms.length && contracts.length) {
      for (let i = 0; i < Math.min(2, contracts.length); i += 1) {
        const c = contracts[i]; const tpm = tpms[i % tpms.length];
        const { rows: [plan] } = await client.query(
          `INSERT INTO tpm_collection_plans (tenant_id, partner_id, contract_id, period_month, title, status, created_by)
           VALUES ($1,$2,$3,$4,$5,'valide',$6) ON CONFLICT (partner_id, contract_id, period_month)
           DO UPDATE SET title=EXCLUDED.title RETURNING id`,
          [tenantId, tpm.id, c.id, monthISO(0), `Test — plan ${c.numero}`, admin]);
        await client.query('DELETE FROM tpm_collection_plan_items WHERE plan_id=$1', [plan.id]);
        const items = [
          [MONITORING_LINE, 'Jours de collecte agents', 'jour', 40, 25000, 'bailleur'],
          [MONITORING_LINE, 'Déplacement équipe', 'forfait', 2, 180000, 'bailleur'],
          [MONITORING_LINE, 'Appui logistique ONG', 'forfait', 1, 120000, 'ong'],
        ];
        for (let k = 0; k < items.length; k += 1) {
          const [lc, des, u, qt, cost, pay] = items[k];
          await client.query(
            `INSERT INTO tpm_collection_plan_items (tenant_id, plan_id, line_code, designation, unit, unit_count, unit_cost, pay_by, activity_id, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [tenantId, plan.id, lc, des, u, qt, cost, pay, actId, k]);
        }
      }
    }

    // ---- 4) Rapports : financier validé + financier soumis + technique --
    await client.query("DELETE FROM tpm_reports WHERE tenant_id=$1 AND reference='SEED-TEST'", [tenantId]);
    const funderOf = (items) => r2(items.filter((it) => it[5] === 'bailleur').reduce((s, it) => s + it[3] * it[4], 0));
    if (tpms.length && contracts.length) {
      const facItems = [
        [MONITORING_LINE, 'Jours de collecte réalisés', 'jour', 38, 25000, 'bailleur'],
        [MONITORING_LINE, 'Déplacement équipe', 'forfait', 2, 175000, 'bailleur'],
        [MONITORING_LINE, 'Appui logistique ONG', 'forfait', 1, 120000, 'ong'],
      ];
      const scenarios = [
        { c: contracts[0], tpm: tpms[0], month: monthISO(-1), kind: 'financier', status: 'valide', items: facItems },
        { c: contracts[Math.min(1, contracts.length - 1)], tpm: tpms[tpms.length > 1 ? 1 : 0], month: monthISO(0), kind: 'financier', status: 'soumis', items: facItems },
        { c: contracts[0], tpm: tpms[0], month: monthISO(0), kind: 'technique', status: 'soumis', items: null },
      ];
      for (const s of scenarios) {
        const reported = s.items ? funderOf(s.items) : null;
        // Supprime un éventuel rapport existant sur la même clé naturelle (hors seed-test) pour éviter le conflit d'unicité.
        await client.query('DELETE FROM tpm_reports WHERE tenant_id=$1 AND partner_id=$2 AND contract_id=$3 AND period_month=$4 AND kind=$5 AND reference IS DISTINCT FROM $6',
          [tenantId, s.tpm.id, s.c.id, s.month, s.kind, 'SEED-TEST']);
        const { rows: [rep] } = await client.query(
          `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, planned_amount, reported_amount, reference, status, created_by, decided_by, decided_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'SEED-TEST',$8,$9,$10,$11)
           ON CONFLICT (partner_id, contract_id, period_month, kind) DO UPDATE SET status=EXCLUDED.status, reported_amount=EXCLUDED.reported_amount, reference='SEED-TEST' RETURNING id`,
          [tenantId, s.tpm.id, s.c.id, s.month, s.kind, 1200000, reported, s.status, admin,
            s.status === 'valide' ? validator : null, s.status === 'valide' ? new Date() : null]);
        await client.query('DELETE FROM contract_report_items WHERE report_id=$1', [rep.id]);
        if (s.items) {
          for (let k = 0; k < s.items.length; k += 1) {
            const [lc, des, u, qt, cost, pay] = s.items[k];
            await client.query(
              `INSERT INTO contract_report_items (tenant_id, report_id, line_code, designation, unit, unit_count, unit_cost, pay_by, activity_id, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [tenantId, rep.id, lc, des, u, qt, cost, pay, actId, k]);
          }
        }
      }
    }

    // ---- 5) Contrat en BROUILLON (test suppression + prévision) ---------
    await client.query("DELETE FROM contracts WHERE tenant_id=$1 AND numero LIKE 'CTR-TEST-%'", [tenantId]);
    {
      const { rows: [c] } = await client.query(
        `INSERT INTO contracts (tenant_id, numero, partner_name, numero_fla, date_debut, date_fin, period_months, management_fee_pct, status, created_by)
         VALUES ($1,'CTR-TEST-0001','Partenaire Test (brouillon)','FLA-TEST-001',$2,$3,12,0.07,'brouillon',$4) RETURNING id`,
        [tenantId, monthISO(-2), monthISO(9), admin]);
      if (actId) await client.query('INSERT INTO contract_activities (tenant_id, contract_id, activity_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [tenantId, c.id, actId]);
      const alloc = actId ? JSON.stringify({ [actId]: 1 }) : '{}';
      const bi = [[MONITORING_LINE, 'Suivi tierce partie', 12, 500000], ['I.rh', 'Coordination', 12, 300000]];
      for (let k = 0; k < bi.length; k += 1) {
        const [lc, des, qt, cost] = bi[k];
        await client.query(
          `INSERT INTO contract_budget_items (tenant_id, contract_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tenantId, c.id, lc, des, qt, cost, alloc, k]);
      }
    }

    // ---- 5b) Visites terrain du MOIS COURANT (couverture, jours de collecte) --
    // Le seed de base ne crée des visites que si aucune n'existe ; après un
    // premier seed dans un mois antérieur, le mois courant reste vide. On
    // garantit ici des visites pour le mois courant (et le précédent), avec des
    // statuts variés et des dates, pour alimenter couverture / dashboard /
    // jours de collecte. Idempotent via la clé unique (site, mois, activité).
    if (sites.length) {
      const siteFull = (await client.query('SELECT id, activity, commune FROM sites WHERE tenant_id=$1 ORDER BY code LIMIT 24', [tenantId])).rows;
      const ROLES = ['Agent 1', 'Agent 2', 'Superviseur 1'];
      const tpmIds = tpms.map((p) => p.id);
      for (const mi of [1, 0]) {
        const pm = monthISO(-mi);
        const yyyymm = pm.slice(0, 7);
        for (let i = 0; i < siteFull.length; i += 1) {
          const s = siteFull[i];
          const prov = tpmIds.length ? tpmIds[i % tpmIds.length] : null;
          // ~55 % réalisées, ~10 % annulées, le reste planifiées.
          const mod = (i + mi) % 10;
          const status = mod < 6 ? 'realise' : (mod === 9 ? 'annule' : 'planifie');
          const day = String((i % 26) + 1).padStart(2, '0');
          const visitDate = status === 'annule' ? null : `${yyyymm}-${day}`;
          await client.query(
            `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, provider_id, agent, status, visit_date, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (tenant_id, site_id, period_month, activity) DO UPDATE
               SET status = EXCLUDED.status, visit_date = EXCLUDED.visit_date, provider_id = EXCLUDED.provider_id, agent = EXCLUDED.agent`,
            [tenantId, s.id, pm, s.activity || 'Suivi', prov, ROLES[i % ROLES.length], status, visitDate, admin]);
        }
        // Jours de déplacement (majoration manuelle) par prestataire, pour le budget.
        for (const pid of tpmIds) {
          await client.query(
            `INSERT INTO tpm_collection_days (tenant_id, provider_id, period_month, travel_days)
             VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, provider_id, period_month) DO UPDATE SET travel_days = EXCLUDED.travel_days`,
            [tenantId, pid, pm, 3]);
        }
      }
    }

    // ---- 6) Suivi de processus : fiche + indicateurs + ~40 soumissions --
    await client.query("DELETE FROM monitoring_forms WHERE tenant_id=$1 AND code='TEST_PM'", [tenantId]); // cascade fields/choices/indicators/submissions
    const { rows: [form] } = await client.query(
      "INSERT INTO monitoring_forms (tenant_id, code, label) VALUES ($1,'TEST_PM','Suivi de processus — Test (démo)') RETURNING id", [tenantId]);
    const FIELDS = [
      ['EnuName', 'text', 'Nom de l\'énumérateur', null],
      ['site_present', 'select_one', 'Site présent et accessible ?', 'Yesno'],
      ['stock_ok', 'select_one', 'Stock conforme ?', 'Yesno'],
      ['benef_count', 'integer', 'Nombre de bénéficiaires reçus', null],
    ];
    for (let i = 0; i < FIELDS.length; i += 1) {
      const [name, type, label, list] = FIELDS[i];
      await client.query(
        'INSERT INTO monitoring_form_fields (tenant_id, form_id, name, type, label, list_name, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [tenantId, form.id, name, type, label, list, i]);
    }
    for (const [v, l] of [['1', 'Oui'], ['0', 'Non']]) {
      await client.query('INSERT INTO monitoring_choices (tenant_id, form_id, list_name, value, label) VALUES ($1,$2,\'Yesno\',$3,$4)', [tenantId, form.id, v, l]);
    }
    const INDICATORS = [
      ['CFM1', 'Taux de sites présents', 'site_present', 'percent_yes', '1', 90, 'higher_better'],
      ['CFM2', 'Taux de stocks conformes', 'stock_ok', 'percent_yes', '1', 80, 'higher_better'],
      ['CFM3', 'Bénéficiaires reçus (moyenne)', 'benef_count', 'mean', null, null, 'higher_better'],
    ];
    for (let i = 0; i < INDICATORS.length; i += 1) {
      const [code, label, sf, agg, pos, target, dir] = INDICATORS[i];
      await client.query(
        `INSERT INTO monitoring_indicators (tenant_id, form_id, code, label, source_field, agg, positive_value, target, direction, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tenantId, form.id, code, label, sf, agg, pos, target, dir, i]);
    }
    // ~40 soumissions sur 3 mois, réparties par bureau/district/prestataire.
    const offices = ['Bureau terrain Sud', 'Antenne Toliara', 'Bureau pays (Antananarivo)'];
    const agents = ['Agent 1', 'Agent 2', 'Superviseur 1'];
    let n = 0;
    for (let mi = 2; mi >= 0; mi -= 1) {
      const pm = monthISO(-mi);
      const count = 12 + mi * 2;
      for (let k = 0; k < count; k += 1) {
        const s = sites[(n) % Math.max(1, sites.length)] || {};
        const present = (n % 10 !== 0) ? '1' : '0';          // ~90 % présents
        const stock = (n % 3 !== 0) ? '1' : '0';             // ~66 % conformes
        const benef = 20 + ((n * 7) % 60);
        await client.query(
          `INSERT INTO monitoring_submissions (tenant_id, form_id, external_id, period_month, submitted_at, field_office, admin2, site, partner, agent, source, data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'csv',$11)
           ON CONFLICT (form_id, external_id) DO NOTHING`,
          [tenantId, form.id, `seedtest-${pm}-${k}`, pm, new Date(),
            offices[n % offices.length], s.district || 'Toliara II', s.commune || 'Site test',
            tpms[n % Math.max(1, tpms.length)]?.name || 'TPM Test', agents[n % agents.length],
            JSON.stringify({ EnuName: `Enum ${n % 5 + 1}`, site_present: present, stock_ok: stock, benef_count: benef })]);
        n += 1;
      }
    }

    logger.info({ submissions: n, offices: 3, rates: 3 }, 'seed-test complet — connectez-vous (admin@mems.mg / changeme123) pour inspecter');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  const explained = explainConnError(err, 'DATABASE_URL');
  if (explained) logger.error(`seed-test impossible : ${explained}`);
  else logger.error({ err }, 'seed-test failed');
  process.exit(1);
});
