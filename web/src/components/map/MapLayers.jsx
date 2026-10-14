import React from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';

const GROUPS = [
  { id: 'registre', label: 'Registre' },
  { id: 'suivi', label: 'Suivi' },
  { id: 'donnees', label: 'Données & alertes', also: ['alertes'] },
];

/**
 * Panneau droit (lot 6a) : thèmes par groupe (Registre · Suivi · Données & alertes),
 * couches de points avec effectifs, fond (noms des districts, limites des régions,
 * fond en ligne) et notes (contour partagé, districts sans contour, points écartés,
 * sites sans district) avec liens vers Paramétrage.
 */
export default function MapLayers({
  themes, theme, onTheme, layers, onLayer, points, data, labels, onLabels, regions, onRegions,
  onNavigate, extra = null, isAdmin = false,
}) {
  const { tr } = useI18n();
  const counts = points ? points.counts : null;
  const collect = points ? points.collect : null;
  const roSites = (data.regionOnly || []).reduce((a, x) => a + x.counts.sites, 0);
  const check = (id, label, n, disabled = false, hint = null) => (
    <label className={`mapx-check${disabled ? ' is-disabled' : ''}`} key={id}>
      <input type="checkbox" checked={!!layers[id]} disabled={disabled} onChange={(e) => onLayer(id, e.target.checked)} />
      <span>{label}{hint && <span className="mapx-check-hint">{hint}</span>}</span>
      {n != null && <span className="mapx-check-n tabular">{formatInt(n)}</span>}
    </label>
  );
  return (
    <div className="mapx-layers">
      {GROUPS.map((g) => {
        const list = themes.filter((t) => t.group === g.id || (g.also || []).includes(t.group));
        return (
          <div key={g.id}>
            <div className="mapx-grp">{tr(g.label)}</div>
            <div className="mapx-pills">
              {list.map((t) => (
                <button type="button" key={t.id} className={`mapx-pill${t.id === theme.id ? ' is-on' : ''}`} aria-pressed={t.id === theme.id} onClick={() => onTheme(t.id)}>{tr(t.label)}</button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="mapx-grp">{tr('Points')}</div>
      {check('gps', tr('Sites GPS'), counts ? counts.gps : null)}
      {check('derived', tr('Placés par leurs collectes'), counts ? counts.derived : null)}
      {check('communes', tr('Centres des collectes (commune)'), counts ? counts.communeCentres : null)}
      {check('collect', tr('Points de collecte'), collect ? collect.total : null, !!collect && collect.total === 0,
        collect && collect.total === 0 && collect.lastMonth ? tr('derniers : {m}', { m: monthLabel(collect.lastMonth) }) : null)}
      {collect && collect.mode === 'bins' && layers.collect && <p className="mapx-note">{tr('Points de collecte regroupés par maille de 2 km (positions de ménages).')}</p>}
      <div className="mapx-grp">{tr('Fond')}</div>
      <label className="mapx-check"><input type="checkbox" checked={labels} onChange={(e) => onLabels(e.target.checked)} /><span>{tr('Noms des districts')}</span></label>
      <label className="mapx-check"><input type="checkbox" checked={regions} onChange={(e) => onRegions(e.target.checked)} /><span>{tr('Limites des régions')}</span></label>
      {extra}
      <div className="mapx-notes">
        {(data.shared || []).map((s) => (
          <p className="mapx-note" key={s.key}>
            {tr('Contour commun : {a} + {b} (contour 2018 non scindé)', { a: s.districts[0].name, b: s.districts.slice(1).map((d) => d.name).join(', ') })}
            {isAdmin && onNavigate && <> — <button type="button" className="inline-link" onClick={() => onNavigate('parametrage', 'localites', 'contours')}>{tr('corriger')}</button></>}
          </p>
        ))}
        {(data.unmatched || []).length > 0 && (
          <p className="mapx-note">{tr('{n} district(s) sans contour : {list}', { n: data.unmatched.length, list: data.unmatched.map((d) => d.name).join(', ') })}</p>
        )}
        {(data.hidden || []).length > 0 && (
          <p className="mapx-note">{tr('{n} district(s) non dessiné(s) (correction manuelle).', { n: data.hidden.length })}</p>
        )}
        {roSites + data.unplaced.sites > 0 && (
          <p className="mapx-note">{tr('{ro} site(s) rattaché(s) à la région seulement, {u} sans localité — comptés dans le chiffre clé, pas sur un contour.', { ro: formatInt(roSites), u: formatInt(data.unplaced.sites) })}
            {onNavigate && <> <button type="button" className="inline-link" onClick={() => onNavigate('parametrage', 'localites')}>{tr('À rapprocher')}</button></>}</p>
        )}
        {points && points.rejected.accuracy > 0 && (
          <p className="mapx-note">{tr('{n} point(s) GPS écarté(s) (précision > {m} m).', { n: formatInt(points.rejected.accuracy), m: points.limits.maxAccuracyM })}</p>
        )}
        {points && (points.notes.insufficient > 0 || points.notes.scattered > 0) && (
          <p className="mapx-note">{tr('Positions non placées : {i} avec moins de 3 relevés, {s} trop dispersée(s) (> 5 km).', { i: formatInt(points.notes.insufficient), s: formatInt(points.notes.scattered) })}</p>
        )}
        {data.activationKnown === false && (
          <p className="mapx-note">{tr('Grille d\'activation non importée : tout le registre est compté actif.')}</p>
        )}
      </div>
    </div>
  );
}
