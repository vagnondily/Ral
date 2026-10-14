import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, SlidersHorizontal, X } from 'lucide-react';
import { Alert, Skeleton } from '../ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { periodLabel } from '../../lib/period.js';
import { scaleFor, valueOf } from '../../lib/mapScale.js';
import { unionBbox } from '../../lib/mapProjection.js';
import { useMapData, useDarkTheme } from './useMapData.js';
import DistrictMap from './DistrictMap.jsx';
import MapPanel from './MapPanel.jsx';
import MapLayers from './MapLayers.jsx';
import MapLegend from './MapLegend.jsx';
import MapHoverCard, { PointCard } from './MapHoverCard.jsx';
import MapTable from './MapTable.jsx';

/** Passage « Ouvrir la carte » (Vue d'ensemble → Couverture & performance › Carte). */
export const MAP_OPEN_KEY = 'mems.map.open';
const COMPACT_THEMES = ['coverage', 'active', 'submissions', 'alerts'];
const DEFAULT_LAYERS = { gps: true, derived: true, communes: true, collect: false };

const store = (kind) => { try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; } };
function readJson(kind, key) { try { const s = store(kind); return s ? JSON.parse(s.getItem(key) || 'null') : null; } catch { return null; } }
function writeJson(kind, key, v) { try { const s = store(kind); if (s) { if (v == null) s.removeItem(key); else s.setItem(key, JSON.stringify(v)); } } catch { /* stockage indisponible */ } }

/** Réglages passés par « Ouvrir la carte » (lecture pure : l'appelant les oublie après le montage, forgetMapOpen). */
export function peekMapOpen() {
  return readJson('session', MAP_OPEN_KEY);
}
export function forgetMapOpen() { writeJson('session', MAP_OPEN_KEY, null); }

const useIsPhone = () => {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
};

/**
 * Carte du suivi (lot 6a) — composant partagé (Couverture & performance › Carte,
 * Vue d'ensemble, Carte des sites). Fond vectoriel hors ligne (contours embarqués),
 * choroplèthe par district selon le thème, couches de points, chiffre clé du
 * périmètre, classement, recherche, légende graduée, fiche au survol, tableau.
 * Les filtres bureau (avec ses antennes) et activité sont DANS le composant (les deux
 * variantes), en puces retirables ; la période vient de la page.
 *
 *   variant   'full' | 'compact'
 *   period    { from, to } (undefined tant que la page attend sa période par défaut)
 *   initial   { theme, officeId, activity, layers } — réglages de départ
 *   onOpenFull(state) — variante compacte : « Ouvrir la carte »
 */
export default function MapExplorer({
  variant = 'full', period, initial = {}, onNavigate, onOpenFull, storageKey = 'mems.map.prefs', title,
  isAdmin = false, toolbarExtra = null, periodControl = null, onDataChange,
}) {
  const { tr, lang } = useI18n();
  const dark = useDarkTheme();
  const phone = useIsPhone();
  const compact = variant === 'compact';
  const prefs = useMemo(() => (compact ? {} : readJson('local', storageKey) || {}), [compact, storageKey]);
  const [themeId, setThemeId] = useState(initial.theme || prefs.theme || 'coverage');
  const [officeId, setOfficeId] = useState(initial.officeId || null);
  const [activity, setActivity] = useState(initial.activity || null);
  const [layers, setLayers] = useState({ ...DEFAULT_LAYERS, ...(prefs.layers || {}), ...(initial.layers || {}) });
  const [showLabels, setShowLabels] = useState(prefs.labels !== false);
  const [showRegions, setShowRegions] = useState(prefs.regions !== false);
  const [level, setLevel] = useState('district');
  const [order, setOrder] = useState('desc');
  const [hover, setHover] = useState(null); // { key, pos }
  const [pinned, setPinned] = useState(null); // { key, pos }
  const [pointTip, setPointTip] = useState(null); // { id, pos, pinned }
  const [legendCollapsed, setLegendCollapsed] = useState(compact || phone);
  const [tableOpen, setTableOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(!phone);
  const mapRef = useRef(null);
  const colRef = useRef(null);

  useEffect(() => { if (!compact) writeJson('local', storageKey, { theme: themeId, layers, labels: showLabels, regions: showRegions }); },
    [compact, storageKey, themeId, layers, showLabels, showRegions]);

  const levels = level === 'commune' ? ['commune'] : [];
  const { geo, geoError, data, points, loading, error } = useMapData(period, { officeId, activity, withPoints: true, levels });
  useEffect(() => { if (data && onDataChange) onDataChange(data); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const themes = data ? data.themes : [];
  const theme = themes.find((t) => t.id === themeId) || themes.find((t) => t.id === 'coverage') || null;
  const scale = useMemo(() => (theme && data ? scaleFor(theme, data.shapes, { dark }) : null), [theme, data, dark]);
  const periodText = period ? periodLabel(period, lang, { short: true }) : '';
  const multiMonth = period && period.from !== period.to;

  // Rendu complet après données et contours : mesure (balayage de performance).
  useEffect(() => {
    if (!data || !geo) return;
    const id = requestAnimationFrame(() => {
      try {
        performance.mark('mapx:painted');
        performance.measure('mapx:render', 'mapx:data', 'mapx:painted');
      } catch { /* marques absentes */ }
    });
    return () => cancelAnimationFrame(id);
  }, [data, geo]);
  useEffect(() => { try { performance.mark('mapx:theme'); } catch { /* */ } }, [themeId]);

  const shapeByKey = useMemo(() => new Map((data ? data.shapes : []).map((s) => [s.key, s])), [data]);
  const featureByName = useMemo(() => {
    const m = new Map();
    for (const f of (geo ? geo.features : [])) m.set(f.properties.name.toLowerCase(), f.properties.key);
    return m;
  }, [geo]);
  const shapeOfDistrictPcode = useCallback((pcode) => {
    const d = data && data.districts.find((x) => x.pcode === pcode);
    return d ? d.shapeKey : null;
  }, [data]);

  const pickZone = (lvl, z) => {
    const m = mapRef.current;
    if (!m) return;
    if (lvl === 'district') { m.zoomToKey(z.key); setPinned({ key: z.key, pos: null }); return; }
    if (lvl === 'region' && geo && data) {
      const keys = Object.entries(data.shapeRegions).filter(([, r]) => r === z.name).map(([k]) => k);
      m.zoomToBbox(unionBbox(geo.features.filter((f) => keys.includes(f.properties.key)).map((f) => f.properties.bbox)));
      return;
    }
    if (lvl === 'commune') {
      const c = points && points.communes.find((x) => x.pcode === z.pcode);
      if (c) { m.zoomToPoint(c.lng, c.lat); return; }
      const k = z.district && featureByName.get(z.district.toLowerCase());
      if (k) m.zoomToKey(k);
    }
  };
  const searchPick = (r) => {
    const m = mapRef.current;
    if (!m) return;
    if (r.kind === 'site' && r.lat != null && r.lng != null) { m.zoomToPoint(r.lng, r.lat); return; }
    if (r.kind === 'commune') {
      const c = points && points.communes.find((x) => x.pcode === r.pcode);
      if (c) { m.zoomToPoint(c.lng, c.lat); return; }
    }
    const key = shapeOfDistrictPcode(r.districtPcode) || (r.kind === 'district' && featureByName.get(String(r.name).toLowerCase()))
      || (r.district && featureByName.get(String(r.district).toLowerCase()));
    if (key) { m.zoomToKey(key); setPinned({ key, pos: null }); }
  };

  const onMapHover = useCallback((key, pos) => setHover(key ? { key, pos } : null), []);
  const onMapPick = useCallback((key, pos, touch) => {
    setPointTip(null);
    if (!key) { setPinned(null); return; }
    setPinned({ key, pos });
    if (!touch && mapRef.current) mapRef.current.zoomToKey(key);
  }, []);
  const onPointHover = useCallback((id, pos, pin) => {
    if (!id) { setPointTip((p) => (p && p.pinned ? p : null)); return; }
    setPointTip({ id, pos, pinned: !!pin });
  }, []);
  const pointOf = (id) => {
    if (!id || !points) return null;
    const [kind, idx] = id.split(':');
    const i = Number(idx);
    if (kind === 's') return { type: 'site', data: points.sites[i] };
    if (kind === 'm') return { type: 'commune', data: points.communes[i] };
    if (kind === 'b') return { type: 'bin', data: points.collect.bins[i] };
    return { type: 'collect', data: points.collect.points[i] };
  };

  const filterBar = data && (
    <div className="mapx-toolbar">
      {periodControl && <div className="mapx-filter"><span>{tr('Période')}</span>{periodControl}</div>}
      <label className="mapx-filter">
        <span>{tr('Bureau')}</span>
        <select className="select" value={officeId || ''} onChange={(e) => setOfficeId(e.target.value || null)}>
          <option value="">{tr('Tous')}</option>
          {data.filtersAvailable.offices.map((o) => (
            <option key={o.id} value={o.id}>{o.parentId ? `  ${o.name}` : tr('{name} (et ses antennes)', { name: o.name })}</option>
          ))}
        </select>
      </label>
      <label className="mapx-filter">
        <span>{tr('Activité')}</span>
        <select className="select" value={activity || ''} onChange={(e) => setActivity(e.target.value || null)}>
          <option value="">{tr('Toutes')}</option>
          {data.filtersAvailable.activities.map((a) => <option key={a.value} value={a.value}>{`${a.value} (${formatInt(a.sites)})`}</option>)}
        </select>
      </label>
      {(officeId || activity) && (
        <div className="mapx-chips">
          {officeId && (
            <button type="button" className="chip is-static" onClick={() => setOfficeId(null)} aria-label={tr('Retirer le filtre bureau')}>
              {(data.filtersAvailable.offices.find((o) => o.id === officeId) || {}).name || tr('Bureau')}<X size={12} className="chip-x" aria-hidden="true" />
            </button>
          )}
          {activity && (
            <button type="button" className="chip is-static" onClick={() => setActivity(null)} aria-label={tr('Retirer le filtre activité')}>
              {activity}<X size={12} className="chip-x" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div className="mapx-toolbar-sp" />
      {toolbarExtra}
    </div>
  );

  if (!period || (loading && !data)) return <Skeleton height={compact ? 460 : 640} />;
  if (error && !data) return <Alert tone="error">{error}</Alert>;
  if (!data || !theme) return <Skeleton height={compact ? 460 : 640} />;

  const height = phone ? 420 : compact ? 470 : 640;
  const legendPad = legendCollapsed ? 54 : (compact ? 120 : 132);
  const hoverZone = hover && shapeByKey.get(hover.key);
  const pinZone = pinned && shapeByKey.get(pinned.key);
  const cardZone = hoverZone || pinZone;
  const cardPos = hoverZone ? hover.pos : (pinned && pinned.pos) || null;
  const empty = data.totals.counts.sites === 0;
  const colored = data.shapes.filter((s) => valueOf(theme.id, s) != null).length;
  const ariaLabel = tr('Carte des districts — {theme}, {period} : {n} contour(s) colorés.', { theme: tr(theme.label), period: periodText, n: colored });
  const pointLayers = { ...layers, collect: layers.collect && !!(points && points.collect && points.collect.total) };
  const pt = pointTip && pointOf(pointTip.id);
  const geoMissing = !geo && geoError;

  const colW = colRef.current ? colRef.current.clientWidth : 900;
  const mapBlock = (
    <div className="mapx-mapcol" ref={colRef}>
      {geoMissing && <Alert tone="warning">{tr('Contours de la carte indisponibles : le classement et le tableau restent exacts.')}</Alert>}
      <DistrictMap ref={mapRef} geo={geo} shapes={data.shapes} shapeRegions={data.shapeRegions} theme={theme} scale={scale} dark={dark}
        points={points} pointLayers={pointLayers} showLabels={showLabels} showRegions={showRegions} height={height} padBottom={legendPad}
        hoverKey={hover ? hover.key : null} pinnedKey={pinned ? pinned.key : null} onHover={onMapHover} onPick={onMapPick}
        onPointHover={onPointHover} ariaLabel={ariaLabel} uid={compact ? 'mapxc' : 'mapxf'} />
      <MapLegend theme={theme} scale={scale} periodText={periodText} pointLayers={pointLayers} collapsed={legendCollapsed}
        onToggle={() => setLegendCollapsed((c) => !c)} />
      {cardZone && cardPos && !pt && (
        <MapHoverCard zone={cardZone} theme={theme} periodText={periodText} pos={cardPos} box={{ width: colW, height }}
          pinned={!hoverZone && !!pinZone} onClose={() => setPinned(null)} multiMonth={multiMonth}
          onShowSites={onNavigate ? () => onNavigate('processus', 'carte') : null} />
      )}
      {pt && pt.data && <PointCard point={pt} pos={pointTip.pos} box={{ width: colW, height }} periodText={periodText} onClose={pointTip.pinned ? () => setPointTip(null) : null} />}
      {empty && (
        <div className="mapx-empty">
          <p>{officeId || activity ? tr('Aucun site pour ce bureau / cette activité.') : tr('Aucun site dans le registre.')}</p>
          {(officeId || activity) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOfficeId(null); setActivity(null); }}>{tr('Réinitialiser les filtres')}</button>}
        </div>
      )}
    </div>
  );

  const placed = points ? points.counts.gps + points.counts.derived : 0;
  const roSites = (data.regionOnly || []).reduce((a, x) => a + x.counts.sites, 0);
  const districtSites = data.districts.reduce((a, d) => a + d.counts.sites, 0);
  const foot = (
    <div className="mapx-foot">
      {tr('Source : registre des sites, visites et soumissions MEMS · période {p} · sites distincts sur la période · contours des districts : {src} · recalculé le {d}', {
        p: periodText, src: data.geometry.source, d: new Date(data.computedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR'),
      })}
    </div>
  );

  if (compact) {
    return (
      <div className="card biz-card mapx mapx-compact">
        <div className="card-header mapx-chead">
          <div>
            <div className="card-title">{title || tr('Carte du suivi')}</div>
            <div className="card-sub">{tr('Districts colorés selon le thème · même période et mêmes filtres que la carte complète')}</div>
          </div>
          <div className="mapx-chead-r">
            <div className="seg" role="tablist" aria-label={tr('Thème de la carte')}>
              {COMPACT_THEMES.map((id) => {
                const t = themes.find((x) => x.id === id);
                return t && <button type="button" role="tab" key={id} aria-selected={themeId === id} className={themeId === id ? 'is-active' : ''} onClick={() => setThemeId(id)}>{tr(t.label)}</button>;
              })}
            </div>
            {onOpenFull && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenFull({ theme: themeId, officeId, activity, period })}>
                <Maximize2 size={14} aria-hidden="true" />{tr('Ouvrir la carte')}
              </button>
            )}
          </div>
        </div>
        {filterBar}
        <div className="mapx-cwrap">
          {mapBlock}
          <MapPanel data={data} theme={theme} scale={scale} compact level="district" onLevel={() => {}} order={order} onOrder={setOrder}
            hoverKey={hover ? hover.key : null} onHoverKey={(k) => setHover(k ? { key: k, pos: null } : null)}
            onPickZone={pickZone} onSearchPick={searchPick} onReset={() => mapRef.current && mapRef.current.reset()} periodText={periodText} />
        </div>
        {foot}
      </div>
    );
  }

  return (
    <div className="mapx mapx-full">
      {filterBar}
      <div className="mapx-banner">
        <b>{tr('{n} district(s) colorés', { n: formatInt(colored) })}</b>{' '}
        {tr('sur {total} contours · {d} sites rattachés à un district ({ro} à la région seulement, {u} sans localité) · {placed} site(s) placé(s) sur la carte + {c} au centre des collectes de leur commune', {
          total: formatInt(geo ? geo.features.length : 0), d: formatInt(districtSites), ro: formatInt(roSites), u: formatInt(data.unplaced.sites),
          placed: formatInt(placed), c: formatInt(points ? points.counts.sitesInCommuneCentres : 0),
        })}
        {points && points.collect && points.collect.total === 0 && points.collect.lastMonth && (
          <> · <b>{tr('Aucun point de collecte GPS sur la période')}</b> {tr('(derniers : {m})', { m: monthLabel(points.collect.lastMonth) })}</>
        )}
      </div>
      <div className={`mapx-wrap${layersOpen ? '' : ' no-layers'}`}>
        <MapPanel data={data} theme={theme} scale={scale} level={level} onLevel={setLevel} order={order} onOrder={setOrder}
          hoverKey={hover ? hover.key : null} onHoverKey={(k) => setHover(k && level === 'district' ? { key: k, pos: null } : null)}
          onPickZone={pickZone} onSearchPick={searchPick} onReset={() => { setPinned(null); if (mapRef.current) mapRef.current.reset(); }}
          onNavigate={onNavigate} onOpenTable={() => setTableOpen((o) => !o)} periodText={periodText}
          communesLoading={level === 'commune' && loading} />
        {mapBlock}
        <div className="mapx-side">
          {phone && (
            <button type="button" className="btn btn-secondary btn-sm mapx-layers-toggle" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
              <SlidersHorizontal size={14} aria-hidden="true" />{tr('Thèmes et couches')}
            </button>
          )}
          {layersOpen && (
            <MapLayers themes={themes} theme={theme} onTheme={setThemeId} layers={layers} onLayer={(id, on) => setLayers((l) => ({ ...l, [id]: on }))}
              points={points} data={data} labels={showLabels} onLabels={setShowLabels} regions={showRegions} onRegions={setShowRegions}
              onNavigate={onNavigate} isAdmin={isAdmin} />
          )}
        </div>
      </div>
      {foot}
      {tableOpen && <MapTable data={data} periodText={periodText} fileName={`carte-${theme.id}-${period.from}_${period.to}`} />}
    </div>
  );
}
