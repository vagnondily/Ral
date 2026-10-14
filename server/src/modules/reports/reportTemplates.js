/**
 * Modèles de rapport SYSTÈME (préconfigurés, non modifiables : on les duplique
 * pour les adapter) — documents v2 (lot 7a). PUR. Construits sur les références
 * métier :
 * - « Rapport de suivi de performances » (synthèse par activité + une section
 *   par activité : scores par bureau, indicateurs, constats) ;
 * - bulletin mensuel ; situation budgétaire ; complétude ; distribution d'urgence.
 * Les identifiants de blocs sont stables (préfixe du modèle). Les tableaux larges
 * (domaines × activités, matrices mensuelles) sont placés dans une section paysage.
 */
const seg = (x, o = {}) => ({ x, ...o });
const v = (name) => ({ x: '', v: name });
const p = (...c) => ({ t: 'p', c });
const h3 = (text) => ({ t: 'h3', c: [seg(text)] });
const ul = (...items) => ({ t: 'ul', items: items.map((it) => (Array.isArray(it) ? it : [seg(it)])) });
const doc = (...nodes) => ({ nodes });

const STYLE = { font: 'Inter', size: 8, bold: false, italic: false, color: '#616a7a', align: 'left', padding: 0, radius: 0 };
const textEl = (id, text, { x = 0, w = 100, align = 'left' } = {}) => ({ id, kind: 'text', x, y: 4, w, h: 6, text, style: { ...STYLE, align } });
/** Mise en page : en-tête (texte avec variables), pied (texte + « Page n / N »), trait sous l'en-tête. */
const page = (header, { footer = 'Suivi & évaluation', orientation = 'portrait' } = {}) => ({
  size: 'A4', orientation, firstPage: 'same', draftWatermark: true,
  header: { height: 14, elements: [textEl('h-text', header), { id: 'h-line', kind: 'line', x: 0, y: 12, w: 100, h: 2, thickness: 0.5, color: '#e7e9ef' }] },
  footer: { height: 12, elements: [textEl('f-text', footer, { w: 66 }), { id: 'f-pageno', kind: 'pageNumber', x: 70, y: 4, w: 30, h: 6, format: 'Page n / N', style: { ...STYLE, align: 'right' } }] },
});

const heading = (id, text, level = 1) => ({ id, type: 'heading', params: { text, level } });
const text = (id, d) => ({ id, type: 'text', params: { doc: d, filters: {} } });
const callout = (id, tone, title, d) => ({ id, type: 'callout', params: { tone, title, doc: d, filters: {} } });
const kpis = (id, metrics) => ({ id, type: 'kpis', params: { metrics, filters: {} } });
const data = (id, dataset, view, title, extra = {}) => ({
  id, type: 'data', params: { dataset, view, figure: { title }, filters: {}, args: {}, palette: 'sober', ...extra },
});
const section = (id, orientation, title) => ({ id, type: 'section', params: { orientation, title, header: 'inherit', footer: 'inherit' } });

const PERF = 'perf';
const performance = {
  key: 'performances',
  name: 'Rapport de suivi de performances',
  description: 'Synthèse par activité (couverture, scores par domaine, constats, priorités) puis une section par activité : scores par bureau, indicateurs, point critique et points forts.',
  content: {
    page: page('Rapport de suivi de performances — {periode}'),
    filters: {},
    blocks: [
      heading(`${PERF}-h`, 'Rapport de suivi de performances des activités'),
      text(`${PERF}-intro`, doc(p(seg('Ce rapport couvre le suivi de processus des activités pour la période '), v('periode'), seg('. Tous les scores sont recalculés depuis les données de collecte (soumissions exclues au nettoyage écartées).')))),
      kpis(`${PERF}-kpis`, ['sites_realised', 'coverage', 'submissions', 'conformity']),
      data(`${PERF}-cov`, 'cov.by_activity', 'table', 'Couverture par activité'),
      section(`${PERF}-sl`, 'landscape', 'Synthèse par domaine'),
      data(`${PERF}-syn`, 'mon.domains_by_activity', 'heat', 'Synthèse par activité — scores par domaine'),
      section(`${PERF}-sp`, 'portrait', 'Priorités'),
      callout(`${PERF}-prio`, 'critical', 'Priorités transversales', doc(h3('① …'), p(seg('Décrivez la priorité, les sites et bureaux concernés, et l\'action attendue.')), h3('② …'), p(seg('…')), h3('③ …'), p(seg('…')))),
      { id: `${PERF}-rep`, type: 'repeat', params: { over: 'activity', blocks: [
        section(`${PERF}-r-s`, 'portrait', '{activite}'),
        heading(`${PERF}-r-h`, '{activite}'),
        kpis(`${PERF}-r-k`, ['sites_realised', 'coverage', 'submissions', 'conformity']),
        data(`${PERF}-r-b`, 'mon.domains_by_bureau', 'heat', 'Scores par domaine et par bureau'),
        data(`${PERF}-r-i`, 'mon.indicators', 'table', 'Indicateurs'),
        callout(`${PERF}-r-c`, 'warning', 'Point critique', doc(p(seg('…')))),
        callout(`${PERF}-r-f`, 'success', 'Points forts confirmés', doc(p(seg('…')))),
      ] } },
    ],
  },
};

const BUL = 'bul';
const bulletin = {
  key: 'bulletin',
  name: 'Bulletin mensuel de suivi',
  description: 'Chiffres clés, bulletin rédigé automatiquement (modifiable), couverture par bureau, plan et réalisé, couverture par activité.',
  content: {
    page: page('Bulletin de suivi — {periode}'),
    filters: {},
    blocks: [
      heading(`${BUL}-h`, 'Bulletin de suivi — {periode}'),
      kpis(`${BUL}-kpis`, ['sites_active', 'sites_realised', 'coverage', 'visits_realised', 'execution_rate', 'conformity']),
      { id: `${BUL}-auto`, type: 'bulletin', params: { filters: {} } },
      data(`${BUL}-bur`, 'cov.by_office', 'table', 'Couverture par bureau'),
      data(`${BUL}-pva`, 'cov.monthly', 'column', 'Plan et réalisé par mois'),
      data(`${BUL}-act`, 'cov.by_activity', 'table', 'Couverture par activité'),
      callout(`${BUL}-rec`, 'info', 'Recommandations', doc(ul('…', '…'))),
    ],
  },
};

const BUD = 'bud';
const budget = {
  key: 'budget',
  name: 'Situation budgétaire du suivi (TPM)',
  description: 'Budget de suivi, planifié et réalisé par contrat, consommation et restant.',
  content: {
    page: page('Situation budgétaire — {periode}', { orientation: 'landscape' }),
    filters: {},
    blocks: [
      heading(`${BUD}-h`, 'Situation budgétaire du suivi — {periode}'),
      kpis(`${BUD}-k`, ['budget_total', 'budget_actual', 'consumption']),
      data(`${BUD}-t`, 'bud.by_contract', 'table', 'Par contrat'),
      text(`${BUD}-c`, doc(h3('Commentaire'), p(seg('…')))),
    ],
  },
};

const COMP = 'cmp';
const completeness = {
  key: 'completude',
  name: 'Complétude et couverture terrain',
  description: 'Complétude mensuelle par activité (sites inspectés ÷ sites cibles), plan et réalisé, données versées par région.',
  content: {
    page: page('Complétude du suivi — {periode}', { orientation: 'landscape' }),
    filters: {},
    blocks: [
      heading(`${COMP}-h`, 'Complétude du suivi — {periode}'),
      data(`${COMP}-m`, 'cov.completeness_monthly', 'heat', 'Matrice de complétude mensuelle par activité'),
      data(`${COMP}-l`, 'cov.completeness_monthly', 'line', 'Tendance mensuelle du taux de complétude'),
      data(`${COMP}-p`, 'cov.monthly', 'table', 'Plan et réalisé par mois'),
      data(`${COMP}-r`, 'mon.by_region', 'table', 'Données versées par région'),
    ],
  },
};

const PDD = 'pdd';
const pdd = {
  key: 'pdd',
  name: 'Distribution d\'urgence',
  description: 'Bénéficiaires, ménages, vivres et cash distribués par mois.',
  content: {
    page: page('Distribution d\'urgence — {periode}'),
    filters: {},
    blocks: [
      heading(`${PDD}-h`, 'Distribution d\'urgence — {periode}'),
      kpis(`${PDD}-k`, ['pdd_beneficiaries', 'pdd_food', 'pdd_cash']),
      data(`${PDD}-c`, 'pdd.by_month', 'column', 'Bénéficiaires par mois', { measure: 'beneficiaries' }),
      data(`${PDD}-t`, 'pdd.by_month', 'table', 'Détail mensuel'),
    ],
  },
};

const SYSTEM_TEMPLATES = [performance, bulletin, budget, completeness, pdd];

/** Document v2 complet d'un modèle (titre et période fournis). */
const templateDocument = (tpl, period, title = tpl.name) => ({ schemaVersion: 2, title, period, ...JSON.parse(JSON.stringify(tpl.content)) });

module.exports = { SYSTEM_TEMPLATES, templateDocument };
