import React, { useEffect, useRef, useState } from 'react';
import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { pageName } from '../../../lib/reportPaginate.js';
import { Band } from '../ReportBlocks.jsx';

/**
 * Aperçu PAGINÉ (lot 7a, C7) : feuilles de taille fixe (A4 portrait / paysage, 16:9) découpées par
 * la pagination, chacune avec ses marges, son en-tête et son pied (numéros « Page n / N » exacts),
 * un séparateur de section avec son orientation (« Section 2 · A4 paysage · 1 page »). Zoom
 * ajusté / 75 % / 100 % / 125 % ; sur téléphone, la page est mise à l'échelle comme un PDF,
 * jamais recomposée. Le zoom est une TRANSFORMATION (la mise en page reste celle de l'échelle 1,
 * identique au calque de mesure : un zoom CSS recompose le texte et fausse la pagination). Ces MÊMES
 * feuilles sont imprimées (pages nommées @page a4p / a4l / s169l…) : l'aperçu est le PDF.
 */
const ZOOMS = [['fit', 'Ajusté'], [0.75, '75 %'], [1, '100 %'], [1.25, '125 %']];
const ZOOM_KEY = 'mems.rd.zoom';
const readZoom = () => { try { const z = localStorage.getItem(ZOOM_KEY); return z === 'fit' || !z ? 'fit' : Number(z) || 'fit'; } catch { return 'fit'; } };
const writeZoom = (z) => { try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* stockage indisponible */ } };

export default function PagedPreview({
  pages, geometryOf, sectionOf, renderPageItem, page, vars, pxPerMm, forceFit, printing, watermark,
  selectedSection, onSelectSection, emptyNote, sheetsRef, selectedPage, onSelectPage,
}) {
  const { tr } = useI18n();
  const wrap = useRef(null);
  const [zoomPref, setZoomPref] = useState(readZoom);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const widest = Math.max(...pages.map((p) => geometryOf(p).w), 210);
  const fit = avail > 0 ? Math.min(1.25, Math.max(0.2, (avail - 24) / (widest * pxPerMm))) : 1;
  const pref = forceFit ? 'fit' : zoomPref;
  const zoom = printing ? 1 : pref === 'fit' ? fit : pref;
  const counts = {};
  for (const p of pages) counts[p.sectionId] = (counts[p.sectionId] || 0) + 1;

  return (
    <div className="rd-paged" ref={wrap}>
      {!forceFit && (
        <div className="rd-zoombar" role="toolbar" aria-label={tr('Zoom de l\'aperçu')} onClick={(e) => e.stopPropagation()}>
          <span className="rd-zoom-n">{tr('{n} page(s)', { n: pages.length })}</span>
          <div className="rd-seg">
            {ZOOMS.map(([z, l]) => (
              <button key={String(z)} type="button" className={pref === z ? 'is-active' : ''} aria-pressed={pref === z}
                onClick={() => { setZoomPref(z); writeZoom(z); }}>{tr(l)}</button>
            ))}
          </div>
        </div>
      )}
      <div className="rd-sheets" ref={sheetsRef}>
        {pages.map((pg, i) => {
          const g = geometryOf(pg);
          const sec = sectionOf(pg.sectionId) || {};
          const startsSection = i === 0 ? pg.sectionId !== '_doc' : pages[i - 1].sectionId !== pg.sectionId;
          const first = pg.n === 1;
          const own = first && page.firstPage === 'own';
          const noBands = first && page.firstPage === 'none';
          const headerBand = noBands || sec.header === 'none' ? null : own ? page.firstHeader : page.header;
          const footerBand = noBands || sec.footer === 'none' ? null : own ? page.firstFooter : page.footer;
          const sv = { ...vars, section: sec.title || '' };
          const isSel = selectedSection && selectedSection === pg.sectionId;
          return (
            <React.Fragment key={pg.n}>
              {startsSection && (
                <button type="button" className={`rd-sheet-chip ${isSel ? 'is-selected' : ''}`} onClick={(e) => { e.stopPropagation(); onSelectSection(pg.sectionId); }}>
                  {g.orientation === 'landscape' ? <RectangleHorizontal size={13} aria-hidden="true" /> : <RectangleVertical size={13} aria-hidden="true" />}
                  {tr('Section')} · {g.size} {tr(g.orientation === 'landscape' ? 'paysage' : 'portrait')} · {tr('{n} page(s)', { n: counts[pg.sectionId] })}{sec.title ? ` · ${sec.title}` : ''}
                </button>
              )}
              <div className="rd-sheet-slot" style={{ width: `${g.w * zoom}mm`, height: `${g.h * zoom}mm` }}>
              <div id={`rd-sheet-${pg.n}`} className={`rd-sheet rd-paper pg-${pageName(g.size, g.orientation)} ${selectedPage === pg.n ? 'is-page-selected' : ''}`} data-page={pg.n}
                style={{ width: `${g.w}mm`, height: `${g.h}mm`, transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
                onClick={onSelectPage ? (e) => { e.stopPropagation(); onSelectPage(pg.n); } : undefined}>
                {watermark && <div className="rd-watermark" aria-hidden="true"><span>{watermark}</span></div>}
                {headerBand && (
                  <div className="rd-sheet-h" style={{ top: `${g.margins.top}mm`, left: `${g.margins.left}mm`, right: `${g.margins.right}mm` }}>
                    <Band band={headerBand} vars={sv} texts={own ? sec.firstHeaderText : sec.headerText} pageNo={pg.n} pages={pages.length} />
                  </div>
                )}
                <div className="rd-sheet-body" style={{ top: `${g.margins.top + g.headerH}mm`, left: `${g.margins.left}mm`, width: `${g.bodyW}mm`, height: `${g.bodyH}mm` }}>
                  {pg.items.map((it) => renderPageItem(it, pg))}
                  {!pg.items.length && emptyNote}
                </div>
                {footerBand && (
                  <div className="rd-sheet-f" style={{ bottom: `${g.margins.bottom}mm`, left: `${g.margins.left}mm`, right: `${g.margins.right}mm` }}>
                    <Band band={footerBand} vars={sv} texts={own ? sec.firstFooterText : sec.footerText} pageNo={pg.n} pages={pages.length} />
                  </div>
                )}
              </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
