import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Copy, Trash2, Info, Repeat, Plus, SlidersHorizontal, PanelLeft, Monitor, X } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Button } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useI18n } from '../../../lib/i18n.jsx';
import { formatDateTime } from '../../../lib/format.js';
import { periodLabel } from '../../../lib/period.js';
import { BlockView, Band } from '../ReportBlocks.jsx';
import BlockFrame from '../BlockFrame.jsx';
import { useBlockData } from '../useBlockData.js';
import { RichTextEditor } from '../RichText.jsx';
import {
  defaultBlock, defaultPage, cloneWithIds, findBlock, updateParams, removeBlock, duplicateBlock, moveBlock, moveBlockTo, insertBlock, iidOf,
} from '../reportDoc.js';
import reportCss from '../reports.css?raw';
import Topbar from './Topbar.jsx';
import CatalogPane from './CatalogPane.jsx';
import OutlinePane from './OutlinePane.jsx';
import PagesPane from './PagesPane.jsx';
import PropertiesPane from './PropertiesPane.jsx';
import { useFilterOptions } from './FiltersPane.jsx';
import { useHistory } from './useHistory.js';
import { FRAMED, DEFAULT_H, frameLabel, UPGRADE_WARNINGS } from './blockTypes.js';

/**
 * Éditeur du concepteur de rapport (lot 7a) — 3 volets :
 *  - gauche : Catalogue (recherche, groupes, « Même calcul que »), Plan (arbre, glisser,
 *    monter / descendre), Pages ;
 *  - centre : la page (contenu fixe affiché tout de suite, blocs de données calculés bloc par
 *    bloc), bloc sélectionné entouré de bleu avec sa mini-barre, « + » au survol, dépôt d'un
 *    élément du catalogue entre deux blocs ;
 *  - droite : Bloc / Filtres / Page.
 * Raccourcis : Ctrl+S, Ctrl+Z / Ctrl+Y (50 états), Suppr, Ctrl+D, « / » (recherche), Échap.
 * Brouillon local (localStorage, try/catch) pour récupérer une fermeture accidentelle — il ne
 * remplace jamais l'enregistrement serveur. Le menu de l'application passe en rail tant que
 * l'éditeur est ouvert. Sous 1 180 px les volets deviennent des tiroirs ; sous 640 px, lecture seule.
 */
const mark = (name) => { try { if (typeof performance !== 'undefined' && performance.mark) performance.mark(name); } catch { /* sans incidence */ } };
const draftKey = (id) => `mems.rd.draft.${id}`;
const readDraft = (id) => { try { const s = id && localStorage.getItem(draftKey(id)); return s ? JSON.parse(s) : null; } catch { return null; } };
const writeDraft = (id, value) => { try { if (id) localStorage.setItem(draftKey(id), JSON.stringify(value)); } catch { /* stockage indisponible */ } };
const dropDraft = (id) => { try { if (id) localStorage.removeItem(draftKey(id)); } catch { /* stockage indisponible */ } };

function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

const typing = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export default function ReportEditor({ catalog, initial, canEdit, onClose, onTemplatesChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const history = useHistory(initial.doc);
  const doc = history.value;
  const [meta, setMeta] = useState(initial.meta);
  const [selected, setSelected] = useState(null); // id du bloc sélectionné
  const [dirty, setDirty] = useState(!initial.meta.id);
  const [saving, setSaving] = useState(false);
  const [forms, setForms] = useState([]);
  const [offices, setOffices] = useState([]);
  const [leftTab, setLeftTab] = useState('catalog');
  const [leftOpen, setLeftOpen] = useState(false); // tiroirs (écrans étroits)
  const [rightOpen, setRightOpen] = useState(false);
  const [drop, setDrop] = useState(null); // { id, before } : ligne d'insertion pendant un glisser
  const [draft, setDraft] = useState(() => {
    const d = !initial.meta.id || initial.meta.status === 'final' ? null : readDraft(initial.meta.id);
    return d && d.baseVersion === initial.meta.version && JSON.stringify(d.doc) !== JSON.stringify(initial.doc) ? d : null;
  });
  const narrow = useMedia('(max-width: 1180px)');
  const phone = useMedia('(max-width: 640px)');
  const pageRef = useRef(null);
  const topbarRef = useRef(null);
  const searchRef = useRef(null);
  const [topbarH, setTopbarH] = useState(64);
  const final = meta.status === 'final';
  const editable = canEdit && !final && !phone;
  // Changement de largeur : les tiroirs repartent fermés.
  useEffect(() => { setLeftOpen(false); setRightOpen(false); }, [narrow]);

  // Menu de l'application en rail tant que l'éditeur est ouvert (plus de place pour la page).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mems:rail', { detail: true }));
    return () => window.dispatchEvent(new CustomEvent('mems:rail', { detail: false }));
  }, []);
  // Les volets se placent sous la barre d'outils, dont la hauteur varie (1 ou 2 lignes).
  useEffect(() => {
    const el = topbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setTopbarH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    api.monForms().then(setForms).catch(() => setForms([]));
    api.listOffices().then((o) => setOffices(o.filter((x) => x.active))).catch(() => setOffices([]));
  }, []);
  const opts = useFilterOptions(forms, offices);

  // Données bloc par bloc (plan puis blocs, cache par signature) ; finalisé → données figées.
  const uiLang = document.documentElement.lang === 'en' ? 'en' : 'fr';
  const { plan: data, planError, states, retry, refresh, progress, observe } = useBlockData({ doc, frozenId: final ? meta.id : null, lang: uiLang });
  const heights = useRef(new Map()); // dernière hauteur mesurée de chaque instance (squelettes à la bonne taille)
  const onHeight = useCallback((iid, h) => { heights.current.set(iid, h); }, []);
  // Premier contenu : le contenu fixe est peint sans attendre aucune donnée.
  useLayoutEffect(() => { mark('rd:first-content'); }, []);
  const computing = progress.total > 0 && progress.done < progress.total;

  // Fermeture de l'onglet avec des modifications : confirmation du navigateur (le brouillon local reste).
  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  // Brouillon local (rapport déjà enregistré) : écrit après chaque pause de saisie.
  useEffect(() => {
    if (!dirty || !meta.id || final || draft) return undefined;
    const h = setTimeout(() => writeDraft(meta.id, { doc, baseVersion: meta.version, at: Date.now() }), 800);
    return () => clearTimeout(h);
  }, [doc, dirty, meta.id, meta.version, final, draft]);

  const change = useCallback((fn) => { history.set(fn); setDirty(true); }, [history]);
  // Bloc tout juste inséré : amené à l'écran (il peut être loin dans la page).
  const pendingScroll = useRef(null);
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    pendingScroll.current = null;
    const el = document.querySelector(`.rd-canvas [data-block="${id}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [doc.blocks]);
  const setBlocks = useCallback((fn) => change((d) => ({ ...d, blocks: fn(d.blocks) })), [change]);
  const updateBlock = (id, patch) => setBlocks((bs) => updateParams(bs, id, patch));
  const remove = (id) => { setBlocks((bs) => removeBlock(bs, id)); setSelected(null); };
  const insert = (b, where) => {
    const r = insertBlock(doc.blocks, b, where);
    if (r.error) { toast.error(tr(r.error)); return; }
    setBlocks(() => r.blocks);
    setSelected(b.id);
    pendingScroll.current = b.id;
  };
  /** Ajout depuis le catalogue : après le bloc sélectionné, ou DANS une section répétée / des colonnes sélectionnées. */
  const add = (type, dataset = null) => {
    const sel = selected ? findBlock(doc.blocks, selected) : null;
    const b = defaultBlock(type, { catalog, dataset, t: tr });
    const into = sel && (sel.block.type === 'repeat' || sel.block.type === 'columns') && type !== 'repeat' ? { id: sel.block.id, col: 0 } : null;
    insert(b, into ? { into } : { afterId: sel ? sel.block.id : null });
    if (narrow) setLeftOpen(false);
  };
  const onDropPayload = (payload, where) => {
    if (!payload || !editable) return;
    if (payload.kind === 'type') insert(defaultBlock(payload.key, { catalog, t: tr }), where);
    if (payload.kind === 'dataset') insert(defaultBlock('data', { catalog, dataset: payload.key }), where);
  };

  async function save() {
    if (!editable) return;
    if (!doc.title.trim()) { toast.error(tr('Donnez un titre au rapport.')); return; }
    setSaving(true);
    try {
      const saved = meta.id
        ? await api.reportUpdateDocument(meta.id, { content: doc, version: meta.version })
        : await api.reportCreateDocument({ content: doc, templateKey: meta.templateKey });
      dropDraft(meta.id || saved.id);
      setMeta((m) => ({ ...m, id: saved.id, version: saved.version, status: saved.status }));
      setDirty(false);
      toast.success(tr('Rapport enregistré.'));
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function finalize() {
    if (dirty) { toast.error(tr('Enregistrez d\'abord vos modifications.')); return; }
    if (!window.confirm(tr('Finaliser fige le rapport ET ses chiffres : il ne pourra plus être modifié (dupliquez-le pour une nouvelle version). Continuer ?'))) return;
    try {
      const r = await api.reportFinalizeDocument(meta.id, meta.version);
      setMeta((m) => ({ ...m, version: r.version, status: r.status, finalizedAt: r.finalizedAt }));
      toast.success(tr('Rapport finalisé.'));
    } catch (e) { toast.error(e.message); }
  }

  async function saveAsTemplate() {
    const name = window.prompt(tr('Nom du modèle :'), doc.title);
    if (!name || !name.trim()) return;
    try { await api.reportCreateTemplate({ name: name.trim(), content: doc }); toast.success(tr('Modèle enregistré.')); onTemplatesChanged(); } catch (e) { toast.error(e.message); }
  }

  const duplicateDoc = () => {
    setMeta({ id: null, version: null, status: 'draft', templateKey: meta.templateKey });
    history.reset({ ...doc, title: `${doc.title} (${tr('copie')})`, blocks: doc.blocks.map(cloneWithIds) });
    setDirty(true);
  };
  const back = () => {
    if (dirty && !window.confirm(tr('Quitter sans enregistrer ?'))) return;
    if (dirty) dropDraft(meta.id);
    onClose();
  };

  // ---- Raccourcis clavier --------------------------------------------------------------
  const keys = useRef({});
  keys.current = { save, selected, editable, history, remove, setSelected, setBlocks };
  useEffect(() => {
    const onKey = (e) => {
      const k = keys.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') { e.preventDefault(); if (k.editable) k.save(); return; }
      if (typing(e.target)) return; // texte en cours de saisie : raccourcis natifs du champ
      if (mod && key === 'z' && !e.shiftKey) { if (k.editable) { e.preventDefault(); k.history.undo(); } return; }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { if (k.editable) { e.preventDefault(); k.history.redo(); } return; }
      if (mod && key === 'd' && k.selected && k.editable) { e.preventDefault(); k.setBlocks((bs) => duplicateBlock(bs, k.selected)); return; }
      if (e.key === 'Delete' && k.selected && k.editable) { e.preventDefault(); k.remove(k.selected); return; }
      if (e.key === '/' && !mod) { e.preventDefault(); setLeftTab('catalog'); setLeftOpen(true); setTimeout(() => searchRef.current && searchRef.current.focus(), 0); return; }
      if (e.key === 'Escape') k.setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Exports -----------------------------------------------------------------
  const pageHtml = () => {
    const page = pageRef.current.cloneNode(true);
    page.querySelectorAll('.rd-mini, .rd-add-between, .rb-pagebreak span, .rt-toolbar, .rd-repeat-tag, .rd-section-tag, .rb-showdata, .rd-drop-line').forEach((n) => n.remove());
    page.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    page.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
    return page.outerHTML;
  };
  const download = (content, name, type) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const fileBase = (doc.title || 'Rapport').replace(/[^\w\-À-ÿ ]+/g, '').trim().slice(0, 80) || 'Rapport';
  const exportHtml = () => download(`<!doctype html><html lang="${document.documentElement.lang || 'fr'}"><head><meta charset="utf-8"><title>${fileBase}</title><style>body{background:#f5f6f9;margin:0;padding:24px}${reportCss}</style></head><body>${pageHtml()}</body></html>`, `${fileBase}.html`, 'text/html;charset=utf-8');
  const exportWord = () => download(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${fileBase}</title><style>${reportCss}.rd-page{font-family:Calibri,Arial,sans-serif;box-shadow:none}</style></head><body>${pageHtml()}</body></html>`, `${fileBase}.doc`, 'application/msword');
  const exportPdf = () => {
    setSelected(null);
    const style = document.createElement('style');
    style.textContent = `@page { size: A4 ${doc.page?.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 12mm; }`;
    document.head.appendChild(style);
    document.body.classList.add('rd-printing');
    const done = () => { document.body.classList.remove('rd-printing'); style.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 60); // laisse React retirer l'éditeur du bloc sélectionné
  };

  const varLabels = { ...Object.fromEntries(Object.entries(catalog.variables || {})), ...Object.fromEntries(Object.entries(catalog.kpis).map(([k, v]) => [k, v.label])) };
  const variableList = Object.entries(catalog.kpis).filter(([, v]) => v.available !== false).map(([k, v]) => [k, tr(v.label)]);
  const sel = selected ? findBlock(doc.blocks, selected) : null;
  const instances = useMemo(() => Object.fromEntries(((data && data.instances) || []).map((i) => [i.iid, i])), [data]);
  // Instance du bloc sélectionné (la 1re dans une section répétée) : ses données pour le volet droit.
  const selIid = useMemo(() => {
    if (!selected) return null;
    if (states[selected]) return selected;
    const inst = ((data && data.instances) || []).find((i) => i.blockId === selected);
    return inst ? inst.iid : selected;
  }, [selected, states, data]);
  const vars = { ...(data?.vars || {}), titre: doc.title, periode: data?.periodLabel || periodLabel(doc.period, uiLang) };
  const page = doc.page || defaultPage();

  // ---- Glisser-déposer depuis le catalogue (ligne d'insertion avant / après un bloc) ----------
  const isBlockDrag = (e) => [...(e.dataTransfer?.types || [])].includes('text/x-mems-block');
  const dragProps = (b) => (editable ? {
    onDragOver: (e) => {
      if (!isBlockDrag(e)) return;
      e.preventDefault(); e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      setDrop((d) => (d && d.id === b.id && d.before === before ? d : { id: b.id, before }));
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop((d) => (d && d.id === b.id ? null : d)); },
    onDrop: (e) => {
      if (!isBlockDrag(e)) return;
      e.preventDefault(); e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      setDrop(null);
      let payload = null; try { payload = JSON.parse(e.dataTransfer.getData('text/x-mems-block')); } catch { /* glisser étranger */ }
      onDropPayload(payload, before ? { beforeId: b.id } : { afterId: b.id });
    },
  } : {});

  /** Mini-barre du bloc sélectionné : monter, descendre, dupliquer, supprimer, options. */
  const miniBar = (b) => (
    <div className="rd-mini" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setBlocks((bs) => moveBlock(bs, b.id, -1))} aria-label={tr('Monter')} title={tr('Monter')}><ChevronUp size={14} /></button>
      <button type="button" onClick={() => setBlocks((bs) => moveBlock(bs, b.id, 1))} aria-label={tr('Descendre')} title={tr('Descendre')}><ChevronDown size={14} /></button>
      <button type="button" onClick={() => setBlocks((bs) => duplicateBlock(bs, b.id))} aria-label={tr('Dupliquer')} title={tr('Dupliquer (Ctrl+D)')}><Copy size={14} /></button>
      <button type="button" onClick={() => remove(b.id)} aria-label={tr('Supprimer')} title={tr('Supprimer (Suppr)')}><Trash2 size={14} /></button>
      <button type="button" onClick={() => setRightOpen(true)} aria-label={tr('Options du bloc')} title={tr('Options du bloc')}><SlidersHorizontal size={14} /></button>
    </div>
  );
  const addBetween = (b) => (
    <button type="button" className="rd-add-between" aria-label={tr('Ajouter un bloc ici')} title={tr('Ajouter un bloc ici')}
      onClick={(e) => { e.stopPropagation(); setSelected(b.id); setLeftTab('catalog'); setLeftOpen(true); setTimeout(() => searchRef.current && searchRef.current.focus(), 0); }}>
      <Plus size={13} aria-hidden="true" />
    </button>
  );

  // Rendu d'un bloc dans la page (avec outils d'édition). `repeat` = { id, key, label, over } dans une section répétée.
  const renderBlock = (b, repeat = null, first = true) => {
    const iid = iidOf(b.id, repeat);
    const isSel = selected === b.id;
    const pick = (e) => { e.stopPropagation(); if (first) setSelected(b.id); };
    const dropCls = drop && drop.id === b.id ? (drop.before ? 'is-drop-before' : 'is-drop-after') : '';
    const tools = editable && isSel && first ? miniBar(b) : null;
    const plus = editable && first && !repeat ? addBetween(b) : null;
    if (b.type === 'section') {
      const o = b.params.orientation || page.orientation;
      return (
        <div key={iid} data-block={b.id} id={`rd-sec-${iid}`} className={`rd-block rd-section-sep ${isSel ? 'is-selected' : ''} ${dropCls}`} onClick={pick} {...dragProps(b)}>
          <span className="rd-section-tag">{tr('Section')} · {b.params.size || page.size || 'A4'} {tr(o === 'landscape' ? 'paysage' : 'portrait')}{b.params.title ? ` · ${b.params.title}` : ''}</span>
          {tools}{plus}
        </div>
      );
    }
    if (b.type === 'columns') {
      return (
        <div key={iid} data-block={b.id} className={`rd-block rd-columns rd-cols-${b.params.ratio.replace(/:/g, '-')} ${isSel ? 'is-selected' : ''} ${dropCls}`} onClick={pick} {...dragProps(b)}>
          {b.params.cols.map((col, c) => <div key={c} className="rd-col">{col.length ? col.map((cb) => renderBlock(cb, repeat, first)) : <p className="rb-note">{tr('Colonne vide : sélectionnez les colonnes puis ajoutez un bloc.')}</p>}</div>)}
          {tools}{plus}
        </div>
      );
    }
    if (b.type === 'repeat') {
      const items = (data && data.expansions && data.expansions[b.id]) || [];
      return (
        <div key={iid} data-block={b.id} className={`rd-repeat ${isSel ? 'is-selected' : ''} ${dropCls}`} onClick={(e) => { e.stopPropagation(); setSelected(b.id); }} {...dragProps(b)}>
          <div className="rd-repeat-tag"><Repeat size={13} aria-hidden="true" /> {tr({ bureau: 'Section répétée par bureau ({n})', partner: 'Section répétée par partenaire ({n})' }[b.params.over] || 'Section répétée par activité ({n})', { n: items.length })}</div>
          {data && data.expansions && items.length === 0 && <p className="rb-note">{tr('Aucune activité ou bureau avec des données sur la période.')}</p>}
          {items.map((it, k) => (
            <section key={it.key} className="rd-repeat-item">
              {b.params.blocks.map((c) => renderBlock(c, { id: b.id, key: it.key, label: it.label, over: b.params.over }, k === 0))}
            </section>
          ))}
          {tools}{plus}
        </div>
      );
    }
    const st = states[iid];
    const res = st ? st.result : undefined;
    const itemVars = repeat ? { [{ activity: 'activite', bureau: 'bureau', partner: 'partenaire' }[repeat.over]]: repeat.label } : {};
    const editorFor = (b.type === 'text' || b.type === 'callout' || b.type === 'bulletin') && editable && isSel && first
      ? <RichTextEditor doc={b.params.doc || res?.data?.doc} vars={{ ...vars, ...(res?.data?.vars || {}) }} labelFor={(v) => tr(varLabels[v] || v)} variableList={variableList}
        onChange={(d) => updateBlock(b.id, { doc: d })} /> : null;
    const ctx = { result: res, inst: instances[iid], vars: { ...vars, ...itemVars }, catalog, varLabels };
    return (
      <div key={iid} data-block={b.id} className={`rd-block rd-block-${b.type} ${isSel ? 'is-selected' : ''} ${dropCls}`} onClick={pick} {...(repeat ? {} : dragProps(b))}>
        {FRAMED.has(b.type)
          ? (
            <BlockFrame iid={iid} state={st} label={frameLabel(b, catalog, tr)} height={heights.current.get(iid) || DEFAULT_H[b.type]}
              onRetry={retry} observe={observe} onHeight={onHeight}>
              <BlockView block={b} ctx={ctx} editor={editorFor} />
            </BlockFrame>
          )
          : <BlockView block={b} ctx={{ ...ctx, pending: st && st.status !== 'ready' && st.status !== 'error' }} editor={editorFor} />}
        {tools}{plus}
      </div>
    );
  };

  const upgradedDraft = meta.upgradedFrom === 1 && !final;
  const goSection = (s) => {
    const el = s.id && s.id !== '_doc' ? document.getElementById(`rd-sec-${s.id}`) : pageRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (narrow) setLeftOpen(false);
  };
  const leftPane = (
    <>
      <div className="rd-tabs" role="tablist" aria-label={tr('Volet gauche')}>
        {[['catalog', 'Catalogue'], ['outline', 'Plan'], ['pages', 'Pages']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={leftTab === k} className={leftTab === k ? 'is-active' : ''} onClick={() => setLeftTab(k)}>{tr(l)}</button>
        ))}
        {narrow && <button type="button" className="rd-drawer-x" onClick={() => setLeftOpen(false)} aria-label={tr('Fermer')}><X size={15} /></button>}
      </div>
      {leftTab === 'catalog' && <CatalogPane catalog={catalog} searchRef={searchRef} onInsertType={(k) => add(k)} onInsertDataset={(k) => add('data', k)} />}
      {leftTab === 'outline' && (
        <OutlinePane blocks={doc.blocks} catalog={catalog} selected={selected} onSelect={(id) => { setSelected(id); if (narrow) setLeftOpen(false); }}
          onMove={(id, dir) => setBlocks((bs) => moveBlock(bs, id, dir))} onMoveTo={(id, i) => setBlocks((bs) => moveBlockTo(bs, id, i))}
          onRemove={remove} onDuplicate={(id) => setBlocks((bs) => duplicateBlock(bs, id))} />
      )}
      {leftTab === 'pages' && <PagesPane sections={(data && data.sections) || []} onGo={(p) => goSection(((data && data.sections) || [])[p.n - 1] || {})} />}
    </>
  );
  const rightPane = (
    <>
      {narrow && <div className="rd-drawer-h"><strong>{tr('Propriétés')}</strong><button type="button" className="rd-drawer-x" onClick={() => setRightOpen(false)} aria-label={tr('Fermer')}><X size={15} /></button></div>}
      <PropertiesPane sel={sel} doc={doc} catalog={catalog} forms={forms} opts={opts} state={selIid ? states[selIid] : null}
        onChangeBlock={(patch) => sel && updateBlock(sel.block.id, patch)} onRegenerate={() => sel && updateBlock(sel.block.id, { doc: undefined })}
        onChangePage={(pg) => change((d) => ({ ...d, page: { ...(d.page || defaultPage()), ...pg } }))} />
    </>
  );

  return (
    <div className={`rd-editor ${narrow ? 'is-narrow' : ''}`} style={{ '--rd-top': `${topbarH}px` }}>
      <Topbar doc={doc} meta={meta} dirty={dirty} saving={saving} editable={editable} canEdit={canEdit && !phone} final={final}
        computing={computing} progress={progress} history={history} forms={forms} opts={opts} topbarRef={topbarRef}
        onBack={back} onTitle={(title) => change((d) => ({ ...d, title }))} onPeriod={(period) => change((d) => ({ ...d, period }))}
        onFilters={(filters) => change((d) => ({ ...d, filters }))} onRefresh={refresh} onSave={save} onFinalize={finalize}
        onTemplate={saveAsTemplate} onDuplicate={duplicateDoc} onPdf={exportPdf} onHtml={exportHtml} onWord={exportWord}
        onXlsx={() => api.reportExportXlsx(doc, `${fileBase}.xlsx`).catch((e) => toast.error(e.message))} />
      {planError && <Alert tone="warning">{planError}</Alert>}
      {phone && <Alert tone="info" icon={Monitor}>{tr('Ouvrez-le sur un écran plus large pour le modifier.')}</Alert>}
      {draft && (
        <Alert tone="info" icon={Info}>
          {tr('Un brouillon local non enregistré existe ({d}).', { d: formatDateTime(new Date(draft.at).toISOString()) })}{' '}
          <Button size="sm" variant="secondary" onClick={() => { history.reset(draft.doc); setDirty(true); setDraft(null); }}>{tr('Restaurer')}</Button>{' '}
          <Button size="sm" variant="ghost" onClick={() => { dropDraft(meta.id); setDraft(null); }}>{tr('Ignorer')}</Button>
        </Alert>
      )}
      {final && <Alert tone="info">{tr('Rapport finalisé le {d} : contenu et chiffres sont figés. Dupliquez-le pour préparer une nouvelle version.', { d: formatDateTime(meta.finalizedAt) })}</Alert>}
      {upgradedDraft && <Alert tone="info" icon={Info}>{tr('Les chiffres de couverture suivent désormais la définition commune (sites actifs réalisés ÷ sites actifs) : ils peuvent différer de l\'ancienne version.')}</Alert>}
      {(meta.warnings || []).length > 0 && <Alert tone="warning">{meta.warnings.map((w) => <div key={w.blockId + w.message}>{UPGRADE_WARNINGS[w.code] ? tr(UPGRADE_WARNINGS[w.code], w.params) : w.message}</div>)}</Alert>}

      {editable && narrow && (
        <div className="rd-narrowbar">
          <Button variant="secondary" size="sm" icon={PanelLeft} onClick={() => setLeftOpen(true)}>{tr('Catalogue et plan')}</Button>
          <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setRightOpen(true)}>{tr('Propriétés')}</Button>
        </div>
      )}
      <div className={`rd-body ${editable ? '' : 'is-readonly'}`}>
        {editable && (!narrow || leftOpen) && <aside className={`rd-left ${narrow ? 'is-drawer' : ''}`} aria-label={tr('Catalogue et plan')}>{leftPane}</aside>}

        <main className="rd-canvas" onClick={() => setSelected(null)}
          onDragOver={(e) => { if (editable && isBlockDrag(e)) e.preventDefault(); }}
          onDrop={(e) => {
            if (!editable || !isBlockDrag(e)) return;
            e.preventDefault(); setDrop(null);
            let payload = null; try { payload = JSON.parse(e.dataTransfer.getData('text/x-mems-block')); } catch { /* glisser étranger */ }
            onDropPayload(payload, {});
          }}>
          <article ref={pageRef} className={`rd-page ${page.orientation === 'landscape' ? 'is-landscape' : ''}`}>
            <Band band={page.header} vars={vars} texts={data?.sections?.[0]?.headerText} className="rd-page-h" />
            {doc.blocks.length === 0 && <p className="rd-empty-doc">{tr('Le rapport est vide : ajoutez des blocs depuis le catalogue (clic ou glisser sur la page).')}</p>}
            {doc.blocks.map((b) => renderBlock(b))}
            <Band band={page.footer} vars={vars} texts={data?.sections?.[0]?.footerText} className="rd-page-f" />
          </article>
        </main>

        {editable && (!narrow || rightOpen) && <aside className={`rd-right ${narrow ? 'is-drawer' : ''}`} aria-label={tr('Propriétés')}>{rightPane}</aside>}
      </div>
      {editable && narrow && (leftOpen || rightOpen) && <div className="rd-drawer-backdrop" onClick={() => { setLeftOpen(false); setRightOpen(false); }} aria-hidden="true" />}
    </div>
  );
}
