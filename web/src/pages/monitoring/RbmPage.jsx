import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Wand2, ShieldAlert, MapPin, SlidersHorizontal } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, PageHeader, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatInt } from '../../lib/format.js';

const RISK = {
  elevee: { label: 'Élevé', color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)', freq: 'tous les mois' },
  moyenne: { label: 'Moyen', color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)', freq: 'tous les 2 mois' },
  faible: { label: 'Faible', color: 'var(--green)', bg: 'var(--green-bg)', text: 'var(--green-text)', freq: 'tous les 3 mois' },
};
const SCORE = { 0: { bg: 'var(--green-bg)', text: 'var(--green-text)' }, 1: { bg: 'var(--orange-bg)', text: 'var(--orange-text)' }, 2: { bg: 'var(--red-bg)', text: 'var(--red-text)' } };
const PRIO = { 0: { color: 'var(--green)', bg: 'var(--green-bg)', text: 'var(--green-text)' }, 1: { color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)' }, 2: { color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)' } };

/**
 * Risk-Based Monitoring — le référentiel de sites porte un niveau de risque qui
 * pilote la fréquence de suivi (élevé = tous les mois, moyen = 2 mois, faible =
 * 3 mois). La planification des visites du mois se GÉNÈRE depuis ce RBM : chaque
 * site « à suivre » (jamais visité ou échéance atteinte) devient une visite
 * planifiée. Import du référentiel Master Data pris en charge.
 */
export default function RbmPage({ canEdit }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [risk, setRisk] = useState('');
  const [sites, setSites] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [crit, setCrit] = useState(null); // site en cours d'édition des critères
  const fileRef = useRef(null);

  const reload = useCallback(() => {
    setSites(null);
    api.rbmSites(month, risk).then(setSites).catch((e) => setError(e.message));
  }, [month, risk]);
  useEffect(() => { reload(); }, [reload]);

  const setSiteRisk = async (s, riskLevel) => {
    try { await api.fieldUpdateSite(s.id, { riskLevel }); reload(); }
    catch (e) { toast.error(e.message); }
  };
  const generate = async () => {
    setBusy(true);
    try { const r = await api.rbmGenerate(month, risk); toast.success(`${r.created} visite(s) planifiée(s) sur ${r.due} site(s) à suivre.`); reload(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const onImport = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { const r = await api.rbmImport(f); toast.success(`${r.inserted} site(s) ajouté(s) · ${r.total} ligne(s).`); reload(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const stats = useMemo(() => {
    const s = { total: 0, elevee: 0, moyenne: 0, faible: 0, due: 0 };
    for (const x of sites || []) { s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1; if (x.due) s.due += 1; }
    return s;
  }, [sites]);

  return (
    <div className="page">
      <PageHeader title="Risk-Based Monitoring (RBM)" description="Le niveau de risque de chaque site pilote la fréquence de suivi. La planification des visites du mois se génère depuis le RBM : les sites « à suivre » deviennent des visites planifiées.">
        <MonthPicker value={month} onChange={setMonth} />
        {canEdit && <>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImport} />
          <Button variant="secondary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>Importer sites (Master Data)</Button>
          <Button icon={Wand2} loading={busy} onClick={generate}>Générer la planification du mois</Button>
        </>}
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <Kpi icon={MapPin} tone="blue" label="Sites référencés" value={formatInt(stats.total)} />
        <Kpi icon={ShieldAlert} tone="red" label="Risque élevé" value={formatInt(stats.elevee)} foot={RISK.elevee.freq} />
        <Kpi icon={ShieldAlert} tone="amber" label="Risque moyen" value={formatInt(stats.moyenne)} foot={RISK.moyenne.freq} />
        <Kpi icon={ShieldAlert} tone="green" label="Risque faible" value={formatInt(stats.faible)} foot={RISK.faible.freq} />
        <Kpi icon={Wand2} tone="blue" label="À suivre ce mois" value={formatInt(stats.due)} foot="Selon le RBM" />
      </div>

      <div className="postes-toolbar" style={{ margin: '16px 0' }}>
        <label className="field" style={{ margin: 0 }}>
          <select className="select" value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Filtre risque">
            <option value="">Tous les niveaux de risque</option>
            <option value="elevee">Élevé</option><option value="moyenne">Moyen</option><option value="faible">Faible</option>
          </select>
        </label>
        <span className="hint">{sites ? `${sites.length} site(s)` : '…'}</span>
      </div>

      {sites === null ? <Skeleton height={300} /> : sites.length === 0 ? (
        <div className="card"><div className="card-body"><p className="muted">Aucun site référencé. Importez le référentiel Master Data (.xlsx).</p></div></div>
      ) : (
        <div className="card biz-card">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Site</th><th>District / Commune</th><th>Niveau de risque</th><th>Score RBM</th><th>Priorité</th><th>Dernière visite</th><th>À suivre ce mois</th>{canEdit && <th aria-label="Critères" />}</tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} className={s.due ? 'is-selected' : ''}>
                  <td><strong>{s.name}</strong>{s.activity && <div className="site-meta">{s.activity}</div>}</td>
                  <td>{s.district} › {s.commune}</td>
                  <td>
                    {canEdit ? (
                      <select className="select" style={{ minWidth: 110 }} value={s.riskLevel || 'moyenne'} onChange={(e) => setSiteRisk(s, e.target.value)} aria-label="Niveau de risque">
                        <option value="elevee">Élevé</option><option value="moyenne">Moyen</option><option value="faible">Faible</option>
                      </select>
                    ) : (
                      <span className="badge" style={{ background: RISK[s.riskLevel]?.bg, color: RISK[s.riskLevel]?.text }}>
                        <span className="dot" style={{ background: RISK[s.riskLevel]?.color }} />{RISK[s.riskLevel]?.label || s.riskLevel}</span>
                    )}
                  </td>
                  <td><span className="badge" style={{ background: SCORE[s.finalScore]?.bg, color: SCORE[s.finalScore]?.text }}>{s.finalLabel || '—'}</span>{s.urgentFlags && <div className="site-meta" style={{ color: 'var(--red)' }}>⚑ urgent</div>}</td>
                  <td><span className="badge" style={{ background: PRIO[s.priority]?.bg, color: PRIO[s.priority]?.text }}><span className="dot" style={{ background: PRIO[s.priority]?.color }} />{s.priorityLabel || '—'}</span></td>
                  <td className="tabular">{s.lastVisitMonth || '—'}{s.monthsSinceVisit != null && <div className="site-meta">il y a {s.monthsSinceVisit} mois</div>}</td>
                  <td>{s.due
                    ? <span className="badge" style={{ background: 'var(--blue-50)', color: 'var(--blue-700)' }}><span className="dot" style={{ background: 'var(--blue-600)' }} />À suivre</span>
                    : <span className="muted">à jour</span>}</td>
                  {canEdit && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" icon={SlidersHorizontal} aria-label="Critères de risque" onClick={() => setCrit(s)} /></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {crit && <CritModal site={crit} onClose={() => setCrit(null)} onSaved={() => { setCrit(null); reload(); }} />}
    </div>
  );
}

const C02 = [['security', 'Situation sécuritaire', ['Pas de restriction', 'Modérée', 'Élevée']],
  ['issuesProcess', 'Problèmes — suivi interne', ['Aucun', 'Important', 'Urgent']],
  ['issuesPartnerReport', 'Problèmes — rapport partenaire', ['Aucun', 'Important', 'Urgent']],
  ['issuesCFM', 'Problèmes — mécanisme de plainte (CFM)', ['Aucun', 'Important', 'Urgent']]];
const C01 = [['synergies', 'Synergies de programme', ['Une seule activité', 'Plusieurs activités']],
  ['beneficiaryOver200', 'Taille (bénéficiaires)', ['≤ 200', '> 200']],
  ['newPartner', 'Partenaire', ['Expérimenté', 'Nouveau']],
  ['fraud', 'Fraude / corruption', ['Non suspectée', 'Suspectée']]];

function CritModal({ site, onClose, onSaved }) {
  const toast = useToast();
  const init = {};
  [...C02, ...C01].forEach(([k]) => { init[k] = Number(site[k]) || 0; });
  const [form, setForm] = useState(init);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try { await api.fieldUpdateSite(site.id, form); toast.success('Critères enregistrés.'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }
  const sel = (k, label, opts) => (
    <Field key={k} label={label}>
      <select className="select" value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}>
        {opts.map((o, i) => <option key={i} value={i}>{o}</option>)}
      </select>
    </Field>
  );
  return (
    <Modal open size="md" title="Critères de risque (RBM)" subtitle={`${site.name} — alimentent le score et la priorité`} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button onClick={save} loading={saving}>Enregistrer</Button></>}>
      <div className="form-grid">
        {C02.map(([k, l, o]) => sel(k, l, o))}
        {C01.map(([k, l, o]) => sel(k, l, o))}
      </div>
    </Modal>
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
