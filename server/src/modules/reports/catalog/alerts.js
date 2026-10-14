const { col } = require('./facts');

/**
 * Jeux de données « Alertes », « Carte » et « Qualité des données » (lot 7a, C5) —
 * déclarations PURES.
 *  - alerts : LA source de la cloche et du Centre d'alertes (alerts.service), lue avec un
 *    lecteur neutre ; mêmes niveaux et messages (phrases à paramètres, traduites à l'affichage) ;
 *  - health / linking : état de la configuration (Paramétrage › État de la configuration) ;
 *  - carte : disponible avec le lot 6a (contours des districts) — déclarée, jamais calculée ici.
 */
const ORIGIN_AL = { page: 'Alertes › Centre d\'alertes', route: '#/alertes/centre' };
const ORIGIN_HEALTH = { page: 'Paramétrage › État de la configuration', route: '#/parametrage/etat' };
const now = { filters: [], officeKinds: [], periodMode: 'now' };

const LIST_COLS = [col('level', 'Niveau', 'status'), col('category', 'Domaine', 'message'), col('title', 'Alerte', 'message'), col('detail', 'Détail', 'message')];
const list = {
  key: 'alerts.list', label: 'Alertes (niveau, domaine, message)', group: 'alerts', origin: ORIGIN_AL, source: 'alerts', ...now,
  views: ['list', 'table'], defaultView: 'list', columns: LIST_COLS,
  shape(raw) {
    const rows = ((raw && raw.items) || []).map((a, i) => ({
      _key: `${a.kind}|${i}`, level: a.sev, category: { text: a.cat, params: {} }, title: { text: a.title, params: a.params || {} },
      detail: a.detail ? { text: a.detail, params: a.params || {} } : null,
    }));
    return { columns: LIST_COLS, rows, meta: { n: rows.length, nLabel: 'alertes', asOf: raw && raw.today, unavailable: (raw && raw.unavailable) || [] } };
  },
};

const COUNT_COLS = [col('critical', 'Critiques', 'int'), col('warning', 'À surveiller', 'int'), col('info', 'À traiter', 'int'), col('total', 'Total', 'int')];
const counts = {
  key: 'alerts.counts', label: 'Nombre d\'alertes par niveau', group: 'alerts', origin: ORIGIN_AL, source: 'alerts', ...now,
  views: ['kpi', 'table'], defaultView: 'kpi', columns: COUNT_COLS,
  shape(raw) {
    const c = (raw && raw.counts) || { critical: 0, warning: 0, info: 0, total: 0 };
    return { columns: COUNT_COLS, rows: [{ _key: 'counts', critical: c.critical, warning: c.warning, info: c.info, total: c.total }], meta: { n: c.total, nLabel: 'alertes', asOf: raw && raw.today } };
  },
};

const MAP_REASON = 'Disponible avec le lot 6a';
const mapCols = [col('district', 'District'), col('value', 'Valeur', 'dec')];
const mapDistricts = {
  key: 'map.districts', label: 'Carte des districts (couverture, risque, données)', group: 'map', source: 'covFacts', filters: ['office', 'activity'],
  periodMode: 'range', views: ['map', 'table'], defaultView: 'map', columns: mapCols, available: false, reason: MAP_REASON,
};
const mapPoints = {
  key: 'map.points', label: 'Carte des sites et points de collecte', group: 'map', source: 'covFacts', filters: ['office'],
  periodMode: 'range', views: ['map', 'table'], defaultView: 'map', columns: [col('site', 'Site'), col('lat', 'Latitude', 'dec'), col('lng', 'Longitude', 'dec')], available: false, reason: MAP_REASON,
};

const HEALTH_COLS = [col('status', 'État', 'status'), col('message', 'Constat', 'message'), col('count', 'Nombre', 'int'), col('total', 'Sur', 'int')];
const health = {
  key: 'quality.health', label: 'État de la configuration (règles)', group: 'quality', origin: ORIGIN_HEALTH, source: 'health', ...now,
  views: ['table', 'list'], defaultView: 'table', columns: HEALTH_COLS,
  shape(raw) {
    const order = { bloquant: 0, a_completer: 1, non_mesurable: 2, pret: 3 };
    const rows = ((raw && raw.rules) || []).map((r) => ({ _key: r.code, status: r.status, message: r.message, count: r.count, total: r.total }))
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    return { columns: HEALTH_COLS, rows, meta: { n: rows.length, nLabel: 'règles' } };
  },
};

const LINK_COLS = [col('item', 'Liaison', 'message'), col('count', 'À rattacher', 'int'), col('total', 'Sur', 'int'), col('share', 'Part', 'pct')];
const linking = {
  key: 'quality.linking', label: 'Liaisons à compléter (sites, bureaux, soumissions)', group: 'quality', origin: ORIGIN_HEALTH, source: 'linking', ...now,
  views: ['table', 'bar'], defaultView: 'table', columns: LINK_COLS, measures: ['count'],
  shape(raw) {
    const c = raw || {};
    const s = c.sites || {}; const sub = c.submissions || {}; const q = c.queue || {};
    const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
    const m = (text) => ({ text, params: {} });
    const rows = [
      { _key: 'sites_pcode', item: m('Sites sans code officiel de commune'), count: s.withoutPcode || 0, total: s.total || 0, share: pct(s.withoutPcode || 0, s.total) },
      { _key: 'sites_office', item: m('Sites sans bureau'), count: s.withoutOffice || 0, total: s.total || 0, share: pct(s.withoutOffice || 0, s.total) },
      { _key: 'subs_office', item: m('Soumissions sans bureau MEMS relié'), count: sub.withoutOffice || 0, total: sub.total || 0, share: pct(sub.withoutOffice || 0, sub.total) },
      { _key: 'subs_commune', item: m('Soumissions du dernier mois sans commune reliée'), count: sub.monthWithoutCommune || 0, total: sub.monthTotal || 0, share: pct(sub.monthWithoutCommune || 0, sub.monthTotal) },
      { _key: 'queue', item: m('Lieux en attente de rattachement'), count: q.entries || 0, total: null, share: null },
      { _key: 'offices', item: m('Bureaux sans périmètre'), count: c.officesWithoutPerimeter || 0, total: null, share: null },
    ];
    return { columns: LINK_COLS, rows, meta: { n: s.total || 0, nLabel: 'sites' } };
  },
};

module.exports = [list, counts, mapDistricts, mapPoints, health, linking];
