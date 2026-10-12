const dns = require('dns').promises;
const net = require('net');

/**
 * Lecture SÛRE d'une URL fournie par un utilisateur (connecteurs de données).
 * Le serveur ne doit pas devenir un relais vers le réseau interne (SSRF) :
 *  - http/https uniquement, identifiants dans l'URL refusés ;
 *  - si DATA_SOURCE_ALLOWED_HOSTS est défini (ex. « moda.wfp.org,kf.kobotoolbox.org »),
 *    SEULS ces hôtes (et leurs sous-domaines) sont autorisés — c'est le réglage
 *    à utiliser quand la source est sur le réseau interne ;
 *  - sinon, toute adresse privée / locale / de métadonnées est refusée ;
 *  - chaque redirection est revalidée (5 max), délai et taille plafonnés.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

class FetchRefused extends Error {}

/** Adresse non routable publiquement (IPv4/IPv6) ? PUR. */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

function allowedHosts() {
  return String(process.env.DATA_SOURCE_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

const hostMatches = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** Valide une URL avant de l'appeler (lève FetchRefused). */
async function assertAllowedUrl(raw, { hosts = allowedHosts(), lookup = dns.lookup } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw new FetchRefused('URL invalide.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchRefused('Seuls les liens http(s) sont acceptés.');
  if (u.username || u.password) throw new FetchRefused('Identifiants dans l\'URL refusés : utilisez le champ « token ».');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hosts.length) {
    if (!hostMatches(host, hosts)) throw new FetchRefused(`Hôte « ${host} » non autorisé (DATA_SOURCE_ALLOWED_HOSTS).`);
    return u;
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new FetchRefused(`Hôte « ${host} » introuvable.`); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new FetchRefused(`Hôte « ${host} » sur un réseau privé : ajoutez-le à DATA_SOURCE_ALLOWED_HOSTS pour l'autoriser.`);
  }
  return u;
}

async function readCapped(res, maxBytes) {
  const len = Number(res.headers.get('content-length'));
  if (len && len > maxBytes) throw new FetchRefused(`Réponse trop volumineuse (${Math.round(len / 1e6)} Mo).`);
  const chunks = []; let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new FetchRefused(`Réponse trop volumineuse (> ${Math.round(maxBytes / 1e6)} Mo).`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * fetch sûr. Renvoie { status, ok, headers, url, buffer } (corps lu, plafonné).
 * Les en-têtes d'authentification ne suivent PAS une redirection vers un autre hôte.
 */
async function safeFetch(raw, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, maxRedirects = 5, fetchImpl = fetch, guard = assertAllowedUrl } = {}) {
  let url = await guard(raw);
  const origin = url.host;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const sameHost = url.host === origin;
      const h = sameHost ? headers : Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'authorization'));
      const res = await fetchImpl(url.href, { headers: h, redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = await guard(new URL(res.headers.get('location'), url).href);
        continue;
      }
      const buffer = await readCapped(res, maxBytes);
      return { status: res.status, ok: res.ok, headers: res.headers, url: url.href, buffer };
    }
    throw new FetchRefused('Trop de redirections.');
  } catch (err) {
    if (err.name === 'AbortError') throw new FetchRefused(`Délai dépassé (${Math.round(timeoutMs / 1000)} s).`);
    throw err;
  } finally { clearTimeout(timer); }
}

module.exports = { safeFetch, assertAllowedUrl, isPrivateIp, FetchRefused, DEFAULT_MAX_BYTES };
