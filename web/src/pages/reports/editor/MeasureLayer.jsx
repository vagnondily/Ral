import React, { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Calque de MESURE de la pagination (lot 7a, C7) : chaque bloc est rendu une fois, invisible, à
 * la largeur imprimable de sa section, avec les mêmes styles que la page. On y lit :
 *  - la hauteur de chaque bloc ;
 *  - pour un tableau ou une liste : la hauteur de chaque ligne, de ce qui la précède (titre,
 *    en-tête) et la suit (source, note), et celle de l'en-tête répété en haut de page ;
 *  - pour un texte : la hauteur de chaque paragraphe ;
 *  - pour un tableau plus large que la page : le rapport largeur disponible ÷ largeur nécessaire.
 * La 1re mesure est faite avant l'affichage ; ensuite, une nouvelle mesure 150 ms après un
 * changement (données arrivées, texte modifié). Rien n'est envoyé si rien n'a changé.
 * Unités : px à l'échelle 1 (le calque n'est jamais zoomé) ; `pxPerMm` est lu sur une sonde de 100 mm.
 */
const DEBOUNCE = 150;
const r1 = (x) => Math.round(x * 10) / 10;

function readSplit(el, kind, box) {
  const sel = kind === 'rows' ? '.rb-table > tbody > tr' : kind === 'list' ? '.rb-list > li' : '.rt > *';
  const parts = [...el.querySelectorAll(sel)];
  if (parts.length < 2) return null;
  const rects = parts.map((x) => x.getBoundingClientRect());
  const heights = rects.map((r, i) => r1(i + 1 < rects.length ? rects[i + 1].top - r.top : r.height));
  const headH = r1(rects[0].top - box.top);
  const footH = r1(box.bottom - rects[rects.length - 1].bottom);
  let repeatH = headH;
  if (kind === 'rows' || kind === 'list') {
    const cap = el.querySelector('.rb-title');
    const thead = kind === 'rows' ? el.querySelector('.rb-table > thead') : null;
    repeatH = r1((cap ? cap.getBoundingClientRect().height + 8 : 0) + (thead ? thead.getBoundingClientRect().height : 0));
  }
  return { kind: kind === 'list' ? 'rows' : kind, headH, repeatH, footH, [kind === 'nodes' ? 'nodes' : 'rows']: heights };
}

export default function MeasureLayer({ sections, renderItem, splitOf, onMeasure, onPxPerMm }) {
  const ref = useRef(null);
  const probe = useRef(null);
  const last = useRef('');
  const timer = useRef(null);

  const measure = () => {
    const root = ref.current;
    if (!root) return;
    if (probe.current && onPxPerMm) onPxPerMm(probe.current.getBoundingClientRect().height / 100 || 96 / 25.4);
    const out = {};
    for (const el of root.querySelectorAll('[data-mid]')) {
      const box = el.getBoundingClientRect();
      const info = { h: r1(box.height) };
      const kind = el.getAttribute('data-split');
      if (kind) { const sp = readSplit(el, kind, box); if (sp) info.split = sp; }
      // Tableau plus large que la page : rapport largeur disponible ÷ largeur nécessaire (police à réduire).
      const wrap = el.querySelector('.rb-table-wrap');
      if (wrap && wrap.scrollWidth > wrap.clientWidth + 1) info.wide = Math.round((wrap.clientWidth / wrap.scrollWidth) * 1000) / 1000;
      out[el.getAttribute('data-mid')] = info;
    }
    const key = JSON.stringify(out);
    if (key !== last.current) { last.current = key; onMeasure(out); }
  };
  // 1re mesure avant l'affichage (la page s'affiche déjà paginée), puis après chaque rendu (anti-rebond).
  useLayoutEffect(() => { if (!last.current) measure(); });
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(measure, DEBOUNCE);
  });
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { clearTimeout(timer.current); timer.current = setTimeout(measure, DEBOUNCE); });
    ro.observe(root);
    // Polices chargées : les hauteurs changent.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { clearTimeout(timer.current); timer.current = setTimeout(measure, 0); });
    return () => { ro.disconnect(); clearTimeout(timer.current); };
  }, []);

  return (
    <div ref={ref} className="rd-measure rd-paper" aria-hidden="true">
      <div ref={probe} className="rd-measure-probe" />
      {sections.map((s) => (
        <div key={s.id} className="rd-measure-sec" style={{ width: `${s.bodyW}mm` }}>
          {s.items.map((inst) => (
            <div key={inst.iid} className="rd-mitem" data-mid={inst.iid} data-split={splitOf(inst) || undefined}>
              {renderItem(inst, { measure: true })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
