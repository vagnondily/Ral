const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLink, onaApiOrigins, onaDataUrl, koboDataUrl, collectPages, normalizeOnaRecord, maxId } = require('../src/modules/monitoring/dataLinks');
const { isPrivateIp, assertAllowedUrl, safeFetch } = require('../src/modules/monitoring/remoteFetch');
const { nextFromLink } = require('../src/modules/monitoring/dataLinks.service');

test('lien Tableau WDC MoDA → open-data Ona (uuid extrait)', () => {
  const l = classifyLink('https://moda.wfp.org/tableau-web-data-connector/fb8e29158ebc45a9be122fa8caae6d0a');
  assert.deepEqual(l, { kind: 'ona-open-data', origin: 'https://moda.wfp.org', uuid: 'fb8e29158ebc45a9be122fa8caae6d0a' });
  assert.equal(classifyLink('https://api.ona.io/api/v2/open-data/24fde84caec342a19a7f2e3ea0c36e3f/data').uuid, '24fde84caec342a19a7f2e3ea0c36e3f');
  assert.deepEqual(onaApiOrigins('https://moda.wfp.org'), ['https://moda.wfp.org', 'https://api.moda.wfp.org']);
  assert.equal(onaDataUrl('https://moda.wfp.org', 'abc', { page: 2, pageSize: 1000, gtId: 41 }),
    'https://moda.wfp.org/api/v2/open-data/abc/data?gt_id=41&page=2&page_size=1000');
});

test('liens Kobo (API et interface) et export fichier', () => {
  assert.deepEqual(classifyLink('https://kf.kobotoolbox.org/api/v2/assets/aBcDeFgHiJkLmNoPqRsT/data.json'),
    { kind: 'kobo-api', origin: 'https://kf.kobotoolbox.org', assetUid: 'aBcDeFgHiJkLmNoPqRsT' });
  assert.equal(classifyLink('https://kf.kobotoolbox.org/#/forms/aBcDeFgHiJkLmNoPqRsT/data/table').kind, 'kobo-api');
  assert.equal(classifyLink('https://ona.io/exports/form.csv').kind, 'file');
  assert.equal(classifyLink('pas une url').kind, 'invalid');
  assert.equal(koboDataUrl('https://kf.kobotoolbox.org', 'X1234567890', { limit: 1000, start: 2000 }),
    'https://kf.kobotoolbox.org/api/v2/assets/X1234567890/data.json?limit=1000&start=2000');
});

test('pagination : s\'arrête sur page courte, absence de next, ou plafond', async () => {
  const pages = [[1, 2], [3, 4], [5]];
  const r = await collectPages(async (i) => ({ rows: pages[i] || [] }), { pageSize: 2 });
  assert.deepEqual(r.rows, [1, 2, 3, 4, 5]); assert.equal(r.pages, 3); assert.equal(r.truncated, false);
  const r2 = await collectPages(async (i) => ({ rows: [i], next: i < 1 ? 'n' : null, hasNextField: true }), { pageSize: 1 });
  assert.deepEqual(r2.rows, [0, 1]);
  const r3 = await collectPages(async () => ({ rows: [1, 2] }), { pageSize: 2, maxPages: 3 });
  assert.equal(r3.truncated, true); assert.equal(r3.rows.length, 6);
});

test('Ona : clés « groupe_question » ramenées au nom XLSForm du catalogue ; curseur _id', () => {
  const rec = { _id: 7, _uuid: 'u', grp_admin_admin3: 'MG123', grp_q_site_name: 'École A', other_field: 1, repeat_rep: [{ a: 1 }] };
  const n = normalizeOnaRecord(rec, ['admin3', 'site_name', 'name']);
  assert.equal(n.admin3, 'MG123');
  assert.equal(n.site_name, 'École A'); // le plus long nom (« site_name ») l'emporte sur « name »
  assert.equal(n.other_field, 1);
  assert.deepEqual(n.repeat_rep, [{ a: 1 }]);
  assert.equal(maxId([{ _id: 3 }, { _id: 9 }, {}], 5), 9);
  assert.equal(maxId([], 5), 5);
});

test('anti-SSRF : adresses privées refusées, liste d\'hôtes autorisés respectée', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '41.207.1.2', '2001:4860:4860::8888']) assert.equal(isPrivateIp(ip), false, ip);
  const publicLookup = async () => [{ address: '41.207.1.2' }];
  const privateLookup = async () => [{ address: '10.0.0.5' }];
  await assert.doesNotReject(assertAllowedUrl('https://moda.example.org/x', { hosts: [], lookup: publicLookup }));
  await assert.rejects(assertAllowedUrl('https://moda.example.org/x', { hosts: [], lookup: privateLookup }), /réseau privé/);
  await assert.rejects(assertAllowedUrl('http://127.0.0.1:9000/api', { hosts: [] }), /réseau privé/);
  await assert.rejects(assertAllowedUrl('file:///etc/passwd', { hosts: [] }), /http\(s\)/);
  await assert.rejects(assertAllowedUrl('https://user:pw@moda.example.org/', { hosts: [], lookup: publicLookup }), /Identifiants/);
  // Réseau interne autorisé explicitement (MoDA sur intranet).
  await assert.doesNotReject(assertAllowedUrl('https://moda.wfp.org/a', { hosts: ['moda.wfp.org'], lookup: privateLookup }));
  await assert.rejects(assertAllowedUrl('https://evil.example/a', { hosts: ['moda.wfp.org'] }), /non autorisé/);
});

test('safeFetch : redirection revalidée, token non transmis à un autre hôte, taille plafonnée', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (url.startsWith('https://a.example/')) return new Response(null, { status: 302, headers: { location: 'https://b.example/data' } });
    return new Response('x'.repeat(10), { status: 200 });
  };
  const guard = async (u) => new URL(u);
  const r = await safeFetch('https://a.example/start', { headers: { Authorization: 'Token s3cret' }, fetchImpl: fake, guard });
  assert.equal(r.ok, true); assert.equal(r.buffer.length, 10);
  assert.equal(calls[0].auth, 'Token s3cret'); assert.equal(calls[1].auth, undefined);
  await assert.rejects(safeFetch('https://b.example/big', { fetchImpl: fake, guard, maxBytes: 5 }), /volumineuse/);
  const blocked = async (u) => { if (u.includes('internal')) throw new Error('refusé'); return new URL(u); };
  const toInternal = async () => new Response(null, { status: 301, headers: { location: 'http://internal/admin' } });
  await assert.rejects(safeFetch('https://a.example/x', { fetchImpl: toInternal, guard: blocked }), /refusé/);
});

test('en-tête Link : page suivante', () => {
  assert.equal(nextFromLink('<https://x.org/d?page=2>; rel="next", <https://x.org/d?page=9>; rel="last"', 'https://x.org/d'), 'https://x.org/d?page=2');
  assert.equal(nextFromLink(null, 'https://x.org'), null);
});
