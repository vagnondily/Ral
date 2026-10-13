const test = require('node:test');
const assert = require('node:assert/strict');
const { rbmSitesTx, generateFromRbmTx } = require('../src/modules/tpm/field.repository');

/**
 * Retour n° 48 — la « dernière visite » du RBM (page Priorités, génération du
 * plan du mois, Plan de suivi) ne compte JAMAIS une visite seulement planifiée :
 * seules les visites réalisées, la collecte réelle et la date du registre.
 */
const TENANT = '00000000-0000-0000-0000-000000000001';

/** Ligne telle que la rend le SELECT RBM (colonnes utiles au calcul). */
const row = (over) => ({
  id: 'site', name: 'Site', riskLevel: 'elevee', activity: 'Cantines', security: 0,
  fieldVisitMonth: null, dataVisitMonth: null, lastVisitDate: null, plannedMonths: [], dataVisitCount: 0, ...over,
});

function fakeClient(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*INSERT INTO site_visits/.test(sql)) return { rows: [], rowCount: Array.isArray(params[3]) ? params[3].length : 1 };
      return { rows };
    },
  };
}

test('SELECT RBM : la dernière visite de terrain ne lit que les visites RÉALISÉES, les visites prévues sont listées à part', async () => {
  const client = fakeClient([]);
  await rbmSitesTx(client, TENANT, { month: '2026-10' });
  const { sql, params } = client.calls[0];
  assert.match(sql, /max\(v\.period_month\) FILTER \(WHERE v\.status = 'realise'\) AS last_done/);
  assert.match(sql, /FILTER \(WHERE v\.status = 'planifie'\) AS planned/);
  assert.doesNotMatch(sql, /GREATEST\(pv\.last/, 'plus aucune dernière visite calculée sur les visites planifiées');
  assert.match(sql, /tenant_id = \$1/);
  assert.deepEqual(params, [TENANT]);
});

test('page RBM : un site seulement PLANIFIÉ ce mois (sécurité stricte, jamais visité) est « à suivre », visite prévue rendue à part', async () => {
  const client = fakeClient([row({ id: 'a-bedaro', name: 'A.BEDARO', security: 3, plannedMonths: ['2026-10'] })]);
  const [s] = await rbmSitesTx(client, TENANT, { month: '2026-10' });
  assert.equal(s.lastVisitMonth, null);
  assert.equal(s.neverVisited, true);
  assert.equal(s.due, true, 'une visite prévue ne rend jamais un site « à jour »');
  assert.equal(s.nextPlannedMonth, '2026-10');
  assert.equal(s.monthsSinceVisit, null, 'plus de « il y a 0 mois » issu d\'une visite prévue');
  assert.equal(s.urgentFlags, true);
  // La liste reste légère : l'explication n'est servie qu'à la demande (un site).
  assert.equal(s.reasons, undefined); assert.equal(s.actions, undefined); assert.equal(s.consequence, undefined);
});

test('explication d\'un site (GET /rbm/sites/:id) : même calcul que la liste, filtré sur le site et le compte', async () => {
  const client = fakeClient([row({ id: 'a-bedaro', name: 'A.BEDARO', security: 3, plannedMonths: ['2026-10'] })]);
  const [s] = await rbmSitesTx(client, TENANT, { month: '2026-10', siteId: 'a-bedaro', explain: true });
  const { sql, params } = client.calls[0];
  assert.match(sql, /WHERE s\.tenant_id = \$1 AND s\.id = \$2/);
  assert.deepEqual(params, [TENANT, 'a-bedaro']);
  assert.equal(s.due, true);
  assert.deepEqual(s.reasons.map((r) => [r.code, r.value, r.urgent]), [['security', 3, true]]);
  assert.deepEqual(s.actions.map((a) => a.code), ['security', 'doPlannedVisit']);
  assert.deepEqual([s.consequence.frequencyMonths, s.consequence.nextPlannedMonth, s.consequence.due], [1, '2026-10', true]);
});

test('page RBM : visite réalisée + données + visite prévue → dernière visite = la plus récente réelle, état cohérent', async () => {
  const client = fakeClient([
    row({ id: 'ok', riskLevel: 'moyenne', fieldVisitMonth: '2026-09', plannedMonths: ['2026-11'] }),
    row({ id: 'data', riskLevel: 'elevee', fieldVisitMonth: '2026-07', dataVisitMonth: '2026-10', plannedMonths: ['2026-10'] }),
    row({ id: 'late', riskLevel: 'faible', fieldVisitMonth: '2026-05', plannedMonths: ['2026-08'] }),
  ]);
  const [ok, data, late] = await rbmSitesTx(client, TENANT, { month: '2026-10', explain: true });
  assert.deepEqual([ok.lastVisitMonth, ok.lastVisitSource, ok.due, ok.nextPlannedMonth], ['2026-09', 'visite', false, '2026-11']);
  assert.deepEqual([data.lastVisitMonth, data.lastVisitSource, data.due], ['2026-10', 'donnees', false]);
  assert.deepEqual([late.lastVisitMonth, late.due, late.latePlannedMonth, late.nextPlannedMonth], ['2026-05', true, '2026-08', null]);
  assert.deepEqual(late.actions.map((a) => a.code), ['latePlanned', 'planVisit']);
  // L'explication suit la même règle « à suivre » que la ligne.
  for (const s of [ok, data, late]) assert.equal(s.consequence.due, s.due);
});

test('Plan de suivi : « Dernière visite » = réalisée ou collecte réelle ; la visite prévue est rendue à part', async () => {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const sites = [
    row({ id: 'planned-only', name: 'B', plannedMonths: [thisMonth], months: [], monthStatus: null }),
    row({ id: 'visited', name: 'A', fieldVisitMonth: '2026-03', months: [], monthStatus: null }),
  ];
  const client = { calls: [], async query(sql) { this.calls.push(sql); return { rows: /FROM mmr_parameters/.test(sql) ? [] : sites }; } };
  const { planBoardTx } = require('../src/modules/tpm/field.repository');
  const board = await planBoardTx(client, TENANT, { year: 2026 });
  const byId = Object.fromEntries(board.sites.map((s) => [s.id, s]));
  assert.equal(byId['planned-only'].lastVisitMonth, null);
  assert.equal(byId['planned-only'].nextPlannedMonth, thisMonth);
  assert.deepEqual([byId.visited.lastVisitMonth, byId.visited.lastVisitSource], ['2026-03', 'visite']);
  assert.equal(board.kpis.neverVisited, 1, 'un site seulement planifié compte parmi les « jamais visités »');
  // Jamais visité avant le site déjà visité (classement inchangé : la plus ancienne visite d'abord).
  assert.deepEqual(board.sites.map((s) => s.id), ['planned-only', 'visited']);
});

test('génération du plan du mois : un site seulement planifié reste « à suivre » mais n\'est pas replanifié ; zone interdite ignorée', async () => {
  const client = fakeClient([
    row({ id: 'planned-only', plannedMonths: ['2026-10'] }),
    row({ id: 'never', activity: null }),
    row({ id: 'done-this-month', fieldVisitMonth: '2026-10' }),
    row({ id: 'moyenne-recent', riskLevel: 'moyenne', fieldVisitMonth: '2026-09', plannedMonths: ['2026-09'] }),
    row({ id: 'forbidden', security: 99 }),
  ]);
  const r = await generateFromRbmTx(client, TENANT, 'user-1', '2026-10');
  // « À suivre » hors zone interdite : planned-only + never ; seul never est encore à planifier.
  assert.deepEqual(r, { created: 1, due: 2, toPlan: 1 });
  // Deux « Générer » simultanés du même mois sont mis en file (verrou pris AVANT la lecture).
  assert.match(client.calls[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(client.calls[0].params, [`rbm-generate:${TENANT}:2026-10`]);
  const inserts = client.calls.filter((c) => /INSERT INTO site_visits/.test(c.sql));
  assert.equal(inserts.length, 1, 'une seule instruction pour tous les sites');
  assert.deepEqual(inserts[0].params, [TENANT, '2026-10-01', 'user-1', ['never'], [null]]);
  // Le contrôle « déjà une visite non annulée ce mois » est dans l'INSERT (activité NULL comprise), filtré par compte.
  assert.match(inserts[0].sql, /INSERT INTO site_visits[\s\S]*SELECT \$1, t\.site_id[\s\S]*FROM unnest\(\$4::uuid\[\], \$5::text\[\]\)/);
  assert.match(inserts[0].sql, /WHERE NOT EXISTS \(SELECT 1 FROM site_visits v\s+WHERE v\.tenant_id = \$1 AND v\.site_id = t\.site_id\s+AND v\.period_month = \$2::date AND v\.status <> 'annule'\)/);
  assert.match(inserts[0].sql, /ON CONFLICT \(tenant_id, site_id, period_month, activity\) DO UPDATE SET status = 'planifie'[\s\S]*WHERE site_visits\.status = 'annule'/);
});

test('génération : rien à planifier ⇒ aucune écriture ; mois illisible refusé', async () => {
  const client = fakeClient([row({ id: 'planned-only', plannedMonths: ['2026-10'] }), row({ id: 'forbidden', security: 99 })]);
  assert.deepEqual(await generateFromRbmTx(client, TENANT, 'user-1', '2026-10'), { created: 0, due: 1, toPlan: 0 });
  assert.equal(client.calls.filter((c) => /INSERT/.test(c.sql)).length, 0);
  await assert.rejects(generateFromRbmTx(fakeClient([]), TENANT, 'user-1', '2026-13'), (e) => e.statusCode === 400);
});

/**
 * Client à état : simule le SELECT RBM (visites prévues / réalisées relues depuis la table)
 * et l'INSERT … SELECT … WHERE NOT EXISTS … ON CONFLICT de la génération, y compris le
 * piège d'origine : UNIQUE (…, activity) laisse passer deux visites d'activité NULL.
 */
function stateClient(sites, visits) {
  return {
    async query(sql, params) {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/^\s*INSERT INTO site_visits/.test(sql)) {
        const [, pm, , ids, acts] = params;
        let n = 0;
        ids.forEach((id, i) => {
          if (visits.some((v) => v.siteId === id && v.pm === pm && v.status !== 'annule')) return; // NOT EXISTS
          const act = acts[i];
          const clash = act != null && visits.find((v) => v.siteId === id && v.pm === pm && v.activity === act); // NULL ≠ NULL
          if (clash) { if (clash.status === 'annule') { clash.status = 'planifie'; n += 1; } return; }
          visits.push({ siteId: id, pm, activity: act, status: 'planifie' }); n += 1;
        });
        return { rows: [], rowCount: n };
      }
      const months = (id, status) => visits.filter((v) => v.siteId === id && v.status === status).map((v) => v.pm.slice(0, 7));
      return { rows: sites.map((s) => ({ ...s, plannedMonths: [...new Set(months(s.id, 'planifie'))], fieldVisitMonth: months(s.id, 'realise').sort().pop() || s.fieldVisitMonth })) };
    },
  };
}

test('« Générer » cliqué 3 fois : n, 0, 0 visites — plus de doublon d\'activité NULL, compteur « à planifier » à 0', async () => {
  const sites = [
    row({ id: 'sans-activite', activity: null }),
    row({ id: 'cantines', activity: 'Cantines' }),
    row({ id: 'annulee', activity: 'Cantines' }),
    row({ id: 'interdite', security: 99, activity: null }),
    row({ id: 'a-jour', riskLevel: 'faible', fieldVisitMonth: '2026-09' }),
  ];
  const visits = [{ siteId: 'annulee', pm: '2026-10-01', activity: 'Cantines', status: 'annule' }];
  const client = stateClient(sites, visits);
  const clicks = [];
  for (let i = 0; i < 3; i += 1) clicks.push(await generateFromRbmTx(client, TENANT, 'user-1', '2026-10'));
  assert.deepEqual(clicks.map((c) => c.created), [3, 0, 0]);
  assert.deepEqual(clicks.map((c) => c.toPlan), [3, 0, 0]);
  assert.deepEqual(clicks.map((c) => c.due), [3, 3, 3], 'les sites restent « à suivre » tant que la visite n\'est pas réalisée');
  const live = (id) => visits.filter((v) => v.siteId === id && v.status !== 'annule').length;
  assert.deepEqual(['sans-activite', 'cantines', 'annulee', 'interdite', 'a-jour'].map(live), [1, 1, 1, 0, 0]);
  assert.equal(visits.length, 3, 'la visite annulée est replanifiée, pas dupliquée');
  // Même règle pour le compteur de l'écran (rbmSitesTx) : plus rien « à planifier ».
  const rows = await rbmSitesTx(client, TENANT, { month: '2026-10' });
  assert.equal(rows.filter((s) => s.toPlan).length, 0);
});

test('liste RBM : drapeau « à planifier » par site (à suivre, hors zone interdite, sans visite prévue ce mois)', async () => {
  const client = fakeClient([
    row({ id: 'todo' }),
    row({ id: 'planned', plannedMonths: ['2026-10'] }),
    row({ id: 'later', plannedMonths: ['2026-12'] }),
    row({ id: 'forbidden', security: 99 }),
    row({ id: 'ok', riskLevel: 'faible', fieldVisitMonth: '2026-09' }),
  ]);
  const rows = await rbmSitesTx(client, TENANT, { month: '2026-10' });
  assert.deepEqual(rows.map((s) => [s.id, s.due, s.toPlan]), [
    ['todo', true, true], ['planned', true, false], ['later', true, true], ['forbidden', true, false], ['ok', false, false],
  ]);
  // Sans mois : rien n'est « à suivre » ni « à planifier ».
  const noMonth = await rbmSitesTx(fakeClient([row({ id: 'todo' })]), TENANT, {});
  assert.deepEqual([noMonth[0].due, noMonth[0].toPlan], [false, false]);
});
