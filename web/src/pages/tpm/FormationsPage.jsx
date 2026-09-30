import React, { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Plus, Trash2, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDate } from '../../lib/contracts.js';

/** Formations suivies par un agent (thématique, quand, durée en jours). */
function FormationsModal({ agent, canEdit, onClose, onChanged }) {
  const toast = useToast();
  const [thematique, setThematique] = useState('');
  const [date, setDate] = useState('');
  const [jours, setJours] = useState('1');
  const [saving, setSaving] = useState(false);
  const formations = agent.formations || [];
  const totalJours = formations.reduce((n, f) => n + (Number(f.jours) || 0), 0);

  async function add(e) {
    e.preventDefault();
    if (thematique.trim().length < 2) return;
    setSaving(true);
    try {
      await api.createAgentFormation(agent.providerId, agent.id, { thematique: thematique.trim(), date: date || undefined, jours: Number(jours) || 1 });
      setThematique(''); setDate(''); setJours('1');
      toast.success('Formation ajoutée.');
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  async function remove(id) {
    try { await api.deleteAgentFormation(agent.providerId, agent.id, id); toast.success('Formation supprimée.'); onChanged(); }
    catch (err) { toast.error(err.message); }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={`Formations — ${agent.name}`}
      subtitle={`${agent.providerName} · ${formations.length} formation${formations.length > 1 ? 's' : ''} · ${totalJours} jour${totalJours > 1 ? 's' : ''} au total`}
      footer={<Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      <div className="table-wrap" style={{ marginBottom: canEdit ? 16 : 0 }}>
        <table className="table">
          <thead><tr><th scope="col">Thématique</th><th scope="col">Quand</th><th scope="col" className="num">Jours</th>{canEdit && <th scope="col" />}</tr></thead>
          <tbody>
            {formations.length === 0 && <tr><td colSpan={canEdit ? 4 : 3} className="muted" style={{ textAlign: 'center', padding: 16 }}>Aucune formation enregistrée.</td></tr>}
            {formations.map((f) => (
              <tr key={f.id}>
                <td><strong>{f.thematique}</strong></td>
                <td>{f.date ? formatDate(f.date) : <span className="cell-empty">—</span>}</td>
                <td className="num">{f.jours}</td>
                {canEdit && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(f.id)} aria-label="Supprimer" /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form onSubmit={add} className="form-grid" style={{ alignItems: 'end' }}>
          <div className="span-2"><Field label="Thématique de la formation" htmlFor="f-them" required>
            <input id="f-them" className="input" value={thematique} onChange={(e) => setThematique(e.target.value)} placeholder="Ex. Collecte de données mobiles (ODK)" />
          </Field></div>
          <Field label="Quand" htmlFor="f-date"><input id="f-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Durée (jours)" htmlFor="f-jours"><input id="f-jours" type="number" min="0.5" step="0.5" className="input tabular" value={jours} onChange={(e) => setJours(e.target.value)} style={{ textAlign: 'right' }} /></Field>
          <div className="span-2" style={{ justifySelf: 'end' }}>
            <Button type="submit" size="sm" icon={Plus} loading={saving} disabled={thematique.trim().length < 2}>Ajouter la formation</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function FormationsPage({ canEdit }) {
  const toast = useToast();
  const [providers, setProviders] = useState(null);
  const [modalId, setModalId] = useState(null);

  async function reload() {
    try { setProviders(await api.listProviders()); }
    catch (err) { toast.error(err.message); setProviders((p) => p || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const agents = useMemo(() => (providers || []).flatMap((p) =>
    p.agents.map((a) => ({ ...a, providerId: p.id, providerName: p.name }))), [providers]);
  const modalAgent = agents.find((a) => a.id === modalId) || null;

  const stats = useMemo(() => {
    if (!providers) return null;
    const formations = agents.reduce((n, a) => n + (a.formations || []).length, 0);
    const jours = agents.reduce((n, a) => n + (a.formations || []).reduce((m, f) => m + (Number(f.jours) || 0), 0), 0);
    const trained = agents.filter((a) => (a.formations || []).length > 0).length;
    return { formations, jours, trained, agents: agents.length };
  }, [providers, agents]);

  return (
    <div className="section-gap">
      <PageHeader title="Formations des agents" description="Suivi des formations assistées par chaque agent de terrain : thématique, date et durée. Renforcement de capacités des TPM." />
      <div className="note"><Info size={18} aria-hidden="true" /><span>La formation est le <strong>renforcement de capacités</strong> ; l'<strong>évaluation</strong> (onglet dédié) mesure le travail réalisé sur le terrain.</span></div>

      <Stats items={[
        { label: 'Formations enregistrées', value: stats ? stats.formations : '—', foot: 'Toutes thématiques' },
        { label: 'Jours de formation', value: stats ? stats.jours : '—', foot: 'Cumul' },
        { label: 'Agents formés', value: stats ? stats.trained : '—', suffix: stats ? `/ ${stats.agents}` : null, foot: 'Au moins une formation' },
      ]} />

      <Card>
        <CardHeader title="Agents et formations" subtitle="Cliquez sur le nombre de formations d'un agent pour les consulter et les compléter." />
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Agent</th><th scope="col">Prestataire</th><th scope="col">Fonction</th><th scope="col" className="num">Formations</th><th scope="col" className="num">Jours</th></tr></thead>
            <tbody>
              {providers === null
                ? [0, 1, 2].map((i) => (<tr key={i} aria-hidden="true">{[200, 160, 140, 60, 60].map((w, j) => <td key={j}><Skeleton width={w} height={20} /></td>)}</tr>))
                : agents.map((a) => {
                    const jours = (a.formations || []).reduce((m, f) => m + (Number(f.jours) || 0), 0);
                    return (
                      <tr key={a.id}>
                        <td><span className="agent"><Avatar name={a.name} /><strong>{a.name}</strong></span></td>
                        <td>{a.providerName}</td>
                        <td>{a.fonction ? <Badge>{a.fonction}</Badge> : <span className="cell-empty">—</span>}</td>
                        <td className="num"><button type="button" className="count-link" onClick={() => setModalId(a.id)}><GraduationCap size={14} aria-hidden="true" style={{ verticalAlign: -2, marginRight: 4 }} />{(a.formations || []).length}</button></td>
                        <td className="num">{jours}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {providers && agents.length === 0 && <EmptyState icon={GraduationCap} title="Aucun agent">Saisissez d'abord des agents dans Prestataires TPM.</EmptyState>}
        </div>
      </Card>

      {modalAgent && <FormationsModal agent={modalAgent} canEdit={canEdit} onClose={() => setModalId(null)} onChanged={reload} />}
    </div>
  );
}
