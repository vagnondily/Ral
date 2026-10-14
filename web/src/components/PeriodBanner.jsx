import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, History, Info } from 'lucide-react';
import { api } from '../api/client.js';
import { Alert } from './ui.jsx';
import { currentMonth, formatInt, monthLabel } from '../lib/format.js';
import { useI18n } from '../lib/i18n.jsx';
import {
  MAX_SPAN, addMonths, isPeriod, periodLabel, readHashPeriod, readSessionPeriod, samePeriod, single, spanMonths, writeHashPeriod, writeSessionPeriod,
} from '../lib/period.js';

/**
 * Période ramenée au plafond de l'écran : au-delà de `maxSpan` mois, les `maxSpan` derniers
 * mois (finissant à `to`). Sert seulement à une règle par défaut propre à l'écran ; une période
 * d'URL ou de session trop longue n'est jamais tronquée en silence : elle est écartée (usePeriod).
 */
export function clampPeriod(p, maxSpan = MAX_SPAN) {
  if (!isPeriod(p) || spanMonths(p) <= maxSpan) return p;
  return { from: addMonths(p.to, -(maxSpan - 1)), to: p.to };
}

/** Vrai si la période dépasse la durée maximale de l'écran. */
const tooLongFor = (p, maxSpan) => isPeriod(p) && spanMonths(p) > maxSpan;

const sessionStore = () => { try { return window.sessionStorage; } catch { return null; } };

/** Volume de données par mois { 'AAAA-MM': n } d'une réponse GET /monitoring/periods. */
function countsOf(periods) {
  if (!periods) return null;
  const out = {};
  for (const m of periods.months || []) out[m.month] = m.submissions;
  return out;
}

/**
 * Période d'un écran (lot 1b, retour n° 47) : une plage de mois { from, to }, ou null
 * (« toutes les périodes », là où l'écran le propose).
 *
 * Ordre de priorité à l'ouverture : 1. l'URL (#/route?from=…&to=…, lien partagé ;
 * l'ancien ?month= est lu) ; 2. la période de travail de la session
 * (sessionStorage['mems.period.v1'], portée « analysis » seulement) ; 3. la règle
 * par défaut de l'écran :
 *   - 'data'    : la période par défaut du serveur (GET /monitoring/periods → default :
 *                 dernier mois substantiel avec des données, jamais un mois futur) ;
 *   - 'current' : le mois courant ;
 *   - 'all'     : null (toutes les périodes : cumul) ;
 *   - 'custom'  : `customDefault`, fourni par l'écran (ex. Résultats : dernier mois de la fiche) —
 *                 undefined tant qu'il n'est pas connu, puis { from, to } ou null.
 *
 * @param {{ scope?: 'analysis'|'local', defaultRule?: 'data'|'current'|'all', urlSync?: boolean, maxSpan?: number }} [opts]
 *   scope 'analysis' : période partagée entre les tableaux de bord de la session ;
 *   'local' : ni lue ni écrite en session (ex. Centre d'alertes : URL seulement) ;
 *   maxSpan : durée maximale acceptée par les endpoints de l'écran (lib/periodCaps, la table du
 *   serveur) — une période d'URL ou de session plus longue (lien partagé, période choisie sur le
 *   budget) est ÉCARTÉE : l'écran prend sa période par défaut et le dit (source 'capped',
 *   SessionPeriodNote), au lieu d'échouer sur un refus du serveur.
 * @returns {{ period: {from,to}|null|undefined, ready: boolean, auto: object|null, periods: object|null,
 *   counts: object|null, latest: string|null, today: string,
 *   source: 'url'|'session'|'default'|'capped'|'user'|null, capped: { period, maxSpan }|null,
 *   setPeriod: Function, resetToDefault: Function }}
 *   `period` vaut undefined tant que la règle 'data' n'est pas connue (l'écran attend au lieu
 *   d'afficher une période vide puis de sauter) ; si l'appel échoue, le mois courant sert de repli.
 *   `auto` (bandeau PeriodBanner) n'est rempli que si la période vient de la règle par défaut
 *   et diffère du mois courant.
 */
export function usePeriod({ scope = 'analysis', defaultRule = 'data', urlSync = true, maxSpan = MAX_SPAN, customDefault } = {}) {
  const today = useMemo(() => currentMonth(), []);
  const useSession = scope === 'analysis';
  const initial = useMemo(() => {
    // Règle par défaut de l'écran (undefined pour 'data' / 'custom' : en attente de la règle).
    const byRule = (extra) => {
      if (defaultRule === 'current') return { period: single(today), source: 'default', ...extra };
      if (defaultRule === 'all') return { period: null, source: 'default', ...extra };
      return { period: undefined, source: null, ...extra };
    };
    const fromUrl = urlSync ? readHashPeriod(window.location.hash) : null;
    if (fromUrl && !tooLongFor(fromUrl, maxSpan)) return { period: fromUrl, source: 'url' };
    if (fromUrl) {
      // Lien plus long que l'écran ne le permet : retiré de l'URL, période par défaut, mention.
      try {
        const hash = writeHashPeriod(window.location.hash, null);
        if (hash !== window.location.hash) window.history.replaceState(window.history.state, '', hash || '#');
      } catch { /* URL non modifiable : sans incidence */ }
      return byRule({ capped: { period: fromUrl, maxSpan }, source: 'capped' });
    }
    const fromSession = useSession ? readSessionPeriod(sessionStore()) : null;
    if (fromSession && !tooLongFor(fromSession, maxSpan)) return { period: fromSession, source: 'session' };
    // Période de session plus longue (venue du budget, 60 mois) : écartée ici, gardée en session.
    if (fromSession) return byRule({ capped: { period: fromSession, maxSpan }, source: 'capped' });
    return byRule({});
  }, []); // eslint-disable-line
  const [state, setState] = useState({ capped: null, ...initial, auto: null });
  const [periods, setPeriods] = useState(null);
  const defaultRef = useRef(null); // période par défaut connue (règle de l'écran)
  // Période par défaut appliquée quand elle est connue : la mention « période écartée » reste.
  const applyDefault = (s, ruled, auto) => (s.period !== undefined ? s
    : { ...s, period: ruled, source: s.source === 'capped' ? 'capped' : 'default', auto });

  // Règle propre à l'écran : appliquée dès qu'elle est connue (jamais par-dessus un choix).
  useEffect(() => {
    if (defaultRule !== 'custom' || customDefault === undefined) return;
    const ruled = isPeriod(customDefault) ? clampPeriod(customDefault, maxSpan) : null;
    defaultRef.current = { period: ruled, auto: null };
    setState((s) => applyDefault(s, ruled, null));
  }, [defaultRule, customDefault && customDefault.from, customDefault && customDefault.to, customDefault === null]); // eslint-disable-line

  // Volume par mois et période par défaut du serveur (une fois ; inutile pour la règle 'custom').
  useEffect(() => {
    if (defaultRule === 'custom') return undefined;
    let alive = true;
    api.monPeriods(today).then((p) => {
      if (!alive) return;
      setPeriods(p);
      const def = p.default || {};
      const month = def.month || today;
      const ruled = defaultRule === 'data' ? single(month) : (defaultRule === 'current' ? single(today) : null);
      const auto = defaultRule === 'data' && month !== (def.today || today) ? def : null;
      defaultRef.current = { period: ruled, auto };
      setState((s) => applyDefault(s, ruled, auto));
    }, () => {
      if (!alive) return;
      const ruled = defaultRule === 'all' ? null : single(today);
      defaultRef.current = { period: ruled, auto: null };
      setState((s) => applyDefault(s, ruled, null));
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line

  // Lien suivi dans la même page (#/route?from=…&to=…) : la période de l'URL s'applique ;
  // trop longue pour l'écran, elle est écartée (période par défaut, mention).
  useEffect(() => {
    if (!urlSync) return undefined;
    const onHash = () => {
      const p = readHashPeriod(window.location.hash);
      if (!p) return;
      if (tooLongFor(p, maxSpan)) {
        const def = defaultRef.current;
        setState((s) => ({ ...s, period: def ? def.period : s.period, source: 'capped', capped: { period: p, maxSpan }, auto: null }));
        return;
      }
      setState((s) => (samePeriod(s.period, p) ? s : { period: p, source: 'url', capped: null, auto: null }));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [urlSync, maxSpan]);

  // Une période venue de l'URL devient la période de travail de la session.
  useEffect(() => {
    if (useSession && state.source === 'url' && isPeriod(state.period)) writeSessionPeriod(sessionStore(), state.period);
  }, [useSession, state.source, state.period]);

  const setPeriod = useCallback((p) => {
    // Le sélecteur ne propose jamais plus que maxSpan ; un appel plus long est écarté, jamais tronqué.
    if (tooLongFor(p, maxSpan)) {
      setState((s) => ({ ...s, source: 'capped', capped: { period: { from: p.from, to: p.to }, maxSpan } }));
      return;
    }
    const next = isPeriod(p) ? { from: p.from, to: p.to } : null;
    setState({ period: next, source: 'user', capped: null, auto: null });
    if (urlSync) {
      try {
        const hash = writeHashPeriod(window.location.hash, next);
        if (hash !== window.location.hash) window.history.replaceState(window.history.state, '', hash || '#');
      } catch { /* URL non modifiable : la période vit dans l'état */ }
    }
    if (useSession) writeSessionPeriod(sessionStore(), next);
  }, [urlSync, useSession, maxSpan]);

  // « Revenir au dernier mois avec des données » : la règle de l'écran, session oubliée.
  const resetToDefault = useCallback(() => {
    if (useSession) writeSessionPeriod(sessionStore(), null);
    const def = defaultRef.current || { period: defaultRule === 'all' ? null : single(today), auto: null };
    if (urlSync) {
      try {
        const hash = writeHashPeriod(window.location.hash, null);
        if (hash !== window.location.hash) window.history.replaceState(window.history.state, '', hash || '#');
      } catch { /* sans incidence */ }
    }
    setState({ period: def.period, source: 'default', capped: null, auto: def.auto });
  }, [defaultRule, today, urlSync, useSession]);

  const counts = useMemo(() => countsOf(periods), [periods]);
  // « Dernier mois avec des données » = le mois par défaut du serveur (dernier mois substantiel),
  // le même que le bandeau et que « Revenir au dernier mois avec des données ».
  const def = periods && periods.default;
  const latest = def && def.reason !== 'none' ? (def.month || null) : null;
  return {
    period: state.period, ready: state.period !== undefined,
    auto: state.source === 'default' || state.source === 'capped' ? state.auto : null,
    periods, counts, latest, today, source: state.source, capped: state.source === 'capped' ? state.capped : null, setPeriod, resetToDefault,
  };
}

/**
 * Mention « période conservée de la session » (la période vient d'un autre écran de la
 * session) + le retour à la règle de l'écran : « Revenir au dernier mois avec des données »
 * (défaut), ou `resetLabel` (ex. « Revenir à toutes les périodes » sur les écrans budgétaires).
 */
export function SessionPeriodNote({ source, onReset, resetLabel, capped }) {
  const { tr, lang } = useI18n();
  // Période d'un lien ou de la session écartée : plus longue que l'écran ne le permet (lib/periodCaps).
  if (source === 'capped') {
    return (
      <p className="period-session-note is-capped" role="status">
        <Info size={14} aria-hidden="true" />
        <span>
          {capped && isPeriod(capped.period)
            ? tr('Période demandée ({p}, {n} mois) plus longue que les {max} mois que permet cet écran : période par défaut affichée.', {
              p: periodLabel(capped.period, lang), n: spanMonths(capped.period), max: capped.maxSpan,
            })
            : tr('Période demandée plus longue que ce que permet cet écran : période par défaut affichée.')}
        </span>
      </p>
    );
  }
  if (source !== 'session') return null;
  return (
    <p className="period-session-note">
      <History size={14} aria-hidden="true" />
      <span>{tr('période conservée de la session')}</span>
      <button type="button" className="inline-link" onClick={onReset}>{resetLabel || tr('Revenir au dernier mois avec des données')}</button>
    </p>
  );
}

/**
 * Sites actifs d'une période (faits site × mois, lot 1b) : sans grille d'activation importée
 * (`field.activationKnown === false`), tout le registre compte comme actif — le dire sous les
 * KPI, puisque la couverture des sites en dépend. Rien sinon.
 */
export function ActivationNote({ field }) {
  const { tr } = useI18n();
  if (!field || field.activationKnown !== false) return null;
  return (
    <p className="period-session-note activation-note">
      <Info size={14} aria-hidden="true" />
      <span>{tr('grille d\'activation non importée : taux calculé sur tout le registre')}</span>
    </p>
  );
}

/**
 * Bandeau « Placé sur juillet 2026, dernier mois avec des données » + retour au
 * mois courant. Dit toujours OÙ la page s'est placée et POURQUOI.
 */
/**
 * Ligne de période (retour 78) : « Période : septembre 2026 — du 01/09/2026 au 30/09/2026 · 1 mois ».
 * Sobre, sans bandeau ; quand la période par défaut a été placée sur le dernier mois qui a des
 * données, une simple mention discrète le dit (le sélecteur permet de revenir à un autre mois).
 * `onBack` est gardé pour compatibilité des appels.
 */
export function PeriodBanner({ auto, period }) {
  const { tr, lang } = useI18n();
  const p = period || (auto ? { from: auto.month, to: auto.month } : null);
  if (!p) return null;
  const dayOf = (m, last) => {
    const [y, mm] = m.split('-').map(Number);
    const d = last ? new Date(Date.UTC(y, mm, 0)).getUTCDate() : 1;
    return lang === 'en' ? `${String(mm).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}` : `${String(d).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${y}`;
  };
  const n = spanMonths(p);
  return (
    <p className="period-summary">
      <CalendarRange size={14} aria-hidden="true" />
      <span>{tr('Période')} : <strong>{periodLabel(p, lang)}</strong></span>
      <span className="muted">{tr('du {a} au {b}', { a: dayOf(p.from, false), b: dayOf(p.to, true) })} · {tr('{n} mois', { n })}</span>
      {auto && <span className="muted">· {tr('dernier mois avec des données')}</span>}
    </p>
  );
}
