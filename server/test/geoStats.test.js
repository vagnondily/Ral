/**
 * Positions déduites des collectes (modules/map/geoStats.js) et couche de points
 * (mapPoints.js). Vie privée : rien n'est placé sous 3 relevés ; un lecteur reçoit
 * les positions de moins de 5 relevés sur la grille de 2 km.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceKm, haversineKm, positionQuality, placeable, snap, publishedPosition, MIN_POINTS, SNAP_BELOW } = require('../src/modules/map/geoStats');
const { buildPointsResponse } = require('../src/modules/map/mapPoints');

test('positionQuality : bornes n = 3, 2 km, 5 km ; sous 3 relevés jamais placée', () => {
  assert.equal(MIN_POINTS, 3);
  assert.equal(positionQuality({ n: 2, spreadKm: 0 }), 'insuffisant');
  assert.equal(positionQuality({ n: 1, spreadKm: 0 }), 'insuffisant'); // la médiane d'un point = un ménage
  assert.equal(positionQuality({ n: 3, spreadKm: 2 }), 'fiable');
  assert.equal(positionQuality({ n: 3, spreadKm: 2.01 }), 'indicative');
  assert.equal(positionQuality({ n: 30, spreadKm: 5 }), 'indicative');
  assert.equal(positionQuality({ n: 30, spreadKm: 5.01 }), 'dispersee');
  assert.equal(positionQuality({ n: 30, spreadKm: null }), 'insuffisant');
  assert.equal(placeable('fiable'), true);
  assert.equal(placeable('indicative'), true);
  assert.equal(placeable('dispersee'), false);
  assert.equal(placeable('insuffisant'), false);
});

test('distanceKm (équirectangulaire) ≈ grand cercle à moins de 0,5 % sous 20 km', () => {
  const a = { lat: -24.12, lng: 45.34 };
  for (const [dlat, dlng] of [[0.01, 0], [0, 0.05], [0.1, 0.1], [-0.15, 0.08]]) {
    const b = { lat: a.lat + dlat, lng: a.lng + dlng };
    const e = distanceKm(a, b); const h = haversineKm(a, b);
    assert.ok(h < 20);
    assert.ok(Math.abs(e - h) / h < 0.005, `${e} vs ${h}`);
  }
  assert.equal(distanceKm(a, a), 0);
});

test('grille de 2 km : deux décimales ; position publiée selon le rôle et le nombre de relevés', () => {
  assert.deepEqual(snap(-24.1222355, 45.3429061), { lat: -24.12, lng: 45.34 });
  assert.equal(SNAP_BELOW, 5);
  const p = { lat: -24.1222355, lng: 45.3429061 };
  assert.deepEqual(publishedPosition({ ...p, n: 3 }, { precise: true }), { ...p, coarse: false });
  assert.deepEqual(publishedPosition({ ...p, n: 4 }, { precise: false }), { lat: -24.12, lng: 45.34, coarse: true });
  assert.deepEqual(publishedPosition({ ...p, n: 5 }, { precise: false }), { ...p, coarse: false });
});

const site = (id, extra = {}) => ({ id, name: `Site ${id}`, code: id, hasGps: false, lat: null, lng: null, status: 'non_prevu', risk: 'elevee', districtPcode: 'MG1', cpcode: 'C1', visitsPlanned: 0, visitsPlannedRealised: 0, byData: false, ...extra });

test('couche de points : GPS, placé par ses collectes (≥ 3 relevés), centres de commune, notes', () => {
  const raw = {
    sites: [site('A', { hasGps: true, lat: -24.1, lng: 45.3, status: 'realise', visitsPlanned: 2, visitsPlannedRealised: 1 }), site('B'), site('C'), site('D', { cpcode: 'C2' })],
    sitesCap: 3000,
    bySite: [{ key: 'B', n: 4, lat: -24.123456789, lng: 45.987654321, spreadKm: 0.5 }, { key: 'C', n: 2, lat: -24.2, lng: 45.2, spreadKm: 0 }, { key: 'A', n: 9, lat: 0, lng: 0, spreadKm: 0 }],
    byCommune: [{ key: 'C1', n: 12, lat: -24.3, lng: 45.4, spreadKm: 1.2 }, { key: 'C2', n: 7, lat: -24.4, lng: 45.5, spreadKm: 9 }],
    communes: [{ pcode: 'C1', name: 'Ebelo', district: 'Amboasary' }],
    collect: { mode: 'bins', bins: [{ lat: -24.12, lng: 45.34, n: 3 }], total: 3, rejected: 2, lastMonth: '2026-07' },
  };
  const r = buildPointsResponse(raw, { layers: ['gps', 'derived', 'communes', 'collect'], precise: false, maxAccuracyM: 100, limit: 2000 });
  assert.deepEqual(r.sites.map((s) => [s.id, s.kind]), [['A', 'gps'], ['B', 'collectes']]);
  assert.equal(r.sites[0].execution, 0.5);
  // B : 4 relevés → lecteur = grille de 2 km.
  assert.deepEqual([r.sites[1].lat, r.sites[1].lng, r.sites[1].coarse], [-24.12, 45.98, true]);
  // C : 2 relevés → pas placé (insuffisant) ; reste dans le centre de sa commune.
  assert.deepEqual(r.communes.map((c) => [c.name, c.sitesWithoutPosition, c.sites.map((s) => s.id)]), [['Ebelo', 1, ['C']]]);
  assert.deepEqual(r.notes, { insufficient: 1, scattered: 1 }); // C2 dispersée (9 km)
  assert.deepEqual(r.counts, { perimeter: 4, gps: 1, derived: 1, communeCentres: 1, sitesInCommuneCentres: 1, withoutPosition: 1 });
  assert.deepEqual(r.rejected, { accuracy: 2 });
  assert.equal(r.collect.mode, 'bins');
  // Aucune coordonnée à plus de 2 décimales pour un lecteur, sauf les sites GPS du registre (positions de sites).
  for (const s of r.sites.filter((x) => x.kind !== 'gps')) for (const v of [s.lat, s.lng]) assert.ok(Math.abs(v * 100 - Math.round(v * 100)) < 1e-9);
});

test('couche de points : plafond de la couche « sites » signalé', () => {
  const r = buildPointsResponse({ sites: [site('A', { hasGps: true, lat: 1, lng: 1 }), site('B', { hasGps: true, lat: 2, lng: 2 })], sitesCap: 1, bySite: [], byCommune: [], communes: [], collect: null },
    { layers: ['gps'], precise: true, maxAccuracyM: 100, limit: 10 });
  assert.equal(r.sitesTruncated, true);
  assert.equal(r.sites.length, 1);
  assert.equal(r.collect, null);
});
