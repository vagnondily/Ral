import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Plus, MapPin, CheckCircle2, CalendarClock, Ban, UserPlus, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, PageHeader, Skeleton } from '../../components/ui.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatInt } from '../../lib/format.js';

const STATUS = {
  planifie: { label: 'Planifiée', color: 'var(--blue-600)' },
  realise: { label: 'Réalisée', color: 'var(--green)' },
  annule: { label: 'Annulée', color: 'var(--text-faint)' },
};
// Rôles génériques (non nominatifs) : le bureau affecte un créneau (Agent 1,
// Superviseur 1…) ; le prestataire TPM y met ensuite une personne en interne.
const ROLES = ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4', 'Superviseur 1', 'Superviseur 2', 'Coordinateur'];

/**
 * Suivi terrain — outil du responsable S&E. Deux temps :
 *  1) Planification générale : le bureau recense les sites à visiter dans le
 *     mois (district › commune › établissement › activité).
 *  2) Affectation : chaque visite est confiée à un prestataire TPM et à un
 *     rôle générique (Agent 1 / Superviseur 1, non nominatif) — l'assignation
 *     se fait donc APRÈS la planification.
 * La réalisation alimente la couverture (réalisées / planifiées).
 */
export default function FieldVisitsPage({ canEdit }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [visits, setVisits] = useState(null);
  const [summary, setSummary] = useState(null);
  const [collDays, setCollDays] = useState([]);
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [fProvider, setFProvider] = useState('');   // '', 'non_affecte', or id
  const [fStatus, setFStatus] = useState('');
  const fileRef = useRef(null);

  const reload = useCallback(() => {
    setVisits(null);
    Promise.all([api.fieldVisits({ month }), api.fieldSummary(month), api.fieldCollectionDays(month)])
      .then(([v, s, c]) => { setVisits(v); setSummary(s); setCollDays(c); })
      .catch((e) => setError(e.message));
  }, [month]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { api.listProviders().then((p) => setProviders(p.map((x) => ({ id: x.id, name: x.name })))).catch(() => setProviders([])); }, []);

  async function onImport(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setImporting(true);
    try {
      const r = await api.fieldImportPlanning(f, month);
      toast.success(`${r.visitsCreated} visite(s) planifiée(s) · ${r.sitesTotal} site(s).`);
      reload();
    } catch (err) { toast.error(err.message); } finally { setImporting(false); }
  }

  const patch = async (v, body) => {
    try { await api.fieldUpdateVisit(v.id, body); reload(); }
    catch (err) { toast.error(err.message); }
  };
  const remove = async (v) => {
    if (!window.confirm(`Supprimer la visite de « ${v.siteName} » ?`)) return;
    try { await api.fieldDeleteVisit(v.id); reload(); } catch (err) { toast.error(err.message); }
  };
  const setTravel = async (providerId, travelDays) => {
    try { await api.fieldSetTravelDays({ providerId, month, travelDays: Math.max(0, Math.round(Number(travelDays) || 0)) }); reload(); }
    catch (err) { toast.error(err.message); }
  };
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);

  const filtered = useMemo(() => (visits || []).filter((v) => {
    if (fProvider === 'non_affecte' && v.providerId) return false;
    if (fProvider && fProvider !== 'non_affecte' && v.providerId !== fProvider) return false;
    if (fStatus && v.status !== fStatus) return false;
    return true;
  }), [visits, fProvider, fStatus]);

  const grouped = useMemo(() => {
    const g = new Map();
    for (const v of filtered) {
      const k = `${v.district} › ${v.commune}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(v);
    }
    return [...g.entries()];
  }, [filtered]);

  const ov = summary?.overall;
  const unassigned = (visits || []).filter((v) => !v.providerId).length;

  return (
    <div className="page">
      <PageHeader title="Planification des visites de terrain"
        description="Étape 1 — le bureau planifie les sites du mois (district › commune › établissement › activité). Étape 2 — chaque visite est affectée à un prestataire TPM et à un rôle générique (Agent 1 / Superviseur 1, non nominatif).">
        <MonthPicker value={month} onChange={setMonth} />
        {canEdit && <><input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImport} />
          <Button variant="secondary" icon={Upload} loading={importing} onClick={() => fileRef.current?.click()}>Importer planning</Button>
          <Button icon={Plus} onClick={() => setAddOpen(true)}>Ajouter une visite</Button></>}
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      {ov && (
        <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
          <Kpi icon={MapPin} tone="blue" label="Sites du mois" value={formatInt(ov.total)} foot={`${grouped.length} commune(s)`} />
          <Kpi icon={UserPlus} tone={unassigned ? 'amber' : 'green'} label="À affecter" value={formatInt(unassigned)} foot="Sans prestataire" />
          <Kpi icon={CalendarClock} tone="blue" label="Planifiées" value={formatInt(ov.planifie)} foot="À réaliser" />
          <Kpi icon={CheckCircle2} tone="green" label="Réalisées" value={formatInt(ov.realise)} foot={`${Math.round(ov.rate * 100)} % de couverture`} />
          <Kpi icon={Ban} tone="red" label="Annulées" value={formatInt(ov.annule)} foot="Exclues du taux" />
        </div>
      )}

      <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        {summary?.byProvider?.length > 0 && (
          <CoverageCard title="Couverture par prestataire" rows={summary.byProvider} />
        )}
        {summary?.byDistrict?.length > 0 && (
          <CoverageCard title="Couverture par district" rows={summary.byDistrict} />
        )}
      </div>

      {collDays.length > 0 && (
        <div className="card biz-card" style={{ marginTop: 16 }}>
          <div className="card-header"><div className="card-title">Jours de collecte (pour le budget)</div>
            <div className="card-sub">Jours de visite = visites datées ; + jours de déplacement (saisie manuelle) = total des jours à budgéter par prestataire.</div></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Prestataire TPM</th><th className="num">Jours de visite</th><th className="num">Jours de déplacement</th><th className="num">Total jours</th></tr></thead>
            <tbody>
              {collDays.map((d) => (
                <tr key={d.providerId}>
                  <td><strong>{d.label}</strong></td>
                  <td className="num tabular">{formatInt(d.visitDays)}</td>
                  <td className="num">
                    {canEdit ? (
                      <input className="input tabular" style={{ width: 70, textAlign: 'right' }} type="number" min="0" step="1"
                        defaultValue={d.travelDays} aria-label={`Jours de déplacement ${d.label}`}
                        onBlur={(e) => { if (Number(e.target.value) !== d.travelDays) setTravel(d.providerId, e.target.value); }} />
                    ) : formatInt(d.travelDays)}
                  </td>
                  <td className="num tabular"><strong>{formatInt(d.totalDays)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="postes-toolbar" style={{ margin: '16px 0' }}>
        <label className="field" style={{ margin: 0 }}>
          <select className="select" value={fProvider} onChange={(e) => setFProvider(e.target.value)} aria-label="Filtre prestataire">
            <option value="">Tous les prestataires</option>
            <option value="non_affecte">— Non affectés —</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <select className="select" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filtre statut">
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </label>
        <span className="hint">{filtered.length} visite(s) affichée(s)</span>
      </div>

      {visits === null ? <Skeleton height={260} /> : filtered.length === 0 ? (
        <div className="card"><div className="card-body"><p className="muted">Aucune visite pour ce mois / ce filtre. Importez le planning (.xlsx) ou ajoutez une visite.</p></div></div>
      ) : (
        <div className="card biz-card">
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th>Site (établissement)</th><th>Activité</th><th>Prestataire TPM</th><th>Rôle</th><th>Date de visite</th><th>Statut</th>{canEdit && <th aria-label="Actions" />}
            </tr></thead>
            <tbody>
              {grouped.map(([zone, list]) => (
                <React.Fragment key={zone}>
                  <tr className="subrow-head"><td colSpan={canEdit ? 7 : 6}><strong>{zone}</strong> · {list.length} site(s)</td></tr>
                  {list.map((v) => (
                    <tr key={v.id}>
                      <td><strong>{v.siteName}</strong>{v.fokontany && <div className="site-meta">{v.fokontany}</div>}</td>
                      <td>{v.activity || '—'}</td>
                      <td>
                        {canEdit ? (
                          <select className={`select ${v.providerId ? '' : 'is-empty'}`} style={{ minWidth: 150 }} value={v.providerId || ''} onChange={(e) => patch(v, { providerId: e.target.value || '' })} aria-label="Prestataire">
                            <option value="">— Non affecté —</option>
                            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : (v.providerName || '—')}
                      </td>
                      <td>
                        {canEdit ? (
                          <select className={`select ${v.agent ? '' : 'is-empty'}`} style={{ minWidth: 130 }} value={v.agent || ''} onChange={(e) => patch(v, { agent: e.target.value })} aria-label="Rôle">
                            <option value="">— Rôle —</option>
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            {v.agent && !ROLES.includes(v.agent) && <option value={v.agent}>{v.agent}</option>}
                          </select>
                        ) : (v.agent || '—')}
                      </td>
                      <td>
                        {canEdit ? (
                          <input className="input" style={{ width: 150 }} type="date" min={monthStart} max={monthEnd}
                            value={v.visitDate || ''} onChange={(e) => e.target.value && patch(v, { visitDate: e.target.value })} aria-label="Date de visite" />
                        ) : (v.visitDate || '—')}
                      </td>
                      <td>
                        {canEdit ? (
                          <div className="seg" role="group" aria-label="Statut">
                            {Object.entries(STATUS).map(([k, s]) => (
                              <button type="button" key={k} className={v.status === k ? 'is-active' : ''} onClick={() => patch(v, { status: k })} title={s.label}>{s.label}</button>
                            ))}
                          </div>
                        ) : (
                          <span className="badge"><span className="dot" style={{ background: STATUS[v.status]?.color }} />{STATUS[v.status]?.label}</span>
                        )}
                      </td>
                      {canEdit && <td><Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(v)} /></td>}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {addOpen && <AddVisitModal month={month} providers={providers} roles={ROLES} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload(); }} />}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, foot, tone }) {
  return (
    <div className="biz-kpi">
      <div className={`biz-kpi-ic ${tone || ''}`}><Icon size={18} aria-hidden="true" /></div>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label">{label}</div>
        <div className="biz-kpi-value tabular">{value}</div>
        {foot && <div className="biz-kpi-foot">{foot}</div>}
      </div>
    </div>
  );
}

function CoverageCard({ title, rows }) {
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="card-body biz-gauges">
        {rows.map((r) => (
          <div className="biz-gauge" key={r.key}>
            <div className="biz-gauge-head"><span>{r.label}</span><span className="tabular">{r.realise}/{r.active} · {Math.round(r.rate * 100)} %</span></div>
            <div className="biz-bar"><span style={{ width: `${Math.round(r.rate * 100)}%`, background: r.rate >= 0.8 ? 'var(--green)' : 'var(--blue-600)' }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddVisitModal({ month, providers, roles, onClose, onSaved }) {
  const toast = useToast();
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ siteId: '', activity: '', providerId: '', agent: '' });
  const [newSite, setNewSite] = useState({ district: '', commune: '', name: '', activity: '' });
  const [mode, setMode] = useState('existing');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.fieldSites().then(setSites).catch(() => setSites([])); }, []);

  async function save() {
    setSaving(true);
    try {
      let siteId = form.siteId;
      let activity = form.activity;
      if (mode === 'new') {
        if (!newSite.district || !newSite.commune || !newSite.name) { toast.error('District, commune et nom du site sont requis.'); setSaving(false); return; }
        const { id } = await api.fieldCreateSite(newSite);
        siteId = id; activity = activity || newSite.activity;
      }
      if (!siteId) { toast.error('Choisissez un site.'); setSaving(false); return; }
      await api.fieldCreateVisit({ siteId, periodMonth: month, activity: activity || undefined, providerId: form.providerId || undefined, agent: form.agent || undefined });
      toast.success('Visite planifiée.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open size="md" title="Ajouter une visite" subtitle={`Mois : ${month}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button onClick={save} loading={saving}>Planifier</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="seg" role="group" aria-label="Type de site">
          <button type="button" className={mode === 'existing' ? 'is-active' : ''} onClick={() => setMode('existing')}>Site existant</button>
          <button type="button" className={mode === 'new' ? 'is-active' : ''} onClick={() => setMode('new')}>Nouveau site</button>
        </div>
        {mode === 'existing' ? (
          <label className="field"><span className="field-label">Site</span>
            <select className={`select ${form.siteId ? '' : 'is-empty'}`} value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">Choisir un site…</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.district} › {s.commune} › {s.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="form-grid">
            <label className="field"><span className="field-label">District</span><input className="input" value={newSite.district} onChange={(e) => setNewSite({ ...newSite, district: e.target.value })} /></label>
            <label className="field"><span className="field-label">Commune</span><input className="input" value={newSite.commune} onChange={(e) => setNewSite({ ...newSite, commune: e.target.value })} /></label>
            <label className="field span-2"><span className="field-label">Établissement</span><input className="input" value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} /></label>
          </div>
        )}
        <label className="field"><span className="field-label">Activité</span><input className="input" value={form.activity} placeholder="Ex. Suivi cantines scolaires" onChange={(e) => setForm({ ...form, activity: e.target.value })} /></label>
        <div className="form-grid">
          <label className="field"><span className="field-label">Prestataire TPM (optionnel)</span>
            <select className="select" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>
              <option value="">— Non affecté —</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Rôle (optionnel)</span>
            <select className="select" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })}>
              <option value="">— Rôle —</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
