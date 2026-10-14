import React, { useCallback, useEffect, useState } from 'react';
import { Plus, FileText, Lock, Trash2, LayoutTemplate } from 'lucide-react';
import { api } from '../../api/client.js';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { usePeriod } from '../../components/PeriodBanner.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatDateTime } from '../../lib/format.js';
import { single } from '../../lib/period.js';
import { defaultPage } from './reportDoc.js';
import ReportEditor from './editor/ReportEditor.jsx';
import ReportPeriod from './editor/ReportPeriod.jsx';
import './reports.css';

/**
 * Concepteur de rapport professionnel — BIBLIOTHÈQUE (rapports, modèles système et
 * d'équipe, création). L'éditeur à 3 volets est dans ./editor/ReportEditor.jsx :
 * documents v2 faits de blocs (texte riche, chiffres clés, blocs de données du catalogue,
 * bulletin rédigé, sections avec leur orientation, colonnes, sections répétées par
 * activité / bureau / partenaire), période « du … au … » (60 mois au plus), données
 * calculées côté serveur bloc par bloc.
 */
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
