import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Users, ListChecks, Tags, MapPinned, Coins, Building2, Trash2, Clock, Pencil, ShieldCheck, ChevronRight, Lock, Gauge, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import MmrSection from './MmrSection.jsx';
import LocalitiesSection from './LocalitiesSection.jsx';
import { formatAr, formatInt, formatDateTime } from '../../lib/format.js';
import { OFFICE_LEVELS, levelLabel, levelIsNational } from '../../lib/officeLevels.js';
import { useI18n } from '../../lib/i18n.jsx';
import { roleOf } from '../../lib/roles.js';
import RoleBadge from '../../components/RoleBadge.jsx';

// Catalogue des rubriques de paramétrage, groupées (façon « Tools » : cartes
// explicites). `admin` = réservé aux administrateurs.
const SECTIONS = {
  partenaires: { label: 'Partenaires', icon: Users, group: 'Référentiels', desc: 'Registre des partenaires (nom + type) servant aux sélections dans Contrats et Partenaires & TPM.' },
  types: { label: 'Types de partenaire', icon: Tags, group: 'Référentiels', desc: 'Catégories de partenaire (partenaire de mise en œuvre, TPM, cabinet…).' },
  activites: { label: 'Activités', icon: ListChecks, group: 'Référentiels', desc: 'Activités de suivi disponibles en multi-sélection sur les contrats.' },
  taux: { label: 'Taux de change', icon: Coins, group: 'Finances', desc: 'Taux de référence (ariary pour 1 USD), horodatés, pour afficher les valeurs en dollars selon la période.' },
  localites: { label: 'Localités', icon: MapPinned, group: 'Géographie', desc: 'Découpage administratif du pays (régions → districts → communes), registre des sites (identifiant, Code POI, bureau, activité, GPS, dernière collecte) et rapprochement des lieux des formulaires reçus.' },
  bureaux: { label: 'Bureaux & antennes', icon: Building2, group: 'Géographie', desc: 'Bureaux terrain et antennes, et leur périmètre (communes) pour le rattachement automatique des sites.' },
  mmr: { label: 'Paramètres MMR', icon: Gauge, group: 'Suivi', admin: true, desc: 'Exigences minimales de suivi (MMR) par bureau × activité : durée, nombre de sites, niveau de risque → intervalle, fréquence et nombre de sites ciblés par mois (base du RBM).' },
  utilisateurs: { label: 'Utilisateurs & accès', icon: ShieldCheck, group: 'Sécurité', admin: true, desc: 'Comptes, rôles (administrateur / validateur / lecteur) et activation. Qui peut faire quoi dans l\'application.' },
  suppressions: { label: 'Journal des suppressions', icon: Trash2, group: 'Sécurité', admin: true, desc: 'Traçabilité des documents supprimés (rapports, factures, plans, contrats) : qui, quand, pourquoi, et un résumé du document.' },
};
const GROUPS = ['Référentiels', 'Finances', 'Géographie', 'Suivi', 'Sécurité'];

const normCommune = (s) => String(s || '').trim().toLowerCase();

export default function SettingsPage({ tab = 'apercu', sub = null, isAdmin, onNavigate }) {
  const { tr } = useI18n();
  const current = SECTIONS[tab] ? tab : 'apercu';
  if (current === 'apercu') {
    return (
      <div className="section-gap">
        <PageHeader title={tr('Paramétrage')} description={tr('Centre de configuration : référentiels, finances, géographie et sécurité. Choisissez une rubrique.')} />
        <SettingsOverview isAdmin={isAdmin} onNavigate={onNavigate} />
      </div>
    );
  }
  const meta = SECTIONS[current];
  return (
    <div className="section-gap">
      <PageHeader title={tr('Paramétrage — {label}', { label: tr(meta.label) })} description={tr(meta.desc)}>
        {onNavigate && <Button variant="ghost" size="sm" onClick={() => onNavigate('parametrage', 'apercu')}>{tr('← Toutes les rubriques')}</Button>}
      </PageHeader>
      {meta.admin && !isAdmin ? (
        <Card><EmptyState icon={Lock} title={tr('Accès réservé')}>{tr('Cette rubrique est réservée aux administrateurs.')}</EmptyState></Card>
      ) : (
        <>
          {current === 'partenaires' && <PartnersSection isAdmin={isAdmin} onNavigate={onNavigate} />}
          {current === 'activites' && <ActivitiesSection isAdmin={isAdmin} />}
          {current === 'types' && <TypesSection isAdmin={isAdmin} />}
          {current === 'taux' && <ExchangeRatesSection isAdmin={isAdmin} />}
          {current === 'localites' && <LocalitiesSection isAdmin={isAdmin} initialTab={sub} />}
          {current === 'bureaux' && <BureauxSection isAdmin={isAdmin} />}
          {current === 'mmr' && <MmrSection isAdmin={isAdmin} />}
          {current === 'utilisateurs' && <UsersSection isAdmin={isAdmin} />}
          {current === 'suppressions' && <DeletionsSection isAdmin={isAdmin} />}
        </>
      )}
    </div>
  );
}

function SettingsOverview({ isAdmin, onNavigate }) {
  const { tr } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {GROUPS.map((g) => {
        const items = Object.entries(SECTIONS).filter(([, s]) => s.group === g);
        return (
          <div key={g}>
            <div className="nav-group-label" style={{ padding: '0 2px 8px' }}>{tr(g)}</div>
            <div className="set-cards">
              {items.map(([id, s]) => {
                const Icon = s.icon;
                const locked = s.admin && !isAdmin;
                return (
                  <button key={id} type="button" className="set-card" disabled={locked}
                    onClick={() => !locked && onNavigate && onNavigate('parametrage', id)}
                    title={locked ? tr('Réservé aux administrateurs') : tr(s.label)}>
                    <span className="set-card-ic"><Icon size={20} aria-hidden="true" /></span>
                    <span className="set-card-body">
                      <span className="set-card-title">{tr(s.label)}{locked && <Lock size={13} aria-hidden="true" style={{ marginLeft: 6, verticalAlign: '-1px', color: 'var(--text-faint)' }} />}</span>
                      <span className="set-card-desc">{tr(s.desc)}</span>
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
  const { tr } = useI18n();
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
    if (!window.confirm(tr('Supprimer le compte « {email} » ? Cette action est définitive.', { email: u.email }))) return;
    try { await api.deleteUser(u.id); toast.success(tr('Compte supprimé.')); reload(); } catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="users-title">
      <CardHeader id="users-title" title={tr('Utilisateurs & accès')}
        subtitle={tr('Comptes et rôles. Administrateur : tout gère. Validateur : valide contrats/rapports. Lecteur : consultation seule. Un compte désactivé ne peut plus se connecter.')}>
        <Button icon={Plus} onClick={() => setModal({})}>{tr('Nouvel utilisateur')}</Button>
      </CardHeader>
      {users === null ? <div className="card-body"><Skeleton height={120} /></div> : users.length === 0 ? (
        <EmptyState icon={Users} title={tr('Aucun compte')} action={<Button icon={Plus} onClick={() => setModal({})}>{tr('Nouvel utilisateur')}</Button>} />
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">{tr('Utilisateur')}</th><th scope="col">{tr('Rôle')}</th><th scope="col">{tr('Statut')}</th><th scope="col">{tr('Dernière modif.')}</th><th scope="col" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.fullName || u.email}</strong><div className="site-meta">{u.email}</div></td>
                <td><Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role] ? tr(ROLE_LABEL[u.role]) : u.role}</Badge></td>
                <td>
                  <button type="button" className="switch-row" onClick={() => toggleActive(u)} title={u.active ? tr('Désactiver') : tr('Activer')}>
                    <Badge tone={u.active ? 'green' : null} dot>{u.active ? tr('Actif') : tr('Désactivé')}</Badge>
                  </button>
                </td>
                <td className="tabular"><span className="site-meta">{u.updatedAt ? formatDateTime(u.updatedAt) : '—'}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button size="sm" variant="ghost" icon={Pencil} aria-label={tr('Éditer')} onClick={() => setModal({ user: u })} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => remove(u)} />
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
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(user);
  const [form, setForm] = useState({ email: user?.email || '', fullName: user?.fullName || '', role: user?.role || 'viewer', password: '', active: user?.active ?? true });
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!editing && !/.+@.+\..+/.test(form.email)) { toast.error(tr('E-mail invalide.')); return; }
    if (!editing && form.password.length < 10) { toast.error(tr('Mot de passe : au moins 10 caractères.')); return; }
    if (editing && form.password && form.password.length < 10) { toast.error(tr('Mot de passe : au moins 10 caractères.')); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.updateUser(user.id, { fullName: form.fullName.trim() || undefined, role: form.role, active: form.active, password: form.password || undefined });
      } else {
        await api.createUser({ email: form.email.trim(), fullName: form.fullName.trim() || undefined, role: form.role, password: form.password });
      }
      toast.success(tr('Compte enregistré.')); onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open title={editing ? tr('Modifier le compte') : tr('Nouvel utilisateur')} subtitle={editing ? user.email : tr('Créer un compte et définir son rôle.')} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="user-form" loading={saving}>{tr('Enregistrer')}</Button></>}>
      <form id="user-form" onSubmit={save} style={{ display: 'grid', gap: 14 }}>
        {!editing && <Field label={tr('E-mail')}><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={tr('prenom.nom@mems.mg')} autoFocus /></Field>}
        <Field label={tr('Nom complet (optionnel)')}><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label={tr('Rôle')} hint={tr('Administrateur : gère tout (y compris les comptes). Validateur : valide. Lecteur : consultation.')}>
          <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="admin">{tr('Administrateur')}</option><option value="manager">{tr('Validateur')}</option><option value="viewer">{tr('Lecteur')}</option>
          </select>
        </Field>
        <Field label={editing ? tr('Nouveau mot de passe (laisser vide pour ne pas changer)') : tr('Mot de passe')} hint={tr('Au moins 10 caractères.')}>
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        {editing && <label className="filter-check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /><span>{tr('Compte actif (peut se connecter)')}</span></label>}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------- Exchange rates -- */

function ExchangeRatesSection({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rates, setRates] = useState(null);
  const [form, setForm] = useState({ effectiveMonth: new Date().toISOString().slice(0, 7), usdRate: '', note: '' });
  const [saving, setSaving] = useState(false);

  async function reload() { try { setRates(await api.listExchangeRates()); } catch (e) { toast.error(e.message); setRates([]); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function save(e) {
    e.preventDefault();
    if (!(Number(form.usdRate) > 0)) { toast.error(tr('Saisissez un taux (ariary pour 1 USD) supérieur à 0.')); return; }
    setSaving(true);
    try {
      await api.saveExchangeRate({ effectiveMonth: form.effectiveMonth, usdRate: Number(form.usdRate), note: form.note.trim() || undefined });
      toast.success(tr('Taux enregistré.'));
      setForm({ effectiveMonth: form.effectiveMonth, usdRate: '', note: '' });
      reload();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  async function remove(r) {
    if (!window.confirm(tr('Supprimer le taux de {month} ?', { month: r.effectiveMonth }))) return;
    try { await api.deleteExchangeRate(r.id); toast.success(tr('Taux supprimé.')); reload(); } catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="rates-title">
      <CardHeader id="rates-title" title={tr('Taux de change (ariary pour 1 USD)')} subtitle={tr('Un taux par mois d\'application. La valeur USD d\'un montant se lit au taux dont le mois est ≤ la période de saisie (le dernier taux connu est reporté).')} />
      {isAdmin && (
        <form onSubmit={save} className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          <Field label={tr('Mois d\'application')} htmlFor="rate-month"><input id="rate-month" className="input" type="month" value={form.effectiveMonth} onChange={(e) => setForm({ ...form, effectiveMonth: e.target.value })} required /></Field>
          <Field label={tr('Taux (Ar pour 1 USD)')} htmlFor="rate-usd"><MoneyInput id="rate-usd" value={form.usdRate} onChange={(v) => setForm({ ...form, usdRate: v })} /></Field>
          <Field label={tr('Note (optionnel)')} htmlFor="rate-note"><input id="rate-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={tr('Source du taux…')} /></Field>
          <Button type="submit" icon={Plus} loading={saving}>{tr('Enregistrer le taux')}</Button>
        </form>
      )}
      {rates === null ? <div className="card-body"><Skeleton height={100} /></div> : rates.length === 0 ? (
        <EmptyState icon={Coins} title={tr('Aucun taux de change')}>{tr('Ajoutez un taux de référence pour activer l\'affichage des valeurs en dollars.')}</EmptyState>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">{tr('Mois d\'application')}</th><th scope="col" className="num">{tr('Ar pour 1 USD')}</th><th scope="col">{tr('Note')}</th><th scope="col">{tr('Saisi le (horodatage)')}</th>{isAdmin && <th scope="col" />}</tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td><strong className="tabular">{r.effectiveMonth}</strong></td>
                <td className="num tabular">{formatAr(r.usdRate)}</td>
                <td>{r.note || <span className="cell-empty">—</span>}</td>
                <td><span className="site-meta" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Clock size={13} aria-hidden="true" />{formatDateTime(r.updatedAt || r.createdAt)}</span></td>
                {isAdmin && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => remove(r)} /></td>}
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
  const { tr } = useI18n();
  const toast = useToast();
  const [offices, setOffices] = useState(null);
  const [communes, setCommunes] = useState([]);
  const [modal, setModal] = useState(null); // {office?} | null

  async function reload() { try { setOffices(await api.listOffices()); } catch (e) { toast.error(e.message); setOffices([]); } }
  useEffect(() => { reload(); api.officeCommunes().then(setCommunes).catch(() => setCommunes([])); /* eslint-disable-next-line */ }, []);

  async function remove(o) {
    if (!window.confirm(tr('Supprimer le bureau « {name} » ?', { name: o.name }))) return;
    try {
      try { await api.deleteOffice(o.id); } catch (e) {
        // Effets en cascade : confirmation explicite avec les chiffres (la désactivation est sans perte).
        if (e.status !== 409 || e.details?.code !== 'CONFIRM_DELETE') throw e;
        const d = e.details;
        if (!window.confirm(tr('Ce bureau a {sites} site(s) rattaché(s), {mmr} dérogation(s) MMR et {antennes} antenne(s). Le supprimer détache ces sites (rattachés ensuite à un autre bureau qui couvre leur commune) et efface ses dérogations. Pour ne rien perdre, choisissez plutôt « Modifier » puis Inactif. Supprimer quand même ?', d))) return;
        await api.deleteOffice(o.id, { confirm: true });
      }
      toast.success(tr('Bureau supprimé.')); reload();
    } catch (e) { toast.error(e.message); }
  }

  const nationalCount = (offices || []).filter((o) => o.national).length;
  return (
    <Card aria-labelledby="off-title">
      <CardHeader id="off-title" title={tr('Bureaux & antennes')}
        subtitle={tr('Bureau pays (périmètre national) ou bureau terrain / antenne avec un périmètre de communes. Les sites sont rattachés automatiquement selon leur commune.')}>
        {isAdmin && <Button icon={Plus} onClick={() => setModal({})}>{tr('Ajouter un bureau')}</Button>}
      </CardHeader>
      {offices === null ? <div className="card-body"><Skeleton height={120} /></div> : offices.length === 0 ? (
        <EmptyState icon={Building2} title={tr('Aucun bureau')} action={isAdmin && <Button icon={Plus} onClick={() => setModal({})}>{tr('Ajouter un bureau')}</Button>}>
          {tr('Créez vos bureaux terrain et antennes, puis définissez leur périmètre de communes pour rattacher les sites.')}
        </EmptyState>
      ) : (
        <>
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <span className="hint">{tr('{n} bureau(x) · {a} actifs · {nat} à périmètre national', { n: offices.length, a: offices.filter((o) => o.active).length, nat: nationalCount })}</span>
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">{tr('Bureau')}</th><th scope="col">{tr('Code')}</th><th scope="col">{tr('Nature')}</th><th scope="col">{tr('Périmètre')}</th>
              <th scope="col" className="num">{tr('Sites')}</th><th scope="col">{tr('Statut')}</th>{isAdmin && <th scope="col" />}
            </tr></thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong>{o.parentName && <div className="site-meta">{tr('antenne de {name}', { name: o.parentName })}</div>}{o.responsible && <div className="site-meta">{o.responsible}</div>}</td>
                  <td><span className="mono">{o.code}</span></td>
                  <td><Badge tone={levelIsNational(o.level) || o.nature === 'pays' ? 'blue' : null}>{levelLabel(o.level) ? tr(levelLabel(o.level)) : (o.nature === 'pays' ? tr('bureau pays') : tr('terrain'))}</Badge></td>
                  <td>{o.national ? <Badge tone="green">{tr('national — tous les sites')}</Badge> : <span className="tag">{tr('{n} commune(s)', { n: o.communeCount })}</span>}</td>
                  <td className="num tabular">{formatInt(o.siteCount)}{o.unattachedInPerimeter > 0 && (
                    <div className="muted" style={{ fontSize: 12 }} title={tr('Sites dont la commune est dans le périmètre mais qui restent sans bureau.')}>{tr('+ {n} à rattacher', { n: formatInt(o.unattachedInPerimeter) })}</div>
                  )}</td>
                  <td><Badge tone={o.active ? 'green' : null} dot>{o.active ? tr('Actif') : tr('Inactif')}</Badge></td>
                  {isAdmin && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={tr('Éditer')} onClick={() => setModal({ office: o })} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => remove(o)} />
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
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(office);
  const [form, setForm] = useState({
    code: office?.code || '', name: office?.name || '',
    level: office?.level || (office?.national ? 'country' : 'area'),
    parentId: office?.parentId || '', responsible: office?.responsible || '',
    national: office?.national || false, active: office?.active ?? true,
  });
  const [picked, setPicked] = useState(() => new Set());
  const [perimeter, setPerimeter] = useState([]); // communes déjà enregistrées (même absentes du catalogue)
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) api.officePerimeter(office.id).then((rows) => { setPerimeter(rows); setPicked(new Set(rows.map((r) => normCommune(r.commune)))); }).catch(() => {});
  }, [editing, office]);

  // Clé insensible à la casse et aux espaces (« MANAKOMPY » du registre = « Manakompy » du découpage).
  const key = (c) => normCommune(c.commune);
  // Catalogue = découpage du pays + registre ; une région/un district sans commune connue n'a rien à cocher.
  const selectable = useMemo(() => communes.filter((c) => c.commune), [communes]);
  // Cascade Région › District › Commune (le périmètre peut couvrir plusieurs
  // districts ; la sélection est conservée entre les changements de filtre).
  // Listes sans doublon de casse (« Amboasary Sud » = « AMBOASARY SUD ») : première graphie conservée.
  const uniqNames = (arr) => { const m = new Map(); for (const v of arr) if (v && !m.has(normCommune(v))) m.set(normCommune(v), v); return [...m.values()].sort((a, b) => a.localeCompare(b)); };
  const sameName = (a, b) => normCommune(a) === normCommune(b);
  const regions = useMemo(() => uniqNames(communes.map((c) => c.region)), [communes]);
  const districts = useMemo(() => uniqNames(communes.filter((c) => !region || sameName(c.region, region)).map((c) => c.district)), [communes, region]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return selectable.filter((c) => (!region || sameName(c.region, region)) && (!district || sameName(c.district, district))
      && (!s || c.commune.toLowerCase().includes(s) || (c.district || '').toLowerCase().includes(s))).slice(0, 600);
  }, [selectable, q, region, district]);
  // Communes sélectionnées (dédupliquées par nom), pour les puces récapitulatives.
  const pickedList = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const c of [...selectable, ...perimeter]) if (picked.has(key(c)) && !seen.has(key(c))) { seen.add(key(c)); out.push(c); }
    return out;
  }, [selectable, perimeter, picked]);

  function toggle(c) { setPicked((prev) => { const n = new Set(prev); if (n.has(key(c))) n.delete(key(c)); else n.add(key(c)); return n; }); }
  function setMany(list, on) {
    setPicked((prev) => { const n = new Set(prev); for (const c of list) { if (on) n.add(key(c)); else n.delete(key(c)); } return n; });
  }

  async function save(e) {
    e.preventDefault();
    if (!form.code.trim() || form.name.trim().length < 2) { toast.error(tr('Code et nom (≥ 2 caractères) requis.')); return; }
    setSaving(true);
    // Une commune déjà enregistrée mais absente du catalogue est conservée (jamais perdue en silence).
    const chosen = pickedList.map((c) => ({ district: c.district || undefined, commune: c.commune }));
    const payload = {
      code: form.code.trim(), name: form.name.trim(), level: form.level,
      parentId: form.parentId || undefined, responsible: form.responsible.trim() || undefined,
      national: form.national, active: form.active, communes: form.national ? [] : chosen,
    };
    try {
      if (editing) await api.updateOffice(office.id, payload); else await api.createOffice(payload);
      toast.success(tr('Bureau enregistré.')); onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open size="lg" title={editing ? tr('Modifier le bureau') : tr('Nouveau bureau')} subtitle={tr('Bureau pays (national) ou terrain / antenne avec périmètre de communes.')} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="office-form" loading={saving}>{tr('Enregistrer')}</Button></>}>
      <form id="office-form" onSubmit={save} style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label={tr('Code')}><input className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="1" /></Field>
          <Field label={tr('Nom du bureau')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Toliara" /></Field>
          <Field label={tr('Niveau')} hint={tr('Siège › Régional › Pays › Area › Sous-bureau › Antenne')}>
            <select className="select" value={form.level}
              onChange={(e) => { const level = e.target.value; setForm({ ...form, level, national: levelIsNational(level) }); }}>
              {OFFICE_LEVELS.map((l) => <option key={l.code} value={l.code}>{tr(l.label)}</option>)}
            </select>
          </Field>
          <Field label={tr('Antenne de (optionnel)')}>
            <select className="select" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">{tr('— Bureau principal —')}</option>
              {offices.filter((o) => !office || o.id !== office.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label={tr('Responsable (optionnel)')}><input className="input" value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label className="filter-check"><input type="checkbox" checked={form.national} onChange={(e) => setForm({ ...form, national: e.target.checked })} /><span>{tr('Périmètre national (tous les sites)')}</span></label>
          <label className="filter-check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /><span>{tr('Actif')}</span></label>
        </div>

        {!form.national && (
          <div className="field">
            <span className="field-label">{tr('Périmètre — communes ({n} sélectionnée(s))', { n: picked.size })}</span>
            {selectable.length === 0 && perimeter.length === 0 ? <p className="muted">{tr('Aucune commune connue : importez le découpage du pays (Paramétrage › Localités) ou des sites (Master Data / planning).')}</p> : (
              <>
                {/* Cascade : Région → District → communes (multi-sélection) */}
                <div className="form-grid" style={{ marginBottom: 8 }}>
                  <select className="select" value={region} aria-label={tr('Région')}
                    onChange={(e) => { setRegion(e.target.value); setDistrict(''); }}>
                    <option value="">{tr('Toutes les régions')}</option>
                    {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select className="select" value={district} aria-label={tr('District')}
                    onChange={(e) => setDistrict(e.target.value)}>
                    <option value="">{region ? tr('Tous les districts de la région') : tr('Tous les districts')}</option>
                    {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <input className="input" placeholder={tr('Filtrer les communes…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setMany(filtered, true)} disabled={filtered.length === 0}>
                    {tr('Tout cocher ({n})', { n: filtered.length })}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMany(filtered, false)} disabled={filtered.length === 0}>
                    {tr('Décocher ces {n}', { n: filtered.length })}
                  </Button>
                  {picked.size > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>{tr('Tout vider')}</Button>}
                </div>

                {/* Récap des communes sélectionnées (toutes régions/districts confondus) */}
                {pickedList.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, maxHeight: 92, overflow: 'auto' }}>
                    {pickedList.map((c) => (
                      <button type="button" key={key(c)} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                        onClick={() => toggle(c)} title={tr('{name} — retirer', { name: `${c.commune}${c.district ? ' · ' + c.district : ''}` })}>
                        {c.commune}<X size={13} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  {filtered.map((c) => (
                    <label key={`${c.region}|${c.district}|${c.commune}`} className="filter-pick" style={{ padding: '6px 10px' }}>
                      <input type="checkbox" checked={picked.has(key(c))} onChange={() => toggle(c)} />
                      <span>{c.commune}{c.district ? <span className="site-meta"> · {c.district}{c.region ? ` · ${c.region}` : ''}</span> : null}</span>
                    </label>
                  ))}
                  {filtered.length === 0 && <p className="muted" style={{ padding: 10 }}>{tr('Aucune commune ne correspond.')}</p>}
                </div>
              </>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------- Partners -- */

function PartnersSection({ isAdmin, onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [partners, setPartners] = useState(null);
  const [types, setTypes] = useState([]);
  const [modal, setModal] = useState(null); // {mode:'create'|'edit', partner?}

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
      <CardHeader id="partners-title" title={tr('Partenaires')} subtitle={tr('Le référentiel : nom et type de chaque partenaire — partenaires de mise en œuvre (titulaires des contrats), TPM (tierces parties de suivi) et autres. Fiche complète, agents des TPM et évaluations : Partenaires & TPM.')}>
        {isAdmin && <Button icon={Plus} onClick={() => setModal({ mode: 'create' })}>{tr('Nouveau partenaire')}</Button>}
      </CardHeader>
      {partners === null ? (
        <div className="card-body"><Skeleton height={120} /></div>
      ) : partners.length === 0 ? (
        <EmptyState icon={Users} title={tr('Aucun partenaire')} action={isAdmin && <Button icon={Plus} onClick={() => setModal({ mode: 'create' })}>{tr('Nouveau partenaire')}</Button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th scope="col">{tr('Partenaire')}</th><th scope="col">{tr('Type')}</th><th scope="col" className="num">{tr('Agents (TPM)')}</th>
              <th scope="col">{tr('État')}</th><th scope="col"><span className="sr-only">{tr('Actions')}</span></th>
            </tr></thead>
            {Object.entries(grouped).map(([typeLabel, list]) => (
              <tbody key={typeLabel}>
                <tr className="subrow-head"><td colSpan={5}>{tr(typeLabel)} · {list.length}</td></tr>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td><span className="agent"><Avatar name={p.name} /><strong>{p.name}</strong></span></td>
                    <td>{roleOf(p.typeCode) === 'autre' ? <Badge>{tr(p.typeLabel)}</Badge> : <RoleBadge role={roleOf(p.typeCode)} />}</td>
                    {/* Agents : le nombre seulement (leurs noms sont dans la fiche du TPM, retour 113). */}
                    <td className="num tabular">{p.typeCode === 'tpm' ? p.agents.length : <span className="cell-empty">—</span>}</td>
                    <td>{p.active ? <Badge tone="green">{tr('Actif')}</Badge> : <Badge>{tr('Inactif')}</Badge>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isAdmin && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setModal({ mode: 'edit', partner: p })}>{tr('Modifier')}</Button>}
                      {onNavigate && <Button size="sm" variant="secondary" onClick={() => onNavigate('tpm', 'prestataires', p.id)}>{tr('Ouvrir la fiche')} <ChevronRight size={14} aria-hidden="true" /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {(modal?.mode === 'create' || modal?.mode === 'edit') && (
        <PartnerModal types={types} partner={modal.partner} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />
      )}
    </Card>
  );
}

/** Création ou modification d'un partenaire du référentiel : nom, type, actif (retour 113). */
function PartnerModal({ types, partner, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(partner);
  const [form, setForm] = useState({ name: partner ? partner.name : '', partnerTypeId: partner ? partner.partnerTypeId : '', active: partner ? partner.active : true });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = { name: form.name.trim().length < 2 ? tr('Nom requis.') : null, partnerTypeId: !form.partnerTypeId ? tr('Choisissez un type.') : null };

  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.name || errs.partnerTypeId) return;
    setSaving(true);
    try {
      if (editing) {
        await api.updatePartner(partner.id, { name: form.name.trim(), partnerTypeId: form.partnerTypeId, active: form.active });
        toast.success(tr('Partenaire {name} mis à jour.', { name: form.name.trim() }));
      } else {
        await api.createPartner({ name: form.name.trim(), partnerTypeId: form.partnerTypeId });
        toast.success(tr('Partenaire {name} créé.', { name: form.name.trim() }));
      }
      onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title={editing ? tr('Modifier le partenaire — {name}', { name: partner.name }) : tr('Nouveau partenaire')}
      subtitle={editing ? null : tr('Ajouté au référentiel, utilisable dans les contrats et le suivi tiers.')} initialFocus="#pt-name"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="partner-form" loading={saving}>{editing ? tr('Enregistrer') : tr('Créer')}</Button></>}>
      <form id="partner-form" onSubmit={save} noValidate style={{ display: 'grid', gap: 16 }}>
        <Field label={tr('Nom')} htmlFor="pt-name" required error={touched ? errs.name : undefined}>
          <input id="pt-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr('Ex. ASSOCIATION AINA')} />
        </Field>
        <Field label={tr('Type de partenaire')} htmlFor="pt-type" required hint={tr('Configuré dans « Types de partenaire ».')} error={touched ? errs.partnerTypeId : undefined}>
          <select id="pt-type" className={`select ${form.partnerTypeId ? '' : 'is-empty'}`} value={form.partnerTypeId} onChange={(e) => setForm({ ...form, partnerTypeId: e.target.value })}>
            <option value="">{tr('Choisir un type…')}</option>
            {types.map((t) => <option key={t.id} value={t.id}>{tr(t.label)}</option>)}
          </select>
        </Field>
        {editing && partner.partnerTypeId !== form.partnerTypeId && (
          <p className="field-hint">{tr('Changer le type change le rôle du partenaire partout : un TPM suit des contrats et a des agents ; un partenaire de mise en œuvre tient des contrats.')}</p>
        )}
        {editing && (
          <label className="check-row"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {tr('Partenaire actif (proposé dans les listes de choix)')}</label>
        )}
      </form>
    </Modal>
  );
}

function AgentModal({ partner, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setSaving(true);
    try { await api.createPartnerAgent(partner.id, { name: name.trim() }); toast.success(tr('Agent ajouté à {name}.', { name: partner.name })); onSaved(); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={tr('Nouvel agent — {name}', { name: partner.name })} initialFocus="#ag-name"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="agent-form" loading={saving}>{tr('Ajouter')}</Button></>}>
      <form id="agent-form" onSubmit={save}>
        <Field label={tr('Nom de l\'agent')} htmlFor="ag-name" required><input id="ag-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------- Activities -- */

function ActivitiesSection({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [subs, setSubs] = useState([]);          // toutes les sous-activités, groupées à l'affichage
  const [modal, setModal] = useState(false);       // création d'activité
  const [open, setOpen] = useState(() => new Set()); // activités dépliées (id)
  const [subModal, setSubModal] = useState(null);  // { activityId, sub? } création/édition d'une sous-activité

  async function reload() {
    try {
      const [acts, sa] = await Promise.all([api.listActivities(), api.listSubActivities()]);
      setItems(acts); setSubs(sa);
    } catch (e) { toast.error(e.message); setItems([]); setSubs([]); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const byActivity = useMemo(() => {
    const m = new Map();
    for (const s of subs) { if (!m.has(s.activityId)) m.set(s.activityId, []); m.get(s.activityId).push(s); }
    return m;
  }, [subs]);

  async function toggle(a) {
    try { await api.setActivityActive(a.id, !a.active); reload(); }
    catch (e) { toast.error(e.message); }
  }
  function toggleOpen(id) {
    setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  async function toggleSub(s) {
    try { await api.updateSubActivity(s.id, { active: !s.active }); reload(); }
    catch (e) { toast.error(e.message); }
  }
  async function removeSub(s) {
    if (!window.confirm(tr('Supprimer la sous-activité « {label} » ?', { label: s.label }))) return;
    try { await api.deleteSubActivity(s.id); reload(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="act-title">
      <CardHeader id="act-title" title={tr('Activités de suivi')} subtitle={tr('Chaque activité se décline en sous-activités (le « tag » porté par les sites) avec une information libre.')}>
        {isAdmin && <Button icon={Plus} onClick={() => setModal(true)}>{tr('Nouvelle activité')}</Button>}
      </CardHeader>
      {items === null ? <div className="card-body"><Skeleton height={100} /></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th scope="col" style={{ width: 32 }} />
              <th scope="col">{tr('Activité')}</th><th scope="col">{tr('Code')}</th>
              <th scope="col" className="num">{tr('Sous-activités')}</th>
              <th scope="col">{tr('État')}</th>{isAdmin && <th scope="col" />}
            </tr></thead>
            <tbody>
              {items.map((a) => {
                const list = byActivity.get(a.id) || [];
                const isOpen = open.has(a.id);
                return (
                  <React.Fragment key={a.id}>
                    <tr>
                      <td>
                        <Button size="sm" variant="ghost" aria-expanded={isOpen}
                          aria-label={tr('Afficher les sous-activités')} onClick={() => toggleOpen(a.id)}>
                          <ChevronRight size={16} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                        </Button>
                      </td>
                      <td><strong>{a.label}</strong></td>
                      <td><span className="mono">{a.code}</span></td>
                      <td className="num">{list.length}</td>
                      <td><Badge tone={a.active ? 'green' : null}>{a.active ? tr('Active') : tr('Inactive')}</Badge></td>
                      {isAdmin && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" onClick={() => toggle(a)}>{a.active ? tr('Désactiver') : tr('Activer')}</Button></td>}
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={isAdmin ? 6 : 5} style={{ background: 'var(--surface-2)', padding: '12px 16px' }}>
                          <SubActivityList
                            subs={list} isAdmin={isAdmin}
                            onAdd={() => setSubModal({ activityId: a.id })}
                            onEdit={(s) => setSubModal({ activityId: a.id, sub: s })}
                            onToggle={toggleSub} onRemove={removeSub}
                          />
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
      {modal && <CodeLabelModal title={tr('Nouvelle activité')} onClose={() => setModal(false)} onSubmit={(v) => api.createActivity(v)} onSaved={() => { setModal(false); reload(); }} />}
      {subModal && (
        <SubActivityModal
          activityId={subModal.activityId} sub={subModal.sub}
          onClose={() => setSubModal(null)}
          onSaved={() => { setSubModal(null); reload(); }}
        />
      )}
    </Card>
  );
}

// Liste des sous-activités d'une activité (dépliée) : code (tag), libellé,
// information, état, et actions admin.
function SubActivityList({ subs, isAdmin, onAdd, onEdit, onToggle, onRemove }) {
  const { tr } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>{tr('Sous-activités')}</strong>
        {isAdmin && <Button size="sm" icon={Plus} variant="secondary" onClick={onAdd}>{tr('Ajouter une sous-activité')}</Button>}
      </div>
      {subs.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>{tr('Aucune sous-activité. Ajoutez-en une.')}</div>
      ) : (
        <table className="table" style={{ background: 'var(--surface)' }}>
          <thead><tr>
            <th scope="col">{tr('Code (tag)')}</th><th scope="col">{tr('Sous-activité')}</th>
            <th scope="col">{tr('Information')}</th><th scope="col">{tr('État')}</th>{isAdmin && <th scope="col" />}
          </tr></thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id}>
                <td><span className="mono">{s.code}</span></td>
                <td>{s.label}</td>
                <td className="muted" style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{s.info || '—'}</td>
                <td><Badge tone={s.active ? 'green' : null}>{s.active ? tr('Active') : tr('Inactive')}</Badge></td>
                {isAdmin && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(s)}>{tr('Modifier')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => onToggle(s)}>{s.active ? tr('Désactiver') : tr('Activer')}</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onRemove(s)} aria-label={tr('Supprimer')} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Création / édition d'une sous-activité : code (tag), libellé, information.
function SubActivityModal({ activityId, sub, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(sub);
  const [form, setForm] = useState({ code: sub?.code || '', label: sub?.label || '', info: sub?.info || '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = {
    label: form.label.trim().length < 2 ? tr('Libellé requis.') : null,
    code: !/^[a-z0-9_-]{1,60}$/i.test(form.code.trim()) ? tr('Code : lettres/chiffres/tiret, 1 à 60.') : null,
  };
  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.label || errs.code) return;
    setSaving(true);
    try {
      const payload = { code: form.code.trim(), label: form.label.trim(), info: form.info.trim() };
      if (editing) await api.updateSubActivity(sub.id, payload);
      else await api.createSubActivity({ activityId, ...payload });
      toast.success(tr('Enregistré.')); onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={editing ? tr('Modifier la sous-activité') : tr('Nouvelle sous-activité')} initialFocus="#sa-label"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="sa-form" loading={saving}>{editing ? tr('Enregistrer') : tr('Créer')}</Button></>}>
      <form id="sa-form" onSubmit={save} noValidate style={{ display: 'grid', gap: 16 }}>
        <Field label={tr('Sous-activité')} htmlFor="sa-label" required error={touched ? errs.label : undefined}>
          <input id="sa-label" className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <Field label={tr('Code (tag)')} htmlFor="sa-code" required hint={tr('Le « tag » porté par les sites (ex. GD, MAM).')} error={touched ? errs.code : undefined}>
          <input id="sa-code" className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label={tr('Information')} htmlFor="sa-info" hint={tr('Définition ou notes (facultatif).')}>
          <textarea id="sa-info" className="input" rows={3} value={form.info} onChange={(e) => setForm({ ...form, info: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Types -- */

function TypesSection({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(false);
  async function reload() { try { setItems(await api.listPartnerTypes()); } catch (e) { toast.error(e.message); setItems([]); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  return (
    <Card aria-labelledby="types-title">
      <CardHeader id="types-title" title={tr('Types de partenaire')} subtitle={tr('Catégorisation des partenaires. Ex. partenaire de mise en œuvre, TPM, cabinet.')}>
        {isAdmin && <Button icon={Plus} onClick={() => setModal(true)}>{tr('Nouveau type')}</Button>}
      </CardHeader>
      {items === null ? <div className="card-body"><Skeleton height={100} /></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{tr('Type')}</th><th scope="col">{tr('Code')}</th><th scope="col" className="num">{tr('Partenaires')}</th></tr></thead>
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
      {modal && <CodeLabelModal title={tr('Nouveau type de partenaire')} onClose={() => setModal(false)} onSubmit={(v) => api.createPartnerType(v)} onSaved={() => { setModal(false); reload(); }} />}
    </Card>
  );
}

function CodeLabelModal({ title, onClose, onSubmit, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ code: '', label: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = {
    label: form.label.trim().length < 2 ? tr('Libellé requis.') : null,
    code: !/^[a-z0-9_-]{2,40}$/i.test(form.code.trim()) ? tr('Code : lettres/chiffres/tiret, 2 à 40.') : null,
  };
  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.label || errs.code) return;
    setSaving(true);
    try { await onSubmit({ code: form.code.trim(), label: form.label.trim() }); toast.success(tr('Enregistré.')); onSaved(); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={title} initialFocus="#cl-label"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="cl-form" loading={saving}>{tr('Créer')}</Button></>}>
      <form id="cl-form" onSubmit={save} noValidate style={{ display: 'grid', gap: 16 }}>
        <Field label={tr('Libellé')} htmlFor="cl-label" required error={touched ? errs.label : undefined}>
          <input id="cl-label" className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <Field label={tr('Code')} htmlFor="cl-code" required hint={tr('Identifiant court, sans espace (ex. pdm).')} error={touched ? errs.code : undefined}>
          <input id="cl-code" className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

// Journal des suppressions (retour 56) — lecture seule, admin. Trace chaque
// document supprimé : type, référence, statut au moment de la suppression,
// justificatif (si validé), auteur et date.
const DOC_TYPE_LABEL = {
  tpm_report: 'Rapport / facture TPM',
  collection_plan: 'Plan de collecte',
  contract: 'Contrat',
  contract_amendment: 'Avenant',
};

function DeletionsSection({ isAdmin }) {
  const { tr } = useI18n();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    setRows(null); setError(null);
    api.listDeletions(filter ? { docType: filter } : undefined)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [filter]);

  if (!isAdmin) return null;
  if (error) return <Card><EmptyState icon={Trash2} title={tr('Journal indisponible')}>{error}</EmptyState></Card>;
  if (!rows) return <Card><Skeleton height={180} /></Card>;

  return (
    <Card>
      <CardHeader title={tr('Documents supprimés')} subtitle={tr('{n} entrée(s)', { n: rows.length })}>
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={tr('Filtrer par type')}>
          <option value="">{tr('Tous les types')}</option>
          {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
        </select>
      </CardHeader>
      {rows.length === 0 ? (
        <EmptyState icon={Trash2} title={tr('Aucune suppression')}>{tr('Les suppressions de documents apparaîtront ici.')}</EmptyState>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr>
            <th>{tr('Date')}</th><th>{tr('Type')}</th><th>{tr('Document')}</th>
            <th>{tr('Statut')}</th><th>{tr('Justificatif')}</th><th>{tr('Par')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="tabular"><span className="site-meta">{formatDateTime(r.deletedAt)}</span></td>
                <td>{tr(DOC_TYPE_LABEL[r.docType] || r.docType)}</td>
                <td>{r.docRef || '—'}</td>
                <td>{r.validated ? <Badge tone="green">{tr('validé')}</Badge> : <Badge>{r.statusAtDeletion}</Badge>}</td>
                <td className="muted">{r.justification || '—'}</td>
                <td className="muted">{r.deletedByEmail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
