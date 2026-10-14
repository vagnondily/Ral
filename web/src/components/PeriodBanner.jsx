import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Info } from 'lucide-react';
import { api } from '../api/client.js';
import { Alert } from './ui.jsx';
import { currentMonth, formatInt, monthLabel } from '../lib/format.js';
import { useI18n } from '../lib/i18n.jsx';
import {
  isPeriod, readHashPeriod, readSessionPeriod, samePeriod, single, writeHashPeriod, writeSessionPeriod,
} from '../lib/period.js';

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
 *   - 'all'     : null (toutes les périodes : cumul).
 *
 * @param {{ scope?: 'analysis'|'local', defaultRule?: 'data'|'current'|'all', urlSync?: boolean }} [opts]
 *   scope 'analysis' : période partagée entre les tableaux de bord de la session ;
 *   'local' : ni lue ni écrite en session (ex. Centre d'alertes : URL seulement).
 * @returns {{ period: {from,to}|null|undefined, ready: boolean, auto: object|null, periods: object|null,
 *   counts: object|null, latest: string|null, today: string, source: 'url'|'session'|'default'|'user'|null,
 *   setPeriod: Function, resetToDefault: Function }}
 *   `period` vaut undefined tant que la règle 'data' n'est pas connue (l'écran attend au lieu
 *   d'afficher une période vide puis de sauter) ; si l'appel échoue, le mois courant sert de repli.
 *   `auto` (bandeau PeriodBanner) n'est rempli que si la période vient de la règle par défaut
 *   et diffère du mois courant.
 */
export function usePeriod({ scope = 'analysis', defaultRule = 'data', urlSync = true } = {}) {
  const today = useMemo(() => currentMonth(), []);
  const useSession = scope === 'analysis';
  const initial = useMemo(() => {
    const fromUrl = urlSync ? readHashPeriod(window.location.hash) : null;
    if (fromUrl) return { period: fromUrl, source: 'url' };
    const fromSession = useSession ? readSessionPeriod(sessionStore()) : null;
    if (fromSession) return { period: fromSession, source: 'session' };
    if (defaultRule === 'current') return { period: single(today), source: 'default' };
    if (defaultRule === 'all') return { period: null, source: 'default' };
    return { period: undefined, source: null }; // 'data' : en attente du serveur
  }, []); // eslint-disable-line
  const [state, setState] = useState({ ...initial, auto: null });
  const [periods, setPeriods] = useState(null);
  const defaultRef = useRef(null); // période par défaut connue (règle de l'écran)

  // Volume par mois et période par défaut du serveur (une fois).
  useEffect(() => {
    let alive = true;
    api.monPeriods(today).then((p) => {
      if (!alive) return;
      setPeriods(p);
      const def = p.default || {};
      const month = def.month || today;
      const ruled = defaultRule === 'data' ? single(month) : (defaultRule === 'current' ? single(today) : null);
      const auto = defaultRule === 'data' && month !== (def.today || today) ? def : null;
      defaultRef.current = { period: ruled, auto };
      setState((s) => (s.period !== undefined ? s : { period: ruled, source: 'default', auto }));
    }, () => {
      if (!alive) return;
      const ruled = defaultRule === 'all' ? null : single(today);
      defaultRef.current = { period: ruled, auto: null };
      setState((s) => (s.period !== undefined ? s : { period: ruled, source: 'default', auto: null }));
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line

  // Lien suivi dans la même page (#/route?from=…&to=…) : la période de l'URL s'applique.
  useEffect(() => {
    if (!urlSync) return undefined;
    const onHash = () => {
      const p = readHashPeriod(window.location.hash);
      if (p) setState((s) => (samePeriod(s.period, p) ? s : { period: p, source: 'url', auto: null }));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [urlSync]);

  // Une période venue de l'URL devient la période de travail de la session.
  useEffect(() => {
    if (useSession && state.source === 'url' && isPeriod(state.period)) writeSessionPeriod(sessionStore(), state.period);
  }, [useSession, state.source, state.period]);

  const setPeriod = useCallback((p) => {
    const next = isPeriod(p) ? { from: p.from, to: p.to } : null;
    setState({ period: next, source: 'user', auto: null });
    if (urlSync) {
      try {
        const hash = writeHashPeriod(window.location.hash, next);
        if (hash !== window.location.hash) window.history.replaceState(window.history.state, '', hash || '#');
      } catch { /* URL non modifiable : la période vit dans l'état */ }
    }
    if (useSession) writeSessionPeriod(sessionStore(), next);
  }, [urlSync, useSession]);

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
    setState({ period: def.period, source: 'default', auto: def.auto });
  }, [defaultRule, today, urlSync, useSession]);

  const counts = useMemo(() => countsOf(periods), [periods]);
  // « Dernier mois avec des données » = le mois par défaut du serveur (dernier mois substantiel),
  // le même que le bandeau et que « Revenir au dernier mois avec des données ».
  const def = periods && periods.default;
  const latest = def && def.reason !== 'none' ? (def.month || null) : null;
  return {
    period: state.period, ready: state.period !== undefined, auto: state.source === 'default' ? state.auto : null,
    periods, counts, latest, today, source: state.source, setPeriod, resetToDefault,
  };
}

/**
 * Mention « période conservée de la session » (la période vient d'un autre écran de la
 * session) + « Revenir au dernier mois avec des données ». Rien sinon.
 */
export function SessionPeriodNote({ source, onReset }) {
  const { tr } = useI18n();
  if (source !== 'session') return null;
  return (
    <p className="period-session-note">
      <History size={14} aria-hidden="true" />
      <span>{tr('période conservée de la session')}</span>
      <button type="button" className="inline-link" onClick={onReset}>{tr('Revenir au dernier mois avec des données')}</button>
    </p>
  );
}

/**
 * Période par défaut des écrans d'analyse (retour n° 16) — UNE règle, celle du
 * serveur (GET /api/monitoring/periods → common/period.defaultPeriod) : le
 * dernier mois « substantiel » avec des données, jamais un mois futur.
 *
 * `month` reste null tant que la règle n'est pas connue (l'écran attend, au
 * lieu d'afficher un mois vide puis de sauter) ; si l'appel échoue, le mois
 * courant sert de repli. Un mois choisi par l'utilisateur n'est jamais remplacé.
 * `counts` = formulaires reçus par mois, pour le sélecteur de mois.
 * Remplacé par usePeriod (plage de mois) ; retiré quand ses deux écrans (Synthèse,
 * Couverture & performance) seront passés à la plage (lot 1b, C11).
 */
export function useDefaultMonth() {
  const [state, setState] = useState({ month: null, auto: null, periods: null });
  useEffect(() => {
    let alive = true;
    const today = currentMonth();
    api.monPeriods(today).then((p) => {
      if (!alive) return;
      const def = p.default || {};
      const month = def.month || today;
      setState((s) => (s.month ? s : { month, periods: p, auto: month !== (def.today || today) ? def : null }));
    }, () => { if (alive) setState((s) => (s.month ? s : { month: today, auto: null, periods: null })); });
    return () => { alive = false; };
  }, []);
  const pick = useCallback((m) => setState((s) => ({ ...s, month: m, auto: null })), []);
  const counts = useMemo(() => countsOf(state.periods), [state.periods]);
  return { month: state.month, auto: state.auto, periods: state.periods, counts, pick };
}

/**
 * Bandeau « Placé sur juillet 2026, dernier mois avec des données » + retour au
 * mois courant. Dit toujours OÙ la page s'est placée et POURQUOI.
 */
export function PeriodBanner({ auto, onBack }) {
  const { tr } = useI18n();
  if (!auto) return null;
  const shown = monthLabel(auto.month);
  const today = monthLabel(auto.today);
  let why;
  if (auto.reason === 'latest_substantial' && auto.todayCount > 0) {
    why = tr('{today} : seulement {n} formulaire(s) reçu(s) pour l\'instant.', { today, n: formatInt(auto.todayCount) });
  } else if (auto.reason === 'latest_substantial') {
    why = tr('{today} : aucune donnée ; les mois suivants n\'ont que quelques formulaires.', { today });
  } else {
    why = tr('{today} : aucune donnée pour l\'instant.', { today });
  }
  return (
    <div className="period-banner">
      <Alert tone="info" icon={Info}>
        {tr('Placé sur {shown}, dernier mois avec des données.', { shown })} <span className="muted">{why}</span>{' '}
        <button type="button" className="inline-link" onClick={() => onBack(auto.today)}>{tr('Revenir à {m}', { m: today })}</button>
      </Alert>
    </div>
  );
}
