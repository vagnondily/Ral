/**
 * Grand titre « sur plusieurs lignes » d'un en-tête dessiné (retour 112, relecture du 16/10) —
 * contrôle d'IMPRESSION dans Chromium sans tête, sur demande : lancé quand Playwright et Chromium
 * sont présents (mêmes chemins que web/scripts/sweep-ecrans.cjs : PLAYWRIGHT, CHROMIUM), ignoré sinon.
 *
 * Avant : le texte était calé en BAS de son cadre et coupé à 3 lignes : quand il en fallait une 3ᵉ
 * dans un cadre de ~2 lignes, il débordait vers le HAUT et la PREMIÈRE ligne du titre disparaissait
 * à l'impression. Maintenant : calé en haut, nombre de lignes = ce que le cadre contient
 * (reportBands.wrapLines), la dernière visible finit par « … ». Feuille de style réelle
 * (web/src/pages/reports/reports.css), même style en ligne que ReportBlocks.Band.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PW = process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const CSS = path.join(__dirname, '../../web/src/pages/reports/reports.css');
const BANDS = path.join(__dirname, '../../web/src/lib/reportBands.js');
const BLOCKS = path.join(__dirname, '../../web/src/pages/reports/ReportBlocks.jsx');
const SKIP = fs.existsSync(PW) && fs.existsSync(CHROME) && fs.existsSync(CSS) ? false : 'Playwright / Chromium absents (contrôle d\'impression sur demande)';

const LONG = 'Rapport trimestriel de suivi des activités de cantine scolaire, de nutrition et de résilience dans les districts du Sud — bilan consolidé des visites et données reçues';
const T200 = `${LONG} ${'x'.repeat(200)}`.slice(0, 200);

test('cadre à son nombre de lignes : floor(h ÷ (taille × 0,3528 × 1,12)), au moins 1 ; posé par la bande', async (t) => {
  if (!fs.existsSync(BANDS)) { t.skip('web/ absent'); return; }
  const { wrapLines } = await import(pathToFileURL(BANDS).href);
  assert.equal(wrapLines(16, 18), 2, '« Note interne » : 16 mm à 18 pt');
  assert.equal(wrapLines(21.3, 18), 2, '2 lignes = 14,2 mm, 3 lignes = 21,34 mm');
  assert.equal(wrapLines(22, 18), 3);
  assert.equal(wrapLines(3, 18), 1, 'jamais 0');
  assert.equal(wrapLines(0, 18), 1);
  assert.equal(wrapLines(10, 0), 1);
  const src = fs.readFileSync(BLOCKS, 'utf8');
  assert.match(src, /WebkitLineClamp: wrapLines\(e\.h, st\.size \|\| 8\)/, 'ReportBlocks pose le nombre de lignes du cadre');
  const css = fs.readFileSync(CSS, 'utf8');
  assert.match(css, /\.rd-el-text\.is-wrap \{ align-items: flex-start;/, 'calé en haut');
  assert.match(css, /\.rd-el-text\.is-wrap > span \{[^}]*text-overflow: ellipsis;/);
});

test('impression : titre de 200 caractères dans le cadre « Note interne » — première ligne entière, rien hors du cadre, « … » au bout', { skip: SKIP, timeout: 60000 }, async () => {
  const { chromium } = require(PW);
  const { wrapLines } = await import(pathToFileURL(BANDS).href);
  const css = fs.readFileSync(CSS, 'utf8');
  // Bande A4 portrait (largeur imprimable 182 mm) ; cadre du modèle « Note interne » : x 0, y 6 mm, l 76 %, h 16 mm, 18 pt gras.
  const el = (id, text, h) => `<div id="${id}" class="rd-el rd-el-text is-wrap" style="left:0%;top:6mm;width:76%;height:${h}mm;font-family:Inter, Arial, sans-serif;font-size:18pt;font-weight:700;justify-content:flex-start">`
    + `<span style="-webkit-line-clamp:${wrapLines(h, 18)}">${text}</span></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">
    <div class="rd-band" style="width:182mm;height:30mm">${el('long', T200, 16)}</div>
    <div class="rd-band" style="width:182mm;height:30mm">${el('court', 'Bilan de septembre', 16)}</div>
    <div class="rd-band" style="width:182mm;height:30mm">${el('haut', T200, 22)}</div></body></html>`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html);
    const measure = (id) => page.evaluate((x) => {
      const box = document.getElementById(x);
      const span = box.firstElementChild;
      const range = document.createRange();
      range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 1);
      const b = box.getBoundingClientRect(); const s = span.getBoundingClientRect(); const first = range.getBoundingClientRect();
      return { boxTop: b.top, boxBottom: b.bottom, spanTop: s.top, spanBottom: s.bottom, firstTop: first.top, firstBottom: first.bottom,
        clamp: getComputedStyle(span).webkitLineClamp, truncated: span.scrollHeight > span.clientHeight + 1 };
    }, id);
    for (const [id, h, truncated] of [['long', 16, true], ['court', 16, false], ['haut', 22, true]]) {
      const m = await measure(id);
      assert.equal(m.clamp, String(wrapLines(h, 18)), `${id} : lignes du cadre`);
      // Première ligne : son premier caractère dans le cadre (le rectangle d'un glyphe déborde un peu de
      // l'interligne : on lit son milieu) ; le bloc de texte commence au haut du cadre.
      const mid = (m.firstTop + m.firstBottom) / 2;
      assert.ok(mid > m.boxTop && mid < m.boxBottom && mid - m.boxTop < (m.boxBottom - m.boxTop) / 2, `${id} : première ligne dans le cadre (${JSON.stringify(m)})`);
      assert.ok(m.spanTop >= m.boxTop - 0.5 && m.spanBottom <= m.boxBottom + 0.5, `${id} : texte dans le cadre (${JSON.stringify(m)})`);
      assert.equal(m.truncated, truncated, `${id} : coupé à la dernière ligne visible`);
    }
  } finally { await browser.close(); }
});
