const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { pipeline } = require('stream');

/**
 * Lecture SÛRE d'une URL fournie par un utilisateur (connecteurs de données).
 * Le serveur ne doit pas devenir un relais vers le réseau interne (SSRF) :
 *  - http/https uniquement, identifiants dans l'URL refusés ;
 *  - si DATA_SOURCE_ALLOWED_HOSTS est défini (ex. « moda.wfp.org,kf.kobotoolbox.org »),
 *    SEULS ces hôtes (et leurs sous-domaines) sont autorisés — c'est le réglage
 *    à utiliser quand la source est sur le réseau interne (ou localhost en dev) ;
 *  - sinon, toute adresse privée / locale / réservée / de métadonnées est refusée,
 *    en IPv4 comme en IPv6 (y compris les IPv4 encapsulées : ::ffff:…, NAT64, 6to4) ;
 *  - anti-rebinding DNS : le nom est résolu UNE fois par connexion, refusé si UNE
 *    seule adresse est privée, et la connexion se fait sur l'adresse validée
 *    (option `lookup` de http/https) — jamais sur une seconde résolution ;
 *  - chaque redirection est revalidée (5 max), délai et taille plafonnés.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

class FetchRefused extends Error {}

// ---- Classification des adresses (PUR) ---------------------------------------

/** IPv4 « a.b.c.d » → entier 32 bits non signé ; null si ce n'est pas une IPv4. */
function ipv4ToInt(ip) {
  if (!net.isIPv4(ip)) return null;
  return ip.split('.').reduce((n, octet) => (n * 256) + Number(octet), 0);
}

// Plages IPv4 non routables publiquement (registre IANA des adresses à usage spécial).
const V4_BLOCKED = [
  ['0.0.0.0', 8], // « ce réseau »
  ['10.0.0.0', 8], // privé
  ['100.64.0.0', 10], // CGNAT (partagé opérateur)
  ['127.0.0.0', 8], // boucle locale
  ['169.254.0.0', 16], // lien local (métadonnées cloud 169.254.169.254)
  ['172.16.0.0', 12], // privé
  ['192.0.0.0', 24], // affectations IETF
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // relais 6to4
  ['192.168.0.0', 16], // privé
  ['198.18.0.0', 15], // bancs d'essai
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // réservé + diffusion 255.255.255.255
].map(([base, bits]) => ({ base: ipv4ToInt(base), size: 2 ** (32 - bits) }));

const isBlockedV4 = (n) => V4_BLOCKED.some(({ base, size }) => Math.floor(n / size) === Math.floor(base / size));

/**
 * IPv6 → 8 groupes de 16 bits ; null si ce n'est pas une IPv6. Gère « :: », la
 * zone (« fe80::1%eth0 ») et la forme mixte (« ::ffff:127.0.0.1 »).
 */
function ipv6Groups(ip) {
  let s = String(ip).toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!net.isIPv6(s)) return null;
  let tail = [];
  const mixed = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (mixed) {
    const n = ipv4ToInt(mixed[1]);
    if (n == null) return null;
    tail = [Math.floor(n / 65536), n % 65536];
    s = s.slice(0, -mixed[1].length);
    if (!s.endsWith('::')) s = s.slice(0, -1); // retire le « : » qui précédait l'IPv4
  }
  const parse = (part) => (part ? part.split(':').map((h) => parseInt(h, 16)) : []);
  let groups;
  if (s.includes('::')) {
    const [hi, lo] = s.split('::').map(parse);
    const fill = 8 - tail.length - hi.length - lo.length;
    if (fill < 0) return null;
    groups = [...hi, ...Array(fill).fill(0), ...lo, ...tail];
  } else {
    groups = [...parse(s), ...tail];
  }
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** Une IPv6 (en groupes) est-elle non routable publiquement ? */
function isBlockedV6(g) {
  const embedded = (g[6] * 65536) + g[7]; // 32 bits de poids faible (IPv4 encapsulée)
  const zero4 = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0;
  if (zero4 && g[4] === 0 && g[5] === 0xffff) return isBlockedV4(embedded); // ::ffff:a.b.c.d (mappée) : juge l'IPv4
  if (zero4 && g[4] === 0 && g[5] === 0) return true; // ::, ::1, ::a.b.c.d (compatible, obsolète)
  if (zero4 && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:a.b.c.d (traduite)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isBlockedV4(embedded); // NAT64 64:ff9b::/96 : juge l'IPv4 encapsulée
  }
  if (g[0] === 0x2002) return isBlockedV4((g[1] * 65536) + g[2]); // 6to4 2002:AABB:CCDD::/48
  // Hors unicast global 2000::/3 : ULA fc00::/7, lien local fe80::/10, multicast ff00::/8,
  // NAT64 local 64:ff9b:1::/48, discard 100::/64, SRv6 5f00::/16… tout est refusé.
  if ((g[0] & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1] < 0x0200) return true; // 2001::/23 IETF (Teredo, bancs, ORCHID…)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation 2001:db8::/32
  if (g[0] === 0x3fff && g[1] < 0x1000) return true; // documentation 3fff::/20
  return false;
}

/** Adresse non routable publiquement (IPv4/IPv6, crochets tolérés) ? PUR. Non-IP → vrai (refus). */
function isPrivateIp(ip) {
  const s = String(ip == null ? '' : ip).trim().replace(/^\[|\]$/g, '');
  const v4 = ipv4ToInt(s);
  if (v4 != null) return isBlockedV4(v4);
  const v6 = ipv6Groups(s);
  if (v6) return isBlockedV6(v6);
  return true;
}

// ---- Hôtes autorisés et résolution ---------------------------------------------

function allowedHosts() {
  return String(process.env.DATA_SOURCE_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

const hostMatches = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));
const bareHost = (h) => String(h || '').toLowerCase().replace(/^\[|\]$/g, '');

/**
 * Résout un hôte UNE fois et renvoie ses adresses [{ address, family }] si — et
 * seulement si — l'hôte est autorisé : présent dans la liste d'hôtes autorisés,
 * ou (sans liste) TOUTES ses adresses sont publiques. Lève FetchRefused sinon.
 */
async function resolveAllowed(hostname, { hosts = allowedHosts(), lookup = dns.lookup } = {}) {
  const host = bareHost(hostname);
  if (hosts.length && !hostMatches(host, hosts)) throw new FetchRefused(`Hôte « ${host} » non autorisé (DATA_SOURCE_ALLOWED_HOSTS).`);
  const family = net.isIP(host);
  let addrs;
  if (family) addrs = [{ address: host, family }];
  else {
    try { addrs = await lookup(host, { all: true, verbatim: true }); } catch { throw new FetchRefused(`Hôte « ${host} » introuvable.`); }
  }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).filter((a) => a && a.address)
    .map((a) => ({ address: a.address, family: a.family === 6 || a.family === 4 ? a.family : net.isIP(a.address) }));
  if (!list.length) throw new FetchRefused(`Hôte « ${host} » introuvable.`);
  if (!hosts.length && list.some((a) => isPrivateIp(a.address))) {
    throw new FetchRefused(`Hôte « ${host} » sur un réseau privé : ajoutez-le à DATA_SOURCE_ALLOWED_HOSTS pour l'autoriser.`);
  }
  return list;
}

/** Valide une URL avant de l'appeler (lève FetchRefused). */
async function assertAllowedUrl(raw, { hosts = allowedHosts(), lookup = dns.lookup } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw new FetchRefused('URL invalide.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchRefused('Seuls les liens http(s) sont acceptés.');
  if (u.username || u.password) throw new FetchRefused('Identifiants dans l\'URL refusés : utilisez le champ « token ».');
  await resolveAllowed(u.hostname, { hosts, lookup });
  return u;
}

/**
 * Fonction `lookup` pour http(s).request / net.connect : la socket se connecte
 * UNIQUEMENT à une adresse que resolveAllowed vient de valider (anti-rebinding).
 */
function pinnedLookup(opts = {}) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const o = options && typeof options === 'object' ? options : {};
    const deliver = (err, list) => {
      if (err) return cb(err);
      const usable = o.family === 4 || o.family === 6 ? list.filter((a) => a.family === o.family) : list;
      if (!usable.length) {
        const e = new FetchRefused(`Hôte « ${bareHost(hostname)} » introuvable.`); e.code = 'ENOTFOUND';
        return cb(e);
      }
      return o.all ? cb(null, usable) : cb(null, usable[0].address, usable[0].family);
    };
    // Rappel hors de la chaîne de promesses (comme dns.lookup) : une exception
    // dans le rappel ne peut pas le rappeler une seconde fois.
    resolveAllowed(hostname, opts).then(
      (list) => process.nextTick(deliver, null, list),
      (err) => process.nextTick(deliver, err)
    );
  };
}

// ---- Requête HTTP épinglée ------------------------------------------------------

const DECODERS = {
  gzip: () => zlib.createGunzip(), 'x-gzip': () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(), br: () => zlib.createBrotliDecompress(),
};
const lowerKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));

/**
 * GET via http/https avec un `lookup` imposé (agent dédié, pas de socket
 * réutilisée). Aucune redirection suivie ici. Renvoie { status, ok, headers.get,
 * body } — body itérable (décompressé si gzip/br/deflate).
 */
function pinnedRequest(href, { headers = {}, signal, lookup } = {}) {
  const u = new URL(href);
  const mod = u.protocol === 'https:' ? https : http;
  const h = { 'user-agent': 'MEMS-2.0', accept: '*/*', 'accept-encoding': 'gzip, br', ...lowerKeys(headers) };
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method: 'GET', headers: h, signal, lookup, agent: false }, (res) => {
      const decoder = DECODERS[String(res.headers['content-encoding'] || '').trim().toLowerCase()];
      let body = res;
      if (decoder) { body = decoder(); pipeline(res, body, () => {}); }
      resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: { get: (k) => { const v = res.headers[String(k).toLowerCase()]; return v == null ? null : [].concat(v).join(', '); } },
        body,
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Abandonne un corps de réponse non lu (libère la connexion). */
function discard(res) {
  try {
    const b = res && res.body;
    if (b && typeof b.destroy === 'function') b.destroy();
    else if (b && typeof b.cancel === 'function') b.cancel().catch(() => {});
  } catch { /* corps déjà fermé */ }
}

async function readCapped(res, maxBytes) {
  const len = Number(res.headers.get('content-length'));
  if (len && len > maxBytes) { discard(res); throw new FetchRefused(`Réponse trop volumineuse (${Math.round(len / 1e6)} Mo).`); }
  const chunks = []; let total = 0;
  if (!res.body) return Buffer.alloc(0);
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new FetchRefused(`Réponse trop volumineuse (> ${Math.round(maxBytes / 1e6)} Mo).`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/**
 * fetch sûr. Renvoie { status, ok, headers, url, buffer } (corps lu, plafonné).
 * Les en-têtes d'authentification ne suivent PAS une redirection vers une autre origine.
 * `hosts` / `lookup` : injectables pour les tests (par défaut : variable
 * d'environnement et DNS du système) ; `fetchImpl` / `guard` aussi.
 */
async function safeFetch(raw, {
  headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, maxRedirects = 5,
  hosts = allowedHosts(), lookup = dns.lookup,
  guard = (u) => assertAllowedUrl(u, { hosts, lookup }),
  fetchImpl = (href, opts) => pinnedRequest(href, { ...opts, lookup: pinnedLookup({ hosts, lookup }) }),
} = {}) {
  let url = await guard(raw);
  const origin = url.origin; // schéma + hôte + port
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      // Le jeton ne suit qu'une redirection vers la MÊME origine : ni un autre
      // hôte, ni un autre port, ni un passage de https à http (jeton en clair).
      const sameOrigin = url.origin === origin;
      const h = sameOrigin ? headers : Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())));
      const res = await fetchImpl(url.href, { headers: h, redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        discard(res);
        url = await guard(new URL(res.headers.get('location'), url).href);
        continue;
      }
      const buffer = await readCapped(res, maxBytes);
      return { status: res.status, ok: res.ok, headers: res.headers, url: url.href, buffer };
    }
    throw new FetchRefused('Trop de redirections.');
  } catch (err) {
    if (ctrl.signal.aborted || err.name === 'AbortError') throw new FetchRefused(`Délai dépassé (${Math.round(timeoutMs / 1000)} s).`);
    throw err;
  } finally { clearTimeout(timer); }
}

module.exports = {
  safeFetch, assertAllowedUrl, resolveAllowed, pinnedLookup, isPrivateIp, FetchRefused, DEFAULT_MAX_BYTES,
};
