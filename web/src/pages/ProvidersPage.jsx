import React, { useEffect, useMemo, useState } from 'react';
import { Handshake, UserPlus, ArrowRight, Settings, Info, Trash2, Users } from 'lucide-react';
import { api } from '../api/client.js';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, Stats } from '../components/ui.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';

const FONCTIONS = ['Coordinateur de terrain', 'Superviseur', 'Agent de collecte', 'Enquêteur', 'Contrôleur qualité'];

/**
 * Prestataires TPM — tableau à plat des prestataires ; le nombre d'agents
 * (cliquable) ouvre la liste des agents (nom, fonction) avec ajout/suppression.
 * Les FORMATIONS et l'ÉVALUATION des agents sont des pages distinctes.
 */
function AgentsModal({ provider, canEdit, onClose, onChanged }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [fonction, setFonction] = useState('');
  const [saving, setSaving] = useState(false);
  const agents = provider.agents || [];

  async function add(e) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setSaving(true);
    try {
      await api.createPartnerAgent(provider.id, { name: name.trim(), fonction: fonction.trim() || undefined });
      setName(''); setFonction('');
      toast.success('Agent ajouté.');
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  async function remove(agentId) {
    try { await api.deletePartnerAgent(provider.id, agentId); toast.success('Agent supprimé.'); onChanged(); }
    catch (err) { toast.error(err.message); }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={`Agents de terrain — ${provider.name}`}
      subtitle={`${agents.length} agent${agents.length > 1 ? 's' : ''}. Formation et évaluation dans leurs pages dédiées.`}
      footer={<Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      <div className="table-wrap" style={{ marginBottom: canEdit ? 16 : 0 }}>
        <table className="table">
          <thead><tr><th scope="col">Agent</th><th scope="col">Fonction</th>{canEdit && <th scope="col" />}</tr></thead>
          <tbody>
            {agents.length === 0 && <tr><td colSpan={canEdit ? 3 : 2} className="muted" style={{ textAlign: 'center', padding: 16 }}>Aucun agent pour l'instant.</td></tr>}
            {agents.map((a) => (
              <tr key={a.id}>
                <td><span className="agent"><Avatar name={a.name} />{a.name}</span></td>
                <td>{a.fonction ? <Badge>{a.fonction}</Badge> : <span className="cell-empty">—</span>}</td>
                {canEdit && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(a.id)} aria-label={`Supprimer ${a.name}`} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form onSubmit={add} className="form-grid" style={{ alignItems: 'end' }}>
          <Field label="Nom de l'agent" htmlFor="ag-name" required>
            <input id="ag-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. J. Fanomezantsoa" />
          </Field>
          <Field label="Fonction" htmlFor="ag-fonction" hint="Rôle de terrain (liste ou saisie libre).">
            <input id="ag-fonction" className="input" list="fonctions-list" value={fonction} onChange={(e) => setFonction(e.target.value)} placeholder="Ex. Superviseur" />
            <datalist id="fonctions-list">{FONCTIONS.map((f) => <option key={f} value={f} />)}</datalist>
          </Field>
          <div className="span-2" style={{ justifySelf: 'end' }}>
            <Button type="submit" size="sm" icon={UserPlus} loading={saving} disabled={name.trim().length < 2}>Ajouter l'agent</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function ProvidersPage({ canEdit, onNavigate }) {
  const toast = useToast();
  const [providers, setProviders] = useState(null);
  const [modal, setModal] = useState(null);

  async function reload() {
    try {
      const list = await api.listProviders();
      setProviders(list);
      setModal((m) => (m ? list.find((p) => p.id === m.id) || null : null));
    } catch (err) { toast.error(err.message); setProviders((p) => p || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const stats = useMemo(() => {
    if (!providers) return null;
    const agents = providers.reduce((n, p) => n + p.agents.length, 0);
    const withAgents = providers.filter((p) => p.agents.length > 0).length;
    return { count: providers.length, agents, withAgents };
  }, [providers]);

  return (
    <div className="section-gap">
      <PageHeader
        title="Prestataires TPM"
        description="Les tierces parties de suivi et leurs agents de terrain (nom, fonction). L'affectation d'un site se fait par prestataire d'abord, puis par agent."
      >
        <Button variant="secondary" icon={ArrowRight} onClick={() => onNavigate('tpm', 'affectation')}>Affecter les sites</Button>
        {canEdit && <Button variant="secondary" icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>Créer un partenaire</Button>}
      </PageHeader>
      <div className="note">
        <Info size={18} aria-hidden="true" />
        <span>Les partenaires se créent dans <strong>Paramétrage › Partenaires</strong>. Les <strong>formations</strong> et l'<strong>évaluation</strong> des agents ont leurs propres onglets.</span>
      </div>

      <Stats items={[
        { label: 'Prestataires TPM', value: stats ? stats.count : '—', foot: 'Tierces parties actives' },
        { label: 'Agents de terrain', value: stats ? stats.agents : '—', foot: 'Tous prestataires confondus' },
        { label: 'Prestataires avec agents', value: stats ? stats.withAgents : '—', suffix: stats ? `/ ${stats.count}` : null, foot: 'Prêts à être affectés' },
      ]} />

      <Card aria-labelledby="providers-title">
        <CardHeader id="providers-title" title="Prestataires et agents" subtitle="Un prestataire par ligne. Cliquez sur le nombre d'agents pour gérer la liste (nom, fonction)." />
        {providers !== null && providers.length === 0 ? (
          <EmptyState icon={Handshake} title="Aucun prestataire TPM"
            action={canEdit && <Button icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>Créer dans Paramétrage</Button>}>
            Créez un partenaire de type TPM dans Paramétrage pour pouvoir saisir ses agents.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Prestataire</th><th scope="col">Référence</th><th scope="col" className="num">Agents</th><th scope="col" /></tr></thead>
              <tbody>
                {providers === null
                  ? [0, 1, 2].map((i) => (<tr key={i} aria-hidden="true">{[220, 180, 60, 120].map((w, j) => <td key={j}><Skeleton width={w} height={20} /></td>)}</tr>))
                  : providers.map((p) => (
                      <tr key={p.id}>
                        <td><span className="agent"><Avatar name={p.name} /><strong>{p.name}</strong></span></td>
                        <td>{p.contractRef ? <span className="mono">{p.contractRef}</span> : <span className="cell-empty">—</span>}</td>
                        <td className="num"><button type="button" className="count-link" onClick={() => setModal(p)}>{p.agents.length} agent{p.agents.length > 1 ? 's' : ''}</button></td>
                        <td style={{ textAlign: 'right' }}><Button size="sm" variant="secondary" icon={Users} onClick={() => setModal(p)}>Gérer les agents</Button></td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && <AgentsModal provider={modal} canEdit={canEdit} onClose={() => setModal(null)} onChanged={reload} />}
    </div>
  );
}
