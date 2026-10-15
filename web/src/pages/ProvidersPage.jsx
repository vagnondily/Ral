import React, { useEffect, useMemo, useState } from 'react';
import { Handshake, ArrowRight, Settings, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import { Avatar, Badge, Button, PageHeader, Stats, StatusBadge } from '../components/ui.jsx';
import DataList from '../components/DataList.jsx';
import { useToast } from '../components/Toast.jsx';
import { periodLabel } from '../lib/contracts.js';
import { formatInt } from '../lib/format.js';
import { BANDS, formatScore } from '../lib/evaluation.js';
import { PROVIDER_STATUS } from '../lib/partners.js';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Prestataires TPM (lot 8, retour 28.1) : la liste, puis la FICHE de chacun (page
 * #/tpm/prestataires/<id>). Statut « actif selon contrat » (règle commune du retour 30),
 * activité sur 12 mois, rapports à valider, dernière note validée. Les agents se gèrent
 * dans la fiche (onglet Agents), plus dans une fenêtre.
 */
export default function ProvidersPage({ canEdit, onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [scope, setScope] = useState('tpm');

  useEffect(() => {
    api.partnerProviders().then(setRows).catch((err) => { toast.error(err.message); setRows([]); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (p) => onNavigate('tpm', 'prestataires', p.id);
  const tpm = useMemo(() => (rows || []).filter((p) => p.typeCode === 'tpm'), [rows]);
  const stats = useMemo(() => (rows ? {
    tpm: tpm.length,
    active: tpm.filter((p) => p.status.state === 'actif').length,
    agents: tpm.reduce((n, p) => n + p.agentsActive, 0),
    toValidate: (rows || []).reduce((n, p) => n + p.reportsToValidate, 0),
  } : null), [rows, tpm]);

  const statusCell = (p) => (
    <div className="pv-status-cell">
      <StatusBadge map={PROVIDER_STATUS} value={p.status.state} />
      {p.status.from && <span className="muted pv-status-period">{periodLabel(p.status.from, p.status.to, tr)}</span>}
    </div>
  );

  return (
    <div className="section-gap">
      <PageHeader
        title={tr('Prestataires TPM')}
        description={tr('Les tierces parties de suivi : leur statut selon les contrats, leur activité et leur évaluation. Ouvrez un prestataire pour voir sa fiche complète (budget, rapports, suivis, agents, formations, évaluation).')}
      >
        <Button variant="secondary" icon={ArrowRight} onClick={() => onNavigate('processus', 'sites')}>{tr('Affecter les sites')}</Button>
        {canEdit && <Button variant="secondary" icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>{tr('Créer un partenaire')}</Button>}
      </PageHeader>

      <Stats items={[
        { label: tr('Prestataires TPM'), value: stats ? stats.tpm : '—', foot: tr('Fiches actives et inactives') },
        { label: tr('Actifs selon contrat'), value: stats ? stats.active : '—', suffix: stats ? `/ ${stats.tpm}` : null, foot: tr('Un contrat de suivi couvre ce mois') },
        { label: tr('Agents actifs'), value: stats ? formatInt(stats.agents) : '—', foot: tr('Tous prestataires TPM') },
        { label: tr('Rapports à valider'), value: stats ? stats.toValidate : '—', foot: tr('Soumis, en attente de décision') },
      ]} />

      <DataList
        rows={rows && (scope === 'all' ? rows : tpm)}
        columns={{
          name: { label: tr('Prestataire'), sortVal: (p) => p.name.toLowerCase(), csv: (p) => p.name,
            render: (p) => (
              <button type="button" className="pv-name-link" onClick={() => open(p)}>
                <Avatar name={p.name} />
                <span className="pv-name"><strong>{p.name}</strong>{p.shortName && <span className="muted"> · {p.shortName}</span>}
                  {(scope === 'all' || !p.active) && (
                    <span className="pv-sub">{scope === 'all' && tr(p.typeLabel)}{scope === 'all' && !p.active && ' · '}{!p.active && tr('Fiche inactive')}</span>
                  )}</span>
              </button>
            ) },
          status: { label: tr('Statut contractuel'), sortVal: (p) => ['actif', 'a_venir', 'echu', 'aucun'].indexOf(p.status.state), csv: (p) => tr(PROVIDER_STATUS[p.status.state].label),
            render: statusCell },
          agents: { label: tr('Agents actifs'), num: true, sortVal: (p) => p.agentsActive, csv: (p) => p.agentsActive, render: (p) => p.agentsActive || <span className="cell-empty">0</span> },
          visits: { label: tr('Visites (12 mois)'), num: true, sortVal: (p) => p.visitsRealised12, csv: (p) => p.visitsRealised12,
            render: (p) => formatInt(p.visitsRealised12) },
          submissions: { label: tr('Formulaires (12 mois)'), num: true, sortVal: (p) => p.submissions12, csv: (p) => p.submissions12,
            render: (p) => formatInt(p.submissions12) },
          reports: { label: tr('À valider'), num: true, sortVal: (p) => p.reportsToValidate, csv: (p) => p.reportsToValidate,
            render: (p) => (p.reportsToValidate ? <Badge tone="blue">{p.reportsToValidate}</Badge> : <span className="cell-empty">0</span>) },
          score: { label: tr('Note'), sortVal: (p) => (p.lastScore == null ? -1 : p.lastScore), csv: (p) => (p.lastScore == null ? '' : p.lastScore),
            render: (p) => (p.lastScore == null ? <span className="cell-empty">{tr('Non évalué')}</span>
              : <span className="pv-score-cell"><strong className="tabular">{formatScore(p.lastScore)}</strong> <StatusBadge map={BANDS} value={p.lastBand} /></span>) },
          action: { label: '', width: 96, csv: () => '',
            render: (p) => <Button size="sm" variant="secondary" onClick={() => open(p)}>{tr('Ouvrir')} <ChevronRight size={14} aria-hidden="true" /></Button> },
        }}
        defaultColumns={['name', 'status', 'agents', 'visits', 'submissions', 'reports', 'score', 'action']}
        filters={{
          q: { label: tr('Recherche'), type: 'search', placeholder: tr('Nom, sigle…'), match: (p, v) => [p.name, p.shortName].some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) },
          status: { label: tr('Statut contractuel'), type: 'select',
            options: [{ id: '', label: tr('Tous les statuts') }, ...Object.entries(PROVIDER_STATUS).map(([id, s]) => ({ id, label: tr(s.label) }))],
            match: (p, v) => p.status.state === v },
        }}
        defaultFilters={['q', 'status']}
        storageKey="mems.providers.v2" defaultSort={{ key: 'name', dir: 'asc' }}
        onRowDoubleClick={open}
        csvName="prestataires_tpm.csv" emptyIcon={Handshake} emptyTitle={tr('Aucun prestataire TPM')}
        emptyAction={canEdit && <Button icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>{tr('Créer dans Paramétrage')}</Button>}
        emptyChildren={tr('Créez un partenaire de type TPM dans Paramétrage pour pouvoir saisir ses agents.')}
        toolbar={() => (
          <div className="segmented" role="group" aria-label={tr('Partenaires affichés')}>
            <button type="button" aria-pressed={scope === 'tpm'} onClick={() => setScope('tpm')}>{tr('Prestataires TPM')} <span className="count">{tpm.length}</span></button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{tr('Tous les partenaires')} <span className="count">{(rows || []).length}</span></button>
          </div>
        )}
      />
    </div>
  );
}
