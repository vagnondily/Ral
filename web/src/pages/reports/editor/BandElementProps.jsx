import React, { useEffect, useRef, useState } from 'react';
import {
  AlignLeft, AlignCenter, AlignRight, Bold, Italic, CaseUpper, Copy, Trash2, ArrowUpToLine, ArrowDownToLine, Upload, Ban,
} from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { BAND_COLORS, BAND_VARIABLES, clampElement, toMm, toPct } from '../../../lib/reportBands.js';
import { useAssetUrl } from '../useAssets.js';

/**
 * Propriétés de l'élément sélectionné dans le concepteur d'en-tête (lot 7a C8, retour 88) :
 * position et taille exactes en mm (accessibilité, saisie précise), texte et variables, police,
 * taille, gras, italique, petites capitales, alignement, couleurs (jetons du système + #RRGGBB),
 * fond, arrondi ; logo du compte (choisir ou téléverser) ; forme (fond, bordure, bandeau bord à
 * bord) ; trait (épaisseur, couleur, vertical) ; format du n° de page ; ordre et suppression.
 */
const FONTS = ['Inter', 'Arial', 'Georgia'];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Couleur : pastilles des jetons du système, code #RRGGBB, « aucune » si permis. */
export function ColorField({ label, value, onChange, allowNone = false }) {
  const { tr } = useI18n();
  const [hex, setHex] = useState(value || '');
  useEffect(() => { setHex(value || ''); }, [value]);
  return (
    <div className="hd-field">
      <span className="hd-label">{label}</span>
      <div className="hd-swatches" role="radiogroup" aria-label={label}>
        {allowNone && (
          <button type="button" role="radio" aria-checked={!value} className={`hd-swatch is-none ${!value ? 'is-on' : ''}`} title={tr('Aucune')} aria-label={tr('Aucune')} onClick={() => onChange(undefined)}>
            <Ban size={12} aria-hidden="true" />
          </button>
        )}
        {BAND_COLORS.map(([c, name]) => (
          <button key={c} type="button" role="radio" aria-checked={value === c} className={`hd-swatch ${value === c ? 'is-on' : ''}`} style={{ background: c }}
            title={tr(name)} aria-label={tr(name)} onClick={() => onChange(c)} />
        ))}
        <input className="input hd-hex" value={hex} maxLength={7} aria-label={tr('Code couleur #RRGGBB')} placeholder="#RRGGBB" aria-invalid={hex && !HEX.test(hex) ? true : undefined}
          onChange={(e) => { setHex(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase()); }} />
      </div>
    </div>
  );
}

/** Nombre borné, appliqué dès qu'il est valable (sinon rétabli à la sortie du champ). */
function Num({ label, value, min, max, step = 0.5, onCommit, suffix }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const valid = (t) => { const v = Number(String(t).replace(',', '.')); return String(t).trim() !== '' && Number.isFinite(v) && v >= min && v <= max ? v : null; };
  return (
    <label className="hd-num">
      <span className="hd-label">{label}</span>
      <span className="hd-num-in">
        <input className="input" type="number" min={min} max={max} step={step} value={text} aria-invalid={valid(text) == null || undefined}
          onChange={(e) => { setText(e.target.value); const v = valid(e.target.value); if (v != null && v !== value) onCommit(v); }}
          onBlur={() => { if (valid(text) == null) setText(String(value)); }} />
        {suffix && <i>{suffix}</i>}
      </span>
    </label>
  );
}

function Seg({ options, value, onChange, label }) {
  return (
    <div className="hd-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l, Icon]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} title={l} aria-label={l} onClick={() => onChange(v)}>
          {Icon ? <Icon size={14} aria-hidden="true" /> : l}
        </button>
      ))}
    </div>
  );
}

function LogoThumb({ asset, on, onPick }) {
  const url = useAssetUrl(asset.id);
  return (
    <button type="button" className={`hd-logo ${on ? 'is-on' : ''}`} onClick={onPick} title={asset.name || ''} aria-pressed={on}>
      <span className="hd-logo-img">{url ? <img src={url} alt="" /> : null}</span>
      <span className="hd-logo-meta">{asset.width} × {asset.height}</span>
    </button>
  );
}

/** Logo : ceux du compte, ou téléverser (PNG ou JPEG, 512 Ko au plus). */
function LogoPicker({ value, onChange, assets }) {
  const { tr } = useI18n();
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    try { const a = await assets.upload(file, tr); onChange(a.id); toast.success(tr('Logo téléversé.')); } catch (e) { toast.error(e.message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="hd-field">
      <span className="hd-label">{tr('Logo')}</span>
      <div className="hd-logos">
        {(assets.list || []).map((a) => <LogoThumb key={a.id} asset={a} on={value === a.id} onPick={() => onChange(a.id)} />)}
        <button type="button" className="hd-logo is-upload" onClick={() => input.current && input.current.click()} disabled={busy}>
          <Upload size={16} aria-hidden="true" /><span>{busy ? tr('Envoi…') : tr('Téléverser')}</span>
        </button>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => pick(e.target.files && e.target.files[0])} />
      <p className="hd-hint">{tr('PNG ou JPEG, 512 Ko au plus. Le logo garde ses proportions dans son cadre.')}</p>
      {value && <button type="button" className="hd-link" onClick={() => onChange(null)}>{tr('Retirer le logo (garder l\'emplacement)')}</button>}
    </div>
  );
}

export default function BandElementProps({ el, bodyW, bandH, assets, onChange, onRemove, onDuplicate, onOrder }) {
  const { tr } = useI18n();
  const set = (patch) => onChange(clampElement({ ...el, ...patch }, { bandH, bodyW }));
  const st = el.style || {};
  const setStyle = (patch) => onChange({ ...el, style: { ...st, ...patch } });
  const r1 = (v) => Math.round(v * 10) / 10;
  const insertVar = (v) => { if (v) set({ text: `${el.text || ''}${el.text ? ' ' : ''}{${v}}`.slice(0, 300) }); };
  const textStyle = (el.kind === 'text' || el.kind === 'pageNumber') && (
    <>
      <div className="hd-row">
        <label className="hd-field hd-grow"><span className="hd-label">{tr('Police')}</span>
          <select className="select" value={st.font || 'Inter'} onChange={(e) => setStyle({ font: e.target.value })}>{FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        </label>
        <Num label={tr('Taille')} value={st.size || 8} min={6} max={36} step={0.5} suffix="pt" onCommit={(v) => setStyle({ size: v })} />
      </div>
      <div className="hd-row">
        <div className="hd-seg" role="group" aria-label={tr('Style du texte')}>
          <button type="button" className={st.bold ? 'is-on' : ''} aria-pressed={!!st.bold} title={tr('Gras')} aria-label={tr('Gras')} onClick={() => setStyle({ bold: !st.bold })}><Bold size={14} aria-hidden="true" /></button>
          <button type="button" className={st.italic ? 'is-on' : ''} aria-pressed={!!st.italic} title={tr('Italique')} aria-label={tr('Italique')} onClick={() => setStyle({ italic: !st.italic })}><Italic size={14} aria-hidden="true" /></button>
          <button type="button" className={st.caps ? 'is-on' : ''} aria-pressed={!!st.caps} title={tr('Petites capitales')} aria-label={tr('Petites capitales')} onClick={() => setStyle({ caps: !st.caps })}><CaseUpper size={14} aria-hidden="true" /></button>
        </div>
        <Seg label={tr('Alignement')} value={st.align || 'left'} onChange={(v) => setStyle({ align: v })}
          options={[['left', tr('Aligner à gauche'), AlignLeft], ['center', tr('Centrer'), AlignCenter], ['right', tr('Aligner à droite'), AlignRight]]} />
      </div>
      <ColorField label={tr('Couleur du texte')} value={st.color || '#616a7a'} onChange={(c) => setStyle({ color: c || '#616a7a' })} />
      <ColorField label={tr('Fond')} value={st.background} allowNone onChange={(c) => setStyle({ background: c })} />
      {st.background && <Num label={tr('Arrondi du fond')} value={st.radius || 0} min={0} max={6} step={0.5} suffix="mm" onCommit={(v) => setStyle({ radius: v })} />}
    </>
  );
  return (
    <div className="hd-props">
      <div className="hd-props-actions">
        <button type="button" onClick={onDuplicate} title={tr('Dupliquer')} aria-label={tr('Dupliquer')}><Copy size={14} aria-hidden="true" /></button>
        <button type="button" onClick={() => onOrder('front')} title={tr('Premier plan')} aria-label={tr('Premier plan')}><ArrowUpToLine size={14} aria-hidden="true" /></button>
        <button type="button" onClick={() => onOrder('back')} title={tr('Arrière-plan')} aria-label={tr('Arrière-plan')}><ArrowDownToLine size={14} aria-hidden="true" /></button>
        <button type="button" className="is-danger" onClick={onRemove} title={tr('Supprimer (Suppr)')} aria-label={tr('Supprimer')}><Trash2 size={14} aria-hidden="true" /></button>
      </div>

      {el.kind === 'text' && (
        <div className="hd-field">
          <span className="hd-label">{tr('Texte')}</span>
          <input className="input" value={el.text || ''} maxLength={300} onChange={(e) => onChange({ ...el, text: e.target.value })} />
          <select className="select hd-var" value="" aria-label={tr('Insérer une variable')} onChange={(e) => insertVar(e.target.value)}>
            <option value="">{tr('Insérer une variable…')}</option>
            {BAND_VARIABLES.map((v) => <option key={v} value={v}>{`{${v}}`} — {tr(VAR_LABELS[v])}</option>)}
          </select>
        </div>
      )}
      {el.kind === 'pageNumber' && (
        <label className="hd-field"><span className="hd-label">{tr('Format')}</span>
          <select className="select" value={el.format || 'Page n / N'} onChange={(e) => onChange({ ...el, format: e.target.value })}>
            {[['Page n / N', tr('Page {n} / {N}', { n: 2, N: 5 })], ['n / N', '2 / 5'], ['Page n', tr('Page {n}', { n: 2 })], ['n', '2']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      )}
      {textStyle}
      {el.kind === 'image' && (
        <>
          <LogoPicker value={el.assetId || null} assets={assets} onChange={(id) => onChange({ ...el, assetId: id })} />
          <Seg label={tr('Alignement dans le cadre')} value={el.align || 'left'} onChange={(v) => onChange({ ...el, align: v })}
            options={[['left', tr('Aligner à gauche'), AlignLeft], ['center', tr('Centrer'), AlignCenter], ['right', tr('Aligner à droite'), AlignRight]]} />
        </>
      )}
      {el.kind === 'rect' && (
        <>
          <ColorField label={tr('Remplissage')} value={el.fill} onChange={(c) => onChange({ ...el, fill: c || '#eff6fc' })} />
          <ColorField label={tr('Bordure')} value={el.border} allowNone onChange={(c) => onChange({ ...el, border: c })} />
          <div className="hd-row">
            <Num label={tr('Arrondi')} value={el.radius || 0} min={0} max={6} step={0.5} suffix="mm" onCommit={(v) => onChange({ ...el, radius: v })} />
            <Num label={tr('Opacité')} value={Math.round((el.opacity ?? 1) * 100)} min={10} max={100} step={5} suffix="%" onCommit={(v) => onChange({ ...el, opacity: v / 100 })} />
          </div>
          <label className="check"><input type="checkbox" checked={!!el.bleed} onChange={(e) => onChange({ ...el, bleed: e.target.checked || undefined, ...(e.target.checked ? { x: 0, w: 100 } : {}) })} />
            <span>{tr('Bandeau bord à bord (jusqu\'aux bords de la feuille)')}</span></label>
        </>
      )}
      {el.kind === 'line' && (
        <>
          <ColorField label={tr('Couleur')} value={el.color} onChange={(c) => onChange({ ...el, color: c || '#e7e9ef' })} />
          <div className="hd-row">
            <Num label={tr('Épaisseur')} value={el.thickness || 0.5} min={0.25} max={3} step={0.25} suffix="pt" onCommit={(v) => onChange({ ...el, thickness: v })} />
            <Seg label={tr('Sens')} value={el.dir || 'h'} onChange={(v) => onChange(clampElement({ ...el, dir: v === 'v' ? 'v' : undefined, ...(v === 'v' ? { w: Math.min(el.w, 1), h: Math.max(el.h, Math.min(12, bandH)) } : { h: 2 }) }, { bandH, bodyW }))}
              options={[['h', tr('Horizontal')], ['v', tr('Vertical')]]} />
          </div>
        </>
      )}

      <fieldset className="hd-geom"><legend>{tr('Position et taille (mm)')}</legend>
        <Num label="X" value={r1(toMm(el.x, bodyW))} min={0} max={r1(bodyW)} step={0.5} onCommit={(v) => set({ x: toPct(v, bodyW) })} />
        <Num label="Y" value={r1(el.y)} min={0} max={Math.max(0, bandH)} step={0.5} onCommit={(v) => set({ y: v })} />
        <Num label={tr('L')} value={r1(toMm(el.w, bodyW))} min={1} max={r1(bodyW)} step={0.5} onCommit={(v) => set({ w: toPct(v, bodyW) })} />
        <Num label={tr('H')} value={r1(el.h)} min={2} max={Math.max(2, bandH)} step={0.5} onCommit={(v) => set({ h: v })} />
      </fieldset>
    </div>
  );
}

export const VAR_LABELS = {
  titre: 'Titre du rapport', periode: 'Période du rapport', bureau: 'Bureau (filtre du rapport ou section répétée)', date: 'Date d\'édition (jj/mm/aaaa)',
  page: 'Numéro de page', pages: 'Nombre de pages', section: 'Titre de la section',
};
