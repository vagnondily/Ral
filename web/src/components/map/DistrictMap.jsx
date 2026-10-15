import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Home, Minus, Plus } from 'lucide-react';
import { fitTransform, pathOf, scaleBar, unionBbox } from '../../lib/mapProjection.js';
import { layoutLabels } from '../../lib/mapLabels.js';
import { valueOf, inkOn, ALERT_LEVELS } from '../../lib/mapScale.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Carte des districts (lot 6a) — SVG, sans bibliothèque ni tuile : choroplèthe par
 * contour, limites de régions, étiquettes sans chevauchement, couches de points,
 * flèche du nord, barre d'échelle, carte de situation au zoom. Les chemins sont
 * calculés une fois par taille ; changer de thème ne change que les `fill`.
 * Zoom : boutons + / − / ⌂, double-clic, glisser, pincer, molette avec Ctrl (la page
 * défile normalement sans Ctrl). Survol par délégation (data-key), toucher = épingler.
 */

const MAX_ZOOM = 14;
const STATUS_STYLE = {
  realise: { shape: 'disk', color: 'var(--map-st-done)' },
  hors_plan: { shape: 'diamond', color: 'var(--map-st-done)' },
  prevu: { shape: 'ring', color: 'var(--map-st-plan)' },
  non_prevu: { shape: 'square', color: 'var(--map-ink)' },
  inactif: { shape: 'hollow', color: 'var(--text-faint)' },
};
export const POINT_STATUS = STATUS_STYLE;

/** Symbole d'un site selon son statut (forme + couleur : jamais la couleur seule). */
export function StatusSymbol({ status, x = 0, y = 0, r = 4.5 }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE.non_prevu;
  const ring = 'var(--map-halo-solid)';
  if (st.shape === 'disk') return <circle cx={x} cy={y} r={r} fill={st.color} stroke={ring} strokeWidth="1.4" />;
  if (st.shape === 'ring') return <circle cx={x} cy={y} r={r - 0.6} fill={ring} stroke={st.color} strokeWidth="2.4" />;
  if (st.shape === 'square') return <rect x={x - r + 0.6} y={y - r + 0.6} width={2 * r - 1.2} height={2 * r - 1.2} fill={st.color} stroke={ring} strokeWidth="1.3" />;
  if (st.shape === 'diamond') return <path d={`M${x},${y - r - 0.8}L${x + r + 0.8},${y}L${x},${y + r + 0.8}L${x - r - 0.8},${y}Z`} fill={st.color} stroke={ring} strokeWidth="1.3" />;
  return <circle cx={x} cy={y} r={r - 0.8} fill="none" stroke={st.color} strokeWidth="1.6" />;
}

const DistrictMap = forwardRef(function DistrictMap({
  geo, shapes, shapeRegions = {}, theme, scale, dark = false, points = null, pointLayers = {},
  showLabels = true, showRegions = true, height = 560, padBottom = 24, hoverKey = null, pinnedKey = null,
  onHover, onPick, onPointHover, ariaLabel, uid = 'mapx', underlay = null,
}, ref) {
  const { tr } = useI18n();
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [settled, setSettled] = useState({ s: 1, x: 0, y: 0 }); // vue stable (étiquettes, points)
  const gesture = useRef(null);
  const raf = useRef(0);

  // Largeur du conteneur (la hauteur est fixée par la variante).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const byKey = useMemo(() => new Map((shapes || []).map((s) => [s.key, s])), [shapes]);
  const features = useMemo(() => (geo ? geo.features : []), [geo]);
  // Cadrage : les contours qui portent des données, sinon tout le pays.
  const frame = useMemo(() => {
    const withData = features.filter((f) => byKey.has(f.properties.key)).map((f) => f.properties.bbox);
    return unionBbox(withData.length ? withData : features.map((f) => f.properties.bbox));
  }, [features, byKey]);
  const t = useMemo(() => (frame && width > 0 ? fitTransform(frame, width, height, { top: 18, right: 58, bottom: padBottom, left: 18 }) : null), [frame, width, height, padBottom]);
  const paths = useMemo(() => {
    const m = new Map();
    if (!t) return m;
    for (const f of features) m.set(f.properties.key, pathOf(f.geometry, t.project));
    return m;
  }, [features, t]);

  // Vue stable après le geste (≤ 120 ms) : points et étiquettes recalculés à taille d'écran constante.
  useEffect(() => {
    const id = setTimeout(() => setSettled(view), 120);
    return () => clearTimeout(id);
  }, [view]);

  const clampView = useCallback((v) => {
    const s = Math.max(1, Math.min(MAX_ZOOM, v.s));
    if (s === 1) return { s: 1, x: 0, y: 0 };
    // Ne jamais perdre la carte : au moins un quart du cadre reste visible.
    const minX = width * 0.25 - width * s; const maxX = width * 0.75;
    const minY = height * 0.25 - height * s; const maxY = height * 0.75;
    return { s, x: Math.max(minX, Math.min(maxX, v.x)), y: Math.max(minY, Math.min(maxY, v.y)) };
  }, [width, height]);

  const zoomAt = useCallback((factor, cx, cy) => {
    setView((v) => {
      const s = Math.max(1, Math.min(MAX_ZOOM, v.s * factor));
      const k = s / v.s;
      return clampView({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    });
  }, [clampView]);

  const zoomToBbox = useCallback((bbox) => {
    if (!t || !bbox) return;
    const [x0, y1] = t.project(bbox[0], bbox[1]);
    const [x1, y0] = t.project(bbox[2], bbox[3]);
    const bw = Math.max(8, x1 - x0); const bh = Math.max(8, y1 - y0);
    const s = Math.max(1, Math.min(MAX_ZOOM, Math.min((width * 0.7) / bw, ((height - padBottom) * 0.7) / bh)));
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    setView(clampView({ s, x: width / 2 - cx * s, y: (height - padBottom) / 2 - cy * s }));
  }, [t, width, height, padBottom, clampView]);

  const reset = useCallback(() => setView({ s: 1, x: 0, y: 0 }), []);
  useImperativeHandle(ref, () => ({
    zoomToBbox, reset,
    zoomToKey: (key) => { const f = features.find((x) => x.properties.key === key); if (f) zoomToBbox(f.properties.bbox); },
    zoomToPoint: (lng, lat) => zoomToBbox([lng - 0.15, lat - 0.15, lng + 0.15, lat + 0.15]),
    svg: () => svgRef.current,
    view: () => view,
    // Emprise affichée (degrés) quand la carte est zoomée, sinon null (cadre des données).
    extent: () => {
      if (!t || view.s <= 1.001) return null;
      const [w0, n0] = t.invert((0 - view.x) / view.s, (0 - view.y) / view.s);
      const [e0, s0] = t.invert((width - view.x) / view.s, (height - padBottom - view.y) / view.s);
      return [w0, s0, e0, n0];
    },
  }), [zoomToBbox, reset, features, view, t, width, height, padBottom]);

  // Molette : seulement avec Ctrl (ou geste de pincement du pavé tactile) ; sinon la page défile.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const local = (e) => { const r = svgRef.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pointers = useRef(new Map());
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) gesture.current = { kind: 'pan', start: local(e), view, moved: false, type: e.pointerType, target: e.target };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view, moved: true };
    }
  };
  const onPointerMove = (e) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g && g.kind === 'pan' && pointers.current.size === 1) {
      const dx = p[0] - g.start[0]; const dy = p[1] - g.start[1];
      if (!g.moved && Math.hypot(dx, dy) > 4) { g.moved = true; try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* */ } }
      if (g.moved && g.view.s > 1) setView(clampView({ s: g.view.s, x: g.view.x + dx, y: g.view.y + dy }));
      if (g.moved) return;
    } else if (g && g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, g.d0);
      const s = Math.max(1, Math.min(MAX_ZOOM, g.view.s * k));
      const kk = s / g.view.s;
      setView(clampView({ s, x: g.c[0] - (g.c[0] - g.view.x) * kk, y: g.c[1] - (g.c[1] - g.view.y) * kk }));
      return;
    }
    if (e.pointerType === 'touch') return; // au toucher : fiche épinglée, pas de survol
    // Survol par délégation, une fois par image.
    const target = e.target;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const pt = target.closest && target.closest('[data-pt]');
      if (pt && onPointHover) { onPointHover(pt.getAttribute('data-pt'), { x: p[0], y: p[1] }); return; }
      if (onPointHover) onPointHover(null);
      const el = target.closest && target.closest('[data-key]');
      if (onHover) onHover(el ? el.getAttribute('data-key') : null, { x: p[0], y: p[1] });
    });
  };
  const onPointerUp = (e) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (g && g.kind === 'pan' && !g.moved) {
      const el = g.target.closest && g.target.closest('[data-key]');
      const pt = g.target.closest && g.target.closest('[data-pt]');
      if (pt && onPointHover) { onPointHover(pt.getAttribute('data-pt'), { x: g.start[0], y: g.start[1] }, true); return; }
      if (onPick) onPick(el ? el.getAttribute('data-key') : null, { x: g.start[0], y: g.start[1] }, e.pointerType === 'touch');
    }
  };
  const onLeave = () => { if (!gesture.current && onHover) onHover(null); if (onPointHover) onPointHover(null); };
  const onDouble = (e) => { const [x, y] = local(e); zoomAt(2, x, y); };

  // Contours groupés par région : trait épais de la région PUIS remplissage, région par
  // région — seule la limite entre deux régions reste visible (aucune donnée en plus).
  const regionGroups = useMemo(() => {
    const m = new Map();
    for (const f of features) {
      const r = shapeRegions[f.properties.key] || '';
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(f.properties.key);
    }
    return [...m.entries()];
  }, [features, shapeRegions]);

  // Avec le fond en ligne : contours sans valeur transparents, contours colorés translucides.
  const hasUnderlay = !!underlay;
  const empty = hasUnderlay ? 'transparent' : 'var(--map-empty)';
  const themeId = theme ? theme.id : null;
  const lines = view.s > 4 ? 0.9 : 0.7;

  // Contours mémorisés (performance) : un survol, un épinglage ou un déplacement de la souris ne
  // reconstruit pas les ~120 × 2 chemins ; seuls le thème, les données, la taille ou le seuil de
  // zoom du trait les refont. Le zoom ne change que la transformation du groupe parent.
  const shapesLayer = useMemo(() => {
    const fillOf = (key) => {
      const z = byKey.get(key);
      if (!z || !scale) return empty;
      const v = valueOf(themeId, z);
      if (v === 'np') return `url(#${uid}-hatch)`;
      return scale.fill(v) || empty;
    };
    return regionGroups.map(([region, keys]) => (
      <g key={region || '_'}>
        {showRegions && region && keys.map((k) => (
          <path key={`r-${k}`} d={paths.get(k)} fill="none" stroke="var(--map-region)" strokeWidth="2.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
        {keys.map((k) => (
          <path key={k} data-key={k} d={paths.get(k)} fill={fillOf(k)} fillOpacity={hasUnderlay ? 0.78 : 1} stroke="var(--map-line)" strokeWidth={lines}
            strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={byKey.has(k) ? 'mapx-shape has-data' : 'mapx-shape'} />
        ))}
      </g>
    ));
  }, [regionGroups, paths, byKey, scale, themeId, uid, empty, hasUnderlay, showRegions, lines]);

  // Écran ← carte : coordonnées de base puis vue stable.
  const toScreen = useCallback((lng, lat, v = settled) => {
    const [x, y] = t.project(lng, lat);
    return [x * v.s + v.x, y * v.s + v.y];
  }, [t, settled]);

  const labels = useMemo(() => {
    if (!t || !showLabels) return [];
    const items = [];
    for (const f of features) {
      const has = byKey.has(f.properties.key);
      if (!has && settled.s < 2.5) continue; // pays : seulement les contours du périmètre
      const [x, y] = toScreen(f.properties.label[0], f.properties.label[1]);
      if (x < -50 || y < -20 || x > width + 50 || y > height + 20) continue;
      items.push({ key: f.properties.key, x, y, text: f.properties.name, priority: (has ? 1000 : 0) + f.properties.area * settled.s * settled.s });
    }
    return layoutLabels(items, { size: 10.5, bounds: { width, height } });
  }, [t, showLabels, features, byKey, settled, toScreen, width, height]);

  // Étiquettes mémorisées (comme les contours). Encre d'une étiquette posée sur un contour
  // coloré : blanc ou encre, le plus contrasté avec la couleur de la classe (même règle que les
  // pastilles du classement).
  const labelsLayer = useMemo(() => {
    if (!labels.length) return null;
    const labelInk = (key) => {
      const z = byKey.get(key);
      if (!z || !scale) return null;
      const v = valueOf(themeId, z);
      const fill = typeof v === 'number' ? scale.fill(v) : null;
      return fill ? inkOn(fill) : null;
    };
    return (
      <g className="mapx-labels" pointerEvents="none">
        {labels.map((l) => {
          const ink = labelInk(l.key);
          const z = byKey.get(l.key);
          const lvl = themeId === 'alerts' && z ? z.alertLevel : null;
          return (
            <text key={l.key} x={l.x.toFixed(1)} y={(l.y + 3.6).toFixed(1)} textAnchor="middle"
              className={ink === '#ffffff' ? 'mapx-label on-dark' : ink ? 'mapx-label on-light' : 'mapx-label'}>
              {lvl != null ? `${ALERT_LEVELS[lvl].icon} ` : ''}{l.text}
            </text>
          );
        })}
      </g>
    );
  }, [labels, byKey, scale, themeId]);

  // Points mémorisés : recalculés quand les points, les couches affichées ou la vue changent
  // (pas au survol). Les couches arrivent dans un objet neuf à chaque rendu : clé par valeur.
  const layersKey = Object.entries(pointLayers).filter(([, on]) => on).map(([k]) => k).sort().join('|');
  const pointsLayer = useMemo(() => {
    if (!points || !t) return null;
    const on = Object.fromEntries(layersKey.split('|').filter(Boolean).map((k) => [k, true]));
    return <PointsLayer points={points} layers={on} toScreen={(lng, lat) => { const [x, y] = t.project(lng, lat); return [x * view.s + view.x, y * view.s + view.y]; }} />;
  }, [points, layersKey, t, view]);

  if (!geo) return <div ref={boxRef} className="mapx-canvas" style={{ height }} />;
  const sb = t ? scaleBar(t, (frame[1] + frame[3]) / 2, { zoom: settled.s }) : null;
  const hoverPath = hoverKey && paths.get(hoverKey);
  const pinPath = pinnedKey && pinnedKey !== hoverKey && paths.get(pinnedKey);

  return (
    <div ref={boxRef} className="mapx-canvas" style={{ height }}>
      {underlay && t && underlay({ t, view, width, height })}
      {t && (
        <svg ref={svgRef} className="mapx-svg" width={width} height={height} role="img" aria-label={ariaLabel}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onPointerLeave={onLeave} onDoubleClick={onDouble}>
          <defs>
            <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--map-hatch-b)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--map-hatch-a)" strokeWidth="2.2" />
            </pattern>
          </defs>
          {!underlay && <rect width={width} height={height} fill="var(--map-bg)" />}
          <g className="mapx-shapes" transform={`translate(${view.x.toFixed(2)},${view.y.toFixed(2)}) scale(${view.s.toFixed(4)})`}>
            {shapesLayer}
            {pinPath && <path d={pinPath} fill="none" stroke="var(--map-ink)" strokeWidth="2.4" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
            {hoverPath && <path d={hoverPath} fill="none" stroke="var(--map-ink)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          </g>
          {pointsLayer}
          {view === settled && labelsLayer}
          {sb && (
            <g className="mapx-furniture" transform={`translate(${width - 22},${height - padBottom - 8})`} pointerEvents="none">
              <g transform={`translate(-${(sb.px / 2 + 6).toFixed(1)},-62)`}>
                <path d="M0,-17 L7,6 L0,1 L-7,6Z" fill="var(--map-ink)" />
                <text y="19" textAnchor="middle" className="mapx-north">{tr('N')}</text>
              </g>
              <g transform={`translate(${-sb.px.toFixed(1)},-6)`}>
                <rect width={(sb.px / 2).toFixed(1)} height="5" fill="var(--map-ink)" />
                <rect x={(sb.px / 2).toFixed(1)} width={(sb.px / 2).toFixed(1)} height="5" fill="var(--map-halo-solid)" stroke="var(--map-ink)" strokeWidth="1" />
                <text y="-5" className="mapx-scale-t">0</text>
                <text x={sb.px.toFixed(1)} y="-5" textAnchor="end" className="mapx-scale-t">{`${sb.km} km`}</text>
              </g>
            </g>
          )}
        </svg>
      )}
      <div className="mapx-ctrls" role="group" aria-label={tr('Zoom')}>
        <button type="button" onClick={() => zoomAt(1.6, width / 2, (height - padBottom) / 2)} aria-label={tr('Zoom avant')} title={tr('Zoom avant')}><Plus size={16} /></button>
        <button type="button" onClick={() => zoomAt(1 / 1.6, width / 2, (height - padBottom) / 2)} aria-label={tr('Zoom arrière')} title={tr('Zoom arrière')}><Minus size={16} /></button>
        <button type="button" onClick={reset} aria-label={tr('Cadrer les données')} title={tr('Cadrer les données')}><Home size={15} /></button>
      </div>
      {view.s > 1.5 && t && <MiniMap paths={paths} width={width} height={height} view={view} />}
    </div>
  );
});

export default DistrictMap;

/** Couches de points (taille d'écran constante). */
function PointsLayer({ points, layers, toScreen }) {
  const out = [];
  const collect = points.collect;
  if (layers.collect && collect) {
    if (collect.mode === 'points') {
      collect.points.forEach((p, i) => { const [x, y] = toScreen(p.lng, p.lat); out.push(<circle key={`c${i}`} data-pt={`c:${i}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.6" className="mapx-collect" />); });
    } else {
      const max = Math.max(1, ...collect.bins.map((b) => b.n));
      collect.bins.forEach((b, i) => { const [x, y] = toScreen(b.lng, b.lat); out.push(<circle key={`b${i}`} data-pt={`b:${i}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r={(2.4 + 4 * Math.sqrt(b.n / max)).toFixed(1)} className="mapx-collect is-bin" />); });
    }
  }
  if (layers.communes) {
    points.communes.forEach((c, i) => {
      const [x, y] = toScreen(c.lng, c.lat);
      const r = Math.min(13, 5 + Math.sqrt(c.sitesWithoutPosition) * 1.4);
      out.push(
        <g key={`m${c.pcode}`} data-pt={`m:${i}`}>
          <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(1)} className="mapx-commune" />
          {c.sitesWithoutPosition > 1 && r >= 8 && <text x={x.toFixed(1)} y={(y + 3.3).toFixed(1)} textAnchor="middle" className="mapx-commune-n">{c.sitesWithoutPosition}</text>}
        </g>
      );
    });
  }
  points.sites.forEach((s, i) => {
    if (s.kind === 'gps' && !layers.gps) return;
    if (s.kind === 'collectes' && !layers.derived) return;
    const [x, y] = toScreen(s.lng, s.lat);
    out.push(
      <g key={`s${s.id}`} data-pt={`s:${i}`}>
        {s.kind === 'collectes' && <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="7.5" className={s.quality === 'fiable' ? 'mapx-derived' : 'mapx-derived is-indicative'} />}
        <StatusSymbol status={s.status} x={+x.toFixed(1)} y={+y.toFixed(1)} />
      </g>
    );
  });
  return <g className="mapx-points">{out}</g>;
}

/** Carte de situation : silhouette + rectangle de l'emprise affichée (au zoom). */
function MiniMap({ paths, width, height, view }) {
  const { tr } = useI18n();
  const w = 128; const h = Math.round((w * height) / Math.max(1, width));
  const rx = -view.x / view.s; const ry = -view.y / view.s;
  return (
    <svg className="mapx-mini" width={w} height={h} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tr('Carte de situation')}>
      <rect width={width} height={height} fill="var(--surface)" />
      {[...paths.values()].map((d, i) => <path key={i} d={d} fill="var(--map-empty)" stroke="none" />)}
      <rect x={rx} y={ry} width={width / view.s} height={height / view.s} fill="none" stroke="var(--blue-600)" strokeWidth={Math.max(3, width / w * 1.6)} />
    </svg>
  );
}
