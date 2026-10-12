/**
 * Modèles de rapport SYSTÈME (préconfigurés, non modifiables : on les duplique
 * pour les adapter). PUR. Construits sur les références métier :
 * - « Rapport de suivi de performances » (synthèse par activité + une section
 *   par activité : scores par bureau, indicateurs, constats) ;
 * - bulletin mensuel ; situation budgétaire ; complétude ; distribution d'urgence.
 * Les identifiants de blocs sont stables (préfixe du modèle).
 */
const seg = (x, o = {}) => ({ x, ...o });
const v = (name) => ({ x: '', v: name });
const p = (...c) => ({ t: 'p', c });
const h3 = (text) => ({ t: 'h3', c: [seg(text)] });
const ul = (...items) => ({ t: 'ul', items: items.map((it) => (Array.isArray(it) ? it : [seg(it)])) });
const doc = (...nodes) => ({ nodes });

const PERF = 'perf';
const performance = {
  key: 'performances',
  name: 'Rapport de suivi de performances',
  description: 'Synthèse par activité (couverture, scores par domaine, constats, priorités) puis une section par activité : scores par bureau, indicateurs, point critique et points forts.',
  page: { orientation: 'portrait', header: 'Rapport de suivi de performances — {periode}', footer: 'Suivi & évaluation', showPageNumbers: true },
  blocks: [
    { id: `${PERF}-h`, type: 'heading', params: { text: 'Rapport de suivi de performances des activités', level: 1 } },
    { id: `${PERF}-intro`, type: 'text', params: { doc: doc(p(seg('Ce rapport couvre le suivi de processus des activités pour la période '), v('periode'), seg('. Tous les scores sont recalculés depuis les données de collecte (soumissions exclues au nettoyage écartées).'))) } },
    { id: `${PERF}-kpis`, type: 'kpis', params: { metrics: ['sites_visited', 'coverage', 'submissions', 'conformity'], filters: {} } },
    { id: `${PERF}-syn`, type: 'table', params: { title: 'Synthèse par activité — scores par domaine', dataset: 'activity_domains', filters: {} } },
    { id: `${PERF}-cov`, type: 'table', params: { title: 'Couverture par activité', dataset: 'activity_coverage', filters: {} } },
    { id: `${PERF}-prio`, type: 'callout', params: { tone: 'critical', title: 'Priorités transversales', doc: doc(h3('① …'), p(seg('Décrivez la priorité, les sites et bureaux concernés, et l\'action attendue.')), h3('② …'), p(seg('…')), h3('③ …'), p(seg('…'))) } },
    { id: `${PERF}-pb`, type: 'pagebreak', params: {} },
    { id: `${PERF}-rep`, type: 'repeat', params: { over: 'activity', blocks: [
      { id: `${PERF}-r-h`, type: 'heading', params: { text: '{activite}', level: 1 } },
      { id: `${PERF}-r-k`, type: 'kpis', params: { metrics: ['sites_visited', 'coverage', 'submissions', 'conformity'], filters: {} } },
      { id: `${PERF}-r-b`, type: 'table', params: { title: 'Scores par domaine et par bureau', dataset: 'bureau_domains', filters: {} } },
      { id: `${PERF}-r-i`, type: 'table', params: { title: 'Indicateurs', dataset: 'indicator_list', filters: {} } },
      { id: `${PERF}-r-c`, type: 'callout', params: { tone: 'warning', title: 'Point critique', doc: doc(p(seg('…'))) } },
      { id: `${PERF}-r-f`, type: 'callout', params: { tone: 'success', title: 'Points forts confirmés', doc: doc(p(seg('…'))) } },
      { id: `${PERF}-r-pb`, type: 'pagebreak', params: {} },
    ] } },
  ],
};

const BUL = 'bul';
const bulletin = {
  key: 'bulletin',
  name: 'Bulletin mensuel de suivi',
  description: 'Chiffres clés, bulletin rédigé automatiquement (modifiable), couverture par bureau, plan et réalisé, couverture par activité.',
  page: { orientation: 'portrait', header: 'Bulletin de suivi — {periode}', footer: 'Suivi & évaluation', showPageNumbers: true },
  blocks: [
    { id: `${BUL}-h`, type: 'heading', params: { text: 'Bulletin de suivi — {periode}', level: 1 } },
    { id: `${BUL}-kpis`, type: 'kpis', params: { metrics: ['sites_active', 'sites_visited', 'coverage', 'visits_done', 'execution_rate', 'conformity'], filters: {} } },
    { id: `${BUL}-auto`, type: 'bulletin', params: { filters: {} } },
    { id: `${BUL}-bur`, type: 'table', params: { title: 'Couverture par bureau', dataset: 'bureau_coverage', filters: {} } },
    { id: `${BUL}-pva`, type: 'chart', params: { title: 'Plan et réalisé par mois', dataset: 'plan_vs_actual', kind: 'bar', filters: {} } },
    { id: `${BUL}-act`, type: 'table', params: { title: 'Couverture par activité', dataset: 'activity_coverage', filters: {} } },
    { id: `${BUL}-rec`, type: 'callout', params: { tone: 'info', title: 'Recommandations', doc: doc(ul('…', '…')) } },
  ],
};

const BUD = 'bud';
const budget = {
  key: 'budget',
  name: 'Situation budgétaire du suivi (TPM)',
  description: 'Budget de suivi, planifié et réalisé par contrat, consommation et restant.',
  page: { orientation: 'landscape', header: 'Situation budgétaire — {periode}', showPageNumbers: true },
  blocks: [
    { id: `${BUD}-h`, type: 'heading', params: { text: 'Situation budgétaire du suivi — {periode}', level: 1 } },
    { id: `${BUD}-k`, type: 'kpis', params: { metrics: ['budget_total', 'budget_actual', 'consumption'], filters: {} } },
    { id: `${BUD}-t`, type: 'table', params: { title: 'Par contrat', dataset: 'budget_contracts', filters: {} } },
    { id: `${BUD}-c`, type: 'text', params: { doc: doc(h3('Commentaire'), p(seg('…'))) } },
  ],
};

const COMP = 'cmp';
const completeness = {
  key: 'completude',
  name: 'Complétude et couverture terrain',
  description: 'Complétude mensuelle par activité (sites inspectés ÷ sites cibles), plan et réalisé, données versées par région.',
  page: { orientation: 'landscape', header: 'Complétude du suivi — {periode}', showPageNumbers: true },
  blocks: [
    { id: `${COMP}-h`, type: 'heading', params: { text: 'Complétude du suivi — {periode}', level: 1 } },
    { id: `${COMP}-m`, type: 'chart', params: { title: 'Matrice de complétude mensuelle par activité', dataset: 'completeness_monthly', kind: 'matrix', filters: {} } },
    { id: `${COMP}-l`, type: 'chart', params: { title: 'Tendance mensuelle du taux de complétude', dataset: 'completeness_monthly', kind: 'line', filters: {} } },
    { id: `${COMP}-p`, type: 'table', params: { title: 'Plan et réalisé par mois', dataset: 'plan_vs_actual', filters: {} } },
    { id: `${COMP}-r`, type: 'table', params: { title: 'Données versées par région', dataset: 'region_submissions', filters: {} } },
  ],
};

const PDD = 'pdd';
const pdd = {
  key: 'pdd',
  name: 'Distribution d\'urgence',
  description: 'Bénéficiaires, ménages, vivres et cash distribués par mois.',
  page: { orientation: 'portrait', header: 'Distribution d\'urgence — {periode}', showPageNumbers: true },
  blocks: [
    { id: `${PDD}-h`, type: 'heading', params: { text: 'Distribution d\'urgence — {periode}', level: 1 } },
    { id: `${PDD}-k`, type: 'kpis', params: { metrics: ['pdd_beneficiaries', 'pdd_food', 'pdd_cash'], filters: {} } },
    { id: `${PDD}-c`, type: 'chart', params: { title: 'Bénéficiaires par mois', dataset: 'pdd_by_month', kind: 'bar', metric: 'beneficiaries', filters: {} } },
    { id: `${PDD}-t`, type: 'table', params: { title: 'Détail mensuel', dataset: 'pdd_by_month', filters: {} } },
  ],
};

const SYSTEM_TEMPLATES = [performance, bulletin, budget, completeness, pdd];

module.exports = { SYSTEM_TEMPLATES };
