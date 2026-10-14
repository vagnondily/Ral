import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { ALERT_LEVELS, classLabels } from '../../lib/mapScale.js';
import { formatInt } from '../../lib/format.js';
import { StatusSymbol } from './DistrictMap.jsx';

/** Échantillon de symbole de point pour la légende. */
function Sym({ children }) {
  return <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true" className="mapx-sym">{children}</svg>;
}

/**
 * Légende graduée (lot 6a) : barre des classes + seuils, « Aucun site actif » /
 * « Aucune donnée », hachures « — aucun plan », symboles des points affichés.
 * Repliable (repliée par défaut en variante compacte et sur téléphone).
 */
export default function MapLegend({ theme, scale, periodText, pointLayers = {}, collapsed, onToggle, hasNoPlan }) {
  const { tr } = useI18n();
  if (!scale) return null;
  const labels = classLabels(scale, formatInt);
  const title = `${tr(theme.label)}${theme.kind === 'pct' ? ' (%)' : ''} — ${tr('par district')} · ${periodText}`;
  return (
    <div className={`mapx-legend${collapsed ? ' is-collapsed' : ''}`}>
      <button type="button" className="mapx-legend-head" onClick={onToggle} aria-expanded={!collapsed}>
        <span>{title}</span>{collapsed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {!collapsed && (
        <div className="mapx-legend-body">
          <div className="mapx-legend-bar" role="list">
            {scale.colors.map((c, i) => (
              <div key={c} className="mapx-legend-step" role="listitem">
                <i style={{ background: c }} />
                <span className="tabular">
                  {scale.kind === 'sev' ? `${ALERT_LEVELS[i].icon} ${tr(labels[i])}` : labels[i]}
                </span>
              </div>
            ))}
          </div>
          <div className="mapx-legend-extra">
            <span><i className="mapx-sw" style={{ background: 'var(--map-empty)' }} />{theme.id === 'submissions' ? tr('Aucune donnée') : theme.id === 'alerts' ? tr('Aucun signal') : tr('Aucun site actif')}</span>
            {(theme.id === 'planning' || theme.id === 'execution' || hasNoPlan) && (
              <span><i className="mapx-sw is-hatch" />{tr('— aucun plan')}</span>
            )}
            {pointLayers.gps && (
              <>
                <span><Sym><StatusSymbol status="realise" /></Sym>{tr('Site visité')}</span>
                <span><Sym><StatusSymbol status="hors_plan" /></Sym>{tr('visité hors plan')}</span>
                <span><Sym><StatusSymbol status="prevu" /></Sym>{tr('prévu')}</span>
                <span><Sym><StatusSymbol status="non_prevu" /></Sym>{tr('non prévu')}</span>
                <span><Sym><StatusSymbol status="inactif" /></Sym>{tr('inactif')}</span>
              </>
            )}
            {pointLayers.derived && <span><Sym><circle r="6" className="mapx-derived" /></Sym>{tr('placé par ses collectes')}</span>}
            {pointLayers.communes && <span><Sym><circle r="6" className="mapx-commune" /></Sym>{tr('centre des collectes (commune)')}</span>}
            {pointLayers.collect && <span><Sym><circle r="3" className="mapx-collect" /></Sym>{tr('point de collecte')}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
