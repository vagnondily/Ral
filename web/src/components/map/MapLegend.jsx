import React, { useId, useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { ALERT_LEVELS, classLabels } from '../../lib/mapScale.js';
import { formatInt } from '../../lib/format.js';
import { ACTIVITY_HELP, OTHER_LABEL, SHAPE_TEXT, STATUS_TEXT } from '../../lib/mapPoints.js';
import { ActivitySymbol, StatusSymbol } from './DistrictMap.jsx';

/** Échantillon de symbole de point pour la légende. */
function Sym({ children }) {
  return <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true" className="mapx-sym">{children}</svg>;
}

/** Forme d'un élément « précision de la position », en encre neutre (la couleur dit autre chose). */
function ShapeSym({ id }) {
  if (id === 'gps') return <Sym><circle r="5" className="mapx-sym-ink" /></Sym>;
  if (id === 'derived') return <Sym><circle r="7.5" className="mapx-derived" /><circle r="4" className="mapx-sym-ink" /></Sym>;
  if (id === 'commune') return <Sym><circle r="7.5" className="mapx-commune" /></Sym>;
  return <Sym><circle r="3" className="mapx-collect" /></Sym>;
}

/** Phrase d'explication d'un fond de district, selon la nature du thème. */
function fillHelp(theme) {
  if (theme.kind === 'sev') return 'Chaque district prend la couleur du signal le plus grave relevé sur la période.';
  if (theme.kind === 'pct') return 'Chaque district est coloré selon ce taux sur la période : plus la teinte est foncée, plus le taux est élevé.';
  return 'Chaque district est coloré selon ce nombre sur la période : plus la teinte est foncée, plus il est élevé.';
}

/**
 * Légende de la carte (lot 6a, refaite pour le retour 94) : sous la carte, en trois groupes
 * titrés qu'un non-spécialiste lit d'un coup d'œil —
 *   « Fond des districts = <thème> » (classes, aucun site, aucun plan),
 *   « Couleur des points = statut de visite | activité » (choix ici même),
 *   « Forme = précision de la position » (GPS, déduite des collectes, centre de commune, collecte).
 * Seulement ce qui est dessiné, avec l'effectif de chaque élément ; chaque « ? » donne la phrase
 * qui l'explique ; survoler (ou parcourir au clavier) un élément estompe les autres points.
 * Repliable (repliée par défaut en variante compacte et sur téléphone).
 */
export default function MapLegend({
  theme, scale, periodText, collapsed, onToggle, hasNoPlan, model, colorBy = 'status', onColorBy, onFocus,
}) {
  const { tr } = useI18n();
  const uid = useId();
  const [help, setHelp] = useState(null); // { group, id, text }
  if (!scale) return null;
  const labels = classLabels(scale, formatInt);
  const color = (model && model.color) || [];
  const shape = (model && model.shape) || [];
  const toggleHelp = (group, id, text) => setHelp((h) => (h && h.group === group && h.id === id ? null : { group, id, text }));
  const focus = (f) => onFocus && onFocus(f);

  // Fonctions de rendu (pas des composants : un composant défini ici serait remonté à chaque
  // rendu et l'élément parcouru au clavier perdrait le focus).
  const q = ({ group, id, text, name }) => (
    <button type="button" className="mapx-q" aria-label={tr('Que signifie « {x} » ?', { x: name })} title={tr(text)}
      aria-expanded={!!(help && help.group === group && help.id === id)} aria-controls={`${uid}-${group}`}
      onClick={() => toggleHelp(group, id, text)}>
      <HelpCircle size={13} aria-hidden="true" />
    </button>
  );
  const explain = (group) => (help && help.group === group
    ? <p className="mapx-lg-help" id={`${uid}-${group}`} role="note">{tr(help.text)}</p>
    : <span id={`${uid}-${group}`} hidden />);
  const item = ({ key, group, id, sym, name, n, text, f, sub }) => (
    <li key={key} className="mapx-lg-item" onMouseEnter={() => focus(f)} onMouseLeave={() => focus(null)}>
      <span className="mapx-lg-key" tabIndex={0} onFocus={() => focus(f)} onBlur={() => focus(null)}>
        {sym}
        <span className="mapx-lg-name">{name}{sub && <span className="mapx-lg-sub">{sub}</span>}</span>
      </span>
      <span className="mapx-lg-n tabular">{formatInt(n)}</span>
      {text ? q({ group, id, text, name }) : <span className="mapx-q-sp" aria-hidden="true" />}
    </li>
  );

  const fillTitle = `${tr(theme.label)}${theme.kind === 'pct' ? ' (%)' : ''}`;
  return (
    <div className={`mapx-legend is-docked${collapsed ? ' is-collapsed' : ''}`}>
      <button type="button" className="mapx-legend-head" onClick={onToggle} aria-expanded={!collapsed}>
        <span><b>{tr('Légende')}</b>{periodText ? <span className="mapx-legend-period"> · {periodText}</span> : null}</span>
        {collapsed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {!collapsed && (
        <div className="mapx-legend-groups">
          <section className="mapx-lg" aria-label={tr('Fond des districts')}>
            <h4 className="mapx-lg-title">
              <span>{tr('Fond des districts')} <span className="mapx-lg-eq">=</span> <b>{fillTitle}</b></span>
              {q({ group: 'fill', id: 'fill', text: fillHelp(theme), name: tr('Fond des districts') })}
            </h4>
            <div className="mapx-legend-bar" role="list">
              {scale.colors.map((c, i) => (
                <div key={c} className="mapx-legend-step" role="listitem">
                  <i style={{ background: c }} />
                  <span className="tabular">{scale.kind === 'sev' ? `${ALERT_LEVELS[i].icon} ${tr(labels[i])}` : labels[i]}</span>
                </div>
              ))}
            </div>
            <div className="mapx-legend-extra">
              <span><i className="mapx-sw" style={{ background: 'var(--map-empty)' }} />{theme.id === 'submissions' ? tr('Aucune donnée') : theme.id === 'alerts' ? tr('Aucun signal') : tr('Aucun site actif')}</span>
              {(theme.id === 'planning' || theme.id === 'execution' || hasNoPlan) && (
                <span><i className="mapx-sw is-hatch" />{tr('— aucun plan')}</span>
              )}
            </div>
            {explain('fill')}
          </section>

          {color.length > 0 && (
            <section className="mapx-lg" aria-label={tr('Couleur des points')}>
              <h4 className="mapx-lg-title">
                <span className="mapx-lg-lead">
                  {tr('Couleur des points')}
                  {colorBy === 'activity' && q({ group: 'color', id: 'activity', text: ACTIVITY_HELP, name: tr('Activité') })}
                  <span className="mapx-lg-eq">=</span>
                </span>
                {onColorBy ? (
                  <span className="seg mapx-lg-seg" role="group" aria-label={tr('Colorer les points par')}>
                    <button type="button" className={colorBy === 'status' ? 'is-active' : ''} aria-pressed={colorBy === 'status'} onClick={() => onColorBy('status')}>{tr('Statut de visite')}</button>
                    <button type="button" className={colorBy === 'activity' ? 'is-active' : ''} aria-pressed={colorBy === 'activity'} onClick={() => onColorBy('activity')}>{tr('Activité')}</button>
                  </span>
                ) : <b>{colorBy === 'activity' ? tr('Activité') : tr('Statut de visite')}</b>}
              </h4>
              <ul className="mapx-lg-list">
                {colorBy === 'activity'
                  ? color.map((a) => item({
                    key: a.slot, group: 'color', id: `a${a.slot}`, f: { by: 'activity', value: a.slot }, n: a.n,
                    sym: <Sym><ActivitySymbol slot={a.slot} r={5} /></Sym>,
                    name: a.slot ? a.label : (a.names.length ? tr(OTHER_LABEL) : tr('Sans activité')),
                    sub: !a.slot && a.names.length ? a.names.join(', ') : null,
                  }))
                  : color.map((st) => item({
                    key: st.id, group: 'color', id: st.id, f: { by: 'status', value: st.id }, n: st.n,
                    sym: <Sym><StatusSymbol status={st.id} r={5} /></Sym>,
                    name: tr(STATUS_TEXT[st.id].label), text: STATUS_TEXT[st.id].help,
                  }))}
              </ul>
              {explain('color')}
            </section>
          )}

          {shape.length > 0 && (
            <section className="mapx-lg" aria-label={tr('Forme des points')}>
              <h4 className="mapx-lg-title"><span>{tr('Forme')} <span className="mapx-lg-eq">=</span> <b>{tr('précision de la position')}</b></span></h4>
              <ul className="mapx-lg-list">
                {shape.map((x) => item({
                  key: x.id, group: 'shape', id: x.id, f: { by: 'shape', value: x.id }, n: x.n,
                  sym: <ShapeSym id={x.id} />, name: tr(SHAPE_TEXT[x.id].label), text: SHAPE_TEXT[x.id].help,
                  sub: x.id === 'commune' && x.sites ? tr('{n} site(s) regroupé(s)', { n: formatInt(x.sites) })
                    : x.id === 'derived' && x.indicative ? tr('dont {n} indicative(s)', { n: formatInt(x.indicative) })
                      : x.id === 'collect' && x.binned ? tr('par maille de 2 km') : null,
                }))}
              </ul>
              {explain('shape')}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
