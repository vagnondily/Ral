const { overlaps } = require('../../common/period');
const { phrases } = require('../phrases');
const { col, pctOf } = require('./facts');

/**
 * Jeux de données « Partenaires et TPM » (lot 7a, C5) — déclarations PURES sur les sources du
 * module (rapports et factures, plans de collecte, prestataires et agents, évaluations,
 * formations, fiche 360°, parcours). Le partenaire vient du filtre du bloc, d'une section
 * répétée par partenaire, ou de `args.partnerId`.
 */
const ORIGIN_REP = { page: 'Partenaires & TPM › Rapports', route: '#/tpm/rapports' };
const ORIGIN_PLAN = { page: 'Partenaires & TPM › Planification & budget', route: '#/tpm/planification' };
const ORIGIN_PART = { page: 'Partenaires & TPM › Fiche du prestataire', route: '#/tpm/prestataires' };
const PARTNER_ARG = { partnerId: { type: 'uuid', label: 'Partenaire', choices: 'partners' } };

const ds = (key, def) => ({ key, group: 'tpm', filters: ['partner'], officeKinds: [], periodMode: 'range', ...def });
const inPeriod = (eff, month) => !eff.period || overlaps(eff.period, month);
const m7 = (d) => (d ? String(d).slice(0, 7) : null);

const STATUSES = ['attendu', 'soumis', 'valide', 'rejete', 'non_applicable'];
const REP_COLS = [
  col('partner', 'Partenaire'), col('kind', 'Nature'), col('expected', 'Attendus', 'int'), col('soumis', 'Soumis', 'int'),
  col('valide', 'Validés', 'int'), col('rejete', 'Rejetés', 'int'), col('attendu', 'Non remis', 'int'), col('rate', 'Taux de validation', 'pct'),
];
const reportsStatus = ds('tpm.reports_status', {
  label: 'Rapports TPM : attendus, soumis, validés, rejetés', origin: ORIGIN_REP, source: 'tpmReports', views: ['table', 'bar'], defaultView: 'table',
  columns: REP_COLS, measures: ['valide', 'soumis'],
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const per = new Map();
    for (const r of raw || []) {
      if (!inPeriod(eff, m7(r.periodMonth)) || r.status === 'non_applicable') continue;
      const k = `${r.partnerId}|${r.kind}`;
      if (!per.has(k)) per.set(k, { partner: r.partnerName, kind: r.kind, expected: 0, ...Object.fromEntries(STATUSES.map((s) => [s, 0])) });
      const e = per.get(k);
      e.expected += 1; e[r.status] = (e[r.status] || 0) + 1;
    }
    const rows = [...per].map(([k, e]) => ({ _key: k, ...e, kind: T.reportKind[e.kind] || e.kind, rate: pctOf(e.valide, e.expected) }))
      .sort((a, b) => a.partner.localeCompare(b.partner, 'fr') || a.kind.localeCompare(b.kind, 'fr'));
    return { columns: REP_COLS, rows, meta: { n: rows.reduce((a, r) => a + r.expected, 0), nLabel: 'rapports' } };
  },
});

const PLAN_COLS = [
  col('month', 'Mois', 'month'), col('partner', 'Partenaire'), col('contract', 'Contrat'), col('title', 'Plan'), col('status', 'Statut', 'status'),
  col('plannedTotal', 'Total prévu', 'money'), col('plannedFunder', 'Part bailleur (planifié)', 'money'),
];
const plans = ds('tpm.plans', {
  label: 'Plans de collecte (planifié par mois)', origin: ORIGIN_PLAN, source: 'tpmPlans', views: ['table', 'column'], defaultView: 'table',
  columns: PLAN_COLS, measures: ['plannedFunder'],
  shape(raw, eff) {
    const rows = (raw || []).filter((p) => (!eff.partnerId || p.partnerId === eff.partnerId) && inPeriod(eff, m7(p.periodMonth)))
      .map((p) => ({ _key: p.id, month: m7(p.periodMonth), partner: p.partnerName, contract: p.contractNumero, title: p.title || null, status: p.status, plannedTotal: p.plannedTotal, plannedFunder: p.plannedFunder }))
      .sort((a, b) => a.month.localeCompare(b.month) || a.partner.localeCompare(b.partner, 'fr'));
    return { columns: PLAN_COLS, rows, meta: { n: rows.length, nLabel: 'plans' } };
  },
});

const PROV_COLS = [col('provider', 'Prestataire'), col('agentsActive', 'Agents actifs', 'int'), col('agents', 'Agents', 'int'), col('trainings', 'Formations', 'int'), col('dailyRate', 'Taux journalier', 'money')];
const providers = ds('tpm.providers', {
  label: 'Prestataires TPM (agents, formations)', origin: ORIGIN_PART, source: 'tpmProviders', periodMode: 'now', views: ['table', 'bar'], defaultView: 'table',
  columns: PROV_COLS, measures: ['agentsActive'],
  shape(raw, eff) {
    const rows = (raw || []).filter((p) => !eff.partnerId || p.id === eff.partnerId).map((p) => ({
      _key: p.id, provider: p.name, agentsActive: p.agents.filter((a) => a.active).length, agents: p.agents.length,
      trainings: p.agents.reduce((s, a) => s + a.formations.length, 0), dailyRate: p.dailyRate || null,
    }));
    return { columns: PROV_COLS, rows, meta: { n: rows.length, nLabel: 'prestataires' } };
  },
});

const EVAL_COLS = [
  col('agent', 'Agent'), col('provider', 'Prestataire'), col('missions', 'Missions (sites)', 'int'), col('missionDays', 'Jours de mission', 'int'),
  col('evaluations', 'Évaluations', 'int'), col('note', 'Dernière note', 'dec'), col('appreciation', 'Appréciation'),
];
const evaluations = ds('tpm.agent_evaluations', {
  label: 'Évaluations des agents', origin: ORIGIN_PART, source: 'tpmEvaluations', views: ['table', 'bar'], defaultView: 'table',
  columns: EVAL_COLS, measures: ['note'],
  shape(raw, eff) {
    const rows = (raw || []).filter((a) => !eff.partnerId || a.providerId === eff.partnerId).map((a) => {
      const evs = a.evaluations.filter((e) => inPeriod(eff, m7(e.periode)));
      const last = evs[0] || null;
      return { _key: a.id, agent: a.name, provider: a.providerName, missions: a.missions, missionDays: a.missionDays, evaluations: evs.length, note: last ? last.note : null, appreciation: last ? last.appreciation : null };
    });
    return { columns: EVAL_COLS, rows, meta: { n: rows.length, nLabel: 'agents' } };
  },
});

const FORM_COLS = [col('date', 'Date', 'date'), col('agent', 'Agent'), col('provider', 'Prestataire'), col('thematique', 'Thématique'), col('jours', 'Jours', 'dec')];
const formations = ds('tpm.formations', {
  label: 'Formations des agents', origin: ORIGIN_PART, source: 'formations', views: ['table'], defaultView: 'table', columns: FORM_COLS,
  shape(raw) {
    const rows = (raw || []).map((f) => ({ _key: f.id, date: f.date, agent: f.agentName, provider: f.providerName, thematique: f.thematique, jours: f.jours }));
    return { columns: FORM_COLS, rows, meta: { n: rows.length, nLabel: 'formations' } };
  },
});

const SHEET_COLS = [
  col('contract', 'Contrat en cours'), col('budget', 'Budget de suivi', 'money'), col('actual', 'Réalisé', 'money'), col('consumption', 'Taux de consommation', 'pct'),
  col('pending', 'Factures en attente', 'money'), col('visitsAssigned', 'Visites affectées (mois)', 'int'), col('visitsRealised', 'Visites réalisées (mois)', 'int'),
  col('visitsRate', 'Taux de réalisation', 'pct'), col('agentsActive', 'Agents actifs', 'int'), col('sitesFollowed', 'Sites suivis (12 mois)', 'int'),
  col('invoicesPending', 'Factures à valider', 'int'),
];
const partnerSheet = ds('tpm.partner_sheet', {
  label: 'Fiche 360° d\'un partenaire', origin: ORIGIN_PART, source: 'partnerSheet', periodMode: 'now', views: ['kpi', 'table'], defaultView: 'kpi',
  columns: SHEET_COLS, args: PARTNER_ARG,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    if (!raw) return { columns: SHEET_COLS, rows: [], meta: { note: T.choosePartner } };
    const f = raw.facts;
    const c = f.contract.status === 'mesure' ? f.contract : null;
    const row = {
      _key: raw.partner.id, partner: raw.partner.name, contract: c ? c.numero : null, budget: c ? c.budget : null, actual: c ? c.actual : null,
      consumption: c ? c.consumption : null, pending: c ? c.pending : null, visitsAssigned: f.visits.assigned, visitsRealised: f.visits.realised,
      visitsRate: f.visits.rate, agentsActive: f.team.active, sitesFollowed: f.sitesFollowed, invoicesPending: f.invoicesPending,
    };
    return { columns: SHEET_COLS, rows: [row], meta: { n: 1, nLabel: 'partenaire', asOf: f.visits.month } };
  },
});

const TL_COLS = [col('at', 'Date', 'date'), col('kind', 'Type'), col('event', 'Événement', 'message')];
const partnerTimeline = ds('tpm.partner_timeline', {
  label: 'Parcours d\'un partenaire (24 mois)', origin: ORIGIN_PART, source: 'partnerTimeline', periodMode: 'now', views: ['list', 'table'], defaultView: 'list',
  columns: TL_COLS, args: PARTNER_ARG,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    if (!raw) return { columns: TL_COLS, rows: [], meta: { note: T.choosePartner } };
    const rows = raw.items.map((x, i) => ({ _key: `${x.at}|${i}`, at: x.at.slice(0, 10), kind: T.timelineKind[x.kind] || x.kind, event: x.message }));
    return { columns: TL_COLS, rows, meta: { n: rows.length, nLabel: 'événements' } };
  },
});

const INV_COLS = [
  col('section', 'Section'), col('line', 'Ligne budgétaire'), col('designation', 'Poste'), col('unitCount', 'Quantité', 'dec'),
  col('unitCost', 'Coût unitaire', 'money'), col('amount', 'Montant', 'money'), col('funderPct', '% bailleur', 'pct'), col('funder', 'Part bailleur', 'money'),
];
const invoice = ds('tpm.invoice', {
  label: 'État des dépenses d\'une facture', origin: ORIGIN_REP, source: 'invoice', filters: [], periodMode: 'now', views: ['table'], defaultView: 'table',
  columns: INV_COLS, args: { reportId: { type: 'uuid', label: 'Facture', required: true, choices: 'reports' } },
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    if (!raw) return { columns: INV_COLS, rows: [], meta: { note: T.chooseReport } };
    const r = raw.report;
    const cents = (v) => Math.round((Number(v) || 0) * 100);
    const rows = r.items.map((it) => ({
      _key: it.id, section: it.section, line: it.lineLabel, designation: it.designation, unitCount: it.unitCount, unitCost: it.unitCost, amount: it.amount,
      funderPct: Math.round((it.bailleurPct == null ? 1 : it.bailleurPct) * 1000) / 10, funder: Math.round(cents(it.amount) * (it.bailleurPct == null ? 1 : it.bailleurPct)) / 100,
    }));
    for (const s of r.summary.sections || []) rows.push({ _key: `s:${s.code}`, section: s.code, line: null, designation: T.subtotal, amount: s.total, funder: s.funder, _total: true });
    rows.push({ _key: 'total', section: null, line: null, designation: T.total, amount: r.summary.total, funder: r.summary.funder, _total: true });
    return { columns: INV_COLS, rows, meta: { n: r.items.length, nLabel: 'postes', invoice: { partner: r.partnerName, contract: r.contractNumero, month: m7(r.periodMonth), status: r.status } } };
  },
});

module.exports = [reportsStatus, plans, providers, evaluations, formations, partnerSheet, partnerTimeline, invoice];
