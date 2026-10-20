import React, { useEffect, useRef, useState } from 'react';
import { MinusCircle } from 'lucide-react';
import { STATUS_ICONS } from '../../../components/ui.jsx';
import { INDICATOR_STATUS } from '../../../lib/indicatorView.js';
import { BANDS, COVERAGE_STATUS, coverageStatusKey } from '../../../lib/coverageView.js';
import { pickTicks } from '../../../lib/chartAxis.js';
import { formatInt, formatLocale, monthLabel, shortMonthLabel } from '../../../lib/format.js';
import { useI18n } from '../../../lib/i18n.jsx';

/**
 * Pièces visuelles du tableau de bord « Couverture & performance du suivi » (maquette de
 * l'utilisateur), dans le système de design de MEMS : classes = couleur + icône + libellé
 * (jamais la couleur seule, texte dans les encres du thème), barres fines à 2 px d'espace,
 * graphiques SVG sans dépendance avec survol (info-bulle) et valeurs aussi lisibles sans survol.
 * Couleurs des classes : jetons --cd-* (clair et sombre), les mêmes que la carte des classes.
 */

const CLASS_TEXT = (band) => (INDICATOR_STATUS[band] || INDICATOR_STATUS.na).label;
const iconOf = (band) => STATUS_ICONS[(INDICATOR_STATUS[band] || INDICATOR_STATUS.na).icon] || MinusCircle;

/** Nombre à une décimale dans la langue de l'écran (« 69,2 » / « 69.2 ») ; « — » sans valeur. */
export const fmt1 = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(formatLocale(), { maximumFractionDigits: 1 }));
/** Écart signé (« +3,3 », « −1 »). */
export const fmtDelta = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt1(Math.abs(v))}`);

/** Classe (indice, score, indicateur) : icône colorée + libellé, ou icône seule (`bare`). */
export function ClassBadge({ band, bare = false, title }) {
  const { tr } = useI18n();
  const b = BANDS.includes(band) ? band : 'na';
  const Icon = iconOf(b);
  const label = tr(CLASS_TEXT(b));
  return (
    <span className={`cvt-cls cvt-cls-${b}${bare ? ' is-bare' : ''}`} title={title || label}>
      <Icon size={13} aria-hidden="true" />
      {bare ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/**
 * Statut d'une couverture (Bon / Moyen / Faible / Critique, seuils 80 / 60 / 30 — common/coverageStatus) :
 * icône + libellé ; `bare` = icône seule (libellé pour les lecteurs d'écran et au survol).
 */
const COVERAGE_BAND = { bon: 'exc', moyen: 'sat', faible: 'imp', critique: 'urg' };
export const coverageBand = (rate) => COVERAGE_BAND[coverageStatusKey(rate)] || 'na';
export function CoverageBadge({ rate, bare = false }) {
  const { tr } = useI18n();
  const k = coverageStatusKey(rate);
  const d = k ? COVERAGE_STATUS[k] : null;
  const Icon = d ? STATUS_ICONS[d.icon] : MinusCircle;
  const label = d ? tr(d.label) : tr('aucun site actif');
  return (
    <span className={`cvt-cls cvt-cls-${coverageBand(rate)}${bare ? ' is-bare' : ''}`} title={label}>
      <Icon size={13} aria-hidden="true" />{bare ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/** Pastille de classe pour une légende (forme carrée, couleur de la classe). */
export const ClassSwatch = ({ band }) => <i className={`cvt-sw cvt-bg-${BANDS.includes(band) ? band : 'na'}`} aria-hidden="true" />;

/** Barre empilée des 5 classes (visites ou indicateurs), 2 px d'espace entre segments. */
export function ClassStack({ classes = {}, unit, height = 12 }) {
  const { tr } = useI18n();
  const total = BANDS.reduce((a, k) => a + (classes[k] || 0), 0);
  const parts = BANDS.filter((k) => (classes[k] || 0) > 0);
  const aria = total
    ? parts.map((k) => `${tr(CLASS_TEXT(k))} ${formatInt(classes[k])}`).join(', ')
    : tr('Aucune donnée');
  return (
    <div className={`cvt-stack${total ? '' : ' is-empty'}`} style={{ height }} role="img" aria-label={aria}>
      {parts.map((k) => (
        <span key={k} className={`cvt-seg cvt-bg-${k}`} style={{ flexGrow: classes[k] }}
          title={`${tr(CLASS_TEXT(k))} : ${formatInt(classes[k])}${unit ? ` ${unit}` : ''} (${Math.round((classes[k] / total) * 100)} %)`} />
      ))}
    </div>
  );
}

/** Liste des 5 classes avec leurs effectifs (la valeur de chaque segment, sans survol). */
export function ClassList({ classes = {}, columns = 1 }) {
  const { tr } = useI18n();
  return (
    <ul className={`cvt-classlist${columns > 1 ? ' is-cols' : ''}`}>
      {BANDS.map((k) => (
        <li key={k}>
          <ClassSwatch band={k} />
          <span className="cvt-classlist-l">{tr(CLASS_TEXT(k))}</span>
          <b className="tabular">{formatInt(classes[k] || 0)}</b>
        </li>
      ))}
    </ul>
  );
}

/**
 * Anneau des 5 classes : total au centre ; survol d'un segment = sa classe et son effectif au
 * centre (les effectifs restent lisibles dans la liste voisine).
 */
export function ClassDonut({ classes = {}, unit, size = 132 }) {
  const { tr } = useI18n();
  const [hover, setHover] = useState(null);
  const total = BANDS.reduce((a, k) => a + (classes[k] || 0), 0);
  const R = 48; const SW = 14; const C = 2 * Math.PI * R;
  const parts = BANDS.filter((k) => (classes[k] || 0) > 0);
  const gap = parts.length > 1 ? 2.5 : 0;
  let off = 0;
  const arcs = parts.map((k) => {
    const len = (classes[k] / total) * C;
    const a = { k, dash: Math.max(0.5, len - gap), off };
    off += len;
    return a;
  });
  const shown = hover && classes[hover] ? hover : null;
  return (
    <svg className="cvt-donut" width={size} height={size} viewBox="0 0 120 120" role="img"
      aria-label={total ? `${formatInt(total)} ${unit || ''} — ${parts.map((k) => `${tr(CLASS_TEXT(k))} ${formatInt(classes[k])}`).join(', ')}` : tr('Aucune donnée')}
      onMouseLeave={() => setHover(null)}>
      <circle cx="60" cy="60" r={R} fill="none" className="cvt-donut-track" strokeWidth={SW} />
      {arcs.map((a) => (
        <circle key={a.k} cx="60" cy="60" r={R} fill="none" className={`cvt-st-${a.k}${shown && shown !== a.k ? ' is-dim' : ''}`} strokeWidth={SW}
          strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={-a.off} transform="rotate(-90 60 60)"
          onMouseEnter={() => setHover(a.k)} onFocus={() => setHover(a.k)} tabIndex={0}>
          <title>{`${tr(CLASS_TEXT(a.k))} : ${formatInt(classes[a.k])}`}</title>
        </circle>
      ))}
      <text x="60" y={shown ? 58 : 60} textAnchor="middle" className="cvt-donut-n">{formatInt(shown ? classes[shown] : total)}</text>
      <text x="60" y={shown ? 74 : 76} textAnchor="middle" className="cvt-donut-l">{shown ? tr(CLASS_TEXT(shown)) : (unit || '')}</text>
    </svg>
  );
}

/** Tuile de chiffre clé (maquette) : libellé, valeur et unité, pied ; classe facultative. */
export function Kpi({ label, value, unit, foot, band, icon: Icon, hint }) {
  return (
    <div className="cvt-kpi" title={hint || undefined}>
      <div className="cvt-kpi-l">{Icon && <Icon size={14} aria-hidden="true" />}{label}</div>
      <div className="cvt-kpi-v tabular">{value}{unit && value !== '—' && <small>{unit}</small>}</div>
      {(foot || band) && (
        <div className="cvt-kpi-s">
          {band && <ClassBadge band={band} />}
          {foot && <span>{foot}</span>}
        </div>
      )}
    </div>
  );
}

/** Carte d'une section : titre, sous-titre, actions ; `fill` = même hauteur que la rangée, défilement intérieur. */
export function Section({ title, sub, actions, children, fill = false, className = '', id }) {
  return (
    <section className={`card cvt-card${fill ? ' is-fill' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <header className="cvt-card-h">
        <div className="cvt-card-tr">
          <h3 id={id}>{title}</h3>
          {actions && <div className="cvt-card-a">{actions}</div>}
        </div>
        {sub && <div className="cvt-card-s">{sub}</div>}
      </header>
      <div className="cvt-card-b">{children}</div>
    </section>
  );
}

/**
 * Ligne à barre (module, indicateur, bureau) : libellé, piste, valeur ; couleur = classe.
 * `stacked` : libellé et valeur sur une ligne, barre en dessous (cartes étroites, longs libellés).
 * `badge` : remplace le badge de classe (ex. statut d'une couverture).
 */
export function MeterRow({ label, sub, value, band, right, title, onClick, rank, stacked = false, badge }) {
  const w = value == null ? 0 : Math.max(2, Math.min(100, value));
  const Tag = onClick ? 'button' : 'div';
  const mark = badge || <ClassBadge band={band || 'na'} bare />;
  if (stacked) {
    return (
      <Tag className={`cvt-meter is-stacked${onClick ? ' is-btn' : ''}`} onClick={onClick} type={onClick ? 'button' : undefined} title={title}>
        <span className="cvt-meter-top">
          <span className="cvt-meter-l">{label}{sub && <small>{sub}</small>}</span>
          <span className="cvt-meter-v tabular">{right != null ? right : value == null ? '—' : Math.round(value)}</span>
          {mark}
        </span>
        <span className="cvt-meter-t" aria-hidden="true"><span className={`cvt-bg-${band || 'na'}`} style={{ width: `${w}%` }} /></span>
      </Tag>
    );
  }
  return (
    <Tag className={`cvt-meter${onClick ? ' is-btn' : ''}${rank != null ? ' has-rank' : ''}`} onClick={onClick} type={onClick ? 'button' : undefined} title={title}>
      {rank != null && <span className="cvt-meter-rk tabular">{rank}</span>}
      <span className="cvt-meter-l">{label}{sub && <small>{sub}</small>}</span>
      <span className="cvt-meter-t" aria-hidden="true"><span className={`cvt-bg-${band || 'na'}`} style={{ width: `${w}%` }} /></span>
      <span className="cvt-meter-v tabular">{right != null ? right : value == null ? '—' : Math.round(value)}</span>
      {mark}
    </Tag>
  );
}

const AXIS_PX = 11;
let measureCtx = null;
function textWidth(text) {
  try {
    if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  } catch { measureCtx = null; }
  if (measureCtx) { measureCtx.font = `400 ${AXIS_PX}px Inter, system-ui, sans-serif`; return Math.ceil(measureCtx.measureText(text).width); }
  return Math.ceil(text.length * AXIS_PX * 0.62);
}

/**
 * Tendance mensuelle de l'indice (0 – 100, échelle fixe) : ligne de 2 px coupée sur les mois sans
 * visite notée, points sur les mois notés, repère du seuil 50 (action urgente) et de l'objectif 65
 * (satisfaisant) ; survol = repère vertical + mois, indice et visites.
 * @param {{ months: {month, index, visits, scored}[], height?: number, label: string }} props
 */
export function IndexTrend({ months = [], height = 170, label }) {
  const { tr } = useI18n();
  const wrap = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = months.length;
  const w = Math.max(200, width || 360);
  const pad = { l: 28, r: 64, t: 10, b: 24 };
  const plotW = w - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const x = (i) => pad.l + (n > 1 ? i * step : plotW / 2);
  const y = (v) => pad.t + plotH * (1 - v / 100);
  // Segments continus (mois notés consécutifs).
  const segs = [];
  let cur = [];
  months.forEach((m, i) => {
    if (m.index == null) { if (cur.length) segs.push(cur); cur = []; return; }
    cur.push(`${x(i).toFixed(1)},${y(m.index).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);
  const texts = months.map((m) => shortMonthLabel(m.month));
  const marks = n ? pickTicks(months.map((_, i) => x(i)), texts.map((t) => textWidth(t)), { width: w, forced: [0, n - 1], gap: 8 }) : [];
  const h = hover != null ? months[hover] : null;
  return (
    <div ref={wrap} className="trend-chart cvt-trend" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label}>
        {[0, 50, 100].map((t) => (
          <g key={t}>
            <line className="trend-grid" x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />
            <text className="trend-axis" x={pad.l - 6} y={y(t) + 3.5} textAnchor="end">{t}</text>
          </g>
        ))}
        <line className="cvt-ref cvt-ref-urg" x1={pad.l} x2={w - pad.r} y1={y(50)} y2={y(50)} />
        <text className="trend-axis cvt-ref-t" x={w - pad.r + 6} y={y(50) + 3.5}>{tr('seuil 50')}</text>
        <line className="cvt-ref cvt-ref-sat" x1={pad.l} x2={w - pad.r} y1={y(65)} y2={y(65)} />
        <text className="trend-axis cvt-ref-t" x={w - pad.r + 6} y={y(65) + 3.5}>{tr('objectif 65')}</text>
        {segs.map((s, i) => <polyline key={i} className="trend-line" points={s.join(' ')} />)}
        {hover != null && <line className="trend-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} />}
        {months.map((m, i) => (m.index == null ? null : (
          <circle key={m.month} className="trend-dot" cx={x(i)} cy={y(m.index)} r={hover === i ? 5.5 : 4}>
            <title>{`${monthLabel(m.month)} : ${fmt1(m.index)}/100`}</title>
          </circle>
        )))}
        {marks.map(({ index: i, anchor }) => (
          <text key={`t${months[i].month}`} className="trend-axis trend-month" x={x(i)} y={height - 7} textAnchor={anchor}>{texts[i]}</text>
        ))}
        {months.map((m, i) => (
          <rect key={`h${m.month}`} className="trend-hit" x={x(i) - Math.max(step, 14) / 2} y={pad.t} width={Math.max(step, 14)} height={plotH}
            onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && (
        <div className="trend-tip" style={{ left: Math.min(Math.max(x(hover), 80), w - 80), top: Math.max(0, (h.index == null ? y(50) : y(h.index)) - 50) }} role="status">
          <div className="trend-tip-m">{monthLabel(h.month)}</div>
          <div className="tabular">{h.index == null ? tr('aucune visite notée') : tr('indice {v}/100', { v: fmt1(h.index) })}</div>
          <div className="tabular cvt-tip-sub">{tr('{n} visite(s)', { n: formatInt(h.visits || 0) })}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Radar des modules (≥ 3) : anneaux 25 / 50 / 75 / 100, profil de l'activité, points colorés par
 * classe (anneau de surface), libellés tronqués avec le nom complet au survol. Les valeurs exactes
 * sont dans la carte « Détail par module » voisine.
 */
export function ModuleRadar({ dims = [], label }) {
  const { tr } = useI18n();
  const [hover, setHover] = useState(null);
  const n = dims.length;
  if (n < 3) return <p className="muted cvt-empty-note">{tr('Profil disponible à partir de 3 modules notés.')}</p>;
  const W = 360; const H = 280; const cx = W / 2; const cy = H / 2 + 4; const R = 96;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, v) => [cx + Math.cos(ang(i)) * R * (v / 100), cy + Math.sin(ang(i)) * R * (v / 100)];
  const poly = (v) => dims.map((_, i) => pt(i, v).map((c) => c.toFixed(1)).join(',')).join(' ');
  const shape = dims.map((d, i) => pt(i, d.score || 0).map((c) => c.toFixed(1)).join(',')).join(' ');
  const short = (s) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
  return (
    <svg className="cvt-radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
      {[25, 50, 75, 100].map((g) => <polygon key={g} className="cvt-radar-ring" points={poly(g)} />)}
      {dims.map((_, i) => { const [x2, y2] = pt(i, 100); return <line key={i} className="cvt-radar-axis" x1={cx} y1={cy} x2={x2} y2={y2} />; })}
      <polygon className="cvt-radar-shape" points={shape} />
      {dims.map((d, i) => {
        const [px, py] = pt(i, d.score || 0);
        const [lx, ly] = pt(i, 118);
        const cos = Math.cos(ang(i));
        const anchor = Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end';
        return (
          <g key={d.name} onMouseEnter={() => setHover(i)}>
            <circle className={`cvt-radar-pt cvt-fill-${d.band || 'na'}`} cx={px} cy={py} r={hover === i ? 6 : 4.5}>
              <title>{`${d.name} : ${d.score}`}</title>
            </circle>
            <text className={`cvt-radar-l${hover === i ? ' is-hover' : ''}`} x={lx} y={ly + 3.5} textAnchor={anchor}>
              {hover === i ? `${short(d.name)} · ${d.score}` : short(d.name)}<title>{d.name}</title>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Note d'un bloc sans contenu : raison + ce qu'il faut faire (jamais un bloc vide). */
export function EmptyNote({ icon: Icon, title, children, action }) {
  return (
    <div className="cvt-emptynote" role="status">
      {Icon && <span className="cvt-emptynote-ic" aria-hidden="true"><Icon size={18} /></span>}
      <div>
        {title && <div className="cvt-emptynote-t">{title}</div>}
        {children && <div className="cvt-emptynote-x">{children}</div>}
        {action && <div className="cvt-emptynote-a">{action}</div>}
      </div>
    </div>
  );
}
