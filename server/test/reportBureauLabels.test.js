/**
 * Concepteur de rapport — libellés de bureau construits par le serveur, SANS
 * base : un faux client joue les requêtes de reportMonitoringData et de
 * reportFieldData. On vérifie :
 *   - la langue du rapport (« Code 7 (not linked) » en anglais, plus de texte
 *     figé en français) ;
 *   - un tableau qui ne porte que sur UNE fiche (bureau_domains) n'ajoute plus
 *     le nom (long) de la fiche ; la section répétée par bureau, qui mêle les
 *     fiches, le garde (le 7 d'une fiche n'est pas le 7 d'une autre).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const T = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';
const LONG = 'Suivi de la distribution générale — fiche de supervision post-distribution (version 3)';
const calls = [];

db.withTenantTransaction = async (tenantId, fn) => fn({
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params });
    if (/FROM monitoring_forms f WHERE f\.tenant_id = \$1 AND f\.active = true/.test(s)) {
      return { rows: [{ id: FORM, code: 'GD', label: LONG, activityCategory: null, sitesActive: 0 }] };
    }
    if (/AS "bureauKey"/.test(s)) {
      return { rows: [
        { data: {}, bureauKey: `code:${FORM}:7`, bureauStatus: 'non_relie', bureauName: null, bureauCode: '7', sitekey: 's1' },
        { data: {}, bureauKey: `code:${FORM}:7`, bureauStatus: 'non_relie', bureauName: null, bureauCode: '7', sitekey: 's2' },
        { data: {}, bureauKey: 'id:o1', bureauStatus: 'relie', bureauName: 'Antenne Bekily', bureauCode: '3', sitekey: 's3' },
      ] };
    }
    if (/count\(\*\)::int AS visits/.test(s)) return { rows: [{ visits: 3, sitesVisited: 3 }] };
    if (/SELECT count\(\*\)::int AS submissions FROM monitoring_submissions/.test(s)) return { rows: [{ submissions: 3 }] };
    if (/COALESCE\(par\.name, o\.name, \$4::text\) AS bureau/.test(s)) {
      // Sites sans bureau : le libellé vient du paramètre $4 (langue du rapport), jamais d'un texte figé.
      return { rows: [{ bureau: params[3], sitesActive: 2, planned: 0, done: 0, sitesVisited: 0 }] };
    }
    return { rows: [] };
  },
});

// Après le remplacement (withTenantTransaction est déstructuré au chargement des dépôts).
const monitoringRepo = require('../src/modules/monitoring/monitoring.repository');
const fieldRepo = require('../src/modules/tpm/field.repository');
const service = require('../src/modules/reports/reports.service');
const { buildDataset, repeatItems } = require('../src/modules/reports/reportData');

const PERIOD = { from: '2026-01', to: '2026-03' };

test('bureau non relié dans la langue du rapport ; identité avec la fiche, libellé court sans', async () => {
  const en = await monitoringRepo.reportMonitoringData(T, PERIOD, { lang: 'en' });
  const code7 = en.forms[0].bureaux.find((b) => b.bureauKey === `code:${FORM}:7`);
  assert.equal(code7.bureau, `Code 7 (not linked) · ${LONG}`);
  assert.equal(code7.label, 'Code 7 (not linked)');
  assert.equal(code7.n, 2);
  const linked = en.forms[0].bureaux.find((b) => b.bureauKey === 'id:o1');
  assert.equal(linked.bureau, 'Antenne Bekily'); // un nom n'est jamais traduit
  assert.equal(linked.label, 'Antenne Bekily');

  const fr = await monitoringRepo.reportMonitoringData(T, PERIOD); // français par défaut
  assert.equal(fr.forms[0].bureaux[0].label, 'Code 7 (non relié)');
  assert.equal(fr.forms[0].bureaux[0].bureau, `Code 7 (non relié) · ${LONG}`);
});

test('bureau_domains (une seule fiche) : le bureau sans le nom de la fiche ; filtre par identité inchangé', async () => {
  const monitoring = await monitoringRepo.reportMonitoringData(T, PERIOD, { lang: 'en' });
  const d = buildDataset('bureau_domains', { monitoring }, { formId: FORM }, PERIOD);
  assert.deepEqual(d.rows.map((r) => r.bureau), ['Code 7 (not linked)', 'Antenne Bekily']);
  assert.ok(d.rows.every((r) => !r.bureau.includes(LONG)));
  // Section répétée par bureau : le filtre est l'identité (avec la fiche), la ligne reste courte.
  const scoped = buildDataset('bureau_domains', { monitoring }, { formId: FORM, bureau: `Code 7 (not linked) · ${LONG}` }, PERIOD);
  assert.deepEqual(scoped.rows.map((r) => [r.bureau, r.n]), [['Code 7 (not linked)', 2]]);
  // Les sections répétées, qui mêlent les fiches, gardent le nom de la fiche.
  assert.ok(repeatItems('bureau', { monitoring, field: { byOffice: [] } }).some((i) => i.label === `Code 7 (not linked) · ${LONG}`));
});

test('terrain : site sans bureau « (not attached) » en anglais, « (non rattaché) » par défaut', async () => {
  const en = await fieldRepo.reportFieldData(T, PERIOD, { lang: 'en' });
  assert.equal(en.byOffice[0].bureau, '(not attached)');
  const fr = await fieldRepo.reportFieldData(T, PERIOD);
  assert.equal(fr.byOffice[0].bureau, '(non rattaché)');
});

test('rendu du rapport : la langue de l\'interface arrive jusqu\'aux libellés de bureau (tableau et section répétée)', async () => {
  const doc = {
    title: 'Rapport', period: PERIOD,
    blocks: [
      { id: 'tb', type: 'table', params: { title: 'Par bureau', dataset: 'bureau_domains', filters: { formId: FORM } } },
      { id: 'rp', type: 'repeat', params: { over: 'bureau', blocks: [{ id: 'k', type: 'kpis', params: { metrics: ['submissions'] } }] } },
    ],
  };
  const out = await service.renderReport(T, doc, { lang: 'en' });
  assert.deepEqual(out.blocks.tb.rows.map((r) => r.bureau), ['Code 7 (not linked)', 'Antenne Bekily']);
  const labels = out.repeats.rp.map((i) => i.label);
  assert.ok(labels.includes(`Code 7 (not linked) · ${LONG}`));
  assert.ok(labels.includes('(not attached)'));
  assert.ok(labels.every((l) => !/non reli|non rattach/.test(l)), `aucun libellé français : ${labels}`);
  const fr = await service.renderReport(T, doc, { lang: 'fr' });
  assert.deepEqual(fr.blocks.tb.rows.map((r) => r.bureau), ['Code 7 (non relié)', 'Antenne Bekily']);
});
