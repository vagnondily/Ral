import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Copy, Trash2, Info, Repeat, Plus, SlidersHorizontal, PanelLeft, Monitor, X, AlertTriangle, Paperclip } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Button } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useI18n } from '../../../lib/i18n.jsx';
import { formatDateTime } from '../../../lib/format.js';
import { periodLabel } from '../../../lib/period.js';
import { BlockView, ROW_VIEWS } from '../ReportBlocks.jsx';
import BlockFrame from '../BlockFrame.jsx';
import { useBlockData } from '../useBlockData.js';
import { RichTextEditor } from '../RichText.jsx';
import {
  defaultBlock, defaultPage, cloneWithIds, findBlock, updateParams, removeBlock, duplicateBlock, moveBlock, moveBlockTo, insertBlock, iidOf, landscapeAround,
  setPageLayout, docImageCount,
} from '../reportDoc.js';
import { bandImageCount, layoutImageCount } from '../../../lib/reportBands.js';
import { localPlan, sectionsOfPlan, paginate, pageGeometry, pageName, tocEntries, annexDecision } from '../../../lib/reportPaginate.js';
import { tableFit, MIN_SCALE } from '../../../lib/reportFit.js';
import reportCss from '../reports.css?raw';
import Topbar from './Topbar.jsx';
import CatalogPane from './CatalogPane.jsx';
import OutlinePane from './OutlinePane.jsx';
import PagesPane from './PagesPane.jsx';
import PropertiesPane from './PropertiesPane.jsx';
import PageLayoutPane from './PageLayoutPane.jsx';
import PagedPreview from './PagedPreview.jsx';
import MeasureLayer from './MeasureLayer.jsx';
import { useFilterOptions, filterValueLabel } from './FiltersPane.jsx';
import HeaderDesigner from './HeaderDesigner.jsx';
import { assetDataUrl } from '../useAssets.js';
import { useHistory } from './useHistory.js';
import { FRAMED, DEFAULT_H, frameLabel, UPGRADE_WARNINGS } from './blockTypes.js';

/**
 * Éditeur du concepteur de rapport (lot 7a) — 3 volets :
 *  - gauche : Catalogue (recherche, groupes, « Même calcul que »), Plan (arbre, glisser,
 *    monter / descendre), Pages ;
 *  - centre : l'aperçu PAGINÉ (C7 : feuilles A4 / 16:9, portrait ou paysage par section,
 *    pagination calculée une fois depuis les hauteurs mesurées — l'aperçu est le PDF ; contenu
 *    fixe affiché tout de suite, blocs de données calculés bloc par bloc), bloc sélectionné
 *    entouré de bleu avec sa mini-barre, « + » au survol, dépôt d'un élément du catalogue ;
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
  const [selPage, setSelPage] = useState(null); // n° de la page sélectionnée (onglet Pages, marge d'une feuille)
  const [bandEditor, setBandEditor] = useState(null); // concepteur d'en-tête ouvert : { scope, startZone, sectionBlockId? }
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
  // Un bloc sélectionné remplace la page sélectionnée (le volet droit montre le bloc).
  useEffect(() => { if (selected) setSelPage(null); }, [selected]);
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

  // Copie = brouillon (lignes recalculées) : d'un rapport finalisé avant le schéma des clés, elle part du
  // contenu dont les constats sont sur les clés actuelles (copyContent, serveur), jamais des clés figées.
  const duplicateDoc = () => {
    const base = meta.copyContent || doc;
    setMeta({ id: null, version: null, status: 'draft', templateKey: meta.templateKey });
    history.reset({ ...base, title: `${doc.title} (${tr('copie')})`, blocks: base.blocks.map(cloneWithIds) });
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
      if (e.key === 'Escape') { k.setSelected(null); setSelPage(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Plan local (toujours à jour), géométrie des pages, mesure et pagination -------------
  const varLabels = { ...Object.fromEntries(Object.entries(catalog.variables || {})), ...Object.fromEntries(Object.entries(catalog.kpis).map(([k, v]) => [k, v.label])) };
  const variableList = Object.entries(catalog.kpis).filter(([, v]) => v.available !== false).map(([k, v]) => [k, tr(v.label)]);
  const sel = selected ? findBlock(doc.blocks, selected) : null;
  // Variables des en-têtes et des textes : celles du plan du serveur, précédées de valeurs locales
  // ({date} du jour, {bureau} du filtre du rapport) pour que l'en-tête s'affiche tout de suite.
  const today = new Date();
  const todayText = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const officeText = doc.filters && doc.filters.office ? filterValueLabel('office', doc.filters.office, { ...opts, forms }, tr) : tr('Tous les bureaux');
  const vars = useMemo(() => ({ date: todayText, bureau: officeText, ...(data?.vars || {}), titre: doc.title, periode: data?.periodLabel || periodLabel(doc.period, uiLang) }), [data, doc.title, doc.period, uiLang, todayText, officeText]);
  const page = doc.page || defaultPage();
  const defaultView = useCallback((k) => ((catalog.datasets[k] || {}).defaultView || 'table'), [catalog]);
  // Annexes (retour 88) : bloc marqué « en annexe », ou tableau de plus de N lignes (règle du
  // document, lignes connues une fois les données arrivées) ; orientation « auto » = paysage si le
  // tableau est trop large pour une page portrait.
  const autoRows = doc.annexes && doc.annexes.autoRows != null ? doc.annexes.autoRows : null;
  const portraitW = pageGeometry(page, { orientation: 'portrait' }).bodyW;
  const rowsOf = useCallback((iid) => { const r = states[iid] && states[iid].result; return r && r.ok && r.data && Array.isArray(r.data.rows) ? r.data.rows.length : null; }, [states]);
  const annexOpt = useMemo(() => ({
    isAnnexed: (b, iid, view, inColumn) => annexDecision(b, { view, rows: rowsOf(iid), autoRows, inColumn }),
    orientationOf: (inst, b) => {
      const mode = (b.params && b.params.annexOrientation) || 'auto';
      if (mode !== 'auto') return mode;
      const r = states[inst.iid] && states[inst.iid].result;
      const d = r && r.ok ? r.data : null;
      if (d && (inst.view === 'table' || inst.view === 'heat') && d.rows && d.rows.length) {
        // « Large » : la police devrait être réduite en portrait, le tableau occupe presque toute la
        // largeur, ou il a 8 colonnes ou plus (cellules de texte trop étroites).
        const f = tableFit(d, b.params.columns, portraitW);
        const cols = (b.params.columns && b.params.columns.length) || (d.columns || []).length;
        if (f.scale < 1 || f.tooWide || f.needed > portraitW * 0.9 || cols >= 8) return 'landscape';
      }
      return null; // orientation du document
    },
  }), [states, rowsOf, autoRows, portraitW]);
  const plan = useMemo(() => localPlan(doc, { expansions: (data && data.expansions) || {}, vars, defaultView, annex: annexOpt }), [doc, data, vars, defaultView, annexOpt]);
  const instById = useMemo(() => Object.fromEntries(plan.instances.map((i) => [i.iid, i])), [plan]);
  const sectionById = useMemo(() => Object.fromEntries(plan.sections.map((s) => [s.id, s])), [plan]);
  // 1er élément de chaque section répétée (édition dans le 1er seulement) et 1re instance de chaque élément (étiquette).
  const firstKeyOf = useMemo(() => Object.fromEntries(Object.entries(plan.expansions || {}).map(([k, items]) => [k, items[0] && items[0].key])), [plan]);
  const firstOfItem = useMemo(() => {
    const seen = new Set(); const out = new Set();
    for (const i of plan.instances) {
      if (!i.repeatId || i.column || i.type === 'section') continue;
      const k = `${i.repeatId}~${i.repeatKey}`;
      if (!seen.has(k)) { seen.add(k); out.add(i.iid); }
    }
    return out;
  }, [plan]);
  // Instance du bloc sélectionné (la 1re dans une section répétée) : ses données pour le volet droit.
  const selIid = useMemo(() => {
    if (!selected) return null;
    if (states[selected]) return selected;
    const inst = plan.instances.find((i) => i.blockId === selected);
    return inst ? inst.iid : selected;
  }, [selected, states, plan]);
  const geometry = useCallback((sectionId, first = false) => pageGeometry(page, sectionById[sectionId] || {}, { first }), [page, sectionById]);
  const bodyWOf = (sectionId) => geometry(sectionId).bodyW;

  const [measures, setMeasures] = useState({});
  // Graphiques montrés en tableau (« Voir les données ») : même vue dans la page et dans la mesure.
  const [dataViews, setDataViews] = useState(() => new Set());
  const toggleDataView = useCallback((iid) => setDataViews((s) => { const n = new Set(s); if (n.has(iid)) n.delete(iid); else n.add(iid); return n; }), []);
  // Correction MESURÉE de la police des tableaux trop larges (l'estimation de reportFit est affinée
  // par la largeur réelle : facteur par tableau, jusqu'à l'échelle minimale 0,8).
  const [fitFix, setFitFix] = useState({});
  const fitRefs = useRef({}); // iid → { key, scale } du dernier rendu
  const onMeasure = useCallback((m) => {
    setMeasures(m);
    setFitFix((prev) => {
      let next = prev;
      for (const [iid, info] of Object.entries(m)) {
        const ref = fitRefs.current[iid];
        if (!info.wide || !ref || ref.scale <= MIN_SCALE + 1e-9) continue;
        if (next === prev) next = { ...prev };
        next[ref.key] = (prev[ref.key] || 1) * info.wide * 0.99;
      }
      return next;
    });
  }, []);
  const [pxPerMm, setPxPerMm] = useState(96 / 25.4);
  const onPxPerMm = useCallback((v) => setPxPerMm((x) => (Math.abs(x - v) > 0.001 ? v : x)), []);
  const [fontsReady, setFontsReady] = useState(() => !document.fonts || document.fonts.status === 'loaded');
  useEffect(() => { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setFontsReady(true)); }, []);
  const paginSections = useMemo(() => sectionsOfPlan(plan), [plan]);
  const splitOf = (inst) => {
    if (inst.column || (editable && selected === inst.blockId && ['text', 'callout', 'bulletin'].includes(inst.type))) return null;
    if (inst.type === 'text' || inst.type === 'callout' || inst.type === 'bulletin') return 'nodes';
    if (inst.type === 'data') {
      const st = states[inst.iid];
      if (!st || st.status !== 'ready') return null;
      return inst.view === 'list' ? 'list' : ROW_VIEWS.has(inst.view) ? 'rows' : null;
    }
    return null;
  };
  const pagination = useMemo(() => {
    const secs = paginSections.map((s) => {
      const g = geometry(s.id); const g1 = geometry(s.id, true);
      return {
        id: s.id, size: g.size, orientation: g.orientation,
        bodyH: Math.floor(g.bodyH * pxPerMm) - 2, firstBodyH: Math.floor(g1.bodyH * pxPerMm) - 2,
        items: s.items.map((inst) => {
          const m = measures[inst.iid];
          const scalable = inst.type === 'data' && !ROW_VIEWS.has(inst.view) && inst.view !== 'explain';
          return { iid: inst.iid, h: m ? m.h : (DEFAULT_H[inst.type] || 40), split: m && m.split, keepWithNext: inst.type === 'heading' || inst.type === 'annexhead', scalable, break: inst.type === 'pagebreak' };
        }),
      };
    });
    return paginate(secs, { gap: 12 });
  }, [paginSections, measures, pxPerMm, geometry]);
  // Titre d'une annexe : titre de la figure (ou libellé du jeu), suivi de l'élément répété.
  const annexTitle = useCallback((blockId, repeatLabel) => {
    const f = findBlock(doc.blocks, blockId);
    const p = f ? f.block.params || {} : {};
    const def = catalog.datasets[p.dataset];
    const t = (p.figure && p.figure.title ? p.figure.title.replace(/\{([a-z_]{2,40})\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : null) || (def ? tr(def.label) : p.dataset || '');
    return repeatLabel ? `${t} — ${repeatLabel}` : t;
  }, [doc.blocks, catalog, vars, tr]);
  const toc = useMemo(() => tocEntries(plan, pagination.pageOf, 2, (a) => `${tr('Annexe {l}', { l: a.letter })} — ${annexTitle(a.blockId, a.repeatLabel)}`), [plan, pagination, annexTitle, tr]);
  const measured = Object.keys(measures).length > 0 || plan.instances.length === 0;

  // ---- Mise en page d'UNE page (retour 88) -----------------------------------------------
  // Blocs de la page dans leur liste (racine, ou section répétée quand toute la page en vient) :
  // reportDoc.setPageLayout les place dans une section propre, les autres pages ne changent pas.
  const pageInfo = useMemo(() => {
    const pg = selPage ? pagination.pages[selPage - 1] : null;
    if (!pg) return null;
    const g = geometry(pg.sectionId, pg.n === 1);
    const base = { n: pg.n, total: pagination.total, size: g.size, orientation: g.orientation, sectionId: pg.sectionId };
    const psec = sectionById[pg.sectionId] || {};
    if (psec.annex) {
      // Page d'annexe : son orientation est un réglage du bloc annexé (auto, portrait, paysage).
      const a = (plan.annexes || []).find((x) => x.iid === psec.annex.iid) || {};
      const fb = a.blockId ? findBlock(doc.blocks, a.blockId) : null;
      return { ...base, scope: null, annex: { letter: psec.annex.letter, blockId: a.blockId, title: annexTitle(a.blockId, a.repeatLabel), mode: (fb && fb.block.params.annexOrientation) || 'auto' } };
    }
    const insts = pg.items.map((it) => instById[it.iid]).filter((i) => i && i.blockId);
    if (!insts.length) return { ...base, scope: null };
    const reps = new Set(insts.map((i) => i.repeatId || null));
    const container = reps.size === 1 && [...reps][0] ? [...reps][0] : null;
    const list = container ? ((findBlock(doc.blocks, container) || {}).block || { params: { blocks: [] } }).params.blocks : doc.blocks;
    const idx = insts.map((i) => list.findIndex((b) => b.id === (container ? i.blockId : (i.repeatId || i.blockId)))).filter((x) => x >= 0);
    if (!idx.length) return { ...base, scope: null };
    const secIid = pg.sectionId !== '_doc' ? pg.sectionId : null;
    const secBlock = secIid ? (findBlock(doc.blocks, secIid.split('~').pop()) || {}).block : null;
    const first = pg.items[0];
    const firstInst = instById[first.iid];
    const startsMid = first.part && !first.first && firstInst ? frameLabel((findBlock(doc.blocks, firstInst.blockId) || {}).block || { type: firstInst.type, params: {} }, catalog, tr) : null;
    const rb = container ? (findBlock(doc.blocks, container) || {}).block : null;
    return {
      ...base,
      scope: { container, firstId: list[Math.min(...idx)].id, lastId: list[Math.max(...idx)].id },
      firstIid: first.iid,
      own: !!(secBlock && (secBlock.params.orientation || secBlock.params.size || (secBlock.params.header || 'inherit') !== 'inherit' || (secBlock.params.footer || 'inherit') !== 'inherit')),
      secBlockId: secBlock ? secBlock.id : null,
      header: secBlock ? secBlock.params.header || 'inherit' : 'inherit',
      footer: secBlock ? secBlock.params.footer || 'inherit' : 'inherit',
      repeatLabel: rb ? tr({ activity: 'Activité (fiche de suivi)', bureau: 'Bureau', partner: 'Partenaire' }[rb.params.over] || 'Section répétée') : null,
      startsMid,
    };
  }, [selPage, pagination, geometry, instById, sectionById, plan, annexTitle, doc.blocks, catalog, tr]);
  // Après un changement, la page reste sélectionnée : celle qui commence par le même bloc.
  const pageAnchor = useRef(null);
  useEffect(() => {
    const a = pageAnchor.current;
    if (!a) return;
    const pg = pagination.pages.find((p) => p.items.some((it) => it.iid === a));
    if (pg) { pageAnchor.current = null; setSelPage(pg.n); }
  }, [pagination]);
  const layoutPage = (patch) => {
    if (!pageInfo || !pageInfo.scope) return;
    pageAnchor.current = pageInfo.firstIid;
    change((d) => ({ ...d, blocks: setPageLayout(d.blocks, { ...pageInfo.scope, patch }).blocks }));
  };

  // ---- Concepteur d'en-tête et de pied de page (retours 51 et 88) -----------------------
  const emptyBand = (h) => ({ height: h, elements: [] });
  /** En-tête / pied de CETTE page : du document, aucun, ou propres (copie de ceux en vigueur, à redessiner). */
  const setPageBands = (patch) => {
    const p = {};
    for (const k of ['header', 'footer']) {
      if (patch[k] == null) continue;
      const bandKey = k === 'header' ? 'headerBand' : 'footerBand';
      p[k] = patch[k];
      p[bandKey] = patch[k] === 'own' ? JSON.parse(JSON.stringify(page[k] && page[k].elements && page[k].elements.length ? page[k] : emptyBand(k === 'header' ? 14 : 10))) : undefined;
    }
    layoutPage(p);
  };
  /** Ouverture : depuis l'onglet Page (document), un double-clic sur une bande, ou une page à en-tête propre. */
  const onEditBand = ({ place, sectionId, first }) => {
    const sec = sectionById[sectionId] || {};
    const mode = place === 'header' ? sec.header : sec.footer;
    if (mode === 'own' && sectionId !== '_doc') { setBandEditor({ scope: 'section', sectionBlockId: String(sectionId).split('~').pop(), startZone: place }); return; }
    const firstOwn = first && page.firstPage === 'own';
    setBandEditor({ scope: 'doc', startZone: firstOwn ? (place === 'header' ? 'firstHeader' : 'firstFooter') : place });
  };
  const bandSetup = useMemo(() => {
    if (!bandEditor) return null;
    if (bandEditor.scope === 'section') {
      const f = findBlock(doc.blocks, bandEditor.sectionBlockId);
      if (!f) return null;
      const p = f.block.params || {};
      const zones = ['header', 'footer'].filter((k) => p[k] === 'own');
      return {
        zones: zones.length ? zones : ['header'],
        // Images du rapport HORS des bandes éditées (limite du serveur : avertie avant d'appliquer).
        otherImages: docImageCount(doc) - zones.reduce((n, k) => n + bandImageCount(p[`${k}Band`]), 0),
        initial: { header: p.headerBand || emptyBand(14), footer: p.footerBand || emptyBand(10) },
        orientation: p.orientation || page.orientation || 'portrait', size: p.size || page.size || 'A4',
      };
    }
    return {
      zones: null,
      otherImages: docImageCount(doc) - layoutImageCount(page),
      initial: { header: page.header || emptyBand(14), footer: page.footer || emptyBand(10), firstPage: page.firstPage || 'same', firstHeader: page.firstHeader, firstFooter: page.firstFooter },
      orientation: page.orientation || 'portrait', size: page.size || 'A4',
    };
  }, [bandEditor, doc, page]);
  const applyBands = (v) => {
    const be = bandEditor;
    if (be.scope === 'section') {
      const f = findBlock(doc.blocks, be.sectionBlockId);
      const p = (f && f.block.params) || {};
      updateBlock(be.sectionBlockId, { ...(p.header === 'own' ? { headerBand: v.header } : {}), ...(p.footer === 'own' ? { footerBand: v.footer } : {}) });
    } else {
      // Paire 1re page / pages suivantes ; les bandes de la 1re page sont gardées même quand elle
      // redevient « identique » ou « page de titre » (rien n'est perdu en changeant d'avis).
      change((d) => {
        const pg = { ...(d.page || defaultPage()), header: v.header, footer: v.footer, firstPage: v.firstPage || 'same' };
        if (v.firstHeader) pg.firstHeader = v.firstHeader; else delete pg.firstHeader;
        if (v.firstFooter) pg.firstFooter = v.firstFooter; else delete pg.firstFooter;
        return { ...d, page: pg };
      });
    }
    setBandEditor(null);
  };

  // ---- Exports ------------------------------------------------------------------------
  const sheetsRef = useRef(null);
  const cleanClone = () => {
    const root = sheetsRef.current.cloneNode(true);
    root.querySelectorAll('.rd-mini, .rd-add-between, .rd-sheet-chip, .rd-fitchip, .rd-repeat-chip, .rd-toobig, .rb-pagebreak span, .rt-toolbar, .rb-showdata, .rd-el-ph').forEach((n) => n.remove());
    root.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    root.querySelectorAll('.is-selected, .is-page-selected').forEach((n) => n.classList.remove('is-selected', 'is-page-selected'));
    root.querySelectorAll('.rd-sheet').forEach((n) => { n.style.transform = ''; });
    root.querySelectorAll('.rd-sheet-slot').forEach((n) => { n.style.width = ''; n.style.height = ''; });
    return root;
  };
  const download = (content, name, type) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const fileBase = (doc.title || 'Rapport').replace(/[^\w\-À-ÿ ]+/g, '').trim().slice(0, 80) || 'Rapport';
  // HTML : les feuilles paginées, styles en ligne (impression identique à l'aperçu).
  // Les logos (URL blob: de la session) deviennent des images data: : le fichier HTML est autonome.
  const exportHtml = async () => {
    const root = cleanClone();
    for (const img of root.querySelectorAll('img[data-asset]')) {
      const d = await assetDataUrl(img.getAttribute('data-asset'));
      if (d) img.setAttribute('src', d); else img.remove();
    }
    download(`<!doctype html><html lang="${document.documentElement.lang || 'fr'}"><head><meta charset="utf-8"><title>${fileBase}</title><style>body{background:#f5f6f9;margin:0;padding:24px}${reportCss}</style></head><body class="rd-export">${root.outerHTML}</body></html>`, `${fileBase}.html`, 'text/html;charset=utf-8');
  };
  // Word (HTML lu par Word) : le contenu des pages à la suite, un saut de page entre deux feuilles.
  const exportWord = () => {
    const bodies = [...cleanClone().querySelectorAll('.rd-sheet-body')].map((b) => b.innerHTML).join('<br clear="all" style="page-break-before:always">');
    download(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${fileBase}</title><style>${reportCss}.rd-word{font-family:Calibri,Arial,sans-serif}</style></head><body><article class="rd-word rd-paper">${bodies}</article></body></html>`, `${fileBase}.doc`, 'application/msword');
  };
  // PDF : impression des feuilles pré-découpées (pages nommées a4p / a4l / s169l…).
  const exportPdf = async () => {
    const kinds = new Set(pagination.pages.map((p) => pageName(p.size, p.orientation)));
    const named = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('page', 'a4l');
    if (kinds.size > 1 && !named && !window.confirm(tr('Ce navigateur imprime toutes les pages dans la même orientation : utilisez Chrome ou Edge, ou l\'export Word. Imprimer quand même ?'))) return;
    setSelected(null);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    setTimeout(() => window.print(), 80); // laisse React retirer la sélection et les outils
  };
  // Impression (bouton ou Ctrl+P) : seules les feuilles sont imprimées.
  useEffect(() => {
    const on = () => document.body.classList.add('rd-printing');
    const off = () => document.body.classList.remove('rd-printing');
    window.addEventListener('beforeprint', on); window.addEventListener('afterprint', off);
    return () => { window.removeEventListener('beforeprint', on); window.removeEventListener('afterprint', off); off(); };
  }, []);

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

  /** « Mettre ce bloc sur une page paysage » : sections insérées autour du bloc (reportDoc.landscapeAround). */
  const toLandscape = (blockId, previous) => {
    const r = landscapeAround(doc.blocks, blockId, previous);
    if (r.error) { toast.error(tr(r.error)); return; }
    setBlocks(() => r.blocks);
  };
  /** Bloc « données » effectivement en annexe (marqué, ou au-delà du seuil de lignes du document). */
  const annexedIds = useMemo(() => new Set((plan.annexes || []).map((a) => a.blockId)), [plan]);
  const toggleAnnex = (b) => updateBlock(b.id, { annex: annexedIds.has(b.id) ? false : true });
  /** Mini-barre du bloc sélectionné : monter, descendre, dupliquer, supprimer, annexe, options. */
  const miniBar = (b, { inColumns = false } = {}) => (
    <div className="rd-mini" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setBlocks((bs) => moveBlock(bs, b.id, -1))} aria-label={tr('Monter')} title={tr('Monter')}><ChevronUp size={14} /></button>
      <button type="button" onClick={() => setBlocks((bs) => moveBlock(bs, b.id, 1))} aria-label={tr('Descendre')} title={tr('Descendre')}><ChevronDown size={14} /></button>
      <button type="button" onClick={() => setBlocks((bs) => duplicateBlock(bs, b.id))} aria-label={tr('Dupliquer')} title={tr('Dupliquer (Ctrl+D)')}><Copy size={14} /></button>
      <button type="button" onClick={() => remove(b.id)} aria-label={tr('Supprimer')} title={tr('Supprimer (Suppr)')}><Trash2 size={14} /></button>
      {b.type === 'data' && !inColumns && (
        <button type="button" onClick={() => toggleAnnex(b)} aria-pressed={annexedIds.has(b.id)} className={annexedIds.has(b.id) ? 'is-on' : ''}
          aria-label={tr(annexedIds.has(b.id) ? 'Remettre dans le corps du rapport' : 'Placer en annexe')} title={tr(annexedIds.has(b.id) ? 'Remettre dans le corps du rapport' : 'Placer en annexe')}><Paperclip size={14} /></button>
      )}
      <button type="button" onClick={() => setRightOpen(true)} aria-label={tr('Options du bloc')} title={tr('Options du bloc')}><SlidersHorizontal size={14} /></button>
    </div>
  );
  const addBetween = (b) => (
    <button type="button" className="rd-add-between" aria-label={tr('Ajouter un bloc ici')} title={tr('Ajouter un bloc ici')}
      onClick={(e) => { e.stopPropagation(); setSelected(b.id); setLeftTab('catalog'); setLeftOpen(true); setTimeout(() => searchRef.current && searchRef.current.focus(), 0); }}>
      <Plus size={13} aria-hidden="true" />
    </button>
  );

  /**
   * Un bloc FEUILLE dans la page ou dans le calque de mesure. `repeat` = { id, key, label, over } ;
   * `o` = { measure, slice, scale, tooTall, inst, inColumns }.
   */
  const renderLeaf = (b, repeat, first, o = {}) => {
    const iid = iidOf(b.id, repeat);
    const inst = o.inst || instById[iid] || { iid, sectionId: '_doc' };
    const visible = !o.measure;
    const isSel = selected === b.id;
    const slice = o.slice || null;
    const editing = (b.type === 'text' || b.type === 'callout' || b.type === 'bulletin') && editable && isSel && first && visible;
    if (editing && slice && !slice.first) return null; // texte en cours d'édition : en entier sur son 1er morceau
    const st = states[iid];
    const res = st ? st.result : undefined;
    const ready = res && res.ok ? res.data : null;
    const p = b.params || {};
    const itemVars = repeat ? { [{ activity: 'activite', bureau: 'bureau', partner: 'partenaire' }[repeat.over]]: repeat.label } : {};
    const editor = editing
      ? <RichTextEditor doc={p.doc || res?.data?.doc} vars={{ ...vars, ...(res?.data?.vars || {}) }} labelFor={(v) => tr(varLabels[v] || v)} variableList={variableList}
        onChange={(d) => updateBlock(b.id, { doc: d })} /> : null;
    // Largeur du tableau : police réduite (≥ 0,8) ou « trop large » (même calcul dans la mesure et la page).
    const view = p.view || defaultView(p.dataset);
    const def = b.type === 'data' ? catalog.datasets[p.dataset] : null;
    let fit = null;
    if (b.type === 'data' && ready && (view === 'table' || view === 'heat') && ready.rows && ready.rows.length) {
      const widthMm = o.inColumns ? bodyWOf(inst.sectionId) / 2 : bodyWOf(inst.sectionId);
      const est = tableFit(ready, p.columns, widthMm, def && def.annotate ? { extra: [{ key: '_annot', type: 'text', label: def.annotate.label, maxChars: 30, maxWord: 12 }] } : undefined);
      const key = `${iid}|${(p.columns || []).join(',')}|${ready.rows.length}|${Math.round(widthMm)}`;
      const raw = est.scale * (fitFix[key] || 1);
      const scale = Math.max(MIN_SCALE, Math.floor(raw * 100) / 100);
      if (o.measure) fitRefs.current[iid] = { key, scale };
      fit = { scale, tooWide: est.tooWide || raw < MIN_SCALE || (scale <= MIN_SCALE && !!(measures[iid] && measures[iid].wide)) };
    }
    const ctx = { result: res, inst, vars: { ...vars, ...itemVars }, catalog, varLabels, slice, fit, toc, showData: dataViews.has(iid), onToggleData: () => toggleDataView(iid) };
    const showTools = visible && editable && first && (!slice || slice.first);
    const dropCls = visible && drop && drop.id === b.id ? (drop.before ? 'is-drop-before' : 'is-drop-after') : '';
    const sectionOrient = (sectionById[inst.sectionId] || {}).orientation || page.orientation || 'portrait';
    const body = FRAMED.has(b.type)
      ? (
        <BlockFrame iid={iid} state={st} label={frameLabel(b, catalog, tr)} height={heights.current.get(iid) || DEFAULT_H[b.type]}
          onRetry={visible ? retry : undefined} observe={visible ? observe : undefined} onHeight={o.measure ? onHeight : undefined}>
          <BlockView block={b} ctx={ctx} editor={editor} />
        </BlockFrame>
      )
      : <BlockView block={b} ctx={{ ...ctx, pending: st && st.status !== 'ready' && st.status !== 'error' }} editor={editor} />;
    const scaled = o.scale && o.scale < 1 && measures[iid]
      ? <div className="rd-scaled" style={{ height: `${measures[iid].h * o.scale}px` }}><div style={{ transform: `scale(${o.scale})`, width: `${100 / o.scale}%` }}>{body}</div></div>
      : body;
    return (
      <div key={slice ? `${iid}:${slice.part[0]}` : iid} data-block={b.id} data-iid={visible ? iid : undefined} className={`rd-block rd-block-${b.type} ${visible && isSel ? 'is-selected' : ''} ${dropCls}`}
        onClick={visible ? (e) => { e.stopPropagation(); if (first) setSelected(b.id); } : undefined} {...(visible && !repeat && !o.inColumns ? dragProps(b) : {})}>
        {visible && repeat && firstOfItem.has(iid) && (!slice || slice.first) && (
          <button type="button" className="rd-repeat-chip" onClick={(e) => { e.stopPropagation(); setSelected(repeat.id); }}>
            <Repeat size={11} aria-hidden="true" /> {repeat.label}
          </button>
        )}
        {scaled}
        {visible && fit && fit.tooWide && editable && (!slice || slice.first) && (
          <div className="rd-fitchip" role="note" onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={13} aria-hidden="true" />
            <span>{tr(sectionOrient === 'landscape' ? 'Tableau trop large, même en paysage : choisissez moins de colonnes.' : 'Tableau trop large pour la page.')}</span>
            {sectionOrient !== 'landscape' && !o.inColumns && (
              <button type="button" onClick={() => toLandscape(b.id, sectionOrient)}>{tr('Mettre ce bloc sur une page paysage')}</button>
            )}
          </div>
        )}
        {visible && o.tooTall && editable && <div className="rd-toobig" role="note"><AlertTriangle size={13} aria-hidden="true" /> {tr('Bloc plus haut qu\'une page')}</div>}
        {showTools && isSel ? miniBar(b, { inColumns: !!o.inColumns }) : null}
        {showTools && !repeat && !o.inColumns ? addBetween(b) : null}
      </div>
    );
  };

  /** Un élément de la pagination : bloc feuille ou colonnes (insécables). */
  /** Renvoi « Voir l'annexe A — titre · page n » (corps) et titre de la page d'annexe. */
  const renderAnnexItem = (inst, o) => {
    const visible = !o.measure;
    const isSel = selected === inst.blockId;
    const letter = inst.annex ? inst.annex.letter : '?';
    const title = annexTitle(inst.blockId, inst.repeatLabel);
    const first = !inst.repeatId || firstKeyOf[inst.repeatId] === inst.repeatKey;
    const isRef = inst.type === 'annexref';
    const pg = pagination.pageOf[`annexhead~${inst.target}`];
    const found = findBlock(doc.blocks, inst.blockId);
    return (
      <div key={inst.iid} data-block={inst.blockId} data-iid={visible ? inst.iid : undefined} className={`rd-block rd-block-${inst.type} ${visible && isSel ? 'is-selected' : ''}`}
        onClick={visible ? (e) => { e.stopPropagation(); if (first) setSelected(inst.blockId); } : undefined}>
        {isRef ? (
          <p className="rb-annex-ref">
            <Paperclip size={13} aria-hidden="true" className="rb-annex-ico" />
            <span className="rb-annex-txt"><b>{tr('Voir l\'annexe {l}', { l: letter })}</b> — {title}</span>
            {pg != null && <span className="rb-annex-pg">{tr('page {n}', { n: pg })}</span>}
          </p>
        ) : (
          <div className="rb-annex-head">
            <span className="rb-annex-l">{tr('Annexe {l}', { l: letter })}</span>
            <h2 className="rb-annex-t">{title}</h2>
          </div>
        )}
        {visible && editable && first && isSel && isRef && found ? miniBar(found.block) : null}
      </div>
    );
  };

  const renderItem = (inst, o = {}) => {
    if (inst.type === 'annexref' || inst.type === 'annexhead') return renderAnnexItem(inst, o);
    const found = findBlock(doc.blocks, inst.blockId);
    if (!found) return null;
    const b = found.block;
    const rb = inst.repeatId ? findBlock(doc.blocks, inst.repeatId) : null;
    const repeat = inst.repeatId ? { id: inst.repeatId, key: inst.repeatKey, label: inst.repeatLabel, over: rb ? rb.block.params.over : 'activity' } : null;
    const first = !repeat || firstKeyOf[inst.repeatId] === inst.repeatKey;
    if (b.type !== 'columns') return renderLeaf(b, repeat, first, { ...o, inst });
    const visible = !o.measure;
    const isSel = selected === b.id;
    const dropCls = visible && drop && drop.id === b.id ? (drop.before ? 'is-drop-before' : 'is-drop-after') : '';
    return (
      <div key={inst.iid} data-block={b.id} data-iid={visible ? inst.iid : undefined} className={`rd-block rd-columns rd-cols-${b.params.ratio.replace(/:/g, '-')} ${visible && isSel ? 'is-selected' : ''} ${dropCls}`}
        onClick={visible ? (e) => { e.stopPropagation(); if (first) setSelected(b.id); } : undefined} {...(visible && !repeat ? dragProps(b) : {})}>
        {b.params.cols.map((col, c) => (
          <div key={c} className="rd-col">
            {col.length ? col.map((cb) => renderLeaf(cb, repeat, first, { ...o, inst: instById[iidOf(cb.id, repeat)], inColumns: true, slice: null }))
              : visible && editable ? <p className="rb-note">{tr('Colonne vide : sélectionnez les colonnes puis ajoutez un bloc.')}</p> : null}
          </div>
        ))}
        {visible && editable && first && isSel ? miniBar(b) : null}
        {visible && editable && first && !repeat ? addBetween(b) : null}
      </div>
    );
  };
  const renderPageItem = (it) => {
    const inst = instById[it.iid];
    if (!inst) return null;
    return renderItem(inst, { slice: it.part ? { part: it.part, first: it.first, last: it.last } : null, scale: it.scale, tooTall: it.tooTall });
  };

  const upgradedDraft = meta.upgradedFrom === 1 && !final;
  const pagesList = pagination.pages.map((pg) => {
    const h = pg.items.map((it) => instById[it.iid]).find((i) => i && i.type === 'heading');
    const sec = sectionById[pg.sectionId] || {};
    if (sec.annex) {
      const a = (plan.annexes || []).find((x) => x.iid === sec.annex.iid) || {};
      return { n: pg.n, size: pg.size, orientation: pg.orientation, title: annexTitle(a.blockId, a.repeatLabel), annex: sec.annex.letter };
    }
    const own = (pg.orientation || 'portrait') !== (page.orientation || 'portrait') || (pg.size || 'A4') !== (page.size || 'A4');
    return { n: pg.n, size: pg.size, orientation: pg.orientation, title: (h && h.text) || sec.title || null, own };
  });
  const goPage = (p) => {
    const el = document.getElementById(`rd-sheet-${p.n}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // La page devient la sélection : le volet droit montre SA mise en page (orientation, format…).
    setSelected(null); setSelPage(p.n);
    if (narrow) { setLeftOpen(false); setRightOpen(true); }
  };
  const selectSection = (sectionId) => {
    if (sectionId === '_doc') { setSelected(null); setRightOpen(true); return; }
    const inst = instById[sectionId];
    setSelected(inst ? inst.blockId : sectionId);
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
      {leftTab === 'pages' && <PagesPane pages={pagesList} selected={selPage} onGo={goPage} />}
    </>
  );
  const pageMode = !sel && !!pageInfo;
  const rightPane = (
    <>
      {narrow && <div className="rd-drawer-h"><strong>{tr('Propriétés')}</strong><button type="button" className="rd-drawer-x" onClick={() => setRightOpen(false)} aria-label={tr('Fermer')}><X size={15} /></button></div>}
      {pageMode ? (
        <>
          <div className="rd-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="true" className="is-active">{tr('Cette page')}</button>
            <button type="button" role="tab" aria-selected="false" onClick={() => setSelPage(null)}>{tr('Document')}</button>
          </div>
          <div className="rd-pane-body">
            <PageLayoutPane info={pageInfo} docPage={page} onLayout={layoutPage} onReset={() => layoutPage({ orientation: undefined, size: undefined, header: 'inherit', footer: 'inherit', headerBand: undefined, footerBand: undefined })}
              onBands={setPageBands} onDesignBands={() => pageInfo && pageInfo.secBlockId && setBandEditor({ scope: 'section', sectionBlockId: pageInfo.secBlockId, startZone: pageInfo.header === 'own' ? 'header' : 'footer' })}
              onAnnexOrientation={(v) => pageInfo.annex && pageInfo.annex.blockId && updateBlock(pageInfo.annex.blockId, { annexOrientation: v === 'auto' ? undefined : v })} />
          </div>
        </>
      ) : (
        <PropertiesPane sel={sel} doc={doc} catalog={catalog} forms={forms} opts={opts} state={selIid ? states[selIid] : null}
          annex={sel && sel.block.type === 'data' ? { effective: annexedIds.has(sel.block.id), inColumn: !!(sel.parent && sel.parent.type === 'columns'), autoRows } : null}
          onChangeBlock={(patch) => sel && updateBlock(sel.block.id, patch)} onRegenerate={() => sel && updateBlock(sel.block.id, { doc: undefined })}
          onChangePage={(pg) => change((d) => ({ ...d, page: { ...(d.page || defaultPage()), ...pg } }))}
          pageExtra={{ vars, onDesignBands: () => setBandEditor({ scope: 'doc', startZone: 'header' }) }}
          onChangeAnnexes={(annexes) => change((d) => { const n = { ...d }; if (annexes) n.annexes = annexes; else delete n.annexes; return n; })} />
      )}
    </>
  );
  const exportBlocked = !fontsReady ? tr('Chargement des polices…') : !measured ? tr('Mise en page en cours…') : null;
  const watermark = !final && page.draftWatermark !== false ? tr('BROUILLON — non validé') : null;
  const selectedSection = sel && sel.block.type === 'section' ? (plan.instances.find((i) => i.blockId === sel.block.id) || {}).iid : null;

  return (
    <div className={`rd-editor ${narrow ? 'is-narrow' : ''}`} style={{ '--rd-top': `${topbarH}px` }}>
      <Topbar doc={doc} meta={meta} dirty={dirty} saving={saving} editable={editable} canEdit={canEdit && !phone} final={final}
        computing={computing} progress={progress} history={history} forms={forms} opts={opts} topbarRef={topbarRef} exportBlocked={exportBlocked}
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

        <main className="rd-canvas" onClick={() => { setSelected(null); setSelPage(null); }}
          onDragOver={(e) => { if (editable && isBlockDrag(e)) e.preventDefault(); }}
          onDrop={(e) => {
            if (!editable || !isBlockDrag(e)) return;
            e.preventDefault(); setDrop(null);
            let payload = null; try { payload = JSON.parse(e.dataTransfer.getData('text/x-mems-block')); } catch { /* glisser étranger */ }
            onDropPayload(payload, {});
          }}>
          <PagedPreview pages={pagination.pages} geometryOf={(pg) => geometry(pg.sectionId, pg.n === 1)} sectionOf={(id) => sectionById[id]}
            renderPageItem={renderPageItem} page={page} vars={vars} pxPerMm={pxPerMm} forceFit={phone} watermark={watermark}
            selectedSection={selectedSection} onSelectSection={selectSection} sheetsRef={sheetsRef}
            selectedPage={editable ? selPage : null} onSelectPage={editable ? (n) => { setSelected(null); setSelPage(n); if (narrow) setRightOpen(true); } : undefined}
            onEditBand={editable ? onEditBand : undefined}
            emptyNote={doc.blocks.length === 0 ? <p className="rd-empty-doc">{tr('Le rapport est vide : ajoutez des blocs depuis le catalogue (clic ou glisser sur la page).')}</p> : null} />
          <MeasureLayer sections={paginSections.map((s) => ({ id: s.id, bodyW: geometry(s.id).bodyW, items: s.items }))}
            renderItem={renderItem} splitOf={splitOf} onMeasure={onMeasure} onPxPerMm={onPxPerMm} />
        </main>

        {editable && (!narrow || rightOpen) && <aside className={`rd-right ${narrow ? 'is-drawer' : ''}`} aria-label={tr('Propriétés')}>{rightPane}</aside>}
      </div>
      {editable && narrow && (leftOpen || rightOpen) && <div className="rd-drawer-backdrop" onClick={() => { setLeftOpen(false); setRightOpen(false); }} aria-hidden="true" />}
      {editable && bandEditor && bandSetup && (
        <HeaderDesigner initial={bandSetup.initial} scope={bandEditor.scope} zones={bandSetup.zones} page={page} orientation={bandSetup.orientation} size={bandSetup.size} otherImages={bandSetup.otherImages}
          vars={vars} startZone={bandEditor.startZone} canSave={canEdit} onApply={applyBands} onClose={() => setBandEditor(null)} />
      )}
    </div>
  );
}
