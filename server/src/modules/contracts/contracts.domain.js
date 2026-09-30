/**
 * Pure business rules of the Contrats module — no I/O, fully unit-tested.
 *
 * Budget model = faithful reproduction of the FLA budget workbook
 * (feuille « Budget de l'accord »):
 * each cost line holds a list of budget ITEMS (poste) with
 *   quantité (unitCount) × coût unitaire (unitCost) = montant,
 * allocated across the contract's activities by percentage.
 * Line/section totals are computed bottom-up; a management fee
 * (commission de gestion, % of direct costs) is added to reach the
 * "Total de l'accord" — the contract ceiling (the "barème"), never typed.
 */
const { SECTIONS: CATALOG, MONITORING_LINE, isValidLine, LINE_LABELS, SECTION_OF } = require('./budgetCatalog');

const STATUS_LABELS = {
  brouillon: 'Brouillon', en_validation: 'En validation', actif: 'Actif', rejete: 'Rejeté', resilie: 'Résilié',
};
const TRANSITIONS = {
  submit: { from: ['brouillon', 'rejete'], to: 'en_validation' },
  approve: { from: ['en_validation'], to: 'actif' },
  reject: { from: ['en_validation'], to: 'rejete' },
  terminate: { from: ['actif'], to: 'resilie' },
};
const EDITABLE_STATUSES = ['brouillon', 'rejete'];
const RENEWAL_WINDOW_DAYS = 90;
const DEFAULT_FEE_PCT = 0.07;

function transitionTarget(action, status) {
  const r = TRANSITIONS[action];
  return r && r.from.includes(status) ? r.to : null;
}
function isEditable(status) { return EDITABLE_STATUSES.includes(status); }
function toCents(v) { return Math.round(Number(v || 0) * 100); }
function round2(cents) { return cents / 100; }

/** montant d'un poste, en centimes. */
function itemCents(item) {
  return Math.round(Number(item.unitCount || 0) * Number(item.unitCost || 0) * 100);
}

/**
 * Build the full budget view from stored items.
 * items: [{ lineCode, description, unitCount, unitCost, allocations:{actId:pct} }]
 * activities: [{ id, label }]; feePct: management fee; monitoringSpent: Ar.
 */
function computeBudget(items, activities, feePct = DEFAULT_FEE_PCT, monitoringSpent = 0) {
  const actIds = activities.map((a) => a.id);
  const byLine = new Map(); // lineCode -> items[]
  for (const it of items) {
    if (!byLine.has(it.lineCode)) byLine.set(it.lineCode, []);
    byLine.get(it.lineCode).push(it);
  }

  const grandByAct = Object.fromEntries(actIds.map((id) => [id, 0]));
  let directCents = 0;
  let monitoringCents = 0;

  const sections = CATALOG.map((sec) => {
    const secByAct = Object.fromEntries(actIds.map((id) => [id, 0]));
    let secCents = 0;
    const lines = sec.lines.map(([line, label]) => {
      const lineCode = `${sec.code}.${line}`;
      const rawItems = byLine.get(lineCode) || [];
      let lineCents = 0;
      const lineByAct = Object.fromEntries(actIds.map((id) => [id, 0]));
      const outItems = rawItems.map((it) => {
        const cents = itemCents(it);
        lineCents += cents;
        const perAct = {};
        for (const id of actIds) {
          const pct = Number((it.allocations || {})[id] || 0);
          const c = Math.round(cents * pct);
          perAct[id] = round2(c);
          lineByAct[id] += c;
        }
        return {
          id: it.id, description: it.description,
          unitCount: Number(it.unitCount || 0), unitCost: Number(it.unitCost || 0),
          amount: round2(cents), allocations: it.allocations || {}, byActivity: perAct,
        };
      });
      for (const id of actIds) secByAct[id] += lineByAct[id];
      secCents += lineCents;
      if (lineCode === MONITORING_LINE) monitoringCents = lineCents;
      return {
        lineCode, label, items: outItems, total: round2(lineCents),
        byActivity: Object.fromEntries(actIds.map((id) => [id, round2(lineByAct[id])])),
      };
    });
    for (const id of actIds) grandByAct[id] += secByAct[id];
    directCents += secCents;
    return {
      code: sec.code, label: sec.label, short: sec.short, lines,
      total: round2(secCents),
      byActivity: Object.fromEntries(actIds.map((id) => [id, round2(secByAct[id])])),
    };
  });

  const pct = Number(feePct) || 0;
  const feeCents = Math.round(directCents * pct);
  const grandCents = directCents + feeCents;
  const spentCents = toCents(monitoringSpent);

  return {
    activities,
    sections,
    direct: { total: round2(directCents), byActivity: Object.fromEntries(actIds.map((id) => [id, round2(grandByAct[id])])) },
    managementFee: { pct, amount: round2(feeCents) },
    total: { grand: round2(grandCents) }, // "Total de l'accord" — le plafond / barème
    monitoring: {
      lineCode: MONITORING_LINE,
      budget: round2(monitoringCents),
      spent: Number(monitoringSpent) || 0,
      remaining: round2(monitoringCents - spentCents),
      rate: monitoringCents > 0 ? spentCents / monitoringCents : 0,
      overspent: spentCents > monitoringCents,
    },
  };
}

/** Sum of all item amounts (direct costs, before fee), in Ar. */
function directTotal(items) {
  return round2(items.reduce((n, it) => n + itemCents(it), 0));
}
function grandTotal(items, feePct = DEFAULT_FEE_PCT) {
  const d = items.reduce((n, it) => n + itemCents(it), 0);
  return round2(d + Math.round(d * (Number(feePct) || 0)));
}

/** Monthly ceiling = total de l'accord ÷ nombre de mois. */
function monthlyCeiling(grand, months) {
  const m = Number(months) || 0;
  return m > 0 ? Math.round((grand / m) * 100) / 100 : 0;
}

/** Inclusive whole-month count between two 'YYYY-MM-DD' dates. */
function monthsBetween(dateDebut, dateFin) {
  const [y1, m1] = dateDebut.split('-').map(Number);
  const [y2, m2] = dateFin.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

/** Validate & clean incoming budget items against catalogue + activities. */
function normalizeBudgetItems(rawItems, activityIds) {
  const allowed = new Set(activityIds);
  const out = [];
  for (const it of rawItems || []) {
    if (!isValidLine(it.lineCode)) throw new Error(`Ligne budgétaire inconnue : ${it.lineCode}`);
    const desc = String(it.description || '').trim();
    if (desc.length < 2) throw new Error('Chaque poste doit avoir une description.');
    const unitCount = Number(it.unitCount);
    const unitCost = Number(it.unitCost);
    if (!Number.isFinite(unitCount) || unitCount < 0) throw new Error(`Quantité invalide pour « ${desc} ».`);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`Coût unitaire invalide pour « ${desc} ».`);
    const allocations = {};
    let sum = 0;
    for (const [actId, pct] of Object.entries(it.allocations || {})) {
      if (!allowed.has(actId)) throw new Error('Répartition sur une activité hors du contrat.');
      const p = Number(pct);
      if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`Pourcentage invalide pour « ${desc} ».`);
      if (p > 0) { allocations[actId] = p; sum += p; }
    }
    // Default: 100% on the first activity if nothing set.
    if (sum === 0 && activityIds.length) { allocations[activityIds[0]] = 1; sum = 1; }
    if (Math.abs(sum - 1) > 0.001) throw new Error(`La répartition par activité de « ${desc} » doit totaliser 100 %.`);
    out.push({ lineCode: it.lineCode, description: desc, unitCount, unitCost, allocations });
  }
  return out;
}

function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function renewalWindowOpen(dateFin, today) { return daysBetween(today, dateFin) <= RENEWAL_WINDOW_DAYS; }
function contractNumber(year, seq) { return `CTR-${year}-${String(seq).padStart(4, '0')}`; }
function amendmentCode(n) { return `AM${String(n).padStart(2, '0')}`; }
function displayReference(numeroFla, amendmentCount) {
  if (!numeroFla) return null;
  return amendmentCount > 0 ? `${numeroFla}-${amendmentCode(amendmentCount)}` : numeroFla;
}

/** Amendment now carries a new end date and/or a new management fee, plus a
 * justification. Budget lines are revised by editing a new draft renewal or a
 * fresh version — kept simple and auditable. */
function normalizeAmendment({ newDateFin, newFeePct }, contract) {
  const changes = {};
  if (newDateFin && newDateFin !== contract.dateFin) {
    if (newDateFin <= contract.dateDebut) throw new Error('La nouvelle date de fin doit suivre la date de début.');
    changes.newDateFin = newDateFin;
  }
  if (newFeePct !== undefined && newFeePct !== null && Number(newFeePct) !== Number(contract.managementFeePct)) {
    const p = Number(newFeePct);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('Commission de gestion invalide (0 à 100 %).');
    changes.newFeePct = p;
  }
  if (Object.keys(changes).length === 0) throw new Error("L'avenant ne contient aucune modification.");
  return changes;
}

module.exports = {
  MONITORING_LINE, LINE_LABELS, SECTION_OF, STATUS_LABELS, TRANSITIONS, RENEWAL_WINDOW_DAYS, DEFAULT_FEE_PCT,
  transitionTarget, isEditable, computeBudget, directTotal, grandTotal, monthlyCeiling, monthsBetween,
  normalizeBudgetItems, daysBetween, addDays, renewalWindowOpen, contractNumber, amendmentCode,
  displayReference, normalizeAmendment,
};
