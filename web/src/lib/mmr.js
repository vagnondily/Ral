/**
 * MMR — logique d'affichage de la grille (miroir de
 * server/src/modules/tpm/mmrMath.js, qui reste la RÉFÉRENCE et est testé ;
 * le serveur recalcule tout à la relecture). Pur, sans I/O.
 */
export const round2 = (n) => Math.round(n * 100) / 100;

export const INPUT_FIELDS = ['operationDuration', 'numberOfSites', 'riskLevel', 'personsToDeploy', 'visitsPerDay', 'workingDays', 'feasible', 'note'];

export function deriveMmr({ operationDuration, numberOfSites, riskLevel, feasible, personsToDeploy, visitsPerDay, workingDays } = {}) {
  const dur = Number(operationDuration) || 0;
  const sites = Number(numberOfSites) || 0;
  const risk = Number(riskLevel) || 0;
  const manualFeas = feasible == null || feasible === '' ? null : Number(feasible);
  const persons = Number(personsToDeploy) || 0;
  const perDay = Number(visitsPerDay) || 0;
  const days = Number(workingDays) || 0;
  const computedCapacity = (persons > 0 && perDay > 0 && days > 0) ? round2(persons * perDay * days) : null;
  const feas = computedCapacity != null ? computedCapacity : manualFeas;
  const interval = risk > 0 ? round2(dur / risk) : null;
  const frequency = interval > 0 ? round2(dur / interval) : 0;
  const targetedPerMonth = interval > 0 ? round2(sites / interval) : null;
  const coverageRatio = (feas != null && targetedPerMonth > 0) ? round2(feas / targetedPerMonth) : null;
  const adjFreqExact = coverageRatio != null ? (dur / (dur / risk)) * (feas / (sites / (dur / risk))) : null;
  return {
    interval, frequency, targetedPerMonth, computedCapacity, feasibleEffective: feas,
    feasibleSource: computedCapacity != null ? 'calculée' : (manualFeas != null ? 'saisie' : null),
    coverageRatio,
    adjustedFrequency: adjFreqExact != null ? round2(adjFreqExact) : null,
    adjustedInterval: adjFreqExact > 0 ? round2(Math.max(dur / adjFreqExact, 1)) : null,
  };
}

export const normCat = (s) => String(s || '').trim().toLowerCase();

/** Vue d'un périmètre (plan général ou bureau) : héritage + dérogations. */
export function resolvePlan(rows, officeId) {
  const general = new Map(); const overrides = new Map();
  for (const r of rows) {
    if (!r.fieldOfficeId) general.set(normCat(r.activityCategory), r);
    else if (officeId && r.fieldOfficeId === officeId) overrides.set(normCat(r.activityCategory), r);
  }
  const keys = [...new Set([...general.keys(), ...overrides.keys()])];
  return keys.map((k) => {
    const g = general.get(k) || null; const o = officeId ? overrides.get(k) || null : null;
    const src = o || g;
    return { key: k, activityCategory: src.activityCategory, general: g, override: o, row: src, inherited: Boolean(officeId && !o), derived: deriveMmr(src) };
  }).sort((a, b) => a.activityCategory.localeCompare(b.activityCategory, 'fr'));
}

export function summarizePlan(plan) {
  let sites = 0; let targeted = 0; let feasible = 0; let targetedWithCap = 0;
  for (const p of plan) {
    sites += Number(p.row.numberOfSites) || 0;
    targeted += p.derived.targetedPerMonth || 0;
    if (p.derived.feasibleEffective != null) { feasible += p.derived.feasibleEffective; targetedWithCap += p.derived.targetedPerMonth || 0; }
  }
  return {
    categories: plan.length, overrides: plan.filter((p) => p.override).length, sites,
    targetedPerMonth: round2(targeted), feasible: round2(feasible),
    coverageRatio: targetedWithCap > 0 ? round2(feasible / targetedWithCap) : null,
  };
}

/** Sites du référentiel par catégorie ; un site d'antenne compte pour son bureau parent. */
export function registryCounts(registry, officeId) {
  const out = new Map();
  for (const r of registry || []) {
    if (!r.activity) continue;
    if (officeId && r.officeId !== officeId && r.parentId !== officeId) continue;
    const k = normCat(r.activity);
    out.set(k, (out.get(k) || 0) + Number(r.n || 0));
  }
  return out;
}

// Règles de saisie (mêmes bornes que le zod du serveur). Renvoie un message ou null.
const intIn = (v, min, max, { optional = false } = {}) => {
  if (v === '' || v == null) return optional ? null : 'Obligatoire';
  const n = Number(v);
  if (!Number.isInteger(n)) return 'Entier attendu';
  if (n < min || (max != null && n > max)) return max != null ? `Entre ${min} et ${max}` : `≥ ${min}`;
  return null;
};
export const FIELD_RULES = {
  operationDuration: (v) => intIn(v, 0, 12),
  numberOfSites: (v) => intIn(v, 0, 100000),
  riskLevel: (v) => intIn(v, 1, 3),
  personsToDeploy: (v) => intIn(v, 0, 100000, { optional: true }),
  visitsPerDay: (v) => (v === '' || v == null ? null : (Number(v) >= 0 && Number(v) <= 1000 ? null : 'Entre 0 et 1000')),
  workingDays: (v) => intIn(v, 0, 31, { optional: true }),
  feasible: (v) => intIn(v, 0, 100000, { optional: true }),
  note: (v) => (String(v || '').length > 200 ? '200 caractères max' : null),
};
export function rowErrors(row) {
  const errs = {};
  const cat = String(row.activityCategory || '').trim();
  if (!cat) errs.activityCategory = 'Obligatoire';
  else if (cat.length > 160) errs.activityCategory = '160 caractères max';
  for (const [k, rule] of Object.entries(FIELD_RULES)) { const e = rule(row[k]); if (e) errs[k] = e; }
  return errs;
}

/** Corps de l'API /mmr/bulk à partir d'une ligne de travail. */
export function toPayload(r) {
  const n = (v) => (v === '' || v == null ? null : Number(v));
  return {
    ...(r.id ? { id: r.id } : {}),
    fieldOfficeId: r.fieldOfficeId || null,
    activityCategory: String(r.activityCategory).trim(),
    operationDuration: Number(r.operationDuration), numberOfSites: Number(r.numberOfSites), riskLevel: Number(r.riskLevel),
    personsToDeploy: n(r.personsToDeploy), visitsPerDay: n(r.visitsPerDay), workingDays: n(r.workingDays), feasible: n(r.feasible),
    note: r.note ? String(r.note).trim() : undefined,
  };
}

/** Une ligne de travail diffère-t-elle de sa version enregistrée ? */
export function isChanged(r, orig) {
  if (!orig) return true;
  if (normCat(r.activityCategory) !== normCat(orig.activityCategory) || String(r.activityCategory).trim() !== orig.activityCategory) return true;
  return INPUT_FIELDS.some((k) => String(r[k] ?? '') !== String(orig[k] ?? ''));
}
