/**
 * District d'un site pour les regroupements (terrain, récapitulatif, concepteur, carte) —
 * règle PURE, testée (test/siteDistrict.test.js). Jumelle de la requête
 * common/siteActivitySql.siteDistrictCtes ; parité vérifiée par le banc (perfPeriod.js).
 *
 * Un site se range dans SON district : la graphie du registre (adm2, sinon district).
 * Jamais dans le district d'une autre région : le P-code de district (adm2_pcode) n'est
 * cru que s'il est « d'accord » avec le site, c'est-à-dire si la région de cette zone
 * (lineage[1] du découpage) est la région du site (adm1, graphie ignorée :
 * « Atsimo-Andrefana » = « Atsimo Andrefana »). Sur la base de démonstration, 205 sites
 * sur 1 081 ont un P-code de district d'une autre région (ex. ANARABAJY : Anosy,
 * Amboasary, mais adm2_pcode = Vangaindrano, Atsimo Atsinanana).
 *
 * Nom officiel : appris des sites dont le P-code est d'accord. Pour chaque graphie
 * (clé normalisée) et chaque région, le district officiel le plus fréquent parmi ces
 * sites ; tous les sites de cette graphie dans cette région prennent ce nom. Les
 * variantes d'un même district (« Amboasary », « Amboasary sud », « AMBOASARY SUD »,
 * « Amboasary-Atsimo ») ne font ainsi qu'une ligne (retour n° 15), et un site au P-code
 * erroné reste avec les sites de sa graphie, dans sa région.
 *  - site sans région (adm1 vide) : la graphie est reconnue si une seule région la connaît ;
 *  - site sans graphie : le nom officiel si son P-code est d'accord, sinon « — » ;
 *  - graphie inconnue du découpage : la graphie elle-même (clé = graphie normalisée).
 *
 * Clé de regroupement = graphie retenue normalisée (`districtKey` : minuscules, lettres et
 * chiffres seulement) ; nom affiché = le nom officiel, sinon une graphie qui n'est pas
 * toute en capitales.
 */

const text = (v) => { const s = v == null ? '' : String(v).trim(); return s || null; };

/**
 * Clé normalisée d'un nom de lieu : minuscules, lettres et chiffres ASCII seulement
 * (« Toliara-II » → « toliaraii ») — même règle en SQL quelle que soit la locale de la base.
 */
const districtKey = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Comparaison binaire (ordre « C » en SQL) : départage déterministe identique des deux côtés. */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * District de chaque site.
 * @param {{ id:string, adm1?:string, adm2?:string, district?:string,
 *           pcodeName?:string, pcodeRegion?:string }[]} sites
 *   pcodeName / pcodeRegion : nom de la zone de son adm2_pcode et nom de la région de cette zone.
 * @returns {Map<string, { key:string, name:string, official:string|null }>}
 */
function siteDistricts(sites) {
  const rows = (sites || []).map((s) => {
    const own = text(s.adm2) || text(s.district);
    const pname = text(s.pcodeName);
    const okey = districtKey(own);
    const rkey = districtKey(s.adm1);
    const prkey = districtKey(s.pcodeRegion);
    const agrees = !!pname && prkey !== '' && (prkey === rkey || (rkey === '' && districtKey(pname) === okey));
    return { id: s.id, own, pname, okey, rkey, prkey, agrees };
  });
  // Votes : (graphie, région du P-code) → nom officiel → nombre de sites d'accord.
  const votes = new Map();
  for (const r of rows) {
    if (!r.agrees || !r.okey) continue;
    const k = `${r.okey}|${r.prkey}`;
    if (!votes.has(k)) votes.set(k, new Map());
    const v = votes.get(k);
    v.set(r.pname, (v.get(r.pname) || 0) + 1);
  }
  const dmap = new Map(); // `${okey}|${rkey}` → nom officiel
  const regionsOf = new Map(); // okey → noms officiels retenus (une entrée par région)
  for (const [k, v] of votes) {
    const [best] = [...v.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    dmap.set(k, best[0]);
    const okey = k.slice(0, k.indexOf('|'));
    if (!regionsOf.has(okey)) regionsOf.set(okey, []);
    regionsOf.get(okey).push(best[0]);
  }
  const out = new Map();
  for (const r of rows) {
    let mapped = null;
    if (r.okey && r.rkey) mapped = dmap.get(`${r.okey}|${r.rkey}`) || null;
    else if (r.okey) { const list = regionsOf.get(r.okey); mapped = list && list.length === 1 ? list[0] : null; }
    const official = mapped || (!r.own && r.agrees ? r.pname : null);
    const name = mapped || r.own || official;
    const key = districtKey(name);
    out.set(r.id, key ? { key, name, official } : { key: '—', name: '—', official: null });
  }
  return out;
}

module.exports = { siteDistricts, districtKey };
