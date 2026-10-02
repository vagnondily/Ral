import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Plus, Trash2, Info, MapPin, CalendarDays } from 'lucide-react';
import { api } from '../../api/client.js';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, Stats } from '../../components/ui.jsx';
import DataList from '../../components/DataList.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';

const APPRECIATIONS = ['Excellent', 'Bon', 'Moyen', 'Insuffisant'];
const APPRECIATION_TONE = { Excellent: 'green', Bon: 'green', Moyen: 'orange', Insuffisant: 'red' };
const periodLabel = (iso) => {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** Évaluation d'un agent — s'appuie sur son travail de terrain (missions, jours). */
function EvaluationModal({ agent, canEdit, onClose, onChanged }) {
  const toast = useToast();
  const now = new Date();
  const [periode, setPeriode] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [note, setNote] = useState('');
  const [appreciation, setAppreciation] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [saving, setSaving] = useState(false);
  const evals = agent.evaluations || [];

  async function add(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createAgentEvaluation(agent.providerId, agent.id, {
        periode, note: note === '' ? undefined : Number(note),
        appreciation: appreciation || undefined, commentaire: commentaire.trim() || undefined,
      });
      setNote(''); setAppreciation(''); setCommentaire('');
      toast.success('Évaluation enregistrée.');
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  async function remove(id) {
    try { await api.deleteAgentEvaluation(agent.providerId, agent.id, id); toast.success('Évaluation supprimée.'); onChanged(); }
    catch (err) { toast.error(err.message); }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={`Évaluation — ${agent.name}`}
      subtitle={`${agent.providerName}${agent.fonction ? ' · ' + agent.fonction : ''}`}
      footer={<Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      {/* Travail terrain — base de l'évaluation */}
      <div className="field-metrics">
        <div className="metric"><MapPin size={16} aria-hidden="true" /><div><div className="metric-val">{agent.missions}</div><div className="metric-lbl">Missions (sites)</div></div></div>
        <div className="metric"><CalendarDays size={16} aria-hidden="true" /><div><div className="metric-val">{agent.missionDays}</div><div className="metric-lbl">Jours de mission</div></div></div>
      </div>

      <div className="table-wrap" style={{ margin: '16px 0' }}>
        <table className="table">
          <thead><tr><th scope="col">Période</th><th scope="col" className="num">Note /20</th><th scope="col">Appréciation</th><th scope="col">Commentaire</th>{canEdit && <th scope="col" />}</tr></thead>
          <tbody>
            {evals.length === 0 && <tr><td colSpan={canEdit ? 5 : 4} className="muted" style={{ textAlign: 'center', padding: 16 }}>Aucune évaluation enregistrée.</td></tr>}
            {evals.map((ev) => (
              <tr key={ev.id}>
                <td>{periodLabel(ev.periode)}</td>
                <td className="num">{ev.note == null ? '—' : ev.note}</td>
                <td>{ev.appreciation ? <Badge tone={APPRECIATION_TONE[ev.appreciation]}>{ev.appreciation}</Badge> : <span className="cell-empty">—</span>}</td>
                <td className="muted" style={{ fontSize: 14 }}>{ev.commentaire || '—'}</td>
                {canEdit && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(ev.id)} aria-label="Supprimer" /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form onSubmit={add} className="form-grid" style={{ alignItems: 'end' }}>
          <Field label="Période (mois)" htmlFor="e-per" required><input id="e-per" type="month" className="input" value={periode} onChange={(e) => setPeriode(e.target.value)} /></Field>
          <Field label="Note /20" htmlFor="e-note"><input id="e-note" type="number" min="0" max="20" step="0.5" className="input tabular" value={note} onChange={(e) => setNote(e.target.value)} style={{ textAlign: 'right' }} /></Field>
          <Field label="Appréciation" htmlFor="e-app">
            <select id="e-app" className="select" value={appreciation} onChange={(e) => setAppreciation(e.target.value)}>
              <option value="">—</option>
              {APPRECIATIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <div className="span-2"><Field label="Commentaire" htmlFor="e-com" hint="Basé sur le travail réalisé sur le terrain.">
            <textarea id="e-com" className="input" rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Points forts, axes d'amélioration…" />
          </Field></div>
          <div className="span-2" style={{ justifySelf: 'end' }}><Button type="submit" size="sm" icon={Plus} loading={saving}>Enregistrer l'évaluation</Button></div>
        </form>
      )}
    </Modal>
  );
}

export default function EvaluationPage({ canEdit }) {
  const toast = useToast();
  const [agents, setAgents] = useState(null);
  const [modalId, setModalId] = useState(null);

  async function reload() {
    try { setAgents(await api.listAgentsEvaluation()); }
    catch (err) { toast.error(err.message); setAgents((a) => a || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const modalAgent = (agents || []).find((a) => a.id === modalId) || null;
  const stats = useMemo(() => {
    if (!agents) return null;
    const evaluated = agents.filter((a) => a.evaluations.length > 0).length;
    const missionDays = agents.reduce((n, a) => n + a.missionDays, 0);
    return { agents: agents.length, evaluated, missionDays };
  }, [agents]);

  const lastNote = (a) => (a.evaluations[0] && a.evaluations[0].note != null ? a.evaluations[0].note : null);

  return (
    <div className="section-gap">
      <PageHeader title="Évaluation des agents" description="Évaluation des agents de terrain à partir de leur travail réel : missions réalisées et jours de mission. Notes et appréciations périodiques." />
      <div className="note"><Info size={18} aria-hidden="true" /><span>L'évaluation s'appuie sur le <strong>travail terrain</strong> (missions et jours de mission issus de l'affectation). La <strong>formation</strong> est gérée dans son propre onglet.</span></div>

      <Stats items={[
        { label: 'Agents', value: stats ? stats.agents : '—', foot: 'Tous prestataires' },
        { label: 'Agents évalués', value: stats ? stats.evaluated : '—', suffix: stats ? `/ ${stats.agents}` : null, foot: 'Au moins une évaluation' },
        { label: 'Jours de mission', value: stats ? stats.missionDays : '—', foot: 'Cumul terrain' },
      ]} />

      <DataList
        rows={agents}
        columns={{
          name: { label: 'Agent', sortVal: (a) => a.name, csv: (a) => a.name,
            render: (a) => <span className="agent"><Avatar name={a.name} /><strong>{a.name}</strong></span> },
          provider: { label: 'Prestataire', sortVal: (a) => a.providerName, csv: (a) => a.providerName, render: (a) => a.providerName },
          missions: { label: 'Missions', num: true, sortVal: (a) => a.missions, csv: (a) => a.missions, render: (a) => a.missions },
          missionDays: { label: 'Jours terrain', num: true, sortVal: (a) => a.missionDays, csv: (a) => a.missionDays, render: (a) => a.missionDays },
          note: { label: 'Dernière note', num: true, sortVal: (a) => (lastNote(a) == null ? -1 : lastNote(a)), csv: (a) => (lastNote(a) == null ? '' : lastNote(a)),
            render: (a) => (lastNote(a) == null ? <span className="cell-empty">—</span> : <strong>{lastNote(a)}/20</strong>) },
          action: { label: '', width: 120, csv: () => '',
            render: (a) => <Button size="sm" variant="secondary" icon={ClipboardCheck} onClick={() => setModalId(a.id)}>Évaluer</Button> },
        }}
        defaultColumns={['name', 'provider', 'missions', 'missionDays', 'note', 'action']}
        filters={{ q: { label: 'Recherche', type: 'search', placeholder: 'Agent, prestataire…', match: (a, v) => [a.name, a.providerName].some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) } }}
        storageKey="mems.evaluation.view" defaultSort={{ key: 'name', dir: 'asc' }}
        csvName="evaluation_agents.csv" emptyIcon={ClipboardCheck} emptyTitle="Aucun agent"
        emptyChildren="Saisissez d'abord des agents dans Prestataires TPM."
      />

      {modalAgent && <EvaluationModal agent={modalAgent} canEdit={canEdit} onClose={() => setModalId(null)} onChanged={reload} />}
    </div>
  );
}
