import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Upload, AlertCircle, ClipboardCheck, RefreshCw, ArrowLeft, ChevronRight,
  FileSpreadsheet, SlidersHorizontal, Database, BarChart3, Link2, Trash2, Pencil, Check, Minus, Shuffle,
  Table2, Download, Search,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, PageHeader, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import IndicatorsList from './IndicatorsList.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatDateTime } from '../../lib/format.js';

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
  { key: 'fieldOffice', label: 'Bureau' },
  { key: 'communeName', label: 'Commune', alt: 'admin4' },
  { key: 'admin3', label: 'District' },
  { key: 'site', label: 'Site' },
  { key: 'partner', label: 'Partenaire' },
  { key: 'agent', label: 'Agent' },
];

export default function ProcessMonitoringPage({ canEdit }) {
  const toast = useToast();
  const [forms, setForms] = useState(null);
  const [selId, setSelId] = useState(null);
  const [error, setError] = useState(null);

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
    const label = window.prompt('Nom de la fiche de suivi (ex. Suivi de processus GD/PREVMA) :');
    if (!label) return;
    const code = window.prompt('Code court (ex. GD_PREVMA) :', label.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 30));
    if (!code) return;
    try { const { id } = await api.monCreateForm({ code, label }); await loadForms(); setSelId(id); toast.success('Fiche créée.'); }
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
      toast.success(`Fiche « ${r.label} » importée : ${r.fields} variable(s), ${r.choices} choix.`);
    } catch (err) { toast.error(err.message); } finally { setImportingDef(false); }
  }

  if (selected) {
    return <FormDetail form={selected} canEdit={canEdit} onBack={() => setSelId(null)} onChanged={loadForms} />;
  }

  return (
    <div className="section-gap">
      <PageHeader title="Suivi de processus — fiches & indicateurs" description="Chaque fiche correspond à une activité suivie. Importez un XLSForm (Kobo/ODK) ou créez une fiche, puis ouvrez-la pour ses variables, ses résultats, le mapping MEMS et sa configuration.">
        {canEdit && <><input ref={xlsformRef} type="file" accept=".xlsx" hidden onChange={onXlsform} />
          <Button variant="secondary" icon={Upload} loading={importingDef} onClick={() => xlsformRef.current?.click()}>Importer un XLSForm</Button></>}
        {canEdit && <Button icon={Plus} onClick={newForm}>Nouvelle fiche</Button>}
      </PageHeader>

      {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

      {forms === null ? <Card><div className="card-body"><Skeleton height={160} /></div></Card>
        : forms.length === 0 ? (
          <Card><EmptyState icon={ClipboardCheck} title="Aucune fiche de suivi"
            action={canEdit && <Button icon={Plus} onClick={newForm}>Nouvelle fiche</Button>}>
            Importez un XLSForm (Kobo/ODK) ou créez une fiche, puis configurez ses indicateurs et importez les données réelles.
          </EmptyState></Card>
        ) : (
          <Card aria-label="Fiches de suivi">
            <CardHeader title="Fiches de suivi" subtitle={`${forms.length} fiche(s) — cliquez pour ouvrir.`} />
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th scope="col">Fiche (activité)</th><th scope="col" className="num">Indicateurs</th>
                  <th scope="col" className="num">Soumissions</th><th scope="col">État</th><th scope="col" />
                </tr></thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.id} className="clickable" onClick={() => setSelId(f.id)}>
                      <td><strong>{f.label}</strong><div className="site-meta mono">{f.code}</div></td>
                      <td className="num tabular">{f.indicatorCount ?? 0}</td>
                      <td className="num tabular">{f.submissionCount ?? 0}</td>
                      <td><Badge tone={f.active ? 'green' : null} dot>{f.active ? 'Active' : 'Inactive'}</Badge></td>
                      <td style={{ textAlign: 'right' }}><ChevronRight size={16} className="muted" aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
    </div>
  );
}

// ======================================================================
// Détail d'une fiche
// ======================================================================
function FormDetail({ form, canEdit, onBack, onChanged }) {
  const [tab, setTab] = useState('variables');
  return (
    <div className="section-gap">
      <div className="detail-head">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>Toutes les fiches</Button>
      </div>
      <PageHeader title={form.label} description={`Code ${form.code} · ${form.indicatorCount ?? 0} indicateur(s) · ${form.submissionCount ?? 0} soumission(s).`} />

      <div className="seg" role="tablist" aria-label="Sections de la fiche">
        {DETAIL_TABS.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'is-active' : ''} onClick={() => setTab(x.id)}>
              <Icon size={15} aria-hidden="true" /> {x.label}
            </button>
          );
        })}
      </div>

      {tab === 'variables' && <VariablesTab form={form} />}
      {tab === 'donnees' && <DataViewTab form={form} onGoConfig={() => setTab('config')} />}
      {tab === 'resultats' && <ResultsTab form={form} onGoConfig={() => setTab('config')} />}
      {tab === 'mapping' && <MappingTab form={form} />}
      {tab === 'config' && <ConfigTab form={form} canEdit={canEdit} onChanged={onChanged} />}
    </div>
  );
}

// ---- Variables (catalogue XLSForm : name/label/type/groupe/skip logic) ---
function VariablesTab({ form }) {
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
      <CardHeader id="vars-title" title="Variables du formulaire (XLSForm)"
        subtitle="Nom technique et libellé de chaque question, son type, son groupe, sa logique de saut (relevant) et ses choix — pour comprendre les données et les relier aux indicateurs.">
        {cat && <span className="input-wrap ind-search"><input className="input" type="search" placeholder="Filtrer les variables…" value={q} onChange={(e) => setQ(e.target.value)} /></span>}
      </CardHeader>
      {cat === null ? <div className="card-body"><Skeleton height={140} /></div>
        : (cat.fields || []).length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="Aucune variable">
            Importez la définition XLSForm de cette fiche (ou des données réelles) pour lister ses variables.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">Libellé (label)</th><th scope="col">Nom (name)</th><th scope="col">Type</th>
                <th scope="col">Groupe</th><th scope="col">Logique de saut (skip)</th><th scope="col">Choix</th>
              </tr></thead>
              <tbody>
                {fields.map((f) => {
                  const opts = f.listName ? (choicesByList[f.listName] || []) : [];
                  return (
                    <tr key={f.name}>
                      <td><strong>{f.label || f.name}</strong>{f.required ? <> <Badge tone="blue">obligatoire</Badge></> : null}</td>
                      <td><span className="mono">{f.name}</span></td>
                      <td className="muted">{f.type || '—'}</td>
                      <td className="muted">{f.group || '—'}</td>
                      <td>{f.relevant ? <code className="skip-expr">{f.relevant}</code> : <span className="cell-empty">—</span>}</td>
                      <td>{opts.length
                        ? <span title={opts.map((o) => `${o.value} = ${o.label}`).join('\n')}>{opts.length} choix <span className="site-meta">({f.listName})</span></span>
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

function DataViewTab({ form, onGoConfig }) {
  const toast = useToast();
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(null);
  const [res, setRes] = useState(null);

  useEffect(() => {
    setCat(null); setRes(null);
    Promise.all([
      api.monCatalog(form.id).catch(() => ({ fields: [], choices: [] })),
      api.monFormSubmissions(form.id, { month: month || undefined, limit: 500 }),
    ]).then(([c, r]) => { setCat(c || { fields: [], choices: [] }); setRes(r); })
      .catch((e) => { toast.error(e.message); setCat({ fields: [], choices: [] }); setRes({ rows: [], total: 0, limit: 0 }); });
    /* eslint-disable-next-line */
  }, [form.id, month]);

  const rows = res?.rows || [];
  const labelOf = choiceLabeller(cat?.choices);

  // Colonnes « variables » : catalogue d'abord, sinon clés vues dans les données.
  const varCols = useMemo(() => {
    const catFields = cat?.fields || [];
    if (catFields.length) return catFields;
    const seen = new Map();
    for (const r of rows) for (const k of Object.keys(r.data || {})) if (!seen.has(k)) seen.set(k, { name: k, label: k, listName: null });
    return [...seen.values()];
  }, [cat, rows]);

  // Colonnes « méta » qui portent au moins une valeur (évite les colonnes vides).
  const metaCols = useMemo(() => META_COLS.filter((m) => rows.some((r) => {
    const v = r[m.key] ?? (m.alt ? r[m.alt] : null);
    return v != null && v !== '';
  })), [rows]);

  const metaVal = (r, m) => {
    const v = r[m.key] ?? (m.alt ? r[m.alt] : null);
    return m.fmt ? m.fmt(v) : (v == null || v === '' ? '—' : String(v));
  };

  const shown = useMemo(() => {
    if (!q) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => {
      if (metaCols.some((m) => String(metaVal(r, m)).toLowerCase().includes(s))) return true;
      return Object.values(r.data || {}).some((v) => String(v ?? '').toLowerCase().includes(s));
    });
    /* eslint-disable-next-line */
  }, [rows, q, metaCols]);

  const [open, setOpen] = useState(null);

  function exportCsv() {
    const head = [...metaCols.map((m) => m.label), ...varCols.map((v) => v.label || v.name)];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = shown.map((r) => [
      ...metaCols.map((m) => metaVal(r, m)),
      ...varCols.map((v) => { const raw = r.data?.[v.name]; return raw == null || raw === '' ? '' : labelOf(v, raw); }),
    ].map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `donnees_${form.code}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const loading = cat === null || res === null;
  return (
    <Card aria-labelledby="data-title">
      <CardHeader id="data-title" title="Données importées (soumissions)"
        subtitle="Les réponses réellement versées, alignées sur les variables du formulaire (libellé + nom). Cliquez une ligne pour voir toutes les réponses." />
      {loading ? <div className="card-body"><Skeleton height={160} /></div>
        : rows.length === 0 ? (
          <EmptyState icon={Table2} title="Aucune donnée importée"
            action={<Button variant="secondary" icon={Upload} onClick={onGoConfig}>Importer des données</Button>}>
            Importez des soumissions (onglet Configuration › Données réelles) pour les visualiser ici.
          </EmptyState>
        ) : (
          <>
            <div className="ind-toolbar">
              <span className="input-wrap ind-search"><Search size={16} aria-hidden="true" />
                <input className="input" type="search" placeholder="Filtrer les soumissions…" value={q} onChange={(e) => setQ(e.target.value)} />
              </span>
              <label className="ind-period">Période <MonthSelect value={month || currentMonth()} onChange={setMonth} /></label>
              <span className="ind-hint">{shown.length} / {res.total} soumission(s){res.total > res.limit ? ` · ${res.limit} affichées max` : ''}</span>
              <span className="ind-tsp" />
              <IconButton icon={Download} label="Exporter (CSV)" variant="secondary" size="sm" onClick={exportCsv} />
            </div>
            <div className="table-wrap data-scroll">
              <table className="table data-grid">
                <thead><tr>
                  {metaCols.map((m) => <th key={m.key} scope="col">{m.label}</th>)}
                  {varCols.map((v) => <th key={v.name} scope="col"><span>{v.label || v.name}</span><div className="th-sub mono">{v.name}</div></th>)}
                </tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.externalId || i} className="clickable" onClick={() => setOpen(r)}>
                      {metaCols.map((m) => <td key={m.key} className={m.key === 'submittedAt' ? 'tabular' : ''}>{metaVal(r, m)}</td>)}
                      {varCols.map((v) => {
                        const raw = r.data?.[v.name];
                        return <td key={v.name} className="mono-cell">{raw == null || raw === '' ? <span className="cell-empty">—</span> : labelOf(v, raw)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      {open && <SubmissionDrawer sub={open} varCols={varCols} metaCols={metaCols} metaVal={metaVal} labelOf={labelOf} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function SubmissionDrawer({ sub, varCols, metaCols, metaVal, labelOf, onClose }) {
  const extraKeys = Object.keys(sub.data || {}).filter((k) => !varCols.some((v) => v.name === k));
  return (
    <Modal open variant="drawer" size="md" title="Soumission"
      subtitle={sub.externalId ? sub.externalId : (sub.submittedAt ? formatDateTime(sub.submittedAt) : undefined)}
      onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      <dl className="ind-kv">
        {metaCols.map((m) => (<React.Fragment key={m.key}><dt>{m.label}</dt><dd>{metaVal(sub, m)}</dd></React.Fragment>))}
      </dl>
      <h4 className="drawer-sub">Réponses</h4>
      <dl className="ind-kv">
        {varCols.map((v) => {
          const raw = sub.data?.[v.name];
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
    <label className="ind-period">Période <MonthSelect value={month || currentMonth()} onChange={setMonth} /></label>
  );

  if (data === null) return <Card><div className="card-body"><Skeleton height={160} /></div></Card>;
  if (data.indicators.length === 0 && (cov.submissions || 0) === 0) {
    return (
      <Card><EmptyState icon={BarChart3} title="Rien à afficher"
        action={<Button variant="secondary" icon={SlidersHorizontal} onClick={onGoConfig}>Configurer la fiche</Button>}>
        Définissez des indicateurs et importez des données réelles (onglet Configuration) pour alimenter les résultats.
      </EmptyState></Card>
    );
  }
  return (
    <div className="section-gap">
      <Stats items={[
        { label: 'Soumissions', value: cov.submissions ?? 0, foot: `${cov.fieldOffices ?? 0} bureau(x)` },
        { label: 'Sites suivis', value: cov.sites ?? 0, foot: 'sites distincts' },
        { label: 'Agents', value: cov.agents ?? 0, foot: `${cov.partners ?? 0} prestataire(s)` },
        { label: 'Indice moyen', value: data.overallIndex == null ? '—' : data.overallIndex, suffix: data.overallIndex == null ? '' : '%', foot: 'moyenne des indicateurs %' },
      ]} />
      <IndicatorsList indicators={data.indicators} moduleLabel={form.label} toolbarExtra={periodControl} />
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
    </div>
  );
}

// ---- Mapping MEMS (quelle colonne alimente quelle dimension du référentiel) --
function MappingTab({ form }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    api.monMemsMapping(form.id).then(setRows).catch((e) => { toast.error(e.message); setRows([]); });
    /* eslint-disable-next-line */
  }, [form.id]);

  const matched = (rows || []).filter((r) => r.column).length;
  return (
    <Card aria-labelledby="mems-title">
      <CardHeader id="mems-title" title="Mapping avec les référentiels MEMS"
        subtitle="Quelle colonne du formulaire alimente chaque dimension MEMS (bureau, zones, site, partenaire, agent, période). Détecté automatiquement à partir des variables ; sert au rattachement des soumissions." />
      {rows === null ? <div className="card-body"><Skeleton height={140} /></div> : (
        <>
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <Alert tone={matched ? 'info' : 'warning'} icon={matched ? Link2 : AlertCircle}>
              {matched} dimension(s) sur {rows.length} reliée(s). Les dimensions non reliées restent vides tant qu'aucune colonne du formulaire ne correspond (renommez la colonne dans le XLSForm au besoin).
            </Alert>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">Dimension MEMS</th><th scope="col">Référentiel</th><th scope="col">Colonne du formulaire</th><th scope="col">État</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{r.label}</strong></td>
                    <td className="muted">{r.mems}</td>
                    <td>{r.column
                      ? <><span className="mono">{r.column}</span>{r.columnLabel && r.columnLabel !== r.column && <div className="site-meta">{r.columnLabel}</div>}</>
                      : <span className="cell-empty">—</span>}</td>
                    <td>{r.column
                      ? <Badge tone="green" icon={Check}>relié</Badge>
                      : <Badge tone={null} icon={Minus}>non relié</Badge>}</td>
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
  return (
    <div className="section-gap">
      <IndicatorsConfigCard form={form} canEdit={canEdit} onChanged={onChanged} />
      <DataSourcesCard form={form} canEdit={canEdit} onChanged={onChanged} />
    </div>
  );
}

function IndicatorsConfigCard({ form, canEdit, onChanged }) {
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
    if (!window.confirm(`Supprimer l'indicateur « ${i.label} » ?`)) return;
    try { await api.monDeleteIndicator(i.id); toast.success('Indicateur supprimé.'); reload(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  }

  const fieldLabel = useMemo(() => Object.fromEntries((catalog.fields || []).map((f) => [f.name, f.label || f.name])), [catalog]);

  return (
    <Card aria-labelledby="cfg-ind-title">
      <CardHeader id="cfg-ind-title" title="Indicateurs & méthodes de calcul"
        subtitle="Construisez chaque indicateur à partir des variables disponibles (champ du formulaire) + un mode de calcul (% de oui, moyenne, somme…). Recalculé en direct depuis les données.">
        {canEdit && (catalog.fields.length > 0 || (indicators || []).length > 0) && <Button size="sm" icon={Plus} onClick={() => setEdit({})}>Nouvel indicateur</Button>}
      </CardHeader>
      {indicators === null ? <div className="card-body"><Skeleton height={120} /></div>
        : indicators.length === 0 ? (
          <EmptyState icon={Link2} title="Aucun indicateur"
            action={canEdit && <Button icon={Plus} onClick={() => setEdit({})}>Nouvel indicateur</Button>}>
            Reliez une variable du formulaire à un mode de calcul (ex. « % de bénéficiaires informés » ← champ <code>info_recue</code>, mode « % de oui »).
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">Indicateur</th><th scope="col">Module</th><th scope="col">Variable source</th>
                <th scope="col">Méthode</th><th scope="col" className="num">Cible</th><th scope="col">Sens</th>{canEdit && <th scope="col" />}
              </tr></thead>
              <tbody>
                {indicators.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.label}</strong><div className="site-meta mono">{i.code}</div></td>
                    <td>{i.module || <span className="cell-empty">—</span>}</td>
                    <td><span className="mono">{i.sourceField}</span>
                      {fieldLabel[i.sourceField] && fieldLabel[i.sourceField] !== i.sourceField && <div className="site-meta">{fieldLabel[i.sourceField]}</div>}
                      {i.agg === 'percent_value' && i.positiveValue ? <div className="site-meta">= {i.positiveValue}</div> : null}</td>
                    <td>{AGG_SHORT[i.agg] || i.agg}</td>
                    <td className="num mono">{i.target ?? <span className="cell-empty">—</span>}</td>
                    <td>{i.direction === 'lower_better' ? '↓ mieux' : '↑ mieux'}</td>
                    {canEdit && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label="Éditer" onClick={() => setEdit(i)} />
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(i)} />
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

function DataSourcesCard({ form, canEdit, onChanged }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [kobo, setKobo] = useState({ open: false, baseUrl: 'https://kf.kobotoolbox.org', assetUid: '', token: '' });

  async function onFile(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { const r = await api.monImport(form.id, file); toast.success(`${r.inserted}/${r.received} soumission(s) importée(s).`); onChanged?.(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
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
      <CardHeader title="Données réelles" subtitle={`${form.submissionCount ?? 0} soumission(s). Import CSV / XLSX / SPSS .sav / .zip Kobo, ou API Kobo v2.`} />
      <div className="card-body" style={{ display: 'grid', gap: 16 }}>
        <div className="postes-toolbar">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.sav,.zip" hidden onChange={onFile} />
          <Button size="sm" variant="secondary" icon={Upload} loading={busy} disabled={!canEdit} onClick={() => fileRef.current?.click()}>Importer un fichier</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!canEdit} onClick={() => setKobo({ ...kobo, open: !kobo.open })}>Depuis l'API Kobo v2</Button>
          <span className="hint">Les colonnes sont détectées automatiquement (voir l'onglet Mapping MEMS).</span>
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

// ---- Modal de définition d'indicateur (variable disponible → calcul) -----
function IndicatorModal({ form, catalog, indicator, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(indicator);
  const [f, setF] = useState(() => indicator || { code: '', label: '', module: '', sourceField: '', agg: 'percent_yes', positiveValue: '', target: '', direction: 'higher_better' });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const err = { code: !f.code.trim(), label: !f.label.trim(), sourceField: !String(f.sourceField).trim() };

  const fields = catalog.fields || [];
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
      toast.success('Indicateur enregistré.'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open size="lg" title={editing ? 'Modifier l\'indicateur' : 'Nouvel indicateur'}
      subtitle="Reliez une variable du formulaire à une méthode de calcul." onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button onClick={save} loading={saving}>Enregistrer</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label="Libellé" required error={touched && err.label ? 'Requis.' : undefined}><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Bénéficiaires informés" /></Field>
          <Field label="Code" required error={touched && err.code ? 'Requis.' : undefined}><input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="benef_informes" /></Field>
        </div>
        <Field label="Module (regroupement)" hint="Regroupe les indicateurs dans les résultats (ex. « Information & CFM »).">
          <input className="input" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} placeholder="Information & CFM" />
        </Field>

        <div className="field">
          <span className="field-label">Variable source (champ du formulaire) <span className="req" aria-hidden="true">*</span></span>
          <div className="hint" style={{ marginBottom: 6 }}>
            {fields.length ? `${fields.length} variable(s) disponible(s) dans cette fiche.` : 'Aucun catalogue de champs : saisissez le nom exact de la variable.'}
          </div>
          {fields.length ? (
            <select className={`select ${f.sourceField ? '' : 'is-empty'}`} value={f.sourceField}
              onChange={(e) => setF({ ...f, sourceField: e.target.value, positiveValue: '' })}>
              <option value="">Choisir une variable…</option>
              {fields.map((x) => <option key={x.name} value={x.name}>{x.label && x.label !== x.name ? `${x.label} — ${x.name}` : x.name}{x.type ? ` (${x.type})` : ''}</option>)}
            </select>
          ) : (
            <input className="input mono" value={f.sourceField} onChange={(e) => setF({ ...f, sourceField: e.target.value })} placeholder="info_recue" />
          )}
          {touched && err.sourceField && <div className="field-error">Requis.</div>}
          {selField?.group && <div className="site-meta" style={{ marginTop: 4 }}>Groupe : {selField.group}</div>}
          {selField?.relevant && <div className="site-meta" style={{ marginTop: 2 }}>Logique de saut : <code className="skip-expr">{selField.relevant}</code></div>}
        </div>

        <div className="form-grid">
          <Field label="Méthode de calcul">
            <select className="select" value={f.agg} onChange={(e) => setF({ ...f, agg: e.target.value })}>
              {Object.entries(AGG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {f.agg === 'percent_value'
            ? (
              <Field label="Valeur « positive »" hint="Réponse comptée comme atteinte.">
                {fieldChoices.length ? (
                  <select className="select" value={f.positiveValue} onChange={(e) => setF({ ...f, positiveValue: e.target.value })}>
                    <option value="">Choisir une valeur…</option>
                    {fieldChoices.map((c) => <option key={c.value} value={c.value}>{c.label && c.label !== c.value ? `${c.label} (${c.value})` : c.value}</option>)}
                  </select>
                ) : (
                  <input className="input" value={f.positiveValue} onChange={(e) => setF({ ...f, positiveValue: e.target.value })} placeholder="oui / 1 / A" />
                )}
              </Field>
            )
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

        <div className="note"><SlidersHorizontal size={18} aria-hidden="true" /><span>
          {f.agg === 'count' && <>Compte le nombre de réponses à la variable.</>}
          {f.agg === 'sum' && <>Additionne les valeurs numériques de la variable.</>}
          {f.agg === 'mean' && <>Moyenne des valeurs numériques de la variable.</>}
          {f.agg === 'percent_yes' && <>Part des réponses « oui » (oui / 1 / true) sur le total renseigné.</>}
          {f.agg === 'percent_value' && <>Part des réponses égales à <strong>{String(f.positiveValue).trim() || '…'}</strong> sur le total renseigné.</>}
        </span></div>
      </div>
    </Modal>
  );
}
