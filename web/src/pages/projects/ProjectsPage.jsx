import React, { useEffect, useState } from 'react';
import { Plus, ArrowLeft, Pencil, Trash2, FolderKanban, Target, ListChecks, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';

/**
 * Projets (1re version — docs/SPEC_PROGRAMMES.md). Infos de base + onglets « Cadre logique » et
 * « Besoins ». Liste ↔ détail dans la même page (état interne). Montant stocké en CENTIMES.
 */
const STATUS = {
  en_cours: { label: 'En cours', tone: 'green' },
  suspendu: { label: 'Suspendu', tone: 'orange' },
  termine: { label: 'Terminé', tone: 'blue' },
  abandonne: { label: 'Abandonné', tone: 'red' },
};
const LEVELS = { impact: 'Impact', outcome: 'Effet', output: 'Produit', activity: 'Activité' };
const LEVEL_TONE = { impact: 'blue', outcome: 'green', output: 'orange', activity: null };
const PRIORITIES = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };

const money = (cents, cur) => (cents == null ? '—' : `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`);
const period = (a, b) => (a || b ? `${a || '…'} → ${b || '…'}` : '—');

export default function ProjectsPage({ canEdit, onNavigate }) {
  const [selected, setSelected] = useState(null);
  if (selected) return <ProjectDetail id={selected} canEdit={canEdit} onBack={() => setSelected(null)} onNavigate={onNavigate} />;
  return <ProjectsList canEdit={canEdit} onOpen={setSelected} />;
}

function ProjectsList({ canEdit, onOpen }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null); // null | {} (nouveau)
  async function reload() { try { setRows(await api.listProjects()); } catch (e) { toast.error(e.message); setRows([]); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  return (
    <div className="section-gap">
      <PageHeader title={tr('Projets')} description={tr('Projets du bureau pays : informations de base, cadre logique et besoins. Cliquez un projet pour l\'ouvrir.')}>
        {canEdit && <Button icon={Plus} onClick={() => setForm({})}>{tr('Nouveau projet')}</Button>}
      </PageHeader>
      <Card>
        {rows === null ? <div className="card-body"><Skeleton height={160} /></div>
          : rows.length === 0 ? <EmptyState icon={FolderKanban} title={tr('Aucun projet')}>{tr('Créez un premier projet avec « Nouveau projet ».')}</EmptyState>
            : (
              <div className="table-wrap"><table className="table">
                <thead><tr>
                  <th scope="col">{tr('Projet')}</th><th scope="col">{tr('Bailleur')}</th><th scope="col">{tr('Période')}</th>
                  <th scope="col" className="num">{tr('Financement')}</th><th scope="col">{tr('Statut')}</th><th scope="col" className="num">{tr('Cadre / Besoins')}</th>
                </tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => onOpen(p.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.id); }}>
                      <td><strong>{p.name}</strong>{p.code && <div className="site-meta mono">{p.code}</div>}</td>
                      <td>{p.donorName || p.donorCode || <span className="muted">—</span>}{p.grantNumber && <div className="site-meta">{tr('Grant')} {p.grantNumber}</div>}</td>
                      <td className="tabular">{period(p.startDate, p.endDate)}</td>
                      <td className="num tabular">{money(p.budgetAmount, p.currency)}</td>
                      <td>{STATUS[p.status] ? <Badge tone={STATUS[p.status].tone}>{tr(STATUS[p.status].label)}</Badge> : p.status}</td>
                      <td className="num tabular muted">{formatInt(p.logframeCount)} / {formatInt(p.needsCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
      </Card>
      {form && <ProjectForm project={null} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); reload(); if (id) onOpen(id); }} />}
    </div>
  );
}

function ProjectDetail({ id, canEdit, onBack, onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [p, setP] = useState(null);
  const [tab, setTab] = useState('infos');
  const [edit, setEdit] = useState(false);
  async function reload() { try { setP(await api.getProject(id)); } catch (e) { toast.error(e.message); } }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [id]);
  async function remove() {
    if (!window.confirm(tr('Supprimer le projet « {name} » et tout son contenu ? Action définitive.', { name: p.name }))) return;
    try { await api.deleteProject(id); toast.success(tr('Projet supprimé.')); onBack(); } catch (e) { toast.error(e.message); }
  }
  if (!p) return <div className="section-gap"><Skeleton height={200} /></div>;
  return (
    <div className="section-gap">
      <PageHeader title={p.name} description={p.code ? `${tr('Code')} : ${p.code}` : undefined}>
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>{tr('Retour')}</Button>
        {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>{tr('Modifier')}</Button>}
        {canEdit && <Button variant="ghost" icon={Trash2} onClick={remove}>{tr('Supprimer')}</Button>}
      </PageHeader>
      <div className="seg" role="group" aria-label={tr('Onglet')} style={{ marginBottom: 4 }}>
        <button type="button" className={tab === 'infos' ? 'is-active' : ''} onClick={() => setTab('infos')}><Info size={15} aria-hidden="true" /> {tr('Informations')}</button>
        <button type="button" className={tab === 'logframe' ? 'is-active' : ''} onClick={() => setTab('logframe')}><Target size={15} aria-hidden="true" /> {tr('Cadre logique')}</button>
        <button type="button" className={tab === 'needs' ? 'is-active' : ''} onClick={() => setTab('needs')}><ListChecks size={15} aria-hidden="true" /> {tr('Besoins')}</button>
      </div>
      {tab === 'infos' && <InfosTab p={p} onNavigate={onNavigate} />}
      {tab === 'logframe' && <LogframeTab p={p} canEdit={canEdit} onReload={reload} />}
      {tab === 'needs' && <NeedsTab p={p} canEdit={canEdit} onReload={reload} />}
      {edit && <ProjectForm project={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    </div>
  );
}

function Row({ label, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
    <span className="muted">{label}</span><span>{children || <span className="muted">—</span>}</span>
  </div>;
}
function InfosTab({ p, onNavigate }) {
  const { tr } = useI18n();
  const contracts = p.contracts || [];
  return (
    <div className="section-gap">
      <Card><div className="card-body">
        <Row label={tr('Statut')}>{STATUS[p.status] ? <Badge tone={STATUS[p.status].tone}>{tr(STATUS[p.status].label)}</Badge> : p.status}</Row>
        <Row label={tr('Période')}>{period(p.startDate, p.endDate)}</Row>
        <Row label={tr('Bailleur')}>{p.donorName}{p.donorCode ? ` (${p.donorCode})` : ''}</Row>
        <Row label={tr('N° de grant')}>{p.grantNumber}</Row>
        <Row label={tr('N° d\'award')}>{p.awardNumber}</Row>
        <Row label={tr('Financement')}>{money(p.budgetAmount, p.currency)}</Row>
        <Row label={tr('Zones (géographie)')}>{p.regions}</Row>
        <Row label={tr('Description')}>{p.description && <span style={{ whiteSpace: 'pre-wrap' }}>{p.description}</span>}</Row>
      </div></Card>
      <Card>
        <CardHeader title={tr('Contrats rattachés ({n})', { n: contracts.length })} />
        <div className="card-body">
          {contracts.length === 0
            ? <p className="muted">{tr('Aucun contrat rattaché. Depuis un contrat, choisissez ce projet dans « Projet ».')}</p>
            : (
              <table className="table">
                <thead><tr><th>{tr('N° contrat')}</th><th>{tr('Partenaire')}</th><th>{tr('Statut')}</th><th>{tr('Période')}</th></tr></thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id} className={onNavigate ? 'clickable' : ''} onClick={onNavigate ? () => onNavigate('contrats', 'liste', c.id) : undefined}>
                      <td className="mono">{c.numero}{c.numeroFla ? <div className="site-meta">{c.numeroFla}</div> : null}</td>
                      <td>{c.partnerName}</td>
                      <td>{c.status}</td>
                      <td className="tabular">{period(c.dateDebut, c.dateFin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </Card>
    </div>
  );
}

function LogframeTab({ p, canEdit, onReload }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [modal, setModal] = useState(null); // {} nouveau | row
  async function del(r) { if (!window.confirm(tr('Supprimer cette ligne du cadre logique ?'))) return; try { await api.deleteLogframe(r.id); onReload(); } catch (e) { toast.error(e.message); } }
  return (
    <Card>
      <CardHeader title={tr('Cadre logique')} subtitle={tr('Chaîne de résultats : impact → effet → produit → activité, avec indicateur, référence, cible et moyen de vérification.')}>
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setModal({})}>{tr('Ajouter une ligne')}</Button>}
      </CardHeader>
      {(!p.logframe || !p.logframe.length) ? <EmptyState icon={Target} title={tr('Cadre logique vide')}>{tr('Ajoutez l\'impact, les effets, les produits et les activités.')}</EmptyState>
        : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{tr('Niveau')}</th><th>{tr('Énoncé')}</th><th>{tr('Indicateur')}</th><th>{tr('Référence')}</th><th>{tr('Cible')}</th><th>{tr('Moyen de vérification')}</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {p.logframe.map((r) => (
                <tr key={r.id}>
                  <td><Badge tone={LEVEL_TONE[r.level]}>{tr(LEVELS[r.level] || r.level)}</Badge></td>
                  <td style={{ maxWidth: 320 }}>{r.statement}{r.assumptions && <div className="site-meta">{tr('Hypothèses')} : {r.assumptions}</div>}</td>
                  <td>{r.indicator || <span className="muted">—</span>}</td>
                  <td>{r.baseline || <span className="muted">—</span>}</td>
                  <td>{r.target || <span className="muted">—</span>}</td>
                  <td style={{ maxWidth: 200 }}>{r.meansOfVerification || <span className="muted">—</span>}</td>
                  {canEdit && <td className="num" style={{ whiteSpace: 'nowrap' }}><Button size="sm" variant="ghost" icon={Pencil} aria-label={tr('Modifier')} onClick={() => setModal(r)} /><Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => del(r)} /></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      {modal && <LogframeModal projectId={p.id} row={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); onReload(); }} />}
    </Card>
  );
}

function NeedsTab({ p, canEdit, onReload }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  async function del(r) { if (!window.confirm(tr('Supprimer ce besoin ?'))) return; try { await api.deleteNeed(r.id); onReload(); } catch (e) { toast.error(e.message); } }
  return (
    <Card>
      <CardHeader title={tr('Besoins')} subtitle={tr('Analyse des besoins : titre, zone, population cible et priorité.')}
        action={canEdit && <Button size="sm" icon={Plus} onClick={() => setModal({})}>{tr('Ajouter un besoin')}</Button>} />
      {(!p.needs || !p.needs.length) ? <EmptyState icon={ListChecks} title={tr('Aucun besoin')}>{tr('Ajoutez les besoins identifiés pour ce projet.')}</EmptyState>
        : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{tr('Besoin')}</th><th>{tr('Zone')}</th><th className="num">{tr('Population cible')}</th><th>{tr('Priorité')}</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {p.needs.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong>{r.description && <div className="site-meta" style={{ whiteSpace: 'pre-wrap' }}>{r.description}</div>}</td>
                  <td>{r.zone || <span className="muted">—</span>}</td>
                  <td className="num tabular">{r.targetPopulation != null ? formatInt(r.targetPopulation) : <span className="muted">—</span>}</td>
                  <td>{r.priority ? tr(PRIORITIES[r.priority] || r.priority) : <span className="muted">—</span>}</td>
                  {canEdit && <td className="num" style={{ whiteSpace: 'nowrap' }}><Button size="sm" variant="ghost" icon={Pencil} aria-label={tr('Modifier')} onClick={() => setModal(r)} /><Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => del(r)} /></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      {modal && <NeedModal projectId={p.id} row={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); onReload(); }} />}
    </Card>
  );
}

function ProjectForm({ project, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(project);
  const [f, setF] = useState({
    name: project?.name || '', code: project?.code || '', grantNumber: project?.grantNumber || '', awardNumber: project?.awardNumber || '',
    donorCode: project?.donorCode || '', donorName: project?.donorName || '', regions: project?.regions || '',
    startDate: project?.startDate || '', endDate: project?.endDate || '', status: project?.status || 'en_cours',
    amount: project?.budgetAmount != null ? String(project.budgetAmount / 100) : '', currency: project?.currency || '', description: project?.description || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  async function save(e) {
    e.preventDefault();
    if (f.name.trim().length < 2) { toast.error(tr('Nom requis.')); return; }
    const amount = f.amount.trim() === '' ? null : Math.round(parseFloat(f.amount.replace(',', '.')) * 100);
    if (amount != null && !Number.isFinite(amount)) { toast.error(tr('Montant invalide.')); return; }
    const body = {
      name: f.name.trim(), code: f.code.trim() || null, grantNumber: f.grantNumber.trim() || null, awardNumber: f.awardNumber.trim() || null,
      donorCode: f.donorCode.trim() || null, donorName: f.donorName.trim() || null, regions: f.regions.trim() || null,
      startDate: f.startDate || null, endDate: f.endDate || null, status: f.status,
      budgetAmount: amount, currency: f.currency.trim().toUpperCase() || null, description: f.description.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) { await api.updateProject(project.id, body); toast.success(tr('Projet enregistré.')); onSaved(); }
      else { const r = await api.createProject(body); toast.success(tr('Projet créé.')); onSaved(r.id); }
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open title={editing ? tr('Modifier le projet') : tr('Nouveau projet')} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="project-form" loading={saving}>{tr('Enregistrer')}</Button></>}>
      <form id="project-form" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <Field label={tr('Nom du projet')}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={tr('Code / WBS')}><input className="input" value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
          <Field label={tr('Statut')}><select className="select" value={f.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{tr(s.label)}</option>)}</select></Field>
          <Field label={tr('Début')}><input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label={tr('Fin')}><input className="input" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
          <Field label={tr('Bailleur (nom)')}><input className="input" value={f.donorName} onChange={(e) => set('donorName', e.target.value)} /></Field>
          <Field label={tr('Code bailleur')}><input className="input" value={f.donorCode} onChange={(e) => set('donorCode', e.target.value)} /></Field>
          <Field label={tr('N° de grant')}><input className="input" value={f.grantNumber} onChange={(e) => set('grantNumber', e.target.value)} /></Field>
          <Field label={tr('N° d\'award')}><input className="input" value={f.awardNumber} onChange={(e) => set('awardNumber', e.target.value)} /></Field>
          <Field label={tr('Montant du financement')}><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" /></Field>
          <Field label={tr('Devise (ISO)')}><input className="input" value={f.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} placeholder="USD" /></Field>
        </div>
        <Field label={tr('Zones (information géographique)')} hint={tr('Régions / districts concernés (texte, v1).')}><input className="input" value={f.regions} onChange={(e) => set('regions', e.target.value)} /></Field>
        <Field label={tr('Description')}><textarea className="input" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function LogframeModal({ projectId, row, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    level: row?.level || 'outcome', statement: row?.statement || '', indicator: row?.indicator || '', baseline: row?.baseline || '',
    target: row?.target || '', meansOfVerification: row?.meansOfVerification || '', assumptions: row?.assumptions || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  async function save(e) {
    e.preventDefault();
    if (f.statement.trim().length < 1) { toast.error(tr('Énoncé requis.')); return; }
    const body = { level: f.level, statement: f.statement.trim(), indicator: f.indicator.trim() || null, baseline: f.baseline.trim() || null, target: f.target.trim() || null, meansOfVerification: f.meansOfVerification.trim() || null, assumptions: f.assumptions.trim() || null };
    setSaving(true);
    try { if (row) await api.updateLogframe(row.id, body); else await api.addLogframe(projectId, body); toast.success(tr('Enregistré.')); onSaved(); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open title={row ? tr('Modifier la ligne') : tr('Ajouter une ligne')} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="lf-form" loading={saving}>{tr('Enregistrer')}</Button></>}>
      <form id="lf-form" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <Field label={tr('Niveau')}><select className="select" value={f.level} onChange={(e) => set('level', e.target.value)}>{Object.entries(LEVELS).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</select></Field>
        <Field label={tr('Énoncé')}><textarea className="input" rows={2} value={f.statement} onChange={(e) => set('statement', e.target.value)} autoFocus /></Field>
        <Field label={tr('Indicateur')}><input className="input" value={f.indicator} onChange={(e) => set('indicator', e.target.value)} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={tr('Référence')}><input className="input" value={f.baseline} onChange={(e) => set('baseline', e.target.value)} /></Field>
          <Field label={tr('Cible')}><input className="input" value={f.target} onChange={(e) => set('target', e.target.value)} /></Field>
        </div>
        <Field label={tr('Moyen de vérification')}><input className="input" value={f.meansOfVerification} onChange={(e) => set('meansOfVerification', e.target.value)} /></Field>
        <Field label={tr('Hypothèses')}><input className="input" value={f.assumptions} onChange={(e) => set('assumptions', e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function NeedModal({ projectId, row, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ title: row?.title || '', description: row?.description || '', zone: row?.zone || '', targetPopulation: row?.targetPopulation != null ? String(row.targetPopulation) : '', priority: row?.priority || '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  async function save(e) {
    e.preventDefault();
    if (f.title.trim().length < 2) { toast.error(tr('Titre requis.')); return; }
    const pop = f.targetPopulation.trim() === '' ? null : Math.round(Number(f.targetPopulation));
    if (pop != null && !Number.isFinite(pop)) { toast.error(tr('Population invalide.')); return; }
    const body = { title: f.title.trim(), description: f.description.trim() || null, zone: f.zone.trim() || null, targetPopulation: pop, priority: f.priority || null };
    setSaving(true);
    try { if (row) await api.updateNeed(row.id, body); else await api.addNeed(projectId, body); toast.success(tr('Enregistré.')); onSaved(); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open title={row ? tr('Modifier le besoin') : tr('Ajouter un besoin')} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="need-form" loading={saving}>{tr('Enregistrer')}</Button></>}>
      <form id="need-form" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <Field label={tr('Titre du besoin')}><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus /></Field>
        <Field label={tr('Description')}><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={tr('Zone')}><input className="input" value={f.zone} onChange={(e) => set('zone', e.target.value)} /></Field>
          <Field label={tr('Population cible')}><input className="input" inputMode="numeric" value={f.targetPopulation} onChange={(e) => set('targetPopulation', e.target.value)} /></Field>
        </div>
        <Field label={tr('Priorité')}><select className="select" value={f.priority} onChange={(e) => set('priority', e.target.value)}><option value="">{tr('— Non définie —')}</option>{Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</select></Field>
      </form>
    </Modal>
  );
}
