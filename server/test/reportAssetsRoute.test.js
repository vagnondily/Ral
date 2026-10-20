/**
 * Logos du concepteur (lot 7a C8, retour 88) : routes /api/report-designer/assets SANS base — le
 * dépôt est un espion qui garde les images par compte. On vérifie : 201 puis 200 (même octets,
 * même identifiant), format nommé → 400, > 512 Ko → 413, écriture réservée (403), compte lu dans
 * le jeton seulement (une image d'un autre compte → 404), en-têtes nosniff et CSP, image citée par
 * un rapport contrôlée dans le compte (400 sinon).
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-logos-du-concepteur-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const assetsRepo = require('../src/modules/reports/reportAssets.repository');
const reportsRepo = require('../src/modules/reports/reports.repository');
const routes = require('../src/modules/reports/reports.routes');
const { errorHandler, notFound, conflict } = require('../src/middleware/errors');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const store = new Map(); // tenant → Map(sha → asset)
assetsRepo.createAsset = async (tenantId, a, userId) => {
  if (!store.has(tenantId)) store.set(tenantId, new Map());
  const m = store.get(tenantId);
  if (m.has(a.sha256)) return { asset: m.get(a.sha256).meta, created: false };
  const meta = { id: crypto.randomUUID(), mime: a.mime, width: a.width, height: a.height, bytes: a.bytes, name: a.name, createdBy: userId };
  m.set(a.sha256, { meta, data: a.data });
  return { asset: meta, created: true };
};
assetsRepo.listAssets = async (tenantId) => [...(store.get(tenantId) || new Map()).values()].map((x) => x.meta);
assetsRepo.getAssetData = async (tenantId, id) => {
  const hit = [...(store.get(tenantId) || new Map()).values()].find((x) => x.meta.id === id);
  if (!hit) throw notFound('Image introuvable');
  return { mime: hit.meta.mime, data: hit.data };
};
assetsRepo.existingAssetIds = async (tenantId, ids) => new Set(ids.filter((id) => [...(store.get(tenantId) || new Map()).values()].some((x) => x.meta.id === id)));
reportsRepo.listOffices = async () => [];
const bandStore = new Map(); // tenant → [{ id, name, content }]
assetsRepo.listBandTemplates = async (tenantId) => bandStore.get(tenantId) || [];
assetsRepo.createBandTemplate = async (tenantId, { name, content }) => {
  const list = bandStore.get(tenantId) || [];
  if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw conflict('Un en-tête enregistré porte déjà ce nom.');
  const row = { id: crypto.randomUUID(), name, content };
  bandStore.set(tenantId, [...list, row]);
  return row;
};

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.log = { info() {}, error() {} }; next(); });
app.use('/api/report-designer', routes);
app.use(errorHandler);
const tok = (tenantId, role) => `Bearer ${jwt.sign({ sub: `u-${role}`, tenantId, role }, process.env.JWT_SECRET)}`;

function png(width, height, pad = 0) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(pad)]);
}
const upload = (buf, auth = tok(A, 'admin'), name = 'logo.png') => request(app).post(`/api/report-designer/assets?name=${encodeURIComponent(name)}`)
  .set({ Authorization: auth, 'Content-Type': 'application/octet-stream' }).send(buf);

test('téléversement : 201 puis 200 pour les mêmes octets (une seule copie), dimensions lues', async () => {
  const r1 = await upload(png(400, 120));
  assert.equal(r1.status, 201);
  assert.deepEqual([r1.body.mime, r1.body.width, r1.body.height, r1.body.name], ['image/png', 400, 120, 'logo.png']);
  const r2 = await upload(png(400, 120), tok(A, 'manager'), 'autre nom');
  assert.equal(r2.status, 200);
  assert.equal(r2.body.id, r1.body.id);
  const list = await request(app).get('/api/report-designer/assets').set({ Authorization: tok(A, 'viewer') });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
});

test('refus : format nommé (400), trop lourd (413), vide (400), rôle lecteur (403)', async () => {
  const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'));
  assert.equal(svg.status, 400);
  assert.match(svg.body.error, /image SVG/);
  assert.equal(svg.body.details.code, 'format');
  const big = await upload(png(100, 100, 530 * 1024));
  assert.equal(big.status, 413);
  assert.match(big.body.error, /512 Ko/);
  const empty = await upload(Buffer.alloc(0));
  assert.equal(empty.status, 400);
  const viewer = await upload(png(10, 10), tok(A, 'viewer'));
  assert.equal(viewer.status, 403);
});

test('lecture : en-têtes nosniff et CSP, type déduit des octets ; image d\'un autre compte → 404', async () => {
  const up = await upload(png(64, 32, 10));
  const got = await request(app).get(`/api/report-designer/assets/${up.body.id}`).set({ Authorization: tok(A, 'viewer') });
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.equal(got.headers['x-content-type-options'], 'nosniff');
  assert.equal(got.headers['content-security-policy'], "default-src 'none'");
  assert.match(got.headers['cache-control'], /private/);
  const other = await request(app).get(`/api/report-designer/assets/${up.body.id}`).set({ Authorization: tok(B, 'admin') });
  assert.equal(other.status, 404);
  const bad = await request(app).get('/api/report-designer/assets/pas-un-uuid').set({ Authorization: tok(A, 'admin') });
  assert.equal(bad.status, 400);
});

test('un rapport ne cite que des images de SON compte (logo d\'un autre compte → 400)', async () => {
  const up = await upload(png(80, 40, 20));
  const header = (assetId) => ({ height: 14, elements: [{ id: 'logo', kind: 'image', x: 0, y: 1, w: 20, h: 12, assetId }] });
  const doc = (assetId) => ({ schemaVersion: 2, title: 'R', period: { from: '2026-09', to: '2026-09' }, page: { header: header(assetId) }, blocks: [] });
  const okPlan = await request(app).post('/api/report-designer/render/plan').set({ Authorization: tok(A, 'viewer') }).send({ doc: doc(up.body.id) });
  assert.equal(okPlan.status, 200);
  const foreign = await request(app).post('/api/report-designer/render/plan').set({ Authorization: tok(B, 'viewer') }).send({ doc: doc(up.body.id) });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.details.code, 'asset_missing');
  // 1re page « identique » (bandes gardées mais masquées) : une image inconnue ou d'un autre compte y
  // est refusée quand même — elle ne ressurgirait qu'au passage à « propre », sous un nom jamais choisi.
  const hidden = (assetId) => ({ ...doc(up.body.id), page: { header: header(up.body.id), firstPage: 'same', firstHeader: header(assetId) } });
  const unknown = await request(app).post('/api/report-designer/render/plan').set({ Authorization: tok(A, 'viewer') }).send({ doc: hidden('9a7b6c5d-4e3f-4a1b-8c2d-0e1f2a3b4c5d') });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.details.code, 'asset_missing');
  const other = await request(app).post('/api/report-designer/render/plan').set({ Authorization: tok(B, 'viewer') }).send({ doc: { ...hidden(up.body.id), page: { firstPage: 'none', firstHeader: header(up.body.id) } } });
  assert.equal(other.status, 400);
  assert.equal(other.body.details.code, 'asset_missing');
  assert.equal((await request(app).post('/api/report-designer/render/plan').set({ Authorization: tok(A, 'viewer') }).send({ doc: hidden(up.body.id) })).status, 200);
});

test('« mes en-têtes » : enregistré par compte, validé par le schéma des bandes, logos du compte seulement, nom unique', async () => {
  const logo = (await upload(png(90, 30, 30))).body.id;
  const header = { height: 18, elements: [{ id: 'logo', kind: 'image', x: 0, y: 1, w: 20, h: 14, assetId: logo }, { id: 't', kind: 'text', x: 25, y: 4, w: 75, h: 7, text: '{titre}' }] };
  const footer = { height: 10, elements: [{ id: 'p', kind: 'pageNumber', x: 70, y: 2, w: 30, h: 6 }] };
  const post = (body, auth = tok(A, 'admin')) => request(app).post('/api/report-designer/band-templates').set({ Authorization: auth }).send(body);
  const ok = await post({ name: 'Bandeau du bureau', header, footer });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.content.header.elements[0].assetId, logo);
  assert.equal((await post({ name: 'bandeau DU bureau', header, footer })).status, 409);
  // Élément hors de la bande, propriété inconnue, nom vide : 400.
  assert.equal((await post({ name: 'X', header: { height: 10, elements: [{ id: 't', kind: 'text', x: 90, y: 0, w: 20, h: 6, text: 'x' }] }, footer })).status, 400);
  assert.equal((await post({ name: 'X', header, footer, extra: 1 })).status, 400);
  assert.equal((await post({ name: '  ', header, footer })).status, 400);
  // Le logo d'un autre compte : refusé ; un lecteur ne peut pas enregistrer.
  const foreign = await post({ name: 'Autre', header, footer }, tok(B, 'admin'));
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.details.code, 'asset_missing');
  assert.equal((await post({ name: 'Lecteur', header, footer }, tok(A, 'viewer'))).status, 403);
  // PAIRE 1re page / pages suivantes : enregistrée telle quelle ; un régime inconnu ou un logo étranger
  // dans la bande de la 1re page est refusé.
  const pair = await post({ name: 'Paire du bureau', header: footer, footer, firstPage: 'own', firstHeader: header, firstFooter: footer });
  assert.equal(pair.status, 201);
  assert.equal(pair.body.content.firstPage, 'own');
  assert.equal(pair.body.content.firstHeader.elements[0].assetId, logo);
  assert.equal((await post({ name: 'Y', header, footer, firstPage: 'parfois' })).status, 400);
  const foreignFirst = await post({ name: 'Z', header: footer, footer, firstPage: 'own', firstHeader: header }, tok(B, 'admin'));
  assert.equal(foreignFirst.status, 400);
  assert.equal(foreignFirst.body.details.code, 'asset_missing');
  const list = await request(app).get('/api/report-designer/band-templates').set({ Authorization: tok(A, 'viewer') });
  assert.deepEqual(list.body.map((x) => x.name), ['Bandeau du bureau', 'Paire du bureau']);
  const other = await request(app).get('/api/report-designer/band-templates').set({ Authorization: tok(B, 'viewer') });
  assert.deepEqual(other.body, []);
});

test('« mes en-têtes » : au plus MAX_IMAGES logos sur la paire (bandes de la 1re page comptées si affichées), message clair', async () => {
  const { MAX_IMAGES, imageRefs, safeParseDocV2 } = require('../src/modules/reports/reportSchema');
  const logo = (await upload(png(80, 20, 10))).body.id;
  const logos = (n, prefix) => ({ height: 30, elements: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, kind: 'image', x: i * 5, y: 1, w: 5, h: 10, assetId: logo })) });
  const post = (body) => request(app).post('/api/report-designer/band-templates').set({ Authorization: tok(A, 'admin') }).send(body);
  // 6 + 6 = 12 : accepté ; 6 + 6 + 1 sur la 1re page affichée : refusé avec le compte.
  assert.equal((await post({ name: 'Douze logos', header: logos(6, 'h'), footer: logos(6, 'f') })).status, 201);
  const over = await post({ name: 'Treize logos', header: logos(6, 'h'), footer: logos(6, 'f'), firstPage: 'own', firstHeader: logos(1, 'a') });
  assert.equal(over.status, 400);
  assert.deepEqual(over.body.details, { code: 'too_many_images', count: 13, max: MAX_IMAGES });
  assert.match(over.body.error, /Trop d'images dans cet en-tête : 13 logos \(12 au plus/);
  // Bandes de la 1re page gardées mais masquées (« identique ») : ne comptent pas.
  assert.equal((await post({ name: 'Masquées', header: logos(6, 'h'), footer: logos(6, 'f'), firstPage: 'same', firstHeader: logos(10, 'a') })).status, 201);
  // Dans un document : même règle (countedImageRefs ne compte la 1re page que si elle est propre) ;
  // le contrôle d'existence (imageRefs) lit, lui, toutes les bandes.
  const { countedImageRefs } = require('../src/modules/reports/reportSchema');
  const page = { size: 'A4', orientation: 'portrait', header: logos(6, 'h'), footer: logos(6, 'f'), firstPage: 'same', firstHeader: logos(10, 'a'), draftWatermark: true };
  const doc = { schemaVersion: 2, title: 'T', period: { from: '2026-01', to: '2026-01' }, filters: {}, page, blocks: [] };
  assert.equal(countedImageRefs(doc).length, 12);
  assert.equal(imageRefs(doc).length, 22, 'existence : 1re page masquée comprise');
  // Bandes d'une section : comptées si la section a les siennes ; toujours contrôlées.
  const sec = (header) => ({ id: `s-${header}`, type: 'section', params: { header, footer: 'inherit', headerBand: logos(3, 'x') } });
  const withSections = { ...doc, blocks: [sec('own'), sec('inherit')] };
  assert.equal(countedImageRefs(withSections).length, 15);
  assert.equal(imageRefs(withSections).length, 28);
  assert.equal(safeParseDocV2(doc).success, true);
  assert.equal(safeParseDocV2({ ...doc, page: { ...page, firstPage: 'own' } }).success, false, '1re page propre : 22 images');
});
