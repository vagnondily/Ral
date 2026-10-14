/**
 * Centre d'alertes — règles PURES (zéro I/O, testées : server/test/alertsMath.test.js).
 *
 * Une seule source pour la page « Centre d'alertes » ET la cloche de l'en-tête
 * (retour n° 34) : GET /api/alerts calcule la liste ici, les deux écrans ne
 * font que l'afficher. Recalculé en direct, rien de stocké.
 *
 * Chaque alerte = { sev, cat, kind, title, detail, params, go } :
 *   - sev   : 'critical' | 'warning' | 'info' (Critique · À surveiller · À traiter) ;
 *   - title / detail : phrases FRANÇAISES (langue de référence) avec des
 *     variables {nom}, traduites côté interface (tr) ;
 *   - params : valeurs des variables ; une valeur typée { money } / { month } /
 *     { date } est mise en forme par l'interface (Ariary, mois, date en clair) ;
 *   - go    : écran à ouvrir { module, sub, extra? } (route de l'application).
 * Les montants sont comparés en CENTIMES entiers, jamais en flottants.
 */

const SEVERITIES = ['critical', 'warning', 'info'];
const RANK = { critical: 0, warning: 1, info: 2 };

const cents = (v) => Math.round((Number(v) || 0) * 100);
const money = (v) => ({ money: Number(v) || 0 });
const contractGo = (id) => ({ module: 'contrats', sub: 'liste', extra: id });
const FIELD_GO = { module: 'processus', sub: 'sites' };

/** Jours entiers entre deux dates « AAAA-MM-JJ » (b − a), en UTC : aucun décalage horaire. */
function daysBetween(a, b) {
  const t = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Budget de suivi : dépassé (critique), dépassé si les factures en attente sont validées, ou projeté en dépassement. */
function budgetAlerts(rows) {
  const out = [];
  for (const r of rows || []) {
    const base = { cat: 'Budget', go: contractGo(r.contractId) };
    if (r.overspent) {
      out.push({ ...base, sev: 'critical', kind: 'budget_overspent',
        title: 'Budget de suivi dépassé — {numero}', detail: '{partner} · réalisé {actual} / budget {budget}',
        params: { numero: r.numero, partner: r.partnerName, actual: money(r.actual), budget: money(r.budget) } });
    } else if (cents(r.pendingValidation) > 0 && r.budget != null && cents(r.actual) + cents(r.pendingValidation) > cents(r.budget)) {
      // Factures soumises non encore validées qui, une fois validées, feraient dépasser le budget.
      out.push({ ...base, sev: 'warning', kind: 'budget_pending_overrun',
        title: 'Dépassement si validation — {numero}', detail: '{partner} · réalisé {actual} + en attente {pending} > budget {budget}',
        params: { numero: r.numero, partner: r.partnerName, actual: money(r.actual), pending: money(r.pendingValidation), budget: money(r.budget) } });
    } else if (cents(r.projectedOverrun) > 0) {
      out.push({ ...base, sev: 'warning', kind: 'budget_projected_overrun',
        title: 'Projection de dépassement — {numero}', detail: '{partner} · projection fin {projected} > budget {budget}',
        params: { numero: r.numero, partner: r.partnerName, projected: money(r.projectedTotal), budget: money(r.budget) } });
    }
  }
  return out;
}

/**
 * Rapports à valider : seulement ceux que l'utilisateur peut réellement décider
 * (actions calculées par reportWorkflow) — jamais ses propres rapports, qu'il a
 * remplis ou soumis (séparation des tâches).
 */
function reportAlerts(reports) {
  return (reports || []).filter((r) => r.status === 'soumis' && r.actions && r.actions.decide).map((r) => ({
    sev: 'info', cat: 'Rapports', kind: 'report_to_validate',
    title: r.kind === 'technique' ? 'Rapport technique à valider' : 'Rapport financier à valider',
    detail: '{partner} · {numero} · {month}',
    params: { partner: r.partnerName || r.contractPartner || '—', numero: r.contractNumero || '—', month: { month: String(r.periodMonth || '').slice(0, 7) } },
    go: { module: 'tpm', sub: 'rapports' },
  }));
}

/** Contrats : avenants et contrats en validation, contrats expirés ou à échéance ≤ 90 jours. */
function contractAlerts(contracts, today) {
  const out = [];
  for (const c of contracts || []) {
    const base = { cat: 'Contrats', go: contractGo(c.id) };
    if (c.amendmentPending) {
      out.push({ ...base, sev: 'info', kind: 'amendment_pending', title: 'Avenant en validation — {numero}', detail: '{partner}', params: { numero: c.numero, partner: c.partnerName } });
    }
    if (c.status === 'en_validation') {
      out.push({ ...base, sev: 'info', kind: 'contract_pending', title: 'Contrat en validation — {numero}', detail: '{partner}', params: { numero: c.numero, partner: c.partnerName } });
    }
    if (c.status === 'actif' && c.dateFin && today) {
      const d = daysBetween(today, c.dateFin);
      if (d < 0) {
        out.push({ ...base, sev: 'warning', kind: 'contract_expired', title: 'Contrat expiré — {numero}', detail: '{partner} · fin le {date}',
          params: { numero: c.numero, partner: c.partnerName, date: { date: String(c.dateFin).slice(0, 10) } } });
      } else if (d <= 90) {
        out.push({ ...base, sev: 'warning', kind: 'contract_ending', title: 'Échéance proche — {numero}', detail: '{partner} · fin dans {d} j (renouvellement possible)',
          params: { numero: c.numero, partner: c.partnerName, d } });
      }
    }
  }
  return out;
}

/**
 * Terrain (mois courant, ou la période choisie au Centre d'alertes), sur le résumé des
 * visites (field.summary) — mêmes chiffres que « Affectation & visites ». Le taux lu est
 * l'EXÉCUTION DU PLAN (visites réalisées ÷ visites prévues), libellée comme telle — la
 * « couverture » désigne désormais les sites (lot 1b). Sans visite planifiée (active = 0),
 * aucune alerte : « aucun plan » n'est pas « 0 % ».
 * @param {object} field  résumé des visites
 * @param {{ range?: boolean }} [opts] range = la période dépasse un mois (« sur la période »)
 */
function fieldAlerts(field, { range = false } = {}) {
  const out = [];
  const ov = field && field.overall;
  if (ov && ov.active > 0 && ov.rate < 0.5) {
    out.push({ sev: 'warning', cat: 'Terrain', kind: 'field_low_coverage',
      title: range ? 'Exécution du plan faible sur la période' : 'Exécution du plan faible ce mois',
      detail: '{done}/{active} visites réalisées ({p} %)', params: { done: ov.realise, active: ov.active, p: Math.round(ov.rate * 100) }, go: FIELD_GO });
  }
  const providers = (field && field.byProvider) || [];
  for (const p of providers) {
    if (p.key !== 'non_affecte' && p.active >= 3 && p.rate < 0.4) {
      out.push({ sev: 'info', cat: 'Terrain', kind: 'provider_late', title: 'Retard de visites — {provider}',
        detail: '{done}/{active} réalisées ({p} %)', params: { provider: p.label, done: p.realise, active: p.active, p: Math.round(p.rate * 100) }, go: FIELD_GO });
    }
  }
  const naf = providers.find((p) => p.key === 'non_affecte');
  if (naf && naf.total > 0) {
    out.push({ sev: 'info', cat: 'Terrain', kind: 'visits_unassigned', title: '{n} visite(s) non affectée(s)',
      detail: range ? 'Sites planifiés sans prestataire TPM sur la période' : 'Sites planifiés sans prestataire TPM ce mois',
      params: { n: naf.total }, go: FIELD_GO });
  }
  return out;
}

/**
 * Toutes les alertes, triées par gravité (Critique → À surveiller → À traiter),
 * l'ordre des catégories étant conservé à gravité égale. Chaque alerte porte `scope` :
 * 'a_date' (budget et contrats, toujours calculés à date ; rapports quand aucune période
 * n'est choisie) ou 'periode' (terrain ; rapports filtrés par la période choisie).
 * @param {{ consolidationRows?:object[], reports?:object[], contracts?:object[], field?:object,
 *           today:string, range?:boolean, reportsInPeriod?:boolean }} src
 *   today = « AAAA-MM-JJ » ; field = résumé des visites de la période (mois courant par défaut) ;
 *   range = la période dépasse un mois ; reportsInPeriod = rapports filtrés par la période
 */
function buildAlerts({ consolidationRows, reports, contracts, field, today, range = false, reportsInPeriod = false } = {}) {
  const scoped = (list, scope) => list.map((a) => ({ ...a, scope }));
  const all = [
    ...scoped(budgetAlerts(consolidationRows), 'a_date'),
    ...scoped(reportAlerts(reports), reportsInPeriod ? 'periode' : 'a_date'),
    ...scoped(contractAlerts(contracts, today), 'a_date'),
    ...scoped(fieldAlerts(field, { range }), 'periode'),
  ];
  return all.map((a, i) => ({ a, i })).sort((x, y) => (RANK[x.a.sev] - RANK[y.a.sev]) || (x.i - y.i)).map((x) => x.a);
}

/** Nombre d'alertes par gravité, et `attention` = critiques + à surveiller (pastille de la cloche). */
function countAlerts(alerts) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts || []) if (counts[a.sev] != null) counts[a.sev] += 1;
  return { ...counts, attention: counts.critical + counts.warning, total: counts.critical + counts.warning + counts.info };
}

module.exports = { buildAlerts, countAlerts, budgetAlerts, reportAlerts, contractAlerts, fieldAlerts, daysBetween, SEVERITIES };
