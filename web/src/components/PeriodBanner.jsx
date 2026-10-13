import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '../api/client.js';
import { Alert } from './ui.jsx';
import { currentMonth, formatInt, monthLabel } from '../lib/format.js';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Période par défaut des écrans d'analyse (retour n° 16) — UNE règle, celle du
 * serveur (GET /api/monitoring/periods → common/period.defaultPeriod) : le
 * dernier mois « substantiel » avec des données, jamais un mois futur.
 *
 * `month` reste null tant que la règle n'est pas connue (l'écran attend, au
 * lieu d'afficher un mois vide puis de sauter) ; si l'appel échoue, le mois
 * courant sert de repli. Un mois choisi par l'utilisateur n'est jamais remplacé.
 * `counts` = formulaires reçus par mois, pour le sélecteur de mois.
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
  const counts = useMemo(() => {
    if (!state.periods) return null;
    const out = {};
    for (const m of state.periods.months || []) out[m.month] = m.submissions;
    return out;
  }, [state.periods]);
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
