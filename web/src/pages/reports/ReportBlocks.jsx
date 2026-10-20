import React from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Image as ImageIcon } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { RichTextView } from './RichText.jsx';
import { substitute } from './reportDoc.js';
import Figure from './views/Figure.jsx';
import DataView, { CHART_VIEWS } from './views/DataView.jsx';
import { DataTable } from './views/DataTable.jsx';
import { KpiTiles } from './views/KpiStrip.jsx';
import { useAssetUrl } from './useAssets.js';

/**
 * Rendu des blocs d'un rapport v2 (aperçu de l'éditeur, impression/PDF, export HTML).
 * Les vues (tableau, barres, colonnes, courbes, anneau, empilées, matrice, tuile, liste,
 * carte de résultat, explication) vivent dans ./views et suivent le guide de visualisation
 * (lib/reportViz.js) : axe à zéro, palette sobre en ordre fixe, le rouge jamais couleur de
 * série, légende dès 2 séries, chaque bloc de données est une FIGURE numérotée avec sa
 * source et n. Rien n'est recalculé ici : le serveur envoie les chiffres, l'écran les met en forme.
 */
const CALLOUT = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: OctagonAlert };

// Morceau d'un texte coupé entre deux pages (paragraphes [i, j[ de la pagination).
const sliceDoc = (doc, slice) => (doc && slice && slice.part ? { nodes: (doc.nodes || []).slice(slice.part[0], slice.part[1]) } : doc);
// Vues découpables ligne à ligne (tableau, matrice, liste).
export const ROW_VIEWS = new Set(['table', 'heat', 'list']);

/**
 * Un bloc rendu. `ctx` = { result ({ ok, data, meta } | { ok: false, error }), inst (instance
 * du plan), vars (variables simples + élément répété), catalog, varLabels, pending,
 * slice ({ part: [i, j], first, last } : morceau placé sur une page par la pagination),
 * fit ({ scale } : police d'un tableau réduite pour tenir dans la largeur), toc (entrées du sommaire),
 * showData / onToggleData (« Voir les données » d'un graphique, piloté par l'éditeur) }.
 * `editor` (optionnel) remplace le texte par un éditeur pour les blocs texte.
 */
export function BlockView({ block, ctx, editor }) {
  const { tr } = useI18n();
  const p = block.params || {};
  const res = ctx.result;
  const slice = ctx.slice || null;
  const d = res && res.ok ? res.data : null;
  const vars = { ...(ctx.vars || {}), ...((d && d.vars) || {}) };
  const subst = (s) => substitute(s, ctx.vars || {});
  const labelFor = (v) => tr((ctx.varLabels || {})[v] || v);
  switch (block.type) {
    case 'heading': { const Tag = `h${Math.min(3, p.level || 2)}`; return <Tag className={`rb-h rb-h${p.level || 2}`}>{subst(p.text)}</Tag>; }
    case 'text': return editor || <RichTextView doc={sliceDoc(p.doc, slice)} vars={vars} labelFor={labelFor} pending={ctx.pending} />;
    case 'callout': { const Ico = CALLOUT[p.tone] || Info; return (
      <aside className={`rb-callout rb-callout-${p.tone || 'info'}`}>
        {(!slice || slice.first) && <div className="rb-callout-h"><Ico size={16} aria-hidden="true" />{p.title && <strong>{subst(p.title)}</strong>}</div>}
        {editor || <RichTextView doc={sliceDoc(p.doc, slice)} vars={vars} labelFor={labelFor} pending={ctx.pending} />}
      </aside>
    ); }
    case 'bulletin': return editor || <RichTextView doc={sliceDoc(p.doc || d?.doc, slice)} vars={vars} labelFor={labelFor} />;
    case 'kpis': {
      const kp = (ctx.catalog && ctx.catalog.kpis) || {};
      return <KpiTiles data={d} labels={Object.fromEntries(Object.entries(kp).map(([k, x]) => [k, x.label]))} units={Object.fromEntries(Object.entries(kp).map(([k, x]) => [k, x.unit]))} />;
    }
    case 'data': {
      const def = (ctx.catalog && ctx.catalog.datasets[p.dataset]) || null;
      const fig = p.figure || {};
      const view = p.view || (def && def.defaultView) || 'table';
      const title = subst(fig.title) || (def ? tr(def.label) : p.dataset);
      const chart = CHART_VIEWS.has(view);
      // Morceau d'un tableau coupé entre deux pages : ses lignes seulement, en-tête répété.
      const part = slice && slice.part && d && ROW_VIEWS.has(view) ? { ...d, rows: d.rows.slice(slice.part[0], slice.part[1]) } : d;
      return (
        <Figure figure={fig} number={ctx.inst && ctx.inst.figure} title={title}
          subtitle={fig.subtitle ? subst(fig.subtitle) : null} meta={d && d.meta} note={fig.note}
          continued={!!(slice && !slice.first)} noFoot={!!(slice && !slice.last)} showData={ctx.showData} onToggleData={ctx.onToggleData}
          bare={!!(ctx.inst && ctx.inst.annex) && !(slice && !slice.first)}
          table={chart && d && !slice ? <DataTable data={d} columns={p.columns} /> : null}>
          {part ? <DataView view={view} def={def} data={part} params={p} title={title} scale={(ctx.fit && ctx.fit.scale) || 1} /> : null}
        </Figure>
      );
    }
    case 'pagebreak': return <div className="rb-pagebreak" aria-hidden="true"><span>{tr('Saut de page')}</span></div>;
    case 'divider': return <hr className="rb-divider" />;
    case 'spacer': return <div className="rb-spacer" style={{ height: `${p.height || 8}mm` }} aria-hidden="true" />;
    case 'toc': {
      const entries = (ctx.toc || []).filter((e) => e.level <= (p.depth || 2));
      if (!entries.length) return <p className="rb-note">{tr('Sommaire : ajoutez des titres au rapport.')}</p>;
      return (
        <nav className="rb-toc" aria-label={tr('Sommaire')}>
          <p className="rb-toc-h">{tr('Sommaire')}</p>
          <ol>{entries.map((e, i) => <li key={e.iid} className={`rb-toc-l${e.level} ${e.annex && !(entries[i - 1] || {}).annex ? 'rb-toc-annex-first' : ''}`}><span>{e.text}</span><i aria-hidden="true" /><b>{e.page == null ? '…' : e.page}</b></li>)}</ol>
        </nav>
      );
    }
    case 'approval': return <p className="rb-note">{tr('Cartouche de validation : rempli quand le rapport est soumis puis validé.')}</p>;
    case 'image': return <p className="rb-note">{tr('Image')}</p>;
    default: return null;
  }
}

/**
 * Logo d'une bande : l'image du compte, contenue dans son cadre et alignée. Emplacement vide (modèle)
 * ou image pas encore lue : cadre « Logo » dans l'éditeur seulement — rien à l'impression.
 */
function BandImage({ e, box, editing }) {
  const { tr } = useI18n();
  const url = useAssetUrl(e.assetId || null);
  if (!url) {
    return editing ? <div className="rd-el rd-el-ph" style={box}><ImageIcon size={13} aria-hidden="true" /><span>{tr('Logo')}</span></div> : null;
  }
  return <img className="rd-el rd-el-img" data-asset={e.assetId} src={url} alt="" style={{ ...box, objectFit: 'contain', objectPosition: `${e.align || 'left'} center` }} />;
}

const FONT_STACK = { Georgia: 'Georgia, serif', Arial: 'Arial, Helvetica, sans-serif', Inter: 'Inter, Arial, sans-serif' };

/**
 * Bande d'en-tête ou de pied DESSINÉE (retours 51 et 88) : éléments placés (x et largeur en % de
 * la largeur imprimable, y et hauteur en mm), dans l'ordre d'empilement. Textes avec variables
 * ({titre}, {periode}, {bureau}, {date}, {section}…, {page} et {pages} posés par la pagination) ;
 * n° de page ; trait horizontal ou vertical ; rectangle (bandeau BORD À BORD si `bleed` : jusqu'aux
 * bords de la feuille, `edges` = marges en mm, et jusqu'au bord haut / bas qu'il touche) ; logo.
 * Même rendu dans l'aperçu, l'impression, l'export HTML et le concepteur d'en-tête.
 */
export function Band({ band, texts, vars, pageNo, pages, className, edges = null, place = 'header', editing = false }) {
  const { tr } = useI18n();
  if (!band || !band.elements || !band.elements.length) return null;
  const pv = { ...(vars || {}), page: pageNo != null ? pageNo : (vars || {}).page, pages: pages != null ? pages : (vars || {}).pages };
  return (
    <div className={`rd-band ${className || ''}`} style={{ height: `${band.height}mm` }}>
      {band.elements.map((e) => {
        const box = { left: `${e.x}%`, top: `${e.y}mm`, width: `${e.w}%`, height: `${e.h}mm` };
        const st = e.style || {};
        const font = {
          fontFamily: FONT_STACK[st.font] || FONT_STACK.Inter, fontSize: `${st.size || 8}pt`, fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal',
          color: st.color, textAlign: st.align, justifyContent: st.align === 'center' ? 'center' : st.align === 'right' ? 'flex-end' : 'flex-start',
          background: st.background, padding: st.padding ? `0 ${st.padding}mm` : st.background ? '0 1.2mm' : undefined, borderRadius: st.radius ? `${st.radius}mm` : undefined,
          textTransform: st.caps ? 'uppercase' : undefined, letterSpacing: st.caps ? '0.08em' : undefined,
        };
        if (e.kind === 'text') {
          const raw = texts && texts[e.id] != null ? texts[e.id] : e.text;
          // Sur plusieurs lignes (grand titre) : le texte s'enroule dans son cadre, calé en bas, jamais coupé au milieu d'un mot.
          return <div key={e.id} className={`rd-el rd-el-text ${st.wrap ? 'is-wrap' : ''}`} style={{ ...box, ...font }}><span>{substitute(raw, pv)}</span></div>;
        }
        if (e.kind === 'pageNumber') {
          const n = pageNo || 'n'; const N = pages || 'N';
          const label = {
            n: `${n}`, 'n / N': `${n} / ${N}`, 'Page n': tr('Page {n}', { n }), 'Page n / N': tr('Page {n} / {N}', { n, N }), 'Page n sur N': tr('Page {n} sur {N}', { n, N }),
          }[e.format || 'Page n / N'];
          return <div key={e.id} className="rd-el rd-el-text rd-pageno" style={{ ...box, ...font }}><span>{label}</span></div>;
        }
        if (e.kind === 'line') {
          const t = `${e.thickness || 0.5}pt solid ${e.color || '#e7e9ef'}`;
          return e.dir === 'v'
            ? <div key={e.id} className="rd-el" style={{ ...box, width: 0, borderLeft: t }} />
            : <div key={e.id} className="rd-el" style={{ ...box, height: 0, borderTop: t }} />;
        }
        if (e.kind === 'rect') {
          const b = { ...box };
          if (e.bleed && edges) {
            b.left = `-${edges.left}mm`; b.width = `calc(100% + ${edges.left + edges.right}mm)`;
            if (place === 'header' && e.y <= 0.01) { b.top = `-${edges.top}mm`; b.height = `${e.h + edges.top}mm`; }
            if (place === 'footer' && e.y + e.h >= band.height - 0.01) b.height = `${e.h + edges.bottom}mm`;
          }
          return <div key={e.id} className="rd-el" style={{ ...b, background: e.fill, border: e.border ? `0.5pt solid ${e.border}` : undefined, borderRadius: e.radius && !e.bleed ? `${e.radius}mm` : undefined, opacity: e.opacity }} />;
        }
        if (e.kind === 'image') return <BandImage key={e.id} e={e} box={box} editing={editing} />;
        return null;
      })}
    </div>
  );
}
