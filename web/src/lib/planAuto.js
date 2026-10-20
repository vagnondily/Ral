/**
 * Planification automatique — règles PURES du tiroir « Générer le plan de suivi » (testées par
 * server/test/webPlanAuto.test.js : le front n'a pas de suite propre).
 */

/**
 * Liste des bureaux du périmètre, en arbre : chaque bureau puis TOUTES ses antennes, à tous les
 * niveaux (Bureau › Antenne › Sous-antenne), indentées selon la profondeur — n'importe quelle
 * antenne peut être choisie. Le bureau national (« pays ») couvre tout le registre. Un parent absent
 * ou un cycle de parenté n'égare aucun bureau : il est rangé comme racine.
 * @param {{id:string, name:string, parentId?:string|null, national?:boolean}[]} offices
 * @returns {{ id:string, name:string, depth:number, national:boolean, label:string }[]}
 */
export function officeOptions(offices = []) {
  const list = (offices || []).filter((o) => o && o.id);
  const byId = new Map(list.map((o) => [o.id, o]));
  const children = new Map();
  for (const o of list) {
    const p = o.parentId && byId.has(o.parentId) && o.parentId !== o.id ? o.parentId : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(o);
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'fr') || String(a.id).localeCompare(String(b.id));
  const out = [];
  const seen = new Set();
  const walk = (o, depth) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    // Espaces insécables : une liste de choix ne garde pas les espaces ordinaires en tête.
    const indent = depth > 0 ? `${'  '.repeat(depth)}↳ ` : '';
    out.push({ id: o.id, name: o.name, depth, national: Boolean(o.national), label: `${indent}${o.name}` });
    for (const k of (children.get(o.id) || []).filter((x) => !seen.has(x.id)).sort(byName)) walk(k, depth + 1);
  };
  for (const r of (children.get(null) || []).sort(byName)) walk(r, 0);
  for (const o of [...list].sort(byName)) if (!seen.has(o.id)) walk(o, 0);
  return out;
}

/**
 * Nombre décimal d'une cellule CSV au séparateur décimal de la langue (« 1,5 » en français : le
 * fichier « ; » s'ouvre dans Excel en français, qui lit la virgule) ; entier tel quel ; vide si absent.
 */
export function csvDecimal(n, locale = 'fr-FR') {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  if (Number.isInteger(v)) return v;
  return v.toLocaleString(locale, { maximumFractionDigits: 1, useGrouping: false });
}

/**
 * Lignes de l'export « base de budget » d'un aperçu : par unité (TPM de la zone, ou bureau en suivi
 * interne) et par mois — visites, journées-agent, agents, véhicules et jours de terrain.
 * @param {object} preview  réponse de /plan-auto/preview
 * @param {(s:string, p?:object) => string} tr  traduction
 * @param {string} locale  locale des nombres (formatLocale())
 */
export function budgetCsvRows(preview, tr, locale = 'fr-FR') {
  const rows = [[tr('Unité (TPM / bureau)'), tr('Mois'), tr('Visites à faire'), tr('dont nouvelles'), tr('Journées-agent'), tr('Agents'),
    tr('Véhicules (pic / jour)'), tr('Véhicules (moyenne / jour)'), tr('Jours de terrain'), tr('Source des jours de terrain')]];
  for (const t of (preview && preview.byTpm) || []) {
    const label = unitLabel(t, tr);
    for (const m of t.perMonth || []) {
      rows.push([label, m.month, m.visits, m.count, m.agentDays, m.agents, m.vehiclesPeak, csvDecimal(m.vehiclesAvg, locale),
        m.workingDays ?? '', m.workingDaysSource ? tr(m.workingDaysSource === 'mmr' ? 'MMR (jours ouvrés)' : 'paramètre du plan') : '']);
    }
    rows.push([label, tr('Total / pic'), t.visits, t.planned, t.agentDays, t.agentsPeak, t.vehiclesPeak, '', '', '']);
  }
  return rows;
}

/** Libellé d'une unité de suivi : le TPM de la zone, sinon « Interne — Bureau X » (suivi par l'équipe S&E, retour 114). */
export function unitLabel(t, tr) {
  if (t && t.assigned) return t.tpm;
  return t && t.officeName ? tr('Interne — {office}', { office: t.officeName }) : tr('Interne (équipe S&E)');
}
