import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Users, ListChecks, Tags, MapPinned, Upload, Info, Download, Coins, Building2, Trash2, Clock } from 'lucide-react';
import { api } from '../../api/client.js';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, Alert } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr, formatDateTime } from '../../lib/format.js';

const NAV = [
  { id: 'partenaires', label: 'Partenaires', icon: Users },
  { id: 'types', label: 'Types de partenaire', icon: Tags },
  { id: 'activites', label: 'Activités', icon: ListChecks },
  { id: 'taux', label: 'Taux de change', icon: Coins },
  { id: 'localites', label: 'Localités', icon: MapPinned },
  { id: 'bureaux', label: 'Bureaux & antennes', icon: Building2 },
];

const DESCRIPTIONS = {
  partenaires: 'Registre des partenaires (nom + type) servant aux sélections dans Contrats et Partenaires & TPM.',
  activites: 'Activités de suivi disponibles en multi-sélection sur les contrats.',
  types: 'Catégories de partenaire (TPM, prestataire, cabinet…).',
  taux: 'Taux de change de référence (ariary pour 1 USD), horodatés, par mois d\'application — servent à afficher les valeurs en dollars selon la période de saisie.',
  localites: 'Découpage administratif du pays (un fichier par pays) pour les zones d\'intervention.',
  bureaux: 'Bureaux terrain et antennes, et leur périmètre (communes) pour le rattachement automatique des sites.',
};

export default function SettingsPage({ tab = 'partenaires', isAdmin }) {
  const current = NAV.some((n) => n.id === tab) ? tab : 'partenaires';
  const meta = NAV.find((n) => n.id === current);
  return (
    <div className="section-gap">
      <PageHeader title={`Paramétrage — ${meta.label}`} description={DESCRIPTIONS[current]} />
      {current === 'partenaires' && <PartnersSection isAdmin={isAdmin} />}
      {current === 'activites' && <ActivitiesSection isAdmin={isAdmin} />}
      {current === 'types' && <TypesSection isAdmin={isAdmin} />}
      {current === 'taux' && <ExchangeRatesSection isAdmin={isAdmin} />}
      {current === 'localites' && <LocalitesSection isAdmin={isAdmin} />}
      {current === 'bureaux' && <BureauxSection isAdmin={isAdmin} />}
    </div>
  );
}

/* ------------------------------------------------------- Exchange rates -- */

function ExchangeRatesSection({ isAdmin }) {
  const toast = useToast();
  const [rates, setRates] = useState(null);
  const [form, setForm] = useState({ effectiveMonth: new Date().toISOString().slice(0, 7), usdRate: '', note: '' });
  const [saving, setSaving] = useState(false);

  async function reload() { try { setRates(await api.listExchangeRates()); } catch (e) { toast.error(e.message); setRates([]); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function save(e) {
    e.preventDefault();
    if (!(Number(form.usdRate) > 0)) { toast.error('Saisissez un taux (ariary pour 1 USD) supérieur à 0.'); return; }
    setSaving(true);
    try {
      await api.saveExchangeRate({ effectiveMonth: form.effectiveMonth, usdRate: Number(form.usdRate), note: form.note.trim() || undefined });
      toast.success('Taux enregistré.');
      setForm({ effectiveMonth: form.effectiveMonth, usdRate: '', note: '' });
      reload();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  async function remove(r) {
    if (!window.confirm(`Supprimer le taux de ${r.effectiveMonth} ?`)) return;
    try { await api.deleteExchangeRate(r.id); toast.success('Taux supprimé.'); reload(); } catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="rates-title">
      <CardHeader id="rates-title" title="Taux de change (ariary pour 1 USD)" subtitle="Un taux par mois d'application. La valeur USD d'un montant se lit au taux dont le mois est ≤ la période de saisie (le dernier taux connu est reporté)." />
      {isAdmin && (
        <form onSubmit={save} className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          <Field label="Mois d'application" htmlFor="rate-month"><input id="rate-month" className="input" type="month" value={form.effectiveMonth} onChange={(e) => setForm({ ...form, effectiveMonth: e.target.value })} required /></Field>
          <Field label="Taux (Ar pour 1 USD)" htmlFor="rate-usd"><MoneyInput id="rate-usd" value={form.usdRate} onChange={(v) => setForm({ ...form, usdRate: v })} /></Field>
          <Field label="Note (optionnel)" htmlFor="rate-note"><input id="rate-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Source du taux…" /></Field>
          <Button type="submit" icon={Plus} loading={saving}>Enregistrer le taux</Button>
        </form>
      )}
      {rates === null ? <div className="card-body"><Skeleton height={100} /></div> : rates.length === 0 ? (
        <EmptyState icon={Coins} title="Aucun taux de change">Ajoutez un taux de référence pour activer l'affichage des valeurs en dollars.</EmptyState>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Mois d'application</th><th scope="col" className="num">Ar pour 1 USD</th><th scope="col">Note</th><th scope="col">Saisi le (horodatage)</th>{isAdmin && <th scope="col" />}</tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td><strong className="tabular">{r.effectiveMonth}</strong></td>
                <td className="num tabular">{formatAr(r.usdRate)}</td>
                <td>{r.note || <span className="cell-empty">—</span>}</td>
                <td><span className="site-meta" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Clock size={13} aria-hidden="true" />{formatDateTime(r.updatedAt || r.createdAt)}</span></td>
                {isAdmin && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(r)} /></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------- Bureaux (placeholder) -- */

function BureauxSection() {
  return (
    <Card>
      <CardHeader title="Bureaux & antennes" subtitle="Bientôt : bureaux terrain, antennes et périmètre (communes) pour le rattachement automatique des sites par point GPS (adm1–4)." />
      <div className="card-body"><Alert tone="info" icon={Info}>Module en cours de construction : il permettra de créer les bureaux (pays/terrain), de définir leur périmètre par communes (découpage adm.) et de rattacher automatiquement chaque site à son bureau selon ses coordonnées GPS.</Alert></div>
    </Card>
  );
}

/* ------------------------------------------------------------- Partners -- */

function PartnersSection({ isAdmin }) {
  const toast = useToast();
  const [partners, setPartners] = useState(null);
  const [types, setTypes] = useState([]);
  const [modal, setModal] = useState(null); // {mode:'create'|'agent', partner?}

  async function reload() {
    try { setPartners(await api.listPartners()); } catch (e) { toast.error(e.message); setPartners([]); }
  }
  useEffect(() => { reload(); api.listPartnerTypes().then(setTypes).catch(() => {}); /* eslint-disable-next-line */ }, []);

  const grouped = useMemo(() => {
    const g = {};
    for (const p of partners || []) (g[p.typeLabel] ||= []).push(p);
    return g;
  }, [partners]);

  return (
    <Card aria-labelledby="partners-title">
      <CardHeader id="partners-title" title="Partenaires" subtitle="Liste des partenaires (mise en œuvre, prestataires, cabinets, TPM) servant aux sélections. Les agents de terrain des TPM se saisissent dans Partenaires & TPM › Prestataires TPM.">
        {isAdmin && <Button icon={Plus} onClick={() => setModal({ mode: 'create' })}>Nouveau partenaire</Button>}
      </CardHeader>
      {partners === null ? (
        <div className="card-body"><Skeleton height={120} /></div>
      ) : partners.length === 0 ? (
        <EmptyState icon={Users} title="Aucun partenaire" action={isAdmin && <Button icon={Plus} onClick={() => setModal({ mode: 'create' })}>Nouveau partenaire</Button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Partenaire</th><th scope="col">Type</th><th scope="col">Agents (TPM)</th></tr></thead>
            {Object.entries(grouped).map(([typeLabel, list]) => (
              <tbody key={typeLabel}>
                <tr className="subrow-head"><td colSpan={3}>{typeLabel} · {list.length}</td></tr>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td><span className="agent"><Avatar name={p.name} /><strong>{p.name}</strong></span></td>
                    <td><Badge tone={p.typeCode === 'tpm' ? 'blue' : null}>{p.typeLabel}</Badge></td>
                    <td>
                      {p.typeCode === 'tpm'
                        ? <span>{p.agents.length} agent{p.agents.length > 1 ? 's' : ''}{p.agents.length ? ` · ${p.agents.map((a) => a.name).join(', ')}` : ''}</span>
                        : <span className="cell-empty">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {modal?.mode === 'create' && <PartnerModal types={types} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </Card>
  );
}

function PartnerModal({ types, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', partnerTypeId: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = { name: form.name.trim().length < 2 ? 'Nom requis.' : null, partnerTypeId: !form.partnerTypeId ? 'Choisissez un type.' : null };

  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.name || errs.partnerTypeId) return;
    setSaving(true);
    try {
      await api.createPartner({ name: form.name.trim(), partnerTypeId: form.partnerTypeId });
      toast.success(`Partenaire ${form.name.trim()} créé.`);
      onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title="Nouveau partenaire" subtitle="Ajouté au référentiel, utilisable dans les contrats et le suivi tiers." initialFocus="#pt-name"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button type="submit" form="partner-form" loading={saving}>Créer</Button></>}>
      <form id="partner-form" onSubmit={save} noValidate style={{ display: 'grid', gap: 16 }}>
        <Field label="Nom" htmlFor="pt-name" required error={touched ? errs.name : undefined}>
          <input id="pt-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. ASSOCIATION AINA" />
        </Field>
        <Field label="Type de partenaire" htmlFor="pt-type" required hint="Configuré dans « Types de partenaire »." error={touched ? errs.partnerTypeId : undefined}>
          <select id="pt-type" className={`select ${form.partnerTypeId ? '' : 'is-empty'}`} value={form.partnerTypeId} onChange={(e) => setForm({ ...form, partnerTypeId: e.target.value })}>
            <option value="">Choisir un type…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function AgentModal({ partner, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setSaving(true);
    try { await api.createPartnerAgent(partner.id, { name: name.trim() }); toast.success(`Agent ajouté à ${partner.name}.`); onSaved(); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={`Nouvel agent — ${partner.name}`} initialFocus="#ag-name"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button type="submit" form="agent-form" loading={saving}>Ajouter</Button></>}>
      <form id="agent-form" onSubmit={save}>
        <Field label="Nom de l'agent" htmlFor="ag-name" required><input id="ag-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------- Activities -- */

function ActivitiesSection({ isAdmin }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(false);

  async function reload() { try { setItems(await api.listActivities()); } catch (e) { toast.error(e.message); setItems([]); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function toggle(a) {
    try { await api.setActivityActive(a.id, !a.active); reload(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="act-title">
      <CardHeader id="act-title" title="Activités de suivi" subtitle="Multi-sélection sur les contrats. Ex. suivi, ciblage, PDM, distribution, évaluation.">
        {isAdmin && <Button icon={Plus} onClick={() => setModal(true)}>Nouvelle activité</Button>}
      </CardHeader>
      {items === null ? <div className="card-body"><Skeleton height={100} /></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Activité</th><th scope="col">Code</th><th scope="col">État</th>{isAdmin && <th scope="col" />}</tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.label}</strong></td>
                  <td><span className="mono">{a.code}</span></td>
                  <td><Badge tone={a.active ? 'green' : null}>{a.active ? 'Active' : 'Inactive'}</Badge></td>
                  {isAdmin && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" onClick={() => toggle(a)}>{a.active ? 'Désactiver' : 'Activer'}</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <CodeLabelModal title="Nouvelle activité" onClose={() => setModal(false)} onSubmit={(v) => api.createActivity(v)} onSaved={() => { setModal(false); reload(); }} />}
    </Card>
  );
}

/* ---------------------------------------------------------------- Types -- */

function TypesSection({ isAdmin }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(false);
  async function reload() { try { setItems(await api.listPartnerTypes()); } catch (e) { toast.error(e.message); setItems([]); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  return (
    <Card aria-labelledby="types-title">
      <CardHeader id="types-title" title="Types de partenaire" subtitle="Catégorisation des partenaires. Ex. TPM, prestataire, cabinet.">
        {isAdmin && <Button icon={Plus} onClick={() => setModal(true)}>Nouveau type</Button>}
      </CardHeader>
      {items === null ? <div className="card-body"><Skeleton height={100} /></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Type</th><th scope="col">Code</th><th scope="col" className="num">Partenaires</th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.label}</strong></td>
                  <td><span className="mono">{t.code}</span></td>
                  <td className="num">{t.partnerCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <CodeLabelModal title="Nouveau type de partenaire" onClose={() => setModal(false)} onSubmit={(v) => api.createPartnerType(v)} onSaved={() => { setModal(false); reload(); }} />}
    </Card>
  );
}

/* ------------------------------------------------------------- Localités -- */

function LocalitesSection({ isAdmin }) {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [levels, setLevels] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function reload() {
    try {
      const [s, lv] = await Promise.all([api.adminBreakdownSummary(), api.listAdminLevels()]);
      setSummary(s); setLevels(lv);
    } catch (e) { toast.error(e.message); setSummary([]); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.importAdminBreakdown(file);
      toast.success(`Découpage importé : ${res.levels} niveau(x), ${res.areas} localité(s).`);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  function downloadTemplate() {
    const csv = 'Region;District;Commune;Fokontany\nAndroy;Bekily;Bekily;Bekily Centre\nAndroy;Bekily;Beraketa;Beraketa\nAnosy;Amboasary Sud;Amboasary;Amboasary I\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'modele_decoupage_adm.csv'; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }

  const total = (summary || []).reduce((n, r) => n + r.count, 0);

  return (
    <Card aria-labelledby="loc-title">
      <CardHeader id="loc-title" title="Localités — découpage administratif" subtitle="Référentiel géographique du pays (un fichier par pays / tenant). Alimente les listes déroulantes en cascade des zones d'intervention des contrats.">
        {isAdmin && (
          <>
            <input ref={fileRef} type="file" accept=".csv,.txt,.dbf,.zip" style={{ display: 'none' }} onChange={onFile} />
            <Button variant="secondary" icon={Download} onClick={downloadTemplate}>Modèle CSV</Button>
            <Button icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>Importer un fichier</Button>
          </>
        )}
      </CardHeader>
      <div className="card-body" style={{ display: 'grid', gap: 16 }}>
        <Alert tone="info" icon={Info}>
          Convention <strong>adm1–adm4</strong> (comme MEMS) : Région (adm1) › District (adm2) › Commune (adm3) › Fokontany (adm4).
          Formats acceptés : <strong>.csv</strong> (1ʳᵉ ligne = libellés des niveaux, une colonne par niveau),
          <strong> .dbf</strong> ou <strong>.zip</strong> (shapefile — la table attributaire .dbf est lue ; les colonnes
          ADM1–ADM4 / Région / District / Commune / Fokontany sont détectées automatiquement).
          L'import <strong>remplace</strong> le découpage du pays actif et gère l'échelle nationale (≈ 18 000 fokontany).
          Utilisez « Modèle CSV » pour préparer un fichier conforme.
        </Alert>
        {summary === null ? <Skeleton height={80} /> : total === 0 ? (
          <EmptyState icon={MapPinned} title="Aucun découpage importé">
            Importez un shapefile/.dbf (ou un .csv) pour activer les listes déroulantes de zones.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Niveau</th><th scope="col">Libellé</th><th scope="col" className="num">Localités</th></tr></thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.depth}><td>{r.depth}</td><td><strong>{r.label}</strong></td><td className="num">{r.count}</td></tr>
                ))}
                <tr><td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td className="num"><strong>{total}</strong></td></tr>
              </tbody>
            </table>
          </div>
        )}
        {levels.length > 0 && <p className="field-hint">Hiérarchie : {levels.map((l) => l.label).join(' → ')}.</p>}
      </div>
    </Card>
  );
}

function CodeLabelModal({ title, onClose, onSubmit, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ code: '', label: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = {
    label: form.label.trim().length < 2 ? 'Libellé requis.' : null,
    code: !/^[a-z0-9_-]{2,40}$/i.test(form.code.trim()) ? 'Code : lettres/chiffres/tiret, 2 à 40.' : null,
  };
  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.label || errs.code) return;
    setSaving(true);
    try { await onSubmit({ code: form.code.trim(), label: form.label.trim() }); toast.success('Enregistré.'); onSaved(); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={title} initialFocus="#cl-label"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button type="submit" form="cl-form" loading={saving}>Créer</Button></>}>
      <form id="cl-form" onSubmit={save} noValidate style={{ display: 'grid', gap: 16 }}>
        <Field label="Libellé" htmlFor="cl-label" required error={touched ? errs.label : undefined}>
          <input id="cl-label" className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <Field label="Code" htmlFor="cl-code" required hint="Identifiant court, sans espace (ex. pdm)." error={touched ? errs.code : undefined}>
          <input id="cl-code" className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}
