import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Upload, Trash2, Pencil, AlertCircle, ClipboardCheck, Link2, RefreshCw } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth } from '../../lib/format.js';

const AGG_LABELS = {
  percent_yes: '% de « oui »',
  percent_value: '% égal à une valeur',
  mean: 'Moyenne',
  sum: 'Somme',
  count: 'Nombre de réponses',
};
const RATING = {
  exc: { label: 'Atteint', tone: 'green' },
  sat: { label: 'Proche', tone: 'blue' },
  imp: { label: 'À améliorer', tone: 'orange' },
  na: { label: '—', tone: undefined },
};
const TABS = [
  { id: 'mapping', label: 'Indicateurs (mapping)' },
  { id: 'data', label: 'Données réelles' },
  { id: 'results', label: 'Résultats' },
];

export default function ProcessMonitoringPage({ canEdit }) {
  const toast = useToast();
  const [forms, setForms] = useState(null);
  const [formId, setFormId] = useState('');
  const [tab, setTab] = useState('mapping');
  const [error, setError] = useState(null);

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

  async function newForm() {
    const label = window.prompt('Nom du formulaire de suivi (ex. Suivi de processus GD/PREVMA) :');
    if (!label) return;
    const code = window.prompt('Code court (ex. GD_PREVMA) :', label.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 30));
    if (!code) return;
    try { const { id } = await api.monCreateForm({ code, label }); await loadForms(); setFormId(id); toast.success('Formulaire créé.'); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <div className="section-gap">
      <PageHeader title="Suivi de processus" description="Importez les données réelles de suivi (CSV / XLSX Kobo, API Kobo v2) et reliez chaque indicateur à un champ du formulaire (mapping paramétrable) pour alimenter le tableau de bord.">
        {forms && forms.length > 0 && (
          <select className="select" style={{ minWidth: 240 }} value={formId} onChange={(e) => setFormId(e.target.value)}>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        )}
        {canEdit && <Button icon={Plus} onClick={newForm}>Nouveau formulaire</Button>}
      </PageHeader>

      {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

      {forms === null ? <Card><div className="card-body"><Skeleton height={140} /></div></Card>
        : forms.length === 0 ? (
          <Card><EmptyState icon={ClipboardCheck} title="Aucun formulaire de suivi"
            action={canEdit && <Button icon={Plus} onClick={newForm}>Nouveau formulaire</Button>}>
            Créez un formulaire (module de suivi), puis définissez ses indicateurs et importez les données réelles.
          </EmptyState></Card>
        ) : (
          <>
            <div className="seg" role="tablist" aria-label="Vue">
              {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'is-active' : ''} onClick={() => setTab(x.id)}>{x.label}</button>)}
            </div>
            {tab === 'mapping' && <MappingTab form={form} canEdit={canEdit} />}
            {tab === 'data' && <DataTab form={form} canEdit={canEdit} onChanged={loadForms} />}
            {tab === 'results' && <ResultsTab form={form} />}
          </>
        )}
    </div>
  );
}

// ---- Mapping (priority) --------------------------------------------------
function MappingTab({ form, canEdit }) {
  const toast = useToast();
  const [indicators, setIndicators] = useState(null);
  const [fields, setFields] = useState([]);
  const [edit, setEdit] = useState(null); // indicator | {} (new) | null

  async function reload() {
    if (!form) return;
    try {
      const [inds, fs] = await Promise.all([api.monIndicators(form.id), api.monFields(form.id)]);
      setIndicators(inds); setFields(fs);
    } catch (e) { toast.error(e.message); setIndicators([]); }
  }
  useEffect(() => { setIndicators(null); reload(); /* eslint-disable-next-line */ }, [form?.id]);

  async function remove(id) {
    try { await api.monDeleteIndicator(id); toast.success('Indicateur supprimé.'); reload(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="map-title">
      <CardHeader id="map-title" title="Indicateurs & mapping" subtitle="Chaque indicateur = un champ du formulaire + un mode de calcul. Reliez-les aux données importées.">
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setEdit({})}>Nouvel indicateur</Button>}
      </CardHeader>
      {indicators === null ? <div className="card-body"><Skeleton height={100} /></div>
        : indicators.length === 0 ? (
          <EmptyState icon={Link2} title="Aucun indicateur"
            action={canEdit && <Button icon={Plus} onClick={() => setEdit({})}>Nouvel indicateur</Button>}>
            Définissez un indicateur et reliez-le à un champ du formulaire (ex. « % CFM utilisé » ← champ <code>CFM_used</code>).
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Indicateur</th><th>Module</th><th>Champ source</th><th>Calcul</th><th className="num">Cible</th><th>Sens</th>{canEdit && <th />}
              </tr></thead>
              <tbody>
                {indicators.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.label}</strong><div className="site-meta mono">{i.code}</div></td>
                    <td>{i.module || <span className="cell-empty">—</span>}</td>
                    <td><span className="mono">{i.sourceField}</span>{i.agg === 'percent_value' && i.positiveValue ? <div className="site-meta">= {i.positiveValue}</div> : null}</td>
                    <td>{AGG_LABELS[i.agg] || i.agg}</td>
                    <td className="num mono">{i.target ?? <span className="cell-empty">—</span>}</td>
                    <td>{i.direction === 'lower_better' ? '↓ mieux' : '↑ mieux'}</td>
                    {canEdit && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(i)}>Éditer</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(i.id)} />
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {edit && <IndicatorModal form={form} fields={fields} indicator={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function IndicatorModal({ form, fields, indicator, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(indicator);
  const [f, setF] = useState(() => indicator || { code: '', label: '', module: '', sourceField: '', agg: 'percent_yes', positiveValue: '', target: '', direction: 'higher_better' });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const err = { code: !f.code.trim(), label: !f.label.trim(), sourceField: !String(f.sourceField).trim() };

  async function save() {
    setTouched(true);
    if (err.code || err.label || err.sourceField) return;
    const body = {
      code: f.code.trim(), label: f.label.trim(), module: f.module?.trim() || undefined,
      sourceField: String(f.sourceField).trim(), agg: f.agg,
      positiveValue: f.agg === 'percent_value' ? (f.positiveValue?.trim() || undefined) : undefined,
      target: f.target === '' || f.target == null ? null : Number(f.target),
      direction: f.direction,
    };
    setSaving(true);
    try {
      if (editing) await api.monUpdateIndicator(indicator.id, body);
      else await api.monCreateIndicator(form.id, body);
      toast.success('Indicateur enregistré.'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open title={editing ? 'Modifier l\'indicateur' : 'Nouvel indicateur'} subtitle="Reliez un champ du formulaire à un mode de calcul." onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button onClick={save} loading={saving}>Enregistrer</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label="Libellé" required error={touched && err.label ? 'Requis.' : undefined}><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="CFM utilisé" /></Field>
          <Field label="Code" required error={touched && err.code ? 'Requis.' : undefined}><input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="cfm_used" /></Field>
        </div>
        <div className="form-grid">
          <Field label="Module (regroupement)"><input className="input" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} placeholder="Information & CFM" /></Field>
          <Field label="Champ source (du formulaire)" required error={touched && err.sourceField ? 'Requis.' : undefined}
            hint={fields.length ? `${fields.length} champ(s) détecté(s) dans les données importées` : 'Importez des données pour lister les champs, ou saisissez le nom exact.'}>
            <input className="input mono" list="mon-fields" value={f.sourceField} onChange={(e) => setF({ ...f, sourceField: e.target.value })} placeholder="CFM_used" />
            <datalist id="mon-fields">{fields.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Mode de calcul">
            <select className="select" value={f.agg} onChange={(e) => setF({ ...f, agg: e.target.value })}>
              {Object.entries(AGG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {f.agg === 'percent_value'
            ? <Field label="Valeur « positive »" hint="Réponse comptée comme atteinte"><input className="input" value={f.positiveValue} onChange={(e) => setF({ ...f, positiveValue: e.target.value })} placeholder="oui / 1 / A" /></Field>
            : <Field label="Cible (optionnel)"><input className="input tabular" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="80" /></Field>}
        </div>
        <div className="form-grid">
          {f.agg === 'percent_value' && <Field label="Cible (optionnel)"><input className="input tabular" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="80" /></Field>}
          <Field label="Sens">
            <select className="select" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="higher_better">Plus haut = mieux</option>
              <option value="lower_better">Plus bas = mieux</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ---- Data import ---------------------------------------------------------
function DataTab({ form, canEdit, onChanged }) {
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
      <CardHeader title="Données réelles" subtitle={`${form?.submissionCount ?? 0} soumission(s) · ${form?.indicatorCount ?? 0} indicateur(s).`} />
      <div className="card-body" style={{ display: 'grid', gap: 16 }}>
        <div className="postes-toolbar">
          <input ref={fileRef} type="file" accept=".csv,.xlsx" hidden onChange={onFile} />
          <Button size="sm" variant="secondary" icon={Upload} loading={busy} disabled={!canEdit} onClick={() => fileRef.current?.click()}>Importer CSV / XLSX</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!canEdit} onClick={() => setKobo({ ...kobo, open: !kobo.open })}>Depuis l'API Kobo v2</Button>
          <span className="hint">Export Kobo (CSV/XLSX) ou tout tableau à en-têtes. Les champs sont détectés automatiquement pour le mapping. (SPSS .sav : exportez en CSV pour l'instant.)</span>
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

// ---- Results -------------------------------------------------------------
function ResultsTab({ form }) {
  const toast = useToast();
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);

  async function reload() {
    if (!form) return;
    setData(null);
    try { setData(await api.monValues(form.id, month || undefined)); }
    catch (e) { toast.error(e.message); setData({ count: 0, indicators: [] }); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [form?.id, month]);

  const grouped = useMemo(() => {
    const g = {};
    for (const i of data?.indicators || []) { (g[i.module || 'Autres'] ||= []).push(i); }
    return g;
  }, [data]);

  return (
    <Card>
      <CardHeader title="Résultats des indicateurs" subtitle={data ? `${data.count} soumission(s) prises en compte` : '…'}>
        <MonthPicker value={month || currentMonth()} onChange={setMonth} />
      </CardHeader>
      {data === null ? <div className="card-body"><Skeleton height={120} /></div>
        : data.indicators.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Rien à calculer">Définissez des indicateurs et importez des données.</EmptyState>
        ) : (
          <div className="card-body" style={{ display: 'grid', gap: 18 }}>
            {Object.entries(grouped).map(([mod, list]) => (
              <div key={mod} className="facture-sec">
                <div className="facture-sec-head"><h3 className="facture-sec-title">{mod}</h3></div>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Indicateur</th><th className="num">Valeur</th><th className="num">Base</th><th className="num">Cible</th><th>Appréciation</th></tr></thead>
                  <tbody>
                    {list.map((i) => (
                      <tr key={i.id}>
                        <td><strong>{i.label}</strong><div className="site-meta mono">{i.sourceField}</div></td>
                        <td className="num mono">{i.value == null ? '—' : (i.agg === 'percent_yes' || i.agg === 'percent_value' ? `${i.value} %` : i.value)}</td>
                        <td className="num mono">{i.base}</td>
                        <td className="num mono">{i.target ?? '—'}</td>
                        <td>{i.value == null ? <span className="cell-empty">—</span> : <Badge tone={RATING[i.rating]?.tone} dot>{RATING[i.rating]?.label}</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            ))}
          </div>
        )}
    </Card>
  );
}
