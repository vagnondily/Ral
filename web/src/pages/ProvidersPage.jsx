import React, { useEffect, useMemo, useState } from 'react';
import { Handshake, UserPlus, ArrowRight, Settings, Info, Trash2, Users } from 'lucide-react';
import { api } from '../api/client.js';
import { Avatar, Badge, Button, Field, PageHeader, Stats } from '../components/ui.jsx';
import DataList from '../components/DataList.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { richText } from '../lib/contracts.js';
import { useI18n } from '../lib/i18n.jsx';

const FONCTIONS = ['Coordinateur de terrain', 'Superviseur', 'Agent de collecte', 'Enquêteur', 'Contrôleur qualité'];

/**
 * Prestataires TPM — tableau à plat des prestataires ; le nombre d'agents
 * (cliquable) ouvre la liste des agents (nom, fonction) avec ajout/suppression.
 * Les FORMATIONS et l'ÉVALUATION des agents sont des pages distinctes.
 */
function AgentsModal({ provider, canEdit, onClose, onChanged }) {
  const { tr } = useI18n();
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
      toast.success(tr('Agent ajouté.'));
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  // Agent qui porte des données (formations, évaluations, formulaires reçus) : la suppression est refusée
  // (409) — on propose alors de le désactiver, ce qui garde tout son historique.
  const [withHistory, setWithHistory] = useState(() => new Set());
  async function remove(agentId) {
    try { await api.deletePartnerAgent(provider.id, agentId); toast.success(tr('Agent supprimé.')); onChanged(); }
    catch (err) {
      if (err.status === 409) setWithHistory((prev) => new Set(prev).add(agentId));
      toast.error(err.message);
    }
  }
  async function setActive(agentId, active) {
    try {
      await api.setPartnerAgentActive(provider.id, agentId, active);
      toast.success(tr(active ? 'Agent réactivé.' : 'Agent désactivé : son historique est conservé.'));
      onChanged();
    } catch (err) { toast.error(err.message); }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={tr('Agents de terrain — {name}', { name: provider.name })}
      subtitle={tr(agents.length > 1 ? '{n} agents. Formation et évaluation dans leurs pages dédiées.' : '{n} agent. Formation et évaluation dans leurs pages dédiées.', { n: agents.length })}
      footer={<Button variant="secondary" onClick={onClose}>{tr('Fermer')}</Button>}>
      <div className="table-wrap" style={{ marginBottom: canEdit ? 16 : 0 }}>
        <table className="table">
          <thead><tr><th scope="col">{tr('Agent')}</th><th scope="col">{tr('Fonction')}</th>{canEdit && <th scope="col" />}</tr></thead>
          <tbody>
            {agents.length === 0 && <tr><td colSpan={canEdit ? 3 : 2} className="muted" style={{ textAlign: 'center', padding: 16 }}>{tr("Aucun agent pour l'instant.")}</td></tr>}
            {agents.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="agent"><Avatar name={a.name} />{a.name}</span>
                  {a.active === false && <> <Badge>{tr('Inactif')}</Badge></>}
                </td>
                <td>{a.fonction ? <Badge>{a.fonction}</Badge> : <span className="cell-empty">—</span>}</td>
                {canEdit && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.active === false
                      ? <Button size="sm" variant="secondary" onClick={() => setActive(a.id, true)}>{tr('Réactiver')}</Button>
                      : withHistory.has(a.id) && <Button size="sm" variant="secondary" onClick={() => setActive(a.id, false)}>{tr('Désactiver')}</Button>}
                    {a.active !== false && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(a.id)} aria-label={tr('Supprimer {name}', { name: a.name })} />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form onSubmit={add} className="form-grid" style={{ alignItems: 'end' }}>
          <Field label={tr("Nom de l'agent")} htmlFor="ag-name" required>
            <input id="ag-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Ex. J. Fanomezantsoa')} />
          </Field>
          <Field label={tr('Fonction')} htmlFor="ag-fonction" hint={tr('Rôle de terrain (liste ou saisie libre).')}>
            <input id="ag-fonction" className="input" list="fonctions-list" value={fonction} onChange={(e) => setFonction(e.target.value)} placeholder={tr('Ex. Superviseur')} />
            <datalist id="fonctions-list">{FONCTIONS.map((f) => <option key={f} value={f} />)}</datalist>
          </Field>
          <div className="span-2" style={{ justifySelf: 'end' }}>
            <Button type="submit" size="sm" icon={UserPlus} loading={saving} disabled={name.trim().length < 2}>{tr("Ajouter l'agent")}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function ProvidersPage({ canEdit, onNavigate }) {
  const { tr } = useI18n();
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
        title={tr('Prestataires TPM')}
        description={tr("Les tierces parties de suivi et leurs agents de terrain (nom, fonction). L'affectation des sites aux prestataires se fait dans « Affectation & visites » (à partir du RBM).")}
      >
        <Button variant="secondary" icon={ArrowRight} onClick={() => onNavigate('processus', 'sites')}>{tr('Affecter les sites')}</Button>
        {canEdit && <Button variant="secondary" icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>{tr('Créer un partenaire')}</Button>}
      </PageHeader>
      <div className="note">
        <Info size={18} aria-hidden="true" />
        <span>{richText(tr("Les partenaires se créent dans <strong>Paramétrage › Partenaires</strong>. Les <strong>formations</strong> et l'<strong>évaluation</strong> des agents ont leurs propres onglets."))}</span>
      </div>

      <Stats items={[
        { label: tr('Prestataires TPM'), value: stats ? stats.count : '—', foot: tr('Tierces parties actives') },
        { label: tr('Agents de terrain'), value: stats ? stats.agents : '—', foot: tr('Tous prestataires confondus') },
        { label: tr('Prestataires avec agents'), value: stats ? stats.withAgents : '—', suffix: stats ? `/ ${stats.count}` : null, foot: tr('Prêts à être affectés') },
      ]} />

      <DataList
        rows={providers}
        columns={{
          name: { label: tr('Prestataire'), sortVal: (p) => p.name, csv: (p) => p.name,
            render: (p) => <span className="agent"><Avatar name={p.name} /><strong>{p.name}</strong></span> },
          reference: { label: tr('Référence'), sortVal: (p) => p.contractRef || '', csv: (p) => p.contractRef || '',
            render: (p) => (p.contractRef ? <span className="mono">{p.contractRef}</span> : <span className="cell-empty">—</span>) },
          agents: { label: tr('Agents'), num: true, sortVal: (p) => p.agents.length, csv: (p) => p.agents.length,
            render: (p) => <button type="button" className="count-link" onClick={() => setModal(p)}>{tr(p.agents.length > 1 ? '{n} agents' : '{n} agent', { n: p.agents.length })}</button> },
          action: { label: '', width: 150, csv: () => '',
            render: (p) => <Button size="sm" variant="secondary" icon={Users} onClick={() => setModal(p)}>{tr('Gérer les agents')}</Button> },
        }}
        defaultColumns={['name', 'reference', 'agents', 'action']}
        filters={{ q: { label: tr('Recherche'), type: 'search', placeholder: tr('Prestataire, référence…'), match: (p, v) => [p.name, p.contractRef].some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) } }}
        storageKey="mems.providers.view" defaultSort={{ key: 'name', dir: 'asc' }}
        csvName="prestataires_tpm.csv" emptyIcon={Handshake} emptyTitle={tr('Aucun prestataire TPM')}
        emptyAction={canEdit && <Button icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>{tr('Créer dans Paramétrage')}</Button>}
        emptyChildren={tr('Créez un partenaire de type TPM dans Paramétrage pour pouvoir saisir ses agents.')}
      />

      {modal && <AgentsModal provider={modal} canEdit={canEdit} onClose={() => setModal(null)} onChanged={reload} />}
    </div>
  );
}
