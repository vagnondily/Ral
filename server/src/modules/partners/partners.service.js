const repo = require('./partners.repository');
const consolidationRepo = require('../tpm/consolidation.repository');
const activeRepo = require('../tpm/activeProvider.repository');
const { buildSheet, contractRows, providerListRows, expectedCountsOf } = require('./partnerSheet');
const reportsRepo = require('../tpm/reports.repository');
const { addMonths } = require('../common/period');
const { monthsOf } = require('../tpm/activeProvider');

/**
 * Fiche prestataire 360° (lot 8, retour 28.1) — règles d'assemblage. Les routes appellent ce
 * service ; le dépôt lit, les modules purs (partnerSheet, activeProvider) décident.
 */

/** Consolidation du compte (contrats de suivi actifs), indexée par contrat : même Réalisé, même projection. */
async function consolidationByContract(tenantId, month) {
  const cons = await consolidationRepo.consolidation(tenantId, { today: month });
  return new Map((cons.rows || []).map((r) => [r.contractId, r]));
}

/** Liste des partenaires avec leur statut selon contrat (liste des prestataires TPM). */
async function providers(tenantId) {
  const { rows, links, contracts, views } = await repo.providersList(tenantId);
  return providerListRows(rows, links, { contracts, views });
}

async function sheet(tenantId, id) {
  const raw = await repo.sheet(tenantId, id);
  if (!raw) return null;
  // Factures attendues / en retard : les rapports attendus des 12 derniers mois (même source que la carte
  // « Rapports attendus » et les alertes ; relecture croisée, point 4).
  const month = raw.counts.month;
  const expected = await reportsRepo.expectedReports(tenantId, { period: { from: addMonths(month, -11), to: month }, today: month });
  // Même périmètre que les documents de la fiche : ses factures comme TPM et celles des contrats qu'il tient.
  const held = (raw.contracts || []).filter((c) => c.holderId === id).map((c) => c.id);
  return buildSheet(raw, { consolidation: await consolidationByContract(tenantId, month), expected: expectedCountsOf(expected, id, held) });
}

async function contracts(tenantId, id) {
  const raw = await repo.contractsOf(tenantId, id);
  if (!raw) return null;
  const month = raw.today.slice(0, 7);
  return contractRows(raw.contracts, raw.links, {
    partnerId: id, month, consolidation: await consolidationByContract(tenantId, month), tpmViews: raw.tpmViews, partnerTypes: raw.partnerTypes,
  });
}

/** Période par défaut des suivis : les 12 derniers mois jusqu'au mois courant. */
function defaultFollowupPeriod(todayMonth) {
  return { from: addMonths(todayMonth, -11), to: todayMonth };
}

async function followups(tenantId, id, period, todayMonth) {
  const p = period || defaultFollowupPeriod(todayMonth);
  const r = await repo.followups(tenantId, id, p);
  return r && { period: p, months: monthsOf(p.from, p.to), ...r };
}

/** Listes de choix des prestataires pour des mois (retour 30) : groupes « contrat » puis « tpm ». */
async function selectable(tenantId, period) {
  return activeRepo.selectable(tenantId, monthsOf(period.from, period.to));
}

module.exports = {
  providers, sheet, contracts, followups, selectable, defaultFollowupPeriod,
  reports: repo.reportsOf, plans: repo.plansOf, timeline: repo.timeline,
};
