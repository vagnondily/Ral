import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Users, ListChecks, Tags, MapPinned, Upload, Info, Download, Coins, Building2, Trash2, Clock, Pencil, ShieldCheck, ChevronRight, Lock } from 'lucide-react';
import { api } from '../../api/client.js';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, Alert } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr, formatInt, formatDateTime } from '../../lib/format.js';

// Catalogue des rubriques de paramétrage, groupées (façon « Tools » : cartes
// explicites). `admin` = réservé aux administrateurs.
const SECTIONS = {
  partenaires: { label: 'Partenaires', icon: Users, group: 'Référentiels', desc: 'Registre des partenaires (nom + type) servant aux sélections dans Contrats et Partenaires & TPM.' },
  types: { label: 'Types de partenaire', icon: Tags, group: 'Référentiels', desc: 'Catégories de partenaire (TPM, prestataire, cabinet…).' },
  activites: { label: 'Activités', icon: ListChecks, group: 'Référentiels', desc: 'Activités de suivi disponibles en multi-sélection sur les contrats.' },
  taux: { label: 'Taux de change', icon: Coins, group: 'Finances', desc: 'Taux de référence (ariary pour 1 USD), horodatés, pour afficher les valeurs en dollars selon la période.' },
  localites: { label: 'Localités', icon: MapPinned, group: 'Géographie', desc: 'Découpage administratif du pays (régions → districts → communes) pour les zones d\'intervention.' },
  bureaux: { label: 'Bureaux & antennes', icon: Building2, group: 'Géographie', desc: 'Bureaux terrain et antennes, et leur périmètre (communes) pour le rattachement automatique des sites.' },
  utilisateurs: { label: 'Utilisateurs & accès', icon: ShieldCheck, group: 'Sécurité', admin: true, desc: 'Comptes, rôles (administrateur / validateur / lecteur) et activation. Qui peut faire quoi dans l\'application.' },
};
const GROUPS = ['Référentiels', 'Finances', 'Géographie', 'Sécurité'];

export default function SettingsPage({ tab = 'apercu', isAdmin, onNavigate }) {
  const current = SECTIONS[tab] ? tab : 'apercu';
  if (current === 'apercu') {
    return (
      <div className="section-gap">
        <PageHeader title="Paramétrage" description="Centre de configuration : référentiels, finances, géographie et sécurité. Choisissez une rubrique." />
        <SettingsOverview isAdmin={isAdmin} onNavigate={onNavigate} />
      </div>
    );
  }
  const meta = SECTIONS[current];
  return (
    <div className="section-gap">
      <PageHeader title={`Paramétrage — ${meta.label}`} description={meta.desc}>
        {onNavigate && <Button variant="ghost" size="sm" onClick={() => onNavigate('parametrage', 'apercu')}>← Toutes les rubriques</Button>}
      </PageHeader>
      {meta.admin && !isAdmin ? (
        <Card><EmptyState icon={Lock} title="Accès réservé">Cette rubrique est réservée aux administrateurs.</EmptyState></Card>
      ) : (
        <>
          {current === 'partenaires' && <PartnersSection isAdmin={isAdmin} />}
          {current === 'activites' && <ActivitiesSection isAdmin={isAdmin} />}
          {current === 'types' && <TypesSection isAdmin={isAdmin} />}
          {current === 'taux' && <ExchangeRatesSection isAdmin={isAdmin} />}
          {current === 'localites' && <LocalitesSection isAdmin={isAdmin} />}
          {current === 'bureaux' && <BureauxSection isAdmin={isAdmin} />}
          {current === 'utilisateurs' && <UsersSection isAdmin={isAdmin} />}
        </>
      )}
    </div>
  );
}

function SettingsOverview({ isAdmin, onNavigate }) {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {GROUPS.map((g) => {
        const items = Object.entries(SECTIONS).filter(([, s]) => s.group === g);
        return (
          <div key={g}>
            <div className="nav-group-label" style={{ padding: '0 2px 8px' }}>{g}</div>
            <div className="set-cards">
              {items.map(([id, s]) => {
                const Icon = s.icon;
                const locked = s.admin && !isAdmin;
                return (
                  <button key={id} type="button" className="set-card" disabled={locked}
                    onClick={() => !locked && onNavigate && onNavigate('parametrage', id)}
                    title={locked ? 'Réservé aux administrateurs' : s.label}>
                    <span className="set-card-ic"><Icon size={20} aria-hidden="true" /></span>
                    <span className="set-card-body">
                      <span className="set-card-title">{s.label}{locked && <Lock size={13} aria-hidden="true" style={{ marginLeft: 6, verticalAlign: '-1px', color: 'var(--text-faint)' }} />}</span>
                      <span className="set-card-desc">{s.desc}</span>
                    </span>
                    <ChevronRight size={16} className="set-card-arrow" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- Users & accès --- */

const ROLE_LABEL = { admin: 'Administrateur', manager: 'Validateur', viewer: 'Lecteur' };
const ROLE_TONE = { admin: 'blue', manager: 'green', viewer: null };

function UsersSection() {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [modal, setModal] = useState(null); // {user?} | null

  async function reload() { try { setUsers(await api.listUsers()); } catch (e) { toast.error(e.message); setUsers([]); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function toggleActive(u) {
    try { await api.updateUser(u.id, { active: !u.active }); reload(); }
    catch (e) { toast.error(e.message); }
  }
  async function remove(u) {
    if (!window.confirm(`Supprimer le compte « ${u.email} » ? Cette action est définitive.`)) return;
    try { await api.deleteUser(u.id); toast.success('Compte supprimé.'); reload(); } catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="users-title">
      <CardHeader id="users-title" title="Utilisateurs & accès"
        subtitle="Comptes et rôles. Administrateur : tout gère. Validateur : valide contrats/rapports. Lecteur : consultation seule. Un compte désactivé ne peut plus se connecter.">
        <Button icon={Plus} onClick={() => setModal({})}>Nouvel utilisateur</Button>
      </CardHeader>
      {users === null ? <div className="card-body"><Skeleton height={120} /></div> : users.length === 0 ? (
        <EmptyState icon={Users} title="Aucun compte" action={<Button icon={Plus} onClick={() => setModal({})}>Nouvel utilisateur</Button>} />
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Utilisateur</th><th scope="col">Rôle</th><th scope="col">Statut</th><th scope="col">Dernière modif.</th><th scope="col" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.fullName || u.email}</strong><div className="site-meta">{u.email}</div></td>
                <td><Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role] || u.role}</Badge></td>
                <td>
                  <button type="button" className="switch-row" onClick={() => toggleActive(u)} title={u.active ? 'Désactiver' : 'Activer'}>
                    <Badge tone={u.active ? 'green' : null} dot>{u.active ? 'Actif' : 'Désactivé'}</Badge>
                  </button>
                </td>
                <td className="tabular"><span className="site-meta">{u.updatedAt ? formatDateTime(u.updatedAt) : '—'}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button size="sm" variant="ghost" icon={Pencil} aria-label="Éditer" onClick={() => setModal({ user: u })} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(u)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal && <UserModal user={modal.user} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </Card>
  );
}

function UserModal({ user, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(user);
  const [form, setForm] = useState({ email: user?.email || '', fullName: user?.fullName || '', role: user?.role || 'viewer', password: '', active: user?.active ?? true });
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!editing && !/.+@.+\..+/.test(form.email)) { toast.error('E-mail invalide.'); return; }
    if (!editing && form.password.length < 10) { toast.error('Mot de passe : au moins 10 caractères.'); return; }
    if (editing && form.password && form.password.length < 10) { toast.error('Mot de passe : au moins 10 caractères.'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.updateUser(user.id, { fullName: form.fullName.trim() || undefined, role: form.role, active: form.active, password: form.password || undefined });
      } else {
        await api.createUser({ email: form.email.trim(), fullName: form.fullName.trim() || undefined, role: form.role, password: form.password });
      }
      toast.success('Compte enregistré.'); onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open title={editing ? 'Modifier le compte' : 'Nouvel utilisateur'} subtitle={editing ? user.email : 'Créer un compte et définir son rôle.'} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button type="submit" form="user-form" loading={saving}>Enregistrer</Button></>}>
      <form id="user-form" onSubmit={save} style={{ display: 'grid', gap: 14 }}>
        {!editing && <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="prenom.nom@mems.mg" autoFocus /></Field>}
        <Field label="Nom complet (optionnel)"><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Rôle" hint="Administrateur : gère tout (y compris les comptes). Validateur : valide. Lecteur : consultation.">
          <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="admin">Administrateur</option><option value="manager">Validateur</option><option value="viewer">Lecteur</option>
          </select>
        </Field>
        <Field label={editing ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'} hint="Au moins 10 caractères.">
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        {editing && <label className="filter-check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /><span>Compte actif (peut se connecter)</span></label>}
      </form>
    </Modal>
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

/* ------------------------------------------------------- Bureaux & antennes -- */

function BureauxSection({ isAdmin }) {
  const toast = useToast();
  const [offices, setOffices] = useState(null);
  const [communes, setCommunes] = useState([]);
  const [modal, setModal] = useState(null); // {office?} | null

  async function reload() { try { setOffices(await api.listOffices()); } catch (e) { toast.error(e.message); setOffices([]); } }
  useEffect(() => { reload(); api.officeCommunes().then(setCommunes).catch(() => setCommunes([])); /* eslint-disable-next-line */ }, []);

  async function remove(o) {
    if (!window.confirm(`Supprimer le bureau « ${o.name} » ?`)) return;
    try { await api.deleteOffice(o.id); toast.success('Bureau supprimé.'); reload(); } catch (e) { toast.error(e.message); }
  }

  const nationalCount = (offices || []).filter((o) => o.national).length;
  return (
    <Card aria-labelledby="off-title">
      <CardHeader id="off-title" title="Bureaux & antennes"
        subtitle="Bureau pays (périmètre national) ou bureau terrain / antenne avec un périmètre de communes. Les sites sont rattachés automatiquement selon leur commune.">
        {isAdmin && <Button icon={Plus} onClick={() => setModal({})}>Ajouter un bureau</Button>}
      </CardHeader>
      {offices === null ? <div className="card-body"><Skeleton height={120} /></div> : offices.length === 0 ? (
        <EmptyState icon={Building2} title="Aucun bureau" action={isAdmin && <Button icon={Plus} onClick={() => setModal({})}>Ajouter un bureau</Button>}>
          Créez vos bureaux terrain et antennes, puis définissez leur périmètre de communes pour rattacher les sites.
        </EmptyState>
      ) : (
        <>
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <span className="hint">{offices.length} bureau(x) · {offices.filter((o) => o.active).length} actifs · {nationalCount} à périmètre national</span>
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">Bureau</th><th scope="col">Code</th><th scope="col">Nature</th><th scope="col">Périmètre</th>
              <th scope="col" className="num">Sites</th><th scope="col">Statut</th>{isAdmin && <th scope="col" />}
            </tr></thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong>{o.parentName && <div className="site-meta">antenne de {o.parentName}</div>}{o.responsible && <div className="site-meta">{o.responsible}</div>}</td>
                  <td><span className="mono">{o.code}</span></td>
                  <td><Badge tone={o.nature === 'pays' ? 'blue' : null}>{o.nature === 'pays' ? 'bureau pays' : 'terrain'}</Badge></td>
                  <td>{o.national ? <Badge tone="green">national — tous les sites</Badge> : <span className="tag">{o.communeCount} commune(s)</span>}</td>
                  <td className="num tabular">{formatInt(o.siteCount)}</td>
                  <td><Badge tone={o.active ? 'green' : null} dot>{o.active ? 'Actif' : 'Inactif'}</Badge></td>
                  {isAdmin && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label="Éditer" onClick={() => setModal({ office: o })} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(o)} />
                  </td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
      {modal && <OfficeModal office={modal.office} offices={offices || []} communes={communes} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </Card>
  );
}

function OfficeModal({ office, offices, communes, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(office);
  const [form, setForm] = useState({
    code: office?.code || '', name: office?.name || '', nature: office?.nature || 'terrain',
    parentId: office?.parentId || '', responsible: office?.responsible || '',
    national: office?.national || false, active: office?.active ?? true,
  });
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) api.officePerimeter(office.id).then((rows) => setPicked(new Set(rows.map((r) => r.commune)))).catch(() => {});
  }, [editing, office]);

  const key = (c) => c.commune;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return communes.filter((c) => !s || c.commune.toLowerCase().includes(s) || (c.district || '').toLowerCase().includes(s)).slice(0, 400);
  }, [communes, q]);

  function toggle(c) { setPicked((prev) => { const n = new Set(prev); if (n.has(key(c))) n.delete(key(c)); else n.add(key(c)); return n; }); }

  async function save(e) {
    e.preventDefault();
    if (!form.code.trim() || form.name.trim().length < 2) { toast.error('Code et nom (≥ 2 caractères) requis.'); return; }
    setSaving(true);
    const chosen = communes.filter((c) => picked.has(key(c))).map((c) => ({ district: c.district || undefined, commune: c.commune }));
    const payload = {
      code: form.code.trim(), name: form.name.trim(), nature: form.nature,
      parentId: form.parentId || undefined, responsible: form.responsible.trim() || undefined,
      national: form.national, active: form.active, communes: form.national ? [] : chosen,
    };
    try {
      if (editing) await api.updateOffice(office.id, payload); else await api.createOffice(payload);
      toast.success('Bureau enregistré.'); onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open size="lg" title={editing ? 'Modifier le bureau' : 'Nouveau bureau'} subtitle="Bureau pays (national) ou terrain / antenne avec périmètre de communes." onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button type="submit" form="office-form" loading={saving}>Enregistrer</Button></>}>
      <form id="office-form" onSubmit={save} style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label="Code"><input className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="1" /></Field>
          <Field label="Nom du bureau"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Toliara" /></Field>
          <Field label="Nature">
            <select className="select" value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })}>
              <option value="terrain">Bureau terrain</option><option value="pays">Bureau pays</option>
            </select>
          </Field>
          <Field label="Antenne de (optionnel)">
            <select className="select" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— Bureau principal —</option>
              {offices.filter((o) => !office || o.id !== office.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Responsable (optionnel)"><input className="input" value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label className="filter-check"><input type="checkbox" checked={form.national} onChange={(e) => setForm({ ...form, national: e.target.checked })} /><span>Périmètre national (tous les sites)</span></label>
          <label className="filter-check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /><span>Actif</span></label>
        </div>

        {!form.national && (
          <div className="field">
            <span className="field-label">Périmètre — communes ({picked.size} sélectionnée(s))</span>
            <input className="input" placeholder="Filtrer les communes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
            {communes.length === 0 ? <p className="muted">Aucune commune dans le registre de sites. Importez des sites (Master Data / planning) d'abord.</p> : (
              <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                {filtered.map((c) => (
                  <label key={`${c.district}|${c.commune}`} className="filter-pick" style={{ padding: '6px 10px' }}>
                    <input type="checkbox" checked={picked.has(key(c))} onChange={() => toggle(c)} />
                    <span>{c.commune}{c.district ? <span className="site-meta"> · {c.district}</span> : null}</span>
                  </label>
                ))}
                {filtered.length === 0 && <p className="muted" style={{ padding: 10 }}>Aucune commune ne correspond.</p>}
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
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
