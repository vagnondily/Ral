import React from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { RichTextView } from './RichText.jsx';
import { substitute } from './reportDoc.js';
import Figure from './views/Figure.jsx';
import DataView, { CHART_VIEWS } from './views/DataView.jsx';
import { DataTable } from './views/DataTable.jsx';
import { KpiTiles } from './views/KpiStrip.jsx';

/**
 * Rendu des blocs d'un rapport v2 (aperçu de l'éditeur, impression/PDF, export HTML).
 * Les vues (tableau, barres, colonnes, courbes, anneau, empilées, matrice, tuile, liste,
 * carte de résultat, explication) vivent dans ./views et suivent le guide de visualisation
 * (lib/reportViz.js) : axe à zéro, palette sobre en ordre fixe, le rouge jamais couleur de
 * série, légende dès 2 séries, chaque bloc de données est une FIGURE numérotée avec sa
 * source et n. Rien n'est recalculé ici : le serveur envoie les chiffres, l'écran les met en forme.
 */
const CALLOUT = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: OctagonAlert };

/**
 * Un bloc rendu. `ctx` = { result ({ ok, data, meta } | { ok: false, error }), inst (instance
 * du plan), vars (variables simples + élément répété), catalog, varLabels, pending }.
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
      const title = subst(fig.title) || (def ? tr(def.label) : p.dataset);
      const chart = CHART_VIEWS.has(view);
      return (
        <Figure figure={fig} number={ctx.inst && ctx.inst.figure} title={title}
          subtitle={fig.subtitle ? subst(fig.subtitle) : null} meta={d && d.meta} note={fig.note}
          table={chart && d ? <DataTable data={d} columns={p.columns} /> : null}>
          {d ? <DataView view={view} def={def} data={d} params={p} title={title} /> : null}
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
