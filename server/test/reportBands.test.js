/**
 * En-tête et pied LIBRES du concepteur (lot 7a C8, retour 88) — module web pur
 * (web/src/lib/reportBands.js), importé ici comme webCharts.test.js : chaque modèle prédéfini est
 * valide pour le SCHÉMA DU SERVEUR (avec et sans logo), un élément déplacé ou redimensionné reste
 * dans sa bande (mêmes règles que le serveur), aimantation sur la grille et sur les repères,
 * clavier, ordre d'empilement, hauteur de bande.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { schemas, parseDocV2 } = require('../src/modules/reports/reportSchema');

const load = async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/reportBands.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const LOGO = '11111111-1111-4111-8111-111111111111';
const LOGO2 = '22222222-2222-4222-8222-222222222222';
const ctx = { bodyW: 182, bandH: 20 };
const inBand = (e, bandH) => e.x >= 0 && e.x + e.w <= 100.001 && e.y >= 0 && e.y + e.h <= bandH + 0.001 && e.w >= 1 && e.h >= 2;

test('modèles prédéfinis : paires sobres (1re page + pages suivantes), valides pour le schéma du serveur, avec ou sans logo', async (t) => {
  const b = await load(t); if (!b) return;
  assert.ok(b.BAND_TEMPLATES.length >= 5);
  const names = b.BAND_TEMPLATES.map((x) => x.name);
  for (const n of ['Institutionnel sobre', 'Rapport bailleur', 'Note interne', 'Bulletin', 'Fiche 2 pages']) assert.ok(names.includes(n), n);
  for (const tpl of b.BAND_TEMPLATES) {
    for (const logos of [{}, { logo1: LOGO }, { logo1: LOGO, logo2: LOGO2 }]) {
      const pair = b.applyTemplate(tpl.key, logos);
      const { header, footer } = pair;
      schemas.band.parse(header); schemas.band.parse(footer);
      // Un modèle est une PAIRE : la mise en page entière (1re page comprise) passe le schéma du rapport.
      const doc = parseDocV2({ schemaVersion: 2, title: 'T', period: { from: '2026-09', to: '2026-09' }, page: pair, blocks: [] });
      assert.ok(doc.page.header.elements.length <= 20);
      assert.ok(['same', 'own', 'none'].includes(doc.page.firstPage));
      if (doc.page.firstPage === 'own') assert.ok(doc.page.firstHeader && doc.page.firstFooter, tpl.key);
      // Aucune couleur hors du format, aucun texte « WFP » / « PAM ».
      assert.doesNotMatch(JSON.stringify(pair), /WFP|\bPAM\b/);
      // Sans logo choisi, aucun logo n'est inventé : les emplacements restent vides.
      if (!logos.logo1) assert.ok(!JSON.stringify(pair).includes('"assetId":"'), tpl.key);
    }
  }
  // Logos : le 1er emplacement prend le logo déjà choisi ; un seul logo → le 2ᵉ (bailleur) reste à remplir.
  const two = b.applyTemplate('donor', { logo1: LOGO });
  const imgs = two.firstHeader.elements.filter((e) => e.kind === 'image');
  assert.deepEqual(imgs.map((e) => e.assetId), [LOGO, null]);
  // Règles de mise en forme : grand titre 18–24 pt sur la 1re page, en-tête courant ≤ 9 pt, pied ≤ 9 pt
  // avec « Page x sur y », tout dans la largeur du texte (x ≥ 0, x + l ≤ 100 %), aucun aplat saturé haut.
  for (const tpl of b.BAND_TEMPLATES.filter((x) => x.key !== 'footer-only')) {
    const p = b.applyTemplate(tpl.key, {});
    const title = p.firstHeader.elements.find((e) => e.text === '{titre}');
    assert.ok(title && title.style.size >= 18 && title.style.size <= 24, `${tpl.key} : titre ${title && title.style.size} pt`);
    for (const e of p.header.elements.filter((x) => x.style)) assert.ok(e.style.size <= 13, `${tpl.key} : en-tête courant ${e.style.size} pt`);
    for (const e of [...p.footer.elements, ...p.firstFooter.elements].filter((x) => x.style)) assert.ok(e.style.size <= 9, `${tpl.key} : pied ${e.style.size} pt`);
    for (const band of [p.header, p.footer, p.firstHeader, p.firstFooter]) {
      for (const e of band.elements) {
        assert.ok(inBand(e, band.height), `${tpl.key} ${e.id} dans sa bande`);
        assert.ok(!e.bleed, `${tpl.key} ${e.id} : aligné sur les marges du texte`);
        if (e.kind === 'rect') assert.ok(e.h <= 2, `${tpl.key} ${e.id} : pas d'aplat (barre fine seulement)`);
      }
    }
  }
  for (const tpl of b.BAND_TEMPLATES) {
    const p = b.applyTemplate(tpl.key, {});
    const pages = [...p.header.elements, ...p.footer.elements].filter((e) => e.kind === 'pageNumber');
    assert.ok(pages.length >= 1 || tpl.key === 'two-pager', `${tpl.key} : pagination`);
    for (const e of pages) assert.equal(e.format, 'Page n sur N');
  }
  // Textes traduits à l'application, variables intactes.
  const en = b.applyTemplate('institutional', { tr: (x) => (x === 'Édité le {date}' ? 'Issued on {date}' : x) });
  assert.ok(en.footer.elements.some((e) => e.text === 'Issued on {date}'));
  assert.ok(en.firstFooter.elements.some((e) => e.text === 'Issued on {date}'));
  assert.equal(b.applyTemplate('inconnu'), null);
});

test('déplacer : aimanté sur la grille (1 mm) ou sur les bords et centres des autres éléments, toujours dans la bande', async (t) => {
  const b = await load(t); if (!b) return;
  const e = { id: 't', kind: 'text', x: 0, y: 0, w: 20, h: 6, text: 'x' };
  const other = { id: 'o', kind: 'rect', x: 50, y: 4, w: 10, h: 8 };
  // Près du bord gauche de l'autre élément (91 mm) : collé dessus, repère affiché.
  const near = b.moveTo(e, 90.4, 3.2, { ...ctx, others: [other] });
  assert.equal(Math.round(b.toMm(near.element.x, 182) * 100) / 100, 91);
  assert.deepEqual(near.guides.v, [91]);
  // Loin de tout repère : grille de 1 mm.
  const free = b.moveTo(e, 20.4, 2.4, { ...ctx, others: [] });
  assert.equal(Math.round(b.toMm(free.element.x, 182)), 20);
  assert.equal(free.element.y, 2);
  assert.deepEqual(free.guides, { v: [], h: [] });
  // Le bas de l'élément près du milieu de la bande (10 mm) : aimanté, repère horizontal affiché.
  const mid = b.moveTo(e, 20.4, 3.6, { ...ctx, others: [] });
  assert.equal(mid.element.y, 4);
  assert.deepEqual(mid.guides.h, [10]);
  // Hors de la bande : ramené dedans.
  const out = b.moveTo(e, 300, 50, { ...ctx, others: [] });
  assert.ok(inBand(out.element, 20));
  assert.equal(out.element.x + out.element.w, 100);
  assert.equal(out.element.y + out.element.h, 20);
});

test('redimensionner : 8 poignées, bord opposé fixe, 4 mm × 3 mm au moins, jamais hors de la bande', async (t) => {
  const b = await load(t); if (!b) return;
  const e = { id: 'r', kind: 'rect', x: 10, y: 4, w: 20, h: 8 };
  const right = b.toMm(e.x + e.w, 182);
  const w = b.resizeBy(e, 'w', -5, 0, ctx); // bord gauche tiré de 5 mm vers la gauche
  assert.ok(Math.abs(b.toMm(w.x + w.w, 182) - right) < 0.05, 'bord droit fixe');
  const tiny = b.resizeBy(e, 'se', -500, -500, ctx);
  assert.ok(b.toMm(tiny.w, 182) >= b.MIN_W_MM - 0.02 && tiny.h >= b.MIN_H_MM);
  const huge = b.resizeBy(e, 'nw', -500, -500, ctx);
  assert.ok(inBand(huge, 20));
  assert.equal(huge.x, 0); assert.equal(huge.y, 0);
  for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) assert.ok(inBand(b.resizeBy(e, h, 37, 23, ctx), 20), h);
});

test('clavier, ordre d\'empilement, nouveaux éléments, hauteur de bande', async (t) => {
  const b = await load(t); if (!b) return;
  const e = { id: 't', kind: 'text', x: 10, y: 4, w: 20, h: 6, text: 'x' };
  assert.equal(b.nudge(e, 'ArrowDown', {}, ctx).y, 5);
  assert.equal(b.nudge(e, 'ArrowDown', { shift: true }, ctx).y, 9);
  assert.equal(b.nudge(e, 'ArrowDown', { alt: true }, ctx).h, 7);
  assert.equal(b.nudge(e, 'Enter', {}, ctx), null);
  assert.ok(inBand(b.nudge({ ...e, x: 80 }, 'ArrowRight', { shift: true }, ctx), 20));
  const els = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(b.reorder(els, 'a', 'front').map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(b.reorder(els, 'c', 'back').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(b.reorder(els, 'b', 'up').map((x) => x.id), ['a', 'c', 'b']);
  assert.equal(b.nextElementId('text', [{ id: 'text-1' }, { id: 'text-2' }]), 'text-3');
  for (const kind of ['text', 'image', 'rect', 'band', 'line', 'pageNumber']) {
    const n = b.newElement(kind, { ...ctx, elements: [] });
    assert.ok(inBand(n, 20), kind);
    schemas.band.parse({ height: 20, elements: [n] });
  }
  // Bandeau ajouté : barre fine sur la largeur du texte (bord à bord seulement si on le demande).
  const bar = b.newElement('band', { ...ctx });
  assert.equal(bar.bleed, undefined);
  assert.equal(bar.h, 2);
  // Bande abaissée : les éléments remontent ou rapetissent, jamais dehors ; vide → 0 possible.
  const band = { height: 20, elements: [{ id: 't', kind: 'text', x: 0, y: 14, w: 50, h: 6, text: 'x' }] };
  const low = b.setBandHeight(band, 8, ctx);
  assert.equal(low.height, 8);
  assert.ok(inBand(low.elements[0], 8));
  schemas.band.parse(low);
  assert.equal(b.setBandHeight({ elements: [] }, 0, ctx).height, 0);
  assert.equal(b.setBandHeight(band, 0, ctx).height, 4);
});

test('anglais : noms, descriptions et textes des modèles, noms des couleurs ont leur traduction', async (t) => {
  const b = await load(t); if (!b) return;
  const file = path.join(__dirname, '../../web/src/locales/en.js');
  const en = (await import(pathToFileURL(file).href)).default;
  const missing = new Set();
  const need = (s) => { if (s && !Object.prototype.hasOwnProperty.call(en, s)) missing.add(s); };
  for (const tpl of b.BAND_TEMPLATES) {
    need(tpl.name); need(tpl.description);
    const built = tpl.build({});
    const bands = [built.header, built.footer, built.firstHeader, built.firstFooter].filter(Boolean);
    for (const e of bands.flatMap((x) => x.elements)) {
      if (e.kind === 'text' && /[A-Za-zÀ-ÿ]/.test(e.text.replace(/\{[a-z_]{2,40}\}/g, ''))) need(e.text);
    }
  }
  b.BAND_COLORS.forEach(([, name]) => need(name));
  assert.deepEqual([...missing], [], `phrases sans anglais : ${[...missing].join(' | ')}`);
  // Traduction appliquée par applyTemplate ; un texte fait de variables seules n'est pas traduit.
  const tr = (s) => en[s] || s;
  const memo = b.applyTemplate('memo', { tr });
  assert.ok(memo.firstHeader.elements.some((e) => e.text === 'Internal memo'));
  assert.ok(memo.firstHeader.elements.some((e) => e.text === '{titre}'));
  assert.ok(memo.header.elements.some((e) => e.text === 'Internal memo · {titre}'));
});

test('schéma : élément d\'image vide (emplacement), bandeau bord à bord, trait vertical, en-tête PROPRE à une section', () => {
  const header = { height: 20, elements: [
    { id: 'logo', kind: 'image', x: 0, y: 1, w: 20, h: 14, assetId: null },
    { id: 'band', kind: 'rect', x: 0, y: 0, w: 100, h: 12, fill: '#0b5394', bleed: true },
    { id: 'sep', kind: 'line', x: 30, y: 2, w: 1, h: 16, dir: 'v', thickness: 0.5, color: '#ccd2dc' },
    { id: 'k', kind: 'text', x: 40, y: 2, w: 40, h: 4, text: 'Rapport officiel', style: { caps: true } },
  ] };
  const doc = parseDocV2({
    schemaVersion: 2, title: 'T', period: { from: '2026-09', to: '2026-09' }, page: { header },
    blocks: [{ id: 's', type: 'section', params: { orientation: 'landscape', header: 'own', headerBand: header, footer: 'none' } }],
  });
  assert.equal(doc.blocks[0].params.header, 'own');
  assert.equal(doc.page.header.elements[0].assetId, null);
  assert.throws(() => schemas.band.parse({ height: 10, elements: [{ id: 'x', kind: 'line', x: 0, y: 0, w: 10, h: 2, dir: 'oblique' }] }));
  assert.throws(() => schemas.band.parse({ height: 10, elements: [{ id: 'x', kind: 'image', x: 0, y: 0, w: 10, h: 2, assetId: 'pas-un-uuid' }] }));
});

test('paire 1re page / pages suivantes : régimes, copie à la demande, rien de perdu, anciens enregistrements lisibles', async (t) => {
  const b = await load(t); if (!b) return;
  const header = { height: 10, elements: [{ id: 't', kind: 'text', x: 0, y: 2, w: 60, h: 6, text: '{titre}' }] };
  const footer = { height: 8, elements: [{ id: 'p', kind: 'pageNumber', x: 70, y: 1, w: 30, h: 6 }] };
  const firstHeader = { height: 40, elements: [{ id: 'logo', kind: 'image', x: 0, y: 0, w: 20, h: 14, assetId: LOGO }] };
  // Clés de bande et zones.
  assert.equal(b.bandKey('first', 'header'), 'firstHeader');
  assert.equal(b.bandKey('first', 'footer'), 'firstFooter');
  assert.equal(b.bandKey('rest', 'footer'), 'footer');
  assert.deepEqual(b.zoneOf('firstFooter'), { pageKind: 'first', zone: 'footer' });
  assert.deepEqual(b.zoneOf('header'), { pageKind: 'rest', zone: 'header' });
  // « Propres » : COPIE des bandes des pages suivantes quand la 1re page n'en a pas (indépendante).
  const own = b.setFirstPageMode({ header, footer, firstPage: 'same' }, 'own');
  assert.equal(own.firstPage, 'own');
  assert.deepEqual(own.firstHeader, header);
  assert.notEqual(own.firstHeader, header);
  // Repasser à « identique » ou « page de titre » GARDE la 1re page dessinée (rien de perdu).
  const drawn = { header, footer, firstPage: 'own', firstHeader, firstFooter: footer };
  const same = b.setFirstPageMode(drawn, 'same');
  assert.equal(same.firstHeader, firstHeader);
  assert.equal(b.setFirstPageMode(same, 'own').firstHeader, firstHeader);
  // Bandes effectives : identique → celles des suivantes ; page de titre → aucune ; propre → les siennes.
  assert.equal(b.pairBands(same).first.header, header);
  assert.deepEqual(b.pairBands({ ...drawn, firstPage: 'none' }).first, { header: null, footer: null });
  assert.equal(b.pairBands(drawn).first.header, firstHeader);
  assert.equal(b.pairBands(drawn).rest.header, header);
  // Enregistrement ancien { header, footer } : paire à 1re page identique ; régime inconnu → identique.
  const old = b.pairOf({ header, footer });
  assert.equal(old.firstPage, 'same');
  assert.equal(old.firstHeader, undefined);
  assert.equal(b.pairOf({ header, footer, firstPage: 'bizarre' }).firstPage, 'same');
  assert.deepEqual(b.pairOf({ header, footer, firstPage: 'own' }).firstHeader, header);
  // Modèle appliqué au document : sans bandes de 1re page (« Pied de page seul », ancien { header, footer }),
  // la 1re page déjà dessinée est GARDÉE (masquée, régime du modèle) ; un modèle qui a les siennes les impose.
  const kept = b.applyPair(drawn, { header: footer, footer });
  assert.equal(kept.firstPage, 'same');
  assert.deepEqual([kept.header, kept.footer], [footer, footer]);
  assert.deepEqual([kept.firstHeader, kept.firstFooter], [firstHeader, footer]);
  assert.notEqual(kept.firstHeader, firstHeader, 'copie, jamais l\'objet du brouillon');
  assert.equal(b.setFirstPageMode(kept, 'own').firstHeader, kept.firstHeader, 'retour à « propre » : la 1re page dessinée revient');
  const ownTpl = b.applyPair(drawn, { header, footer, firstPage: 'own', firstHeader: footer, firstFooter: footer });
  assert.deepEqual(ownTpl.firstHeader, footer);
  assert.deepEqual(b.applyPair(drawn, { header, footer, firstPage: 'own' }).firstHeader, header, 'propre sans bandes : copie des suivantes (pairOf)');
  assert.deepEqual(b.applyPair({ header }, { header, footer }), b.pairOf({ header, footer }), 'brouillon sans 1re page : la paire du modèle');
  // Logos déjà choisis (1re page d'abord), sans doublon : repris par un modèle, jamais une image au hasard.
  assert.deepEqual(b.logosOf({ header: { elements: [{ kind: 'image', assetId: LOGO2 }, { kind: 'image', assetId: LOGO }] }, firstHeader }), [LOGO, LOGO2]);
  assert.deepEqual(b.logosOf({ header }), []);
  const withLogo = b.BAND_TEMPLATES.filter((x) => JSON.stringify(x.build({ logo1: LOGO })).includes(LOGO));
  assert.ok(withLogo.length >= 2, 'des modèles ont un emplacement de logo');
  for (const x of withLogo) {
    assert.ok(JSON.stringify(b.applyTemplate(x.key, { logo1: LOGO })).includes(LOGO), x.key);
    assert.ok(!JSON.stringify(b.applyTemplate(x.key, {})).includes('"assetId":"'), x.key);
  }
  // Un même logo n'occupe jamais deux emplacements d'une même bande.
  for (const x of b.BAND_TEMPLATES) {
    const p = b.applyTemplate(x.key, { logo1: LOGO, logo2: LOGO });
    const perBand = (band) => (band ? band.elements.filter((e) => e.kind === 'image' && e.assetId === LOGO).length : 0);
    for (const band of [p.header, p.footer, p.firstHeader, p.firstFooter]) assert.ok(perBand(band) <= 1, x.key);
  }
});

test('images d\'un rapport : le concepteur compte comme le serveur (même limite, mêmes bandes comptées) et avertit avant d\'appliquer', async (t) => {
  const b = await load(t); if (!b) return;
  const docMod = await import(pathToFileURL(path.join(__dirname, '../../web/src/pages/reports/reportDoc.js')).href);
  const { MAX_IMAGES, countedImageRefs } = require('../src/modules/reports/reportSchema');
  assert.equal(b.MAX_REPORT_IMAGES, MAX_IMAGES);
  const A = '6a0f2a47-5e5b-4c3b-9d7e-2f2d1f0a8b11';
  const logos = (n, p) => ({ height: 30, elements: [...Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, kind: 'image', x: i * 5, y: 1, w: 5, h: 10, assetId: A })), { id: `${p}v`, kind: 'image', x: 90, y: 1, w: 5, h: 10 }] });
  const img = (id) => ({ id, type: 'image', params: { assetId: A } });
  const sec = (id, header) => ({ id, type: 'section', params: { header, footer: 'own', headerBand: logos(2, `${id}h`), footerBand: logos(1, `${id}f`) } });
  const docs = [
    { page: { header: logos(6, 'h'), footer: logos(6, 'f') }, blocks: [img('i1')] },
    { page: { header: logos(1, 'h'), footer: logos(0, 'f'), firstPage: 'same', firstHeader: logos(9, 'a') }, blocks: [] },
    { page: { header: logos(1, 'h'), footer: logos(1, 'f'), firstPage: 'own', firstHeader: logos(3, 'a'), firstFooter: logos(2, 'b') }, blocks: [sec('s1', 'own'), sec('s2', 'inherit')] },
    { page: { header: logos(0, 'h') }, blocks: [{ id: 'r', type: 'repeat', params: { over: 'activity', blocks: [img('i2'), { id: 'c', type: 'columns', params: { ratio: '1:1', cols: [[img('i3')], [img('i4')]] } }] } }] },
  ];
  for (const d of docs) assert.equal(docMod.docImageCount(d), countedImageRefs(d).length, JSON.stringify(d.page.firstPage || 'same'));
  // Une paire de 12 logos sur un rapport qui a déjà un bloc image : 13 — le concepteur avertit.
  assert.equal(docMod.docImageCount(docs[0]), 13);
  assert.equal(b.layoutImageCount(docs[1].page), 1, '1re page masquée : non comptée');
  const hd = fs.readFileSync(path.join(__dirname, '../../web/src/pages/reports/editor/HeaderDesigner.jsx'), 'utf8');
  assert.match(hd, /if \(!imagesOk\(next\)\) return;/, 'avant d\'appliquer un modèle');
  assert.match(hd, /if \(imagesOk\(draft\)\) onApply\(draft\);/, 'avant « Appliquer »');
  const ed = fs.readFileSync(path.join(__dirname, '../../web/src/pages/reports/editor/ReportEditor.jsx'), 'utf8');
  assert.match(ed, /otherImages: docImageCount\(doc\) - layoutImageCount\(page\)/);
  const en = (await import(pathToFileURL(path.join(__dirname, '../../web/src/locales/en.js')).href)).default;
  const msg = hd.match(/tr\('(Le rapport compterait[^']+)'/)[1];
  assert.ok(en[msg], 'avertissement traduit');
});
