import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Wand2, ShieldAlert, MapPin, SlidersHorizontal } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Stats } from '../../components/ui.jsx';
import DataList from '../../components/DataList.jsx';
import Modal from '../../components/Modal.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatInt } from '../../lib/format.js';

const RISK = {
  elevee: { label: 'Élevé', color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)', freq: 'tous les mois' },
  moyenne: { label: 'Moyen', color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)', freq: 'tous les 2 mois' },
  faible: { label: 'Faible', color: 'var(--green)', bg: 'var(--green-bg)', text: 'var(--green-text)', freq: 'tous les 3 mois' },
};
const SCORE = { 0: { bg: 'var(--green-bg)', text: 'var(--green-text)' }, 1: { bg: 'var(--orange-bg)', text: 'var(--orange-text)' }, 2: { bg: 'var(--red-bg)', text: 'var(--red-text)' } };
const PRIO = { 0: { color: 'var(--green)', bg: 'var(--green-bg)', text: 'var(--green-text)' }, 1: { color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)' }, 2: { color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)' } };
const TONE = { green: { color: 'var(--green)', bg: 'var(--green-bg)', text: 'var(--green-text)' }, amber: { color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)' }, red: { color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)' } };
// Libellés des critères (0/1/2) — fidèles au Plan de suivi, pour l'affichage.
const LABEL02 = {
  security: ['Pas de restriction', 'Modérée', 'Élevée'],
  issues: ['Aucun', 'Important', 'Urgent'],
};
const LABEL01 = {
  synergies: ['Une seule activité', 'Plusieurs activités'],
  caseload: ['≤ 200', '> 200'],
  newPartner: ['Expérimenté', 'Nouveau'],
  fraud: ['Non suspectée', 'Suspectée'],
};

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
  const [offices, setOffices] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const fileRef = useRef(null);
  const planRef = useRef(null);

  const reload = useCallback(() => {
    setSites(null);
    api.rbmSites(month, risk).then(setSites).catch((e) => setError(e.message));
  }, [month, risk]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { api.listOffices().then(setOffices).catch(() => setOffices([])); }, []);

  // Sous-arbre d'un bureau : lui-même + toutes ses antennes (récursif). Un bureau
  // pays (national) couvre TOUT le pays ; un bureau terrain ne voit que ses sites.
  const officeById = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);
  const descendantsOf = useCallback((officeId) => {
    const set = new Set([officeId]);
    let added = true;
    while (added) {
      added = false;
      for (const o of offices) { if (o.parentId && set.has(o.parentId) && !set.has(o.id)) { set.add(o.id); added = true; } }
    }
    return set;
  }, [offices]);

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
  const onImportPlan = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.rbmImportPlan(f);
      toast.success(`${r.upserted} site(s) importé(s) (feuille « ${r.sheet} »)${r.lastVisits ? ` · ${r.lastVisits} dernière(s) visite(s)` : ''}${r.skipped ? ` · ${r.skipped} ligne(s) sans géographie ignorée(s)` : ''}.`);
      reload();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const stats = useMemo(() => {
    const s = { total: 0, elevee: 0, moyenne: 0, faible: 0, due: 0 };
    for (const x of sites || []) { s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1; if (x.due) s.due += 1; }
    return s;
  }, [sites]);

  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort().map((x) => ({ id: x, label: x }));

  // Colonnes fidèles à la feuille « Risk-based site selection » du Plan de suivi
  // (en-têtes réels, non inventés). Le sélecteur de colonnes permet de montrer
  // les colonnes de critères détaillées.
  const columns = useMemo(() => {
    const c = {
      subOffice: { label: 'Sous-bureau', sortVal: (s) => s.subOfficeName || '', csv: (s) => s.subOfficeName || '', render: (s) => s.subOfficeName || <span className="cell-empty">—</span> },
      antenne: { label: 'Antenne', sortVal: (s) => s.antenneName || '', csv: (s) => s.antenneName || '', render: (s) => s.antenneName || <span className="cell-empty">—</span> },
      name: { label: 'Nom du site', sortVal: (s) => s.name, csv: (s) => s.name, render: (s) => <strong>{s.name}</strong> },
      region: { label: 'Région', sortVal: (s) => s.adm1 || '', csv: (s) => s.adm1 || '', render: (s) => s.adm1 || '—' },
      district: { label: 'District', sortVal: (s) => s.adm2 || s.district || '', csv: (s) => s.adm2 || s.district || '', render: (s) => s.adm2 || s.district || '—' },
      communes: { label: 'Commune', sortVal: (s) => s.adm3 || s.commune || '', csv: (s) => s.adm3 || s.commune || '', render: (s) => s.adm3 || s.commune || '—' },
      fokontany: { label: 'Fokontany', sortVal: (s) => s.fokontany || '', csv: (s) => s.fokontany || '', render: (s) => s.fokontany || '—' },
      idSite: { label: 'ID site', sortVal: (s) => s.code || '', csv: (s) => s.code || '', render: (s) => <span className="mono">{s.code || '—'}</span> },
      gpsLat: { label: 'GPS Lat.', num: true, sortVal: (s) => s.gpsLat ?? -999, csv: (s) => s.gpsLat ?? '', render: (s) => (s.gpsLat ?? '—') },
      gpsLng: { label: 'GPS Long.', num: true, sortVal: (s) => s.gpsLng ?? -999, csv: (s) => s.gpsLng ?? '', render: (s) => (s.gpsLng ?? '—') },
      activityCategory: { label: "Catégorie d'activité", sortVal: (s) => s.activity || '', csv: (s) => s.activity || '', render: (s) => s.activity || '—' },
      risk: { label: 'Niveau de risque', sortVal: (s) => ({ elevee: 3, moyenne: 2, faible: 1 }[s.riskLevel] || 0), csv: (s) => RISK[s.riskLevel]?.label || s.riskLevel,
        render: (s) => (canEdit
          ? <select className="select" style={{ minWidth: 110 }} value={s.riskLevel || 'moyenne'} onClick={(e) => e.stopPropagation()} onChange={(e) => setSiteRisk(s, e.target.value)} aria-label="Niveau de risque">
              <option value="elevee">Élevé</option><option value="moyenne">Moyen</option><option value="faible">Faible</option></select>
          : <span className="badge" style={{ background: RISK[s.riskLevel]?.bg, color: RISK[s.riskLevel]?.text }}><span className="dot" style={{ background: RISK[s.riskLevel]?.color }} />{RISK[s.riskLevel]?.label || s.riskLevel}</span>) },
      security: { label: 'Situation sécuritaire', sortVal: (s) => s.security || 0, csv: (s) => LABEL02.security[s.security || 0], render: (s) => LABEL02.security[s.security || 0] },
      synergies: { label: 'Synergies de programme', sortVal: (s) => s.synergies || 0, csv: (s) => LABEL01.synergies[s.synergies || 0], render: (s) => LABEL01.synergies[s.synergies || 0] },
      caseload: { label: 'Taille (caseload)', sortVal: (s) => s.beneficiaryOver200 || 0, csv: (s) => LABEL01.caseload[s.beneficiaryOver200 || 0], render: (s) => LABEL01.caseload[s.beneficiaryOver200 || 0] },
      newPartner: { label: 'Nouveau partenaire', sortVal: (s) => s.newPartner || 0, csv: (s) => LABEL01.newPartner[s.newPartner || 0], render: (s) => LABEL01.newPartner[s.newPartner || 0] },
      lastVisit: { label: 'Dernière visite', sortVal: (s) => (s.monthsSinceVisit == null ? 1e9 : s.monthsSinceVisit), csv: (s) => s.lastVisitMonth || '',
        render: (s) => <span className="tabular">{s.lastVisitMonth || '—'}{s.monthsSinceVisit != null && <div className="site-meta">il y a {s.monthsSinceVisit} mois</div>}</span> },
      dataVisit: { label: 'Dernière collecte (données)', sortVal: (s) => s.dataVisitMonth || '', csv: (s) => s.dataVisitMonth || '',
        render: (s) => (s.dataVisitMonth
          ? <span className="tabular">{s.dataVisitMonth}{s.dataVisitCount ? <div className="site-meta">{s.dataVisitCount} soumission{s.dataVisitCount > 1 ? 's' : ''}</div> : null}</span>
          : <span className="muted" title="Aucune soumission réelle rattachée à la commune de ce site (pcode).">—</span>) },
      issuesProcess: { label: 'Problèmes — processus interne', sortVal: (s) => s.issuesProcess || 0, csv: (s) => LABEL02.issues[s.issuesProcess || 0], render: (s) => LABEL02.issues[s.issuesProcess || 0] },
      issuesPartnerReport: { label: 'Problème rapport partenaire', sortVal: (s) => s.issuesPartnerReport || 0, csv: (s) => LABEL02.issues[s.issuesPartnerReport || 0], render: (s) => LABEL02.issues[s.issuesPartnerReport || 0] },
      issuesCFM: { label: 'Problème CFM', sortVal: (s) => s.issuesCFM || 0, csv: (s) => LABEL02.issues[s.issuesCFM || 0], render: (s) => LABEL02.issues[s.issuesCFM || 0] },
      fraud: { label: 'Fraude et corruption', sortVal: (s) => s.fraud || 0, csv: (s) => LABEL01.fraud[s.fraud || 0], render: (s) => LABEL01.fraud[s.fraud || 0] },
      finalScore: { label: 'SCORE FINAL', sortVal: (s) => s.finalScore || 0, csv: (s) => s.finalLabel || '',
        render: (s) => <><span className="badge" style={{ background: SCORE[s.finalScore]?.bg, color: SCORE[s.finalScore]?.text }}>{s.finalLabel || '—'}</span>{s.urgentFlags && <div className="site-meta" style={{ color: 'var(--red)' }}>⚑ urgent</div>}</> },
      interval: { label: 'Intervalle requis (CO)', num: true, sortVal: (s) => s.interval || 0, csv: (s) => s.interval || '', render: (s) => <span className="tabular">{s.interval != null ? `${s.interval} mois` : '—'}</span> },
      due: { label: 'À suivre ce mois', sortVal: (s) => (s.due ? 1 : 0), csv: (s) => (s.due ? 'oui' : 'non'),
        render: (s) => (s.due
          ? <span className="badge" style={{ background: 'var(--blue-50)', color: 'var(--blue-700)' }}><span className="dot" style={{ background: 'var(--blue-600)' }} />À suivre</span>
          : <span className="muted">à jour</span>) },
    };
    return c;
  }, [canEdit]); // eslint-disable-line

  const filters = useMemo(() => ({
    q: { label: 'Recherche', type: 'search', placeholder: 'Site, commune, district…',
      match: (s, v) => [s.name, s.commune, s.adm3, s.district, s.adm2, s.code].some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) },
    office: { label: 'Bureau', type: 'select',
      options: () => [{ id: '', label: 'Tous les bureaux' }, ...offices.map((o) => ({ id: o.id, label: (o.national ? '🏛 ' : (o.parentId ? '— ' : '')) + o.name + (o.national ? ' (pays — tous les sites)' : '') }))],
      match: (s, v) => { const o = officeById.get(v); if (!o) return true; if (o.national) return true; return descendantsOf(v).has(s.fieldOfficeId); } },
    region: { label: 'Région', type: 'select', options: (rows) => [{ id: '', label: 'Toutes les régions' }, ...uniq(rows.map((s) => s.adm1))],
      match: (s, v) => s.adm1 === v },
    district: { label: 'District', type: 'select',
      options: (rows, vals) => [{ id: '', label: 'Tous les districts' }, ...uniq(rows.filter((s) => !vals.region || s.adm1 === vals.region).map((s) => s.adm2))],
      match: (s, v) => s.adm2 === v },
    communes: { label: 'Commune', type: 'select',
      options: (rows, vals) => [{ id: '', label: 'Toutes les communes' }, ...uniq(rows.filter((s) => (!vals.region || s.adm1 === vals.region) && (!vals.district || s.adm2 === vals.district)).map((s) => s.adm3))],
      match: (s, v) => s.adm3 === v },
    risk: { label: 'Niveau de risque', type: 'select',
      options: [{ id: '', label: 'Tous' }, { id: 'elevee', label: 'Élevé' }, { id: 'moyenne', label: 'Moyen' }, { id: 'faible', label: 'Faible' }],
      match: (s, v) => s.riskLevel === v },
    due: { label: 'À suivre', type: 'select', options: [{ id: '', label: 'Tous' }, { id: 'due', label: 'À suivre (non visités / en retard)' }, { id: 'ok', label: 'À jour' }],
      match: (s, v) => (v === 'due' ? !!s.due : !s.due) },
  }), [offices, officeById, descendantsOf]); // eslint-disable-line

  const DEFAULT_COLS = ['subOffice', 'antenne', 'name', 'district', 'communes', 'risk', 'lastVisit', 'dataVisit', 'finalScore', 'due'];

  return (
    <div className="section-gap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Risk-Based Monitoring (RBM)</h1>
          <p className="page-desc">Sélectionnez une ligne (ou <strong>double-clic</strong>) pour éditer ses critères. « Générer » planifie les sites à suivre du mois. La <strong>dernière visite</strong> intègre la <strong>collecte réelle</strong> issue des données uploadées (rattachées par commune).</p>
        </div>
        <div className="header-actions">
          <MonthSelect value={month} onChange={setMonth} />
          {canEdit && <>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImport} />
            <input ref={planRef} type="file" accept=".xlsx,.xlsm" hidden onChange={onImportPlan} />
            <Button variant="secondary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>Master Data</Button>
            <Button variant="secondary" icon={Upload} loading={busy} onClick={() => planRef.current?.click()}
              title="Importe la feuille « Risk-based site selection » : critères, SCORE FINAL, GPS, activité, dernière visite.">Plan de suivi</Button>
            <Button icon={Wand2} loading={busy} onClick={generate}>Générer</Button>
          </>}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Stats compact items={[
        { label: 'Sites référencés', value: sites ? formatInt(stats.total) : '—', foot: 'Référentiel du plan' },
        { label: 'Risque élevé', value: sites ? formatInt(stats.elevee) : '—', foot: RISK.elevee.freq },
        { label: 'Risque moyen', value: sites ? formatInt(stats.moyenne) : '—', foot: RISK.moyenne.freq },
        { label: 'Risque faible', value: sites ? formatInt(stats.faible) : '—', foot: RISK.faible.freq },
        { label: 'À suivre ce mois', value: sites ? formatInt(stats.due) : '—', foot: 'Selon le RBM' },
      ]} />

      <DataList
        rows={sites} columns={columns} defaultColumns={DEFAULT_COLS}
        filters={filters} defaultFilters={['q', 'office', 'risk', 'due']}
        storageKey="mems.rbm.view.v4" pageSize={15} defaultSort={{ key: 'finalScore', dir: 'desc' }}
        csvName={`rbm_${month}.csv`} emptyIcon={MapPin} emptyTitle="Aucun site référencé"
        emptyChildren="Importez le référentiel Master Data (.xlsx) pour alimenter le RBM."
        selectable selectedId={selectedId} onSelect={setSelectedId}
        onRowDoubleClick={canEdit ? (s) => setCrit(s) : undefined}
        toolbar={canEdit ? (sel) => (sel ? <>
          <Button size="sm" variant="secondary" icon={SlidersHorizontal} onClick={() => setCrit(sel)}>Éditer les critères</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>Désélectionner</Button>
        </> : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Sélectionnez un site pour éditer ses critères.</span>) : undefined}
        rowClassName={(s) => (s.due ? 'row-due' : '')}
      />

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

