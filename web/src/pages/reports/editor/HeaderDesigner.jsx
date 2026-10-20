import React, { useEffect, useMemo, useState } from 'react';
import {
  Type, Image as ImageIcon, Square, Minus, Hash, RectangleHorizontal, Undo2, Redo2, Check, Grid3x3, Save, X,
  RectangleVertical, MonitorPlay, MousePointerClick, ChevronUp, ChevronDown, Copy, FileText, Files, PenLine,
} from 'lucide-react';
import Modal from '../../../components/Modal.jsx';
import { Button } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useI18n } from '../../../lib/i18n.jsx';
import { api } from '../../../api/client.js';
import { pageGeometry } from '../../../lib/reportPaginate.js';
import {
  BAND_TEMPLATES, FIRST_PAGE_MODES, applyPair, applyTemplate, bandKey, clampElement, logosOf, newElement, nextElementId, pairBands, pairOf,
  reorder, setBandHeight, setFirstPageMode, zoneOf,
} from '../../../lib/reportBands.js';
import { Band } from '../ReportBlocks.jsx';
import { useAssetList } from '../useAssets.js';
import { useHistory } from './useHistory.js';
import BandCanvas, { elementLabel } from './BandCanvas.jsx';
import BandElementProps from './BandElementProps.jsx';
import './headerDesigner.css';

/**
 * CONCEPTEUR D'EN-TÊTE ET DE PIED DE PAGE (lot 7a C8, retours 51 et 88, retour du 15/10) :
 *  - une mise en page = une PAIRE : la PREMIÈRE PAGE et les PAGES SUIVANTES, chacune avec son
 *    en-tête et son pied ; la 1re page est « identique aux suivantes », « propre » ou « sans en-tête
 *    ni pied (page de titre) » ; l'aperçu montre les deux pages côte à côte, en direct, et sert
 *    d'aiguillage (un clic sur une page, ou sur son en-tête / son pied, l'ouvre dans la toile) ;
 *  - galerie de modèles : chacun s'applique à la PAIRE ; « mes en-têtes » enregistre la paire ;
 *  - éléments ajoutés depuis la palette (texte avec {variables}, logo, bandeau, forme, trait,
 *    n° de page), placés sur une grille, déplacés et redimensionnés à la souris ou au clavier ;
 *  - une page à en-tête PROPRE (section) n'a que ses deux bandes (pas de 1re page).
 * Le rendu est celui de l'aperçu, de l'impression et des exports (composant Band). Rien n'est
 * modifié avant « Appliquer » (annulable ensuite par Ctrl+Z dans l'éditeur).
 * @param {{ initial: { header, footer, firstPage?, firstHeader?, firstFooter? }, scope: 'doc'|'section',
 *   zones?: string[], page: object, orientation?: string, size?: string, vars: object,
 *   startZone?: 'header'|'footer'|'firstHeader'|'firstFooter', canSave?: boolean,
 *   onApply: (value) => void, onClose: () => void }} props
 */
const ADD = [
  ['text', 'Texte', Type], ['image', 'Logo', ImageIcon], ['band', 'Bandeau', RectangleHorizontal],
  ['rect', 'Forme', Square], ['line', 'Trait', Minus], ['pageNumber', 'N° page', Hash],
];
const KIND_ICON = { text: Type, image: ImageIcon, rect: Square, line: Minus, pageNumber: Hash };
const MAX_ELEMENTS = 20;
const PX_MM = 96 / 25.4;
const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
const FIRST_MODE_LABEL = {
  same: 'Identique aux pages suivantes', own: 'En-tête et pied propres', none: 'Sans en-tête ni pied (page de titre)',
};
const FIRST_MODE_SHORT = { same: 'identique aux suivantes', own: 'en-tête et pied propres', none: 'page de titre, sans en-tête ni pied' };
const THUMB_PAGE = { size: 'A4', orientation: 'portrait', margins: { top: 12, right: 14, bottom: 12, left: 14 } };

/**
 * Page en MINIATURE (coupée) : marges, en-tête et pied RÉELS (composant Band), corps évoqué par des
 * lignes grises. Sert à la galerie (paires) et à l'aperçu côte à côte du concepteur.
 * @param {{ bands: {header, footer}, geometry: object, widthPx: number, bodyMm?: number, onZone?: (zone) => void, activeZone?: string }} p
 */
export function MiniPage({ bands, vars, pageNo = 1, pages = 3, geometry, widthPx, bodyMm = 34, title = false, onZone, activeZone = null }) {
  const g = geometry;
  const hb = bands.header && bands.header.elements && bands.header.elements.length ? bands.header : null;
  const fb = bands.footer && bands.footer.elements && bands.footer.elements.length ? bands.footer : null;
  const hH = hb ? Number(hb.height) || 0 : 0;
  const fH = fb ? Number(fb.height) || 0 : 0;
  const H = g.margins.top + hH + bodyMm + fH + g.margins.bottom;
  const k = widthPx / (g.w * PX_MM);
  const zoneBtn = (zone, style) => (onZone ? (
    <button type="button" tabIndex={-1} aria-hidden="true" className={`hd-mini-hit ${activeZone === zone ? 'is-on' : ''}`} style={style}
      onClick={(e) => { e.stopPropagation(); onZone(zone); }} />
  ) : null);
  return (
    <span className="hd-mini" style={{ width: `${widthPx}px`, height: `${H * PX_MM * k}px` }}>
      <span className="hd-mini-sheet rd-paper" style={{ width: `${g.w}mm`, height: `${H}mm`, transform: `scale(${k})` }}>
        {hb && <span className="hd-mini-band" style={{ top: `${g.margins.top}mm`, left: `${g.margins.left}mm`, width: `${g.bodyW}mm` }}><Band band={hb} vars={vars} pageNo={pageNo} pages={pages} edges={g.margins} place="header" editing /></span>}
        <span className={`hd-mini-ghost ${title ? 'is-title' : ''}`} style={{ top: `${g.margins.top + hH + 5}mm`, left: `${g.margins.left}mm`, width: `${g.bodyW}mm`, height: `${Math.max(6, bodyMm - 10)}mm` }}><i /><i /><i /><i /><i /></span>
        {fb && <span className="hd-mini-band" style={{ bottom: `${g.margins.bottom}mm`, left: `${g.margins.left}mm`, width: `${g.bodyW}mm` }}><Band band={fb} vars={vars} pageNo={pageNo} pages={pages} edges={g.margins} place="footer" editing /></span>}
        {zoneBtn('header', { top: 0, left: 0, right: 0, height: `${g.margins.top + Math.max(hH, 8)}mm` })}
        {zoneBtn('footer', { bottom: 0, left: 0, right: 0, height: `${g.margins.bottom + Math.max(fH, 8)}mm` })}
      </span>
    </span>
  );
}

/** Vignette d'un modèle : la PAIRE (1re page, page suivante) avec l'en-tête et le pied réels. */
export function TemplateThumb({ content, vars, label, tag = null, active, onPick, onDelete, deleteLabel, single = false }) {
  const g = pageGeometry(THUMB_PAGE, {});
  const pair = pairBands(pairOf(content));
  return (
    <div className={`hd-tpl ${active ? 'is-on' : ''} ${single ? 'is-single' : ''}`}>
      <button type="button" className="hd-tpl-btn" onClick={onPick} aria-label={label} title={label}>
        <span className="hd-tpl-pair">
          {!single && <MiniPage bands={pair.first} vars={vars} pageNo={1} geometry={g} widthPx={70} bodyMm={58} title />}
          <MiniPage bands={pair.rest} vars={vars} pageNo={2} geometry={g} widthPx={70} bodyMm={58} />
        </span>
        {label && <span className="hd-tpl-name">{tag && <i className="hd-tpl-tag">{tag}</i>}{label}</span>}
      </button>
      {onDelete && <button type="button" className="hd-tpl-del" onClick={onDelete} aria-label={deleteLabel} title={deleteLabel}><X size={12} aria-hidden="true" /></button>}
    </div>
  );
}

/** Aperçu côte à côte (en direct) : 1re page et pages suivantes ; un clic choisit la page et la zone. */
function PairPreview({ draft, vars, geometry, pageKind, zone, onPick }) {
  const { tr } = useI18n();
  const pair = pairBands(draft);
  const cards = [
    { kind: 'first', label: 'Première page', sub: FIRST_MODE_SHORT[pair.firstPage], bands: pair.first, n: 1, Icon: FileText },
    { kind: 'rest', label: 'Pages suivantes', sub: 'page {n} et suivantes', bands: pair.rest, n: 2, Icon: Files },
  ];
  return (
    <div className="hd-pair" role="tablist" aria-label={tr('Première page et pages suivantes')}>
      {cards.map((c) => {
        const on = pageKind === c.kind;
        return (
          <div key={c.kind} className={`hd-pair-card ${on ? 'is-on' : ''}`}>
            <button type="button" role="tab" aria-selected={on} className="hd-pair-h" onClick={() => onPick(c.kind, null)}>
              <c.Icon size={15} aria-hidden="true" />
              <span className="hd-pair-t">{tr(c.label)}</span>
              <span className="hd-pair-s">{tr(c.sub, { n: 2 })}</span>
            </button>
            <div className="hd-pair-page" onClick={() => onPick(c.kind, null)} role="presentation">
              <MiniPage bands={c.bands} vars={vars} pageNo={c.n} pages={3} geometry={geometry} widthPx={252} bodyMm={30} title={c.kind === 'first'}
                activeZone={on ? zone : null} onZone={(z) => onPick(c.kind, z)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function HeaderDesigner({
  initial, scope = 'doc', zones: onlyZones = null, page, orientation = 'portrait', size = 'A4', vars, startZone = 'header', canSave = true, onApply, onClose,
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const isDoc = scope === 'doc';
  const hist = useHistory(clone(isDoc ? { ...initial, firstPage: initial.firstPage || 'same' } : initial));
  const draft = hist.value;
  const start = zoneOf(startZone);
  const [pageKind, setPageKind] = useState(isDoc ? start.pageKind : 'rest');
  const [zone, setZone] = useState(onlyZones && !onlyZones.includes(start.zone) ? onlyZones[0] : start.zone);
  const [sel, setSel] = useState(null);
  const [orient, setOrient] = useState(size === '16:9' ? 'landscape' : orientation);
  const [fmt, setFmt] = useState(size);
  const [snapOn, setSnapOn] = useState(true);
  const [saved, setSaved] = useState(null);
  const [saveName, setSaveName] = useState('');
  const [picked, setPicked] = useState(null);
  const assets = useAssetList();
  useEffect(() => { api.reportBandTemplates().then((r) => setSaved(r || [])).catch(() => setSaved([])); }, []);

  const firstMode = draft.firstPage || 'same';
  // La toile n'édite la 1re page que si elle est « propre » ; sinon elle explique et propose d'en faire une.
  const editable = !isDoc || pageKind === 'rest' || firstMode === 'own';
  const zoneList = onlyZones || ['header', 'footer'];
  const z = zoneList.includes(zone) ? zone : zoneList[0];
  const key = bandKey(isDoc ? pageKind : 'rest', z);
  const band = draft[key] || { height: 0, elements: [] };
  const place = z;
  const geom = pageGeometry({ ...page, size: fmt, orientation: orient }, {});
  const bodyW = geom.bodyW;
  const bandH = Number(band.height) || 0;
  const elements = band.elements || [];
  const selEl = editable ? elements.find((e) => e.id === sel) || null : null;
  const logos = assets.list || [];
  const sampleVars = useMemo(() => ({ ...vars, section: vars.section || tr('Section') }), [vars, tr]);

  const setBand = (fn) => hist.set((d) => ({ ...d, [key]: fn(d[key] || { height: 0, elements: [] }) }));
  const updateEl = (next) => setBand((b) => ({ ...b, elements: b.elements.map((e) => (e.id === next.id ? next : e)) }));
  const removeEl = (id) => { setBand((b) => ({ ...b, elements: b.elements.filter((e) => e.id !== id) })); setSel(null); };
  const add = (kind) => {
    if (!editable) return;
    if (elements.length >= MAX_ELEMENTS) { toast.error(tr('{n} éléments au plus par bande.', { n: MAX_ELEMENTS })); return; }
    const h = bandH < 8 ? (place === 'header' ? 16 : 10) : bandH;
    // Un logo ajouté reprend le logo déjà choisi dans la mise en page (sinon : cadre neutre à remplir).
    const el = newElement(kind, { elements, bodyW, bandH: h, assetId: kind === 'image' ? logosOf(draft)[0] || null : null, text: tr('Texte') });
    setBand((b) => ({ height: h, elements: [...((h !== bandH ? setBandHeight(b, h, { bodyW }) : b).elements || []), el] }));
    setSel(el.id);
  };
  const duplicate = () => {
    if (!selEl || elements.length >= MAX_ELEMENTS) return;
    const id = nextElementId(selEl.kind, elements);
    const copyEl = clampElement({ ...clone(selEl), id, y: selEl.y + 2, x: selEl.x + 2 }, { bandH, bodyW });
    setBand((b) => ({ ...b, elements: [...b.elements, copyEl] }));
    setSel(id);
  };
  const pick = (kind, zn) => { setPageKind(kind); if (zn) setZone(zn); setSel(null); };
  const setMode = (mode) => { hist.set((d) => setFirstPageMode(d, mode)); setSel(null); if (mode === 'own') setPageKind('first'); };
  // Un modèle s'applique à la PAIRE (en-tête de section : à ses seules bandes) ; les logos déjà choisis sont gardés,
  // et un modèle sans bandes de 1re page garde celles déjà dessinées (applyPair : rien n'est perdu).
  const applyContent = (content, k) => {
    if (isDoc) hist.set((d) => applyPair(d, content));
    else { const pair = pairOf(content); hist.set((d) => ({ ...d, header: clone(pair.header), footer: clone(pair.footer) })); }
    setSel(null); setPicked(k);
  };
  const saveMine = async () => {
    const name = saveName.trim();
    if (!name) return;
    try {
      const body = { name, header: draft.header || { height: 0, elements: [] }, footer: draft.footer || { height: 0, elements: [] } };
      if (isDoc) {
        body.firstPage = firstMode;
        if (draft.firstHeader) body.firstHeader = draft.firstHeader;
        if (draft.firstFooter) body.firstFooter = draft.firstFooter;
      }
      const row = await api.reportSaveBandTemplate(body);
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
  // Logos des modèles : ceux que l'utilisateur a déjà placés dans CETTE mise en page, jamais une image prise au hasard.
  const chosen = logosOf(draft);
  const logo1 = chosen[0] || null;
  const logo2 = chosen[1] || null;
  const systemTemplates = useMemo(() => BAND_TEMPLATES.map((t) => ({ key: t.key, name: t.name, content: applyTemplate(t.key, { logo1, logo2, tr }) })), [logo1, logo2, tr]);
  const zoneLabel = (zn) => tr(zn === 'header' ? 'En-tête' : 'Pied de page');
  const pageLabel = tr(pageKind === 'first' ? 'Première page' : 'Pages suivantes');

  return (
    <Modal open size="editor" onClose={onClose}
      title={tr(isDoc ? 'En-tête et pied de page' : 'En-tête et pied de cette page')}
      subtitle={tr(isDoc
        ? 'Première page et pages suivantes, chacune avec son en-tête et son pied. Choisissez un modèle ou composez librement.'
        : 'Choisissez un modèle ou composez librement : glissez les éléments sur la grille, réglez-les un par un.')}
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
            <span className="hd-templates-sub">{tr(isDoc ? 'Un clic applique la paire : première page et pages suivantes ; tout reste modifiable.' : 'Un clic applique l\'en-tête et le pied ; tout reste modifiable.')}</span>
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
              <TemplateThumb key={row.id} content={row.content} vars={sampleVars} label={row.name} tag={tr('Mes en-têtes')} active={picked === row.id} single={!isDoc}
                onPick={() => applyContent(row.content, row.id)} onDelete={canSave ? () => deleteMine(row) : null} deleteLabel={tr('Supprimer cet en-tête enregistré')} />
            ))}
            {(saved || []).length > 0 && <span className="hd-tpl-sep" aria-hidden="true" />}
            {systemTemplates.map((t) => (
              <TemplateThumb key={t.key} content={t.content} vars={sampleVars} label={tr(t.name)} active={picked === t.key} single={!isDoc} onPick={() => applyContent(t.content, t.key)} />
            ))}
          </div>
        </section>

        <div className="hd-main">
          <aside className="hd-left">
            {isDoc && (
              <div className="hd-group">
                <span className="hd-label">{tr('Première page')}</span>
                <div className="hd-modes" role="radiogroup" aria-label={tr('Première page')}>
                  {FIRST_PAGE_MODES.map((m) => (
                    <label key={m} className={`hd-mode ${firstMode === m ? 'is-on' : ''}`}>
                      <input type="radio" name="hd-first" value={m} checked={firstMode === m} onChange={() => setMode(m)} />
                      <span>{tr(FIRST_MODE_LABEL[m])}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="hd-group">
              <label className="hd-num hd-height">
                <span className="hd-label">{tr('Hauteur de la bande')}</span>
                <span className="hd-num-in">
                  <input className="input" type="number" min={0} max={60} step={1} value={bandH} disabled={!editable}
                    onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setBand((b) => setBandHeight(b, v, { bodyW })); }} />
                  <i>mm</i>
                </span>
              </label>
            </div>
            <div className="hd-group">
              <span className="hd-label">{tr('Ajouter')}</span>
              <div className="hd-add">
                {ADD.map(([k, l, I]) => (
                  <button key={k} type="button" onClick={() => add(k)} disabled={!editable || elements.length >= MAX_ELEMENTS}><I size={15} aria-hidden="true" /><span>{tr(l)}</span></button>
                ))}
              </div>
            </div>
            <div className="hd-group">
              <span className="hd-label">{tr('Calques')} <i className="hd-count">{editable ? elements.length : 0}</i></span>
              {editable && elements.length === 0 && <p className="hd-hint">{tr('Bande vide : choisissez un modèle ou ajoutez un élément.')}</p>}
              {editable && (
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
              )}
            </div>
          </aside>

          <div className="hd-stage">
            {isDoc && <PairPreview draft={draft} vars={sampleVars} geometry={geom} pageKind={pageKind} zone={z} onPick={pick} />}
            <div className="hd-stagebar">
              <div className="hd-seg" role="tablist" aria-label={tr('Zone')}>
                {zoneList.map((zn) => (
                  <button key={zn} type="button" role="tab" aria-selected={z === zn} className={z === zn ? 'is-on' : ''} onClick={() => { setZone(zn); setSel(null); }}>{zoneLabel(zn)}</button>
                ))}
              </div>
              {isDoc && <span className="hd-stage-where">{pageLabel} · {zoneLabel(z)}</span>}
              <span className="mmr-spacer" />
              <div className="hd-seg" role="radiogroup" aria-label={tr('Aperçu')}>
                {[['portrait', 'A4', 'Portrait', RectangleVertical], ['landscape', 'A4', 'Paysage', RectangleHorizontal], ['landscape', '16:9', '16:9', MonitorPlay]].map(([o, f, l, I]) => {
                  const on = orient === o && fmt === f;
                  return <button key={l} type="button" role="radio" aria-checked={on} className={on ? 'is-on' : ''} title={tr(l)} aria-label={tr(l)} onClick={() => { setOrient(o); setFmt(f); }}><I size={14} aria-hidden="true" /></button>;
                })}
              </div>
              <button type="button" className={`hd-tool ${snapOn ? 'is-on' : ''}`} aria-pressed={snapOn} onClick={() => setSnapOn((x) => !x)} title={tr('Grille et aimantation')}><Grid3x3 size={15} aria-hidden="true" /> {tr('Grille')}</button>
              <button type="button" className="hd-tool" onClick={hist.undo} disabled={!hist.canUndo} aria-label={tr('Annuler (Ctrl+Z)')} title={tr('Annuler (Ctrl+Z)')}><Undo2 size={15} aria-hidden="true" /></button>
              <button type="button" className="hd-tool" onClick={hist.redo} disabled={!hist.canRedo} aria-label={tr('Rétablir (Ctrl+Y)')} title={tr('Rétablir (Ctrl+Y)')}><Redo2 size={15} aria-hidden="true" /></button>
            </div>
            {editable ? (
              <>
                <BandCanvas band={band} place={place} geometry={geom} vars={sampleVars} pageNo={pageKind === 'first' ? 1 : 2} selected={sel} onSelect={setSel} onChange={updateEl} onRemove={removeEl} snapOn={snapOn} />
                <p className="hd-stage-note">
                  {isDoc && pageKind === 'rest' && firstMode === 'same' ? `${tr('La première page est identique : elle change aussi.')} ` : ''}
                  {tr('Le cadre pointillé est la bande, alignée sur les marges du texte ; les zones hachurées sont les marges de la page.')}
                </p>
              </>
            ) : (
              <div className="hd-notice">
                {firstMode === 'none'
                  ? <p><strong>{tr('Page de titre')}</strong> — {tr('la première page n\'a ni en-tête ni pied de page ; les pages suivantes gardent les leurs.')}</p>
                  : <p><strong>{tr('Identique aux pages suivantes')}</strong> — {tr('la première page reprend l\'en-tête et le pied des pages suivantes.')}</p>}
                <div className="hd-notice-actions">
                  <Button size="sm" icon={PenLine} onClick={() => setMode('own')}>{tr('Concevoir une première page propre')}</Button>
                  {firstMode === 'none'
                    ? <Button size="sm" variant="secondary" icon={Copy} onClick={() => setMode('same')}>{tr('Identique aux pages suivantes')}</Button>
                    : <Button size="sm" variant="secondary" icon={FileText} onClick={() => setMode('none')}>{tr('Sans en-tête ni pied (page de titre)')}</Button>}
                </div>
              </div>
            )}
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
                <p>{tr(editable
                  ? 'Cliquez sur un élément de la bande pour le régler : texte, police, taille, couleur, alignement, fond, logo.'
                  : 'Choisissez « En-tête et pied propres » pour dessiner la première page.')}</p>
                {logos.length === 0 && editable && <p className="hd-hint">{tr('Aucun logo encore : ajoutez un élément « Logo » puis téléversez votre image (PNG ou JPEG).')}</p>}
              </div>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  );
}
