import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Upload, AlertCircle, ClipboardCheck, RefreshCw, ArrowLeft, ChevronRight,
  FileSpreadsheet, SlidersHorizontal, BarChart3, Link2, Trash2, Pencil, Check, Minus, Shuffle,
  Table2, Download, Search, Columns3, X, ChevronDown, ChevronUp, Ban, Undo2, AlertTriangle, Link as LinkIcon,
  CheckCircle2, Circle, Sparkles,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, PageHeader, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { usePopover } from '../../components/listView.jsx';
import IndicatorsList from './IndicatorsList.jsx';
import TemplateBindingCard from './TemplateBindingCard.jsx';
import { CalcFieldsCard } from './CalcFields.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatDateTime, formatInt, formatLocale } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';
import { useI18n } from '../../lib/i18n.jsx';
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
const AGG_LABELS = {
  percent_yes: '% de « oui » (réponses oui / non)',
  percent_value: '% égal à une valeur de choix',
  mean: 'Moyenne des valeurs numériques',
  sum: 'Somme des valeurs numériques',
  count: 'Nombre de réponses',
};
const AGG_SHORT = { percent_yes: '% de « oui »', percent_value: '% = valeur', mean: 'Moyenne', sum: 'Somme', count: 'Nombre' };

// Phrase traduite contenant des éléments JSX : « {nom} » → nodes[nom].
function fillNodes(text, nodes) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <React.Fragment key={i}>{nodes[part]}</React.Fragment> : part));
}

const DETAIL_TABS = [
  { id: 'variables', label: 'Variables', icon: FileSpreadsheet },
  { id: 'donnees', label: 'Données importées', icon: Table2 },
  { id: 'resultats', label: 'Résultats', icon: BarChart3 },
  { id: 'mapping', label: 'Mapping MEMS', icon: Shuffle },
  { id: 'config', label: 'Configuration', icon: SlidersHorizontal },
];

// Colonnes « méta » typées (référentiels MEMS) affichées avant les variables.
const META_COLS = [
  { key: 'submittedAt', label: 'Date', fmt: (v) => (v ? formatDateTime(v) : '—') },
  // Libellé d'abord (bureau MEMS rattaché, sinon libellé du choix : « 6 » → « Ambovombe »), code en repli ;
  // `code` = la valeur brute affichée en mode « Codes ».
  { key: 'officeName', alt: ['fieldOfficeLabel', 'fieldOffice'], code: 'fieldOffice', label: 'Bureau' },
  // admin2 = District, admin3 = Commune, admin4 = Fokontany (memsMapping) ; nom résolu par pcode sinon valeur brute.
  { key: 'districtName', alt: 'admin2', code: 'admin2', label: 'District' },
  { key: 'communeName', alt: 'admin3', code: 'admin3', label: 'Commune' },
  { key: 'admin4', label: 'Fokontany' },
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
    { id: 'data', done: (f.submissionCount ?? 0) > 0, label: 'Importer les données', hint: 'Export Kobo (.zip, .sav), Excel / CSV, lien ONA ou API Kobo.', tab: 'donnees' },
    { id: 'indicators', done: (f.indicatorCount ?? 0) > 0, label: 'Définir les indicateurs', hint: 'Chaque indicateur relie une question du formulaire à un calcul (% de oui, moyenne…).', tab: 'config' },
  ];
  return { steps, next: steps.find((x) => !x.done) || null };
}

export default function ProcessMonitoringPage({ canEdit, isAdmin }) {
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
    return <FormDetail form={selected} canEdit={canEdit} initialTab={openTab} onBack={() => { setSelId(null); setOpenTab(null); }} onChanged={loadForms} />;
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
  const [tab, setTab] = useState(initialTab || 'variables');
  const [attaching, setAttaching] = useState(false);
  const { steps, next } = formSteps(form);
  return (
    <div className="section-gap">
      <div className="detail-head">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>{tr('Toutes les fiches')}</Button>
      </div>
      <PageHeader title={form.label} description={tr('Code {code} · {n} indicateur(s) · {m} soumission(s).', { code: form.code, n: form.indicatorCount ?? 0, m: form.submissionCount ?? 0 })} />

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
        <p className="hint"><CheckCircle2 size={14} aria-hidden="true" style={{ verticalAlign: '-2px', color: 'var(--green)' }} /> {tr('Fiche prête : rattachée à « {activity} », elle alimente la Synthèse, Couverture & performance et le concepteur de rapport.', { activity: form.activityCategory })}</p>
      )}
      {attaching && <AttachActivityModal form={form} onClose={() => setAttaching(false)} onSaved={async () => { setAttaching(false); await onChanged?.(); }} />}

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
      {tab === 'donnees' && <DataViewTab form={form} canEdit={canEdit} onGoConfig={() => setTab('config')} />}
      {tab === 'resultats' && <ResultsTab form={form} onGoConfig={() => setTab('config')} />}
      {tab === 'mapping' && <MappingTab form={form} canEdit={canEdit} />}
      {tab === 'config' && <ConfigTab form={form} canEdit={canEdit} onChanged={onChanged} />}
    </div>
  );
}

// ---- Variables (catalogue XLSForm : name/label/type/groupe/skip logic) ---
function VariablesTab({ form }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    setCat(null);
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
    return list.filter((f) => [f.name, f.label, f.group, f.type, f.relevant].some((x) => x && String(x).toLowerCase().includes(s)));
  }, [cat, q]);

  return (
    <Card aria-labelledby="vars-title">
      <CardHeader id="vars-title" title={tr('Variables du formulaire (XLSForm)')}
        subtitle={tr('Nom technique et libellé de chaque question, son type, son groupe, sa logique de saut (relevant) et ses choix — pour comprendre les données et les relier aux indicateurs.')}>
        {cat && <span className="input-wrap ind-search"><input className="input" type="search" placeholder={tr('Filtrer les variables…')} value={q} onChange={(e) => setQ(e.target.value)} /></span>}
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
                <th scope="col">{tr('Groupe')}</th><th scope="col">{tr('Logique de saut (skip)')}</th><th scope="col">{tr('Choix')}</th>
              </tr></thead>
              <tbody>
                {fields.map((f) => {
                  const opts = f.listName ? (choicesByList[f.listName] || []) : [];
                  return (
                    <tr key={f.name}>
                      <td><strong>{f.label || f.name}</strong>{f.required ? <> <Badge tone="blue">{tr('obligatoire')}</Badge></> : null}</td>
                      <td><span className="mono">{f.name}</span></td>
                      <td className="muted">{f.type || '—'}</td>
                      <td className="muted">{f.group || '—'}</td>
                      <td>{f.relevant ? <code className="skip-expr">{f.relevant}</code> : <span className="cell-empty">—</span>}</td>
                      <td>{opts.length
                        ? <span title={opts.map((o) => `${o.value} = ${o.label}`).join('\n')}>{tr('{n} choix', { n: opts.length })} <span className="site-meta">({f.listName})</span></span>
                        : <span className="cell-empty">—</span>}</td>
                    </tr>
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
  { key: 'region', label: 'Région', get: (r) => r.admin1 },
  { key: 'district', label: 'District', get: (r) => r.districtName || r.admin2 },
  { key: 'commune', label: 'Commune', get: (r) => r.communeName || r.admin3 },
  { key: 'fokontany', label: 'Fokontany', get: (r) => r.admin4 },
  { key: 'year', label: 'Année', get: (r) => (r.periodMonth ? r.periodMonth.slice(0, 4) : null) },
  // Nom du mois dans la langue de l'interface (formatLocale suit la langue ; en français, identique à DV_MONTHS).
  { key: 'mon', label: 'Mois', get: (r) => (r.periodMonth ? r.periodMonth.slice(5, 7) : null), fmt: (v) => (DV_MONTHS[Number(v) - 1] ? new Date(2000, Number(v) - 1, 1).toLocaleString(formatLocale(), { month: 'long' }) : v) },
];

function DataViewTab({ form, canEdit, onGoConfig }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({});
  const [cat, setCat] = useState(null);
  const [res, setRes] = useState(null);

  const [view, setView] = useState('all'); // all | kept | excluded

  function loadData() {
    setRes(null);
    Promise.all([
      api.monCatalog(form.id).catch(() => ({ fields: [], choices: [] })),
      api.monFormSubmissions(form.id, { limit: 1000 }),
    ]).then(([c, r]) => { setCat(c || { fields: [], choices: [] }); setRes(r); })
      .catch((e) => { toast.error(e.message); setCat({ fields: [], choices: [] }); setRes({ rows: [], total: 0, limit: 0 }); });
  }
  useEffect(() => { setCat(null); setFilters({}); setView('all'); loadData(); /* eslint-disable-next-line */ }, [form.id]);

  const rows = res?.rows || [];
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

  const shown = useMemo(() => {
    const active = DV_DIMS.filter((d) => filters[d.key]);
    const s = q.toLowerCase();
    return rows.filter((r) => {
      if (view === 'kept' && r.excluded) return false;
      if (view === 'excluded' && !r.excluded) return false;
      for (const d of active) { if (String(d.get(r) ?? '') !== filters[d.key]) return false; }
      if (!q) return true;
      if (metaCols.some((m) => String(metaVal(r, m)).toLowerCase().includes(s))) return true;
      return Object.values(r.data || {}).some((v) => String(v ?? '').toLowerCase().includes(s));
    });
    /* eslint-disable-next-line */
  }, [rows, q, filters, view, metaCols]);

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

  function exportCsv(which) {
    const list = which === 'sel' ? shown.filter((r, i) => sel.has(rowKey(r, i))) : shown;
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
            action={<Button variant="secondary" icon={Upload} onClick={onGoConfig}>{tr('Importer des données')}</Button>}>
            {tr('Importez des soumissions (onglet Configuration › Données réelles) pour les visualiser ici.')}
          </EmptyState>
        ) : (
          <>
            <div className="comet-filters">
              <div className="field">
                <span className="field-label">{tr('Vue')}</span>
                <select className="select" value={view} onChange={(e) => setView(e.target.value)} aria-label={tr('Vue')}>
                  <option value="all">{tr('Toutes')}</option>
                  <option value="kept">{tr('Retenues (analyse)')}</option>
                  <option value="excluded">{tr('Exclues')}</option>
                </select>
              </div>
              {dimOptions.map((d) => (
                <div className="field" key={d.key}>
                  <span className="field-label">{tr(d.label)}</span>
                  <select className="select" value={filters[d.key] || ''} aria-label={tr(d.label)}
                    onChange={(e) => setFilters((f) => ({ ...f, [d.key]: e.target.value }))}>
                    <option value="">{tr('Tous')}</option>
                    {d.vals.map((v) => <option key={v} value={v}>{d.fmt ? d.fmt(v) : v}</option>)}
                  </select>
                </div>
              ))}
              {(DV_DIMS.some((d) => filters[d.key]) || view !== 'all') && <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setView('all'); }}>{tr('Réinitialiser')}</Button>}
            </div>
            <div className="ind-toolbar">
              <span className="input-wrap ind-search"><Search size={16} aria-hidden="true" />
                <input className="input" type="search" placeholder={tr('Filtrer les soumissions…')} value={q} onChange={(e) => setQ(e.target.value)} />
              </span>
              <span className="ind-hint">{res.excluded
                ? tr('{n} affichée(s) · {k} retenue(s) · {x} exclue(s)', { n: shown.length, k: res.total - (res.excluded || 0), x: res.excluded })
                : tr('{n} affichée(s) · {k} retenue(s)', { n: shown.length, k: res.total - (res.excluded || 0) })}</span>
              <span className="ind-tsp" />
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
            {sel.size > 0 && (
              <div className="ind-batch">
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
                  <th className="data-cb"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label={tr('Tout sélectionner')} /></th>
                  {metaCols.map((m, mi) => <th key={m.key} scope="col" className={mi === 0 ? 'data-first' : ''}>{tr(m.label)}</th>)}
                  {shownVarCols.map((v) => <th key={v.name} scope="col" className={`data-var ${v.calc ? 'is-calc' : ''}`}><span>{v.calc ? `ƒ ${v.label || v.name}` : (v.label || v.name)}</span><div className="th-sub mono">{v.name}</div></th>)}
                </tr></thead>
                <tbody>
                  {shown.map((r, i) => {
                    const k = rowKey(r, i); const isSel = sel.has(k);
                    return (
                    <tr key={k} className={`clickable ${isSel ? 'is-selected' : ''} ${r.excluded ? 'is-excluded' : ''}`} onClick={() => setOpen(r)} title={r.excluded ? (r.excludeReason ? tr("Exclue de l'analyse — {reason}", { reason: r.excludeReason }) : tr("Exclue de l'analyse")) : undefined}>
                      <td className="data-cb" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleOne(k)} aria-label={tr('Sélectionner la soumission')} />
                      </td>
                      {metaCols.map((m, mi) => <td key={m.key} className={`${m.key === 'submittedAt' ? 'tabular' : ''} ${mi === 0 ? 'data-first' : ''}`}>{mi === 0 && r.excluded ? <><Badge tone="red">{tr('exclue')}</Badge> </> : null}{metaVal(r, m)}</td>)}
                      {shownVarCols.map((v) => {
                        const raw = cell(r, v.name);
                        return <td key={v.name} className={`mono-cell data-var ${v.calc ? 'is-calc' : ''}`}>{raw == null || raw === '' ? <span className="cell-empty">—</span> : labelOf(v, raw)}</td>;
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {shown.length > 8 && (
              <div className="data-expand-row">
                <button type="button" className="data-expand" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
                  {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                  <span>{expanded ? tr('Réduire le tableau') : tr('Afficher les {n} lignes', { n: shown.length })}</span>
                </button>
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
      subtitle={sub.externalId ? sub.externalId : (sub.submittedAt ? formatDateTime(sub.submittedAt) : undefined)}
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
function ResultsTab({ form, onGoConfig }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);

  async function reload() {
    setData(null);
    try { setData(await api.monDashboard(form.id, month || undefined)); }
    catch (e) { toast.error(e.message); setData({ coverage: {}, byBureau: [], indicators: [], overallIndex: null }); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [form.id, month]);

  const cov = data?.coverage || {};
  const periodControl = (
    <label className="ind-period">{tr('Période')} <MonthSelect value={month || currentMonth()} onChange={setMonth} /></label>
  );

  if (data === null) return <Card><div className="card-body"><Skeleton height={160} /></div></Card>;
  if (data.indicators.length === 0 && (cov.submissions || 0) === 0) {
    return (
      <Card><EmptyState icon={BarChart3} title={tr('Rien à afficher')}
        action={<Button variant="secondary" icon={SlidersHorizontal} onClick={onGoConfig}>{tr('Configurer la fiche')}</Button>}>
        {tr('Définissez des indicateurs et importez des données réelles (onglet Configuration) pour alimenter les résultats.')}
      </EmptyState></Card>
    );
  }
  return (
    <div className="section-gap">
      <Stats items={[
        { label: tr('Soumissions'), value: cov.submissions ?? 0, foot: tr('{n} bureau(x)', { n: cov.fieldOffices ?? 0 }) },
        { label: tr('Sites suivis'), value: cov.sites ?? 0, foot: tr('sites distincts') },
        { label: tr('Agents'), value: cov.agents ?? 0, foot: tr('{n} prestataire(s)', { n: cov.partners ?? 0 }) },
        { label: tr('Indice moyen'), value: data.overallIndex == null ? '—' : data.overallIndex, suffix: data.overallIndex == null ? '' : '%', foot: tr('moyenne des indicateurs %') },
      ]} />
      <IndicatorsList indicators={data.indicators} moduleLabel={form.label} toolbarExtra={periodControl} />
      {data.byBureau?.length > 0 && (
        <Card aria-label={tr('Par bureau')}>
          <CardHeader title={tr('Couverture par bureau')} subtitle={tr('Répartition des soumissions et des sites suivis.')} />
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{tr('Bureau')}</th><th className="num">{tr('Soumissions')}</th><th className="num">{tr('Sites suivis')}</th></tr></thead>
            <tbody>
              {data.byBureau.map((b) => (
                <tr key={b.bureau}><td><strong>{b.bureau}</strong></td><td className="num mono">{b.submissions}</td><td className="num mono">{b.sites}</td></tr>
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
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  async function reload() {
    try { setData(await api.monMemsMapping(form.id)); }
    catch (e) { toast.error(e.message); setData({ rows: [], columns: [] }); }
  }
  useEffect(() => { setData(null); reload(); /* eslint-disable-next-line */ }, [form.id]);

  const rows = data?.rows || [];
  const columns = data?.columns || [];
  const hasManual = rows.some((r) => r.source === 'manuel');

  async function onChange(r, value) {
    // '__auto__' → auto ; '' → non reliée ; sinon nom de colonne.
    setSaving(true);
    try {
      if (value === '__auto__') await api.monResetMemsMapping(form.id, r.key);
      else await api.monSetMemsMapping(form.id, r.key, value);
      await reload();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function applyToData() {
    setApplying(true);
    try { const res = await api.monApplyMemsMapping(form.id); toast.success(tr('Mapping appliqué ({n} dimension(s)) aux soumissions.', { n: res.applied })); }
    catch (e) { toast.error(e.message); } finally { setApplying(false); }
  }

  const selValue = (r) => (r.source === 'manuel' ? (r.column || '') : '__auto__');
  const matched = rows.filter((r) => r.column).length;

  return (
    <Card aria-labelledby="mems-title">
      <CardHeader id="mems-title" title={tr('Mapping avec les référentiels MEMS')}
        subtitle={tr('Quelle colonne du formulaire alimente chaque dimension MEMS (bureau, zones, site, partenaire, agent, période). Auto-détecté à partir des variables ; vous pouvez le corriger à la main.')}>
        {canEdit && hasManual && <Button size="sm" variant="secondary" icon={RefreshCw} loading={applying} onClick={applyToData}>{tr('Appliquer aux soumissions')}</Button>}
      </CardHeader>
      {data === null ? <div className="card-body"><Skeleton height={140} /></div> : (
        <>
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <Alert tone={matched ? 'info' : 'warning'} icon={matched ? Link2 : AlertCircle}>
              {tr('{n} dimension(s) sur {t} reliée(s).', { n: matched, t: rows.length })} {canEdit
                ? <>{tr('Choisissez « Automatique » pour laisser la détection, une colonne pour forcer le mapping, ou « Aucune » pour ignorer. Après correction, « Appliquer aux soumissions » recalcule les données déjà importées.')}</>
                : <>{tr('La détection est automatique ; un administrateur ou validateur peut corriger le mapping.')}</>}
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
                      {r.editable && canEdit ? (
                        <select className="select" value={selValue(r)} disabled={saving} onChange={(e) => onChange(r, e.target.value)} style={{ minWidth: 220 }}>
                          <option value="__auto__">{r.autoColumn ? tr('Automatique — {col}', { col: r.autoColumn }) : tr('Automatique — (aucune détectée)')}</option>
                          <option value="">{tr('— Aucune (ignorer) —')}</option>
                          <optgroup label={tr('Colonnes du formulaire')}>
                            {columns.map((c) => <option key={c.name} value={c.name}>{c.label && c.label !== c.name ? `${c.label} — ${c.name}` : c.name}</option>)}
                          </optgroup>
                        </select>
                      ) : r.column
                        ? <><span className="mono">{r.column}</span>{r.columnLabel && r.columnLabel !== r.column && <div className="site-meta">{r.columnLabel}</div>}</>
                        : <span className="cell-empty">—</span>}
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

// ---- Configuration (paramètres + méthodes de calcul + sources de données) --
function ConfigTab({ form, canEdit, onChanged }) {
  // Après création depuis le modèle, la liste des indicateurs est rechargée (remontage).
  const [version, setVersion] = useState(0);
  return (
    <div className="section-gap">
      <TemplateBindingCard form={form} canEdit={canEdit} onApplied={() => { setVersion((v) => v + 1); onChanged?.(); }} />
      <IndicatorsConfigCard key={version} form={form} canEdit={canEdit} onChanged={onChanged} />
      <CalcFieldsCard form={form} canEdit={canEdit} onChanged={onChanged} />
      <DataSourcesCard form={form} canEdit={canEdit} onChanged={onChanged} />
    </div>
  );
}

function IndicatorsConfigCard({ form, canEdit, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [indicators, setIndicators] = useState(null);
  const [catalog, setCatalog] = useState({ fields: [], choices: [] });
  const [edit, setEdit] = useState(null); // indicator | {} | null

  async function reload() {
    try {
      const [inds, cat] = await Promise.all([api.monIndicators(form.id), api.monCatalog(form.id)]);
      setIndicators(inds); setCatalog(cat || { fields: [], choices: [] });
    } catch (e) { toast.error(e.message); setIndicators([]); }
  }
  useEffect(() => { setIndicators(null); reload(); /* eslint-disable-next-line */ }, [form.id]);

  async function remove(i) {
    if (!window.confirm(tr("Supprimer l'indicateur « {label} » ?", { label: i.label }))) return;
    try { await api.monDeleteIndicator(i.id); toast.success(tr('Indicateur supprimé.')); reload(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  }

  const fieldLabel = useMemo(() => Object.fromEntries((catalog.fields || []).map((f) => [f.name, f.label || f.name])), [catalog]);

  return (
    <Card aria-labelledby="cfg-ind-title">
      <CardHeader id="cfg-ind-title" title={tr('Indicateurs & méthodes de calcul')}
        subtitle={tr('Construisez chaque indicateur à partir des variables disponibles (champ du formulaire) + un mode de calcul (% de oui, moyenne, somme…). Recalculé en direct depuis les données.')}>
        {canEdit && (catalog.fields.length > 0 || (indicators || []).length > 0) && <Button size="sm" icon={Plus} onClick={() => setEdit({})}>{tr('Nouvel indicateur')}</Button>}
      </CardHeader>
      {indicators === null ? <div className="card-body"><Skeleton height={120} /></div>
        : indicators.length === 0 ? (
          <EmptyState icon={Link2} title={tr('Aucun indicateur')}
            action={canEdit && <Button icon={Plus} onClick={() => setEdit({})}>{tr('Nouvel indicateur')}</Button>}>
            {fillNodes(tr('Reliez une variable du formulaire à un mode de calcul (ex. « % de bénéficiaires informés » ← champ {field}, mode « % de oui »).'), { field: <code>info_recue</code> })}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">{tr('Indicateur')}</th><th scope="col">{tr('Module')}</th><th scope="col">{tr('Variable source')}</th>
                <th scope="col">{tr('Méthode')}</th><th scope="col" className="num">{tr('Cible')}</th><th scope="col">{tr('Sens')}</th>{canEdit && <th scope="col" />}
              </tr></thead>
              <tbody>
                {indicators.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.label}</strong><div className="site-meta mono">{i.code}</div></td>
                    <td>{i.module || <span className="cell-empty">—</span>}</td>
                    <td><span className="mono">{i.sourceField}</span>
                      {fieldLabel[i.sourceField] && fieldLabel[i.sourceField] !== i.sourceField && <div className="site-meta">{fieldLabel[i.sourceField]}</div>}
                      {i.agg === 'percent_value' && i.positiveValue ? <div className="site-meta">= {i.positiveValue}</div> : null}</td>
                    <td>{AGG_SHORT[i.agg] ? tr(AGG_SHORT[i.agg]) : i.agg}</td>
                    <td className="num mono">{i.target ?? <span className="cell-empty">—</span>}</td>
                    <td>{i.direction === 'lower_better' ? tr('↓ mieux') : tr('↑ mieux')}</td>
                    {canEdit && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label={tr('Éditer')} onClick={() => setEdit(i)} />
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => remove(i)} />
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {edit && <IndicatorModal form={form} catalog={catalog} indicator={edit.id ? edit : null}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChanged?.(); }} />}
    </Card>
  );
}

// Même plafond que le serveur (express.raw « 80mb » de POST /forms/:id/import). On prévient
// AVANT l'envoi : un navigateur coupé en plein envoi n'affiche pas toujours la réponse 413.
const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

function DataSourcesCard({ form, canEdit, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [kobo, setKobo] = useState({ open: false, baseUrl: 'https://kf.kobotoolbox.org', assetUid: '', token: '' });
  const [link, setLink] = useState({ open: false, url: form.sourceUrl || '', token: '' });

  async function onFile(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(tr('Fichier trop volumineux ({size} Mo) : la taille maximale acceptée est de 80 Mo. Exportez une période plus courte ou découpez le fichier, puis réessayez.', { size: Math.round(file.size / (1024 * 1024)) }));
      return;
    }
    setBusy(true);
    try { const r = await api.monImport(form.id, file); toast.success(tr('{a}/{b} soumission(s) importée(s).', { a: r.inserted, b: r.received })); onChanged?.(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function pull() {
    setBusy(true);
    try {
      const r = await api.monKoboPull(form.id, { baseUrl: kobo.baseUrl.trim(), assetUid: kobo.assetUid.trim(), token: kobo.token.trim() });
      toast.success(tr('{a}/{b} soumission(s) récupérées depuis Kobo.', { a: r.inserted, b: r.received }));
      setKobo({ ...kobo, open: false }); onChanged?.();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function urlPull() {
    setBusy(true);
    try {
      const r = await api.monUrlPull(form.id, { url: link.url.trim(), token: link.token.trim() || undefined });
      toast.success(tr('{a}/{b} soumission(s) importée(s) depuis le lien.', { a: r.inserted, b: r.received }));
      setLink({ ...link, open: false }); onChanged?.();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title={tr('Données réelles')} subtitle={tr('{n} soumission(s). Fichier (CSV / XLSX / SPSS .sav / .zip Kobo), API Kobo v2, ou lien de données ONA / MoDA.', { n: form.submissionCount ?? 0 })} />
      <div className="card-body" style={{ display: 'grid', gap: 16 }}>
        <div className="postes-toolbar">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.sav,.zip" hidden onChange={onFile} />
          <Button size="sm" variant="secondary" icon={Upload} loading={busy} disabled={!canEdit} onClick={() => fileRef.current?.click()}>{tr('Importer un fichier')}</Button>
          <Button size="sm" variant="ghost" icon={Link2} disabled={!canEdit} onClick={() => setLink({ ...link, open: !link.open })}>{tr('Lien ONA / MoDA')}</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!canEdit} onClick={() => setKobo({ ...kobo, open: !kobo.open })}>{tr('API Kobo v2')}</Button>
          <span className="hint">{tr("Les colonnes sont détectées automatiquement (voir l'onglet Mapping MEMS).")}</span>
        </div>

        {link.open && (
          <div className="card-body" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', display: 'grid', gap: 10 }}>
            <Field label={tr('Lien de données (export ONA / MoDA : CSV, XLSX ou JSON)')}
              hint={tr("Collez le lien d'export de votre formulaire ONA/MoDA. Il est mémorisé pour les réimports. Un token n'est requis que si le flux est protégé.")}>
              <input className="input mono" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://api.ona.io/api/v1/data/123456.csv" />
            </Field>
            <div className="form-grid" style={{ alignItems: 'end' }}>
              <Field label={tr('Token (optionnel)')}><input className="input mono" type="password" value={link.token} onChange={(e) => setLink({ ...link, token: e.target.value })} placeholder={tr('laisser vide si lien public')} /></Field>
              <Button loading={busy} onClick={urlPull} disabled={!/^https?:\/\//i.test(link.url.trim())}>{tr('Importer depuis le lien')}</Button>
            </div>
            {form.sourceUrl && <span className="site-meta mono">{tr('Dernier lien : {url}', { url: form.sourceUrl })}</span>}
          </div>
        )}

        {kobo.open && (
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <Field label={tr('URL Kobo')}><input className="input" value={kobo.baseUrl} onChange={(e) => setKobo({ ...kobo, baseUrl: e.target.value })} /></Field>
            <Field label="Asset UID"><input className="input mono" value={kobo.assetUid} onChange={(e) => setKobo({ ...kobo, assetUid: e.target.value })} placeholder="aXXXXXXXXXXXXXXXX" /></Field>
            <Field label={tr('Token API')}><input className="input mono" type="password" value={kobo.token} onChange={(e) => setKobo({ ...kobo, token: e.target.value })} /></Field>
            <Button loading={busy} onClick={pull} disabled={!kobo.assetUid || !kobo.token}>{tr('Récupérer')}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---- Modal de définition d'indicateur (variable disponible → calcul) -----
function IndicatorModal({ form, catalog, indicator, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(indicator);
  const [f, setF] = useState(() => indicator || { code: '', label: '', module: '', sourceField: '', agg: 'percent_yes', positiveValue: '', target: '', direction: 'higher_better' });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const err = { code: !f.code.trim(), label: !f.label.trim(), sourceField: !String(f.sourceField).trim() };

  const fields = catalog.fields || [];
  const [calcFields, setCalcFields] = useState([]);
  useEffect(() => { api.monCalcFields(form.id).then(setCalcFields).catch(() => setCalcFields([])); }, [form.id]);
  const selField = fields.find((x) => x.name === f.sourceField);
  const fieldChoices = useMemo(() => {
    if (!selField?.listName) return [];
    return (catalog.choices || []).filter((c) => c.listName === selField.listName);
  }, [catalog, selField]);

  async function save() {
    setTouched(true);
    if (err.code || err.label || err.sourceField) return;
    const body = {
      code: f.code.trim(), label: f.label.trim(), module: f.module?.trim() || undefined,
      sourceField: String(f.sourceField).trim(), agg: f.agg,
      positiveValue: f.agg === 'percent_value' ? (String(f.positiveValue).trim() || undefined) : undefined,
      target: f.target === '' || f.target == null ? null : Number(f.target),
      direction: f.direction,
    };
    setSaving(true);
    try {
      if (editing) await api.monUpdateIndicator(indicator.id, body);
      else await api.monCreateIndicator(form.id, body);
      toast.success(tr('Indicateur enregistré.')); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open size="lg" title={editing ? tr('Modifier l\'indicateur') : tr('Nouvel indicateur')}
      subtitle={tr('Reliez une variable du formulaire à une méthode de calcul.')} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button onClick={save} loading={saving}>{tr('Enregistrer')}</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label={tr('Libellé')} required error={touched && err.label ? tr('Requis.') : undefined}><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={tr('Bénéficiaires informés')} /></Field>
          <Field label={tr('Code')} required error={touched && err.code ? tr('Requis.') : undefined}><input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="benef_informes" /></Field>
        </div>
        <Field label={tr('Module (regroupement)')} hint={tr('Regroupe les indicateurs dans les résultats (ex. « Information & CFM »).')}>
          <input className="input" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} placeholder="Information & CFM" />
        </Field>

        <div className="field">
          <span className="field-label">{tr('Variable source (champ du formulaire)')} <span className="req" aria-hidden="true">*</span></span>
          <div className="hint" style={{ marginBottom: 6 }}>
            {fields.length
              ? (calcFields.length
                ? tr('{n} variable(s) + {c} champ(s) calculé(s) disponible(s).', { n: fields.length, c: calcFields.length })
                : tr('{n} variable(s) disponible(s).', { n: fields.length }))
              : tr('Aucun catalogue de champs : saisissez le nom exact de la variable.')}
          </div>
          {(fields.length || calcFields.length) ? (
            <select className={`select ${f.sourceField ? '' : 'is-empty'}`} value={f.sourceField}
              onChange={(e) => setF({ ...f, sourceField: e.target.value, positiveValue: '' })}>
              <option value="">{tr('Choisir une variable…')}</option>
              {fields.length > 0 && (
                <optgroup label={tr('Variables du formulaire')}>
                  {fields.map((x) => <option key={x.name} value={x.name}>{x.label && x.label !== x.name ? `${x.label} — ${x.name}` : x.name}{x.type ? ` (${x.type})` : ''}</option>)}
                </optgroup>
              )}
              {calcFields.length > 0 && (
                <optgroup label={tr('Champs calculés (ƒ)')}>
                  {calcFields.map((c) => <option key={c.name} value={c.name}>ƒ {c.label && c.label !== c.name ? `${c.label} — ${c.name}` : c.name}</option>)}
                </optgroup>
              )}
            </select>
          ) : (
            <input className="input mono" value={f.sourceField} onChange={(e) => setF({ ...f, sourceField: e.target.value })} placeholder="info_recue" />
          )}
          {touched && err.sourceField && <div className="field-error">{tr('Requis.')}</div>}
          {selField?.group && <div className="site-meta" style={{ marginTop: 4 }}>{tr('Groupe : {group}', { group: selField.group })}</div>}
          {selField?.relevant && <div className="site-meta" style={{ marginTop: 2 }}>{tr('Logique de saut :')} <code className="skip-expr">{selField.relevant}</code></div>}
        </div>

        <div className="form-grid">
          <Field label={tr('Méthode de calcul')}>
            <select className="select" value={f.agg} onChange={(e) => setF({ ...f, agg: e.target.value })}>
              {Object.entries(AGG_LABELS).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
            </select>
          </Field>
          {f.agg === 'percent_value'
            ? (
              <Field label={tr('Valeur « positive »')} hint={tr('Réponse comptée comme atteinte.')}>
                {fieldChoices.length ? (
                  <select className="select" value={f.positiveValue} onChange={(e) => setF({ ...f, positiveValue: e.target.value })}>
                    <option value="">{tr('Choisir une valeur…')}</option>
                    {fieldChoices.map((c) => <option key={c.value} value={c.value}>{c.label && c.label !== c.value ? `${c.label} (${c.value})` : c.value}</option>)}
                  </select>
                ) : (
                  <input className="input" value={f.positiveValue} onChange={(e) => setF({ ...f, positiveValue: e.target.value })} placeholder={tr('oui / 1 / A')} />
                )}
              </Field>
            )
            : <Field label={tr('Cible (optionnel)')}><input className="input tabular" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="80" /></Field>}
        </div>
        <div className="form-grid">
          {f.agg === 'percent_value' && <Field label={tr('Cible (optionnel)')}><input className="input tabular" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="80" /></Field>}
          <Field label={tr('Sens')}>
            <select className="select" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="higher_better">{tr('Plus haut = mieux')}</option>
              <option value="lower_better">{tr('Plus bas = mieux')}</option>
            </select>
          </Field>
        </div>

        <div className="note"><SlidersHorizontal size={18} aria-hidden="true" /><span>
          {f.agg === 'count' && <>{tr('Compte le nombre de réponses à la variable.')}</>}
          {f.agg === 'sum' && <>{tr('Additionne les valeurs numériques de la variable.')}</>}
          {f.agg === 'mean' && <>{tr('Moyenne des valeurs numériques de la variable.')}</>}
          {f.agg === 'percent_yes' && <>{tr('Part des réponses « oui » (oui / 1 / true) sur le total renseigné.')}</>}
          {f.agg === 'percent_value' && <>{fillNodes(tr('Part des réponses égales à {value} sur le total renseigné.'), { value: <strong>{String(f.positiveValue).trim() || '…'}</strong> })}</>}
        </span></div>
      </div>
    </Modal>
  );
}
