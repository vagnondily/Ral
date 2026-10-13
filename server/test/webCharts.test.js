const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Axes des graphiques du front (web/src/lib/chartAxis.js, module ES pur) testés
// ici, comme webSafety.test.js : le front n'a pas encore de suite de tests propre.
const webLib = (name) => path.join(__dirname, '../../web/src/lib', name);
const load = async (t, name) => {
  const file = webLib(name);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

// Géométrie de TrendChart : points régulièrement espacés entre les marges, étiquette de 11 px.
const axis = (n, width, { padL = 34, padR = 10 } = {}) => {
  const plotW = width - padL - padR;
  return Array.from({ length: n }, (_, i) => padL + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2));
};
// Largeurs proches du rendu réel (« sept. 26 » ≈ 46 px, « mai 26 » ≈ 38 px, gras ≈ +6 %).
const FR = ['janv. 26', 'févr. 26', 'mars 26', 'avr. 26', 'mai 26', 'juin 26', 'juil. 26', 'août 26', 'sept. 26', 'oct. 26', 'nov. 26', 'déc. 26'];
const widthsFor = (n, sel = n - 1) => Array.from({ length: n }, (_, i) => Math.ceil(FR[i % 12].length * 5.8 * (i === sel ? 1.06 : 1)));
const assertNoOverlap = (ticks, width, gap, msg) => {
  const boxes = [...ticks].sort((a, b) => a.left - b.left);
  for (let j = 1; j < boxes.length; j += 1) {
    assert.ok(boxes[j - 1].right + gap <= boxes[j].left + 1e-9, `${msg} : ${boxes[j - 1].index} touche ${boxes[j].index}`);
  }
  for (const b of boxes) assert.ok(b.left >= -1e-9 && b.right <= width + 1e-9, `${msg} : ${b.index} sort du graphique`);
};

test('labelBox : centrée, alignée sur le bord gauche ou droit pour ne jamais sortir', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  assert.deepEqual(m.labelBox(100, 40, 300), { anchor: 'middle', left: 80, right: 120 });
  assert.deepEqual(m.labelBox(10, 40, 300), { anchor: 'start', left: 10, right: 50 });
  assert.deepEqual(m.labelBox(290, 40, 300), { anchor: 'end', left: 250, right: 290 });
});

test('pickTicks : le dernier mois, aligné à droite, ne chevauche plus sa voisine (retour : « juin 26 » / « sept. 26 » à 1 308–1 344 px)', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  // Carte de 640 px, 12 mois : 54 px entre deux points. L'ancien calcul (52 px par étiquette)
  // gardait les 12 étiquettes ; « déc. 26 », alignée à droite, s'étendait de toute sa largeur sur « nov. 26 ».
  const width = 640;
  const xs = axis(12, width);
  const ticks = m.pickTicks(xs, widthsFor(12), { width, forced: [11, 11], gap: 8 });
  const ix = ticks.map((k) => k.index);
  assert.ok(ix.includes(11), 'le mois choisi (dernier) toujours étiqueté');
  assert.ok(!ix.includes(10), 'sa voisine trop proche est retirée');
  assert.equal(ticks.find((k) => k.index === 11).anchor, 'end');
  assertNoOverlap(ticks, width, 8, '640 px');
});

test('pickTicks : aucune paire d\'étiquettes ne se touche, à toutes les largeurs, mois choisi au bout ou au milieu', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  for (let width = 160; width <= 2000; width += 6) {
    for (const n of [1, 2, 6, 12, 13, 24]) {
      for (const sel of [n - 1, Math.floor(n / 2), 0]) {
        const xs = axis(n, width);
        const ticks = m.pickTicks(xs, widthsFor(n, sel), { width, forced: [sel, n - 1], gap: 8 });
        const msg = `${width} px, ${n} points, mois choisi ${sel}`;
        assertNoOverlap(ticks, width, 8, msg);
        assert.ok(ticks.some((k) => k.index === sel), `${msg} : mois choisi étiqueté`);
        const ix = ticks.map((k) => k.index);
        assert.deepEqual(ix, [...new Set(ix)].sort((a, b) => a - b), `${msg} : index uniques et croissants`);
      }
    }
  }
});

test('pickTicks : pas régulier loin des étiquettes forcées, tout montré quand la place suffit', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  // Large : 12 mois sur 1 400 px, rien n'est retiré.
  const wide = m.pickTicks(axis(12, 1400), widthsFor(12), { width: 1400, forced: [11], gap: 8 });
  assert.deepEqual(wide.map((k) => k.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  // Étroit : les étiquettes non forcées gardent un pas régulier, ancré sur le dernier mois.
  const narrow = m.pickTicks(axis(12, 360), widthsFor(12), { width: 360, forced: [11], gap: 8 }).map((k) => k.index);
  const regular = narrow.filter((i) => i !== 11);
  const steps = new Set(regular.slice(1).map((v, i) => v - regular[i]));
  assert.ok(regular.length >= 2 && steps.size === 1, `pas régulier : ${narrow}`);
  assert.equal((11 - regular[0]) % [...steps][0], 0, 'ancré sur le dernier mois');
  // Carte étroite de la Synthèse (255 px) : à nombre égal d'étiquettes, le pas régulier jusqu'au
  // bout (avr., août, déc.) l'emporte sur un pas plus court dont la voisine du dernier mois est retirée.
  assert.deepEqual(m.pickTicks(axis(12, 255), widthsFor(12), { width: 255, forced: [11, 11], gap: 8 }).map((k) => k.index), [3, 7, 11]);
  // Plus étroit que deux étiquettes : seulement le mois choisi.
  assert.deepEqual(m.pickTicks(axis(12, 60), widthsFor(12), { width: 60, forced: [11], gap: 8 }).map((k) => k.index), [11]);
  assert.deepEqual(m.pickTicks([], [], { width: 300 }), []);
});

test('pickTicks : priorité des étiquettes forcées — le mois choisi l\'emporte sur un dernier mois trop proche', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  const xs = [20, 60, 100];                         // 40 px entre deux points, étiquettes de 46 px
  const ticks = m.pickTicks(xs, [46, 46, 46], { width: 120, forced: [1, 2], gap: 8 });
  assert.deepEqual(ticks.map((k) => k.index), [1]);
  // Index hors bornes ou absents (mois choisi hors de la série : -1) ignorés.
  assert.deepEqual(m.pickTicks(xs, [20, 20, 20], { width: 120, forced: [-1, 7, 2], gap: 8 }).map((k) => k.index), [0, 1, 2]);
});

test('yScale : maximum « rond » et graduations régulières ; maximum imposé (indice /100)', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  assert.deepEqual(m.yScale(137), { max: 150, ticks: [0, 50, 100, 150] });
  assert.deepEqual(m.yScale(12), { max: 15, ticks: [0, 5, 10, 15] });
  assert.deepEqual(m.yScale(0), { max: 3, ticks: [0, 1, 2, 3] });
  assert.deepEqual(m.yScale(2), { max: 3, ticks: [0, 1, 2, 3] }); // comptages : pas de graduation 0,5
  assert.deepEqual(m.yScale(64, { fixedMax: 100, intervals: 4 }), { max: 100, ticks: [0, 25, 50, 75, 100] });
  assert.equal(m.niceStep(0.3, { integer: false }), 0.5);
  assert.equal(m.niceStep(45.7), 50);
});
