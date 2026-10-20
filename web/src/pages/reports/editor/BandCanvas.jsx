import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { moveTo, resizeBy, nudge, toMm } from '../../../lib/reportBands.js';
import { Band } from '../ReportBlocks.jsx';

/**
 * Toile du concepteur d'en-tête (lot 7a C8, retour 88) : le haut (en-tête) ou le bas (pied) d'une
 * feuille, à l'échelle, marges hachurées, zone de la bande sur une grille de 2 mm. La bande est
 * rendue par le MÊME composant que l'aperçu et l'impression (Band) ; par-dessus, un calque de
 * cadres manipulables :
 *  - glisser (pointer events + capture) aimanté sur la grille (1 mm) et sur les bords / centres des
 *    autres éléments et de la bande (repères bleus) ; Alt pendant le glisser : sans aimant ;
 *  - 8 poignées de redimensionnement ;
 *  - clavier : Tab pour passer d'un élément à l'autre, flèches 1 mm (Maj : 5 mm), Alt + flèches
 *    pour la taille, Suppr pour retirer, Échap pour désélectionner.
 */
const PX_MM = 96 / 25.4;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CONTEXT_MM = 16; // hauteur de corps de page montrée sous l'en-tête / au-dessus du pied

const KIND_LABEL = { text: 'Texte', image: 'Logo', rect: 'Forme', line: 'Trait', pageNumber: 'N° de page' };
export const elementLabel = (e, tr) => {
  if (e.kind === 'text') return (e.text || '').trim() || tr('Texte');
  if (e.kind === 'rect' && e.bleed) return tr('Bandeau bord à bord');
  if (e.kind === 'line' && e.dir === 'v') return tr('Trait vertical');
  return tr(KIND_LABEL[e.kind] || e.kind);
};

export default function BandCanvas({ band, place, geometry, vars, pageNo = 1, selected, onSelect, onChange, onRemove, snapOn = true }) {
  const { tr } = useI18n();
  const wrap = useRef(null);
  const [avail, setAvail] = useState(0);
  const [guides, setGuides] = useState({ v: [], h: [] });
  const drag = useRef(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w, margins: m, bodyW } = geometry;
  const bandH = Number(band.height) || 0;
  const H = place === 'header' ? m.top + bandH + CONTEXT_MM : CONTEXT_MM + bandH + m.bottom;
  const bandTop = place === 'header' ? m.top : CONTEXT_MM;
  const k = avail > 0 ? Math.min(1.5, (avail - 2) / (w * PX_MM)) : 1;
  const elements = band.elements || [];

  const start = (ev, el, handle = null) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    onSelect(el.id);
    drag.current = { id: el.id, handle, start: el, sx: ev.clientX, sy: ev.clientY, x0: toMm(el.x, bodyW), y0: el.y, moved: false };
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* sans incidence */ }
  };
  const move = (ev) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 2) return;
    d.moved = true;
    const dx = (ev.clientX - d.sx) / (k * PX_MM);
    const dy = (ev.clientY - d.sy) / (k * PX_MM);
    const free = !snapOn || ev.altKey;
    if (d.handle) {
      onChange(resizeBy(d.start, d.handle, dx, dy, { bodyW, bandH, grid: free ? 0 : 1 }));
      setGuides({ v: [], h: [] });
    } else {
      const r = moveTo(d.start, d.x0 + dx, d.y0 + dy, { others: elements.filter((o) => o.id !== d.id), bodyW, bandH, grid: free ? 0 : 1, tol: free ? 0 : 1.2 });
      onChange(r.element);
      setGuides(r.guides);
    }
  };
  const end = () => { drag.current = null; setGuides({ v: [], h: [] }); };
  const onKey = (ev, el) => {
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); onRemove(el.id); return; }
    if (ev.key === 'Escape') { ev.stopPropagation(); onSelect(null); return; }
    const next = nudge(el, ev.key, { shift: ev.shiftKey, alt: ev.altKey }, { bodyW, bandH });
    if (next) { ev.preventDefault(); onChange(next); }
  };

  return (
    <div className="hd-canvas" ref={wrap} onPointerDown={() => onSelect(null)}>
      <div className="hd-slot" style={{ width: `${w * k}mm`, height: `${H * k}mm` }}>
        <div className={`hd-sheet rd-paper is-${place}`} style={{ width: `${w}mm`, height: `${H}mm`, transform: `scale(${k})`, '--hd-k': k }}>
          {/* Marges (hachurées) et corps de page (lignes grises) : le contexte de la bande. */}
          <div className="hd-margin" style={{ left: 0, top: 0, bottom: 0, width: `${m.left}mm` }} />
          <div className="hd-margin" style={{ right: 0, top: 0, bottom: 0, width: `${m.right}mm` }} />
          {place === 'header'
            ? <div className="hd-margin" style={{ left: `${m.left}mm`, right: `${m.right}mm`, top: 0, height: `${m.top}mm` }} />
            : <div className="hd-margin" style={{ left: `${m.left}mm`, right: `${m.right}mm`, bottom: 0, height: `${m.bottom}mm` }} />}
          <div className="hd-body-ghost" style={{ left: `${m.left}mm`, width: `${bodyW}mm`, top: place === 'header' ? `${m.top + bandH + 4}mm` : '2mm', height: `${CONTEXT_MM - 6}mm` }} aria-hidden="true">
            <i /><i /><i />
          </div>
          <div className="hd-band" style={{ left: `${m.left}mm`, top: `${bandTop}mm`, width: `${bodyW}mm`, height: `${Math.max(bandH, 0.5)}mm` }}>
            <div className={`hd-grid ${snapOn ? '' : 'is-off'}`} aria-hidden="true" />
            <Band band={band} vars={vars} pageNo={pageNo} pages={3} edges={m} place={place} editing />
            {/* Calque des cadres manipulables (mêmes positions que la bande rendue). */}
            <div className="hd-boxes">
              {elements.map((el) => {
                const isSel = selected === el.id;
                return (
                  <div key={el.id} className={`hd-box ${isSel ? 'is-selected' : ''} hd-box-${el.kind}`} tabIndex={0} role="button"
                    aria-label={`${elementLabel(el, tr)} — ${tr('déplacer avec les flèches')}`} aria-pressed={isSel}
                    style={{ left: `${el.x}%`, top: `${el.y}mm`, width: `${el.w}%`, height: `${el.h}mm` }}
                    onPointerDown={(ev) => start(ev, el)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                    onFocus={() => onSelect(el.id)} onKeyDown={(ev) => onKey(ev, el)}>
                    {isSel && HANDLES.map((h) => (
                      <span key={h} className={`hd-handle hd-h-${h}`} aria-hidden="true"
                        onPointerDown={(ev) => start(ev, el, h)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
                    ))}
                  </div>
                );
              })}
              {guides.v.map((x) => <div key={`v${x}`} className="hd-guide is-v" style={{ left: `${(x / bodyW) * 100}%` }} />)}
              {guides.h.map((y) => <div key={`h${y}`} className="hd-guide is-h" style={{ top: `${y}mm` }} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
