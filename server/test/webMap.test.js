/**
 * Bibliothèques PURES de la carte du suivi (web/src/lib/mapScale.js, mapProjection.js,
 * mapLabels.js — modules ES) testées ici comme webCharts.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const load = async (t, name) => {
  const file = path.join(__dirname, '../../web/src/lib', name);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('classes de % fixes : 0 · 1–24 · 25–49 · 50–79 · ≥ 80 (0 % distinct d\'« un peu »)', async (t) => {
  const m = await load(t, 'mapScale.js'); if (!m) return;
  const cls = (v) => m.classOf(v, m.PCT_BREAKS);
  assert.equal(cls(0), 0);
  assert.equal(cls(0.0062), 1);
  assert.equal(cls(0.249), 1);
  assert.equal(cls(0.25), 2);
  assert.equal(cls(0.5), 3);
  assert.equal(cls(0.799), 3);
  assert.equal(cls(0.8), 4);
  assert.equal(cls(1), 4);
  assert.equal(cls(null), null);
  assert.equal(cls(-0.1), null);
  assert.deepEqual(m.classLabels({ kind: 'pct' }), ['0', '1–24', '25–49', '50–79', '≥ 80']);
});

test('comptes : quantiles 20/40/60/80 % arrondis à la série 1-2-5, dédoublonnés, ≤ 5 classes', async (t) => {
  const m = await load(t, 'mapScale.js'); if (!m) return;
  assert.equal(m.nice125(1), 1);
  assert.equal(m.nice125(3), 2);
  assert.equal(m.nice125(4), 5);
  assert.equal(m.nice125(130), 100);
  assert.equal(m.nice125(322), 200);
  assert.deepEqual(m.countBreaks([]), [1]);
  assert.deepEqual(m.countBreaks([0, 0]), [1]);
  const b = m.countBreaks([3, 7, 15, 33, 54, 96, 110, 113, 116, 322]);
  assert.ok(b.length <= 5);
  assert.equal(b[0], 1);
  for (let i = 1; i < b.length; i += 1) assert.ok(b[i] > b[i - 1]);
  for (const v of b) assert.ok([1, 2, 5].includes(v / 10 ** Math.floor(Math.log10(v))), `${v} dans la série 1-2-5`);
  assert.deepEqual(m.classLabels({ kind: 'count', breaks: [1, 2, 5, 10] }, String), ['1', '2–4', '5–9', '≥ 10']);
});

test('formatRate : « 0 % », « 1,3 % », « 44 % » ; jamais « 0,0 % » pour un taux non nul ; anglais', async (t) => {
  const m = await load(t, 'mapScale.js'); if (!m) return;
  const nb = ' ';
  assert.equal(m.formatRate(0), `0${nb}%`);
  assert.equal(m.formatRate(17 / 1280), `1,3${nb}%`);
  assert.equal(m.formatRate(0.4444), `44${nb}%`);
  assert.equal(m.formatRate(1), `100${nb}%`);
  assert.equal(m.formatRate(0.0001), `< 0,1${nb}%`);
  assert.equal(m.formatRate(null), '—');
  assert.equal(m.formatRate(17 / 1280, 'en'), '1.3%');
});

test('rampes = valeurs validées (dataviz --ordinal) ; encre des pastilles lisible selon la classe, clair et sombre', async (t) => {
  const m = await load(t, 'mapScale.js'); if (!m) return;
  assert.deepEqual(m.RAMPS.blue.light, ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b']);
  assert.deepEqual(m.RAMPS.blue.dark, ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb']);
  assert.deepEqual(m.RAMPS.orange.light, ['#f2a074', '#ec7a45', '#d95926', '#ad3f14', '#7a2a0b']);
  assert.deepEqual(m.RAMPS.alert.light, ['#f2a074', '#d95926', '#7a2a0b']);
  for (const ramp of [m.RAMPS.blue.light, m.RAMPS.blue.dark, m.RAMPS.orange.light, m.RAMPS.orange.dark, m.RAMPS.alert.light, m.RAMPS.alert.dark]) {
    for (const c of ramp) assert.ok(m.contrast(c, m.inkOn(c)) >= 3, `${c} : ${m.contrast(c, m.inkOn(c)).toFixed(2)}`);
  }
  assert.equal(m.inkOn('#86b6ef'), m.INK); // classe claire : encre
  assert.equal(m.inkOn('#0d366b'), '#ffffff'); // classe foncée : blanc
});

test('valueOf / scaleFor : « — aucun plan » (np), gris sans site actif, alertes 0..2', async (t) => {
  const m = await load(t, 'mapScale.js'); if (!m) return;
  const z = { counts: { active: 116, realised: 0, submissions: 0 }, rates: { coverage: { value: 0, reason: null }, planning: { value: null, reason: 'aucun_plan' }, execution: { value: null, reason: 'aucun_plan' }, riskHigh: { value: 0.9 } }, alertLevel: 2 };
  assert.equal(m.valueOf('coverage', z), 0);
  assert.equal(m.valueOf('planning', z), 'np');
  assert.equal(m.valueOf('submissions', z), null);
  assert.equal(m.valueOf('active', z), 116);
  assert.equal(m.valueOf('alerts', z), 2);
  const none = { counts: { active: 0 }, rates: { coverage: { value: null, reason: 'aucun_site_actif' } } };
  assert.equal(m.valueOf('coverage', none), null);
  const s = m.scaleFor({ id: 'coverage', kind: 'pct', ramp: 'blue' }, [z]);
  assert.equal(s.fill(0), '#86b6ef');
  assert.equal(s.fill(null), null);
  const a = m.scaleFor({ id: 'alerts', kind: 'sev', ramp: 'alert' }, [z], { dark: true });
  assert.equal(a.fill(2), m.RAMPS.alert.dark[2]);
  const c = m.scaleFor({ id: 'active', kind: 'count', ramp: 'blue' }, [{ counts: { active: 3 } }, { counts: { active: 300 } }]);
  assert.equal(c.colors.length, c.breaks.length);
  assert.equal(c.fill(300), c.colors[c.colors.length - 1]);
});

test('fitTransform : la bbox remplit la fenêtre (marges comprises), inverse exact', async (t) => {
  const m = await load(t, 'mapProjection.js'); if (!m) return;
  const bbox = [43.2, -25.6, 50.5, -11.9];
  const tr = m.fitTransform(bbox, 800, 600, { top: 10, right: 10, bottom: 10, left: 10 });
  const [x0, y1] = tr.project(bbox[0], bbox[1]);
  const [x1, y0] = tr.project(bbox[2], bbox[3]);
  assert.ok(x0 >= 9.99 && x1 <= 790.01 && y0 >= 9.99 && y1 <= 590.01);
  assert.ok(Math.abs((y1 - y0) - 580) < 1e-6 || Math.abs((x1 - x0) - 780) < 1e-6, 'une dimension remplie');
  const [lng, lat] = tr.invert(...tr.project(46.7, -19.5));
  assert.ok(Math.abs(lng - 46.7) < 1e-9 && Math.abs(lat + 19.5) < 1e-9);
  assert.match(m.pathOf({ type: 'Polygon', coordinates: [[[44, -20], [45, -20], [45, -21], [44, -20]]] }, tr.project), /^M[\d.]+,[\d.]+L.*Z$/);
  // Calcul en ligne (paramètres de fitTransform) = projection générique, au caractère près.
  const multi = { type: 'MultiPolygon', coordinates: [[[[44.123, -20.987], [45.5, -20.2], [45.01, -21.33], [44.123, -20.987]]], [[[47.2, -15.1], [48, -15], [47.6, -16], [47.2, -15.1]]]] };
  const generic = (lng, lat) => tr.project(lng, lat);
  assert.equal(m.pathOf(multi, tr.project), m.pathOf(multi, generic));
  assert.equal((m.pathOf(multi, tr.project).match(/Z/g) || []).length, 2);
});

test('barre d\'échelle : longueur ronde, calculée à la latitude du centre, ≥ 70 px', async (t) => {
  const m = await load(t, 'mapProjection.js'); if (!m) return;
  const tr = m.fitTransform([43.2, -25.6, 50.5, -11.9], 800, 600);
  const sb = m.scaleBar(tr, -19);
  assert.ok([25, 50, 100, 200, 250].includes(sb.km), `${sb.km}`);
  assert.ok(sb.px >= 70);
  // Vérification au sol : sb.px pixels vers l'est à -19° ≈ sb.km (± 1 %).
  const [x, y] = tr.project(46, -19);
  const [lng2, lat2] = tr.invert(x + sb.px, y);
  const km = m.haversineKm([46, -19], [lng2, lat2]);
  assert.ok(Math.abs(km - sb.km) / sb.km < 0.01, `${km} vs ${sb.km}`);
  // Zoom × 4 : échelle plus courte.
  assert.ok(m.scaleBar(tr, -19, { zoom: 4 }).km < sb.km);
});

test('fond en ligne (tilesFor) : tuiles ≈ 256 px couvrant l\'emprise, zoom borné 1–17, aucune sans URL', async (t) => {
  const m = await load(t, 'mapProjection.js'); if (!m) return;
  const url = 'https://tiles.example/{z}/{x}/{y}.png';
  const bbox = [43.2, -25.6, 50.5, -11.9];
  const tiles = m.tilesFor({ bbox, widthPx: 800 }, url);
  assert.ok(tiles.length > 0 && tiles.length <= 64);
  const z = tiles[0].z;
  assert.ok(tiles.every((x) => x.z === z) && z >= 1 && z <= 17);
  // Couverture : l'union des tuiles contient l'emprise affichée.
  const w = Math.min(...tiles.map((x) => x.bbox[0])); const e = Math.max(...tiles.map((x) => x.bbox[2]));
  const s = Math.min(...tiles.map((x) => x.bbox[1])); const n = Math.max(...tiles.map((x) => x.bbox[3]));
  assert.ok(w <= bbox[0] && e >= bbox[2] && s <= bbox[1] && n >= bbox[3], `${[w, s, e, n]}`);
  // Taille à l'écran ≈ 256 px (facteur 2 au plus, l'arrondi du zoom).
  const px = ((tiles[0].bbox[2] - tiles[0].bbox[0]) / (bbox[2] - bbox[0])) * 800;
  assert.ok(px >= 128 && px <= 512, `${px}`);
  assert.equal(tiles[0].url, `https://tiles.example/${z}/${tiles[0].x}/${tiles[0].y}.png`);
  // Bornes de zoom : très petite emprise → 17 ; monde entier → 1.
  assert.equal(m.tilesFor({ bbox: [46, -19, 46.0001, -18.9999], widthPx: 800 }, url)[0].z, 17);
  assert.equal(m.tilesFor({ bbox: [-180, -80, 180, 80], widthPx: 300 }, url)[0].z, 1);
  // Jamais de rafale : plafond de tuiles respecté.
  assert.ok(m.tilesFor({ bbox, widthPx: 4000 }, url, { maxTiles: 10 }).length <= 10);
  // URL vide (VITE_MAP_TILES_URL="") ou largeur nulle : aucun fond, aucune requête.
  assert.deepEqual(m.tilesFor({ bbox, widthPx: 800 }, ''), []);
  assert.deepEqual(m.tilesFor({ bbox, widthPx: 0 }, url), []);
});

test('export (buildExportSvg) : titre, période, filtres, légende, nord, échelle, carte de situation, pied ; textes échappés ; aucune URL', async (t) => {
  const m = await load(t, 'mapExport.js'); if (!m) return;
  const sq = (x, y, d = 1) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
  const features = [
    { properties: { key: 'a', name: '<script>alert(1)</script>', label: [44.5, -24.5], bbox: [44, -25, 45, -24], area: 1 }, geometry: sq(44, -25) },
    { properties: { key: 'b', name: 'Bekily & Co', label: [45.5, -24.5], bbox: [45, -25, 46, -24], area: 1 }, geometry: sq(45, -25) },
    { properties: { key: 'c', name: 'Hors périmètre', label: [46.5, -20.5], bbox: [46, -21, 47, -20], area: 1 }, geometry: sq(46, -21) },
  ];
  const svg = m.buildExportSvg({
    title: 'Couverture du suivi — Couverture par district', subtitle: 'Période : Septembre 2026 · Bureau : Tous · Activité : Toutes',
    legendTitle: 'Couverture (%)', legend: [{ color: '#86b6ef', label: '0' }, { color: '#0d366b', label: '≥ 80' }],
    extras: [{ kind: 'empty', label: 'Aucun site actif' }, { kind: 'hatch', label: '— aucun plan' }, { kind: 'site', status: 'realise', label: 'Site visité' }],
    features, fills: { a: '#86b6ef', b: 'hatch' }, regions: { a: 'Androy', b: 'Androy', c: 'Anosy' }, withData: ['a', 'b'],
    points: { sites: [{ lng: 44.5, lat: -24.6, status: 'realise' }], bins: [{ lng: 45.52, lat: -24.48, n: 3 }] },
    footer: 'Source : registre des sites, visites et soumissions MEMS · période Sept. 2026 · calculé le 14/10/2026', locatorLabel: 'Carte de situation',
  });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1600" height="1100"/);
  for (const s of ['Couverture du suivi — Couverture par district', 'Septembre 2026', 'Bureau : Tous', 'Couverture (%)', '≥ 80', 'Aucun site actif',
    'id="x-locator"', 'Carte de situation', 'km</text>', '>N</text>', 'MEMS 2.0 · Suivi &amp; évaluation', 'calculé le 14/10/2026', 'url(#x-hatch)']) {
    assert.ok(svg.includes(s), s);
  }
  assert.ok(!svg.includes('<script>'), 'nom neutralisé');
  assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;') || !svg.includes('alert(1)'));
  assert.ok(svg.includes('Bekily &amp; Co'));
  assert.doesNotMatch(svg, /WFP|PAM/);
  assert.deepEqual([...svg.matchAll(/https?:\/\/[^"' )]+/g)].map((x) => x[0]), ['http://www.w3.org/2000/svg'], 'aucune URL externe, aucune tuile');
  assert.match(svg, /fill="#6250d6" fill-opacity="\.55"/); // points de collecte en mailles
  assert.equal(m.esc('"<a>"'), '&quot;&lt;a&gt;&quot;');
});

test('export : positions déduites, centres de commune et points de collecte TOUJOURS en maille de 2 km (quel que soit n) ; sites GPS du registre intacts', async (t) => {
  const m = await load(t, 'mapExport.js'); if (!m) return;
  const points = {
    sites: [
      { kind: 'gps', lat: -24.1234567, lng: 45.7654321, status: 'realise' },
      { kind: 'collectes', lat: -21.2031341, lng: 48.2250182, n: 7, status: 'prevu' },
    ],
    communes: [{ lat: -25.192399, lng: 45.778324, n: 5, sitesWithoutPosition: 12 }],
    collect: { mode: 'points', points: [{ lat: -24.7840622, lng: 45.1925514 }, { lat: -24.7841, lng: 45.1926 }] },
  };
  const out = m.exportPoints(points, { gps: true, derived: true, communes: true, collect: true });
  const decimals = (v) => (String(v).split('.')[1] || '').length;
  assert.deepEqual(out.sites[0], points.sites[0], 'site GPS du registre : position du lieu');
  for (const p of [out.sites[1], ...out.communes, ...out.bins]) assert.ok(decimals(p.lat) <= 2 && decimals(p.lng) <= 2, `${p.lat}, ${p.lng}`);
  assert.deepEqual([out.sites[1].lat, out.sites[1].lng], [-21.2, 48.22]);
  assert.equal(out.communes[0].n, 12);
  assert.deepEqual(out.bins, [{ lat: -24.78, lng: 45.2, n: 2 }]);
  assert.deepEqual(m.exportPoints(points, { gps: false, derived: false, communes: false, collect: false }), { sites: [], communes: [], bins: [] });
  assert.deepEqual(m.exportPoints(null, {}), { sites: [], communes: [], bins: [] });
});

test('étiquettes : aucun chevauchement, priorité aux grandes aires, hors cadre omises', async (t) => {
  const m = await load(t, 'mapLabels.js'); if (!m) return;
  const items = [
    { key: 'petit', x: 100, y: 100, text: 'Petit district', priority: 1 },
    { key: 'grand', x: 105, y: 102, text: 'Grand district', priority: 50 },
    { key: 'loin', x: 400, y: 300, text: 'Loin', priority: 2 },
    { key: 'dehors', x: 2, y: 2, text: 'Hors cadre', priority: 99 },
  ];
  const out = m.layoutLabels(items, { bounds: { width: 500, height: 400 } });
  assert.deepEqual(out.map((l) => l.key), ['grand', 'loin']);
  for (let i = 0; i < out.length; i += 1) for (let j = i + 1; j < out.length; j += 1) {
    const a = out[i].box; const b = out[j].box;
    assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
  }
});

test('couverture de la page (tuile, Bulletin) : chargement et erreur jamais confondus avec « aucun site actif »', async (t) => {
  const m = await load(t, 'mapScale.js'); if (!m) return;
  assert.deepEqual(m.coverageState(undefined), { state: 'loading', rate: null });
  assert.deepEqual(m.coverageState(null), { state: 'error', rate: null });
  assert.deepEqual(m.coverageState(false), { state: 'error', rate: null });
  const totals = (active, realised) => ({ totals: { counts: { active, realised, realisedData: 1 }, rates: { coverage: { value: active ? realised / active : null } } } });
  assert.deepEqual(m.coverageState(totals(0, 0)), { state: 'ok', rate: null, realised: 0, active: 0, realisedData: 1 });
  const ok = m.coverageState(totals(1280, 21));
  assert.equal(ok.state, 'ok');
  assert.match(m.formatRate(ok.rate, 'fr'), /^1,6\s%$/);
  assert.match(m.formatRate(0, 'fr'), /^0\s%$/, '0 % est une vraie valeur');
});
