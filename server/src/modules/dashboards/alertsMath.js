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

const { PERIOD_CAPS } = require('../common/periodCaps');
const { spanMonths } = require('../common/period');

const SEVERITIES = ['critical', 'warning', 'info'];
const RANK = { critical: 0, warning: 1, info: 2 };

const cents = (v) => Math.round((Number(v) || 0) * 100);
/**
 * N° AFFICHÉ d'un contrat (glossaire du lot 8, jumeau de web/src/lib/roles.contractNo) : sa référence
 * (n° FLA, avenant compris), sinon le n° FLA, sinon le n° interne CTR-… — le numéro que montrent la
 * liste des contrats, la consolidation et l'alerte « Rapport en retard ». Jamais le CTR-… quand un n° FLA existe.
 */
const shownNo = (c) => c.reference || c.numeroFla || c.numero;
const money = (v) => ({ money: Number(v) || 0 });
const contractGo = (id) => ({ module: 'contrats', sub: 'liste', extra: id });
// Visites déclarées (prestataires en retard, visites non affectées) : l'écran des visites.
const FIELD_GO = { module: 'processus', sub: 'sites' };
/**
 * Exécution du plan des mesures communes : un écran qui affiche la MÊME mesure (tuile « Exécution du
 * plan (visites) », lue sur GET /api/dashboards/coverage), ouvert sur la période ENTIÈRE de l'alerte —
 * jamais Affectation & visites, dont le taux ne compte que les visites déclarées :
 *  - la Synthèse du suivi de processus jusqu'à SYNTHESE_MAX_SPAN mois (son sélecteur : min(analysis,
 *    facts), jumeau de ProcessDashboardPage) ;
 *  - au-delà (le Centre d'alertes accepte PERIOD_CAPS.facts mois), Reporting › Rapport de synthèse,
 *    qui accepte la durée du Centre d'alertes (min(document, facts), jumeau de ReportingPage) et lit la
 *    même mesure (tuile « Exécution du plan (visites) ») : la période n'est jamais écartée en silence.
 *    Jamais « Couverture & performance » : sa synthèse des indicateurs s'arrête à 12 mois.
 */
const SYNTHESE_MAX_SPAN = Math.min(PERIOD_CAPS.analysis, PERIOD_CAPS.facts);
function executionGo(period) {
  if (!period || !period.from || !period.to) return { module: 'processus', sub: 'synthese' };
  const p = { from: period.from, to: period.to };
  return spanMonths(p) > SYNTHESE_MAX_SPAN ? { module: 'reporting', sub: 'synthese', period: p } : { module: 'processus', sub: 'synthese', period: p };
}

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
        params: { numero: shownNo(r), partner: r.partnerName, actual: money(r.actual), budget: money(r.budget) } });
    } else if (cents(r.pendingValidation) > 0 && r.budget != null && cents(r.actual) + cents(r.pendingValidation) > cents(r.budget)) {
      // Factures soumises non encore validées qui, une fois validées, feraient dépasser le budget.
      out.push({ ...base, sev: 'warning', kind: 'budget_pending_overrun',
        title: 'Dépassement si validation — {numero}', detail: '{partner} · réalisé {actual} + en attente {pending} > budget {budget}',
        params: { numero: shownNo(r), partner: r.partnerName, actual: money(r.actual), pending: money(r.pendingValidation), budget: money(r.budget) } });
    } else if (cents(r.projectedOverrun) > 0) {
      out.push({ ...base, sev: 'warning', kind: 'budget_projected_overrun',
        title: 'Projection de dépassement — {numero}', detail: '{partner} · projection fin {projected} > budget {budget}',
        params: { numero: shownNo(r), partner: r.partnerName, projected: money(r.projectedTotal), budget: money(r.budget) } });
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
    params: { partner: r.partnerName || r.contractPartner || '—', numero: r.contractFla || r.contractNumero || '—', month: { month: String(r.periodMonth || '').slice(0, 7) } },
    go: { module: 'tpm', sub: 'rapports' },
  }));
}

/**
 * Rapports en retard sans période choisie (la cloche, le Centre d'alertes par défaut) : les
 * LATE_REPORTS_LOOKBACK derniers mois, mois courant compris — dit sur la page (jamais une limite
 * silencieuse ; jumeau web : lib/reportExpectation.LATE_REPORTS_LOOKBACK).
 */
const LATE_REPORTS_LOOKBACK = 12;

/**
 * Rapports EN RETARD (retour 114, règle tpm/reportExpectation) : seulement les factures attendues
 * d'un TPM qui portait des visites ce mois-là, échéance dépassée — jamais un TPM sans visite planifiée
 * (« non applicable » d'office), jamais le rapport interne (pas encore de document dans l'application).
 * @param {{ rows: object[] }|null} expected  réponse de reports.repository.expectedReports
 */
function lateReportAlerts(expected) {
  return ((expected && expected.rows) || []).filter((r) => r.unit && r.unit.kind === 'tpm' && r.status === 'en_retard').map((r) => {
    // Numéro affiché du contrat seulement — jamais son identifiant technique : sans numéro, le libellé sans contrat.
    const contract = (r.contract && r.contract.label) || null;
    return {
      sev: 'warning', cat: 'Rapports', kind: 'report_late', title: 'Rapport en retard — {provider}',
      detail: contract ? '{month} · contrat {contract} · {n} visite(s) ; à remettre au plus tard en {due}' : '{month} · {n} visite(s) ; à remettre au plus tard en {due}',
      params: { provider: r.unit.name || '—', ...(contract ? { contract } : {}), month: { month: r.month }, n: r.visits.planned + r.visits.realised, due: { month: r.due } },
      // Le lien ouvre Rapports & dépenses sur le MOIS du rapport : la carte « Rapports attendus » y montre la ligne.
      go: { module: 'tpm', sub: 'rapports', period: { from: r.month, to: r.month } },
    };
  });
}

/** Contrats : avenants et contrats en validation, contrats expirés ou à échéance ≤ 90 jours. */
function contractAlerts(contracts, today) {
  const out = [];
  for (const c of contracts || []) {
    const base = { cat: 'Contrats', go: contractGo(c.id) };
    if (c.amendmentPending) {
      out.push({ ...base, sev: 'info', kind: 'amendment_pending', title: 'Avenant en validation — {numero}', detail: '{partner}', params: { numero: shownNo(c), partner: c.partnerName } });
    }
    if (c.status === 'en_validation') {
      out.push({ ...base, sev: 'info', kind: 'contract_pending', title: 'Contrat en validation — {numero}', detail: '{partner}', params: { numero: shownNo(c), partner: c.partnerName } });
    }
    if (c.status === 'actif' && c.dateFin && today) {
      const d = daysBetween(today, c.dateFin);
      if (d < 0) {
        out.push({ ...base, sev: 'warning', kind: 'contract_expired', title: 'Contrat expiré — {numero}', detail: '{partner} · fin le {date}',
          params: { numero: shownNo(c), partner: c.partnerName, date: { date: String(c.dateFin).slice(0, 10) } } });
      } else if (d <= 90) {
        out.push({ ...base, sev: 'warning', kind: 'contract_ending', title: 'Échéance proche — {numero}', detail: '{partner} · fin dans {d} j (renouvellement possible)',
          params: { numero: shownNo(c), partner: c.partnerName, d } });
      }
    }
  }
  return out;
}

/**
 * Terrain (mois courant, ou la période choisie au Centre d'alertes). Le taux lu est l'EXÉCUTION
 * DU PLAN des mesures communes (GET /api/dashboards/coverage, retour 110 : visites prévues des mois
 * échus suivies dans leur mois — visite déclarée OU données reçues — ÷ visites prévues), la même
 * que la Synthèse et « Couverture & performance ». Sans visite prévue, aucune alerte : « aucun
 * plan » n'est pas « 0 % ». Prestataires en retard et visites non affectées restent lus sur les
 * VISITES (résumé terrain, field.summary) : ils portent sur les visites déclarées elles-mêmes.
 * Libellé du moment : « ce mois » seulement sans période choisie (la cloche, le mois courant) ;
 * un mois choisi est nommé (« (Septembre 2026) ») ; une plage dit « sur la période ».
 * @param {object} field  résumé des visites (byProvider)
 * @param {{ range?: boolean, month?: string|null, coverage?: object|null, period?: {from,to}|null }} [opts]
 *   range = la période dépasse un mois ; month = le mois choisi (« AAAA-MM ») quand la période est un
 *   seul mois ; coverage = réponse des mesures de couverture de la période (overall.execution) ;
 *   period = période lue (portée par le lien de l'alerte d'exécution)
 */
function fieldAlerts(field, { range = false, month = null, coverage = null, period = null } = {}) {
  const out = [];
  const ex = coverage && coverage.overall && coverage.overall.execution;
  const when = (current, named, period) => (range ? period : (month ? named : current));
  const whenParams = month && !range ? { m: { month } } : {};
  if (ex && ex.planned > 0 && ex.rate != null && ex.rate < 0.5) {
    out.push({ sev: 'warning', cat: 'Terrain', kind: 'field_low_coverage',
      title: when('Exécution du plan faible ce mois', 'Exécution du plan faible ({m})', 'Exécution du plan faible sur la période'),
      detail: '{done}/{planned} visites prévues suivies ({p})', params: { done: ex.covered, planned: ex.planned, p: { rate: ex.rate }, ...whenParams }, go: executionGo(period) });
  }
  const providers = (field && field.byProvider) || [];
  for (const p of providers) {
    if (p.key !== 'non_affecte' && p.active >= 3 && p.rate < 0.4) {
      // Suivi interne (retour 114) : l'équipe S&E elle-même, nommée par une phrase traduite.
      const title = p.key === 'interne' ? 'Retard de visites — suivi interne (équipe S&E)' : 'Retard de visites — {provider}';
      out.push({ sev: 'info', cat: 'Terrain', kind: 'provider_late', title,
        // Taux typé, mis en forme par l'interface comme sur les pages (« 0,4 % », jamais « 0 % »).
        detail: '{done}/{active} réalisées ({p})', params: { provider: p.label, done: p.realise, active: p.active, p: { rate: p.rate } }, go: FIELD_GO });
    }
  }
  // « Non affectée » : seulement une visite que personne ne suit (ni TPM, ni suivi interne).
  const naf = providers.find((p) => p.key === 'non_affecte');
  if (naf && naf.total > 0) {
    out.push({ sev: 'info', cat: 'Terrain', kind: 'visits_unassigned', title: '{n} visite(s) non affectée(s)',
      // Même nom que la matrice, la carte et les visites : « Non affectée (ni TPM ni suivi interne) » — jamais
      // « sans TPM », qui décrit aussi les visites internes (suivies, elles), ni « planifiés » (une réalisée compte).
      detail: when('Ni TPM ni suivi interne ce mois', 'Ni TPM ni suivi interne ({m})', 'Ni TPM ni suivi interne sur la période'),
      params: { n: naf.total, ...whenParams }, go: FIELD_GO });
  }
  return out;
}

/**
 * Toutes les alertes, triées par gravité (Critique → À surveiller → À traiter),
 * l'ordre des catégories étant conservé à gravité égale. Chaque alerte porte `scope` :
 * 'a_date' (budget et contrats, toujours calculés à date ; rapports quand aucune période
 * n'est choisie) ou 'periode' (terrain ; rapports filtrés par la période choisie).
 * @param {{ consolidationRows?:object[], reports?:object[], expected?:object, contracts?:object[], field?:object,
 *           today:string, range?:boolean, month?:string|null, reportsInPeriod?:boolean, period?:{from,to}|null }} src
 *   today = « AAAA-MM-JJ » ; field = résumé des visites de la période (mois courant par défaut) ;
 *   range = la période dépasse un mois ; month = le mois choisi (période d'un mois) ;
 *   reportsInPeriod = rapports filtrés par la période ; period = période du terrain (lien de l'alerte)
 */
function buildAlerts({ consolidationRows, reports, expected = null, contracts, field, coverage = null, today, range = false, month = null, reportsInPeriod = false, period = null } = {}) {
  const scoped = (list, scope) => list.map((a) => ({ ...a, scope }));
  const all = [
    ...scoped(budgetAlerts(consolidationRows), 'a_date'),
    ...scoped(reportAlerts(reports), reportsInPeriod ? 'periode' : 'a_date'),
    ...scoped(lateReportAlerts(expected), reportsInPeriod ? 'periode' : 'a_date'),
    ...scoped(contractAlerts(contracts, today), 'a_date'),
    ...scoped(fieldAlerts(field, { range, month, coverage, period }), 'periode'),
  ];
  return all.map((a, i) => ({ a, i })).sort((x, y) => (RANK[x.a.sev] - RANK[y.a.sev]) || (x.i - y.i)).map((x) => x.a);
}

/** Nombre d'alertes par gravité, et `attention` = critiques + à surveiller (pastille de la cloche). */
function countAlerts(alerts) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts || []) if (counts[a.sev] != null) counts[a.sev] += 1;
  return { ...counts, attention: counts.critical + counts.warning, total: counts.critical + counts.warning + counts.info };
}

module.exports = { LATE_REPORTS_LOOKBACK, buildAlerts, countAlerts, budgetAlerts, reportAlerts, lateReportAlerts, contractAlerts, fieldAlerts, daysBetween, executionGo, SEVERITIES, SYNTHESE_MAX_SPAN };
