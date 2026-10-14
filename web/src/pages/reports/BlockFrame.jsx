import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { Button } from '../../components/ui.jsx';

/**
 * Cadre d'un bloc qui attend ses données (lot 7a) : jamais de page blanche.
 *  - en attente / en calcul : squelette NOMMÉ (titre du bloc ou libellé du catalogue) et
 *    chronomètre (« calcul en cours · 0,8 s »), à la hauteur mesurée la dernière fois ;
 *  - erreur : message lisible et « Réessayer » — une erreur ne bloque jamais les autres blocs ;
 *  - prêt : le bloc.
 */
export default function BlockFrame({ iid, state, label, height = 120, onRetry, observe, onHeight, children }) {
  const { tr } = useI18n();
  const ref = useRef(null);
  const status = state ? state.status : 'waiting';
  const [, setTick] = useState(0);

  useEffect(() => { if (observe && ref.current) observe(iid, ref.current); }, [iid, observe]);
  // Chronomètre pendant le calcul.
  useEffect(() => {
    if (status !== 'loading') return undefined;
    const h = setInterval(() => setTick((x) => x + 1), 200);
    return () => clearInterval(h);
  }, [status]);
  // Hauteur réelle mémorisée : le squelette suivant prend la place exacte (la page ne saute pas).
  useEffect(() => {
    if (status !== 'ready' || !ref.current || !onHeight || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => onHeight(iid, Math.ceil(ref.current.getBoundingClientRect().height)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [status, iid, onHeight]);

  if (status === 'ready') return <div ref={ref} className="rd-frame">{children}</div>;
  if (status === 'error') {
    const err = (state && state.result && state.result.error) || {};
    return (
      <div ref={ref} className="rd-frame rd-frame-error" role="alert">
        <AlertTriangle size={16} aria-hidden="true" />
        <div>
          <strong>{label}</strong>
          <p>{err.message || tr('Calcul impossible pour ce bloc.')}</p>
        </div>
        {onRetry && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={(e) => { e.stopPropagation(); onRetry(iid); }}>{tr('Réessayer')}</Button>}
      </div>
    );
  }
  const secs = status === 'loading' && state.startedAt ? ((Date.now() - state.startedAt) / 1000) : null;
  return (
    <div ref={ref} className="rd-frame rd-skel" style={{ minHeight: `${Math.max(48, Math.min(height, 900))}px` }} aria-busy="true">
      <span className="rd-skel-label">{label}</span>
      <span className="rd-skel-state">
        {secs != null
          ? tr('calcul en cours · {s} s', { s: secs.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
          : tr('en attente du calcul')}
      </span>
    </div>
  );
}
