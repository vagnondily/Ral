import React, { useEffect, useMemo, useState } from 'react';
import {
  Type, Image as ImageIcon, Square, Minus, Hash, RectangleHorizontal, Undo2, Redo2, Check, Grid3x3, Save, X,
  RectangleVertical, MonitorPlay, MousePointerClick, ChevronUp, ChevronDown,
} from 'lucide-react';
import Modal from '../../../components/Modal.jsx';
import { Button } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useI18n } from '../../../lib/i18n.jsx';
import { api } from '../../../api/client.js';
import { pageGeometry } from '../../../lib/reportPaginate.js';
import { BAND_TEMPLATES, applyTemplate, newElement, nextElementId, reorder, setBandHeight, clampElement } from '../../../lib/reportBands.js';
import { Band } from '../ReportBlocks.jsx';
import { useAssetList } from '../useAssets.js';
import { useHistory } from './useHistory.js';
import BandCanvas, { elementLabel } from './BandCanvas.jsx';
import BandElementProps from './BandElementProps.jsx';
import './headerDesigner.css';

/**
 * CONCEPTEUR D'EN-TÊTE ET DE PIED DE PAGE (lot 7a C8, retours 51 et 88) — une zone libre :
 *  - galerie de modèles prédéfinis sobres (un clic applique, tout reste modifiable) et « mes
 *    en-têtes » enregistrés par le compte (réutilisables dans tout rapport) ;
 *  - éléments ajoutés depuis la palette (texte avec {variables}, logo téléversé, bandeau bord à
 *    bord, forme, trait, n° de page), placés sur une grille, déplacés et redimensionnés à la souris
 *    ou au clavier, réglés un par un (police, taille, couleur, alignement, fond) ;
 *  - en-tête et pied de la 1re page différents (option), ou propres à une page (section) ;
 *  - aperçu Portrait / Paysage / 16:9 : x et largeur en % de la largeur imprimable, l'en-tête suit
 *    l'orientation de chaque page.
 * Le rendu est celui de l'aperçu, de l'impression et des exports (composant Band). Rien n'est
 * modifié avant « Appliquer » (annulable ensuite par Ctrl+Z dans l'éditeur).
 * @param {{ initial: { header, footer, firstPage?, firstHeader?, firstFooter? }, scope: 'doc'|'section',
 *   page: object, orientation?: string, size?: string, vars: object, startZone?: string,
 *   canSave?: boolean, onApply: (value) => void, onClose: () => void }} props
 */
const ZONES = {
  header: 'En-tête', footer: 'Pied de page', firstHeader: 'En-tête de la 1re page', firstFooter: 'Pied de la 1re page',
};
const ADD = [
  ['text', 'Texte', Type], ['image', 'Logo', ImageIcon], ['band', 'Bandeau', RectangleHorizontal],
  ['rect', 'Forme', Square], ['line', 'Trait', Minus], ['pageNumber', 'N° page', Hash],
];
const KIND_ICON = { text: Type, image: ImageIcon, rect: Square, line: Minus, pageNumber: Hash };
const MAX_ELEMENTS = 20;
const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
const THUMB_PAGE = { size: 'A4', orientation: 'portrait', margins: { top: 12, right: 14, bottom: 12, left: 14 } };

/** Vignette d'un modèle : le haut et le bas d'une page A4 avec l'en-tête et le pied RÉELS. */
export function TemplateThumb({ content, vars, label, tag = null, active, onPick, onDelete, deleteLabel }) {
  const g = pageGeometry(THUMB_PAGE, {});
  const H = 92; // mm montrés (page coupée)
  const hb = content.header && content.header.elements && content.header.elements.length ? content.header : null;
  const fb = content.footer && content.footer.elements && content.footer.elements.length ? content.footer : null;
  const hH = hb ? hb.height : 0;
  const fH = fb ? fb.height : 0;
  return (
    <div className={`hd-tpl ${active ? 'is-on' : ''}`}>
      <button type="button" className="hd-tpl-btn" onClick={onPick} aria-label={label} title={label}>
        <span className="hd-tpl-slot">
          <span className="hd-tpl-sheet rd-paper" style={{ width: `${g.w}mm`, height: `${H}mm` }}>
            {hb && <span className="hd-tpl-band" style={{ top: `${g.margins.top}mm`, left: `${g.margins.left}mm`, width: `${g.bodyW}mm` }}><Band band={hb} vars={vars} pageNo={1} pages={3} edges={g.margins} place="header" /></span>}
            <span className="hd-tpl-ghost" style={{ top: `${g.margins.top + hH + 6}mm`, left: `${g.margins.left}mm`, width: `${g.bodyW}mm`, height: `${Math.max(8, H - g.margins.top - hH - fH - g.margins.bottom - 12)}mm` }}><i /><i /><i /><i /></span>
            {fb && <span className="hd-tpl-band" style={{ bottom: `${g.margins.bottom}mm`, left: `${g.margins.left}mm`, width: `${g.bodyW}mm` }}><Band band={fb} vars={vars} pageNo={1} pages={3} edges={g.margins} place="footer" /></span>}
          </span>
        </span>
        <span className="hd-tpl-name">{tag && <i className="hd-tpl-tag">{tag}</i>}{label}</span>
      </button>
      {onDelete && <button type="button" className="hd-tpl-del" onClick={onDelete} aria-label={deleteLabel} title={deleteLabel}><X size={12} aria-hidden="true" /></button>}
    </div>
  );
}

export default function HeaderDesigner({
  initial, scope = 'doc', zones: onlyZones = null, page, orientation = 'portrait', size = 'A4', vars, startZone = 'header', canSave = true, onApply, onClose,
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const hist = useHistory(clone(initial));
  const draft = hist.value;
  const [zone, setZone] = useState(startZone);
  const [sel, setSel] = useState(null);
  const [orient, setOrient] = useState(size === '16:9' ? 'landscape' : orientation);
  const [fmt, setFmt] = useState(size);
  const [snapOn, setSnapOn] = useState(true);
  const [saved, setSaved] = useState(null);
  const [saveName, setSaveName] = useState('');
  const [picked, setPicked] = useState(null);
  const assets = useAssetList();
  useEffect(() => { api.reportBandTemplates().then((r) => setSaved(r || [])).catch(() => setSaved([])); }, []);

  const zones = onlyZones || (scope === 'doc' && draft.firstPage === 'own' ? ['header', 'footer', 'firstHeader', 'firstFooter'] : ['header', 'footer']);
  const z = zones.includes(zone) ? zone : 'header';
  const band = draft[z] || { height: 0, elements: [] };
  const place = z === 'header' || z === 'firstHeader' ? 'header' : 'footer';
  const geom = pageGeometry({ ...page, size: fmt, orientation: orient }, {});
  const bodyW = geom.bodyW;
  const bandH = Number(band.height) || 0;
  const elements = band.elements || [];
  const selEl = elements.find((e) => e.id === sel) || null;
  const logos = assets.list || [];
  const sampleVars = useMemo(() => ({ ...vars, section: vars.section || tr('Section') }), [vars, tr]);

  const setBand = (fn) => hist.set((d) => ({ ...d, [z]: fn(d[z] || { height: 0, elements: [] }) }));
  const updateEl = (next) => setBand((b) => ({ ...b, elements: b.elements.map((e) => (e.id === next.id ? next : e)) }));
  const removeEl = (id) => { setBand((b) => ({ ...b, elements: b.elements.filter((e) => e.id !== id) })); setSel(null); };
  const add = (kind) => {
    if (elements.length >= MAX_ELEMENTS) { toast.error(tr('{n} éléments au plus par bande.', { n: MAX_ELEMENTS })); return; }
    const h = bandH < 8 ? (place === 'header' ? 16 : 10) : bandH;
    const el = newElement(kind, { elements, bodyW, bandH: h, assetId: kind === 'image' && logos[0] ? logos[0].id : null, text: tr('Texte') });
    setBand((b) => ({ height: h, elements: [...((h !== bandH ? setBandHeight(b, h, { bodyW }) : b).elements || []), el] }));
    setSel(el.id);
  };
  const duplicate = () => {
    if (!selEl || elements.length >= MAX_ELEMENTS) return;
    const id = nextElementId(selEl.kind, elements);
    const copy = clampElement({ ...clone(selEl), id, y: selEl.y + 2, x: selEl.x + 2 }, { bandH, bodyW });
    setBand((b) => ({ ...b, elements: [...b.elements, copy] }));
    setSel(id);
  };
  const applyContent = (content, key) => {
    hist.set((d) => ({ ...d, header: clone(content.header), footer: clone(content.footer) }));
    setZone('header'); setSel(null); setPicked(key);
  };
  const firstToggle = (on) => hist.set((d) => (on
    ? { ...d, firstPage: 'own', firstHeader: clone(d.firstHeader || d.header), firstFooter: clone(d.firstFooter || d.footer) }
    : { ...d, firstPage: d.firstPage === 'own' ? 'same' : d.firstPage }));
  const saveMine = async () => {
    const name = saveName.trim();
    if (!name) return;
    try {
      const row = await api.reportSaveBandTemplate({ name, header: draft.header || { height: 0, elements: [] }, footer: draft.footer || { height: 0, elements: [] } });
      setSaved((l) => [...(l || []), row].sort((a, b) => a.name.localeCompare(b.name)));
      setSaveName('');
      toast.success(tr('En-tête enregistré dans « Mes en-têtes ».'));
    } catch (e) { toast.error(e.message); }
  };
  const deleteMine = async (row) => {
    if (!window.confirm(tr('Supprimer l\'en-tête enregistré « {name} » ? Les rapports qui l\'utilisent gardent leur copie.', { name: row.name }))) return;
    try { await api.reportDeleteBandTemplate(row.id); setSaved((l) => (l || []).filter((x) => x.id !== row.id)); } catch (e) { toast.error(e.message); }
  };
  const onKeys = (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || typing) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); hist.undo(); }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); hist.redo(); }
  };
  const logo1 = logos[0] ? logos[0].id : null;
  const logo2 = logos[1] ? logos[1].id : null;
  const systemTemplates = useMemo(() => BAND_TEMPLATES.map((t) => ({ key: t.key, name: t.name, content: applyTemplate(t.key, { logo1, logo2, tr }) })), [logo1, logo2, tr]);

  return (
    <Modal open size="editor" onClose={onClose}
      title={tr(scope === 'doc' ? 'En-tête et pied de page' : 'En-tête et pied de cette page')}
      subtitle={tr('Choisissez un modèle ou composez librement : glissez les éléments sur la grille, réglez-les un par un.')}
      footer={(
        <>
          <span className="hd-foot-hint"><MousePointerClick size={13} aria-hidden="true" /> {tr('Glisser : déplacer · poignées : taille · flèches : 1 mm (Maj : 5 mm) · Alt + flèches : taille · Alt en glissant : sans aimant')}</span>
          <Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button>
          <Button icon={Check} onClick={() => onApply(draft)}>{tr('Appliquer')}</Button>
        </>
      )}>
      <div className="hd-root" onKeyDown={onKeys}>
        <section className="hd-templates" aria-label={tr('Modèles')}>
          <div className="hd-templates-h">
            <h3>{tr('Modèles')}</h3>
            <span className="hd-templates-sub">{tr('Un clic applique l\'en-tête et le pied ; tout reste modifiable.')}</span>
            {canSave && (
              <div className="hd-save">
                <input className="input" value={saveName} maxLength={120} placeholder={tr('Nom de cet en-tête…')} aria-label={tr('Nom de cet en-tête')}
                  onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveMine(); }} />
                <Button size="sm" variant="secondary" icon={Save} disabled={!saveName.trim()} onClick={saveMine}>{tr('Enregistrer dans mes en-têtes')}</Button>
              </div>
            )}
          </div>
          {/* « Mes en-têtes » d'abord (ceux de l'équipe), puis les modèles prédéfinis. */}
          <div className="hd-tpl-strip">
            {(saved || []).map((row) => (
              <TemplateThumb key={row.id} content={row.content} vars={sampleVars} label={row.name} tag={tr('Mes en-têtes')} active={picked === row.id}
                onPick={() => applyContent(row.content, row.id)} onDelete={canSave ? () => deleteMine(row) : null} deleteLabel={tr('Supprimer cet en-tête enregistré')} />
            ))}
            {(saved || []).length > 0 && <span className="hd-tpl-sep" aria-hidden="true" />}
            {systemTemplates.map((t) => (
              <TemplateThumb key={t.key} content={t.content} vars={sampleVars} label={tr(t.name)} active={picked === t.key} onPick={() => applyContent(t.content, t.key)} />
            ))}
          </div>
        </section>

        <div className="hd-main">
          <aside className="hd-left">
            <div className="hd-group">
              <span className="hd-label">{tr('Zone')}</span>
              <div className="hd-zones" role="tablist">
                {zones.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={z === k} className={z === k ? 'is-on' : ''} onClick={() => { setZone(k); setSel(null); }}>{tr(ZONES[k])}</button>
                ))}
              </div>
              {scope === 'doc' && (
                <label className="check hd-check"><input type="checkbox" checked={draft.firstPage === 'own'} onChange={(e) => firstToggle(e.target.checked)} />
                  <span>{tr('1re page différente')}</span></label>
              )}
              <label className="hd-num hd-height">
                <span className="hd-label">{tr('Hauteur de la bande')}</span>
                <span className="hd-num-in">
                  <input className="input" type="number" min={0} max={60} step={1} value={bandH}
                    onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setBand((b) => setBandHeight(b, v, { bodyW })); }} />
                  <i>mm</i>
                </span>
              </label>
            </div>
            <div className="hd-group">
              <span className="hd-label">{tr('Ajouter')}</span>
              <div className="hd-add">
                {ADD.map(([k, l, I]) => (
                  <button key={k} type="button" onClick={() => add(k)} disabled={elements.length >= MAX_ELEMENTS}><I size={15} aria-hidden="true" /><span>{tr(l)}</span></button>
                ))}
              </div>
            </div>
            <div className="hd-group">
              <span className="hd-label">{tr('Calques')} <i className="hd-count">{elements.length}</i></span>
              {elements.length === 0 && <p className="hd-hint">{tr('Bande vide : choisissez un modèle ou ajoutez un élément.')}</p>}
              <ol className="hd-layers">
                {[...elements].reverse().map((e) => {
                  const I = KIND_ICON[e.kind] || Square;
                  return (
                    <li key={e.id} className={sel === e.id ? 'is-on' : ''}>
                      <button type="button" className="hd-layer" onClick={() => setSel(e.id)}><I size={13} aria-hidden="true" /><span>{elementLabel(e, tr)}</span></button>
                      <button type="button" className="hd-layer-o" aria-label={tr('Monter')} title={tr('Monter')} onClick={() => setBand((b) => ({ ...b, elements: reorder(b.elements, e.id, 'up') }))}><ChevronUp size={13} aria-hidden="true" /></button>
                      <button type="button" className="hd-layer-o" aria-label={tr('Descendre')} title={tr('Descendre')} onClick={() => setBand((b) => ({ ...b, elements: reorder(b.elements, e.id, 'down') }))}><ChevronDown size={13} aria-hidden="true" /></button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </aside>

          <div className="hd-stage">
            <div className="hd-stagebar">
              <div className="hd-seg" role="radiogroup" aria-label={tr('Aperçu')}>
                {[['portrait', 'A4', 'Portrait', RectangleVertical], ['landscape', 'A4', 'Paysage', RectangleHorizontal], ['landscape', '16:9', '16:9', MonitorPlay]].map(([o, f, l, I]) => {
                  const on = orient === o && fmt === f;
                  return <button key={l} type="button" role="radio" aria-checked={on} className={on ? 'is-on' : ''} onClick={() => { setOrient(o); setFmt(f); }}><I size={14} aria-hidden="true" /> {tr(l)}</button>;
                })}
              </div>
              <span className="hd-stage-info">{tr('Largeur imprimable : {w} mm', { w: Math.round(bodyW) })}</span>
              <span className="mmr-spacer" />
              <button type="button" className={`hd-tool ${snapOn ? 'is-on' : ''}`} aria-pressed={snapOn} onClick={() => setSnapOn((x) => !x)} title={tr('Grille et aimantation')}><Grid3x3 size={15} aria-hidden="true" /> {tr('Grille')}</button>
              <button type="button" className="hd-tool" onClick={hist.undo} disabled={!hist.canUndo} aria-label={tr('Annuler (Ctrl+Z)')} title={tr('Annuler (Ctrl+Z)')}><Undo2 size={15} aria-hidden="true" /></button>
              <button type="button" className="hd-tool" onClick={hist.redo} disabled={!hist.canRedo} aria-label={tr('Rétablir (Ctrl+Y)')} title={tr('Rétablir (Ctrl+Y)')}><Redo2 size={15} aria-hidden="true" /></button>
            </div>
            <BandCanvas band={band} place={place} geometry={geom} vars={sampleVars} selected={sel} onSelect={setSel} onChange={updateEl} onRemove={removeEl} snapOn={snapOn} />
            <p className="hd-stage-note">{tr('Le cadre pointillé est la bande ; les zones hachurées sont les marges de la page. Un bandeau « bord à bord » les recouvre jusqu\'au bord de la feuille.')}</p>
          </div>

          <aside className="hd-right" aria-label={tr('Propriétés de l\'élément')}>
            {selEl ? (
              <>
                <h3 className="hd-right-h">{elementLabel(selEl, tr)}</h3>
                <BandElementProps el={selEl} bodyW={bodyW} bandH={bandH} assets={assets} onChange={updateEl} onRemove={() => removeEl(selEl.id)}
                  onDuplicate={duplicate} onOrder={(w) => setBand((b) => ({ ...b, elements: reorder(b.elements, selEl.id, w) }))} />
              </>
            ) : (
              <div className="hd-empty">
                <MousePointerClick size={20} aria-hidden="true" />
                <p>{tr('Cliquez sur un élément de la bande pour le régler : texte, police, taille, couleur, alignement, fond, logo.')}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  );
}
