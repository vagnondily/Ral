/**
 * Affectation des TPM (retour 58) — service + dépôt SANS base : un faux client joue les tables
 * (contrats, zones, découpage, modifications, visites) et vérifie le SQL réellement envoyé :
 *  - chaque requête filtre tenant_id = $1 (compte du jeton, jamais du corps) ;
 *  - une écriture prend le verrou d'attribution AVANT toute lecture ; l'aperçu n'en prend pas et
 *    n'écrit rien ;
 *  - un enregistrement = au plus une suppression, UN upsert multi-lignes (chemin et profondeur lus
 *    dans le découpage, jamais reçus), UNE estampille des visites, UNE inscription au journal ;
 *  - empreinte périmée → 409 ; raison absente ou courte → 400 ; prestataire non sélectionnable → 400 ;
 *  - aucune requête lancée pendant qu'une autre attend sur le même client (jamais Promise.all).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const T = '11111111-1111-1111-1111-111111111111';
const R1 = 'a0000000-0000-0000-0000-000000000001';
const D1 = 'a0000000-0000-0000-0000-000000000002';
const D2 = 'a0000000-0000-0000-0000-000000000003';
const C1 = 'a0000000-0000-0000-0000-000000000004';
const AINA = 'b0000000-0000-0000-0000-000000000001';
const TOHANA = 'b0000000-0000-0000-0000-000000000002';
const YPA = 'b0000000-0000-0000-0000-000000000003';
const K1 = 'c0000000-0000-0000-0000-000000000001';
const V1 = 'd0000000-0000-0000-0000-000000000001';
const USER = 'e0000000-0000-0000-0000-000000000001';

const AREAS = {
  [R1]: { id: R1, depth: 1, name: 'Androy', path: 'Androy', lineage: [], regionId: R1, regionName: 'Androy', districtId: null },
  [D1]: { id: D1, depth: 2, name: 'Bekily', path: 'Androy > Bekily', lineage: [R1], regionId: R1, regionName: 'Androy', districtId: null },
  [D2]: { id: D2, depth: 2, name: 'Beloha', path: 'Androy > Beloha', lineage: [R1], regionId: R1, regionName: 'Androy', districtId: null },
  [C1]: { id: C1, depth: 3, name: 'Bekily centre', path: 'Androy > Bekily > Bekily centre', lineage: [R1, D1], regionId: R1, regionName: 'Androy', districtId: D1 },
};

let state;
function reset() {
  state = {
    calls: [], inFlight: 0, overlap: false,
    overrides: [],
    visits: [{ id: V1, siteId: 's1', siteName: 'EPP Bekily', locationId: 'L001', districtId: D1, communeId: C1, month: '2026-08', status: 'planifie', providerId: AINA, source: 'zone', zoneState: 'contrat', contractId: K1, dated: false }],
    stampRows: [],
  };
}
reset();

const rowsFor = (s, params) => {
  if (/^SET LOCAL lock_timeout/.test(s) || /^SELECT pg_advisory_xact_lock/.test(s)) return [];
  if (/^SELECT c\.id, c\.numero, c\.numero_fla AS "numeroFla", c\.status/.test(s)) {
    return [{ id: K1, numero: 'CTR-2026-0001', numeroFla: 'FLA-2025-0007', status: 'actif', partnerId: AINA, partnerName: 'ASSOCIATION AINA', dateDebut: '2025-10-01', dateFin: '2026-09-30', terminationDate: null, monitoring: true }];
  }
  if (/^SELECT z\.contract_id AS "contractId"/.test(s)) {
    return [
      { contractId: K1, adminAreaId: D1, depth: 2, path: 'Androy > Bekily', lineage: [R1] },
      { contractId: K1, adminAreaId: D2, depth: 2, path: 'Androy > Beloha', lineage: [R1] },
      { contractId: K1, adminAreaId: null, depth: 2, path: 'Androy > Ambovombe', lineage: [] },
    ];
  }
  if (/^SELECT o\.id, o\.admin_area_id AS "adminAreaId"/.test(s)) {
    return state.overrides.filter((o) => `${o.month}-01` >= params[1] && `${o.month}-01` <= params[2]);
  }
  if (/^WITH provider_contracts AS/.test(s)) {
    return [{ partnerId: AINA, contractId: K1, numero: 'CTR-2026-0001', status: 'actif', dateDebut: '2025-10-01', dateFin: '2026-09-30', terminationDate: null, monitoring: true, via: ['titulaire'] }];
  }
  if (/^SELECT p\.id, p\.name, p\.short_name AS "shortName", t\.code AS "typeCode"/.test(s)) {
    return [
      { id: AINA, name: 'ASSOCIATION AINA', typeCode: 'prestataire', active: true },
      { id: TOHANA, name: 'TOHANA', typeCode: 'prestataire', active: true },
      { id: YPA, name: 'YPA', typeCode: 'tpm', active: true },
    ];
  }
  if (/^SELECT a\.id, a\.depth, a\.name, a\.path, a\.lineage/.test(s)) return params[1].map((id) => AREAS[id]).filter(Boolean);
  if (/^SELECT DISTINCT d\.id FROM admin_areas d/.test(s)) return params[1].includes(R1) ? [{ id: D1 }, { id: D2 }] : [];
  if (/^SELECT v\.id, s\.zone_district_id AS "districtId"/.test(s)) {
    return state.visits.filter((v) => v.status === 'planifie' && v.source === 'zone' && params[2].includes(`${v.month}-01`)
      && (params[1].includes(v.districtId) || params[1].includes(v.communeId)));
  }
  if (/^SELECT to_char\(period_month, 'YYYY-MM'\) AS month, status FROM field_month_plans/.test(s)) return [{ month: '2026-09', status: 'valide' }];
  if (/^SELECT v\.id, v\.site_id AS "siteId"/.test(s)) return state.visits.filter((v) => params[1].includes(v.id));
  if (/FROM mems_tpm_stamp\(\$1/.test(s)) return state.stampRows;
  if (/^SELECT zone_district_id AS "districtId", zone_commune_id AS "communeId", count/.test(s)) return [{ districtId: D1, communeId: C1, n: 12 }, { districtId: D2, communeId: null, n: 5 }, { districtId: null, communeId: null, n: 2 }];
  if (/^SELECT s\.zone_district_id AS "districtId", s\.zone_commune_id AS "communeId", to_char/.test(s)) {
    return [{ districtId: D1, communeId: C1, month: '2026-08', status: 'planifie', source: 'reprise', zoneState: null, providerId: YPA, n: 2, dated: 0 }];
  }
  if (/^SELECT \(SELECT count\(\*\) FROM sites/.test(s)) return [{ sitesWithoutDistrict: 2, plannedReprise: 2, pending: 0 }];
  if (/^SELECT DISTINCT site_id FROM site_visits/.test(s)) return [];
  return null;
};

db.withTenantTransaction = async (tenantId, fn) => {
  assert.equal(tenantId, T);
  return fn({
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (state.inFlight > 0) state.overlap = true;
      state.inFlight += 1;
      await new Promise((r) => setImmediate(r));
      state.inFlight -= 1;
      state.calls.push({ sql: s, params });
      if (/^SELECT pg_advisory_xact_lock/.test(s)) assert.equal(params[0], `tpm-attribution:${T}`, 'verrou du compte');
      else if (!/^SET LOCAL/.test(s)) {
        assert.ok(/tenant_id = \$1/.test(s) || /mems_tpm_stamp\(\$1/.test(s), `requête sans filtre de compte : ${s.slice(0, 100)}`);
        assert.equal(params[0], T);
      }
      if (/^DELETE FROM tpm_zone_overrides/.test(s)) {
        const n = state.overrides.length;
        state.overrides = state.overrides.filter((o) => !params[1].includes(o.id));
        return { rowCount: n - state.overrides.length, rows: [] };
      }
      if (/^INSERT INTO tpm_zone_overrides/.test(s)) return { rowCount: params[4].length, rows: [] };
      if (/^INSERT INTO tpm_attribution_log/.test(s)) return { rowCount: params[2].length, rows: [] };
      if (/^UPDATE site_visits v SET/.test(s)) return { rowCount: params[2].length, rows: [] };
      const rows = rowsFor(s, params);
      if (rows === null) throw new Error(`requête inattendue : ${s.slice(0, 140)}`);
      return { rows, rowCount: rows.length };
    },
  });
};

const service = require('../src/modules/tpm/tpmAttribution.service');
const repo = require('../src/modules/tpm/tpmAttribution.repository');

const ACTOR = { userId: USER, role: 'manager' };
const target = (over = {}) => ({ areaIds: [D1], regionIds: [], from: '2026-08', to: '2026-10', ...over });
const writes = () => state.calls.filter((c) => /^(INSERT|UPDATE|DELETE)\b/.test(c.sql) || /mems_tpm_stamp/.test(c.sql));

test('aperçu : aucune écriture, aucun verrou ; comptes, visites qui changent, avertissements, empreinte', async () => {
  reset();
  const p = await service.preview(T, { target: target(), mode: 'modifier', providerId: YPA, reason: null });
  assert.equal(writes().length, 0);
  assert.equal(state.calls.some((c) => /pg_advisory_xact_lock/.test(c.sql)), false);
  assert.match(p.stamp, /^[0-9a-f]{40}$/);
  // août et septembre : AINA selon contrat → YPA (2 modifications) ; octobre : contrat échu → YPA (1).
  assert.equal(p.counts.created, 3);
  assert.equal(p.visits.changed, 1);
  assert.deepEqual(p.visits.moves.map((m) => [m.fromName, m.toName, m.visits]), [['ASSOCIATION AINA', 'YPA', 1]]);
  assert.deepEqual(p.warnings.map((w) => w.code).sort(), ['hors_contrat', 'plan_valide']);
  assert.deepEqual(p.contract[0].segments.map((x) => [x.from, x.to, x.state, x.numero]), [['2026-08', '2026-09', 'contrat', 'CTR-2026-0001'], ['2026-10', '2026-10', 'sans_contrat', null]]);
  assert.equal(state.overlap, false);
});

test('enregistrer : verrou d\'abord, un upsert multi-lignes, une estampille, un journal ; chemin lu dans le découpage', async () => {
  reset();
  const { stamp } = await service.preview(T, { target: target(), mode: 'modifier', providerId: YPA });
  state.calls = [];
  state.stampRows = [{ id: V1, fromProviderId: AINA, providerId: YPA, zoneState: 'modifie', dated: false }];
  const r = await service.setOverrides(T, ACTOR, { target: target(), providerId: YPA, reason: '  Collecte confiée à YPA par le bureau  ', stamp });
  assert.equal(r.counts.created, 3);
  assert.equal(r.visits.changed, 1);
  assert.match(state.calls[0].sql, /^SET LOCAL lock_timeout = '20s'/);
  assert.match(state.calls[1].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(state.calls[1].params, [`tpm-attribution:${T}`]);
  const upserts = state.calls.filter((c) => /^INSERT INTO tpm_zone_overrides/.test(c.sql));
  assert.equal(upserts.length, 1);
  assert.match(upserts[0].sql, /FROM unnest\(\$5::uuid\[\], \$6::date\[\]/);
  assert.match(upserts[0].sql, /JOIN admin_areas a ON a\.tenant_id = \$1 AND a\.id = u\.area_id AND a\.depth IN \(2, 3\)/);
  assert.match(upserts[0].sql, /SELECT \$1, a\.id, a\.path, a\.depth/);
  assert.equal(upserts[0].params[1], 'Collecte confiée à YPA par le bureau', 'raison nettoyée');
  assert.deepEqual(upserts[0].params[5], ['2026-08-01', '2026-09-01', '2026-10-01']);
  assert.ok(!upserts[0].params.some((p) => p === 'Androy > Bekily'), 'le chemin ne vient jamais des paramètres');
  assert.deepEqual(upserts[0].params[7], ['contrat', 'contrat', 'sans_contrat'], 'instantané du contrat');
  assert.equal(state.calls.filter((c) => /^DELETE FROM tpm_zone_overrides/.test(c.sql)).length, 0);
  const stamps = state.calls.filter((c) => /mems_tpm_stamp/.test(c.sql));
  assert.equal(stamps.length, 1);
  assert.match(stamps[0].sql, /s\.zone_district_id = ANY \(\$2::uuid\[\]\) OR s\.zone_commune_id = ANY \(\$2::uuid\[\]\)/);
  assert.match(stamps[0].sql, /provider_zone_state IS DISTINCT FROM 'anterieur'/);
  const logs = state.calls.filter((c) => /^INSERT INTO tpm_attribution_log/.test(c.sql));
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].params[3], ['lot', 'zone', 'zone', 'zone']); // scope
  assert.deepEqual(logs[0].params[4], ['modifier', 'modifier', 'modifier', 'modifier']); // action
  assert.equal(logs[0].params[1], USER, 'auteur = session');
  assert.ok(state.calls.findIndex((c) => /pg_advisory_xact_lock/.test(c.sql)) < state.calls.findIndex((c) => /^SELECT c\.id/.test(c.sql)), 'verrou avant toute lecture');
  assert.equal(state.overlap, false);
});

test('enregistrer : empreinte périmée → 409 ; raison absente → 400 ; raison vide de sens → 400 ; rien n\'est écrit', async () => {
  reset();
  const { stamp } = await service.preview(T, { target: target(), mode: 'modifier', providerId: YPA });
  state.calls = [];
  await assert.rejects(service.setOverrides(T, ACTOR, { target: target(), providerId: YPA, reason: 'Collecte confiée à YPA', stamp: 'x'.repeat(40) }),
    (e) => e.statusCode === 409 && e.details.code === 'stale');
  await assert.rejects(service.setOverrides(T, ACTOR, { target: target(), providerId: YPA, reason: '', stamp }),
    (e) => e.statusCode === 400 && e.details.code === 'reason_required');
  await assert.rejects(service.setOverrides(T, ACTOR, { target: target(), providerId: YPA, reason: 'aaaaaaaaaaaa', stamp }),
    (e) => e.statusCode === 400 && e.details.code === 'reason_meaningless');
  await assert.rejects(service.setOverrides(T, ACTOR, { target: target(), providerId: YPA, reason: 'court', stamp }),
    (e) => e.statusCode === 400 && e.details.code === 'reason_short');
  assert.equal(writes().length, 0);
});

test('prestataire ni titulaire ni TPM actif sur la période → 400 provider_not_selectable', async () => {
  reset();
  const { stamp, notSelectable } = await service.preview(T, { target: target(), mode: 'modifier', providerId: TOHANA });
  assert.deepEqual(notSelectable, ['2026-08', '2026-09', '2026-10']);
  await assert.rejects(service.setOverrides(T, ACTOR, { target: target(), providerId: TOHANA, reason: 'Collecte confiée à TOHANA', stamp }),
    (e) => e.statusCode === 400 && e.details.code === 'provider_not_selectable');
  assert.equal(writes().length, 0);
});

test('choisir la valeur du contrat supprime la modification (raison facultative), journal « revenir_contrat »', async () => {
  reset();
  state.overrides = [{ id: 'o1', adminAreaId: D1, areaPath: 'Androy > Bekily', areaDepth: 2, month: '2026-08', providerId: YPA, expectedState: 'contrat', expectedProviderId: AINA, reason: 'Collecte confiée à YPA', updatedAt: new Date('2026-10-01T00:00:00Z') }];
  const t = target({ to: '2026-09' });
  const { stamp } = await service.preview(T, { target: t, mode: 'modifier', providerId: AINA });
  state.calls = [];
  const r = await service.setOverrides(T, ACTOR, { target: t, providerId: AINA, reason: null, stamp });
  assert.equal(r.counts.deleted, 1);
  assert.equal(r.counts.sameAsContract, 2);
  const del = state.calls.filter((c) => /^DELETE FROM tpm_zone_overrides/.test(c.sql));
  assert.equal(del.length, 1);
  assert.deepEqual(del[0].params, [T, ['o1']]);
  assert.equal(state.calls.filter((c) => /^INSERT INTO tpm_zone_overrides/.test(c.sql)).length, 0);
  const log = state.calls.find((c) => /^INSERT INTO tpm_attribution_log/.test(c.sql));
  assert.deepEqual(log.params[4], ['revenir_contrat', 'revenir_contrat']);
});

test('« revenir au contrat » : même empreinte, suppression seule ; toute la région = ses districts avec des sites', async () => {
  reset();
  state.overrides = [{ id: 'o2', adminAreaId: D2, areaPath: 'Androy > Beloha', areaDepth: 2, month: '2026-10', providerId: YPA, expectedState: 'sans_contrat', expectedProviderId: null, reason: 'Collecte confiée à YPA', updatedAt: '2026-10-02T00:00:00.000Z' }];
  const t = target({ areaIds: [], regionIds: [R1] });
  const p = await service.preview(T, { target: t, mode: 'revenir' });
  assert.deepEqual(p.areas.map((a) => a.name), ['Bekily', 'Beloha']);
  state.calls = [];
  const r = await service.revert(T, ACTOR, { target: t, reason: null, stamp: p.stamp });
  assert.equal(r.counts.deleted, 1);
  assert.equal(state.calls.filter((c) => /^DELETE FROM tpm_zone_overrides/.test(c.sql)).length, 1);
});

test('trop de cellules, zone hors district / commune → 400 avant toute lecture des contrats', async () => {
  reset();
  await assert.rejects(service.preview(T, { target: target({ areaIds: [R1] }), mode: 'modifier', providerId: YPA }),
    (e) => e.statusCode === 400 && e.details.code === 'area_depth');
  const many = Array.from({ length: 101 }, (_, i) => `f${String(i).padStart(7, '0')}-0000-0000-0000-000000000000`);
  await assert.rejects(service.preview(T, { target: target({ areaIds: many, from: '2025-01', to: '2026-12' }), mode: 'modifier', providerId: YPA }),
    (e) => e.statusCode === 400 && e.details.code === 'too_many_cells');
  assert.equal(state.calls.some((c) => /^SELECT c\.id, c\.numero/.test(c.sql)), false);
});

// Visites qu'une re-dérivation automatique peut toucher : prévues, non figées (« antérieur »), pas
// encore facturées (facture soumise ou validée de leur TPM, ce mois-là) — jamais une visite
// réalisée ou annulée.
const NOT_INVOICED = /v\.status = 'planifie' AND v\.provider_zone_state IS DISTINCT FROM 'anterieur' AND NOT EXISTS \(SELECT 1 FROM tpm_reports r WHERE r\.tenant_id = v\.tenant_id AND r\.partner_id = v\.provider_id AND r\.period_month = v\.period_month AND r\.kind = 'financier' AND r\.status IN \('soumis', 'valide'\)\)/;

test('restampVisitsTx : portées (visites prévues « zone », non figées, non facturées seulement ; antérieures jamais)', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, ' '), params }); return { rows: [] }; } };
  await repo.restampVisitsTx(client, T);
  assert.match(calls.at(-1).sql, /FROM mems_tpm_stamp\(\$1, '\{\}'::uuid\[\]\)/);
  await repo.restampVisitsTx(client, T, { fromMonth: '2026-10' });
  assert.match(calls.at(-1).sql, /v\.provider_source = 'zone' AND v\.status = 'planifie' AND v\.provider_zone_state IS DISTINCT FROM 'anterieur' AND NOT EXISTS \(SELECT 1 FROM tpm_reports r .*\) AND v\.period_month >= \$2::date\)/);
  assert.match(calls.at(-1).sql, NOT_INVOICED);
  assert.deepEqual(calls.at(-1).params, [T, '2026-10-01']);
  await repo.restampVisitsTx(client, T, { areaIds: [D1], months: ['2026-10'] });
  assert.match(calls.at(-1).sql, NOT_INVOICED);
  await repo.restampVisitsTx(client, T, { from: '2026-01', to: '2026-03' });
  assert.match(calls.at(-1).sql, /v\.period_month BETWEEN \$2::date AND \$3::date\)/);
  assert.match(calls.at(-1).sql, NOT_INVOICED, 'Réappliquer : antérieures figées aussi');
  // Visites que les seeds viennent de créer : rendues « à estampiller », puis estampillées une fois.
  await repo.restampVisitsTx(client, T, { visitIds: [V1] });
  assert.match(calls.at(-2).sql, /^UPDATE site_visits v SET provider_zone_state = NULL, updated_at = now\(\) WHERE v\.tenant_id = \$1 AND v\.provider_source = 'zone' AND v\.id = ANY \(\$2::uuid\[\]\)/);
  assert.deepEqual(calls.at(-2).params, [T, [V1]]);
  assert.match(calls.at(-1).sql, /FROM mems_tpm_stamp\(\$1, '\{\}'::uuid\[\]\)/);
  // Toujours sous le verrou d'attribution.
  assert.equal(calls.filter((c) => /pg_advisory_xact_lock/.test(c.sql)).length, 5);
});

test('TPM de visites : verrou, lecture FOR UPDATE, une instruction d\'écriture, estampille, journal ; autre TPM sans raison → 400', async () => {
  reset();
  await assert.rejects(service.setVisitsProvider(T, ACTOR, { visitIds: [V1], action: 'set', providerId: YPA, reason: null }),
    (e) => e.statusCode === 400 && e.details.code === 'reason_required' && /EPP Bekily · 2026-08/.test(e.message));
  state.calls = [];
  // Choisir la valeur de la zone n'est pas un écart : rien n'est écrit.
  const same = await service.setVisitsProvider(T, ACTOR, { visitIds: [V1], action: 'set', providerId: AINA, reason: null });
  assert.equal(same.updated, 0);
  assert.equal(state.calls.filter((c) => /^UPDATE site_visits/.test(c.sql)).length, 0);
  state.calls = [];
  const r = await service.setVisitsProvider(T, ACTOR, { visitIds: [V1], action: 'set', providerId: YPA, reason: 'Visite confiée à YPA (accès)' });
  assert.equal(r.updated, 1);
  assert.match(state.calls.find((c) => /^SELECT v\.id, v\.site_id/.test(c.sql)).sql, /FOR UPDATE OF v/);
  const upd = state.calls.filter((c) => /^UPDATE site_visits v SET/.test(c.sql));
  assert.equal(upd.length, 1);
  assert.deepEqual(upd[0].params.slice(2), [[V1], ['visite'], [YPA], ['Visite confiée à YPA (accès)']]);
  const log = state.calls.find((c) => /^INSERT INTO tpm_attribution_log/.test(c.sql));
  assert.deepEqual(log.params[3], ['lot', 'visite']);
  assert.ok(state.calls.findIndex((c) => /pg_advisory_xact_lock/.test(c.sql)) < state.calls.findIndex((c) => /^SELECT v\.id, v\.site_id/.test(c.sql)));
  // Un prestataire qui n'est ni titulaire ce mois ni TPM actif est refusé.
  await assert.rejects(service.setVisitsProvider(T, ACTOR, { visitIds: [V1], action: 'set', providerId: TOHANA, reason: 'Visite confiée à TOHANA' }),
    (e) => e.statusCode === 400 && e.details.code === 'provider_not_selectable');
});

test('onglet : lignes région › district (› commune portée), comptes de sites, visites écartées de leur zone', async () => {
  reset();
  const t = await service.getTable(T, { period: { from: '2026-08', to: '2026-10' }, regionId: null, all: false });
  assert.deepEqual(t.rows.map((r) => r.name), ['Bekily', 'Beloha']); // la commune n'a pas sa propre ligne
  const bekily = t.rows[0];
  assert.equal(bekily.sites, 12);
  assert.deepEqual(bekily.segments.map((s) => [s.from, s.to, s.state, s.providerName]), [['2026-08', '2026-09', 'contrat', 'ASSOCIATION AINA'], ['2026-10', '2026-10', 'sans_contrat', null]]);
  assert.deepEqual(bekily.visits[0], { planned: 2, realised: 0, cancelled: 0, divergent: 2, reprise: 2 });
  assert.deepEqual(t.quality.detachedContractZones.map((z) => z.path), ['Androy > Ambovombe']);
  assert.equal(t.quality.sitesWithoutDistrict, 2);
  assert.deepEqual(t.regions, [{ id: R1, name: 'Androy' }]);
});

test('appliquer les TPM des contrats : prévues seulement — jamais une visite motivée, réalisée, annulée ou facturée ; « reprise » rendue à sa zone ; journal', async () => {
  reset();
  const calls = [];
  const client = {
    query: async (sql, params) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: q, params });
      if (/^SELECT count\(\*\) FILTER/.test(q)) return { rows: [{ n: 3, reprise: 1, reasoned: 2, done: 4, anterieur: 5, invoiced: 1, lo: '2026-09', hi: '2026-10' }] };
      if (/FROM mems_tpm_stamp/.test(q)) return { rows: [{ id: V1, fromProviderId: YPA, providerId: AINA, zoneState: 'contrat', dated: false }] };
      if (/^SELECT v\.id, to_char/.test(q)) return { rows: [{ id: V1, month: '2026-09', site: 'S-ABCD-EFGH' }] };
      return { rows: [], rowCount: 0 };
    },
  };
  const r = await repo.applyContractsTx(client, T, USER, { period: { from: '2026-09', to: '2026-10' } });
  assert.deepEqual([r.visits, r.converted, r.changed], [3, 1, 1]);
  assert.deepEqual(r.kept, { reasoned: 2, done: 4, anterieur: 5, invoiced: 1 }, 'gardées telles quelles, et comptées');
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  const scope = calls.find((c) => /^SELECT count/.test(c.sql));
  assert.match(scope.sql, /count\(\*\) FILTER \(WHERE v\.provider_source IN \('zone', 'reprise'\) AND v\.status = 'planifie' AND v\.provider_zone_state IS DISTINCT FROM 'anterieur' AND NOT EXISTS/);
  assert.match(scope.sql, /WHERE v\.tenant_id = \$1 AND v\.period_month BETWEEN \$2::date AND \$3::date$/);
  const convert = calls.find((c) => /^UPDATE site_visits/.test(c.sql));
  assert.match(convert.sql, /SET provider_source = 'zone', provider_reason = NULL/);
  assert.match(convert.sql, /WHERE v\.tenant_id = \$1 AND v\.provider_source = 'reprise' AND v\.status = 'planifie' AND v\.provider_zone_state IS DISTINCT FROM 'anterieur' AND NOT EXISTS/);
  assert.match(convert.sql, NOT_INVOICED);
  const stamp = calls.find((c) => /mems_tpm_stamp/.test(c.sql));
  assert.match(stamp.sql, /v\.provider_source = 'zone' AND v\.status = 'planifie' AND v\.provider_zone_state IS DISTINCT FROM 'anterieur' AND NOT EXISTS .* AND v\.period_month BETWEEN/);
  assert.match(stamp.sql, NOT_INVOICED);
  // Aucune écriture ne vise une visite motivée, réalisée ou annulée.
  for (const w of [convert, stamp]) {
    assert.doesNotMatch(w.sql, /'visite'|'realise'|'annule'/, 'jamais une visite motivée, réalisée ou annulée');
  }
  const log = calls.find((c) => /^INSERT INTO tpm_attribution_log/.test(c.sql));
  assert.deepEqual(log.params[3], ['lot', 'visite']);
  assert.deepEqual(log.params[4], ['reappliquer', 'visite_zone']);
  assert.deepEqual(log.params[12], [null, YPA], 'ancien TPM gardé au journal');
});

test('appliquer les TPM des contrats : rien d\'éligible → aucune écriture, aucun journal, visites gardées comptées', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      calls.push(q);
      if (/^SELECT count\(\*\) FILTER/.test(q)) return { rows: [{ n: 0, reprise: 0, reasoned: 1, done: 7, anterieur: 2, invoiced: 0, lo: null, hi: null }] };
      return { rows: [], rowCount: 0 };
    },
  };
  const r = await repo.applyContractsTx(client, T, null, {});
  assert.deepEqual(r, { visits: 0, converted: 0, changed: 0, byState: {}, moves: [], kept: { reasoned: 1, done: 7, anterieur: 2, invoiced: 0 } });
  assert.equal(calls.filter((q) => /^(UPDATE|INSERT)|mems_tpm_stamp/.test(q)).length, 0);
});

test('cellsForSitesTx : TPM de la zone de sites × mois (lot 5), même règle que l estampille', async () => {
  reset();
  const client = {
    query: async (sql, params) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (/^SELECT id, zone_district_id AS "districtId"/.test(q)) return { rows: [{ id: 's1', districtId: D1, communeId: C1 }, { id: 's2', districtId: null, communeId: null }] };
      const rows = rowsFor(q, params);
      if (rows === null) throw new Error(`requête inattendue : ${q.slice(0, 120)}`);
      return { rows };
    },
  };
  const cells = await repo.cellsForSitesTx(client, T, [{ siteId: 's1', month: '2026-08' }, { siteId: 's1', month: '2026-10' }, { siteId: 's2', month: '2026-08' }, { siteId: 's1', month: 'n/a' }]);
  assert.equal(cells.size, 3);
  const aug = cells.get('s1|2026-08');
  assert.deepEqual([aug.state, aug.providerId, aug.providerName, aug.contractLabel], ['contrat', AINA, 'ASSOCIATION AINA', 'FLA-2025-0007']);
  assert.equal(cells.get('s1|2026-10').state, 'sans_contrat');
  assert.equal(cells.get('s2|2026-08').state, 'district_inconnu');
});
