// Centre d'alertes — mise en forme PURE (sans DOM) des alertes calculées par le
// serveur (GET /api/alerts, server/src/modules/dashboards/alertsMath.js), partagée
// par la page « Centre d'alertes » et la cloche de l'en-tête.
import { dayLabel, formatAr, monthLabel } from './format.js';

/** Gravités : ordre, libellé (traduit à l'affichage) et ton de badge. Couleur + icône + libellé, jamais la couleur seule. */
export const SEVERITY = {
  critical: { rank: 0, label: 'Critique', tone: 'red' },
  warning: { rank: 1, label: 'À surveiller', tone: 'orange' },
  info: { rank: 2, label: 'À traiter', tone: 'blue' },
};

/** Valeur d'une variable : { money } → Ariary, { month } → « Septembre 2026 », { date } → « 30 septembre 2026 ». */
export function formatParam(v) {
  if (v && typeof v === 'object') {
    if ('money' in v) return formatAr(v.money);
    if ('month' in v) return /^\d{4}-\d{2}$/.test(v.month || '') ? monthLabel(v.month) : '—';
    if ('date' in v) return /^\d{4}-\d{2}-\d{2}$/.test(v.date || '') ? dayLabel(v.date) : '—';
    return '';
  }
  return v;
}

export function formatParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = formatParam(v);
  return out;
}

/** Titre et détail d'une alerte dans la langue de l'interface (`tr` = traduction par phrase française). */
export function alertText(tr, a) {
  const p = formatParams(a.params);
  return { title: tr(a.title, p), detail: a.detail ? tr(a.detail, p) : '' };
}

/** Sources lues par le serveur (alerts.service : `unavailable`), libellés traduits à l'affichage. */
export const ALERT_SOURCES = { budget: 'Budget', contrats: 'Contrats', rapports: 'Rapports', terrain: 'Terrain' };

/**
 * État du Centre d'alertes (page et cloche) — jamais « tout est au vert » quand
 * une source n'a pas pu être lue :
 *   'alerts'  : il y a des alertes (et peut-être des sources non lues) ;
 *   'partial' : aucune alerte dans les sources lues, mais `unavailable` non vide ;
 *   'clear'   : aucune alerte, toutes les sources lues.
 * @param {{ items?: object[], unavailable?: string[] } | null} data réponse de GET /api/alerts
 * @returns {{ status: 'alerts'|'partial'|'clear', unavailable: string[] }}
 */
export function alertsState(data) {
  const unavailable = Array.isArray(data?.unavailable) ? data.unavailable : [];
  const status = (data?.items || []).length > 0 ? 'alerts' : unavailable.length > 0 ? 'partial' : 'clear';
  return { status, unavailable };
}

/** Sources non lues, nommées dans la langue de l'interface (« Budget, Terrain »). */
export const sourceList = (tr, sources) => (sources || []).map((s) => tr(ALERT_SOURCES[s] || s)).join(', ');

/** Arguments de navigation (module, sous-page, élément) de l'écran concerné. */
export const goArgs = (go) => (go ? [go.module, go.sub, go.extra || undefined] : null);
