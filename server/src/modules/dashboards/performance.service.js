const repo = require('./performance.repository');
const { shapePerformance, trendRows, trendDelta, agentRows, activityKeyOf } = require('./performanceMath');
const { CATALOG } = require('../monitoring/indicatorTemplates');
const { trendWindow, monthsOf, periodInfo } = require('../common/period');

/**
 * Tableau de bord « Couverture & performance du suivi » — règles de l'API. Le compte vient
 * TOUJOURS de req.auth (passé par le contrôleur), jamais de la requête. Les calculs sont dans
 * performanceMath (pur) ; le dépôt ne fait que lire.
 */

const currentMonth = () => new Date().toISOString().slice(0, 7);
/** Activité demandée : catégorie, ou '' pour les fiches sans activité. */
const activityArg = ({ activity, none }) => (none ? '' : String(activity));

/** Activités et vue d'ensemble de la période (bureau facultatif, avec ses antennes). */
async function performance(auth, { period, officeId = null }) {
  const raw = await repo.performanceFacts(auth.tenantId, { period, officeId, group: 'bureau_month', visitsKeep: 15, registry: true });
  return {
    period: periodInfo(period),
    officeId: officeId || null,
    ...shapePerformance({ forms: raw.forms, registry: raw.registry, templates: CATALOG.activities }),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Tendance mensuelle d'UNE activité sur la fenêtre des tendances (au moins 12 mois finissant
 * au dernier mois de la période, mois vides compris) : indice, visites, score moyen.
 */
async function trend(auth, { period, officeId = null, activity, none = false }) {
  const window = trendWindow(period, currentMonth());
  const act = activityArg({ activity, none });
  const raw = await repo.performanceFacts(auth.tenantId, { period: window, officeId, activity: act, group: 'month', visitsKeep: 1 });
  // Activité sans fiche : mois vides (l'écran dit « aucune fiche rattachée »), jamais une erreur.
  const months = trendRows(raw.forms, monthsOf(window));
  return { activity: activityKeyOf(act), forms: raw.forms.length, window: periodInfo(window), months, delta: trendDelta(months) };
}

/** Qualité de saisie par agent d'UNE activité, sur la période. */
async function agents(auth, { period, officeId = null, activity, none = false }) {
  const act = activityArg({ activity, none });
  const raw = await repo.performanceFacts(auth.tenantId, { period, officeId, activity: act, group: 'agent', visitsKeep: 1 });
  return { activity: activityKeyOf(act), forms: raw.forms.length, period: periodInfo(period), ...agentRows(raw.forms, raw.agentNames || new Map()) };
}

module.exports = { performance, trend, agents };
