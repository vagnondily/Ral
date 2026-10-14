import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { Field } from '../../../components/ui.jsx';
import { pageGeometry } from '../../../lib/reportPaginate.js';
import { defaultPage, textElement, pageNumberElement } from '../reportDoc.js';

/**
 * Onglet « Page » (lot 7a, C7) : mise en page du DOCUMENT — format et orientation par défaut (une
 * section peut les changer), marges, première page (identique, sans en-tête ni pied, propre),
 * en-tête et pied (une ligne de texte avec {variables}, numéros de page), filigrane des exports
 * non validés. La zone utile qui en résulte est affichée (millimètres).
 */
const bandText = (band, id) => ((band && band.elements) || []).find((e) => e.id === id)?.text || '';
function setBandText(band, id, text, make) {
  const els = (band && band.elements) || [];
  const has = els.some((e) => e.id === id);
  const elements = text ? (has ? els.map((e) => (e.id === id ? { ...e, text } : e)) : [...els, make(text)]) : els.filter((e) => e.id !== id);
  return { height: (band && band.height) || 14, elements };
}
const MARGINS = [['top', 'Haut'], ['bottom', 'Bas'], ['left', 'Gauche'], ['right', 'Droite']];

/** Marge en mm (5 à 40) : saisie libre, appliquée dès qu'elle est valable, rétablie à la sortie sinon. */
function MarginInput({ value, onCommit }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const valid = (t) => { const v = Number(t); return t.trim() !== '' && Number.isFinite(v) && v >= 5 && v <= 40 ? v : null; };
  return (
    <input className="input" type="number" min="5" max="40" step="1" value={text} aria-invalid={valid(text) == null || undefined}
      onChange={(e) => { setText(e.target.value); const v = valid(e.target.value); if (v != null && v !== value) onCommit(v); }}
      onBlur={() => { if (valid(text) == null) setText(String(value)); }} />
  );
}

export default function PagePane({ doc, onChange }) {
  const { tr } = useI18n();
  const p = doc.page || defaultPage();
  const m = { top: 16, right: 14, bottom: 16, left: 14, ...(p.margins || {}) };
  const hasNumbers = ((p.footer && p.footer.elements) || []).some((e) => e.kind === 'pageNumber');
  const g = pageGeometry(p, {});
  const fmt = (x) => x.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 1 });
  return (
    <div className="section-gap">
      <h3>{tr('Mise en page')}</h3>
      <div className="rd-row2">
        <Field label={tr('Format')}>
          <select className="select" value={p.size || 'A4'} onChange={(e) => onChange({ size: e.target.value })}>
            <option value="A4">A4</option><option value="16:9">16:9</option>
          </select>
        </Field>
        <Field label={tr('Orientation')}>
          <select className="select" value={p.orientation || 'portrait'} onChange={(e) => onChange({ orientation: e.target.value })}>
            <option value="portrait">{tr('Portrait')}</option><option value="landscape">{tr('Paysage')}</option>
          </select>
        </Field>
      </div>
      <p className="hint">{tr('Une section du rapport peut changer d\'orientation (bloc « Section »).')}</p>
      <fieldset className="rd-checks rd-margins"><legend>{tr('Marges (mm)')}</legend>
        <div className="rd-row2">
          {MARGINS.map(([k, l]) => (
            <Field key={k} label={tr(l)}>
              <MarginInput value={m[k]} onCommit={(v) => onChange({ margins: { ...m, [k]: v } })} />
            </Field>
          ))}
        </div>
        <p className="hint">{tr('Zone utile : {w} × {h} mm.', { w: fmt(g.bodyW), h: fmt(g.bodyH) })}</p>
      </fieldset>
      <Field label={tr('Première page')}>
        <select className="select" value={p.firstPage || 'same'} onChange={(e) => onChange({ firstPage: e.target.value })}>
          <option value="same">{tr('Comme les autres pages')}</option>
          <option value="none">{tr('Sans en-tête ni pied (page de titre)')}</option>
          {p.firstPage === 'own' && <option value="own">{tr('En-tête et pied propres')}</option>}
        </select>
      </Field>
      <Field label={tr('En-tête')} hint={tr('{periode} est remplacé par la période.')}>
        <input className="input" value={bandText(p.header, 'h-text')} maxLength={300} onChange={(e) => onChange({ header: setBandText(p.header, 'h-text', e.target.value, (x) => textElement('h-text', x)) })} />
      </Field>
      <Field label={tr('Pied de page')}>
        <input className="input" value={bandText(p.footer, 'f-text')} maxLength={300} onChange={(e) => onChange({ footer: setBandText(p.footer, 'f-text', e.target.value, (x) => textElement('f-text', x, { w: 66 })) })} />
      </Field>
      <label className="check"><input type="checkbox" checked={hasNumbers} onChange={(e) => {
        const els = ((p.footer && p.footer.elements) || []).filter((x) => x.kind !== 'pageNumber');
        onChange({ footer: { height: (p.footer && p.footer.height) || 12, elements: e.target.checked ? [...els, pageNumberElement()] : els } });
      }} /> {tr('Numéros de page (Page n / N)')}</label>
      <label className="check"><input type="checkbox" checked={p.draftWatermark !== false} onChange={(e) => onChange({ draftWatermark: e.target.checked })} /> {tr('Filigrane « BROUILLON » tant que le rapport n\'est pas validé')}</label>
      <p className="hint">{tr('Cliquez sur un bloc de la page pour le modifier ; écrivez directement dans les blocs de texte.')}</p>
    </div>
  );
}
