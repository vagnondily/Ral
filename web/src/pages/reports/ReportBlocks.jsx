import React from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { RichTextView } from './RichText.jsx';
import { substitute } from './reportDoc.js';

/**
 * Rendu des blocs d'un rapport v2 (aperçu de l'éditeur, impression/PDF, export
 * HTML). Graphiques en SVG intégré, sans dépendance ; la couleur n'est jamais
 * seule porteuse de sens (légendes + étiquettes directes + valeurs).
 * Palette alignée sur les tableaux de bord : prévu = ambre, réalisé = bleu ; le
 * rouge n'est jamais une couleur de série (il signale « Action urgente »).
 */
const C = { planned: '#c77700', done: '#0f6cbd' };
const CAT = ['#0f6cbd', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const BAND = {
  exc: ['var(--cd-exc)', 'Excellent'], sat: ['var(--cd-sat)', 'Satisfaisant'], imp: ['var(--cd-imp)', 'À améliorer'],
  urg: ['var(--cd-urg)', 'Action urgente'], na: ['var(--cd-na)', 'Non évalué'],
};

const num = (v, d = 0) => Number(v).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: d });

/** Valeur formatée selon le type de colonne du jeu de données. */
export function formatCell(type, v, tr) {
  if (v == null || v === '') return '—';
  switch (type) {
    case 'pct': return `${num(v, 1)} %`;
    case 'rate': return `${num(Number(v) * 100, 1)} %`;
    case 'int': return formatInt(v);
    case 'dec': return num(v, 3);
    case 'money': return num(v, 0);
    case 'month': return /^\d{4}-\d{2}$/.test(v) ? monthLabel(v) : v;
    case 'band': return tr(BAND[v] ? BAND[v][1] : v);
    default: return String(v); // donnée (nom, code) : jamais traduite
  }
}

// Seuils de couleur des pourcentages (comme le classeur RBM : < 50 rouge, < 90 ambre, ≥ 90 vert).
const pctTone = (v) => (v == null ? 'na' : v >= 90 ? 'exc' : v >= 50 ? 'imp' : 'urg');

const colLabel = (c, tr) => (c.key.startsWith('m:') ? monthLabel(c.key.slice(2)) : c.key.startsWith('d:') ? c.label : tr(c.label));

// Note d'un bloc vide : phrase du serveur, déjà dans la langue du rapport (jamais retraduite).
const Empty = ({ note }) => {
  const { tr } = useI18n();
  return <p className="rb-note">{note || tr('Aucune donnée sur la période.')}</p>;
};

export function DataTable({ data, columns: pick, matrix }) {
  const { tr } = useI18n();
  if (!data) return null;
  const cols = pick && pick.length ? data.columns.filter((c) => pick.includes(c.key)) : data.columns;
  if (!data.rows.length) return <Empty note={data.meta && data.meta.note} />;
  return (
    <div className="rb-table-wrap">
      <table className={`rb-table ${matrix ? 'rb-matrix' : ''}`}>
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.type === 'text' ? '' : 'num'}>{colLabel(c, tr)}</th>)}</tr></thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const v = r[c.key];
                if (c.type === 'band') return <td key={c.key}><span className={`rb-band rb-band-${v || 'na'}`}>{formatCell('band', v || 'na', tr)}</span></td>;
                if (matrix && c.type === 'pct') return <td key={c.key} className={`num rb-heat rb-heat-${pctTone(v)}`}>{formatCell('pct', v, tr)}</td>;
                return <td key={c.key} className={c.type === 'text' ? '' : 'num'}>{formatCell(c.type, v, tr)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Barres : x = 1re colonne texte/mois ; séries = colonnes numériques (ou `metric`). Axe à zéro. */
export function BarChart({ data, metric }) {
  const { tr } = useI18n();
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const xCol = data.columns.find((c) => c.type === 'text' || c.type === 'month');
  let series = data.columns.filter((c) => ['int', 'money', 'dec', 'pct'].includes(c.type) && !c.key.startsWith('m:'));
  if (metric) series = series.filter((c) => c.key === metric);
  else if (series.some((c) => c.type !== 'pct')) series = series.filter((c) => c.type !== 'pct');
  series = series.slice(0, 3);
  if (!series.length) return <DataTable data={data} />;
  const W = 640; const H = 240; const pad = { l: 44, r: 12, t: 12, b: 46 };
  const max = Math.max(1, ...data.rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)));
  const groupW = (W - pad.l - pad.r) / data.rows.length; const barW = Math.max(4, Math.min(28, (groupW - 8) / series.length));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const color = (s, i) => (s.key === 'planned' ? C.planned : s.key === 'done' ? C.done : CAT[i % CAT.length]);
  return (
    <figure className="rb-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Graphique en barres')}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} className="rb-grid" /><text x={pad.l - 6} y={y(max * f) + 4} className="rb-axis" textAnchor="end">{formatInt(max * f)}</text></g>)}
        {data.rows.map((r, i) => (
          <g key={i} transform={`translate(${pad.l + i * groupW + (groupW - barW * series.length) / 2},0)`}>
            {series.map((s, k) => { const v = Number(r[s.key]) || 0; return (
              <g key={s.key}>
                <rect x={k * barW} y={y(v)} width={barW - 2} height={H - pad.b - y(v)} rx="2" fill={color(s, k)}><title>{`${colLabel(s, tr)} : ${formatCell(s.type, v, tr)}`}</title></rect>
                {barW >= 14 && <text x={k * barW + (barW - 2) / 2} y={y(v) - 3} className="rb-val" textAnchor="middle">{formatInt(v)}</text>}
              </g>
            ); })}
            <text x={(barW * series.length) / 2} y={H - pad.b + 14} className="rb-axis" textAnchor="middle">{formatCell(xCol?.type, r[xCol?.key], tr).slice(0, 14)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="rb-legend">{series.map((s, k) => <span key={s.key}><i style={{ background: color(s, k) }} />{colLabel(s, tr)}</span>)}</figcaption>
    </figure>
  );
}

/** Courbes : une série par ligne (ex. activité) sur les colonnes mensuelles « m:AAAA-MM » ; sinon barres. */
export function LineChart({ data }) {
  const { tr } = useI18n();
  const months = (data?.columns || []).filter((c) => c.key.startsWith('m:'));
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  if (!months.length) return <BarChart data={data} />;
  const W = 640; const H = 240; const pad = { l: 40, r: 12, t: 12, b: 36 };
  const max = Math.max(10, ...data.rows.flatMap((r) => months.map((m) => Number(r[m.key]) || 0)));
  const x = (i) => pad.l + (months.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (months.length - 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const label = data.columns[0].key;
  return (
    <figure className="rb-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Graphique en courbes')}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} className="rb-grid" /><text x={pad.l - 6} y={y(max * f) + 4} className="rb-axis" textAnchor="end">{`${Math.round(max * f)} %`}</text></g>)}
        {months.map((m, i) => <text key={m.key} x={x(i)} y={H - pad.b + 16} className="rb-axis" textAnchor="middle">{monthLabel(m.key.slice(2)).slice(0, 4)}</text>)}
        {data.rows.map((r, k) => {
          const pts = months.map((m, i) => [x(i), y(Number(r[m.key]) || 0)]);
          return (
            <g key={k}>
              <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={CAT[k % CAT.length]} strokeWidth="2.2" />
              {pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="3" fill={CAT[k % CAT.length]}><title>{`${r[label]} · ${monthLabel(months[i].key.slice(2))} : ${formatCell('pct', r[months[i].key], tr)}`}</title></circle>)}
            </g>
          );
        })}
      </svg>
      <figcaption className="rb-legend">{data.rows.map((r, k) => <span key={k}><i style={{ background: CAT[k % CAT.length] }} />{r[label]}</span>)}</figcaption>
    </figure>
  );
}

export function KpiTiles({ data, labels, units }) {
  const { tr } = useI18n();
  if (!data || !data.values) return null;
  return (
    <div className="rb-kpis" style={{ '--n': Object.keys(data.values).length }}>
      {Object.entries(data.values).map(([k, v]) => {
        const unit = units && units[k];
        const note = data.notes && data.notes[k];
        return (
          <div key={k} className="rb-kpi">
            <span className="rb-kpi-v">{v == null ? '—' : unit === 'pct' ? `${num(v, 1)} %` : unit === 'rate' ? `${num(v * 100, 1)} %` : num(v, unit === 'dec' || unit === 'mt' ? 1 : 0)}</span>
            <span className="rb-kpi-l">{tr(labels[k] || k)}</span>
            {v == null && note && <span className="rb-kpi-n">{note}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Figure : numéro (« Figure 2 », « Tableau 1 »), titre, sous-titre, corps, source et n, note.
 * Chaque bloc de données est une figure (guide de visualisation).
 */
function Figure({ figure, number, title, subtitle, meta, note, children }) {
  const { tr } = useI18n();
  const f = figure || {};
  const showN = f.showN !== false && meta && meta.n != null;
  return (
    <figure className="rb-figure">
      {(title || number) && (
        <figcaption className="rb-title">
          {number && <span className="rb-fig-no">{tr(number.kind === 'table' ? 'Tableau {n}' : 'Figure {n}', { n: number.n })}</span>}
          {number && title ? ' · ' : ''}{title}
        </figcaption>
      )}
      {subtitle && <p className="rb-subtitle">{subtitle}</p>}
      {children}
      {(meta && (meta.source || showN)) && (
        <p className="rb-source">
          {meta.source}{showN ? ` · n = ${formatInt(meta.n)}` : ''}
        </p>
      )}
      {note && <p className="rb-fig-note">{note}</p>}
    </figure>
  );
}

const CALLOUT = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: OctagonAlert };

/** Corps d'un bloc « données » selon sa vue. */
function DataView({ view, data, params }) {
  switch (view) {
    case 'heat': return <DataTable data={data} matrix columns={params.columns} />;
    case 'bar': case 'column': case 'stacked': return <BarChart data={data} metric={params.measure} />;
    case 'line': return <LineChart data={data} />;
    default: return <DataTable data={data} columns={params.columns} />;
  }
}

/**
 * Un bloc rendu. `ctx` = { result ({ ok, data, meta } | { ok: false, error }), inst (instance
 * du plan), vars (variables simples + élément répété), catalog, item }.
 * `editor` (optionnel) remplace le texte par un éditeur pour les blocs texte.
 */
export function BlockView({ block, ctx, editor }) {
  const { tr } = useI18n();
  const p = block.params || {};
  const res = ctx.result;
  const d = res && res.ok ? res.data : null;
  const vars = { ...(ctx.vars || {}), ...((d && d.vars) || {}) };
  const subst = (s) => substitute(s, ctx.vars || {});
  const labelFor = (v) => tr((ctx.varLabels || {})[v] || v);
  switch (block.type) {
    case 'heading': { const Tag = `h${Math.min(3, p.level || 2)}`; return <Tag className={`rb-h rb-h${p.level || 2}`}>{subst(p.text)}</Tag>; }
    case 'text': return editor || <RichTextView doc={p.doc} vars={vars} labelFor={labelFor} pending={ctx.pending} />;
    case 'callout': { const Ico = CALLOUT[p.tone] || Info; return (
      <aside className={`rb-callout rb-callout-${p.tone || 'info'}`}>
        <div className="rb-callout-h"><Ico size={16} aria-hidden="true" />{p.title && <strong>{subst(p.title)}</strong>}</div>
        {editor || <RichTextView doc={p.doc} vars={vars} labelFor={labelFor} pending={ctx.pending} />}
      </aside>
    ); }
    case 'bulletin': return editor || <RichTextView doc={p.doc || d?.doc} vars={vars} labelFor={labelFor} />;
    case 'kpis': {
      const kp = (ctx.catalog && ctx.catalog.kpis) || {};
      return <KpiTiles data={d} labels={Object.fromEntries(Object.entries(kp).map(([k, x]) => [k, x.label]))} units={Object.fromEntries(Object.entries(kp).map(([k, x]) => [k, x.unit]))} />;
    }
    case 'data': {
      const def = (ctx.catalog && ctx.catalog.datasets[p.dataset]) || null;
      const fig = p.figure || {};
      const view = p.view || (def && def.defaultView) || 'table';
      return (
        <Figure figure={fig} number={ctx.inst && ctx.inst.figure} title={subst(fig.title) || (def ? tr(def.label) : p.dataset)}
          subtitle={fig.subtitle ? subst(fig.subtitle) : null} meta={d && { ...d.meta, source: fig.source || (d.meta && d.meta.source) }} note={fig.note}>
          {d ? <DataView view={view} data={d} params={p} /> : null}
        </Figure>
      );
    }
    case 'pagebreak': return <div className="rb-pagebreak" aria-hidden="true"><span>{tr('Saut de page')}</span></div>;
    case 'divider': return <hr className="rb-divider" />;
    case 'spacer': return <div className="rb-spacer" style={{ height: `${p.height || 8}mm` }} aria-hidden="true" />;
    case 'toc': return <p className="rb-note">{tr('Sommaire (numéros de page dans l\'aperçu paginé).')}</p>;
    case 'approval': return <p className="rb-note">{tr('Cartouche de validation : rempli quand le rapport est soumis puis validé.')}</p>;
    case 'image': return <p className="rb-note">{tr('Image')}</p>;
    default: return null;
  }
}

/**
 * Bande d'en-tête ou de pied DESSINÉE : éléments placés (x et largeur en % de la largeur
 * imprimable, y et hauteur en mm). Textes avec variables déjà remplies ; numéro de page
 * « n / N » posé par la pagination (aperçu : modèle).
 */
export function Band({ band, texts, vars, pageNo, pages, className }) {
  const { tr } = useI18n();
  if (!band || !band.elements || !band.elements.length) return null;
  return (
    <div className={`rd-band ${className || ''}`} style={{ height: `${band.height}mm` }}>
      {band.elements.map((e) => {
        const box = { left: `${e.x}%`, top: `${e.y}mm`, width: `${e.w}%`, height: `${e.h}mm` };
        const st = e.style || {};
        const font = { fontFamily: st.font === 'Georgia' ? 'Georgia, serif' : st.font === 'Arial' ? 'Arial, sans-serif' : 'Inter, Arial, sans-serif', fontSize: `${st.size || 8}pt`, fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal', color: st.color, textAlign: st.align, background: st.background, padding: st.padding ? `${st.padding}mm` : undefined, borderRadius: st.radius ? `${st.radius}mm` : undefined };
        if (e.kind === 'text') return <div key={e.id} className="rd-el rd-el-text" style={{ ...box, ...font }}>{texts && texts[e.id] != null ? texts[e.id] : substitute(e.text, vars)}</div>;
        if (e.kind === 'pageNumber') {
          const n = pageNo || 'n'; const N = pages || 'N';
          const label = { n: `${n}`, 'n / N': `${n} / ${N}`, 'Page n': tr('Page {n}', { n }), 'Page n / N': tr('Page {n} / {N}', { n, N }) }[e.format || 'Page n / N'];
          return <div key={e.id} className="rd-el rd-el-text rd-pageno" style={{ ...box, ...font }}>{label}</div>;
        }
        if (e.kind === 'line') return <div key={e.id} className="rd-el" style={{ ...box, height: 0, borderTop: `${e.thickness || 0.5}pt solid ${e.color || '#e7e9ef'}` }} />;
        if (e.kind === 'rect') return <div key={e.id} className="rd-el" style={{ ...box, background: e.fill, border: e.border ? `0.5pt solid ${e.border}` : undefined, borderRadius: e.radius ? `${e.radius}mm` : undefined, opacity: e.opacity }} />;
        if (e.kind === 'image') return <div key={e.id} className="rd-el rd-el-image" style={box} aria-label={tr('Image')} />;
        return null;
      })}
    </div>
  );
}
