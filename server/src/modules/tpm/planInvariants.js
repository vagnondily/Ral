/**
 * Invariants du générateur de plan (lot 5, § 7.2), vérifiés INDÉPENDAMMENT du générateur à
 * partir de ses entrées et de son résultat — PUR. Utilisé par les tests (jeux aléatoires à
 * graine fixe) et par le banc (scripts/perfPlan.js) : « 0 violation » est la condition.
 *
 *  1. au plus une visite par site × mois (générée ou existante, annulée comprise) ;
 *  2. jamais sur un site × mois soumis à un garde-fou (hors périmètre, sans MMR, activité qui ne
 *     tourne pas, zone interdite, inactif) ;
 *  3. visites générées d'un pool ≤ capacité du mois − engagements existants, et ≤ capacité
 *     restante de l'exercice ;
 *  4. aucune journée remplie au-delà de 100 % ;
 *  5. jours-personne utilisés ≤ capacité (sauf dépassement SIGNALÉ par des engagements existants) ;
 *  6. intervalle de revisite respecté en arrière et en avant (urgent : écart minimal urgent ;
 *     anticipée : intervalle − anticipation) ;
 *  7. plan selon les besoins (stratégie « besoins », sans plafond de capacité : les contrôles 3
 *     et 5 ne s'appliquent pas) : au plus les visites RESTANTES exigées par le MMR pour chaque
 *     site (dues − réalisées ou prévues dans l'exercice), l'écart minimal valant pour tous,
 *     urgents compris ; jamais dans une commune exclue pour l'accès.
 */
const { U } = require('./planGenerator');

const monthIdx = (s) => { const [y, m] = String(s).split('-').map(Number); return y * 12 + (m - 1); };

function checkInvariants(input, result) {
  const v = [];
  const { year, fromMonth } = input;
  const params = { urgentMinGapMonths: 1, anticipationMonths: 0, ...input.params };
  const needs = params.strategy === 'besoins';
  const sites = new Map((input.sites || []).map((s) => [s.id, s]));
  const pools = input.pools || {};
  const seen = new Set();
  const byPoolMonth = new Map();
  const bySite = new Map();
  for (const p of result.proposals) {
    const k = `${p.siteId}|${p.month}`;
    if (seen.has(k)) v.push({ code: 'doublon', siteId: p.siteId, month: p.month });
    seen.add(k);
    const s = sites.get(p.siteId);
    if (!s) { v.push({ code: 'site_inconnu', siteId: p.siteId }); continue; }
    const c = s.months[p.month - 1] || {};
    const pool = pools[s.poolKey];
    if (c.st) v.push({ code: 'deja_une_visite', siteId: p.siteId, month: p.month, st: c.st });
    if (!s.inScope) v.push({ code: 'hors_perimetre', siteId: p.siteId });
    if (!pool) { v.push({ code: 'sans_mmr', siteId: p.siteId }); continue; }
    const running = pool.interval && pool.interval.running && (!pool.runningMonths || pool.runningMonths.has(p.month));
    if (!running) v.push({ code: 'ne_tourne_pas', siteId: p.siteId, month: p.month });
    if (c.forbidden) v.push({ code: 'zone_interdite', siteId: p.siteId, month: p.month });
    if (!c.active) v.push({ code: 'inactif', siteId: p.siteId, month: p.month });
    if (s.excluded) v.push({ code: 'acces', siteId: p.siteId, month: p.month });
    if (p.month < fromMonth) v.push({ code: 'mois_passe', siteId: p.siteId, month: p.month });
    const pm = `${s.poolKey}|${p.month}`;
    byPoolMonth.set(pm, (byPoolMonth.get(pm) || 0) + 1);
    if (!bySite.has(p.siteId)) bySite.set(p.siteId, []);
    bySite.get(p.siteId).push(p);
  }
  // 3. capacité de visites (mois et exercice)
  const genByPool = new Map();
  for (const mo of result.months) {
    for (const [key, c] of Object.entries(mo.capacity)) {
      const gen = byPoolMonth.get(`${key}|${mo.month}`) || 0;
      genByPool.set(key, (genByPool.get(key) || 0) + gen);
      if (gen !== c.generated) v.push({ code: 'compte_incoherent', pool: key, month: mo.month, gen, reported: c.generated });
      if (c.visitsCap == null) continue; // plan selon les besoins : aucun plafond de capacité
      if (gen > Math.max(0, c.visitsCap - c.existing)) v.push({ code: 'capacite_visites', pool: key, month: mo.month, gen, cap: c.visitsCap, existing: c.existing });
      // 5. jours-personne
      if (c.dayCapUnits != null && !c.over && c.dayUsedUnits > c.dayCapUnits) v.push({ code: 'capacite_jours', pool: key, month: mo.month });
      if (c.dayCapUnits != null && c.genDayUnits > Math.max(0, c.dayCapUnits - (c.dayUsedUnits - c.genDayUnits)) && !c.over) v.push({ code: 'jours_generes', pool: key, month: mo.month });
    }
    // 4. journées ≤ 100 %
    for (const t of mo.tours) for (const sp of t.stops) for (const d of sp.days) if (d.used > U * d.span) v.push({ code: 'journee_pleine', month: mo.month, day: d.no });
  }
  for (const [key, gen] of genByPool) {
    const left = result.pools[key] && result.pools[key].yearLeftStart;
    if (left != null && gen > left) v.push({ code: 'capacite_exercice', pool: key, gen, left });
  }
  for (const [key, n] of byPoolMonth) {
    const [pool, month] = [key.slice(0, key.lastIndexOf('|')), Number(key.slice(key.lastIndexOf('|') + 1))];
    if (!result.months.some((mo) => mo.month === month && mo.capacity[pool])) v.push({ code: 'pool_sans_capacite', pool, month, n });
  }
  // 6. intervalle de revisite (recalculé depuis les entrées et les propositions précédentes)
  for (const [siteId, list] of bySite) {
    const s = sites.get(siteId);
    const pool = pools[s.poolKey];
    if (!pool) continue;
    // Chaque visite générée respecte SON intervalle : en arrière face à toute visite antérieure
    // (réalisée, engagée ou générée plus tôt), en avant face aux engagements EXISTANTS. Une
    // visite générée plus tard porte elle-même la contrainte avec celle-ci (en arrière).
    const existing = []; // mois (index absolu) des visites réalisées ou engagées (entrées)
    if (s.lastReal) existing.push(monthIdx(s.lastReal));
    s.months.forEach((c, i) => {
      const m = i + 1;
      if (c.st === 'realise' || (c.st === 'planifie' && m >= fromMonth)) existing.push(year * 12 + (m - 1));
    });
    const generated = list.map((p) => year * 12 + (p.month - 1));
    for (const p of list) {
      const at = year * 12 + (p.month - 1);
      let gate;
      if (needs) gate = p.detail.gate;
      else if (p.reason === 'urgent') gate = params.urgentMinGapMonths;
      else if (p.reason === 'anticipee') gate = Math.max(1, (p.detail.gate || 1) - params.anticipationMonths);
      else gate = p.detail.gate;
      if (!(gate >= 1)) { v.push({ code: 'intervalle_inconnu', siteId, month: p.month }); continue; }
      const before = [...existing, ...generated].filter((d) => d < at);
      const after = existing.filter((d) => d > at);
      const bad = before.find((d) => at - d < gate) ?? after.find((d) => d - at < gate);
      if (bad !== undefined) v.push({ code: 'intervalle', siteId, month: p.month, other: bad, gate });
    }
    // 7. au plus les visites restantes exigées par le MMR (fréquence = visites par site sur l'exercice)
    if (needs) {
      const done = s.months.filter((c, i) => c.st === 'realise' || (c.st === 'planifie' && i + 1 >= fromMonth)).length;
      const required = Math.round(Number(pool.frequency) || 0);
      if (list.length > Math.max(0, required - done)) v.push({ code: 'au_dela_exigence', siteId, n: list.length, required, done });
    }
  }
  return v;
}

module.exports = { checkInvariants };
