import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, FileText, Save, Lock, Printer, FileSpreadsheet, FileCode2, ChevronUp, ChevronDown, Copy, Trash2, Info,
  ArrowLeft, RotateCw, Heading1, Type, MessageSquareWarning, Gauge, Table2, Sparkles, SeparatorHorizontal, Minus, Repeat, LayoutTemplate, RefreshCw, GripVertical,
  RectangleHorizontal, Columns2, MoveVertical,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { usePeriod } from '../../components/PeriodBanner.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatDateTime } from '../../lib/format.js';
import { periodLabel, single } from '../../lib/period.js';
import { BlockView, Band } from './ReportBlocks.jsx';
import BlockFrame from './BlockFrame.jsx';
import { useBlockData } from './useBlockData.js';
import { RichTextEditor } from './RichText.jsx';
import {
  defaultBlock, defaultPage, cloneWithIds, findBlock, updateParams, removeBlock, duplicateBlock, moveBlock, moveBlockTo, insertBlock,
  iidOf, textElement, pageNumberElement,
} from './reportDoc.js';
import reportCss from './reports.css?raw';
import './reports.css';

/**
 * Concepteur de rapport professionnel : documents v2 faits de blocs (texte riche
 * éditable, chiffres clés, blocs de données du catalogue, bulletin rédigé, sections
 * avec leur orientation, colonnes, sections répétées par activité/bureau/partenaire),
 * modèles système et enregistrés, période « du … au … » (60 mois au plus),
 * enregistrement versionné (verrou optimiste), finalisation figée, exports
 * PDF / HTML / Word / Excel. Les données sont calculées côté serveur.
 */
const BLOCK_TYPES = [
  ['heading', 'Titre', Heading1], ['text', 'Texte', Type], ['callout', 'Encadré', MessageSquareWarning],
  ['kpis', 'Chiffres clés', Gauge], ['data', 'Données', Table2],
  ['bulletin', 'Bulletin rédigé', Sparkles], ['section', 'Section', RectangleHorizontal], ['columns', 'Colonnes', Columns2],
  ['repeat', 'Section répétée', Repeat], ['spacer', 'Espace', MoveVertical],
  ['pagebreak', 'Saut de page', SeparatorHorizontal], ['divider', 'Séparateur', Minus],
];
const TYPE_LABEL = Object.fromEntries(BLOCK_TYPES.map(([k, l]) => [k, l]));
const TYPE_ICON = Object.fromEntries(BLOCK_TYPES.map(([k, , I]) => [k, I]));

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
    if (q.figure && q.figure.title) q.figure = { ...q.figure, title: t(q.figure.title) };
    if (b.type === 'repeat') q.blocks = q.blocks.map(block);
    if (b.type === 'columns') q.cols = q.cols.map((col) => col.map(block));
    return { ...b, params: q };
  };
  const band = (bd) => bd && { ...bd, elements: (bd.elements || []).map((e) => (e.kind === 'text' ? { ...e, text: t(e.text) } : e)) };
  const page = { ...(content.page || {}) };
  for (const k of ['header', 'footer', 'firstHeader', 'firstFooter']) if (page[k]) page[k] = band(page[k]);
  return { page, filters: content.filters || {}, blocks: (content.blocks || []).map(block) };
}

const mark = (name) => { try { if (typeof performance !== 'undefined' && performance.mark) performance.mark(name); } catch { /* sans incidence */ } };

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
    mark('rd:open');
    try {
      const d = await api.reportDocument(id);
      setOpen({ doc: d.content, meta: { id: d.id, version: d.version, status: d.status, templateKey: d.templateKey, finalizedAt: d.finalizedAt, upgradedFrom: d.upgradedFrom, warnings: d.warnings || [] } });
    } catch (e) { toast.error(e.message); }
  }

  if (open && catalog) {
    return <ReportEditor catalog={catalog} initial={open} canEdit={canEdit}
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
        onCreate={(doc, templateKey) => { mark('rd:open'); setCreating(false); setOpen({ doc, meta: { id: null, version: null, status: 'draft', templateKey } }); }} />}
    </div>
  );
}

/** Période d'un rapport : sélecteur « du … au … » commun (préréglages, volume par mois, 60 mois au plus). */
function ReportPeriod({ value, onChange, disabled, compact, align }) {
  const { counts, latest, today } = usePeriod({ scope: 'local', defaultRule: 'current', urlSync: false });
  if (disabled) return <span className="rd-period-ro">{periodLabel(value, document.documentElement.lang === 'en' ? 'en' : 'fr')}</span>;
  return <PeriodSelect value={value} onChange={(p) => p && onChange(p)} counts={counts} today={today} latest={latest} withFullYear maxSpan={60} compact={compact} align={align} />;
}

function NewReportModal({ templates, preset, onClose, onCreate }) {
  const { tr } = useI18n();
  const [key, setKey] = useState(preset ? preset.key : templates[0]?.key);
  const tpl = templates.find((t) => t.key === key);
  const [title, setTitle] = useState(preset ? tr(preset.name) : (tpl ? tr(tpl.name) : ''));
  // Période par défaut : le dernier mois qui a des données (règle commune), sinon le mois courant.
  const { latest, today } = usePeriod({ scope: 'local', defaultRule: 'current', urlSync: false });
  const [period, setPeriod] = useState(null);
  const effective = period || single(latest || today);
  const invalid = !title.trim();
  return (
    <Modal open onClose={onClose} title={tr('Nouveau rapport')} subtitle={tr('Choisissez un modèle et la période ; tout reste modifiable ensuite.')}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button><Button disabled={invalid} onClick={() => {
        const c = JSON.parse(JSON.stringify(tpl.content || {}));
        const { page, filters, blocks } = tpl.system ? localizeTemplate(c, tr) : { page: c.page || defaultPage(), filters: c.filters || {}, blocks: c.blocks || [] };
        onCreate({ schemaVersion: 2, title: title.trim(), period: effective, filters, page: page || defaultPage(), blocks }, tpl.key);
      }}>{tr('Créer')}</Button></>}>
      <div className="section-gap">
        <Field label={tr('Modèle')}>
          <select className="select" value={key} onChange={(e) => { setKey(e.target.value); const t = templates.find((x) => x.key === e.target.value); if (t) setTitle(tr(t.name)); }}>
            {templates.map((t) => <option key={t.key} value={t.key}>{tr(t.name)}{t.system ? '' : ` (${tr('équipe')})`}</option>)}
          </select>
        </Field>
        {tpl?.description && <p className="hint">{tr(tpl.description)}</p>}
        <Field label={tr('Titre')} required><input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={tr('Période')}><ReportPeriod value={effective} onChange={setPeriod} /></Field>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------------------- Éditeur */

function ReportEditor({ catalog, initial, canEdit, onClose, onTemplatesChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [doc, setDoc] = useState(initial.doc);
  const [meta, setMeta] = useState(initial.meta);
  const [selected, setSelected] = useState(null); // id du bloc sélectionné
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

  // Données bloc par bloc (plan puis blocs, cache par signature) ; finalisé → données figées.
  const uiLang = document.documentElement.lang === 'en' ? 'en' : 'fr';
  const { plan: data, planError, states, retry, refresh, progress, observe } = useBlockData({ doc, frozenId: final ? meta.id : null, lang: uiLang });
  const heights = useRef(new Map()); // dernière hauteur mesurée de chaque instance (squelettes à la bonne taille)
  const onHeight = useCallback((iid, h) => { heights.current.set(iid, h); }, []);
  // Premier contenu : le contenu fixe est peint sans attendre aucune donnée.
  useLayoutEffect(() => { mark('rd:first-content'); }, []);
  const computing = progress.total > 0 && progress.done < progress.total;

  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const change = (fn) => { setDoc((d) => fn(d)); setDirty(true); };
  const setBlocks = (fn) => change((d) => ({ ...d, blocks: fn(d.blocks) }));
  const updateBlock = (id, patch) => setBlocks((bs) => updateParams(bs, id, patch));
  const remove = (id) => { setBlocks((bs) => removeBlock(bs, id)); setSelected(null); };
  const add = (type) => {
    const sel = selected ? findBlock(doc.blocks, selected) : null;
    const b = defaultBlock(type, { catalog });
    // Bloc sélectionné : une section répétée ou des colonnes reçoivent le bloc ; sinon il suit le bloc sélectionné.
    const into = sel && (sel.block.type === 'repeat' || sel.block.type === 'columns') && !['repeat'].includes(type) ? { id: sel.block.id, col: 0 } : null;
    const r = insertBlock(doc.blocks, b, into ? { into } : { afterId: sel ? sel.block.id : null });
    if (r.error) { toast.error(tr(r.error)); return; }
    setBlocks(() => r.blocks);
    setSelected(b.id);
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
    page.querySelectorAll('.rd-block-tools, .rb-pagebreak span, .rt-toolbar, .rd-repeat-tag, .rd-section-tag').forEach((n) => n.remove());
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
  // PDF : impression du navigateur (pagination exacte et orientation par section : lot 7a, C7).
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
  const vars = { ...(data?.vars || {}), titre: doc.title, periode: data?.periodLabel || periodLabel(doc.period, document.documentElement.lang === 'en' ? 'en' : 'fr') };
  const page = doc.page || defaultPage();

  // Rendu d'un bloc dans la page (avec outils d'édition). `repeat` = { id, key, label, over } dans une section répétée.
  const renderBlock = (b, repeat = null, first = true) => {
    const iid = iidOf(b.id, repeat);
    const isSel = selected === b.id;
    if (b.type === 'section') {
      const o = b.params.orientation || page.orientation;
      return (
        <div key={iid} className={`rd-block rd-section-sep ${isSel ? 'is-selected' : ''}`} onClick={(e) => { e.stopPropagation(); if (first) setSelected(b.id); }}>
          <span className="rd-section-tag">{tr('Section')} · {b.params.size || page.size || 'A4'} {tr(o === 'landscape' ? 'paysage' : 'portrait')}{b.params.title ? ` · ${b.params.title}` : ''}</span>
        </div>
      );
    }
    if (b.type === 'columns') {
      return (
        <div key={iid} className={`rd-block rd-columns rd-cols-${b.params.ratio.replace(/:/g, '-')} ${isSel ? 'is-selected' : ''}`} onClick={(e) => { e.stopPropagation(); if (first) setSelected(b.id); }}>
          {b.params.cols.map((col, c) => <div key={c} className="rd-col">{col.length ? col.map((cb) => renderBlock(cb, repeat, first)) : <p className="rb-note">{tr('Colonne vide : sélectionnez les colonnes puis ajoutez un bloc.')}</p>}</div>)}
        </div>
      );
    }
    if (b.type === 'repeat') {
      const items = (data && data.expansions && data.expansions[b.id]) || [];
      return (
        <div key={iid} className={`rd-repeat ${isSel ? 'is-selected' : ''}`} onClick={(e) => { e.stopPropagation(); setSelected(b.id); }}>
          <div className="rd-repeat-tag"><Repeat size={13} aria-hidden="true" /> {tr({ bureau: 'Section répétée par bureau ({n})', partner: 'Section répétée par partenaire ({n})' }[b.params.over] || 'Section répétée par activité ({n})', { n: items.length })}</div>
          {data && data.expansions && items.length === 0 && <p className="rb-note">{tr('Aucune activité ou bureau avec des données sur la période.')}</p>}
          {items.map((it, k) => (
            <section key={it.key} className="rd-repeat-item">
              {b.params.blocks.map((c) => renderBlock(c, { id: b.id, key: it.key, label: it.label, over: b.params.over }, k === 0))}
            </section>
          ))}
        </div>
      );
    }
    const st = states[iid];
    const res = st ? st.result : undefined;
    const itemVars = repeat ? { [{ activity: 'activite', bureau: 'bureau', partner: 'partenaire' }[repeat.over]]: repeat.label } : {};
    const editorFor = (b.type === 'text' || b.type === 'callout' || b.type === 'bulletin') && editable && isSel && first
      ? <RichTextEditor doc={b.params.doc || res?.data?.doc} vars={{ ...vars, ...(res?.data?.vars || {}) }} labelFor={(v) => tr(varLabels[v] || v)} variableList={variableList}
        onChange={(d) => updateBlock(b.id, { doc: d })} /> : null;
    return (
      <div key={iid} className={`rd-block rd-block-${b.type} ${isSel ? 'is-selected' : ''}`}
        onClick={(e) => { e.stopPropagation(); if (first) setSelected(b.id); }}>
        {FRAMED.has(b.type)
          ? (
            <BlockFrame iid={iid} state={st} label={frameLabel(b, catalog, tr)} height={heights.current.get(iid) || DEFAULT_H[b.type]}
              onRetry={retry} observe={observe} onHeight={onHeight}>
              <BlockView block={b} ctx={{ result: res, inst: instances[iid], vars: { ...vars, ...itemVars }, catalog, varLabels }} editor={editorFor} />
            </BlockFrame>
          )
          : <BlockView block={b} ctx={{ result: res, inst: instances[iid], vars: { ...vars, ...itemVars }, catalog, varLabels, pending: st && st.status !== 'ready' && st.status !== 'error' }} editor={editorFor} />}
      </div>
    );
  };

  const upgradedDraft = meta.upgradedFrom === 1 && !final;
  return (
    <div className="rd-editor" style={{ '--rd-top': `${topbarH}px` }}>
      <div className="rd-topbar" ref={topbarRef}>
        <Button variant="ghost" icon={ArrowLeft} onClick={() => { if (!dirty || window.confirm(tr('Quitter sans enregistrer ?'))) onClose(); }}>{tr('Rapports')}</Button>
        <input className="input rd-title" value={doc.title} disabled={!editable} maxLength={200} aria-label={tr('Titre du rapport')}
          onChange={(e) => change((d) => ({ ...d, title: e.target.value }))} />
        {final ? <Badge tone="green" icon={Lock}>{tr('Finalisé')}</Badge> : dirty ? <Badge tone="yellow">{tr('Non enregistré')}</Badge> : <Badge>{tr('Enregistré')}</Badge>}
        <ReportPeriod compact value={doc.period} disabled={!editable} onChange={(p) => change((d) => ({ ...d, period: p }))} />
        <span className="mmr-spacer" />
        {computing && <span className="rd-loading" aria-live="polite"><RefreshCw size={14} className="spin" aria-hidden="true" /> {tr('{done} blocs sur {total} calculés', progress)}</span>}
        {!final && <Button variant="ghost" size="sm" icon={RotateCw} onClick={refresh} title={tr('Recalculer tous les blocs (nouvelles données importées)')}>{tr('Actualiser les données')}</Button>}
        <div className="header-actions">
          {/* Impression et exports de la page : seulement quand tous les blocs sont calculés (rien d'exporté à moitié). */}
          <Button variant="secondary" icon={Printer} onClick={exportPdf} disabled={computing} title={computing ? tr('Attendez la fin du calcul des blocs') : tr('Imprimer ou enregistrer en PDF')}>PDF</Button>
          <Button variant="secondary" icon={FileCode2} onClick={exportHtml} disabled={computing}>HTML</Button>
          <Button variant="secondary" icon={FileText} onClick={exportWord} disabled={computing}>Word</Button>
          <Button variant="secondary" icon={FileSpreadsheet} onClick={() => api.reportExportXlsx(doc, `${fileBase}.xlsx`).catch((e) => toast.error(e.message))}>Excel</Button>
          {canEdit && <Button variant="ghost" icon={LayoutTemplate} onClick={saveAsTemplate}>{tr('Enregistrer comme modèle')}</Button>}
          {canEdit && final && <Button variant="secondary" icon={Copy} onClick={duplicateDoc}>{tr('Dupliquer')}</Button>}
          {editable && meta.id && !dirty && <Button variant="secondary" icon={Lock} onClick={finalize}>{tr('Finaliser')}</Button>}
          {editable && <Button icon={Save} loading={saving} onClick={save} disabled={!dirty || !doc.title.trim()}>{tr('Enregistrer')}</Button>}
        </div>
      </div>
      {planError && <Alert tone="warning">{planError}</Alert>}
      {final && <Alert tone="info" icon={Lock}>{tr('Rapport finalisé le {d} : contenu et chiffres sont figés. Dupliquez-le pour préparer une nouvelle version.', { d: formatDateTime(meta.finalizedAt) })}</Alert>}
      {upgradedDraft && <Alert tone="info" icon={Info}>{tr('Les chiffres de couverture suivent désormais la définition commune (sites actifs réalisés ÷ sites actifs) : ils peuvent différer de l\'ancienne version.')}</Alert>}
      {(meta.warnings || []).length > 0 && <Alert tone="warning">{meta.warnings.map((w) => <div key={w.blockId + w.message}>{UPGRADE_WARNINGS[w.code] ? tr(UPGRADE_WARNINGS[w.code], w.params) : w.message}</div>)}</Alert>}

      <div className={`rd-body ${editable ? '' : 'is-readonly'}`}>
        {editable && (
          <aside className="rd-left" aria-label={tr('Blocs')}>
            <h3>{tr('Ajouter un bloc')}</h3>
            <div className="rd-palette">
              {BLOCK_TYPES.map(([k, l, Icon]) => <button key={k} type="button" onClick={() => add(k)}><Icon size={16} aria-hidden="true" /><span>{tr(l)}</span></button>)}
            </div>
            <h3>{tr('Plan du document')}</h3>
            <Outline blocks={doc.blocks} catalog={catalog} selected={selected} onSelect={setSelected}
              onMove={(id, dir) => setBlocks((bs) => moveBlock(bs, id, dir))} onMoveTo={(id, i) => setBlocks((bs) => moveBlockTo(bs, id, i))}
              onRemove={remove} onDuplicate={(id) => setBlocks((bs) => duplicateBlock(bs, id))} />
          </aside>
        )}

        <main className="rd-canvas" onClick={() => setSelected(null)}>
          <article ref={pageRef} className={`rd-page ${page.orientation === 'landscape' ? 'is-landscape' : ''}`}>
            <Band band={page.header} vars={vars} texts={data?.sections?.[0]?.headerText} className="rd-page-h" />
            {doc.blocks.map((b) => renderBlock(b))}
            <Band band={page.footer} vars={vars} texts={data?.sections?.[0]?.footerText} className="rd-page-f" />
          </article>
        </main>

        {editable && (
          <aside className="rd-right" aria-label={tr('Propriétés')}>
            {sel ? <BlockProps block={sel.block} parent={sel.parent} catalog={catalog} forms={forms} offices={offices} data={data}
              onChange={(patch) => updateBlock(sel.block.id, patch)} onRegenerate={() => updateBlock(sel.block.id, { doc: undefined })} />
              : <DocProps doc={doc} onChange={(pg) => change((d) => ({ ...d, page: { ...d.page, ...pg } }))} />}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Libellé d'un bloc dans le plan. */
function outlineLabel(b, catalog, tr) {
  if (b.type === 'heading') return b.params.text;
  if (b.type === 'data') return (b.params.figure && b.params.figure.title) || tr((catalog.datasets[b.params.dataset] || {}).label || b.params.dataset);
  if (b.type === 'section') return `${tr('Section')}${b.params.title ? ` · ${b.params.title}` : ''}`;
  return b.params.title || tr(TYPE_LABEL[b.type] || b.type);
}

/** Plan du document : sélection, réordonnancement (glisser-déposer ou flèches), duplication, suppression. */
function Outline({ blocks, catalog, selected, onSelect, onMove, onMoveTo, onRemove, onDuplicate, nested = false }) {
  const { tr } = useI18n();
  const drag = useRef(null);
  return (
    <ol className={`rd-outline ${nested ? 'is-nested' : ''}`}>
      {blocks.map((b, i) => {
        const Icon = TYPE_ICON[b.type] || Type;
        const label = String(outlineLabel(b, catalog, tr));
        return (
          <li key={b.id} draggable onDragStart={(e) => { e.stopPropagation(); drag.current = b.id; }} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag.current && drag.current !== b.id) onMoveTo(drag.current, i); drag.current = null; }}>
            <div className={`rd-ol-row ${selected === b.id ? 'is-selected' : ''}`} onClick={() => onSelect(b.id)}>
              <GripVertical size={13} className="rd-grip" aria-hidden="true" />
              <Icon size={14} aria-hidden="true" />
              <span className="rd-ol-label" title={label}>{label}</span>
              <span className="rd-block-tools">
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(b.id, -1); }} aria-label={tr('Monter')} disabled={i === 0}><ChevronUp size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(b.id, 1); }} aria-label={tr('Descendre')} disabled={i === blocks.length - 1}><ChevronDown size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(b.id); }} aria-label={tr('Dupliquer')}><Copy size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (window.confirm(tr('Supprimer ce bloc ?'))) onRemove(b.id); }} aria-label={tr('Supprimer')}><Trash2 size={13} /></button>
              </span>
            </div>
            {b.type === 'repeat' && <Outline nested blocks={b.params.blocks} catalog={catalog} selected={selected} onSelect={onSelect} onMove={onMove} onMoveTo={onMoveTo} onRemove={onRemove} onDuplicate={onDuplicate} />}
            {b.type === 'columns' && b.params.cols.map((col, c) => <Outline key={c} nested blocks={col} catalog={catalog} selected={selected} onSelect={onSelect} onMove={onMove} onMoveTo={onMoveTo} onRemove={onRemove} onDuplicate={onDuplicate} />)}
          </li>
        );
      })}
    </ol>
  );
}

/** Texte d'un élément de bande (en-tête / pied), modifiable comme une ligne. */
const bandText = (band, id) => ((band && band.elements) || []).find((e) => e.id === id)?.text || '';
function setBandText(band, id, text, make) {
  const els = (band && band.elements) || [];
  const has = els.some((e) => e.id === id);
  const elements = text ? (has ? els.map((e) => (e.id === id ? { ...e, text } : e)) : [...els, make(text)]) : els.filter((e) => e.id !== id);
  return { height: (band && band.height) || 14, elements };
}

function DocProps({ doc, onChange }) {
  const { tr } = useI18n();
  const p = doc.page || defaultPage();
  const hasNumbers = ((p.footer && p.footer.elements) || []).some((e) => e.kind === 'pageNumber');
  return (
    <div className="section-gap">
      <h3>{tr('Mise en page')}</h3>
      <Field label={tr('Orientation')}>
        <select className="select" value={p.orientation || 'portrait'} onChange={(e) => onChange({ orientation: e.target.value })}>
          <option value="portrait">{tr('Portrait')}</option><option value="landscape">{tr('Paysage')}</option>
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
      }} /> {tr('Numéros de page (PDF)')}</label>
      <p className="hint">{tr('Cliquez sur un bloc de la page pour le modifier ; écrivez directement dans les blocs de texte.')}</p>
    </div>
  );
}

/**
 * Filtres d'un bloc : vide = hérite du rapport ; « all » = ignorer le filtre du rapport.
 * `officeKinds` : clés de bureau que le jeu sait filtrer (bureau MEMS, « sans bureau »).
 */
function BlockFilters({ filters, onChange, forms, offices, supported = ['office', 'form'], officeKinds = ['id', 'unlinked'] }) {
  const { tr } = useI18n();
  const set = (k, v) => onChange({ ...filters, [k]: v || undefined });
  const foreign = filters.office && filters.office !== 'all' && !officeKinds.includes(filters.office === 'unlinked' ? 'unlinked' : filters.office.split(':')[0]);
  return (
    <>
      {supported.includes('form') && (
        <Field label={tr('Activité (fiche)')}>
          <select className="select" value={filters.formId || ''} onChange={(e) => set('formId', e.target.value)}>
            <option value="">{tr('Hérite du rapport')}</option><option value="all">{tr('Toutes (ignorer le filtre du rapport)')}</option>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
      )}
      {supported.includes('office') && (
        <Field label={tr('Bureau')}>
          <select className="select" value={filters.office || ''} onChange={(e) => set('office', e.target.value)}>
            <option value="">{tr('Hérite du rapport')}</option><option value="all">{tr('Tous (ignorer le filtre du rapport)')}</option>
            {officeKinds.includes('id') && <optgroup label={tr('Bureaux MEMS')}>{offices.map((o) => <option key={o.id} value={`id:${o.id}`}>{o.parentId ? `· ${o.name}` : o.name}</option>)}</optgroup>}
            {officeKinds.includes('unlinked') && <option value="unlinked">{tr('Sans bureau MEMS')}</option>}
            {foreign && <option value={filters.office}>{tr('Bureau (libellé ou code d\'une fiche)')}</option>}
          </select>
          {foreign && <p className="hint">{tr('Ce jeu ne se filtre que par bureau MEMS.')}</p>}
        </Field>
      )}
    </>
  );
}

/** Arguments d'un jeu de données (indicateur, seuil, regroupement…), déclarés par le catalogue. */
const ARG_CHOICES = { activity: 'Programme (activité)', provider: 'Prestataire', office: 'Bureau', district: 'District' };
// Listes de choix des arguments (contrat, partenaire, facture) : lues à la demande.
const CHOICE_LOADERS = {
  contracts: () => api.listContracts().then((r) => (r || []).filter((c) => c.status !== 'brouillon').map((c) => ({ id: c.id, label: `${c.numero} — ${c.partnerName || ''}` }))),
  partners: () => api.listPartners().then((r) => (r || []).filter((p) => p.active !== false).map((p) => ({ id: p.id, label: p.name }))),
  reports: () => api.listReports({ kind: 'financier' }).then((r) => (r || []).filter((x) => x.kind === 'financier').map((x) => ({ id: x.id, label: `${String(x.periodMonth || '').slice(0, 7)} · ${x.partnerName || ''} · ${x.contractNumero || ''}` }))),
};
function useChoices(kind) {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!kind || !CHOICE_LOADERS[kind]) { setList(null); return undefined; }
    let alive = true;
    CHOICE_LOADERS[kind]().then((r) => { if (alive) setList(r); }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [kind]);
  return list;
}
function ChoiceArg({ name, spec, value, onChange }) {
  const { tr } = useI18n();
  const list = useChoices(spec.choices);
  return (
    <Field label={tr(spec.label)}>
      <select className="select" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>
        <option value="">{spec.required ? tr('Choisir…') : tr('Hérite du rapport')}</option>
        {(list || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </Field>
  );
}
function ArgsEditor({ def, args, filters, forms, onChange }) {
  const { tr } = useI18n();
  const [inds, setInds] = useState(null);
  const needsInd = Object.values(def.args || {}).some((a) => a.choices === 'indicators');
  const formId = filters && filters.formId && filters.formId !== 'all' ? filters.formId : (forms.length === 1 ? forms[0].id : null);
  useEffect(() => {
    if (!needsInd || !formId) { setInds(null); return undefined; }
    let alive = true;
    api.monIndicators(formId).then((r) => { if (alive) setInds(r || []); }).catch(() => { if (alive) setInds([]); });
    return () => { alive = false; };
  }, [needsInd, formId]);
  const entries = Object.entries(def.args || {});
  if (!entries.length) return null;
  const set = (k, v) => onChange({ ...(args || {}), [k]: v === '' || v == null ? undefined : v });
  return (
    <fieldset className="rd-checks"><legend>{tr('Paramètres des données')}</legend>
      {entries.map(([k, a]) => {
        const v = (args || {})[k];
        if (a.choices === 'indicators') {
          return (
            <Field key={k} label={tr(a.label)} hint={formId ? null : tr('Choisissez d\'abord une activité (fiche) dans les filtres du bloc.')}>
              <select className="select" value={v || ''} disabled={!formId} onChange={(e) => set(k, e.target.value)}>
                <option value="">{tr('Choisir…')}</option>
                {(inds || []).filter((i) => i.active !== false).map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ${i.label}` : i.label}</option>)}
              </select>
            </Field>
          );
        }
        if (CHOICE_LOADERS[a.choices]) return <ChoiceArg key={k} name={k} spec={a} value={v} onChange={set} />;
        if (a.type === 'enum') {
          return (
            <Field key={k} label={tr(a.label)}>
              <select className="select" value={v || a.default || ''} onChange={(e) => set(k, e.target.value)}>
                {a.choices.map((c) => <option key={c} value={c}>{tr(ARG_CHOICES[c] || c)}</option>)}
              </select>
            </Field>
          );
        }
        if (a.type === 'number') {
          return <Field key={k} label={tr(a.label)}><input className="input" type="number" value={v ?? ''} placeholder={a.default != null ? String(a.default) : ''} onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))} /></Field>;
        }
        return <Field key={k} label={tr(a.label)}><input className="input" value={v || ''} maxLength={200} onChange={(e) => set(k, e.target.value)} /></Field>;
      })}
    </fieldset>
  );
}

function BlockProps({ block, parent, catalog, forms, offices, data, onChange, onRegenerate }) {
  const { tr } = useI18n();
  const p = block.params;
  const def = block.type === 'data' ? catalog.datasets[p.dataset] : null;
  return (
    <div className="section-gap">
      <h3>{tr(TYPE_LABEL[block.type] || block.type)}</h3>
      {parent && parent.type === 'repeat' && <p className="hint">{tr('Dans une section répétée : recalculé pour chaque élément.')}</p>}
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
        <BlockFilters filters={p.filters || {}} onChange={(f) => onChange({ filters: f })} forms={forms} offices={offices} />
      </>}
      {block.type === 'kpis' && <>
        <fieldset className="rd-checks"><legend>{tr('Chiffres affichés')}</legend>
          {Object.entries(catalog.kpis).map(([k, kp]) => (
            <label key={k} className="check"><input type="checkbox" checked={p.metrics.includes(k)} disabled={(p.metrics.length >= 8 && !p.metrics.includes(k)) || kp.available === false}
              onChange={(e) => { const m = e.target.checked ? [...p.metrics, k] : p.metrics.filter((x) => x !== k); if (m.length) onChange({ metrics: m }); }} /> {tr(kp.label)}</label>
          ))}
        </fieldset>
        <BlockFilters filters={p.filters || {}} onChange={(f) => onChange({ filters: f })} forms={forms} offices={offices} />
      </>}
      {block.type === 'data' && <>
        <Field label={tr('Données')}>
          <select className="select" value={p.dataset} onChange={(e) => { const d = catalog.datasets[e.target.value]; onChange({ dataset: e.target.value, view: d ? d.defaultView : 'table', columns: undefined, measure: undefined, sort: undefined }); }}>
            {catalog.groups.map((g) => (
              <optgroup key={g.key} label={tr(g.label)}>
                {g.items.map((k) => <option key={k} value={k} disabled={catalog.datasets[k].available === false}>{tr(catalog.datasets[k].label)}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        {def && def.origin && <p className="hint">{tr('Même calcul que : {page}', { page: tr(def.origin.page) })}</p>}
        {def && def.available === false && <p className="hint">{tr(def.reason)}</p>}
        {def && <Field label={tr('Présentation')}><select className="select" value={p.view || def.defaultView} onChange={(e) => onChange({ view: e.target.value })}>
          {def.views.map((v) => <option key={v} value={v}>{tr(VIEW_LABELS[v] || v)}</option>)}
        </select></Field>}
        <Field label={tr('Titre')}><input className="input" value={(p.figure && p.figure.title) || ''} maxLength={200} onChange={(e) => onChange({ figure: { ...(p.figure || {}), title: e.target.value || undefined } })} /></Field>
        {def && !def.dynamicColumns && (
          <fieldset className="rd-checks"><legend>{tr('Colonnes')}</legend>
            {def.columns.map((c) => {
              const cols = p.columns || def.columns.map((x) => x.key);
              return <label key={c.key} className="check"><input type="checkbox" checked={cols.includes(c.key)} onChange={(e) => {
                const next = e.target.checked ? [...cols, c.key] : cols.filter((x) => x !== c.key);
                onChange({ columns: next.length === def.columns.length ? undefined : def.columns.map((x) => x.key).filter((k) => next.includes(k)) });
              }} /> {tr(c.label)}</label>;
            })}
          </fieldset>
        )}
        <Field label={tr('Nombre de lignes max.')}><input className="input" type="number" min="1" max="500" value={p.limit || ''} onChange={(e) => onChange({ limit: e.target.value ? Math.max(1, Math.min(500, Number(e.target.value))) : undefined })} /></Field>
        <BlockFilters filters={p.filters || {}} onChange={(f) => onChange({ filters: f })} forms={forms} offices={offices} supported={def ? def.filters : []} officeKinds={def ? def.officeKinds : undefined} />
        {def && <ArgsEditor def={def} args={p.args} filters={p.filters} forms={forms} onChange={(args) => onChange({ args })} />}
      </>}
      {block.type === 'section' && <>
        <Field label={tr('Orientation')}><select className="select" value={p.orientation || 'portrait'} onChange={(e) => onChange({ orientation: e.target.value })}>
          <option value="portrait">{tr('Portrait')}</option><option value="landscape">{tr('Paysage')}</option>
        </select></Field>
        <Field label={tr('Titre')}><input className="input" value={p.title || ''} maxLength={200} onChange={(e) => onChange({ title: e.target.value || undefined })} /></Field>
        <p className="hint">{tr('Une section commence une nouvelle page avec sa propre orientation.')}</p>
      </>}
      {block.type === 'columns' && <Field label={tr('Répartition')}><select className="select" value={p.ratio} onChange={(e) => {
        const ratio = e.target.value; const n = ratio.split(':').length;
        const cols = [...p.cols]; while (cols.length < n) cols.push([]);
        onChange({ ratio, cols: n < cols.length ? [...cols.slice(0, n - 1), cols.slice(n - 1).flat()] : cols });
      }}>{['1:1', '2:1', '1:2', '1:1:1'].map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>}
      {block.type === 'spacer' && <Field label={tr('Hauteur (mm)')}><input className="input" type="number" min="1" max="200" value={p.height || 8} onChange={(e) => onChange({ height: Math.max(1, Math.min(200, Number(e.target.value) || 8)) })} /></Field>}
      {block.type === 'repeat' && <>
        <Field label={tr('Répéter pour chaque')}><select className="select" value={p.over} onChange={(e) => onChange({ over: e.target.value })}>
          <option value="activity">{tr('Activité (fiche de suivi)')}</option><option value="bureau">{tr('Bureau')}</option><option value="partner">{tr('Partenaire')}</option>
        </select></Field>
        <p className="hint">{tr('Les blocs de la section sont recalculés pour chaque activité ou bureau ayant des données sur la période. Sélectionnez la section puis ajoutez des blocs pour les y placer.')}</p>
        {data?.expansions?.[block.id] && <p className="hint">{tr('{n} section(s) générée(s).', { n: data.expansions[block.id].length })}</p>}
      </>}
    </div>
  );
}

// Blocs qui attendent leurs données dans un cadre nommé (squelette, chronomètre, erreur + Réessayer).
const FRAMED = new Set(['data', 'kpis', 'bulletin']);
const DEFAULT_H = { data: 220, kpis: 84, bulletin: 120 };
function frameLabel(b, catalog, tr) {
  if (b.type === 'data') return (b.params.figure && b.params.figure.title) || tr((catalog.datasets[b.params.dataset] || {}).label || b.params.dataset);
  return tr(TYPE_LABEL[b.type] || b.type);
}

// Avertissements de la mise à niveau v1 → v2 (code + paramètres envoyés par le serveur).
const UPGRADE_WARNINGS = {
  office_removed: 'Filtre bureau « {name} » retiré : aucun bureau MEMS de ce nom (choisissez-le à nouveau).',
  view_replaced: 'Présentation « {from} » remplacée par « {to} » (non proposée pour ces données).',
};

const VIEW_LABELS = {
  table: 'Tableau', bar: 'Barres', column: 'Colonnes', line: 'Courbes', donut: 'Anneau', stacked: 'Barres empilées',
  heat: 'Matrice colorée', kpi: 'Tuile', list: 'Liste', card: 'Carte de résultat', explain: 'Explication', map: 'Carte', gauge: 'Jauge',
};
