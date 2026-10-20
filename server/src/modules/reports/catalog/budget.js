const { totalsOf } = require('../../tpm/consolidation');
const { contractAlerts } = require('../../dashboards/alertsMath');
const { overlaps } = require('../../common/period');
const { phrases } = require('../phrases');
const { col, ratePct } = require('./facts');

/**
 * Jeux de données « Budget et contrats » (lot 7a, C5) — déclarations PURES.
 *  - consolidation : situation AU DERNIER MOIS de la période (`until`) ; montants issus des
 *    centimes de buildConsolidation, totaux d'un partenaire recalculés en centimes (totalsOf) ;
 *  - contracts : liste du module Contrats ; échéances = contractAlerts (même règle que le
 *    Centre d'alertes) ; contractDetail / contractForecast : un contrat (`args.contractId`) ;
 *  - amendments : avenants demandés sur la période.
 * Budget et contrats ne sont pas reliés aux bureaux : le filtre bureau n'est pas déclaré
 * (note « Non disponible par bureau »), jamais un total national présenté comme un bureau.
 */
const ORIGIN_CONS = { page: 'Dashboard décisionnel › Suivi budgétaire consolidé', route: '#/dashboard/consolidation' };
const ORIGIN_CTR = { page: 'Contrats', route: '#/contrats' };
const CONTRACT_ARG = { contractId: { type: 'uuid', label: 'Contrat', required: true, choices: 'contracts' } };

const ds = (key, def) => ({ key, group: 'budget', filters: ['partner'], officeKinds: [], periodMode: 'asOf', ...def });
const cents = (v) => Math.round((Number(v) || 0) * 100);
const consRows = (raw, eff) => ((raw && raw.rows) || []).filter((r) => !eff.partnerId || r.partnerId === eff.partnerId);
const asOf = (eff, raw) => (raw && raw.today) || (eff.period ? eff.period.to : null);

const KPI_COLS = [
  col('budget', 'Budget de suivi', 'money'), col('planned', 'Planifié', 'money'), col('actual', 'Réalisé', 'money'),
  col('consumption', 'Taux de consommation', 'pct'), col('remaining', 'Restant', 'money'), col('projected', 'Projection de fin', 'money'),
  col('pending', 'Factures en attente de validation', 'money'), col('contracts', 'Contrats suivis', 'int'),
];
const budKpis = ds('bud.kpis', {
  label: 'Budget de suivi (chiffres clés)', origin: ORIGIN_CONS, source: 'consolidation', views: ['kpi', 'table'], defaultView: 'kpi',
  columns: KPI_COLS,
  shape(raw, eff) {
    const rows = consRows(raw, eff);
    const t = totalsOf(rows);
    const pending = rows.reduce((a, r) => a + cents(r.pendingValidation), 0) / 100;
    const row = { _key: 'total', budget: t.budget, planned: t.planned, actual: t.actual, consumption: t.budget ? ratePct(t.actualRate) : null, remaining: t.remaining, projected: t.projectedTotal, pending, contracts: t.contracts };
    return { columns: KPI_COLS, rows: [row], meta: { n: t.contracts, nLabel: 'contrats', asOf: asOf(eff, raw) } };
  },
});

const CONTRACT_COLS = [
  col('contract', 'Contrat'), col('partner', 'Partenaire'), col('budget', 'Budget de suivi', 'money'), col('planned', 'Planifié', 'money'),
  col('actual', 'Réalisé', 'money'), col('rate', 'Taux de consommation', 'pct'), col('remaining', 'Restant', 'money'),
  col('projected', 'Projection de fin', 'money'), col('monthsRemaining', 'Mois restants', 'int'),
];
const byContract = ds('bud.by_contract', {
  label: 'Situation budgétaire par contrat', origin: ORIGIN_CONS, source: 'consolidation', views: ['table', 'bar'], defaultView: 'table',
  columns: CONTRACT_COLS, measures: ['actual', 'budget'],
  shape(raw, eff) {
    const rows = consRows(raw, eff).map((r) => ({
      _key: r.contractId, contract: r.numero, partner: r.partnerName, budget: r.budget, planned: r.planned, actual: r.actual,
      rate: r.budget ? ratePct(r.actualRate) : null, remaining: r.remaining, projected: r.projectedTotal, monthsRemaining: r.monthsRemaining,
      overspent: r.overspent,
    }));
    return { columns: CONTRACT_COLS, rows, meta: { n: rows.length, nLabel: 'contrats', asOf: asOf(eff, raw) } };
  },
});

const MONTHLY_COLS = [col('month', 'Mois', 'month'), col('planned', 'Planifié', 'money'), col('actual', 'Réalisé', 'money'), col('ecart', 'Écart (réalisé − planifié)', 'money')];
const budMonthly = ds('bud.monthly', {
  label: 'Réalisé, planifié et écart par mois', origin: ORIGIN_CONS, source: 'consolidation', periodMode: 'range', views: ['table', 'line', 'column', 'heat'], defaultView: 'table',
  columns: MONTHLY_COLS, measures: ['planned', 'actual'],
  shape(raw, eff) {
    const sums = new Map();
    for (const r of consRows(raw, eff)) {
      for (const [m, c] of Object.entries(r.monthly || {})) {
        if (eff.period && (m < eff.period.from || m > eff.period.to)) continue;
        const s = sums.get(m) || { p: 0, a: 0 };
        s.p += cents(c.planned); s.a += cents(c.actual);
        sums.set(m, s);
      }
    }
    const rows = [...sums].sort((a, b) => a[0].localeCompare(b[0])).map(([m, s]) => ({ _key: m, month: m, planned: s.p / 100, actual: s.a / 100, ecart: (s.a - s.p) / 100 }));
    return { columns: MONTHLY_COLS, rows, meta: { n: rows.length, nLabel: 'mois', asOf: asOf(eff, raw) } };
  },
});

const PARTNER_COLS = [col('partner', 'Titulaire'), col('actual', 'Réalisé', 'money'), col('budget', 'Budget de suivi', 'money'), col('share', 'Part du réalisé', 'pct')];
const byPartner = ds('bud.by_partner', {
  label: 'Réalisé par titulaire', origin: ORIGIN_CONS, source: 'consolidation', filters: [], views: ['donut', 'bar', 'table'], defaultView: 'donut',
  columns: PARTNER_COLS, measures: ['actual'],
  shape(raw, eff) {
    const per = new Map();
    for (const r of consRows(raw, {})) {
      const k = r.partnerId || r.partnerName || '—';
      const e = per.get(k) || { partner: r.partnerName || '—', a: 0, b: 0 };
      e.a += cents(r.actual); e.b += cents(r.budget);
      per.set(k, e);
    }
    const total = [...per.values()].reduce((s, e) => s + e.a, 0);
    const rows = [...per].map(([k, e]) => ({ _key: k, partner: e.partner, actual: e.a / 100, budget: e.b / 100, share: total ? Math.round((e.a / total) * 1000) / 10 : null }))
      .sort((x, y) => y.actual - x.actual || x.partner.localeCompare(y.partner, 'fr'));
    return { columns: PARTNER_COLS, rows, meta: { n: rows.length, nLabel: 'titulaires', asOf: asOf(eff, raw) } };
  },
});

// ---- Contrats ---------------------------------------------------------------------------------
const LIST_COLS = [
  col('reference', 'Référence'), col('numero', 'Numéro'), col('partner', 'Partenaire'), col('status', 'Statut', 'status'),
  col('dateDebut', 'Début', 'date'), col('dateFin', 'Fin', 'date'), col('total', 'Total de l\'accord', 'money'),
  col('monitoring', 'Budget de suivi', 'money'), col('spent', 'Réalisé (suivi)', 'money'),
];
const ctrList = ds('ctr.list', {
  label: 'Contrats de la période', origin: ORIGIN_CTR, source: 'contracts', periodMode: 'range', views: ['table'], defaultView: 'table',
  columns: LIST_COLS,
  shape(raw, eff) {
    const rows = (raw || []).filter((c) => (!eff.partnerId || c.partnerId === eff.partnerId) && overlaps(eff.period, c.dateDebut, c.dateFin)
      && !['brouillon', 'rejete'].includes(c.status))
      .map((c) => ({
        _key: c.id, reference: c.reference || c.numeroFla || null, numero: c.numero, partner: c.partnerName, status: c.status,
        dateDebut: c.dateDebut, dateFin: c.dateFin, total: c.budgetTotal, monitoring: c.monitoringBudget, spent: c.spentTotal,
      }));
    return { columns: LIST_COLS, rows, meta: { n: rows.length, nLabel: 'contrats' } };
  },
});

const EXP_COLS = [col('numero', 'Numéro'), col('partner', 'Partenaire'), col('dateFin', 'Fin', 'date'), col('days', 'Jours restants', 'int'), col('alert', 'Alerte', 'message')];
const ctrExpiring = ds('ctr.expiring', {
  label: 'Contrats à échéance (90 jours ou moins)', origin: { page: 'Alertes › Centre d\'alertes', route: '#/alertes/centre' }, source: 'contracts', periodMode: 'now',
  views: ['table', 'list'], defaultView: 'table', columns: EXP_COLS,
  shape(raw, eff, ctx) {
    const list = (raw || []).filter((c) => !eff.partnerId || c.partnerId === eff.partnerId);
    const byId = new Map(list.map((c) => [c.id, c]));
    const today = ctx.today || new Date().toISOString().slice(0, 10);
    const rows = contractAlerts(list, today).filter((a) => a.kind === 'contract_ending' || a.kind === 'contract_expired').map((a) => {
      const c = byId.get(a.go.extra) || {};
      const days = c.dateFin ? Math.round((Date.parse(`${String(c.dateFin).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
      return { _key: c.id, numero: c.numero, partner: c.partnerName, dateFin: c.dateFin, days, alert: { text: a.title, params: a.params }, tone: a.kind === 'contract_expired' ? 'urg' : 'imp' };
    }).sort((x, y) => (x.days ?? 0) - (y.days ?? 0));
    return { columns: EXP_COLS, rows, meta: { n: rows.length, nLabel: 'contrats', asOf: today } };
  },
});

const FC_COLS = [col('month', 'Mois', 'month'), col('amount', 'Dépense du mois', 'money'), col('cumulative', 'Cumul', 'money'), col('remaining', 'Restant', 'money'), col('kind', 'Nature')];
const ctrForecast = ds('ctr.forecast', {
  label: 'Prévision de consommation d\'un contrat', origin: ORIGIN_CTR, source: 'contractForecast', filters: [], periodMode: 'now',
  views: ['line', 'table', 'column'], defaultView: 'line', columns: FC_COLS, measures: ['cumulative'], args: CONTRACT_ARG,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    if (!raw) return { columns: FC_COLS, rows: [], meta: { note: T.chooseContract } };
    const rows = (raw.series || []).map((s) => ({ _key: s.month, month: s.month, amount: s.amount, cumulative: s.cumulative, remaining: s.remaining, kind: s.isFuture ? T.projected : T.actualLabel }));
    return { columns: FC_COLS, rows, meta: { n: rows.length, nLabel: 'mois', asOf: raw.asOf, forecast: { budget: raw.budget, projectedTotal: raw.projectedTotal, willOverspend: raw.willOverspend } } };
  },
});

const ITEM_COLS = [col('section', 'Section'), col('line', 'Ligne budgétaire'), col('description', 'Poste'), col('unitCount', 'Quantité', 'dec'), col('unitCost', 'Coût unitaire', 'money'), col('amount', 'Montant', 'money')];
const ctrItems = ds('ctr.budget_items', {
  label: 'Budget détaillé d\'un contrat (sections I à V)', origin: ORIGIN_CTR, source: 'contractDetail', filters: [], periodMode: 'now',
  views: ['table'], defaultView: 'table', columns: ITEM_COLS, args: CONTRACT_ARG,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    if (!raw) return { columns: ITEM_COLS, rows: [], meta: { note: T.chooseContract } };
    const b = raw.budget;
    const rows = [];
    for (const s of b.sections) {
      for (const l of s.lines) for (const it of l.items) rows.push({ _key: it.id, section: `${s.code}. ${s.label}`, line: l.label, description: it.description, unitCount: it.unitCount, unitCost: it.unitCost, amount: it.amount });
      if (s.lines.some((l) => l.items.length)) rows.push({ _key: `s:${s.code}`, section: `${s.code}. ${s.label}`, line: null, description: T.subtotal, unitCount: null, unitCost: null, amount: s.total, _total: true });
    }
    rows.push({ _key: 'direct', section: null, line: null, description: T.directTotal, amount: b.direct.total, _total: true });
    rows.push({ _key: 'fee', section: null, line: null, description: T.managementFee(Math.round(b.managementFee.pct * 1000) / 10), amount: b.managementFee.amount, _total: true });
    rows.push({ _key: 'grand', section: null, line: null, description: T.grandTotal, amount: b.total.grand, _total: true });
    return { columns: ITEM_COLS, rows, meta: { n: rows.filter((r) => !r._total).length, nLabel: 'postes', contract: { numero: raw.contract.numero, partner: raw.contract.partnerName } } };
  },
});

const AMD_COLS = [
  col('numero', 'Contrat'), col('partner', 'Partenaire'), col('number', 'Avenant', 'int'), col('status', 'Statut', 'status'),
  col('createdAt', 'Demandé le', 'date'), col('decidedAt', 'Décidé le', 'date'), col('newDateFin', 'Nouvelle date de fin', 'date'), col('changes', 'Postes modifiés', 'int'),
];
const ctrAmendments = ds('ctr.amendments', {
  label: 'Avenants demandés sur la période', origin: ORIGIN_CTR, source: 'amendments', periodMode: 'range', views: ['table'], defaultView: 'table',
  columns: AMD_COLS,
  shape(raw) {
    const changes = (b) => (Array.isArray(b) ? b.length : b && typeof b === 'object' ? (Array.isArray(b.after && b.after.items) ? b.after.items.length : Object.keys(b).length) : 0);
    const rows = (raw || []).map((a) => ({
      _key: a.id, numero: a.numero, partner: a.partnerName, number: a.number, status: a.status === 'approuve' ? 'valide' : a.status === 'rejete' ? 'rejete' : 'en_validation',
      createdAt: a.createdAt, decidedAt: a.decidedAt, newDateFin: a.newDateFin, changes: changes(a.budgetChanges),
    }));
    return { columns: AMD_COLS, rows, meta: { n: rows.length, nLabel: 'avenants' } };
  },
});

module.exports = [budKpis, byContract, budMonthly, byPartner, ctrList, ctrExpiring, ctrForecast, ctrItems, ctrAmendments];
module.exports.consRows = consRows;
