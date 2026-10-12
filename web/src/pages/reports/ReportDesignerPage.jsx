import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, FileText, Save, Lock, Download, Printer, FileSpreadsheet, FileCode2, ChevronUp, ChevronDown, Copy, Trash2,
  ArrowLeft, Heading1, Type, MessageSquareWarning, Gauge, Table2, BarChart3, Sparkles, SeparatorHorizontal, Minus, Repeat, LayoutTemplate, RefreshCw, GripVertical,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatDateTime } from '../../lib/format.js';
import { BlockView } from './ReportBlocks.jsx';
import { RichTextEditor } from './RichText.jsx';
import reportCss from './reports.css?raw';
import './reports.css';

/**
 * Concepteur de rapport professionnel : documents faits de blocs (texte riche
 * éditable, chiffres clés, tableaux, graphiques, bulletin rédigé, sections
 * répétées par activité/bureau), modèles système et enregistrés, période,
 * enregistrement versionné (verrou optimiste), finalisation figée, exports
 * PDF / HTML / Word / Excel. Les données sont calculées côté serveur.
 */
const BLOCK_TYPES = [
  ['heading', 'Titre', Heading1], ['text', 'Texte', Type], ['callout', 'Encadré', MessageSquareWarning],
  ['kpis', 'Chiffres clés', Gauge], ['table', 'Tableau', Table2], ['chart', 'Graphique', BarChart3],
  ['bulletin', 'Bulletin rédigé', Sparkles], ['repeat', 'Section répétée', Repeat],
  ['pagebreak', 'Saut de page', SeparatorHorizontal], ['divider', 'Séparateur', Minus],
];
const TYPE_LABEL = Object.fromEntries(BLOCK_TYPES.map(([k, l]) => [k, l]));
const TYPE_ICON = Object.fromEntries(BLOCK_TYPES.map(([k, , I]) => [k, I]));

let seq = 0;
const newId = (t) => `${t}-${Date.now().toString(36)}${(seq += 1).toString(36)}`;
const emptyDoc = () => ({ nodes: [{ t: 'p', c: [{ x: '' }] }] });
function defaultBlock(type) {
  const id = newId(type);
  switch (type) {
    case 'heading': return { id, type, params: { text: 'Nouveau titre', level: 2 } };
    case 'text': return { id, type, params: { doc: emptyDoc() } };
    case 'callout': return { id, type, params: { tone: 'info', title: 'À retenir', doc: emptyDoc() } };
    case 'kpis': return { id, type, params: { metrics: ['sites_visited', 'coverage', 'conformity'], filters: {} } };
    case 'table': return { id, type, params: { title: '', dataset: 'activity_coverage', filters: {} } };
    case 'chart': return { id, type, params: { title: '', dataset: 'plan_vs_actual', kind: 'bar', filters: {} } };
    case 'bulletin': return { id, type, params: { filters: {} } };
    case 'repeat': return { id, type, params: { over: 'activity', blocks: [{ id: newId('heading'), type: 'heading', params: { text: '{activite}', level: 2 } }, { id: newId('kpis'), type: 'kpis', params: { metrics: ['sites_visited', 'coverage', 'conformity'], filters: {} } }] } };
    default: return { id, type, params: {} };
  }
}
const cloneWithIds = (b) => (b.type === 'repeat'
  ? { ...b, id: newId(b.type), params: { ...b.params, blocks: b.params.blocks.map((c) => ({ ...c, id: newId(c.type) })) } }
  : { ...JSON.parse(JSON.stringify(b)), id: newId(b.type) });

/**
 * Contenu d'un modèle SYSTÈME rédigé dans la langue de l'interface : en-tête,
 * pied, titres et textes d'exemple passent par le dictionnaire (les {variables}
 * restent intactes). Les modèles d'équipe sont du contenu utilisateur : inchangés.
 */
function localizeTemplate(content, tr) {
  const t = (x) => (typeof x === 'string' && x ? tr(x) : x);
  const docOf = (d) => d && { nodes: d.nodes.map((n) => ({ ...n, ...(n.c && { c: n.c.map((sg) => (sg.v ? sg : { ...sg, x: t(sg.x) })) }), ...(n.items && { items: n.items.map((it) => it.map((sg) => (sg.v ? sg : { ...sg, x: t(sg.x) }))) }) })) };
  const block = (b) => {
    const q = { ...b.params };
    if (q.text) q.text = t(q.text);
    if (q.title) q.title = t(q.title);
    if (q.doc) q.doc = docOf(q.doc);
    if (b.type === 'repeat') q.blocks = q.blocks.map(block);
    return { ...b, params: q };
  };
  const page = { ...(content.page || {}) };
  if (page.header) page.header = t(page.header);
  if (page.footer) page.footer = t(page.footer);
  return { page, blocks: (content.blocks || []).map(block) };
}

const thisYear = () => new Date().getFullYear();
const defaultPeriod = () => ({ from: `${thisYear()}-01`, to: `${thisYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` });

// Signature des paramètres qui changent les DONNÉES (le texte n'en fait pas partie).
function dataSignature(doc) {
  const strip = (b) => (b.type === 'repeat' ? { t: b.type, o: b.params.over, c: b.params.blocks.map(strip) }
    : ['table', 'chart', 'kpis'].includes(b.type) ? { t: b.type, i: b.id, p: { ...b.params, title: undefined } }
      : b.type === 'bulletin' ? { t: b.type, i: b.id, g: !b.params.doc, f: b.params.filters } : null);
  return JSON.stringify({ p: doc.period, b: doc.blocks.map(strip).filter(Boolean) });
}

export default function ReportDesignerPage({ canEdit, isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [catalog, setCatalog] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [custom, setCustom] = useState([]);
  const [open, setOpen] = useState(null); // { doc, meta }
  const [creating, setCreating] = useState(false);

  const loadLibrary = useCallback(async () => {
    try {
      const [c, d, t] = await Promise.all([api.reportCatalog(), api.reportDocuments(), api.reportTemplates()]);
      setCatalog(c); setDocuments(d); setCustom(t);
    } catch (e) { toast.error(e.message); setDocuments([]); }
  }, [toast]);
  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  async function openDocument(id) {
    try {
      const d = await api.reportDocument(id);
      setOpen({ doc: d.content, meta: { id: d.id, version: d.version, status: d.status, templateKey: d.templateKey, finalizedAt: d.finalizedAt } });
    } catch (e) { toast.error(e.message); }
  }

  if (open && catalog) {
    return <ReportEditor catalog={catalog} initial={open} canEdit={canEdit} customTemplates={custom}
      onClose={() => { setOpen(null); loadLibrary(); }} onTemplatesChanged={loadLibrary} />;
  }

  const templates = [...(catalog?.templates || []), ...custom.map((t) => ({ key: t.id, name: t.name, description: t.description, system: false, content: t.content }))];
  return (
    <div className="section-gap">
      <div className="page-header">
        <div>
          <h1 className="page-title">{tr('Concepteur de rapport')}</h1>
          <p className="page-desc">{tr('Rapports et bulletins composés de blocs : texte libre, chiffres clés, tableaux, graphiques et sections par activité, calculés sur la période choisie.')}</p>
        </div>
        {canEdit && <div className="header-actions"><Button icon={Plus} onClick={() => setCreating(true)} disabled={!catalog}>{tr('Nouveau rapport')}</Button></div>}
      </div>

      <Card aria-labelledby="rd-docs">
        <CardHeader id="rd-docs" title={tr('Mes rapports')} />
        {documents === null ? <div className="card-body"><Skeleton height={140} /></div> : documents.length === 0 ? (
          <EmptyState icon={FileText} title={tr('Aucun rapport')}
            action={canEdit ? <Button icon={Plus} onClick={() => setCreating(true)} disabled={!catalog}>{tr('Nouveau rapport')}</Button> : null}>
            {tr('Partez d\'un modèle (rapport de suivi de performances, bulletin mensuel, situation budgétaire…) puis adaptez-le librement.')}
          </EmptyState>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">{tr('Titre')}</th><th scope="col">{tr('Période')}</th><th scope="col">{tr('Statut')}</th><th scope="col">{tr('Mis à jour')}</th><th scope="col" aria-label={tr('Actions')} /></tr></thead>
            <tbody>{documents.map((d) => (
              <tr key={d.id} className="row-click" onClick={() => openDocument(d.id)}>
                <td><strong>{d.title}</strong></td>
                <td className="tabular">{d.periodFrom === d.periodTo ? d.periodFrom : `${d.periodFrom} → ${d.periodTo}`}</td>
                <td>{d.status === 'final' ? <Badge tone="green" icon={Lock}>{tr('Finalisé')}</Badge> : <Badge tone="yellow">{tr('Brouillon')}</Badge>}</td>
                <td className="tabular">{formatDateTime(d.updatedAt)}</td>
                <td className="mmr-actions">{canEdit && (d.status !== 'final' || isAdmin) && <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm(tr('Supprimer « {name} » ?', { name: d.title }))) return;
                  try { await api.reportDeleteDocument(d.id); loadLibrary(); } catch (err) { toast.error(err.message); }
                }} />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <Card aria-labelledby="rd-tpl">
        <CardHeader id="rd-tpl" title={tr('Modèles')} subtitle={tr('Modèles préconfigurés et modèles enregistrés par votre équipe.')} />
        <div className="rd-templates">
          {templates.map((t) => (
            <div key={t.key} className="rd-tpl">
              <div className="rd-tpl-h"><LayoutTemplate size={16} aria-hidden="true" /><strong>{tr(t.name)}</strong>{t.system ? <Badge tone="blue">{tr('Système')}</Badge> : <Badge>{tr('Équipe')}</Badge>}</div>
              <p>{t.description ? tr(t.description) : '—'}</p>
              <div className="rd-tpl-a">
                {canEdit && <Button size="sm" onClick={() => setCreating({ template: t })}>{tr('Utiliser')}</Button>}
                {!t.system && canEdit && <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer le modèle')} onClick={async () => {
                  if (!window.confirm(tr('Supprimer le modèle « {name} » ?', { name: t.name }))) return;
                  try { await api.reportDeleteTemplate(t.key); loadLibrary(); } catch (err) { toast.error(err.message); }
                }} />}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {creating && catalog && <NewReportModal templates={templates} preset={creating.template} onClose={() => setCreating(false)}
        onCreate={(doc, templateKey) => { setCreating(false); setOpen({ doc, meta: { id: null, version: null, status: 'draft', templateKey } }); }} />}
    </div>
  );
}

function NewReportModal({ templates, preset, onClose, onCreate }) {
  const { tr } = useI18n();
  const [key, setKey] = useState(preset ? preset.key : templates[0]?.key);
  const tpl = templates.find((t) => t.key === key);
  const [title, setTitle] = useState(preset ? tr(preset.name) : (tpl ? tr(tpl.name) : ''));
  const [period, setPeriod] = useState(defaultPeriod);
  const invalid = !title.trim() || period.from > period.to;
  return (
    <Modal open onClose={onClose} title={tr('Nouveau rapport')} subtitle={tr('Choisissez un modèle et la période ; tout reste modifiable ensuite.')}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button><Button disabled={invalid} onClick={() => {
        const c = JSON.parse(JSON.stringify(tpl.content));
        const { page, blocks } = tpl.system ? localizeTemplate(c, tr) : { page: c.page || {}, blocks: c.blocks || [] };
        onCreate({ title: title.trim(), period, page, blocks }, tpl.key);
      }}>{tr('Créer')}</Button></>}>
      <div className="section-gap">
        <Field label={tr('Modèle')}>
          <select className="select" value={key} onChange={(e) => { setKey(e.target.value); const t = templates.find((x) => x.key === e.target.value); if (t) setTitle(tr(t.name)); }}>
            {templates.map((t) => <option key={t.key} value={t.key}>{tr(t.name)}{t.system ? '' : ` (${tr('équipe')})`}</option>)}
          </select>
        </Field>
        {tpl?.description && <p className="hint">{tr(tpl.description)}</p>}
        <Field label={tr('Titre')} required><input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
    </Modal>
  );
}

function PeriodPicker({ period, onChange, compact }) {
  const { tr } = useI18n();
  const y = thisYear();
  const presets = [
    [tr('Année {y}', { y }), { from: `${y}-01`, to: `${y}-12` }],
    [tr('1er semestre {y}', { y }), { from: `${y}-01`, to: `${y}-06` }],
    [tr('2e semestre {y}', { y }), { from: `${y}-07`, to: `${y}-12` }],
    [tr('Année {y}', { y: y - 1 }), { from: `${y - 1}-01`, to: `${y - 1}-12` }],
  ];
  return (
    <div className={`rd-period ${compact ? 'is-compact' : ''}`}>
      <label><span>{tr('Du')}</span><input className="input" type="month" value={period.from} onChange={(e) => e.target.value && onChange({ ...period, from: e.target.value })} /></label>
      <label><span>{tr('au')}</span><input className="input" type="month" value={period.to} onChange={(e) => e.target.value && onChange({ ...period, to: e.target.value })} /></label>
      <select className="select" value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) onChange(p[1]); }} aria-label={tr('Période prédéfinie')}>
        <option value="">{tr('Période…')}</option>
        {presets.map(([l], i) => <option key={l} value={i}>{l}</option>)}
      </select>
      {period.from > period.to && <span className="field-error">{tr('Le début est après la fin.')}</span>}
    </div>
  );
}

/* --------------------------------------------------------------------------- Éditeur */

function ReportEditor({ catalog, initial, canEdit, onClose, onTemplatesChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [doc, setDoc] = useState(initial.doc);
  const [meta, setMeta] = useState(initial.meta);
  const [data, setData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [selected, setSelected] = useState(null); // { id, parent? }
  const [dirty, setDirty] = useState(!initial.meta.id);
  const [saving, setSaving] = useState(false);
  const [forms, setForms] = useState([]);
  const [offices, setOffices] = useState([]);
  const pageRef = useRef(null);
  const topbarRef = useRef(null);
  const [topbarH, setTopbarH] = useState(64);
  const final = meta.status === 'final';

  // Les panneaux latéraux se placent sous la barre d'outils, dont la hauteur varie (1 ou 2 lignes).
  useEffect(() => {
    const el = topbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setTopbarH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const editable = canEdit && !final;

  useEffect(() => {
    api.monForms().then(setForms).catch(() => setForms([]));
    api.listOffices().then((o) => setOffices(o.filter((x) => x.active))).catch(() => setOffices([]));
  }, []);

  // Données : document finalisé → données figées ; sinon rendu serveur (anti-rebond) quand un paramètre de données change.
  const signature = useMemo(() => dataSignature(doc), [doc]);
  useEffect(() => {
    let alive = true;
    if (final && meta.id) { api.reportDocumentData(meta.id).then((d) => alive && setData(d)).catch((e) => toast.error(e.message)); return () => { alive = false; }; }
    if (doc.period.from > doc.period.to) return undefined;
    setLoadingData(true);
    const h = setTimeout(() => {
      api.reportRender(doc).then((d) => alive && setData(d)).catch((e) => alive && toast.error(e.message)).finally(() => alive && setLoadingData(false));
    }, 500);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, final, meta.id]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const change = (fn) => { setDoc((d) => fn(d)); setDirty(true); };
  const setBlocks = (fn) => change((d) => ({ ...d, blocks: fn(d.blocks) }));

  // Opérations sur un bloc (racine ou enfant d'une section répétée).
  const mapBlock = (blocks, id, fn) => blocks.map((b) => (b.id === id ? fn(b) : b.type === 'repeat' ? { ...b, params: { ...b.params, blocks: mapBlock(b.params.blocks, id, fn) } } : b));
  const updateBlock = (id, patch) => setBlocks((bs) => mapBlock(bs, id, (b) => ({ ...b, params: { ...b.params, ...patch } })));
  const findBlock = (id, bs = doc.blocks) => { for (const b of bs) { if (b.id === id) return b; if (b.type === 'repeat') { const f = findBlock(id, b.params.blocks); if (f) return f; } } return null; };
  const listOf = (bs, parent) => (parent ? bs.find((b) => b.id === parent).params.blocks : bs);
  const withList = (bs, parent, fn) => (parent ? bs.map((b) => (b.id === parent ? { ...b, params: { ...b.params, blocks: fn(b.params.blocks) } } : b)) : fn(bs));
  const move = (id, parent, dir) => setBlocks((bs) => withList(bs, parent, (list) => {
    const i = list.findIndex((b) => b.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n;
  }));
  const moveTo = (id, parent, toIndex) => setBlocks((bs) => withList(bs, parent, (list) => {
    const i = list.findIndex((b) => b.id === id); if (i < 0) return list;
    const n = [...list]; const [it] = n.splice(i, 1); n.splice(Math.min(toIndex, n.length), 0, it); return n;
  }));
  const remove = (id, parent) => { setBlocks((bs) => withList(bs, parent, (list) => list.filter((b) => b.id !== id))); setSelected(null); };
  const duplicate = (id, parent) => setBlocks((bs) => withList(bs, parent, (list) => { const i = list.findIndex((b) => b.id === id); const n = [...list]; n.splice(i + 1, 0, cloneWithIds(list[i])); return n; }));
  const add = (type) => {
    const sel = selected && findBlock(selected.id);
    const parent = selected?.parent || (sel && sel.type === 'repeat' && type !== 'repeat' ? sel.id : null);
    if (parent && type === 'repeat') { toast.error(tr('Une section répétée ne peut pas en contenir une autre.')); return; }
    const b = defaultBlock(type);
    setBlocks((bs) => withList(bs, parent, (list) => {
      const i = selected && !selected.parent && !parent ? list.findIndex((x) => x.id === selected.id) : list.findIndex((x) => x.id === selected?.id);
      const n = [...list]; n.splice(i >= 0 ? i + 1 : n.length, 0, b); return n;
    }));
    setSelected({ id: b.id, parent });
  };

  async function save() {
    if (!editable) return;
    setSaving(true);
    try {
      const saved = meta.id
        ? await api.reportUpdateDocument(meta.id, { content: doc, version: meta.version })
        : await api.reportCreateDocument({ content: doc, templateKey: meta.templateKey });
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
    setDoc((d) => ({ ...d, title: `${d.title} (${tr('copie')})`, blocks: d.blocks.map(cloneWithIds) }));
    setDirty(true);
  };

  // ---- Exports -----------------------------------------------------------------
  const pageHtml = () => {
    const page = pageRef.current.cloneNode(true);
    page.querySelectorAll('.rd-block-tools, .rb-pagebreak span, .rt-toolbar, .rd-repeat-tag, .rd-pageno').forEach((n) => n.remove());
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
  // PDF : impression du navigateur. En-tête, pied et numéros de page vont dans les
  // marges @page, donc répétés sur chaque feuille (Chrome / Edge).
  const exportPdf = () => {
    setSelected(null);
    const cssText = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
    const box = 'font: 8pt Inter, Arial, sans-serif; color: #616a7a;';
    const header = subst(doc.page?.header); const footer = subst(doc.page?.footer);
    const style = document.createElement('style');
    style.textContent = `@page { size: A4 ${doc.page?.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 16mm 12mm;`
      + (header ? ` @top-left { content: ${cssText(header)}; ${box} }` : '')
      + (footer ? ` @bottom-left { content: ${cssText(footer)}; ${box} }` : '')
      + (showPageNumbers ? ` @bottom-right { content: counter(page) " / " counter(pages); ${box} }` : '')
      + ' }';
    document.head.appendChild(style);
    document.body.classList.add('rd-printing');
    const done = () => { document.body.classList.remove('rd-printing'); style.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 60); // laisse React retirer l'éditeur du bloc sélectionné
  };

  const labels = catalog.kpis;
  const varLabels = { periode: 'Période du rapport', date_edition: 'Date d\'édition', ...catalog.kpis };
  const variableList = Object.entries(varLabels).map(([k, l]) => [k, tr(l)]);
  const sel = selected ? findBlock(selected.id) : null;
  const subst = (s) => String(s || '').replace(/\{periode\}/g, data?.periodLabel || '');
  const showPageNumbers = doc.page?.showPageNumbers !== false;

  // Rendu d'un bloc dans la page (avec outils d'édition).
  const renderBlock = (b, parent, ctx, keySuffix = '') => {
    const isSel = selected?.id === b.id;
    const editorFor = (b.type === 'text' || b.type === 'callout' || b.type === 'bulletin') && editable && isSel && !keySuffix
      ? <RichTextEditor doc={b.params.doc || ctx.data?.doc} vars={ctx.vars} labelFor={(v) => tr(varLabels[v] || v)} variableList={variableList}
        onChange={(d) => updateBlock(b.id, { doc: d })} /> : null;
    return (
      <div key={b.id + keySuffix} className={`rd-block rd-block-${b.type} ${isSel ? 'is-selected' : ''}`}
        onClick={(e) => { e.stopPropagation(); if (!keySuffix) setSelected({ id: b.id, parent }); }}>
        <BlockView block={b} ctx={{ ...ctx, labels, varLabels }} editor={editorFor} />
      </div>
    );
  };

  return (
    <div className="rd-editor" style={{ '--rd-top': `${topbarH}px` }}>
      <div className="rd-topbar" ref={topbarRef}>
        <Button variant="ghost" icon={ArrowLeft} onClick={() => { if (!dirty || window.confirm(tr('Quitter sans enregistrer ?'))) onClose(); }}>{tr('Rapports')}</Button>
        <input className="input rd-title" value={doc.title} disabled={!editable} maxLength={200} aria-label={tr('Titre du rapport')}
          onChange={(e) => change((d) => ({ ...d, title: e.target.value }))} />
        {final ? <Badge tone="green" icon={Lock}>{tr('Finalisé')}</Badge> : dirty ? <Badge tone="yellow">{tr('Non enregistré')}</Badge> : <Badge>{tr('Enregistré')}</Badge>}
        <PeriodPicker compact period={doc.period} onChange={(p) => editable && change((d) => ({ ...d, period: p }))} />
        <span className="mmr-spacer" />
        {loadingData && <span className="rd-loading"><RefreshCw size={14} className="spin" aria-hidden="true" /> {tr('Calcul…')}</span>}
        <div className="header-actions">
          <Button variant="secondary" icon={Printer} onClick={exportPdf} title={tr('Imprimer ou enregistrer en PDF')}>PDF</Button>
          <Button variant="secondary" icon={FileCode2} onClick={exportHtml}>HTML</Button>
          <Button variant="secondary" icon={FileText} onClick={exportWord}>Word</Button>
          <Button variant="secondary" icon={FileSpreadsheet} onClick={() => api.reportExportXlsx(doc, `${fileBase}.xlsx`).catch((e) => toast.error(e.message))}>Excel</Button>
          {canEdit && <Button variant="ghost" icon={LayoutTemplate} onClick={saveAsTemplate}>{tr('Enregistrer comme modèle')}</Button>}
          {canEdit && final && <Button variant="secondary" icon={Copy} onClick={duplicateDoc}>{tr('Dupliquer')}</Button>}
          {editable && meta.id && !dirty && <Button variant="secondary" icon={Lock} onClick={finalize}>{tr('Finaliser')}</Button>}
          {editable && <Button icon={Save} loading={saving} onClick={save} disabled={!dirty || !doc.title.trim()}>{tr('Enregistrer')}</Button>}
        </div>
      </div>
      {final && <Alert tone="info" icon={Lock}>{tr('Rapport finalisé le {d} : contenu et chiffres sont figés. Dupliquez-le pour préparer une nouvelle version.', { d: formatDateTime(meta.finalizedAt) })}</Alert>}

      <div className={`rd-body ${editable ? '' : 'is-readonly'}`}>
        {editable && (
          <aside className="rd-left" aria-label={tr('Blocs')}>
            <h3>{tr('Ajouter un bloc')}</h3>
            <div className="rd-palette">
              {BLOCK_TYPES.map(([k, l, Icon]) => <button key={k} type="button" onClick={() => add(k)}><Icon size={16} aria-hidden="true" /><span>{tr(l)}</span></button>)}
            </div>
            <h3>{tr('Plan du document')}</h3>
            <Outline blocks={doc.blocks} selected={selected} onSelect={setSelected} onMove={move} onMoveTo={moveTo} onRemove={remove} onDuplicate={duplicate} />
          </aside>
        )}

        <main className="rd-canvas" onClick={() => setSelected(null)}>
          <article ref={pageRef} className={`rd-page ${doc.page?.orientation === 'landscape' ? 'is-landscape' : ''}`}>
            {(doc.page?.header) && <header className="rd-page-h">{subst(doc.page.header)}</header>}
            {data === null ? <Skeleton height={400} /> : doc.blocks.map((b) => {
              if (b.type !== 'repeat') return renderBlock(b, null, { data: data.blocks[b.id], vars: data.variables });
              const items = data.repeats[b.id] || [];
              return (
                <div key={b.id} className={`rd-repeat ${selected?.id === b.id ? 'is-selected' : ''}`} onClick={(e) => { e.stopPropagation(); setSelected({ id: b.id, parent: null }); }}>
                  <div className="rd-repeat-tag"><Repeat size={13} aria-hidden="true" /> {b.params.over === 'bureau' ? tr('Section répétée par bureau ({n})', { n: items.length }) : tr('Section répétée par activité ({n})', { n: items.length })}</div>
                  {items.length === 0 && <p className="rb-note">{tr('Aucune activité ou bureau avec des données sur la période.')}</p>}
                  {items.map((it, k) => (
                    <section key={it.key} className="rd-repeat-item">
                      {b.params.blocks.map((c) => renderBlock(c, b.id, { data: it.blocks[c.id], vars: data.variables, item: it }, k === 0 ? '' : `@${k}`))}
                    </section>
                  ))}
                </div>
              );
            })}
            {(doc.page?.footer || showPageNumbers) && <footer className="rd-page-f"><span>{subst(doc.page?.footer)}</span>{showPageNumbers && <span className="rd-pageno">{tr('Page n / N')}</span>}</footer>}
          </article>
        </main>

        {editable && (
          <aside className="rd-right" aria-label={tr('Propriétés')}>
            {sel ? <BlockProps block={sel} catalog={catalog} forms={forms} offices={offices} data={data}
              onChange={(patch) => updateBlock(sel.id, patch)} onRegenerate={() => updateBlock(sel.id, { doc: undefined })} />
              : <DocProps doc={doc} onChange={(page) => change((d) => ({ ...d, page: { ...d.page, ...page } }))} />}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Plan du document : sélection, réordonnancement (glisser-déposer ou flèches), duplication, suppression. */
function Outline({ blocks, selected, onSelect, onMove, onMoveTo, onRemove, onDuplicate, parent = null }) {
  const { tr } = useI18n();
  const drag = useRef(null);
  const label = (b) => (b.type === 'heading' ? b.params.text : b.params.title || tr(TYPE_LABEL[b.type]));
  return (
    <ol className={`rd-outline ${parent ? 'is-nested' : ''}`}>
      {blocks.map((b, i) => {
        const Icon = TYPE_ICON[b.type] || Type;
        return (
          <li key={b.id} draggable onDragStart={() => { drag.current = b.id; }} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag.current && drag.current !== b.id) onMoveTo(drag.current, parent, i); drag.current = null; }}>
            <div className={`rd-ol-row ${selected?.id === b.id ? 'is-selected' : ''}`} onClick={() => onSelect({ id: b.id, parent })}>
              <GripVertical size={13} className="rd-grip" aria-hidden="true" />
              <Icon size={14} aria-hidden="true" />
              <span className="rd-ol-label" title={String(label(b))}>{String(label(b))}</span>
              <span className="rd-block-tools">
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(b.id, parent, -1); }} aria-label={tr('Monter')} disabled={i === 0}><ChevronUp size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(b.id, parent, 1); }} aria-label={tr('Descendre')} disabled={i === blocks.length - 1}><ChevronDown size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(b.id, parent); }} aria-label={tr('Dupliquer')}><Copy size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (window.confirm(tr('Supprimer ce bloc ?'))) onRemove(b.id, parent); }} aria-label={tr('Supprimer')}><Trash2 size={13} /></button>
              </span>
            </div>
            {b.type === 'repeat' && <Outline blocks={b.params.blocks} parent={b.id} selected={selected} onSelect={onSelect} onMove={onMove} onMoveTo={onMoveTo} onRemove={onRemove} onDuplicate={onDuplicate} />}
          </li>
        );
      })}
    </ol>
  );
}

function DocProps({ doc, onChange }) {
  const { tr } = useI18n();
  const p = doc.page || {};
  return (
    <div className="section-gap">
      <h3>{tr('Mise en page')}</h3>
      <Field label={tr('Orientation')}>
        <select className="select" value={p.orientation || 'portrait'} onChange={(e) => onChange({ orientation: e.target.value })}>
          <option value="portrait">{tr('Portrait')}</option><option value="landscape">{tr('Paysage')}</option>
        </select>
      </Field>
      <Field label={tr('En-tête')} hint={tr('{periode} est remplacé par la période.')}><input className="input" value={p.header || ''} maxLength={200} onChange={(e) => onChange({ header: e.target.value })} /></Field>
      <Field label={tr('Pied de page')}><input className="input" value={p.footer || ''} maxLength={200} onChange={(e) => onChange({ footer: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={p.showPageNumbers !== false} onChange={(e) => onChange({ showPageNumbers: e.target.checked })} /> {tr('Numéros de page (PDF)')}</label>
      <p className="hint">{tr('Cliquez sur un bloc de la page pour le modifier ; écrivez directement dans les blocs de texte.')}</p>
    </div>
  );
}

function BlockProps({ block, catalog, forms, offices, data, onChange, onRegenerate }) {
  const { tr } = useI18n();
  const p = block.params;
  const ds = p.dataset ? catalog.datasets[p.dataset] : null;
  const filters = p.filters || {};
  const setFilter = (k, v) => onChange({ filters: { ...filters, [k]: v || undefined } });
  const datasetSelect = (
    <Field label={tr('Données')}>
      <select className="select" value={p.dataset} onChange={(e) => onChange({ dataset: e.target.value, columns: undefined, metric: undefined })}>
        {Object.entries(catalog.datasets).map(([k, d]) => <option key={k} value={k}>{tr(d.label)}</option>)}
      </select>
    </Field>
  );
  const filterFields = (
    <>
      <Field label={tr('Activité (fiche)')} hint={ds?.scope === 'form' ? tr('Obligatoire pour ces données, sauf dans une section répétée.') : undefined}>
        <select className="select" value={filters.formId || ''} onChange={(e) => setFilter('formId', e.target.value)}>
          <option value="">{tr('Toutes')}</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </Field>
      <Field label={tr('Bureau')}>
        <select className="select" value={filters.bureau || ''} onChange={(e) => setFilter('bureau', e.target.value)}>
          <option value="">{tr('Tous')}</option>{offices.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
        </select>
      </Field>
    </>
  );
  return (
    <div className="section-gap">
      <h3>{tr(TYPE_LABEL[block.type])}</h3>
      {block.type === 'heading' && <>
        <Field label={tr('Texte')} hint={tr('{periode}, {activite} et {bureau} sont remplacés automatiquement.')}><input className="input" value={p.text} maxLength={300} onChange={(e) => onChange({ text: e.target.value })} /></Field>
        <Field label={tr('Niveau')}><select className="select" value={p.level} onChange={(e) => onChange({ level: Number(e.target.value) })}><option value={1}>{tr('Titre principal')}</option><option value={2}>{tr('Section')}</option><option value={3}>{tr('Sous-section')}</option></select></Field>
      </>}
      {block.type === 'callout' && <>
        <Field label={tr('Style')}><select className="select" value={p.tone} onChange={(e) => onChange({ tone: e.target.value })}>
          <option value="info">{tr('Information')}</option><option value="success">{tr('Point fort')}</option><option value="warning">{tr('Point d\'attention')}</option><option value="critical">{tr('Critique')}</option>
        </select></Field>
        <Field label={tr('Titre')}><input className="input" value={p.title || ''} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} /></Field>
      </>}
      {(block.type === 'text' || block.type === 'callout') && <p className="hint">{tr('Écrivez directement dans la page ; la barre d\'outils permet gras, titres, listes et insertion de valeurs calculées.')}</p>}
      {block.type === 'bulletin' && <>
        <p className="hint">{p.doc ? tr('Texte modifié à la main : il ne suit plus les chiffres.') : tr('Texte rédigé automatiquement à partir des chiffres de la période ; modifiez-le librement dans la page.')}</p>
        {p.doc && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onRegenerate}>{tr('Régénérer depuis les chiffres')}</Button>}
        {filterFields}
      </>}
      {block.type === 'kpis' && <>
        <fieldset className="rd-checks"><legend>{tr('Chiffres affichés')}</legend>
          {Object.entries(catalog.kpis).map(([k, l]) => (
            <label key={k} className="check"><input type="checkbox" checked={p.metrics.includes(k)} disabled={p.metrics.length >= 8 && !p.metrics.includes(k)}
              onChange={(e) => { const m = e.target.checked ? [...p.metrics, k] : p.metrics.filter((x) => x !== k); if (m.length) onChange({ metrics: m }); }} /> {tr(l)}</label>
          ))}
        </fieldset>
        {filterFields}
      </>}
      {(block.type === 'table' || block.type === 'chart') && <>
        <Field label={tr('Titre')}><input className="input" value={p.title || ''} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} /></Field>
        {datasetSelect}
        {block.type === 'chart' && <Field label={tr('Type de graphique')}><select className="select" value={p.kind} onChange={(e) => onChange({ kind: e.target.value })}>
          <option value="bar">{tr('Barres')}</option><option value="line">{tr('Courbes (par mois)')}</option><option value="matrix">{tr('Matrice colorée')}</option>
        </select></Field>}
        {block.type === 'table' && ds && !ds.dynamicColumns && (
          <fieldset className="rd-checks"><legend>{tr('Colonnes')}</legend>
            {ds.columns.map((c) => {
              const cols = p.columns || ds.columns.map((x) => x.key);
              return <label key={c.key} className="check"><input type="checkbox" checked={cols.includes(c.key)} onChange={(e) => {
                const next = e.target.checked ? [...cols, c.key] : cols.filter((x) => x !== c.key);
                onChange({ columns: next.length === ds.columns.length ? undefined : ds.columns.map((x) => x.key).filter((k) => next.includes(k)) });
              }} /> {tr(c.label)}</label>;
            })}
          </fieldset>
        )}
        {block.type === 'table' && <Field label={tr('Nombre de lignes max.')}><input className="input" type="number" min="1" max="500" value={p.limit || ''} onChange={(e) => onChange({ limit: e.target.value ? Math.max(1, Math.min(500, Number(e.target.value))) : undefined })} /></Field>}
        {filterFields}
      </>}
      {block.type === 'repeat' && <>
        <Field label={tr('Répéter pour chaque')}><select className="select" value={p.over} onChange={(e) => onChange({ over: e.target.value })}>
          <option value="activity">{tr('Activité (fiche de suivi)')}</option><option value="bureau">{tr('Bureau')}</option>
        </select></Field>
        <p className="hint">{tr('Les blocs de la section sont recalculés pour chaque activité ou bureau ayant des données sur la période. Sélectionnez la section puis ajoutez des blocs pour les y placer.')}</p>
        {data?.repeats?.[block.id] && <p className="hint">{tr('{n} section(s) générée(s).', { n: data.repeats[block.id].length })}</p>}
      </>}
    </div>
  );
}
