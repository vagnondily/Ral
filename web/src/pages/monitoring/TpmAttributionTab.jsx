import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, Download, History, ListChecks, PencilLine, RefreshCw, RotateCcw, Search, Undo2, X,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, EmptyState, Skeleton, StatusBadge, Stats } from '../../components/ui.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { currentMonth, formatInt, monthLabel, shiftMonth, shortMonthLabel } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';
import { ROW_FLAGS, TPM_FLAGS, TPM_ZONE_STATE, applyResultMessage, rangeLabel } from '../../lib/tpmAttribution.js';
import TpmChangeDialog from './TpmChangeDialog.jsx';
import TpmAttributionLog from './TpmAttributionLog.jsx';
import './planBoard.css';
import './tpmAttribution.css';

/**
 * Onglet « Affectation des TPM » de l'espace RBM (retour 58) — adresse #/processus/rbm/tpm.
 * Qui suit quelle zone, mois par mois : par région › district (› commune quand un contrat ou une
 * modification y descend), le TPM SELON CONTRAT (recalculé, jamais saisi) et le TPM RETENU ; tout
 * changement exige une raison et reste au journal ; les visites prévues reprennent le TPM de leur
 * zone. Calculs côté serveur (/api/tpm/attribution) ; l'écran n'affiche que.
 * Props : { canEdit } (admin / manager : modifier, revenir au contrat, appliquer aux visites).
 */
const PILLS = [
  ['all', 'Toutes'], ['modifie', 'Modifiées'], ['a_confirmer', 'À confirmer'], ['sans_contrat', 'Sans contrat'],
  ['a_arbitrer', 'Plusieurs contrats'], ['ecarts', 'Écarts avec les visites'],
];
const contractHref = (id) => `#/contrats/liste/${id}`;
const sumVisits = (row) => row.visits.reduce((a, v) => ({
  planned: a.planned + v.planned, realised: a.realised + v.realised, divergent: a.divergent + v.divergent,
}), { planned: 0, realised: 0, divergent: 0 });
const hasState = (row, states) => row.segments.some((s) => states.includes(s.state));
const hasFlag = (row, flag) => row.segments.some((s) => (s.flags || []).includes(flag));

export default function TpmAttributionTab({ canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const cur = currentMonth();
  const [period, setPeriod] = useState({ from: cur, to: shiftMonth(cur, 5) });
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('zones'); // 'zones' | 'journal'
  const [filters, setFilters] = useState({ region: '', provider: '', q: '', pill: 'all' });
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [dialog, setDialog] = useState(null); // { mode, areas, title }
  const [logArea, setLogArea] = useState(null); // { id, name } — journal filtré sur une zone
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.tpmAttribution({ period, all })); } catch (e) { setError(e.message); }
  }, [period, all]);
  useEffect(() => { setData(null); setSelected(new Set()); load(); }, [load]);

  const refMonth = period.from <= cur && cur <= period.to ? cur : period.from;
  const refIndex = data ? Math.max(0, data.months.indexOf(refMonth)) : 0;

  const providers = useMemo(() => {
    const m = new Map();
    for (const r of data?.rows || []) for (const s of r.segments) if (s.providerId) m.set(s.providerId, s.providerName);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
  }, [data]);

  const pillTest = {
    all: () => true,
    modifie: (r) => hasState(r, ['modifie', 'aucun_tpm']),
    a_confirmer: (r) => hasFlag(r, 'a_confirmer'),
    sans_contrat: (r) => hasState(r, ['sans_contrat']),
    a_arbitrer: (r) => hasState(r, ['a_arbitrer']),
    ecarts: (r) => sumVisits(r).divergent > 0,
  };
  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => (!filters.region || r.regionId === filters.region)
      && (!filters.provider || r.segments.some((s) => s.providerId === filters.provider))
      && (!q || `${r.name} ${r.path}`.toLowerCase().includes(q))
      && pillTest[filters.pill](r));
  }, [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const pillCount = (k) => (data?.rows || []).filter(pillTest[k]).length;

  const groups = useMemo(() => {
    const out = [];
    for (const r of rows) {
      let g = out[out.length - 1];
      if (!g || g.regionId !== r.regionId) { g = { regionId: r.regionId, regionName: r.regionName, rows: [] }; out.push(g); }
      g.rows.push(r);
    }
    return out;
  }, [rows]);

  // Sites de la zone ce mois : une commune qui a sa propre ligne prend ses sites au district.
  const stats = useMemo(() => {
    if (!data) return null;
    let covered = 0; let none = 0; let modified = 0; let divergent = 0;
    const ownCommune = new Map();
    for (const r of data.rows) if (r.depth === 3 && r.own[refIndex]) ownCommune.set(r.districtId, (ownCommune.get(r.districtId) || 0) + r.sites);
    for (const r of data.rows) {
      const sites = r.depth === 3 ? (r.own[refIndex] ? r.sites : 0) : r.sites - (ownCommune.get(r.id) || 0);
      const c = r.cells[refIndex];
      if (c && c.providerId) covered += sites; else none += sites;
      if (hasState(r, ['modifie', 'aucun_tpm'])) modified += 1;
      divergent += sumVisits(r).divergent;
    }
    return { covered, none, modified, divergent };
  }, [data, refIndex]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedRows = (data?.rows || []).filter((r) => selected.has(r.id));
  const openChange = (areas, title, mode = 'modifier') => setDialog({ mode, areas: areas.map((r) => ({ id: r.id, name: r.name, path: r.path, depth: r.depth })), title });

  async function applyContracts() {
    if (!window.confirm(tr('Appliquer les TPM des contrats aux visites prévues de {p} ? Une visite au TPM choisi avec une raison, réalisée, annulée ou déjà facturée ne change pas.', { p: rangeLabel(period.from, period.to) }))) return;
    setApplying(true);
    try {
      const r = await api.tpmAttributionApply({ from: period.from, to: period.to });
      toast.success(applyResultMessage(tr, r.visits, 'Toutes les visites prévues de la période portent déjà le TPM de leur zone.'));
      load();
    } catch (e) { toast.error(e.message); } finally { setApplying(false); }
  }

  function exportCsv() {
    const head = [tr('Région'), tr('Zone'), tr('Niveau'), tr('Sites'), tr('Du'), tr('Au'), tr('TPM selon contrat'), tr('Contrat'), tr('TPM retenu'), tr('État'), tr('Raison')];
    const lines = [head];
    for (const r of rows) {
      for (const s of r.segments) {
        const c = r.contractSegments.find((x) => x.from <= s.from && s.from <= x.to) || {};
        lines.push([r.regionName, r.name, r.depth === 3 ? tr('Commune') : tr('District'), r.sites, s.from, s.to,
          c.providerName || tr((TPM_ZONE_STATE[c.state] || {}).label || ''), c.contractLabel || '', s.providerName || '',
          tr((TPM_ZONE_STATE[s.state] || {}).label || s.state), s.override ? s.override.reason : '']);
      }
    }
    downloadCsv(`affectation_tpm_${period.from}_${period.to}.csv`, lines);
  }

  const q = data?.quality;
  const editCols = canEdit ? 1 : 0;
  return (
    <div className="section-gap tpa">
      <div className="tpa-head">
        <div className="tpa-period" role="group" aria-label={tr('Période')}>
          <label>{tr('Du')} <MonthSelect value={period.from} back={24} forward={18} ariaLabel={tr('Premier mois')} onChange={(m) => setPeriod((p) => ({ from: m, to: p.to < m ? m : (monthsSpan(m, p.to) > 24 ? shiftMonth(m, 23) : p.to) }))} /></label>
          <label>{tr('au')} <MonthSelect value={period.to} back={24} forward={18} ariaLabel={tr('Dernier mois')} onChange={(m) => setPeriod((p) => ({ from: p.from > m ? m : (monthsSpan(p.from, m) > 24 ? shiftMonth(m, -23) : p.from), to: m }))} /></label>
          <span className="tpa-presets">
            <button type="button" className="tpm-chip" onClick={() => setPeriod({ from: cur, to: cur })}>{tr('Ce mois')}</button>
            <button type="button" className="tpm-chip" onClick={() => setPeriod({ from: cur, to: shiftMonth(cur, 5) })}>{tr('6 prochains mois')}</button>
            <button type="button" className="tpm-chip" onClick={() => setPeriod({ from: `${cur.slice(0, 4)}-01`, to: `${cur.slice(0, 4)}-12` })}>{tr('Année {y}', { y: cur.slice(0, 4) })}</button>
          </span>
        </div>
        <span className="mmr-spacer" />
        <div className="seg" role="tablist" aria-label={tr('Vue')}>
          <button type="button" role="tab" aria-selected={view === 'zones'} className={view === 'zones' ? 'is-active' : ''} onClick={() => setView('zones')}><ListChecks size={14} aria-hidden="true" /> {tr('Zones')}</button>
          <button type="button" role="tab" aria-selected={view === 'journal'} className={view === 'journal' ? 'is-active' : ''} onClick={() => { setLogArea(null); setView('journal'); }}><History size={14} aria-hidden="true" /> {tr('Journal')}</button>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {view === 'journal' ? (
        <TpmAttributionLog area={logArea} onClearArea={() => setLogArea(null)} />
      ) : (
        <>
          <p className="tpm-rule-note">
            {tr('Par défaut, le TPM d\'une zone est celui du contrat de suivi qui la couvre ce mois-là (le TPM qui facture sur ce contrat, sinon son titulaire). Tout changement exige une raison et reste au journal ; les visites prévues reprennent le TPM de leur zone.')}
          </p>

          {q && <QualityBanners quality={q} />}

          {!data ? <Skeleton height={96} /> : (
            <Stats items={[
              { label: tr('Sites avec un TPM ({m})', { m: shortMonthLabel(refMonth) }), value: formatInt(stats.covered), foot: tr('selon contrat ou modifié') },
              { label: tr('Sites à affecter ({m})', { m: shortMonthLabel(refMonth) }), value: formatInt(stats.none), foot: tr('aucun contrat actif sur leur zone') },
              { label: tr('Zones modifiées'), value: formatInt(stats.modified), foot: tr('sur la période, avec une raison') },
              { label: tr('Visites prévues qui s\'écartent'), value: formatInt(stats.divergent), foot: tr('TPM différent de celui de la zone') },
            ]} />
          )}

          <div className="card tpa-card">
            <div className="pb-filters tpa-filters">
              <label className="pb-search">
                <Search size={15} aria-hidden="true" />
                <input className="input" placeholder={tr('District, commune…')} value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
              </label>
              <select className={`select pb-filter ${filters.region ? 'is-set' : ''}`} value={filters.region} onChange={(e) => setFilter('region', e.target.value)} aria-label={tr('Région')}>
                <option value="">{tr('Toutes les régions')}</option>
                {(data?.regions || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <select className={`select pb-filter ${filters.provider ? 'is-set' : ''}`} value={filters.provider} onChange={(e) => setFilter('provider', e.target.value)} aria-label={tr('TPM')}>
                <option value="">{tr('Tous les TPM')}</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label className="tpa-all"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {tr('Tous les districts')}</label>
              <span className="mmr-spacer" />
              <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!data}>{tr('Exporter (CSV)')}</Button>
              {canEdit && <Button size="sm" variant="secondary" icon={RefreshCw} loading={applying} onClick={applyContracts}>{tr('Appliquer les TPM des contrats')}</Button>}
            </div>
            <div className="tpa-pills" role="group" aria-label={tr('Filtrer les zones')}>
              {PILLS.map(([k, l]) => (
                <button key={k} type="button" className={`tpa-pill ${filters.pill === k ? 'is-active' : ''}`} aria-pressed={filters.pill === k} onClick={() => setFilter('pill', k)}>
                  {tr(l)} <span className="tpa-pill-n">{data ? formatInt(pillCount(k)) : '…'}</span>
                </button>
              ))}
            </div>

            {selected.size > 0 && canEdit && (
              <div className="pb-selbar" role="region" aria-label={tr('Sélection')}>
                <strong>{tr('{n} zone(s) sélectionnée(s)', { n: formatInt(selected.size) })}</strong>
                <Button size="sm" variant="secondary" icon={PencilLine} onClick={() => openChange(selectedRows, tr('Changer le TPM de {n} zone(s)', { n: formatInt(selectedRows.length) }))}>{tr('Changer le TPM…')}</Button>
                <Button size="sm" variant="ghost" icon={Undo2} onClick={() => openChange(selectedRows, tr('Revenir au contrat ({n} zones)', { n: formatInt(selectedRows.length) }), 'revenir')}>{tr('Revenir au contrat')}</Button>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>{tr('Désélectionner')}</Button>
              </div>
            )}

            {!data ? <div className="card-body"><Skeleton height={320} /></div> : rows.length === 0 ? (
              <EmptyState title={tr('Aucune zone')}>{tr('Aucun site ni contrat ne correspond à ces filtres sur la période.')}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table tpa-table">
                  <thead>
                    <tr>
                      {canEdit && <th scope="col" className="tpa-check"><span className="sr-only">{tr('Sélection')}</span></th>}
                      <th scope="col" className="tpa-zone">{tr('Zone')}</th>
                      <th scope="col" className="num">{tr('Sites')}</th>
                      <th scope="col">{tr('Contrat(s) de suivi')}</th>
                      <th scope="col">{tr('TPM retenu, mois par mois')}</th>
                      <th scope="col">{tr('Visites (période)')}</th>
                      <th scope="col" className="tpa-actions"><span className="sr-only">{tr('Actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const open = !collapsed.has(g.regionId);
                      const districts = g.rows.filter((r) => r.depth === 2);
                      const names = [...new Set(g.rows.flatMap((r) => r.segments.map((s) => s.providerName).filter(Boolean)))];
                      return (
                        <React.Fragment key={g.regionId}>
                          <tr className="tpa-region">
                            <th scope="rowgroup" colSpan={6 + editCols}>
                              <div className="tpa-region-in">
                                <button type="button" className="expander" aria-expanded={open} onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.regionId)) n.delete(g.regionId); else n.add(g.regionId); return n; })}
                                  aria-label={open ? tr('Replier : {label}', { label: g.regionName }) : tr('Déplier : {label}', { label: g.regionName })}>
                                  <ChevronRight size={16} aria-hidden="true" />
                                </button>
                                <strong>{g.regionName}</strong>
                                <span className="muted">{tr('{d} district(s) · {s} site(s)', { d: formatInt(districts.length), s: formatInt(districts.reduce((a, r) => a + r.sites, 0)) })}</span>
                                {names.length > 0 && <span className="tpa-names">{names.join(' · ')}</span>}
                                <span className="mmr-spacer" />
                                {canEdit && districts.length > 0 && (
                                  <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => openChange(districts, tr('Changer le TPM de la région {r}', { r: g.regionName }))}>{tr('Modifier toute la région…')}</Button>
                                )}
                              </div>
                            </th>
                          </tr>
                          {open && g.rows.map((r) => <ZoneRow key={r.id} row={r} canEdit={canEdit} selected={selected.has(r.id)} onSelect={() => toggleSel(r.id)}
                            onChange={() => openChange([r], tr('Changer le TPM · {z}', { z: r.name }))}
                            onRevert={() => openChange([r], tr('Revenir au contrat · {z}', { z: r.name }), 'revenir')}
                            onHistory={() => { setLogArea({ id: r.id, name: r.name }); setView('journal'); }} />)}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {dialog && (
        <TpmChangeDialog mode={dialog.mode} areas={dialog.areas} title={dialog.title} period={period}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setSelected(new Set()); load(); }} />
      )}
    </div>
  );
}

const monthsSpan = (a, b) => {
  const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma) + 1;
};

/** Ce que dit le contrat sur un segment (« SAHY Monitoring (FLA-…) », « aucun contrat »). */
function contractText(tr, c) {
  if (!c) return '';
  if (c.state === 'a_arbitrer') return tr('{n} contrats : choisir', { n: (c.candidates || []).length });
  if (!c.providerName) return tr('aucun contrat');
  return c.contractLabel ? `${c.providerName} (${c.contractLabel})` : c.providerName;
}

/**
 * Une ligne de zone (district, ou commune en retrait) : contrats de suivi qui la couvrent, puis le
 * TPM RETENU mois par mois (couleur + icône + libellé) ; sous une modification, ce que dit le
 * contrat et la raison — la valeur par défaut reste lisible à côté de l'écart.
 */
function ZoneRow({ row, canEdit, selected, onSelect, onChange, onRevert, onHistory }) {
  const { tr } = useI18n();
  const v = sumVisits(row);
  const contracts = [];
  const seen = new Set();
  for (const s of row.contractSegments) {
    for (const c of s.candidates || []) {
      if (seen.has(c.contractId)) continue;
      seen.add(c.contractId);
      contracts.push(c);
    }
  }
  const multi = row.segments.length > 1;
  const modified = row.segments.some((s) => s.override);
  const contractAt = (m) => row.contractSegments.find((c) => c.from <= m && m <= c.to);
  return (
    <tr className={`${row.depth === 3 ? 'tpa-commune' : ''} ${selected ? 'is-selected' : ''}`}>
      {canEdit && <td className="tpa-check"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={tr('Sélectionner {n}', { n: row.name })} /></td>}
      <td className="tpa-zone">
        <strong>{row.name}</strong>
        {row.depth === 3 && <span className="tpa-tag">{tr('commune')}</span>}
      </td>
      <td className="num tabular">{formatInt(row.sites)}</td>
      <td className="tpa-contracts">
        {contracts.length === 0 ? <span className="muted">{tr('aucun contrat de suivi')}</span> : contracts.map((c) => (
          <a key={c.contractId} className="tpa-contract" href={contractHref(c.contractId)} title={tr('Ouvrir le contrat')}>
            <span className="mono">{c.contractLabel || c.numero}</span>
            <span className="muted">{c.providerName}{c.endMonth ? ` · ${tr('jusqu\'à {m}', { m: shortMonthLabel(c.endMonth) })}` : ''}</span>
          </a>
        ))}
      </td>
      <td className="tpa-segs">
        {row.segments.map((s) => {
          const c = contractAt(s.from);
          return (
            <div key={s.from} className="tpa-seg">
              <div className="tpa-seg-main">
                <StatusBadge def={TPM_ZONE_STATE[s.state]} />
                {s.providerName && <span className="tpa-seg-name">{s.providerName}</span>}
                {multi && <span className="tpa-seg-range">{rangeLabel(s.from, s.to)}</span>}
                {(s.flags || []).filter((f) => ROW_FLAGS.includes(f) && f !== 'partiel').map((f) => <StatusBadge key={f} def={TPM_FLAGS[f]} />)}
              </div>
              {s.override && (
                <div className="tpa-seg-why" title={`${s.override.reason}${s.override.by ? ` — ${s.override.by}` : ''}${s.override.at ? `, ${String(s.override.at).slice(0, 10)}` : ''}`}>
                  {tr('selon contrat : {c}', { c: contractText(tr, c) })} · <span className="tpa-reason-text">{s.override.reason}</span>
                </div>
              )}
              {!s.override && s.state === 'a_arbitrer' && (
                <div className="tpa-seg-why">{tr('TPM par défaut du contrat le plus récent ; confirmez ou choisissez.')}</div>
              )}
            </div>
          );
        })}
      </td>
      <td className="tpa-visits">
        <span className="tabular">{tr('{n} prévue(s)', { n: formatInt(v.planned) })}</span>
        <span className="tabular muted">{tr('{n} réalisée(s)', { n: formatInt(v.realised) })}</span>
        {v.divergent > 0 && <span className="tpa-diff">{tr('{n} écart(s)', { n: formatInt(v.divergent) })}</span>}
      </td>
      <td className="tpa-actions">
        {canEdit && <button type="button" className="tpm-edit" onClick={onChange} aria-label={tr('Changer le TPM · {z}', { z: row.name })} title={tr('Changer le TPM…')}><PencilLine size={14} aria-hidden="true" /></button>}
        {canEdit && modified && <button type="button" className="tpm-edit" onClick={onRevert} aria-label={tr('Revenir au contrat · {z}', { z: row.name })} title={tr('Revenir au contrat')}><RotateCcw size={14} aria-hidden="true" /></button>}
        <button type="button" className="tpm-edit" onClick={onHistory} aria-label={tr('Historique · {z}', { z: row.name })} title={tr('Historique')}><History size={14} aria-hidden="true" /></button>
      </td>
    </tr>
  );
}

/** Bannières de qualité des données qui alimentent la règle — chacune dit quoi faire. */
function QualityBanners({ quality: q }) {
  const { tr } = useI18n();
  const out = [];
  if (q.detachedContractZones.length) {
    out.push(
      <Alert key="detached" tone="warn">
        <strong>{tr('Zone de contrat à resélectionner')}</strong>{' '}
        {tr('{n} zone(s) de contrat ne correspondent plus au découpage (réimporté) : elles ne donnent aucun TPM tant qu\'elles ne sont pas resélectionnées par avenant.', { n: formatInt(q.detachedContractZones.length) })}
        <ul className="linked-list">
          {q.detachedContractZones.map((z) => (
            <li key={`${z.contractId}${z.path}`}><a href={contractHref(z.contractId)}>{z.numero}</a> · {z.path}{z.holder ? ` (${z.holder})` : ''}</li>
          ))}
        </ul>
      </Alert>,
    );
  }
  if (q.expiredStillActive.length) {
    out.push(
      <Alert key="expired" tone="warn">
        {tr('Contrat(s) échu(s) mais encore « actif(s) » : leurs zones n\'ont plus de TPM selon contrat après la date de fin. Renouvelez, résiliez ou modifiez le TPM de ces zones.')}
        <ul className="linked-list">
          {q.expiredStillActive.map((c) => <li key={c.contractId}><a href={contractHref(c.contractId)}>{c.numero}</a>{c.holder ? ` · ${c.holder}` : ''} · {tr('fin {m}', { m: monthLabel(c.endMonth) })}</li>)}
        </ul>
      </Alert>,
    );
  }
  if ((q.contractsWithoutTpm || []).length) {
    out.push(
      <Alert key="notpm" tone="info">
        {tr('{n} contrat(s) de suivi sans TPM rattaché (aucun plan de collecte ni facture d\'un TPM) : leur titulaire est retenu comme TPM.', { n: formatInt(q.contractsWithoutTpm.length) })}{' '}
        {q.contractsWithoutTpm.map((c) => `${c.numero}${c.holder ? ` (${c.holder})` : ''}`).join(' · ')}
      </Alert>,
    );
  }
  if (q.sitesWithoutDistrict > 0) {
    out.push(
      <Alert key="nodistrict" tone="info">
        {tr('{n} site(s) sans district reconnu n\'héritent d\'aucun TPM.', { n: formatInt(q.sitesWithoutDistrict) })}{' '}
        <a href="#/parametrage/localites">{tr('Rapprocher dans Paramétrage › Localités')}</a>
      </Alert>,
    );
  }
  if (q.detachedOverrides.length) {
    out.push(<Alert key="detov" tone="warn">{tr('{n} modification(s) portent sur une zone qui n\'existe plus dans le découpage : sans effet.', { n: formatInt(q.detachedOverrides.length) })}</Alert>);
  }
  return out.length ? <div className="tpa-banners">{out}</div> : null;
}
