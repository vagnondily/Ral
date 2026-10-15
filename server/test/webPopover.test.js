const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Fenêtre flottante du sélecteur de période (retour 86) : placement pur de
// web/src/lib/popoverPlacement.js et garde-fous du composant (portail, position fixe).
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t) => {
  const file = webFile('lib', 'popoverPlacement.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

const VIEW = { width: 1400, height: 900 };
const anchorAt = (left, top, w = 140, h = 38) => ({ left, top, right: left + w, bottom: top + h });

test('sous le bouton quand la place suffit, aligné à gauche', async (t) => {
  const m = await load(t); if (!m) return;
  const r = m.placePopover({ anchor: anchorAt(460, 515), size: { width: 620, height: 300 }, viewport: VIEW });
  assert.equal(r.placement, 'below');
  assert.equal(r.top, 515 + 38 + 6);
  assert.equal(r.left, 460);
  assert.equal(r.maxHeight, null);
});

test('retour 86 : dans une fenêtre modale près du bas de l\'écran, la fenêtre passe au-dessus', async (t) => {
  const m = await load(t); if (!m) return;
  // Bouton « Période » de « Nouveau rapport » : 300 px sous lui, 470 px au-dessus.
  const r = m.placePopover({ anchor: anchorAt(465, 515), size: { width: 620, height: 380 }, viewport: { width: 1400, height: 860 } });
  assert.equal(r.placement, 'above');
  assert.equal(r.top, 515 - 6 - 380);
  assert.equal(r.maxHeight, null);
});

test('ramenée dans l\'écran : jamais au-delà du bord droit ni du bord gauche (marge 16 px)', async (t) => {
  const m = await load(t); if (!m) return;
  const right = m.placePopover({ anchor: anchorAt(1100, 100), size: { width: 620, height: 300 }, viewport: VIEW });
  assert.equal(right.left, 1400 - 16 - 620);
  const alignedRight = m.placePopover({ anchor: anchorAt(1200, 100, 180), size: { width: 620, height: 300 }, viewport: VIEW, align: 'right' });
  assert.equal(alignedRight.left, 1380 - 620);
  const left = m.placePopover({ anchor: anchorAt(80, 100), size: { width: 620, height: 300 }, viewport: VIEW, align: 'right' });
  assert.equal(left.left, 16);
});

test('écran étroit : largeur bornée à l\'écran moins les marges', async (t) => {
  const m = await load(t); if (!m) return;
  const r = m.placePopover({ anchor: anchorAt(20, 120), size: { width: 620, height: 400 }, viewport: { width: 390, height: 844 } });
  assert.equal(r.width, 390 - 32);
  assert.equal(r.left, 16);
});

test('ni dessous ni dessus : côté le plus grand, hauteur bornée (défilement interne), toujours dans l\'écran', async (t) => {
  const m = await load(t); if (!m) return;
  const r = m.placePopover({ anchor: anchorAt(400, 300), size: { width: 620, height: 900 }, viewport: { width: 1400, height: 700 } });
  assert.equal(r.placement, 'below'); // 350 px dessous contre 278 dessus
  assert.equal(r.maxHeight, 700 - 338 - 6 - 16);
  assert.ok(r.top + r.maxHeight <= 700 - 16);
  const up = m.placePopover({ anchor: anchorAt(400, 560), size: { width: 620, height: 900 }, viewport: { width: 1400, height: 700 } });
  assert.equal(up.placement, 'above');
  assert.ok(up.top >= 16);
  assert.ok(up.top + up.maxHeight <= 560 - 6);
});

test('défilement : ferme quand un conteneur du bouton défile, jamais pour un défilement dans la fenêtre', async (t) => {
  const m = await load(t); if (!m) return;
  const node = (children = []) => ({ nodeType: 1, contains(x) { return x === this || children.some((c) => c === x || (c.contains && c.contains(x))); } });
  const trigger = node();
  const body = node([trigger]); // corps de la fenêtre modale qui contient le bouton
  const list = node();
  const pop = node([list]);
  const other = node();
  assert.equal(m.scrollClosesPopover(body, trigger, pop), true);
  assert.equal(m.scrollClosesPopover({ nodeType: 9, contains: () => true }, trigger, pop), true); // document
  assert.equal(m.scrollClosesPopover(list, trigger, pop), false);
  assert.equal(m.scrollClosesPopover(pop, trigger, pop), false);
  assert.equal(m.scrollClosesPopover(other, trigger, pop), false);
  assert.equal(m.scrollClosesPopover(null, trigger, pop), false);
});

test('PeriodSelect : fenêtre dans un portail en position fixe, Tab gardé dans la fenêtre', (t) => {
  const file = webFile('components', 'PeriodSelect.jsx');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const src = fs.readFileSync(file, 'utf8');
  assert.match(src, /createPortal\(/);
  assert.match(src, /document\.body/);
  assert.match(src, /placePopover\(/);
  assert.match(src, /scrollClosesPopover\(/);
  assert.match(src, /aria-controls=/);
  assert.match(src, /e\.key !== 'Tab'/);
  const css = fs.readFileSync(webFile('styles.css'), 'utf8');
  assert.match(css, /\.pop-menu\.period-pop\.is-floating \{[^}]*position: fixed/);
  assert.match(css, /\.period-pop\.is-floating > \.period-cols \{[^}]*overflow-y: auto/);
  // Plus de position « absolue sous le bouton » propre à la variante droite ni de position téléphone figée.
  assert.doesNotMatch(css, /\.pop-menu\.period-pop\.is-right/);
});
