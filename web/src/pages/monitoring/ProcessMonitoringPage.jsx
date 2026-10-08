import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Upload, AlertCircle, ClipboardCheck, RefreshCw, FileSpreadsheet,
  SlidersHorizontal, Database, BarChart3, ArrowRight,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, Stats } from '../../components/ui.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import IndicatorsList from './IndicatorsList.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth } from '../../lib/format.js';

/**
 * Suivi de processus › Données & indicateurs.
 *
 * Écran GUIDÉ en quatre étapes : (1) Fiche — importer/choisir le formulaire et
 * son catalogue de variables ; (2) Indicateurs & calculs — défini dans
 * Paramétrage (méthode de calcul à partir des variables disponibles), relié ici
 * par un lien ; (3) Données réelles — import CSV/XLSX/.sav/.zip ou API Kobo ;
 * (4) Résultats — liste riche des indicateurs recalculés. Un fil (stepper) en
 * tête montre l'état de chaque étape et y mène directement.
 */
const STEPS = [
  { id: 'fiche', n: 1, icon: FileSpreadsheet, label: 'Fiche de suivi' },
  { id: 'calculs', n: 2, icon: SlidersHorizontal, label: 'Indicateurs & calculs' },
  { id: 'donnees', n: 3, icon: Database, label: 'Données réelles' },
  { id: 'resultats', n: 4, icon: BarChart3, label: 'Résultats' },
];

export default function ProcessMonitoringPage({ canEdit, onNavigate }) {
  const toast = useToast();
  const [forms, setForms] = useState(null);
  const [formId, setFormId] = useState('');
  const [step, setStep] = useState('fiche');
  const [error, setError] = useState(null);
  const [fieldCount, setFieldCount] = useState(null);

  async function loadForms() {
    setError(null);
    try {
      const list = await api.monForms();
      setForms(list);
      setFormId((cur) => cur || (list[0] && list[0].id) || '');
    } catch (e) { setError(e.message); setForms([]); }
  }
  useEffect(() => { loadForms(); /* eslint-disable-next-line */ }, []);

  const form = (forms || []).find((f) => f.id === formId);

  // Nombre de variables (catalogue) de la fiche : pilote l'état de l'étape 1.
  useEffect(() => {
    let alive = true;
    setFieldCount(null);
    if (!formId) return undefined;
    api.monCatalog(formId).then((c) => { if (alive) setFieldCount((c?.fields || []).length); }).catch(() => { if (alive) setFieldCount(0); });
    return () => { alive = false; };
  }, [formId]);

  const xlsformRef = useRef(null);
  const [importingDef, setImportingDef] = useState(false);

  async function newForm() {
    const label = window.prompt('Nom du formulaire de suivi (ex. Suivi de processus GD/PREVMA) :');
    if (!label) return;
    const code = window.prompt('Code court (ex. GD_PREVMA) :', label.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 30));
    if (!code) return;
    try { const { id } = await api.monCreateForm({ code, label }); await loadForms(); setFormId(id); toast.success('Formulaire créé.'); }
    catch (e) { toast.error(e.message); }
  }

  async function onXlsform(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setImportingDef(true);
    try {
      const r = await api.monImportDefinition(f);
      await loadForms();
      setFormId(r.formId);
      toast.success(`Fiche « ${r.label} » importée : ${r.fields} champ(s), ${r.choices} choix. Configurez les indicateurs.`);
    } catch (err) { toast.error(err.message); } finally { setImportingDef(false); }
  }

  function goStep(id) {
    if (id === 'calculs') { onNavigate?.('parametrage', 'indicateurs'); return; }
    setStep(id);
  }

  return (
    <div className="section-gap">
      <PageHeader title="Suivi de processus — données & indicateurs" description="Suivez le fil : importez la fiche (XLSForm), configurez les indicateurs dans Paramétrage, chargez les données réelles, puis lisez les résultats recalculés.">
        {forms && forms.length > 0 && (
          <select className="select" style={{ minWidth: 240 }} value={formId} onChange={(e) => setFormId(e.target.value)} aria-label="Formulaire de suivi">
            {forms.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        )}
        {canEdit && <><input ref={xlsformRef} type="file" accept=".xlsx" hidden onChange={onXlsform} />
          <Button variant="secondary" icon={Upload} loading={importingDef} onClick={() => xlsformRef.current?.click()}>Importer un XLSForm</Button></>}
        {canEdit && <Button icon={Plus} onClick={newForm}>Nouveau formulaire</Button>}
      </PageHeader>

      {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

      {forms === null ? <Card><div className="card-body"><Skeleton height={140} /></div></Card>
        : forms.length === 0 ? (
          <Card><EmptyState icon={ClipboardCheck} title="Aucun formulaire de suivi"
            action={canEdit && <Button icon={Plus} onClick={newForm}>Nouveau formulaire</Button>}>
            Importez un XLSForm (Kobo/ODK) ou créez un formulaire, puis configurez ses indicateurs et importez les données réelles.
          </EmptyState></Card>
        ) : (
          <>
            <GuidedSteps step={step} onStep={goStep} form={form} fieldCount={fieldCount} />
            {step === 'fiche' && <FicheTab form={form} fieldCount={fieldCount} canEdit={canEdit} onNavigate={onNavigate} onNext={() => setStep('donnees')} />}
            {step === 'donnees' && <DataTab form={form} canEdit={canEdit} onChanged={loadForms} onNext={() => setStep('resultats')} />}
            {step === 'resultats' && <ResultsTab form={form} onNavigate={onNavigate} />}
          </>
        )}
    </div>
  );
}

// ---- Guided stepper ------------------------------------------------------
function GuidedSteps({ step, onStep, form, fieldCount }) {
  const inds = form?.indicatorCount ?? 0;
  const subs = form?.submissionCount ?? 0;
  const stateOf = {
    fiche: fieldCount == null ? 'wip' : (fieldCount > 0 ? 'done' : 'wip'),
    calculs: inds > 0 ? 'done' : 'todo',
    donnees: subs > 0 ? 'done' : 'todo',
    resultats: inds > 0 && subs > 0 ? 'done' : 'todo',
  };
  const detailOf = {
    fiche: fieldCount == null ? '…' : `${fieldCount} variable(s)`,
    calculs: `${inds} indicateur(s)`,
    donnees: `${subs} soumission(s)`,
    resultats: inds > 0 && subs > 0 ? 'Prêt' : 'En attente',
  };
  const ctaOf = { calculs: 'Configurer dans Paramétrage →' };
  return (
    <div className="flow" aria-label="Fil guidé du suivi de processus">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const active = step === s.id;
        return (
          <React.Fragment key={s.id}>
            <button type="button" className={`flow-step is-${stateOf[s.id]} is-clickable${active ? ' is-current' : ''}`}
              aria-current={active ? 'step' : undefined} onClick={() => onStep(s.id)} title={s.label}>
              <span className="flow-num"><Icon size={16} aria-hidden="true" /></span>
              <span className="flow-body">
                <span className="flow-label">{s.label}</span>
                <span className="flow-detail">{detailOf[s.id]}</span>
                {ctaOf[s.id] && <span className="flow-cta">{ctaOf[s.id]}</span>}
              </span>
            </button>
            {i < STEPS.length - 1 && <ArrowRight className="flow-arrow" size={18} aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---- Step 1 · Fiche ------------------------------------------------------
function FicheTab({ form, fieldCount, canEdit, onNavigate, onNext }) {
  const toast = useToast();
  const [cat, setCat] = useState(null);

  useEffect(() => {
    setCat(null);
    if (!form) return;
    api.monCatalog(form.id).then(setCat).catch((e) => { toast.error(e.message); setCat({ fields: [], choices: [] }); });
    /* eslint-disable-next-line */
  }, [form?.id]);

  const fields = cat?.fields || [];
  const byGroup = useMemo(() => {
    const g = {};
    for (const f of fields) (g[f.group || 'Sans groupe'] ||= []).push(f);
    return Object.entries(g);
  }, [fields]);

  return (
    <Card aria-labelledby="fiche-title">
      <CardHeader id="fiche-title" title={`Fiche — ${form?.label || ''}`}
        subtitle="Les variables du formulaire (champs du XLSForm) servent de base aux indicateurs et au mapping des données importées.">
        <Button size="sm" variant="secondary" icon={SlidersHorizontal} onClick={() => onNavigate?.('parametrage', 'indicateurs')}>Configurer les indicateurs</Button>
        {(fieldCount ?? 0) > 0 && <Button size="sm" icon={ArrowRight} onClick={onNext}>Charger les données</Button>}
      </CardHeader>
      <div className="card-body" style={{ display: 'grid', gap: 14 }}>
        {cat === null ? <Skeleton height={100} />
          : fields.length === 0 ? (
            <Alert tone="info" icon={AlertCircle}>
              Cette fiche n'a pas encore de catalogue de variables. {canEdit ? 'Importez sa définition XLSForm (bouton en haut) ' : 'Un administrateur peut importer sa définition XLSForm '}
              — ou importez directement des données réelles : les champs seront détectés automatiquement.
            </Alert>
          ) : (
            <>
              <span className="hint">{fields.length} variable(s) dans {byGroup.length} groupe(s).</span>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Variable</th><th scope="col">Nom technique</th><th scope="col">Type</th><th scope="col">Groupe</th></tr></thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f.name}>
                        <td><strong>{f.label || f.name}</strong></td>
                        <td><span className="mono">{f.name}</span></td>
                        <td className="muted">{f.type || '—'}</td>
                        <td className="muted">{f.group || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </div>
    </Card>
  );
}

// ---- Step 3 · Data import ------------------------------------------------
function DataTab({ form, canEdit, onChanged, onNext }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [kobo, setKobo] = useState({ open: false, baseUrl: 'https://kf.kobotoolbox.org', assetUid: '', token: '' });

  async function onFile(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !form) return;
    setBusy(true);
    try {
      const r = await api.monImport(form.id, file);
      toast.success(`${r.inserted}/${r.received} soumission(s) importée(s).`);
      onChanged?.();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function pull() {
    setBusy(true);
    try {
      const r = await api.monKoboPull(form.id, { baseUrl: kobo.baseUrl.trim(), assetUid: kobo.assetUid.trim(), token: kobo.token.trim() });
      toast.success(`${r.inserted}/${r.received} soumission(s) récupérées depuis Kobo.`);
      setKobo({ ...kobo, open: false }); onChanged?.();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Données réelles" subtitle={`${form?.submissionCount ?? 0} soumission(s) · ${form?.indicatorCount ?? 0} indicateur(s).`}>
        {(form?.submissionCount ?? 0) > 0 && <Button size="sm" icon={ArrowRight} onClick={onNext}>Voir les résultats</Button>}
      </CardHeader>
      <div className="card-body" style={{ display: 'grid', gap: 16 }}>
        <div className="postes-toolbar">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.sav,.zip" hidden onChange={onFile} />
          <Button size="sm" variant="secondary" icon={Upload} loading={busy} disabled={!canEdit} onClick={() => fileRef.current?.click()}>Importer CSV / XLSX / SPSS .sav / .zip Kobo</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!canEdit} onClick={() => setKobo({ ...kobo, open: !kobo.open })}>Depuis l'API Kobo v2</Button>
          <span className="hint">Export Kobo (CSV/XLSX) ou tout tableau à en-têtes. Les champs sont détectés automatiquement pour le mapping.</span>
        </div>
        {kobo.open && (
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <Field label="URL Kobo"><input className="input" value={kobo.baseUrl} onChange={(e) => setKobo({ ...kobo, baseUrl: e.target.value })} /></Field>
            <Field label="Asset UID"><input className="input mono" value={kobo.assetUid} onChange={(e) => setKobo({ ...kobo, assetUid: e.target.value })} placeholder="aXXXXXXXXXXXXXXXX" /></Field>
            <Field label="Token API"><input className="input mono" type="password" value={kobo.token} onChange={(e) => setKobo({ ...kobo, token: e.target.value })} /></Field>
            <Button loading={busy} onClick={pull} disabled={!kobo.assetUid || !kobo.token}>Récupérer</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---- Step 4 · Results / dashboard ----------------------------------------
function ResultsTab({ form, onNavigate }) {
  const toast = useToast();
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);

  async function reload() {
    if (!form) return;
    setData(null);
    try { setData(await api.monDashboard(form.id, month || undefined)); }
    catch (e) { toast.error(e.message); setData({ coverage: {}, byBureau: [], indicators: [], overallIndex: null }); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [form?.id, month]);

  const cov = data?.coverage || {};

  return (
    <div className="section-gap">
      <div className="comet-filters" style={{ justifyContent: 'flex-end' }}>
        <Field label="Période"><MonthSelect value={month || currentMonth()} onChange={setMonth} /></Field>
      </div>

      {data === null ? <Card><div className="card-body"><Skeleton height={120} /></div></Card>
        : (data.indicators.length === 0 && (cov.submissions || 0) === 0) ? (
          <Card><EmptyState icon={ClipboardCheck} title="Rien à afficher"
            action={onNavigate && <Button variant="secondary" icon={SlidersHorizontal} onClick={() => onNavigate('parametrage', 'indicateurs')}>Configurer les indicateurs</Button>}>
            Configurez des indicateurs (Paramétrage › Indicateurs &amp; calculs) et importez des données réelles pour alimenter les résultats.
          </EmptyState></Card>
        ) : (
          <>
            <Stats items={[
              { label: 'Soumissions', value: cov.submissions ?? 0, foot: `${cov.fieldOffices ?? 0} bureau(x)` },
              { label: 'Sites suivis', value: cov.sites ?? 0, foot: 'sites distincts' },
              { label: 'Agents', value: cov.agents ?? 0, foot: `${cov.partners ?? 0} prestataire(s)` },
              { label: 'Indice moyen', value: data.overallIndex == null ? '—' : data.overallIndex, suffix: data.overallIndex == null ? '' : '%', foot: 'moyenne des indicateurs %' },
            ]} />

            <IndicatorsList indicators={data.indicators} moduleLabel={form?.label} />

            {data.byBureau?.length > 0 && (
              <Card aria-label="Par bureau">
                <CardHeader title="Couverture par bureau" subtitle="Répartition des soumissions et des sites suivis." />
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Bureau</th><th className="num">Soumissions</th><th className="num">Sites suivis</th></tr></thead>
                  <tbody>
                    {data.byBureau.map((b) => (
                      <tr key={b.bureau}><td><strong>{b.bureau}</strong></td><td className="num mono">{b.submissions}</td><td className="num mono">{b.sites}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              </Card>
            )}
          </>
        )}
    </div>
  );
}
