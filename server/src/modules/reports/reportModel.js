const { periodLabel } = require('../common/period');
const { upgradeDoc } = require('./reportUpgrade');
const { parseDocV2, safeParseDocV2, schemas } = require('./reportSchema');

/**
 * Concepteur de rapport — FAÇADE du modèle (lot 7a) : un rapport est un document v2
 * (reportSchema) ; un document v1 (avant le lot 7a) est mis à niveau à la lecture
 * (reportUpgrade). Le texte riche est stocké en JSON structuré, JAMAIS en HTML : le
 * rendu se fait en éléments React, donc aucune injection de script n'est possible.
 */

/**
 * Tables des 10 jeux de données v1 : colonnes des mises en forme reportData (pont
 * provisoire du catalogue v2, catalog/legacy.js — remplacé en C4 / C5).
 */
const DATASETS = {
  activity_coverage: {
    label: 'Couverture et score par activité', scope: 'all',
    columns: [['activity', 'Activité', 'text'], ['visits', 'Visites', 'int'], ['sitesVisited', 'Sites visités', 'int'],
      ['sitesActive', 'Sites actifs', 'int'], ['coverage', 'Couverture', 'pct'], ['score', 'Score global', 'pct']],
  },
  activity_domains: {
    label: 'Scores par domaine et par activité', scope: 'all', dynamicColumns: 'domains',
    columns: [['activity', 'Activité', 'text'], ['score', 'Score global', 'pct']],
  },
  bureau_domains: {
    label: 'Scores par domaine et par bureau', scope: 'form', dynamicColumns: 'domains',
    columns: [['bureau', 'Bureau', 'text'], ['n', 'N', 'int'], ['score', 'Moyenne', 'pct']],
  },
  indicator_list: {
    label: 'Indicateurs (valeur, base, cible)', scope: 'form',
    columns: [['label', 'Indicateur', 'text'], ['module', 'Domaine', 'text'], ['value', 'Valeur', 'pct'],
      ['base', 'n', 'int'], ['target', 'Cible', 'pct'], ['band', 'Appréciation', 'band']],
  },
  bureau_coverage: {
    label: 'Couverture par bureau', scope: 'all',
    columns: [['bureau', 'Bureau', 'text'], ['sitesActive', 'Sites actifs', 'int'], ['planned', 'Visites planifiées', 'int'],
      ['done', 'Visites réalisées', 'int'], ['rate', 'Taux de réalisation', 'pct']],
  },
  plan_vs_actual: {
    label: 'Plan et réalisé par mois', scope: 'all',
    columns: [['month', 'Mois', 'month'], ['planned', 'Planifiées', 'int'], ['done', 'Réalisées', 'int'], ['rate', 'Taux', 'pct']],
  },
  completeness_monthly: {
    label: 'Complétude mensuelle par activité', scope: 'all', dynamicColumns: 'months',
    columns: [['activity', 'Activité', 'text'], ['target', 'Sites cibles', 'int']],
  },
  region_submissions: {
    label: 'Données versées par région', scope: 'all',
    columns: [['region', 'Région', 'text'], ['submissions', 'Soumissions', 'int'], ['communes', 'Communes', 'int']],
  },
  budget_contracts: {
    label: 'Situation budgétaire par contrat', scope: 'all',
    columns: [['contract', 'Contrat', 'text'], ['partner', 'Partenaire', 'text'], ['budget', 'Budget', 'money'],
      ['planned', 'Planifié', 'money'], ['actual', 'Réalisé', 'money'], ['rate', 'Consommation', 'pct'], ['remaining', 'Restant', 'money']],
  },
  pdd_by_month: {
    label: 'Distributions d\'urgence par mois', scope: 'all',
    columns: [['month', 'Mois', 'month'], ['beneficiaries', 'Bénéficiaires', 'int'], ['households', 'Ménages', 'int'],
      ['food', 'Vivres (t)', 'dec'], ['cash', 'Cash (USD)', 'money']],
  },
};

/**
 * Variables simples des textes, titres, en-têtes et pieds : remplies par le serveur
 * ({page} et {pages} par la pagination). Les chiffres clés du catalogue sont aussi des
 * variables des textes riches.
 */
const VARIABLES = {
  titre: 'Titre du rapport', periode: 'Période du rapport', date_edition: 'Date d\'édition',
  bureau: 'Bureau (section répétée)', activite: 'Activité (section répétée)', partenaire: 'Partenaire (section répétée)',
  statut: 'Statut du rapport', version: 'Version', valide_par: 'Validé par', valide_le: 'Validé le',
  section: 'Titre de la section', page: 'Numéro de page', pages: 'Nombre de pages',
};

/** Document (v1 ou v2) → v2 validé et normalisé ; lève une ZodError lisible. */
const parseReport = (input, ctx) => parseDocV2(upgradeDoc(input, ctx).doc);
const safeParseReport = (input, ctx) => safeParseDocV2(upgradeDoc(input, ctx).doc);

module.exports = { DATASETS, VARIABLES, parseReport, safeParseReport, periodLabel, schemas };
