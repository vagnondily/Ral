/**
 * Positions déduites des collectes (modules/map/geoStats.js) et couche de points
 * (mapPoints.js). Vie privée : rien n'est placé sous 3 relevés ; hors admin /
 * gestionnaire, TOUTES les positions déduites sont sur la grille de 2 km (quel que soit n).
 * Comptes sur le périmètre complet, même quand la liste des sites dessinés est tronquée.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceKm, haversineKm, positionQuality, placeable, snap, publishedPosition, MIN_POINTS } = require('../src/modules/map/geoStats');
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

test('grille de 2 km : deux décimales ; position publiée selon le rôle, quel que soit le nombre de relevés', () => {
  assert.deepEqual(snap(-24.1222355, 45.3429061), { lat: -24.12, lng: 45.34 });
  const p = { lat: -24.1222355, lng: 45.3429061 };
  assert.deepEqual(publishedPosition({ ...p, n: 3 }, { precise: true }), { ...p, coarse: false });
  // Hors admin / gestionnaire : la médiane d'un petit effectif impair peut être un ménage (n = 5, 7 constatés).
  for (const n of [3, 4, 5, 7, 500]) {
    assert.deepEqual(publishedPosition({ ...p, n }, { precise: false }), { lat: -24.12, lng: 45.34, coarse: true }, `n = ${n}`);
  }
});

const site = (id, extra = {}) => ({ id, name: `Site ${id}`, code: id, hasGps: false, lat: null, lng: null, status: 'non_prevu', risk: 'elevee', districtPcode: 'MG1', cpcode: 'C1', visitsPlanned: 0, visitsPlannedRealised: 0, byData: false, ...extra });

test('couche de points : GPS, placé par ses collectes (≥ 3 relevés), centres de commune, notes', () => {
  const raw = {
    // Sites dessinables : GPS du registre (A) + candidats à une position déduite (B, C) ;
    // D (sans position, pas candidat) n'est compté que par commune, en SQL (communeSites).
    sites: [site('B'), site('C'), site('A', { hasGps: true, lat: -24.1, lng: 45.3, status: 'realise', visitsPlanned: 2, visitsPlannedRealised: 1 })],
    sitesCap: 3000,
    perimeter: { perimeter: 4, gps: 1 },
    communeSites: [{ cpcode: 'C2', n: 1, sites: [{ id: 'D', name: 'Site D' }] }],
    bySite: [{ key: 'B', n: 4, lat: -24.123456789, lng: 45.987654321, spreadKm: 0.5 }, { key: 'C', n: 2, lat: -24.2, lng: 45.2, spreadKm: 0 }, { key: 'A', n: 9, lat: 0, lng: 0, spreadKm: 0 }],
    byCommune: [{ key: 'C1', n: 12, lat: -24.3, lng: 45.4, spreadKm: 1.2 }, { key: 'C2', n: 7, lat: -24.4, lng: 45.5, spreadKm: 9 }],
    communes: [{ pcode: 'C1', name: 'Ebelo', district: 'Amboasary' }],
    collect: { mode: 'bins', bins: [{ lat: -24.12, lng: 45.34, n: 3 }], total: 3, rejected: 2, lastMonth: '2026-07' },
  };
  const r = buildPointsResponse(raw, { layers: ['gps', 'derived', 'communes', 'collect'], precise: false, maxAccuracyM: 100, limit: 2000 });
  assert.deepEqual(r.sites.map((s) => [s.id, s.kind]), [['A', 'gps'], ['B', 'collectes']]);
  assert.equal(r.sites[0].execution, 0.5);
  assert.deepEqual([r.communes[0].lat, r.communes[0].lng, r.communes[0].coarse], [-24.3, 45.4, true]);
  // B : 4 relevés → lecteur = grille de 2 km.
  assert.deepEqual([r.sites[1].lat, r.sites[1].lng, r.sites[1].coarse], [-24.12, 45.98, true]);
  // C : 2 relevés → pas placé (insuffisant) ; reste dans le centre de sa commune.
  assert.deepEqual(r.communes.map((c) => [c.name, c.sitesWithoutPosition, c.sites.map((s) => s.id)]), [['Ebelo', 1, ['C']]]);
  assert.deepEqual(r.notes, { insufficient: 1, scattered: 1 }); // C2 dispersée (9 km)
  assert.deepEqual(r.counts, { perimeter: 4, gpsTotal: 1, gps: 1, derived: 1, communeCentres: 1, sitesInCommuneCentres: 1, withoutPosition: 1 });
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

test('lecteur : positions déduites et centres de commune sur la grille de 2 km même avec n ≥ 5 ; admin : précises', () => {
  const raw = {
    sites: [site('B')], sitesCap: 3000, perimeter: { perimeter: 2, gps: 0 },
    communeSites: [{ cpcode: 'C1', n: 1, sites: [{ id: 'E', name: 'Site E' }] }],
    bySite: [{ key: 'B', n: 7, lat: -21.2031341, lng: 48.2250182, spreadKm: 0.3 }],
    byCommune: [{ key: 'C1', n: 5, lat: -25.192399, lng: 45.778324, spreadKm: 0.9 }],
    communes: [{ pcode: 'C1', name: 'Sihanamaro', district: 'Ambovombe' }], collect: null,
  };
  const v = buildPointsResponse(raw, { layers: ['gps', 'derived', 'communes'], precise: false, maxAccuracyM: 100, limit: 2000 });
  const decimals = (x) => (String(x).split('.')[1] || '').length;
  for (const p of [...v.sites, ...v.communes]) {
    assert.ok(decimals(p.lat) <= 2 && decimals(p.lng) <= 2, `${p.lat}, ${p.lng}`);
    assert.equal(p.coarse, true);
  }
  const a = buildPointsResponse(raw, { layers: ['gps', 'derived', 'communes'], precise: true, maxAccuracyM: 100, limit: 2000 });
  assert.deepEqual([a.sites[0].lat, a.communes[0].lat], [-21.203134, -25.192399]);
});

test('au-delà du plafond : comptes du périmètre COMPLET (sites sans position par commune) et troncature dite', () => {
  // 10 240 sites dont 3 001 GPS : la liste dessinée est tronquée à 3 000, pas les comptes.
  const gps = Array.from({ length: 3001 }, (_, i) => site(`G${String(i).padStart(4, '0')}`, { hasGps: true, lat: -24, lng: 45 }));
  const raw = {
    sites: [site('B'), ...gps], sitesCap: 3000, perimeter: { perimeter: 10240, gps: 3008 },
    communeSites: [{ cpcode: 'C1', n: 224, sites: Array.from({ length: 10 }, (_, i) => ({ id: `S${i}`, name: `Site S${i}` })) }],
    bySite: [{ key: 'B', n: 1, lat: -24.2, lng: 45.2, spreadKm: 0 }], // B pas placé (1 relevé) → revient dans sa commune
    byCommune: [{ key: 'C1', n: 40, lat: -24.3, lng: 45.4, spreadKm: 1 }],
    communes: [{ pcode: 'C1', name: 'Sakamasay' }], collect: null,
  };
  const r = buildPointsResponse(raw, { layers: ['gps', 'derived', 'communes'], precise: true, maxAccuracyM: 100, limit: 2000 });
  assert.equal(r.sitesTruncated, true);
  assert.equal(r.limits.sites, 3000);
  assert.equal(r.counts.perimeter, 10240);
  assert.equal(r.counts.gpsTotal, 3008);
  assert.equal(r.counts.gps, 2999, 'B (candidat) d\'abord, puis 2 999 sites GPS dessinés');
  assert.equal(r.communes[0].sitesWithoutPosition, 225);
  assert.equal(r.communes[0].sites.length, 10);
  assert.equal(r.counts.sitesInCommuneCentres, 225);
  assert.equal(r.counts.withoutPosition, 10240 - 3008 - 0 - 225);
});
