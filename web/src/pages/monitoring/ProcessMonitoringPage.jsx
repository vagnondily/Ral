import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Upload, AlertCircle, ClipboardCheck, RefreshCw, ArrowLeft, ChevronRight,
  FileSpreadsheet, SlidersHorizontal, BarChart3, Link2, Trash2, Pencil, Check, Minus, Shuffle,
  Table2, Download, Search, Columns3, X, ChevronDown, ChevronUp, Ban, Undo2, AlertTriangle, Link as LinkIcon,
  CheckCircle2, Circle, Sparkles, Send, ShieldCheck, RotateCcw,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, PageHeader, Skeleton, Stats, StatusBadge } from '../../components/ui.jsx';
import { MAPPING_STATUS, DATE_KEYS, dateStats } from '../../lib/mappingWorkflow.js';
import Modal from '../../components/Modal.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import { periodLabel as labelOfPeriod, single } from '../../lib/period.js';
import { usePopover } from '../../components/listView.jsx';
import IndicatorsList from './IndicatorsList.jsx';
import IndicatorEditor from './IndicatorEditor.jsx';
import TemplateBindingCard from './TemplateBindingCard.jsx';
import { CalcFieldsCard } from './CalcFields.jsx';
import ImportWizard from './ImportWizard.jsx';
import CorrespondencesCard from './Correspondences.jsx';
import CodeLabel from '../../components/CodeLabel.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatCollectDate, formatDateTime, formatInt, formatLocale } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';
import { useI18n } from '../../lib/i18n.jsx';
import { PERIOD_CAPS } from '../../lib/periodCaps.js';
import { suggestActivity } from '../../lib/activitySuggest.js';

/**
 * Suivi de processus › Données & indicateurs.
 *
 * Le menu s'ouvre sur un **tableau des fiches** (une par activité / upload).
 * On entre dans une fiche pour en voir, par onglets : ses **variables**
 * (catalogue XLSForm — name, label, type, groupe, logique de saut), ses
 * **résultats** (indicateurs recalculés), le **mapping avec les référentiels
 * MEMS**, et la **configuration de la fiche** (paramètres, méthodes de calcul
 * des indicateurs, sources de données). Aucun sélecteur de mois en tête : la
 * période se choisit dans la barre d'outils des résultats.
 */
const AGG_SHORT = { percent_yes: '% de « oui »', percent_value: '% = valeur', mean: 'Moyenne', sum: 'Somme', count: 'Nombre' };

// Phrase traduite contenant des éléments JSX : « {nom} » → nodes[nom].
function fillNodes(text, nodes) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <React.Fragment key={i}>{nodes[part]}</React.Fragment> : part));
}

const DETAIL_TABS = [
  { id: 'variables', label: 'Variables', icon: FileSpreadsheet },
  // Retour n° 5 : l'import (assistant) et les données sont deux onglets distincts.
  { id: 'importation', label: 'Importation', icon: Upload },
  { id: 'donnees', label: 'Données', icon: Table2 },
  { id: 'resultats', label: 'Résultats', icon: BarChart3 },
  { id: 'mapping', label: 'Mapping MEMS', icon: Shuffle },
  { id: 'config', label: 'Configuration', icon: SlidersHorizontal },
];

// Colonnes « méta » typées (référentiels MEMS) affichées avant les variables.
const META_COLS = [
  // Date sans heure (date d'enquête) : la date seule, jamais « à 03:00 » (retour 80).
  { key: 'submittedAt', label: 'Date', fmt: (v) => formatCollectDate(v), cls: 'dv-date' },
  // Libellé d'abord (bureau MEMS rattaché, sinon libellé du choix : « 6 » → « Ambovombe »), code en repli ;
  // `code` = la valeur brute affichée en mode « Codes ».
  { key: 'officeName', alt: ['fieldOfficeLabel', 'fieldOffice'], code: 'fieldOffice', label: 'Bureau' },
  // admin2 = District, admin3 = Commune, admin4 = Fokontany (memsMapping) : nom du découpage (P-code),
  // sinon libellé de la liste de choix de la fiche (« 89 » → « Tomboarivo »), sinon la valeur brute.
  { key: 'districtName', alt: ['districtLabel', 'admin2'], code: 'admin2', label: 'District' },
  { key: 'communeName', alt: ['communeLabel', 'admin3'], code: 'admin3', label: 'Commune' },
  { key: 'fokontanyName', alt: ['fokontanyLabel', 'admin4'], code: 'admin4', label: 'Fokontany' },
  { key: 'siteLabel', alt: 'site', code: 'site', label: 'Site' },
  // Site du référentiel reconnu à l'import (DPName, POIName, école…) ; vide = à rapprocher.
  { key: 'siteName', label: 'Site du référentiel' },
  { key: 'partnerLabel', alt: 'partner', code: 'partner', label: 'Partenaire' },
  { key: 'agentLabel', alt: 'agent', code: 'agent', label: 'Agent' },
];

/**
 * Étapes pour qu'une fiche alimente les tableaux de bord et les rapports, dans
 * l'ordre où l'utilisateur doit les faire. `next` = la première non faite.
 */
function formSteps(f) {
  const steps = [
    { id: 'activity', done: !!f.activityCategory, label: 'Rattacher à une activité', hint: 'Relie la fiche aux sites de cette activité : couverture, sites actifs et plan de suivi.' },
    { id: 'data', done: (f.submissionCount ?? 0) > 0, label: 'Importer les données', hint: 'Export Kobo (.zip, .sav), Excel / CSV, lien ONA ou API Kobo.', tab: 'importation' },
    { id: 'indicators', done: (f.indicatorCount ?? 0) > 0, label: 'Définir les indicateurs', hint: 'Chaque indicateur relie une question du formulaire à un calcul (% de oui, moyenne…).', tab: 'config' },
  ];
  return { steps, next: steps.find((x) => !x.done) || null };
}

export default function ProcessMonitoringPage({ canEdit, isAdmin, formId = null, tab = null, onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [forms, setForms] = useState(null);
  const [selId, setSelId] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // fiche en cours de modification
  const [deleting, setDeleting] = useState(null); // fiche à supprimer
  const [attaching, setAttaching] = useState(null); // fiche à rattacher à une activité
  const [openTab, setOpenTab] = useState(null);     // onglet d'ouverture de la fiche

  async function loadForms() {
    setError(null);
    try { setForms(await api.monForms()); }
    catch (e) { setError(e.message); setForms([]); }
  }
  useEffect(() => { loadForms(); /* eslint-disable-next-line */ }, []);
  // Lien direct #/processus/donnees/<fiche>/<onglet> (ex. « Relier » un code de bureau → Mapping MEMS de CETTE fiche).
  useEffect(() => {
    if (formId) { setOpenTab(tab || null); setSelId(formId); } else { setSelId(null); setOpenTab(null); }
  }, [formId, tab]);

  const selected = (forms || []).find((f) => f.id === selId) || null;

  const xlsformRef = useRef(null);
  const [importingDef, setImportingDef] = useState(false);

  async function newForm() {
    const label = window.prompt(tr('Nom de la fiche de suivi (ex. Suivi de processus GD/PREVMA) :'));
    if (!label) return;
    const code = window.prompt(tr('Code court (ex. GD_PREVMA) :'), label.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 30));
    if (!code) return;
    try { const { id } = await api.monCreateForm({ code, label }); await loadForms(); setSelId(id); toast.success(tr('Fiche créée.')); }
    catch (e) { toast.error(e.message); }
  }

  async function onXlsform(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setImportingDef(true);
    try {
      const r = await api.monImportDefinition(f);
      await loadForms();
      setSelId(r.formId);
      toast.success(tr('Fiche « {label} » importée : {fields} variable(s), {choices} choix.', { label: r.label, fields: r.fields, choices: r.choices }));
    } catch (err) { toast.error(err.message); } finally { setImportingDef(false); }
  }

  const open = (f, tab = null) => { setOpenTab(tab); setSelId(f.id); };
  // Prochaine étape d'une fiche : rattacher (fenêtre dédiée) ou ouvrir le bon onglet.
  const doStep = (f, step) => (step.id === 'activity' ? setAttaching(f) : open(f, step.tab));

  if (selected) {
    const back = () => { setSelId(null); setOpenTab(null); if (formId && onNavigate) onNavigate('processus', 'donnees'); };
    return <FormDetail key={`${selected.id}-${openTab || ''}`} form={selected} canEdit={canEdit} initialTab={openTab} onBack={back} onChanged={loadForms} />;
  }

  return (
    <div className="section-gap">
      <PageHeader title={tr('Suivi de processus — fiches & indicateurs')} description={tr('Chaque fiche correspond à une activité suivie. Importez un XLSForm (Kobo/ODK) ou créez une fiche, puis ouvrez-la pour ses variables, ses résultats, le mapping MEMS et sa configuration.')}>
        {canEdit && <><input ref={xlsformRef} type="file" accept=".xlsx,.xls" hidden onChange={onXlsform} />
          <Button variant="secondary" icon={Upload} loading={importingDef} onClick={() => xlsformRef.current?.click()}>{tr('Importer un XLSForm')}</Button></>}
        {canEdit && <Button icon={Plus} onClick={newForm}>{tr('Nouvelle fiche')}</Button>}
      </PageHeader>

      {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

      {forms === null ? <Card><div className="card-body"><Skeleton height={160} /></div></Card>
        : forms.length === 0 ? (
          <Card><EmptyState icon={ClipboardCheck} title={tr('Aucune fiche de suivi')}
            action={canEdit && <Button icon={Plus} onClick={newForm}>{tr('Nouvelle fiche')}</Button>}>
            {tr('Importez un XLSForm (Kobo/ODK) ou créez une fiche, puis configurez ses indicateurs et importez les données réelles.')}
          </EmptyState></Card>
        ) : (
          <Card aria-label={tr('Fiches de suivi')}>
            <CardHeader title={tr('Fiches de suivi')} subtitle={tr('{n} fiche(s) — cliquez sur une ligne pour l\'ouvrir. La colonne « Prochaine étape » indique ce qu\'il reste à faire pour que la fiche alimente les tableaux de bord.', { n: forms.length })} />
            {canEdit && forms.some((f) => !f.activityCategory) && (() => {
              const todo = forms.filter((f) => !f.activityCategory);
              return (
                <div className="card-body" style={{ paddingBottom: 0 }}>
                  <Alert tone="warning" icon={AlertTriangle}>
                    {tr('{n} fiche(s) non rattachée(s) à une activité : leur couverture et leur place dans le plan de suivi ne peuvent pas être calculées.', { n: todo.length })}
                    {' '}<button type="button" className="inline-link" onClick={() => setAttaching(todo[0])}>{todo.length === 1 ? tr('Rattacher la fiche « {label} »', { label: todo[0].label }) : tr('Rattacher la première')}</button>
                  </Alert>
                </div>
              );
            })()}
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th scope="col">{tr('Fiche')}</th><th scope="col">{tr('Activité (MMR)')}</th>
                  <th scope="col" className="num">{tr('Soumissions')}</th><th scope="col" className="num">{tr('Indicateurs')}</th>
                  <th scope="col">{tr('Prochaine étape')}</th><th scope="col" className="num">{tr('Actions')}</th>
                </tr></thead>
                <tbody>
                  {forms.map((f) => {
                    const { next } = formSteps(f);
                    return (
                      <tr key={f.id} className="clickable" onClick={() => open(f)}>
                        <td><strong>{f.label}</strong><div className="site-meta mono">{f.code}</div>
                          {!f.active && <Badge tone={null} dot>{tr('Inactive')}</Badge>}</td>
                        <td onClick={(e) => e.stopPropagation()}>{f.activityCategory
                          ? <span className="nowrap"><LinkIcon size={13} className="muted" aria-hidden="true" /> {f.activityCategory}</span>
                          : canEdit
                            ? <button type="button" className="step-chip is-warn" onClick={() => setAttaching(f)}><AlertTriangle size={13} aria-hidden="true" /> {tr('À rattacher')}</button>
                            : <Badge tone="orange" icon={AlertTriangle}>{tr('À rattacher')}</Badge>}</td>
                        <td className="num tabular">{formatInt(f.submissionCount ?? 0)}</td>
                        <td className="num tabular">{f.indicatorCount ?? 0}</td>
                        <td onClick={(e) => e.stopPropagation()}>{next
                          ? <button type="button" className="step-chip" title={tr(next.hint)} onClick={() => doStep(f, next)} disabled={!canEdit && next.id !== 'data'}>
                            <Circle size={12} aria-hidden="true" /> {tr(next.label)}</button>
                          : <span className="step-chip is-done"><CheckCircle2 size={13} aria-hidden="true" /> {tr('Prête')}</span>}</td>
                        <td className="num nowrap" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" onClick={() => open(f)}>{tr('Ouvrir')}</Button>
                          {canEdit && <IconButton icon={Pencil} label={tr('Modifier')} onClick={() => setEditing(f)} />}
                          {canEdit && <IconButton icon={Trash2} label={tr('Supprimer')} onClick={() => setDeleting(f)}
                            disabled={f.submissionCount > 0 && !isAdmin} title={f.submissionCount > 0 && !isAdmin ? tr('Fiche avec données : désactivez-la (seul un administrateur peut la supprimer).') : undefined} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      {editing && <FormEditModal form={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await loadForms(); }} />}
      {deleting && <FormDeleteModal form={deleting} onClose={() => setDeleting(null)} onDeleted={async () => { setDeleting(null); await loadForms(); }} />}
      {attaching && <AttachActivityModal form={attaching} onClose={() => setAttaching(null)} onSaved={async () => { setAttaching(null); await loadForms(); }} />}
    </div>
  );
}

/**
 * Rattacher une fiche à une activité du MMR, en un clic : la liste des
 * activités, avec en tête une suggestion déduite du nom de la fiche.
 */
function AttachActivityModal({ form, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [activities, setActivities] = useState(null);
  const [choice, setChoice] = useState(form.activityCategory || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.listMmr().then((rows) => {
      const list = [...new Set(rows.map((r) => String(r.activityCategory || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      setActivities(list);
      if (!form.activityCategory) setChoice(suggestActivity(form, list) || '');
    }).catch((e) => { toast.error(e.message); setActivities([]); });
    /* eslint-disable-next-line */
  }, [form.id]);
  const suggested = activities ? suggestActivity(form, activities) : null;
  const ordered = activities ? [...(suggested ? [suggested] : []), ...activities.filter((a) => a !== suggested)] : [];
  async function save() {
    setSaving(true);
    try {
      await api.monUpdateForm(form.id, { activityCategory: choice || null });
      toast.success(tr('« {label} » est rattachée à « {activity} ».', { label: form.label, activity: choice }));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={tr('Rattacher à une activité')} subtitle={form.label}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button><Button icon={Check} loading={saving} disabled={!choice} onClick={save}>{tr('Rattacher')}</Button></>}>
      <p className="hint" style={{ marginTop: 0 }}>{tr('L\'activité relie la fiche aux sites de cette activité : la couverture, les sites actifs, le plan de suivi et les rapports en dépendent. Choisissez l\'activité suivie par ce formulaire.')}</p>
      {activities === null ? <Skeleton height={200} /> : activities.length === 0 ? (
        <Alert tone="warning" icon={AlertTriangle}>{tr('Aucune activité dans le MMR : paramétrez-les d\'abord (Paramétrage › Paramètres MMR).')}</Alert>
      ) : (
        <ul className="pm-pick" role="radiogroup" aria-label={tr('Activités du MMR')}>
          {ordered.map((a) => (
            <li key={a}>
              <button type="button" role="radio" aria-checked={choice === a} className={`pm-pick-item${choice === a ? ' is-selected' : ''}`} onClick={() => setChoice(a)}>
                {choice === a ? <CheckCircle2 size={15} aria-hidden="true" className="pm-pick-ic" /> : <Circle size={15} aria-hidden="true" className="pm-pick-ic muted" />}
                {a}
                {a === suggested && <span className="badge badge-blue" style={{ marginLeft: 8 }}><Sparkles size={12} aria-hidden="true" /> {tr('Suggestion')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Modifier une fiche : nom, activité du MMR (liaison sites / couverture / plan), statut. */
function FormEditModal({ form, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [label, setLabel] = useState(form.label);
  const [activity, setActivity] = useState(form.activityCategory || '');
  const [active, setActive] = useState(form.active);
  const [activities, setActivities] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.listMmr().then((rows) => setActivities([...new Set(rows.map((r) => String(r.activityCategory || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))))
      .catch(() => setActivities([]));
  }, []);
  async function save() {
    setSaving(true);
    try {
      await api.monUpdateForm(form.id, { label: label.trim(), active, activityCategory: activity || null });
      toast.success(tr('Fiche mise à jour.'));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={tr('Modifier la fiche')} subtitle={form.code}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button><Button icon={Check} loading={saving} disabled={!label.trim()} onClick={save}>{tr('Enregistrer')}</Button></>}>
      <div className="section-gap">
        <Field label={tr('Nom de la fiche')} required><input className="input" value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label={tr('Activité (MMR)')} hint={tr('Relie la fiche aux sites de cette activité : couverture, sites actifs et plan de suivi en dépendent. Les activités se définissent dans Paramétrage › Paramètres MMR.')}>
          {activities === null ? <Skeleton height={38} /> : (
            <select className="select" value={activity} onChange={(e) => setActivity(e.target.value)}>
              <option value="">{tr('— Non rattachée —')}</option>
              {activities.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </Field>
        {activities && activities.length === 0 && <Alert tone="warning" icon={AlertTriangle}>{tr('Aucune activité dans le MMR : paramétrez-les d\'abord (Paramétrage › Paramètres MMR).')}</Alert>}
        <Field label={tr('Statut')}>
          <div className="segmented" role="group" aria-label={tr('Statut')}>
            <button type="button" aria-pressed={active} onClick={() => setActive(true)}>{tr('Active')}</button>
            <button type="button" aria-pressed={!active} onClick={() => setActive(false)}>{tr('Inactive')}</button>
          </div>
        </Field>
        {!active && <p className="hint">{tr('Une fiche inactive garde ses données mais n\'apparaît plus dans les synthèses.')}</p>}
      </div>
    </Modal>
  );
}

/** Supprimer une fiche : simple sans données ; avec données, l'administrateur ressaisit le code. */
function FormDeleteModal({ form, onClose, onDeleted }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const withData = form.submissionCount > 0;
  async function remove() {
    setBusy(true);
    try {
      const r = await api.monDeleteForm(form.id, withData ? confirm.trim() : undefined);
      toast.success(withData ? tr('Fiche supprimée avec ses {n} soumission(s).', { n: r.submissions }) : tr('Fiche supprimée.'));
      onDeleted();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={tr('Supprimer la fiche')} subtitle={form.label}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button>
        <Button variant="danger" icon={Trash2} loading={busy} disabled={withData && confirm.trim() !== form.code} onClick={remove}>{tr('Supprimer définitivement')}</Button></>}>
      <div className="section-gap">
        {withData ? <>
          <Alert tone="danger" icon={AlertTriangle}>{tr('Cette fiche contient {n} soumission(s). Elles seront supprimées avec elle, ainsi que ses indicateurs. Préférez « Modifier › Inactive » pour la retirer des synthèses sans rien perdre.', { n: form.submissionCount })}</Alert>
          <Field label={tr('Pour confirmer, saisissez le code de la fiche : {code}', { code: form.code })}>
            <input className="input mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
        </> : <p>{tr('La fiche, ses variables et ses indicateurs seront supprimés. Elle ne contient aucune soumission.')}</p>}
      </div>
    </Modal>
  );
}

// ======================================================================
// Détail d'une fiche
// ======================================================================
function FormDetail({ form, canEdit, initialTab, onBack, onChanged }) {
  const { tr } = useI18n();
  // « modele » (lien « Appliquer le modèle d'activité », retour 85) : Configuration, modèle en vue.
  const [tab, setTab] = useState(initialTab === 'modele' ? 'config' : (initialTab || 'variables'));
  const [attaching, setAttaching] = useState(false);
  const [editingForm, setEditingForm] = useState(false); // nom, activité, statut de la fiche
  const { steps, next } = formSteps(form);
  return (
    <div className="section-gap">
      <div className="detail-head">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>{tr('Toutes les fiches')}</Button>
      </div>
      <PageHeader title={form.label} description={tr('Code {code} · {n} indicateur(s) · {m} soumission(s).', { code: form.code, n: form.indicatorCount ?? 0, m: form.submissionCount ?? 0 })}>
        {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setEditingForm(true)}>{tr('Modifier la fiche')}</Button>}
      </PageHeader>

      {next ? (
        <Card aria-label={tr('Étapes de la fiche')}>
          <div className="card-body">
            <div className="form-steps-title">{tr('Pour que cette fiche alimente les tableaux de bord et les rapports')}</div>
            <ol className="form-steps">
              {steps.map((st, i) => (
                <li key={st.id} className={st.done ? 'is-done' : st === next ? 'is-next' : ''}>
                  <span className="form-step-n" aria-hidden="true">{st.done ? <Check size={14} /> : i + 1}</span>
                  <div className="form-step-body">
                    <strong>{tr(st.label)}</strong>
                    <span className="muted">{st.id === 'activity' && st.done ? form.activityCategory : tr(st.hint)}</span>
                  </div>
                  {st.done && st.id === 'activity' && canEdit && (
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditingForm(true)}>{tr('Changer')}</Button>
                  )}
                  {!st.done && (canEdit || st.id === 'data') && (
                    <Button size="sm" variant={st === next ? 'primary' : 'secondary'}
                      onClick={() => (st.id === 'activity' ? setAttaching(true) : setTab(st.tab))}>{tr(st.id === 'activity' ? 'Rattacher' : st.id === 'data' ? 'Importer' : 'Définir')}</Button>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </Card>
      ) : (
        <p className="hint"><CheckCircle2 size={14} aria-hidden="true" style={{ verticalAlign: '-2px', color: 'var(--green)' }} /> {tr('Fiche prête : rattachée à « {activity} », elle alimente la Synthèse, Couverture & performance et le concepteur de rapport.', { activity: form.activityCategory })}
          {canEdit && <> <button type="button" className="link-btn" onClick={() => setEditingForm(true)}>{tr('Changer l\'activité')}</button></>}</p>
      )}
      {attaching && <AttachActivityModal form={form} onClose={() => setAttaching(false)} onSaved={async () => { setAttaching(false); await onChanged?.(); }} />}
      {editingForm && <FormEditModal form={form} onClose={() => setEditingForm(false)} onSaved={async () => { setEditingForm(false); await onChanged?.(); }} />}

      <div className="seg" role="tablist" aria-label={tr('Sections de la fiche')}>
        {DETAIL_TABS.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'is-active' : ''} onClick={() => setTab(x.id)}>
              <Icon size={15} aria-hidden="true" /> {tr(x.label)}
            </button>
          );
        })}
      </div>

      {tab === 'variables' && <VariablesTab form={form} />}
      {tab === 'importation' && <ImportWizard form={form} canEdit={canEdit} onImported={onChanged}
        onGoData={() => setTab('donnees')} onGoResults={() => setTab('resultats')} />}
      {tab === 'donnees' && <DataViewTab form={form} canEdit={canEdit} onGoImport={() => setTab('importation')} />}
      {tab === 'resultats' && <ResultsTab form={form} canEdit={canEdit} onChanged={onChanged} onGoConfig={() => setTab('config')} onGoMapping={() => setTab('mapping')} />}
      {tab === 'mapping' && <MappingTab form={form} canEdit={canEdit} />}
      {tab === 'config' && <ConfigTab form={form} canEdit={canEdit} onChanged={onChanged} focusTemplate={initialTab === 'modele'} />}
    </div>
  );
}

// ---- Variables (catalogue XLSForm : name/label/type/groupe/skip logic) ---
function VariablesTab({ form }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set()); // questions dont la liste des choix est dépliée

  useEffect(() => {
    setCat(null);
    setOpen(new Set());
    api.monCatalog(form.id).then(setCat).catch((e) => { toast.error(e.message); setCat({ fields: [], choices: [] }); });
    /* eslint-disable-next-line */
  }, [form.id]);

  const choicesByList = useMemo(() => {
    const m = {};
    for (const c of cat?.choices || []) (m[c.listName] ||= []).push(c);
    return m;
  }, [cat]);

  const fields = useMemo(() => {
    const list = cat?.fields || [];
    if (!q) return list;
    const s = q.toLowerCase();
    // La recherche porte aussi sur les choix (code ou libellé) : « Manakara » retrouve sa question.
    return list.filter((f) => [f.name, f.label, f.group, f.type, f.relevant].some((x) => x && String(x).toLowerCase().includes(s))
      || (f.listName && (choicesByList[f.listName] || []).some((c) => `${c.value} ${c.label || ''}`.toLowerCase().includes(s))));
  }, [cat, q, choicesByList]);
  const toggle = (name) => setOpen((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const withChoices = (cat?.fields || []).filter((f) => f.listName && (choicesByList[f.listName] || []).length);
  const allOpen = withChoices.length > 0 && withChoices.every((f) => open.has(f.name));

  return (
    <Card aria-labelledby="vars-title">
      <CardHeader id="vars-title" title={tr('Variables du formulaire (XLSForm)')}
        subtitle={tr('Nom technique et libellé de chaque question, son type, son groupe, sa logique de saut (relevant) et ses choix — pour comprendre les données et les relier aux indicateurs.')}>
        {cat && withChoices.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(allOpen ? new Set() : new Set(withChoices.map((f) => f.name)))}>
            {allOpen ? tr('Replier tous les choix') : tr('Déplier tous les choix')}
          </Button>
        )}
        {cat && <span className="input-wrap ind-search"><input className="input" type="search" placeholder={tr('Filtrer les variables ou les choix…')} value={q} onChange={(e) => setQ(e.target.value)} /></span>}
      </CardHeader>
      {cat === null ? <div className="card-body"><Skeleton height={140} /></div>
        : (cat.fields || []).length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title={tr('Aucune variable')}>
            {tr('Importez la définition XLSForm de cette fiche (ou des données réelles) pour lister ses variables.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">{tr('Libellé (label)')}</th><th scope="col">{tr('Nom (name)')}</th><th scope="col">{tr('Type')}</th>
                <th scope="col">{tr('Choix')}</th><th scope="col">{tr('Groupe')}</th><th scope="col">{tr('Logique de saut (skip)')}</th>
              </tr></thead>
              <tbody>
                {fields.map((f) => {
                  const opts = f.listName ? (choicesByList[f.listName] || []) : [];
                  const isOpen = open.has(f.name);
                  const ql = q.toLowerCase();
                  return (
                    <React.Fragment key={f.name}>
                      <tr>
                        <td><strong>{f.label || f.name}</strong>{f.required ? <> <Badge tone="blue">{tr('obligatoire')}</Badge></> : null}</td>
                        <td><span className="mono">{f.name}</span></td>
                        <td className="muted">{f.type || '—'}</td>
                        <td>{opts.length
                          ? (
                            <button type="button" className="choices-toggle" aria-expanded={isOpen} aria-controls={`choices-${f.name}`} onClick={() => toggle(f.name)}>
                              {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                              {tr('{n} choix', { n: opts.length })} <span className="site-meta">({f.listName})</span>
                            </button>
                          )
                          : <span className="cell-empty">—</span>}</td>
                        <td className="muted">{f.group || '—'}</td>
                        <td>{f.relevant ? <code className="skip-expr" title={f.relevant}>{f.relevant}</code> : <span className="cell-empty">—</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr className="choices-row" id={`choices-${f.name}`}>
                          <td colSpan={6}>
                            <div className="choices-scroll">
                            <table className="choices-table">
                              <caption className="sr-only">{tr('Choix de « {q} »', { q: f.label || f.name })}</caption>
                              <thead><tr><th scope="col">{tr('Code (valeur)')}</th><th scope="col">{tr('Libellé')}</th></tr></thead>
                              <tbody>
                                {opts.map((o) => {
                                  const hit = ql && `${o.value} ${o.label || ''}`.toLowerCase().includes(ql);
                                  return (
                                    <tr key={o.value} className={hit ? 'is-hit' : ''}>
                                      <td><span className="mono">{o.value}</span></td>
                                      <td>{o.label || <span className="cell-empty">—</span>}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

// ---- Données importées (visualisation des soumissions brutes) ------------
const DATAVIEW_DEFAULT_VARS = 8; // nb de variables affichées par défaut (lisibilité)
const DV_PAGE = 1000; // soumissions chargées par page (« Charger les N suivantes »)
const DATAVIEW_STORE = 'mems.dataview.cols.v1';
function loadVarCols(formId) {
  try { return (JSON.parse(localStorage.getItem(DATAVIEW_STORE)) || {})[formId] || null; } catch { return null; }
}
function saveVarCols(formId, names) {
  try { const all = JSON.parse(localStorage.getItem(DATAVIEW_STORE)) || {}; all[formId] = names; localStorage.setItem(DATAVIEW_STORE, JSON.stringify(all)); } catch { /* ignore */ }
}

/** Valeur d'une colonne méta : la première clé renseignée (libellé puis code), ou le code brut en mode « Codes ». */
function metaRaw(r, m, codes) {
  if (codes && m.code) return r[m.code];
  for (const k of [m.key, ...[].concat(m.alt || [])]) { const v = r[k]; if (v != null && v !== '') return v; }
  return null;
}

function choiceLabeller(choices) {
  const map = {};
  for (const c of choices || []) (map[c.listName] ||= {})[c.value] = c.label;
  return (field, raw) => {
    if (raw == null || raw === '') return '—';
    if (field?.listName && map[field.listName]) {
      // select_multiple : plusieurs valeurs séparées par un espace.
      return String(raw).split(/\s+/).map((v) => map[field.listName][v] || v).join(', ');
    }
    if (typeof raw === 'object') return JSON.stringify(raw);
    return String(raw);
  };
}

const DV_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// Filtres « référentiels MEMS » de la grille : bureau, découpage administratif,
// date (année / mois). La date de collecte (svydate) est déjà dans les données,
// donc toutes les soumissions sont chargées et filtrées ici — pas de sélecteur
// de période imposé.
const DV_DIMS = [
  { key: 'bureau', label: 'Bureau', get: (r) => r.officeName || r.fieldOfficeLabel || r.fieldOffice },
  { key: 'region', label: 'Région', get: (r) => r.regionName || r.regionLabel || r.admin1 },
  { key: 'district', label: 'District', get: (r) => r.districtName || r.districtLabel || r.admin2 },
  { key: 'commune', label: 'Commune', get: (r) => r.communeName || r.communeLabel || r.admin3 },
  { key: 'fokontany', label: 'Fokontany', get: (r) => r.fokontanyName || r.fokontanyLabel || r.admin4 },
  { key: 'year', label: 'Année', get: (r) => (r.periodMonth ? r.periodMonth.slice(0, 4) : null) },
  // Nom du mois dans la langue de l'interface (formatLocale suit la langue ; en français, identique à DV_MONTHS).
  { key: 'mon', label: 'Mois', get: (r) => (r.periodMonth ? r.periodMonth.slice(5, 7) : null), fmt: (v) => (DV_MONTHS[Number(v) - 1] ? new Date(2000, Number(v) - 1, 1).toLocaleString(formatLocale(), { month: 'long' }) : v) },
];

function DataViewTab({ form, canEdit, onGoImport }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({});
  const [cat, setCat] = useState(null);
  const [res, setRes] = useState(null);

  const [view, setView] = useState('all'); // all | kept | excluded

  // Par pages de DV_PAGE (retour 80) : la suite se charge à la demande, et l'écran dit
  // toujours combien de soumissions restent à charger — jamais une limite silencieuse.
  const [loadingMore, setLoadingMore] = useState(false);
  function loadData() {
    setRes(null);
    Promise.all([
      api.monCatalog(form.id).catch(() => ({ fields: [], choices: [] })),
      api.monFormSubmissions(form.id, { limit: DV_PAGE, offset: 0 }),
    ]).then(([c, r]) => { setCat(c || { fields: [], choices: [] }); setRes(r); })
      .catch((e) => { toast.error(e.message); setCat({ fields: [], choices: [] }); setRes({ rows: [], total: 0, limit: 0 }); });
  }
  async function loadMore() {
    if (!res || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.monFormSubmissions(form.id, { limit: DV_PAGE, offset: res.rows.length });
      setRes((prev) => {
        // Ordre stable côté serveur ; une soumission déjà chargée (import entre-temps) n'est pas doublée.
        const seen = new Set(prev.rows.map((x) => x.id));
        return { ...prev, rows: [...prev.rows, ...r.rows.filter((x) => !seen.has(x.id))], total: r.total, excluded: r.excluded };
      });
    } catch (e) { toast.error(e.message); } finally { setLoadingMore(false); }
  }
  useEffect(() => { setCat(null); setFilters({}); setView('all'); loadData(); /* eslint-disable-next-line */ }, [form.id]);

  const rows = res?.rows || [];
  const remaining = res ? Math.max(0, (res.total || 0) - rows.length) : 0;
  const nextPage = Math.min(DV_PAGE, remaining);
  // Retour n° 2 : bascule « Libellés / Codes » (mémorisée), pour lire « Ambovombe » ou vérifier « 6 ».
  const [showCodes, setShowCodes] = useState(() => { try { return localStorage.getItem('mems.dv.codes') === '1'; } catch { return false; } });
  const toggleCodes = (v) => { setShowCodes(v); try { localStorage.setItem('mems.dv.codes', v ? '1' : '0'); } catch { /* stockage indisponible */ } };
  const baseLabelOf = useMemo(() => choiceLabeller(cat?.choices), [cat]);
  const labelOf = (field, raw) => (showCodes ? (raw == null || raw === '' ? '—' : String(raw)) : baseLabelOf(field, raw));
  // Nom de variable du XLSForm → clé réelle des données (« field_office » ↔ « Field_office » d'un export SPSS).
  const dataKey = useMemo(() => {
    const m = new Map();
    for (const r of rows.slice(0, 200)) for (const k of Object.keys(r.data || {})) if (!m.has(k.toLowerCase())) m.set(k.toLowerCase(), k);
    return m;
  }, [rows]);
  const cell = (r, name) => r.data?.[name] ?? r.data?.[dataKey.get(String(name).toLowerCase())];
  const calcCols = useMemo(() => (res?.calcFields || []).map((c) => ({ name: c.name, label: c.label || c.name, listName: null, calc: true })), [res]);

  // Options de filtre : une liste de valeurs distinctes par dimension présente.
  const dimOptions = useMemo(() => DV_DIMS.map((d) => {
    const vals = [...new Set(rows.map((r) => d.get(r)).filter((v) => v != null && v !== ''))].map(String).sort();
    return { ...d, vals };
  }).filter((d) => d.vals.length > 1), [rows]);

  // Colonnes « variables » : champs calculés (ƒ) d'abord, puis catalogue, sinon
  // clés vues dans les données.
  const varCols = useMemo(() => {
    // Catalogue (XLSForm) d'abord, puis les colonnes des données qu'il ne décrit pas
    // (variables propres à l'export SPSS, colonnes éclatées des choix multiples).
    const catFields = cat?.fields || [];
    const known = new Set(catFields.map((f) => f.name.toLowerCase()));
    const seen = new Map();
    for (const r of rows.slice(0, 200)) for (const k of Object.keys(r.data || {})) {
      if (!known.has(k.toLowerCase()) && !seen.has(k)) seen.set(k, { name: k, label: k, listName: null });
    }
    const base = [...catFields, ...seen.values()];
    const calcNames = new Set(calcCols.map((c) => c.name));
    return [...calcCols, ...base.filter((b) => !calcNames.has(b.name))];
  }, [cat, rows, calcCols]);

  // Sélecteur de colonnes : avec beaucoup de variables, on n'en affiche qu'un
  // sous-ensemble (lisibilité) ; le reste reste consultable dans le tiroir de
  // détail. Choix mémorisé par fiche. `null` = défaut (N premières).
  const [visibleNames, setVisibleNames] = useState(null);
  const colMenu = usePopover();
  useEffect(() => { setVisibleNames(loadVarCols(form.id)); }, [form.id]);
  const shownVarCols = useMemo(() => {
    if (!varCols.length) return [];
    if (visibleNames == null) return varCols.slice(0, DATAVIEW_DEFAULT_VARS);
    const set = new Set(visibleNames);
    const picked = varCols.filter((v) => set.has(v.name));
    return picked.length ? picked : varCols.slice(0, DATAVIEW_DEFAULT_VARS);
  }, [varCols, visibleNames]);
  const setVisible = (names) => { setVisibleNames(names); saveVarCols(form.id, names); };
  const toggleVar = (name) => {
    const base = visibleNames == null ? varCols.slice(0, DATAVIEW_DEFAULT_VARS).map((v) => v.name) : visibleNames;
    setVisible(base.includes(name) ? base.filter((x) => x !== name) : [...base, name]);
  };

  // Colonnes « méta » qui portent au moins une valeur (évite les colonnes vides).
  const metaCols = useMemo(() => META_COLS.filter((m) => rows.some((r) => {
    const v = metaRaw(r, m, false);
    return v != null && v !== '';
  })), [rows]);

  const metaVal = (r, m) => {
    const v = metaRaw(r, m, showCodes);
    return m.fmt ? m.fmt(v) : (v == null || v === '' ? '—' : String(v));
  };

  // Filtres de la grille (vue, référentiels, recherche) : les mêmes pour l'affichage et l'export.
  const matchRow = (r) => {
    if (view === 'kept' && r.excluded) return false;
    if (view === 'excluded' && !r.excluded) return false;
    for (const d of DV_DIMS) { if (filters[d.key] && String(d.get(r) ?? '') !== filters[d.key]) return false; }
    if (!q) return true;
    const s = q.toLowerCase();
    if (metaCols.some((m) => String(metaVal(r, m)).toLowerCase().includes(s))) return true;
    return Object.values(r.data || {}).some((v) => String(v ?? '').toLowerCase().includes(s));
  };
  const shown = useMemo(() => rows.filter(matchRow),
    /* eslint-disable-next-line */
    [rows, q, filters, view, metaCols, showCodes]);

  const [open, setOpen] = useState(null);
  const [expanded, setExpanded] = useState(false); // hauteur compacte ↔ liste complète

  // Sélection multiple (cases à cocher) + actions groupées — convention des
  // listes de l'app (sélection par ligne, tout cocher, export de la sélection).
  const rowKey = (r) => r.id || r.externalId;
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => { setSel(new Set()); }, [form.id, filters]);

  async function setExcluded(excluded) {
    const ids = [...sel];
    if (!ids.length) return;
    const reason = excluded ? (window.prompt(tr('Motif d\'exclusion (optionnel) :'), '') || undefined) : undefined;
    try {
      const r = await api.monSetExclusion(form.id, { ids, excluded, reason });
      toast.success(excluded ? tr('{n} soumission(s) exclue(s).', { n: r.updated }) : tr('{n} soumission(s) réintégrée(s).', { n: r.updated }));
      setSel(new Set()); loadData();
    } catch (e) { toast.error(e.message); }
  }
  const shownKeys = shown.map(rowKey);
  const allSel = shown.length > 0 && shownKeys.every((k) => sel.has(k));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(shownKeys));
  const toggleOne = (k) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Toutes les soumissions de la fiche (pages restantes) : l'export « tout » n'est jamais tronqué.
  async function fetchRest() {
    setLoadingMore(true);
    try {
      let all = res.rows; let { total, excluded } = res;
      const seen = new Set(all.map((x) => x.id));
      while (all.length < total) {
        const r = await api.monFormSubmissions(form.id, { limit: 2000, offset: all.length });
        total = r.total; excluded = r.excluded;
        const fresh = r.rows.filter((x) => !seen.has(x.id));
        if (!fresh.length) break;
        fresh.forEach((x) => seen.add(x.id));
        all = [...all, ...fresh];
      }
      setRes((prev) => ({ ...prev, rows: all, total, excluded }));
      return all;
    } catch (e) { toast.error(e.message); return null; } finally { setLoadingMore(false); }
  }

  async function exportCsv(which) {
    let list = which === 'sel' ? shown.filter((r, i) => sel.has(rowKey(r, i))) : shown;
    if (which !== 'sel' && remaining > 0) {
      const all = await fetchRest();
      if (!all) return;
      list = all.filter(matchRow);
    }
    const head = [...metaCols.map((m) => tr(m.label)), ...varCols.map((v) => v.label || v.name)];
    // Réponses brutes importées (texte libre) : formules neutralisées par downloadCsv.
    const lines = list.map((r) => [
      ...metaCols.map((m) => metaVal(r, m)),
      ...varCols.map((v) => { const raw = cell(r, v.name); return raw == null || raw === '' ? '' : labelOf(v, raw); }),
    ]);
    downloadCsv(`donnees_${form.code}.csv`, [head, ...lines]);
  }

  const loading = cat === null || res === null;
  return (
    <Card aria-labelledby="data-title">
      <CardHeader id="data-title" title={tr('Données importées (soumissions)')}
        subtitle={tr('Les réponses réellement versées, alignées sur les variables du formulaire (libellé + nom). Cliquez une ligne pour voir toutes les réponses.')} />
      {loading ? <div className="card-body"><Skeleton height={160} /></div>
        : rows.length === 0 ? (
          <EmptyState icon={Table2} title={tr('Aucune donnée importée')}
            action={<Button variant="secondary" icon={Upload} onClick={onGoImport}>{tr('Importer des données')}</Button>}>
            {tr('Importez des soumissions (onglet Importation) pour les visualiser ici.')}
          </EmptyState>
        ) : (
          <>
            <div className="filters-bar comet-filters dv-filters">
              <div className="comet-fields">
                <div className="cfilter">
                  <span className="cfilter-label">{tr('Vue')}</span>
                  <select className="select" value={view} onChange={(e) => setView(e.target.value)} aria-label={tr('Vue')}>
                    <option value="all">{tr('Toutes')}</option>
                    <option value="kept">{tr('Retenues (analyse)')}</option>
                    <option value="excluded">{tr('Exclues')}</option>
                  </select>
                </div>
                {dimOptions.map((d) => (
                  <div className="cfilter" key={d.key}>
                    <span className="cfilter-label">{tr(d.label)}</span>
                    <select className="select" value={filters[d.key] || ''} aria-label={tr(d.label)}
                      onChange={(e) => setFilters((f) => ({ ...f, [d.key]: e.target.value }))}>
                      <option value="">{tr('Tous')}</option>
                      {d.vals.map((v) => <option key={v} value={v}>{d.fmt ? d.fmt(v) : v}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {(DV_DIMS.some((d) => filters[d.key]) || view !== 'all') && (
                <div className="comet-icons"><Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => { setFilters({}); setView('all'); }}>{tr('Réinitialiser')}</Button></div>
              )}
            </div>
            <div className="data-toolbar dv-toolbar">
              <div className="data-toolbar-left">
                <span className="input-wrap dv-search"><Search size={16} aria-hidden="true" />
                  <input className="input" type="search" placeholder={tr('Filtrer les soumissions…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr('Filtrer les soumissions…')} />
                </span>
                {/* Jamais de limite silencieuse : ce qui est chargé, sur combien, et la suite à charger. */}
                <span className="dv-count tabular" role="status">
                  {remaining > 0
                    ? <>
                      {shown.length !== rows.length && <>{tr('{n} affichée(s)', { n: formatInt(shown.length) })} · </>}
                      <strong>{tr('{loaded} chargée(s) sur {total}', { loaded: formatInt(rows.length), total: formatInt(res.total) })}</strong>
                    </>
                    : <>
                      {shown.length !== rows.length
                        ? tr('{n} affichée(s) sur {total}', { n: formatInt(shown.length), total: formatInt(res.total) })
                        : tr('{n} soumission(s)', { n: formatInt(res.total) })}
                      {' · '}{tr('{k} retenue(s)', { k: formatInt(res.total - (res.excluded || 0)) })}
                      {res.excluded > 0 && <> · {tr('{x} exclue(s)', { x: formatInt(res.excluded) })}</>}
                    </>}
                </span>
                {remaining > 0 && (
                  <Button size="sm" variant="secondary" icon={ChevronDown} onClick={loadMore} disabled={loadingMore}
                    title={tr('Filtres et recherche portent sur les lignes chargées.')}>
                    {loadingMore ? tr('Chargement…') : tr('Charger les {m} suivantes', { m: formatInt(nextPage) })}
                  </Button>
                )}
              </div>
              <div className="data-toolbar-right">
                <div className="segmented" role="group" aria-label={tr('Affichage des réponses')}>
                  <button type="button" aria-pressed={!showCodes} onClick={() => toggleCodes(false)} title={tr('Afficher le libellé des réponses codées (« 6 » → « Ambovombe »)')}>{tr('Libellés')}</button>
                  <button type="button" aria-pressed={showCodes} onClick={() => toggleCodes(true)} title={tr('Afficher les codes tels que reçus')}>{tr('Codes')}</button>
                </div>
                <div className="pop-anchor" ref={colMenu.ref}>
                  <IconButton icon={Columns3} label={tr('Colonnes ({a}/{b})', { a: shownVarCols.length, b: varCols.length })} variant="secondary" size="sm" onClick={() => colMenu.setOpen((o) => !o)} />
                  {colMenu.open && (
                    <div className="pop-menu filter-menu" role="menu" style={{ maxHeight: 340, overflow: 'auto' }}>
                      <div className="pop-menu-label">{tr('Variables affichées ({a}/{b})', { a: shownVarCols.length, b: varCols.length })}</div>
                      {varCols.map((v) => (
                        <label key={v.name} className="filter-pick">
                          <input type="checkbox" checked={shownVarCols.some((s) => s.name === v.name)} onChange={() => toggleVar(v.name)} />
                          <span>{v.label || v.name}{v.label && v.label !== v.name ? <span className="site-meta"> · {v.name}</span> : null}</span>
                        </label>
                      ))}
                      <button type="button" className="pop-reset" onClick={() => setVisible(varCols.map((v) => v.name))}>{tr('Tout afficher')}</button>
                      <button type="button" className="pop-reset" onClick={() => setVisible(varCols.slice(0, DATAVIEW_DEFAULT_VARS).map((v) => v.name))}>{tr('Réduire ({n} premières)', { n: DATAVIEW_DEFAULT_VARS })}</button>
                    </div>
                  )}
                </div>
                <IconButton icon={Download} label={tr('Exporter tout (CSV)')} variant="secondary" size="sm" onClick={() => exportCsv('all')} />
              </div>
            </div>
            {sel.size > 0 && (
              <div className="ind-batch dv-batch">
                <span className="ind-batch-n">{tr('{n} sélectionnée(s)', { n: sel.size })}</span>
                {canEdit && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setExcluded(true)}>{tr("Exclure de l'analyse")}</Button>}
                {canEdit && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setExcluded(false)}>{tr('Réintégrer')}</Button>}
                <Button size="sm" variant="ghost" icon={Download} onClick={() => exportCsv('sel')}>{tr('Exporter la sélection')}</Button>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setSel(new Set())}>{tr('Désélectionner')}</Button>
              </div>
            )}
            <div className={`table-wrap data-scroll ${expanded ? 'is-expanded' : ''}`}>
              <table className="table data-grid">
                <thead><tr>
                  <th className="data-cb" scope="col"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label={tr('Tout sélectionner')} /></th>
                  {metaCols.map((m, mi) => <th key={m.key} scope="col" className={`dv-meta dv-${m.key}${mi === 0 ? ' data-first' : ''}`}>{tr(m.label)}</th>)}
                  {shownVarCols.map((v) => {
                    const label = v.calc ? `ƒ ${v.label || v.name}` : (v.label || v.name);
                    return (
                      <th key={v.name} scope="col" className={`data-var ${v.calc ? 'is-calc' : ''}`} title={label !== v.name ? `${label} · ${v.name}` : label}>
                        {/* Libellé puis nom technique, sur deux lignes au plus (texte complet au survol). */}
                        <span className="dv-th-label">{label}{label !== v.name && <> <span className="th-sub mono">{v.name}</span></>}</span>
                      </th>
                    );
                  })}
                </tr></thead>
                <tbody>
                  {shown.map((r, i) => {
                    const k = rowKey(r, i); const isSel = sel.has(k);
                    return (
                    <tr key={k} className={`clickable ${isSel ? 'is-selected' : ''} ${r.excluded ? 'is-excluded' : ''}`} onClick={() => setOpen(r)} title={r.excluded ? (r.excludeReason ? tr("Exclue de l'analyse — {reason}", { reason: r.excludeReason }) : tr("Exclue de l'analyse")) : undefined}>
                      <td className="data-cb" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleOne(k)} aria-label={tr('Sélectionner la soumission')} />
                      </td>
                      {metaCols.map((m, mi) => {
                        const text = metaVal(r, m);
                        return (
                          <td key={m.key} className={`dv-meta dv-${m.key}${m.cls ? ` ${m.cls}` : ''}${mi === 0 ? ' data-first' : ''}`} title={text !== '—' ? text : undefined}>
                            {mi === 0 && r.excluded ? <><Badge tone="red">{tr('exclue')}</Badge> </> : null}{text}
                          </td>
                        );
                      })}
                      {shownVarCols.map((v) => {
                        const raw = cell(r, v.name);
                        const text = raw == null || raw === '' ? null : labelOf(v, raw);
                        return <td key={v.name} className={`mono-cell data-var ${v.calc ? 'is-calc' : ''}`} title={text || undefined}>{text == null ? <span className="cell-empty">—</span> : text}</td>;
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(shown.length > 8 || remaining > 0) && (
              <div className="data-expand-row">
                {shown.length > 8 && (
                  <button type="button" className="data-expand" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
                    {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                    <span>{expanded ? tr('Réduire le tableau') : tr('Afficher les {n} lignes', { n: formatInt(shown.length) })}</span>
                  </button>
                )}
                {remaining > 0 && (
                  <button type="button" className="data-expand is-more" onClick={loadMore} disabled={loadingMore}>
                    <Download size={15} aria-hidden="true" />
                    <span>{loadingMore ? tr('Chargement…') : tr('Charger les {m} suivantes ({loaded} sur {total} chargées)', { m: formatInt(nextPage), loaded: formatInt(rows.length), total: formatInt(res.total) })}</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      {open && <SubmissionDrawer sub={open} varCols={varCols} metaCols={metaCols} metaVal={metaVal} labelOf={labelOf} cell={cell} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function SubmissionDrawer({ sub, varCols, metaCols, metaVal, labelOf, cell, onClose }) {
  const { tr } = useI18n();
  const extraKeys = Object.keys(sub.data || {}).filter((k) => !varCols.some((v) => v.name.toLowerCase() === k.toLowerCase()));
  return (
    <Modal open variant="drawer" size="md" title={tr('Soumission')}
      subtitle={sub.externalId ? sub.externalId : (sub.submittedAt ? formatCollectDate(sub.submittedAt) : undefined)}
      onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>{tr('Fermer')}</Button>}>
      <dl className="ind-kv">
        {metaCols.map((m) => (<React.Fragment key={m.key}><dt>{tr(m.label)}</dt><dd>{metaVal(sub, m)}</dd></React.Fragment>))}
      </dl>
      <h4 className="drawer-sub">{tr('Réponses')}</h4>
      <dl className="ind-kv">
        {varCols.map((v) => {
          const raw = cell(sub, v.name);
          return (<React.Fragment key={v.name}>
            <dt>{v.label || v.name}<div className="th-sub mono">{v.name}</div></dt>
            <dd>{raw == null || raw === '' ? <span className="cell-empty">—</span> : labelOf(v, raw)}</dd>
          </React.Fragment>);
        })}
        {extraKeys.map((k) => (<React.Fragment key={k}><dt className="mono">{k}</dt><dd>{String(sub.data[k])}</dd></React.Fragment>))}
      </dl>
    </Modal>
  );
}

// ---- Résultats (indicateurs recalculés · période dans la barre d'outils) --
/** Durée maximale des résultats d'une fiche (comme les endpoints d'analyse) : lib/periodCaps.analysis. */
const RESULTS_MAX_SPAN = PERIOD_CAPS.analysis;

/**
 * Résultats d'une fiche sur une PÉRIODE (lot 1b) : un seul calcul sur toutes les soumissions
 * de la période (jamais une moyenne de moyennes mensuelles). Période : URL, puis période de
 * travail de la session, puis le dernier mois de la fiche avec des données ; « Toutes les
 * périodes » reste proposé. Le détail « Comment c'est calculé » et l'éditeur d'indicateur
 * reçoivent la même période : la valeur expliquée est la valeur affichée.
 */
function ResultsTab({ form, canEdit, onGoConfig, onChanged, onGoMapping }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const [months, setMonths] = useState(null); // mois ayant des données : [{ month, submissions }]
  const [formLatest, setFormLatest] = useState(undefined); // dernier mois de la fiche : undefined = en attente
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);     // indicateur à modifier | {} (création) | null

  // Période par défaut : le dernier mois qui a des données (jamais un mois courant vide présenté comme tel).
  useEffect(() => {
    let alive = true;
    setMonths(null);
    api.monFormMonths(form.id)
      .then((r) => { if (alive) { setMonths(r.months || []); setFormLatest(r.latest ? single(r.latest) : null); } })
      .catch(() => { if (alive) { setMonths([]); setFormLatest(null); } });
    return () => { alive = false; };
  }, [form.id]);
  const { period, ready, source, capped, setPeriod, resetToDefault } = usePeriod({
    scope: 'analysis', defaultRule: 'custom', customDefault: formLatest, maxSpan: RESULTS_MAX_SPAN,
  });
  const key = period ? `${period.from}|${period.to}` : 'all';

  async function reload() {
    try {
      setData(await api.monDashboard(form.id, period));
      try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
    } catch (e) { toast.error(e.message); setData({ coverage: {}, byBureau: [], indicators: [], overallIndex: null }); }
  }
  useEffect(() => { if (!ready) return; setData(null); reload(); /* eslint-disable-next-line */ }, [form.id, ready, key]);

  const cov = data?.coverage || {};
  const periodLabel = period ? labelOfPeriod(period, lang) : tr('Toutes les périodes');
  const counts = useMemo(() => Object.fromEntries((months || []).map((m) => [m.month, m.submissions])), [months]);
  const periodControl = ready && (
    <span className="ind-period">{tr('Période')} <PeriodSelect compact allowAll value={period} onChange={setPeriod}
      counts={counts} latest={formLatest ? formLatest.to : null} maxSpan={RESULTS_MAX_SPAN} /></span>
  );
  const editor = edit && (
    <IndicatorEditor form={form} indicator={edit.id ? edit : null} period={period} canEdit={canEdit}
      onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChanged?.(); }} />
  );

  if (data === null) return <Card><div className="card-body"><Skeleton height={160} /></div></Card>;
  if (data.indicators.length === 0 && (cov.submissions || 0) === 0) {
    return (
      <Card><EmptyState icon={BarChart3} title={tr('Rien à afficher')}
        action={<>
          {canEdit && <Button icon={Plus} onClick={() => setEdit({})}>{tr('Nouvel indicateur')}</Button>}
          <Button variant="secondary" icon={SlidersHorizontal} onClick={onGoConfig}>{tr('Configurer la fiche')}</Button>
        </>}>
        {tr('Importez des données (onglet Importation) et définissez des indicateurs (onglet Configuration) pour alimenter les résultats.')}
      </EmptyState>{editor}</Card>
    );
  }
  return (
    <div className="section-gap">
      <SessionPeriodNote source={source} capped={capped} onReset={resetToDefault} />
      <Stats items={[
        { label: tr('Soumissions'), value: cov.submissions ?? 0, foot: tr('{period} · {n} bureau(x)', { period: periodLabel, n: cov.fieldOffices ?? 0 }) },
        { label: tr('Sites suivis'), value: cov.sites ?? 0, foot: tr('sites (données) distincts sur la période') },
        { label: tr('Agents'), value: cov.agents ?? 0, foot: tr('{n} prestataire(s)', { n: cov.partners ?? 0 }) },
        { label: tr('Indice moyen'), value: data.overallIndex == null ? '—' : data.overallIndex, suffix: data.overallIndex == null ? '' : '%', foot: tr('moyenne des indicateurs %') },
      ]} />
      <IndicatorsList indicators={data.indicators} moduleLabel={form.label} toolbarExtra={periodControl}
        canEdit={canEdit} onCreate={() => setEdit({})} onEdit={(i) => setEdit(i)}
        formId={form.id} period={period} periodLabel={periodLabel} />
      {editor}
      {data.byBureau?.length > 0 && (
        <Card aria-label={tr('Par bureau')}>
          <CardHeader title={tr('Couverture par bureau')} subtitle={tr('Répartition des soumissions et des sites suivis.')} />
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{tr('Bureau')}</th><th className="num">{tr('Soumissions')}</th><th className="num">{tr('Sites suivis')}</th></tr></thead>
            <tbody>
              {data.byBureau.map((b) => (
                <tr key={b.key || b.bureau}>
                  <td><strong>{b.status ? <CodeLabel row={b} /> : b.bureau}</strong>
                    {b.status === 'non_relie' && <> · <button type="button" className="inline-link" onClick={onGoMapping}>{tr('Relier')}</button></>}</td>
                  <td className="num mono">{b.submissions}</td><td className="num mono">{b.sites}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}

// ---- Mapping MEMS (auto-détecté + surcharge manuelle éditable) -----------
function MappingTab({ form, canEdit }) {
  // Colonnes (quelle question alimente quelle information MEMS), puis valeurs (quel code = quel objet MEMS).
  return (
    <div className="section-gap">
      <MappingColumnsCard form={form} canEdit={canEdit} />
      <CorrespondencesCard form={form} canEdit={canEdit} />
    </div>
  );
}

/**
 * Colonnes du « Mapping MEMS » et son cycle de vie (brouillon → soumis → validé,
 * demande « mettre auto, en icône : modifier, reseter si validé ou soumis,
 * soumettre, valider »). Les actions offertes viennent du serveur (`actions`,
 * mêmes règles que l'écriture) : modifier seulement en brouillon, valider par
 * une autre personne que le soumetteur, lecture seule une fois validé.
 */
function MappingColumnsCard({ form, canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null); // action en cours : submit | validate | reset | apply

  async function reload() {
    try { setData(await api.monMemsMapping(form.id)); }
    catch (e) { toast.error(e.message); setData({ rows: [], columns: [], actions: {}, workflow: null, dates: null }); }
  }
  useEffect(() => { setData(null); setEditing(false); reload(); /* eslint-disable-next-line */ }, [form.id]);

  const rows = data?.rows || [];
  const columns = data?.columns || [];
  const actions = data?.actions || {};
  const wf = data?.workflow || null;
  const status = wf?.status || 'brouillon';
  const editMode = canEdit && Boolean(actions.edit) && editing;
  useEffect(() => { if (!actions.edit) setEditing(false); }, [actions.edit]);

  async function onChange(r, value) {
    // '__auto__' → auto ; '' → non reliée ; sinon nom de colonne.
    setSaving(true);
    try {
      if (value === '__auto__') await api.monResetMemsMapping(form.id, r.key);
      else await api.monSetMemsMapping(form.id, r.key, value);
      await reload();
    } catch (e) { toast.error(e.message); await reload(); } finally { setSaving(false); }
  }

  async function runAction(action) {
    if (action === 'reset' && !window.confirm(tr('Remettre le mapping en brouillon ? Il devra être soumis puis validé de nouveau.'))) return;
    setBusy(action);
    try {
      await api.monMappingAction(form.id, action);
      toast.success(tr({ submit: 'Mapping soumis pour validation.', validate: 'Mapping validé.', reset: 'Mapping remis en brouillon.' }[action]));
      setEditing(false);
    } catch (e) { toast.error(e.message); } finally { setBusy(null); await reload(); }
  }

  async function applyToData() {
    setBusy('apply');
    try {
      const res = await api.monApplyMemsMapping(form.id);
      const moved = res.dates?.monthChanged || 0;
      toast.success([tr('Mapping appliqué ({n} dimension(s)) aux soumissions.', { n: res.applied }),
        moved ? tr('{n} soumission(s) changent de mois de collecte.', { n: formatInt(moved) }) : ''].filter(Boolean).join(' '));
      await reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }

  const selValue = (r) => (r.source === 'manuel' ? (r.column || '') : '__auto__');
  const matched = rows.filter((r) => r.column).length;
  const stats = dateStats(data?.dates);
  const who = (name) => name || tr('un compte supprimé');

  return (
    <Card aria-labelledby="mems-title">
      <CardHeader id="mems-title" title={tr('Mapping avec les référentiels MEMS')}
        subtitle={tr('Quelle colonne du formulaire alimente chaque dimension MEMS (bureau, zones, site, partenaire, agent, mois de collecte). Auto-détecté à partir des variables ; vous pouvez le corriger, puis le soumettre pour validation.')}>
        {data !== null && (
          <div className="map-head-actions">
            <StatusBadge map={MAPPING_STATUS} value={status} />
            {canEdit && actions.edit && (
              <IconButton icon={editMode ? Check : Pencil} variant={editMode ? 'secondary' : 'ghost'} aria-pressed={editMode}
                label={editMode ? tr('Terminer la modification') : tr('Modifier le mapping')} onClick={() => setEditing(!editMode)} />
            )}
            {canEdit && actions.submit && <IconButton icon={Send} label={tr('Soumettre le mapping pour validation')} disabled={Boolean(busy)} onClick={() => runAction('submit')} />}
            {canEdit && actions.validate && <IconButton icon={ShieldCheck} label={tr('Valider le mapping')} disabled={Boolean(busy)} onClick={() => runAction('validate')} />}
            {canEdit && actions.reset && <IconButton icon={RotateCcw} label={tr('Réinitialiser le mapping (retour en brouillon)')} disabled={Boolean(busy)} onClick={() => runAction('reset')} />}
            {canEdit && actions.apply && <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === 'apply'} disabled={Boolean(busy) && busy !== 'apply'} onClick={applyToData}>{tr('Appliquer aux soumissions')}</Button>}
          </div>
        )}
      </CardHeader>
      {data === null ? <div className="card-body"><Skeleton height={140} /></div> : (
        <>
          <div className="card-body map-intro">
            {wf && (
              <p className="map-workflow" role="status">
                {status === 'brouillon' && tr('Brouillon : modifiable. Soumettez-le quand il est juste ; une autre personne le validera.')}
                {status === 'soumis' && tr('Soumis par {who} le {at} — en attente de validation par une autre personne.', { who: who(wf.submittedByName), at: formatDateTime(wf.submittedAt) })}
                {status === 'valide' && tr('Validé par {who} le {at} (soumis par {sub}). Lecture seule : réinitialisez-le pour le modifier.', { who: who(wf.validatedByName), at: formatDateTime(wf.validatedAt), sub: who(wf.submittedByName) })}
                {actions.validateReason && <span className="text-warn"> {tr(actions.validateReason)}</span>}
              </p>
            )}
            <Alert tone={matched ? 'info' : 'warning'} icon={matched ? Link2 : AlertCircle}>
              {tr('{n} dimension(s) sur {t} reliée(s).', { n: matched, t: rows.length })} {!canEdit
                ? tr('La détection est automatique ; un administrateur ou validateur peut corriger le mapping.')
                : editMode
                  ? tr('Choisissez une colonne pour forcer le mapping, ou « Aucune » pour ignorer ; l\'icône « Automatique » rétablit la détection. Après correction, « Appliquer aux soumissions » recalcule les données déjà importées.')
                  : actions.edit
                    ? tr('Pour changer une colonne, cliquez sur « Modifier » (crayon).')
                    : tr('Mapping figé : réinitialisez-le (retour en brouillon) pour le modifier.')}
            </Alert>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">{tr('Dimension MEMS')}</th><th scope="col">{tr('Référentiel')}</th>
                <th scope="col">{tr('Colonne du formulaire')}</th><th scope="col">{tr('Source')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{tr(r.label)}</strong></td>
                    <td className="muted">{tr(r.mems)}</td>
                    <td>
                      {r.editable && editMode ? (
                        <div className="map-cell">
                          <select className="select" value={selValue(r)} disabled={saving} aria-label={tr(r.label)} onChange={(e) => onChange(r, e.target.value)}>
                            <option value="__auto__">{r.autoColumn ? tr('Automatique — {col}', { col: r.autoColumn }) : tr('Automatique — (aucune détectée)')}</option>
                            <option value="">{r.key === DATE_KEYS.survey ? tr('— Aucune (mois de réception) —') : tr('— Aucune (ignorer) —')}</option>
                            <optgroup label={tr('Colonnes du formulaire')}>
                              {columns.map((c) => <option key={c.name} value={c.name}>{c.label && c.label !== c.name ? `${c.label} — ${c.name}` : c.name}</option>)}
                            </optgroup>
                          </select>
                          {r.source === 'manuel' && (
                            <IconButton icon={Sparkles} size="sm" disabled={saving} label={tr('Automatique : rétablir la détection pour « {d} »', { d: tr(r.label) })} onClick={() => onChange(r, '__auto__')} />
                          )}
                        </div>
                      ) : r.column
                        ? <><span className="mono">{r.column}</span>{r.columnLabel && r.columnLabel !== r.column && <div className="site-meta">{r.columnLabel}</div>}</>
                        : <span className="cell-empty">—</span>}
                      {r.key === DATE_KEYS.survey && stats.total > 0 && (
                        <div className="map-date-note">
                          {tr('{n} soumission(s) sur {t} : mois de collecte différent du mois de réception.', { n: formatInt(stats.differs), t: formatInt(stats.total) })}
                          {stats.pendingUpload > 0 && <> {tr('Mois de réception inconnu pour {n} (importées avant cette règle : « Appliquer aux soumissions »).', { n: formatInt(stats.pendingUpload) })}</>}
                          {stats.withoutUpload > 0 && <> {tr('Sans date de réception : {n} — leurs données n\'en portent pas ; leur mois de réception restera inconnu.', { n: formatInt(stats.withoutUpload) })}</>}
                        </div>
                      )}
                      {r.key === DATE_KEYS.upload && (
                        <div className="map-date-note">{tr('Repli quand la date d\'enquête manque, est illisible, postérieure à l\'envoi ou de plus de 2 ans avant l\'envoi (à vérifier).')}</div>
                      )}
                    </td>
                    <td>
                      {r.source === 'manuel'
                        ? <Badge tone="blue" icon={Pencil}>{r.column ? tr('manuel') : tr('manuel · aucune')}</Badge>
                        : r.column
                          ? <Badge tone="green" icon={Check}>{tr('auto')}</Badge>
                          : <Badge tone={null} icon={Minus}>{tr('non relié')}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ---- Configuration (indicateurs + modèle de l'activité + champs calculés) --
function ConfigTab({ form, canEdit, onChanged, focusTemplate = false }) {
  // Les deux cartes se rechargent l'une l'autre (création depuis le modèle ↔ indicateur enregistré ou
  // supprimé), UNE fois : la carte qui écrit recharge ses propres données, l'autre reçoit un nouveau
  // refreshKey. Plus de remontage des deux cartes (qui rechargeait deux fois indicateurs et variables).
  const [indRefresh, setIndRefresh] = useState(0);
  const [tplRefresh, setTplRefresh] = useState(0);
  const indicatorsCard = (
    <IndicatorsConfigCard key="ind" form={form} canEdit={canEdit} refreshKey={indRefresh}
      onChanged={() => { setTplRefresh((v) => v + 1); onChanged?.(); }} />
  );
  const templateCard = (
    <TemplateBindingCard key="tpl" form={form} canEdit={canEdit} refreshKey={tplRefresh}
      onApplied={() => { setIndRefresh((v) => v + 1); onChanged?.(); }} />
  );
  return (
    <div className="section-gap">
      {/* Ouvert depuis « Appliquer le modèle d'activité » (Couverture & performance) : le modèle d'abord. */}
      {focusTemplate ? [templateCard, indicatorsCard] : [indicatorsCard, templateCard]}
      <CalcFieldsCard form={form} canEdit={canEdit} onChanged={onChanged} />
    </div>
  );
}

/**
 * Indicateurs de la fiche : la définition de chacun (variable, méthode, cible,
 * sens), « Nouvel indicateur » en tête, et l'éditeur (le même que dans les
 * Résultats) sur chaque ligne. Colonne d'actions toujours visible (figée à
 * droite), libellés de question longs tronqués.
 */
function IndicatorsConfigCard({ form, canEdit, refreshKey = 0, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [indicators, setIndicators] = useState(null);
  const [vars, setVars] = useState({ fields: [], calcFields: [] });
  const [edit, setEdit] = useState(null); // indicator | {} | null

  // Variables (libellés) : à l'ouverture seulement — enregistrer ou supprimer un indicateur ne les change pas.
  async function reload({ variables = true } = {}) {
    try {
      const [inds, v] = await Promise.all([api.monIndicators(form.id), variables ? api.monVariables(form.id).catch(() => null) : null]);
      setIndicators(inds); if (v) setVars(v);
    } catch (e) { toast.error(e.message); setIndicators([]); }
  }
  useEffect(() => { setIndicators(null); reload(); /* eslint-disable-next-line */ }, [form.id]);
  // Indicateurs créés depuis le modèle (l'autre carte) : la liste, une fois.
  useEffect(() => { if (refreshKey) reload({ variables: false }); /* eslint-disable-next-line */ }, [refreshKey]);

  async function remove(i) {
    if (!window.confirm(tr("Supprimer l'indicateur « {label} » ?", { label: i.label }))) return;
    try { await api.monDeleteIndicator(i.id); toast.success(tr('Indicateur supprimé.')); reload({ variables: false }); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  }

  // Libellé de chaque variable (questions, options éclatées « X.1 », champs calculés), nom exact puis casse.
  const varLabel = useMemo(() => {
    const m = new Map();
    for (const v of [...(vars.fields || []), ...(vars.calcFields || [])]) if (v.label) { m.set(v.name, v.label); if (!m.has(v.name.toLowerCase())) m.set(v.name.toLowerCase(), v.label); }
    return (name) => m.get(name) || m.get(String(name).toLowerCase()) || null;
  }, [vars]);

  return (
    <Card aria-labelledby="cfg-ind-title">
      <CardHeader id="cfg-ind-title" title={tr('Indicateurs & méthodes de calcul')}
        subtitle={tr('Chaque indicateur relie une variable de la fiche à une méthode de calcul (% de oui, moyenne, somme…). Ouvrez-en un pour voir, sur les données réelles, comment il est calculé.')}>
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setEdit({})}>{tr('Nouvel indicateur')}</Button>}
      </CardHeader>
      {indicators === null ? <div className="card-body"><Skeleton height={120} /></div>
        : indicators.length === 0 ? (
          <EmptyState icon={Link2} title={tr('Aucun indicateur')}
            action={canEdit && <Button icon={Plus} onClick={() => setEdit({})}>{tr('Nouvel indicateur')}</Button>}>
            {fillNodes(tr('Reliez une variable du formulaire à un mode de calcul (ex. « % de bénéficiaires informés » ← champ {field}, mode « % de oui »).'), { field: <code>info_recue</code> })}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table ind-cfg-table">
              <thead><tr>
                <th scope="col">{tr('Indicateur')}</th><th scope="col">{tr('Domaine')}</th><th scope="col">{tr('Variable source')}</th>
                <th scope="col">{tr('Méthode')}</th><th scope="col" className="num">{tr('Cible')}</th><th scope="col">{tr('Sens')}</th>
                <th scope="col">{tr('Origine')}</th>
                <th scope="col" className="col-actions">{canEdit ? tr('Actions') : <span className="sr-only">{tr('Actions')}</span>}</th>
              </tr></thead>
              <tbody>
                {indicators.map((i) => {
                  const label = varLabel(i.sourceField);
                  return (
                    <tr key={i.id} className={i.active ? '' : 'is-muted'}>
                      <td className="ind-cfg-name"><strong>{i.label}</strong><div className="site-meta mono">{i.code}</div>
                        {!i.active && <Badge tone={null} icon={Minus}>{tr('inactif')}</Badge>}</td>
                      <td className="ind-cfg-module">{i.module || <span className="cell-empty">—</span>}</td>
                      <td className="ind-cfg-var"><span className="mono">{i.sourceField}</span>
                        {label && label !== i.sourceField && <div className="var-label" title={label}>{label}</div>}
                        {(i.agg === 'percent_value' || i.agg === 'percent_yes') && i.positiveValue ? <div className="site-meta">{tr('compte : {v}', { v: i.positiveValue })}</div> : null}</td>
                      <td className="ind-cfg-agg">{AGG_SHORT[i.agg] ? tr(AGG_SHORT[i.agg]) : i.agg}</td>
                      <td className="num mono">{i.target ?? <span className="cell-empty">—</span>}</td>
                      <td className="nowrap">{i.direction === 'lower_better' ? tr('↓ mieux') : tr('↑ mieux')}</td>
                      <td>{i.templateCode ? <Badge tone="blue" icon={Sparkles}>{tr('modèle')}</Badge> : <Badge tone={null} icon={Pencil}>{tr('manuel')}</Badge>}</td>
                      <td className="col-actions">
                        {canEdit ? <>
                          <IconButton icon={Pencil} size="sm" label={tr('Modifier « {label} »', { label: i.label })} onClick={() => setEdit(i)} />
                          <IconButton icon={Trash2} size="sm" label={tr('Supprimer « {label} »', { label: i.label })} onClick={() => remove(i)} />
                        </> : <Button size="sm" variant="ghost" onClick={() => setEdit(i)}>{tr('Voir le calcul')}</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {edit && <IndicatorEditor form={form} indicator={edit.id ? edit : null} canEdit={canEdit}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload({ variables: false }); onChanged?.(); }} />}
    </Card>
  );
}
