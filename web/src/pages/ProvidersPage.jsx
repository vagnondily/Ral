import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Eye, Handshake, ArrowRight, Settings, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import { Avatar, Badge, Button, PageHeader, Stats, StatusBadge } from '../components/ui.jsx';
import DataList from '../components/DataList.jsx';
import { useToast } from '../components/Toast.jsx';
import { periodLabel } from '../lib/contracts.js';
import { formatInt } from '../lib/format.js';
import { BANDS, formatScore } from '../lib/evaluation.js';
import { PROVIDER_STATUS } from '../lib/partners.js';
import { ROLE_LABELS, contractNo, joinParts } from '../lib/roles.js';
import { useI18n } from '../lib/i18n.jsx';
import './tpm/partners.css';

/**
 * Partenaires & TPM (lot 8, retours 28.1 et 113) : UNE liste, en onglets par rôle —
 * « Partenaires de mise en œuvre » (titulaires des contrats FLA, avec le TPM qui suit chacun de
 * leurs contrats) et « TPM » (tierces parties de suivi, avec les contrats qu'elles suivent).
 * Chaque ligne ouvre la fiche 360° (#/tpm/prestataires/<id>). Les agents d'un TPM se gèrent dans
 * sa fiche ; la liste n'en donne que le nombre.
 */
const TAB_KEY = 'mems.partners.tab';
const readTab = () => { try { return localStorage.getItem(TAB_KEY) || 'mise_en_oeuvre'; } catch { return 'mise_en_oeuvre'; } };
const MAX_SHOWN = 2;

export default function ProvidersPage({ canEdit, onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [tab, setTabState] = useState(readTab);
  const setTab = (t) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* préférence locale seulement */ } };

  useEffect(() => {
    api.partnerProviders().then(setRows).catch((err) => { toast.error(err.message); setRows([]); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (p) => onNavigate('tpm', 'prestataires', p.id);
  const byRole = useMemo(() => {
    const out = { mise_en_oeuvre: [], tpm: [], autre: [] };
    for (const p of rows || []) (out[p.role] || out.autre).push(p);
    return out;
  }, [rows]);
  const tabs = [
    { id: 'mise_en_oeuvre', label: ROLE_LABELS.implementers, icon: Building2 },
    { id: 'tpm', label: ROLE_LABELS.tpm, icon: Eye },
    ...(byRole.autre.length ? [{ id: 'autre', label: 'Autres partenaires', icon: Handshake }] : []),
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'mise_en_oeuvre';
  const stats = useMemo(() => (rows ? {
    implementers: byRole.mise_en_oeuvre.length,
    contracts: byRole.mise_en_oeuvre.reduce((n, p) => n + p.heldContracts.length, 0),
    tpm: byRole.tpm.length,
    tpmActive: byRole.tpm.filter((p) => p.status.state === 'actif').length,
    agents: byRole.tpm.reduce((n, p) => n + p.agentsActive, 0),
    toValidate: byRole.tpm.reduce((n, p) => n + p.reportsToValidate, 0),
  } : null), [rows, byRole]);

  const nameCell = (p) => (
    <button type="button" className="pv-name-link" onClick={() => open(p)}>
      <Avatar name={p.name} />
      <span className="pv-name"><strong>{p.name}</strong>{p.shortName && <span className="muted"> · {p.shortName}</span>}
        {(current === 'autre' || !p.active) && (
          <span className="pv-sub">{joinParts(current === 'autre' ? tr(p.typeLabel) : null, !p.active ? tr('Fiche inactive') : null)}</span>
        )}</span>
    </button>
  );
  const statusCell = (p) => (
    <div className="pv-status-cell">
      <StatusBadge map={PROVIDER_STATUS} value={p.status.state} />
      {p.status.from && <span className="muted pv-status-period">{periodLabel(p.status.from, p.status.to, tr)}</span>}
    </div>
  );
  // Contrats d'une ligne : n° FLA (mono) · titulaire, deux au plus puis « +n ».
  const contractsCell = (list, withHolder) => {
    if (!list.length) return <span className="cell-empty">{tr('Aucun contrat actif')}</span>;
    return (
      <ul className="pr-contracts">
        {list.slice(0, MAX_SHOWN).map((c) => (
          <li key={c.id}><span className="mono">{contractNo(c)}</span>{withHolder && c.holderName && <span className="pv-sub">{c.holderName}</span>}</li>
        ))}
        {list.length > MAX_SHOWN && <li className="muted">{tr('+{n} autre(s)', { n: list.length - MAX_SHOWN })}</li>}
      </ul>
    );
  };
  // Les colonnes s'affichent dans l'ordre des clés : nom d'abord, statut puis « Ouvrir » en fin de ligne.
  const nameCol = { label: tr(ROLE_LABELS.partner), sortVal: (p) => p.name.toLowerCase(), csv: (p) => p.name, render: nameCell };
  const statusCol = { label: tr('Statut contractuel'), sortVal: (p) => ['actif', 'a_venir', 'echu', 'aucun'].indexOf(p.status.state), csv: (p) => tr(PROVIDER_STATUS[p.status.state].label),
    render: statusCell };
  const actionCol = { label: '', width: 96, csv: () => '',
    render: (p) => <Button size="sm" variant="secondary" onClick={() => open(p)}>{tr('Ouvrir')} <ChevronRight size={14} aria-hidden="true" /></Button> };
  const holderColumns = {
    name: nameCol,
    contracts: { label: tr('Contrats actifs'), sortVal: (p) => p.heldContracts.length, csv: (p) => p.heldContracts.map(contractNo).join(', '),
      render: (p) => contractsCell(p.heldContracts, false) },
    tpm: { label: tr(ROLE_LABELS.tpm), sortVal: (p) => p.tpms.map((t) => t.name).join(', '), csv: (p) => p.tpms.map((t) => t.name).join(', '),
      render: (p) => (p.tpms.length ? p.tpms.map((t) => t.name).join(', ') : <span className="cell-empty">{tr(ROLE_LABELS.noTpm)}</span>) },
    zones: { label: tr('Zones'), num: true, sortVal: (p) => p.zonesActive, csv: (p) => p.zonesActive,
      render: (p) => (p.zonesActive ? formatInt(p.zonesActive) : <span className="cell-empty">0</span>) },
    status: statusCol,
    action: actionCol,
  };
  const tpmColumns = {
    name: nameCol,
    status: statusCol,
    monitored: { label: tr('Contrats suivis'), sortVal: (p) => p.monitoredContracts.length, csv: (p) => p.monitoredContracts.map((c) => joinParts(contractNo(c), c.holderName)).join(', '),
      render: (p) => contractsCell(p.monitoredContracts, true) },
    agents: { label: tr('Agents'), num: true, sortVal: (p) => p.agentsActive, csv: (p) => p.agentsActive, render: (p) => p.agentsActive || <span className="cell-empty">0</span> },
    visits: { label: tr('Visites (12 mois)'), num: true, sortVal: (p) => p.visitsRealised12, csv: (p) => p.visitsRealised12,
      render: (p) => formatInt(p.visitsRealised12) },
    submissions: { label: tr('Formulaires (12 mois)'), num: true, sortVal: (p) => p.submissions12, csv: (p) => p.submissions12,
      render: (p) => formatInt(p.submissions12) },
    reports: { label: tr('À valider'), num: true, sortVal: (p) => p.reportsToValidate, csv: (p) => p.reportsToValidate,
      render: (p) => (p.reportsToValidate ? <Badge tone="blue">{p.reportsToValidate}</Badge> : <span className="cell-empty">0</span>) },
    score: { label: tr('Note'), sortVal: (p) => (p.lastScore == null ? -1 : p.lastScore), csv: (p) => (p.lastScore == null ? '' : p.lastScore),
      render: (p) => (p.lastScore == null ? <span className="cell-empty">{tr('Non évalué')}</span>
        : <span className="pv-score-cell"><strong className="tabular">{formatScore(p.lastScore)}</strong> <StatusBadge map={BANDS} value={p.lastBand} /></span>) },
    action: actionCol,
  };
  const filters = {
    q: { label: tr('Recherche'), type: 'search', placeholder: tr('Nom, sigle, n° FLA…'),
      match: (p, v) => [p.name, p.shortName, ...p.heldContracts.map(contractNo), ...p.monitoredContracts.map(contractNo), ...p.tpms.map((t) => t.name)]
        .some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) },
    status: { label: tr('Statut contractuel'), type: 'select',
      options: [{ id: '', label: tr('Tous les statuts') }, ...Object.entries(PROVIDER_STATUS).map(([id, s]) => ({ id, label: tr(s.label) }))],
      match: (p, v) => p.status.state === v },
  };
  const view = {
    mise_en_oeuvre: { columns: holderColumns, defaults: ['name', 'contracts', 'tpm', 'zones', 'status', 'action'], key: 'mems.partners.holders.v1',
      csv: 'partenaires_mise_en_oeuvre.csv', empty: 'Aucun partenaire de mise en œuvre',
      emptyText: 'Créez dans Paramétrage › Partenaires les partenaires qui tiennent les contrats (type « Partenaire de mise en œuvre »).' },
    tpm: { columns: tpmColumns, defaults: ['name', 'status', 'monitored', 'agents', 'reports', 'score', 'action'], key: 'mems.partners.tpm.v1',
      csv: 'tpm.csv', empty: 'Aucun TPM',
      emptyText: 'Créez dans Paramétrage › Partenaires les tierces parties de suivi (type « TPM »), puis leurs agents dans leur fiche.' },
    autre: { columns: holderColumns, defaults: ['name', 'contracts', 'status', 'action'], key: 'mems.partners.others.v1',
      csv: 'autres_partenaires.csv', empty: 'Aucun autre partenaire', emptyText: '' },
  }[current];

  return (
    <div className="section-gap">
      <PageHeader
        title={tr('Partenaires & TPM')}
        description={tr('Les partenaires de mise en œuvre tiennent les contrats (FLA) et mettent le programme en œuvre sur les sites ; les TPM (tierces parties de suivi) suivent cette mise en œuvre. Ouvrez une ligne pour voir la fiche complète.')}
      >
        <Button variant="secondary" icon={ArrowRight} onClick={() => onNavigate('processus', 'sites')}>{tr('Affecter les sites')}</Button>
        {canEdit && <Button variant="secondary" icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>{tr('Créer un partenaire')}</Button>}
      </PageHeader>

      <Stats items={[
        { label: tr(ROLE_LABELS.implementers), value: stats ? stats.implementers : '—', foot: stats ? tr('{n} contrat(s) actif(s)', { n: stats.contracts }) : null },
        { label: tr(ROLE_LABELS.tpm), value: stats ? stats.tpm : '—', foot: stats ? tr('dont {n} actif(s) selon contrat', { n: stats.tpmActive }) : null },
        { label: tr('Agents actifs'), value: stats ? formatInt(stats.agents) : '—', foot: tr('Agents des TPM') },
        { label: tr('Rapports à valider'), value: stats ? stats.toValidate : '—', foot: tr('Soumis, en attente de décision') },
      ]} />

      <div className="seg pr-tabs" role="tablist" aria-label={tr('Rôle des partenaires')}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={current === t.id} className={current === t.id ? 'is-active' : ''}
            onClick={() => setTab(t.id)}>
            <t.icon size={15} aria-hidden="true" /> {tr(t.label)} <span className="pr-count">{(byRole[t.id] || []).length}</span>
          </button>
        ))}
      </div>

      <DataList
        key={current}
        rows={rows && byRole[current]}
        columns={view.columns}
        defaultColumns={view.defaults}
        filters={filters}
        defaultFilters={['q', 'status']}
        storageKey={view.key} defaultSort={{ key: 'name', dir: 'asc' }}
        onRowDoubleClick={open}
        csvName={view.csv} emptyIcon={Handshake} emptyTitle={tr(view.empty)}
        emptyAction={canEdit && <Button icon={Settings} onClick={() => onNavigate('parametrage', 'partenaires')}>{tr('Créer dans Paramétrage')}</Button>}
        emptyChildren={view.emptyText ? tr(view.emptyText) : null}
      />
    </div>
  );
}
