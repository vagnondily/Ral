import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { Field } from '../../../components/ui.jsx';
import { pageGeometry } from '../../../lib/reportPaginate.js';
import { PenLine } from 'lucide-react';
import { Button } from '../../../components/ui.jsx';
import { defaultPage } from '../reportDoc.js';
import { TemplateThumb } from './HeaderDesigner.jsx';

/**
 * Onglet « Page » (lot 7a, C7–C8) : mise en page du DOCUMENT — format et orientation par défaut
 * (une page ou une section peut les changer), marges, en-tête et pied DESSINÉS (aperçu + concepteur
 * d'en-tête), première page (identique, sans en-tête ni pied, propre), annexes, filigrane des
 * exports non validés. La zone utile qui en résulte est affichée (millimètres).
 */
const MARGINS = [['top', 'Haut'], ['bottom', 'Bas'], ['left', 'Gauche'], ['right', 'Droite']];

/** Annexes du document (retour 88) : envoyer en annexe les tableaux de plus de N lignes (5 à 500). */
function AnnexesField({ value, onChange }) {
  const { tr } = useI18n();
  const n = value && value.autoRows != null ? value.autoRows : null;
  const [text, setText] = useState(String(n || 25));
  useEffect(() => { if (n != null) setText(String(n)); }, [n]);
  const valid = (t) => { const v = Number(t); return Number.isInteger(v) && v >= 5 && v <= 500 ? v : null; };
  return (
    <fieldset className="rd-checks rd-annexes"><legend>{tr('Annexes')}</legend>
      <label className="check"><input type="checkbox" checked={n != null} onChange={(e) => onChange(e.target.checked ? { autoRows: valid(text) || 25 } : undefined)} />
        <span>{tr('Envoyer automatiquement en annexe les tableaux de plus de')}</span></label>
      <div className="rd-inline">
        <input className="input rd-num" type="number" min="5" max="500" step="1" value={text} disabled={n == null} aria-label={tr('Nombre de lignes')} aria-invalid={valid(text) == null || undefined}
          onChange={(e) => { setText(e.target.value); const v = valid(e.target.value); if (v != null && n != null && v !== n) onChange({ autoRows: v }); }}
          onBlur={() => { if (valid(text) == null) setText(String(n || 25)); }} />
        <span>{tr('lignes')}</span>
      </div>
      <p className="hint">{tr('Chaque annexe commence sur une nouvelle page, à la fin du rapport (A, B, C…), et figure au sommaire. Un bloc peut aussi être placé en annexe depuis ses propriétés.')}</p>
    </fieldset>
  );
}

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

export default function PagePane({ doc, onChange, onAnnexes, extra }) {
  const { tr } = useI18n();
  const p = doc.page || defaultPage();
  const m = { top: 16, right: 14, bottom: 16, left: 14, ...(p.margins || {}) };
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
        <Field label={tr('Orientation par défaut')}>
          <select className="select" value={p.orientation || 'portrait'} onChange={(e) => onChange({ orientation: e.target.value })}>
            <option value="portrait">{tr('Portrait')}</option><option value="landscape">{tr('Paysage')}</option>
          </select>
        </Field>
      </div>
      <p className="hint">{tr('Toutes les pages sans réglage propre. Pour une seule page : onglet Pages, ou clic dans la marge de la page.')}</p>
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
      <div className="rd-bands-card">
        <span className="rd-field-l">{tr('En-tête et pied de page')}</span>
        {extra && extra.vars && <TemplateThumb content={{ header: p.header, footer: p.footer }} vars={extra.vars} label={tr('En-tête et pied de page du document')} onPick={extra.onDesignBands} />}
        {extra && extra.onDesignBands && <Button icon={PenLine} onClick={extra.onDesignBands}>{tr('Concevoir l\'en-tête et le pied de page')}</Button>}
        <p className="hint">{tr('Modèles prêts à l\'emploi, logos, textes avec variables, bandeaux et formes, placés librement. Double-cliquez sur l\'en-tête d\'une page pour l\'ouvrir aussi.')}</p>
      </div>
      <Field label={tr('Première page')}>
        <select className="select" value={p.firstPage || 'same'} onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'own' ? { firstPage: v, firstHeader: p.firstHeader || p.header, firstFooter: p.firstFooter || p.footer } : { firstPage: v });
        }}>
          <option value="same">{tr('Comme les autres pages')}</option>
          <option value="none">{tr('Sans en-tête ni pied (page de titre)')}</option>
          <option value="own">{tr('En-tête et pied propres')}</option>
        </select>
      </Field>
      <label className="check"><input type="checkbox" checked={p.draftWatermark !== false} onChange={(e) => onChange({ draftWatermark: e.target.checked })} /> {tr('Filigrane « BROUILLON » tant que le rapport n\'est pas validé')}</label>
      {onAnnexes && <AnnexesField value={doc.annexes} onChange={onAnnexes} />}
      <p className="hint">{tr('Cliquez sur un bloc de la page pour le modifier ; écrivez directement dans les blocs de texte.')}</p>
    </div>
  );
}
