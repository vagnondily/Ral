const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const { isPrivateIp, resolveAllowed, pinnedLookup, safeFetch, FetchRefused } = require('../src/modules/monitoring/remoteFetch');

test('anti-SSRF : IPv4 encapsulées dans l\'IPv6 (mappées hexadécimales, NAT64, 6to4) reconnues', () => {
  // Critères d'acceptation R0 (import-36).
  assert.equal(isPrivateIp('::ffff:7f00:1'), true); // ::ffff:127.0.0.1 en hexadécimal
  assert.equal(isPrivateIp('::ffff:a9fe:a9fe'), true); // ::ffff:169.254.169.254 (métadonnées cloud)
  assert.equal(isPrivateIp('64:ff9b::7f00:1'), true); // NAT64 de 127.0.0.1
  for (const ip of ['[::ffff:127.0.0.1]', '::ffff:127.0.0.1', '::FFFF:7F00:0001', '::ffff:10.0.0.1', '64:ff9b::a00:1',
    '64:ff9b::192.168.1.1', '2002:7f00:1::1', '2002:c0a8:101::', '::ffff:0:7f00:1']) assert.equal(isPrivateIp(ip), true, ip);
  // L'encapsulation d'une IPv4 PUBLIQUE reste autorisée (réseaux IPv6 seuls via NAT64).
  for (const ip of ['::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1']) assert.equal(isPrivateIp(ip), false, ip);
});

test('anti-SSRF : plages IPv6 réservées refusées, unicast global accepté', () => {
  for (const ip of ['::', '::1', '0:0:0:0:0:0:0:1', '::8.8.8.8', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fc00::1', 'fd12:3456::1',
    'ff02::1', '2001:db8::1', '2001::1', '100::1', '64:ff9b:1::1', '3fff::1', '5f00::1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '2a00:1450:4007:80e::200e']) assert.equal(isPrivateIp(ip), false, ip);
});

test('anti-SSRF : plages IPv4 spéciales exactes (ni trop, ni trop peu)', () => {
  for (const ip of ['0.0.0.0', '10.255.0.1', '100.64.0.1', '100.127.255.255', '127.1.2.3', '169.254.169.254', '172.16.0.1',
    '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.88.99.1', '192.168.0.1', '198.18.0.1', '198.19.255.1', '198.51.100.7',
    '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '41.207.1.2', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '192.0.1.1',
    '198.17.0.1', '223.255.255.255']) assert.equal(isPrivateIp(ip), false, ip);
  for (const v of ['', 'pas-une-ip', null, '1:2:3:4:5:6:7:8:9', '999.1.1.1']) assert.equal(isPrivateIp(v), true, String(v));
});

test('résolution : refus si UNE seule adresse est privée ; liste d\'hôtes autorisés (DATA_SOURCE_ALLOWED_HOSTS) respectée', async () => {
  const mixed = async () => [{ address: '41.207.1.2', family: 4 }, { address: '::ffff:7f00:1', family: 6 }];
  await assert.rejects(resolveAllowed('data.example.org', { hosts: [], lookup: mixed }), /réseau privé/);
  const ok = await resolveAllowed('data.example.org', { hosts: [], lookup: async () => [{ address: '41.207.1.2' }] });
  assert.deepEqual(ok, [{ address: '41.207.1.2', family: 4 }]);
  // En dev : localhost explicitement autorisé.
  const local = await resolveAllowed('localhost', { hosts: ['localhost'], lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
  assert.equal(local[0].address, '127.0.0.1');
  await assert.rejects(resolveAllowed('autre.example', { hosts: ['localhost'] }), /non autorisé/);
  await assert.rejects(resolveAllowed('[::ffff:7f00:1]', { hosts: [] }), /réseau privé/);
  await assert.rejects(resolveAllowed('nulle-part.invalid', { hosts: [], lookup: async () => { throw new Error('ENOTFOUND'); } }), /introuvable/);
});

test('lookup épinglé : renvoie uniquement les adresses validées (forme « all » et forme simple)', async () => {
  const lookup = async () => [{ address: '41.207.1.2', family: 4 }, { address: '2001:4860:4860::8888', family: 6 }];
  const pin = pinnedLookup({ hosts: [], lookup });
  const all = await new Promise((res, rej) => pin('x.example', { all: true }, (e, a) => (e ? rej(e) : res(a))));
  assert.deepEqual(all.map((a) => a.address), ['41.207.1.2', '2001:4860:4860::8888']);
  const v6 = await new Promise((res, rej) => pin('x.example', { family: 6 }, (e, a, f) => (e ? rej(e) : res([a, f]))));
  assert.deepEqual(v6, ['2001:4860:4860::8888', 6]);
  const refused = await new Promise((res) => pinnedLookup({ hosts: [], lookup: async () => [{ address: '10.0.0.5' }] })('x.example', {}, (e) => res(e)));
  assert.ok(refused instanceof FetchRefused);
});

/** Serveur HTTP local (127.0.0.1) qui compte les requêtes reçues. */
async function localServer(handler) {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push({ url: req.url, host: req.headers.host }); handler(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { hits, port: server.address().port, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}

test('rebinding DNS : le nom validé public puis re-résolu en 127.0.0.1 n\'atteint jamais le réseau local', async () => {
  const srv = await localServer((req, res) => res.end('secret interne'));
  try {
    let calls = 0;
    // 1re résolution (contrôle) : adresse publique ; suivantes (connexion) : boucle locale.
    const rebinding = async () => { calls += 1; return [{ address: calls === 1 ? '41.207.1.2' : '127.0.0.1', family: 4 }]; };
    await assert.rejects(safeFetch(`http://rebind.example:${srv.port}/admin`, { hosts: [], lookup: rebinding, timeoutMs: 2000 }), /réseau privé/);
    assert.ok(calls >= 2, 'la connexion a bien re-résolu le nom par le lookup épinglé');
    assert.equal(srv.hits.length, 0, 'aucune requête n\'a atteint le serveur local');
  } finally { await srv.close(); }
});

test('connexion à l\'adresse validée : hôte autorisé résolu par le lookup épinglé, corps gzip décodé et plafonné', async () => {
  const body = JSON.stringify({ results: [{ _id: 1 }, { _id: 2 }] });
  const srv = await localServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync(body));
  });
  try {
    // « donnees.test » n'existe dans aucun DNS : la réussite prouve que la socket
    // s'est connectée à l'adresse fournie par le lookup épinglé.
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    const r = await safeFetch(`http://donnees.test:${srv.port}/api/data`, { hosts: ['donnees.test'], lookup, headers: { Authorization: 'Token x' } });
    assert.equal(r.ok, true);
    assert.equal(r.buffer.toString('utf8'), body);
    assert.equal(srv.hits[0].host, `donnees.test:${srv.port}`);
    await assert.rejects(safeFetch(`http://donnees.test:${srv.port}/api/data`, { hosts: ['donnees.test'], lookup, maxBytes: 10 }), /volumineuse/);
  } finally { await srv.close(); }
});

test('délai dépassé : la requête est interrompue avec un message clair', async () => {
  const srv = await localServer(() => { /* ne répond jamais */ });
  try {
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    await assert.rejects(safeFetch(`http://lent.test:${srv.port}/`, { hosts: ['lent.test'], lookup, timeoutMs: 150 }), /Délai dépassé/);
  } finally { await srv.close(); }
});

/** Réponse simulée minimale (forme de pinnedRequest). */
const fakeRes = (status, headers = {}, body = '') => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  body: [Buffer.from(body)],
});

test('redirection revalidée par le résolveur : un 302 vers un nom qui pointe sur le réseau interne est refusé', async () => {
  const names = { 'public.example': '41.207.1.2', 'interne.example': '10.0.0.5' };
  const lookup = async (h) => [{ address: names[h], family: 4 }];
  const calls = [];
  const fetchImpl = async (href) => { calls.push(href); return fakeRes(302, { location: 'http://interne.example/admin' }); };
  await assert.rejects(safeFetch('https://public.example/data', { hosts: [], lookup, fetchImpl }), /réseau privé/);
  assert.deepEqual(calls, ['https://public.example/data'], 'la cible interne n\'a jamais été appelée');
});

test('redirection : le jeton ne suit ni un passage https → http, ni un autre port de la même machine', async () => {
  const lookup = async () => [{ address: '41.207.1.2', family: 4 }];
  const seen = [];
  const hops = { 'https://kf.example/a': 'https://kf.example/b', 'https://kf.example/b': 'http://kf.example/c', 'http://kf.example/c': 'http://kf.example:8080/d' };
  const fetchImpl = async (href, opts) => {
    seen.push([href, opts.headers.Authorization || null, opts.headers.Cookie || null]);
    return hops[href] ? fakeRes(302, { location: hops[href] }) : fakeRes(200, {}, 'ok');
  };
  const r = await safeFetch('https://kf.example/a', { hosts: [], lookup, fetchImpl, headers: { Authorization: 'Token s3cret', Cookie: 'sid=1', Accept: 'text/csv' } });
  assert.equal(r.buffer.toString(), 'ok');
  assert.deepEqual(seen, [
    ['https://kf.example/a', 'Token s3cret', 'sid=1'],
    ['https://kf.example/b', 'Token s3cret', 'sid=1'], // même origine : conservé
    ['http://kf.example/c', null, null], // https → http : retiré
    ['http://kf.example:8080/d', null, null], // autre port : retiré
  ]);
});
