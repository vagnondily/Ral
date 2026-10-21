import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, EmptyState, Skeleton, StatusBadge } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatDateTime, formatInt, shortMonthLabel } from '../../lib/format.js';
import { TPM_AVAILABILITY, TPM_LOG_ACTION, logLabelText, logReasonText, rangeLabel, tpmStateLabel } from '../../lib/tpmAttribution.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import './tpmAttribution.css';

const PAGE = 50;

/**
 * Journal de l'affectation des TPM (retour 58) — inaltérable (tpm_attribution_log) : un lot par
 * décision (qui, quand, quoi, raison, combien de zone-mois et de visites), et sur demande le détail
 * zone × mois ou visite par visite, avant → après (noms en instantané : un prestataire renommé
 * reste lisible tel qu'il était). Filtre par zone (depuis l'historique d'une ligne) et par action.
 * @param {{ area: { id, name }|null, onClearArea: () => void }} props
 */
export default function TpmAttributionLog({ area, onClearArea }) {
  const { tr } = useI18n();
  // Raison d'un lot : traduite quand le système l'a écrite (code), telle quelle quand une personne l'a saisie.
  const reasonOf = (l) => logReasonText(tr, l);
  const [action, setAction] = useState('');
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(() => new Map()); // batchId → lignes (null : en lecture)

  const load = useCallback(async (offset = 0) => {
    setError(null);
    try {
      const r = await api.tpmAttributionLog({ areaId: area ? area.id : undefined, action: action || undefined, limit: PAGE, offset });
      setItems((list) => (offset ? [...(list || []), ...r.items] : r.items));
      setTotal(r.total);
    } catch (e) { setError(e.message); }
  }, [area, action]);
  useEffect(() => { setItems(null); setOpen(new Map()); load(0); }, [load]);

  async function toggle(batchId) {
    if (open.has(batchId)) { setOpen((m) => { const n = new Map(m); n.delete(batchId); return n; }); return; }
    setOpen((m) => new Map(m).set(batchId, null));
    try {
      const r = await api.tpmAttributionLog({ batchId });
      setOpen((m) => (m.has(batchId) ? new Map(m).set(batchId, r.items) : m));
    } catch (e) {
      setError(e.message);
      setOpen((m) => { const n = new Map(m); n.delete(batchId); return n; });
    }
  }

  async function loadMore() {
    setMore(true);
    try { await load(items.length); } finally { setMore(false); }
  }

  return (
    <div className="card tpa-card">
      <div className="pb-filters tpa-filters">
        {area && (
          <span className="tpa-filter-chip">
            {tr('Zone : {z}', { z: area.name })}
            <button type="button" onClick={onClearArea} aria-label={tr('Toutes les zones')}><X size={13} aria-hidden="true" /></button>
          </span>
        )}
        <select className={`select pb-filter ${action ? 'is-set' : ''}`} value={action} onChange={(e) => setAction(e.target.value)} aria-label={tr('Action')}>
          <option value="">{tr('Toutes les actions')}</option>
          {Object.entries(TPM_LOG_ACTION).map(([k, d]) => <option key={k} value={k}>{tr(d.label)}</option>)}
        </select>
        <span className="mmr-spacer" />
        {items && <span className="muted">{tr('{n} décision(s) au journal', { n: formatInt(total) })}</span>}
      </div>
      {error && <div className="card-body"><Alert tone="danger">{error}</Alert></div>}
      {!items ? <div className="card-body"><Skeleton height={240} /></div> : items.length === 0 ? (
        <EmptyState title={tr('Journal vide')}>{area ? tr('Aucune décision sur cette zone.') : tr('Aucune décision pour l\'instant : les TPM suivent les contrats.')}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table tpa-log">
            <thead>
              <tr>
                <th scope="col" className="tpa-check"><span className="sr-only">{tr('Détail')}</span></th>
                <th scope="col">{tr('Quand')}</th>
                <th scope="col">{tr('Qui')}</th>
                <th scope="col">{tr('Action')}</th>
                <th scope="col">{tr('Portée')}</th>
                <th scope="col">{tr('Raison')}</th>
                <th scope="col">{tr('Changements')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const details = open.get(l.batchId);
                const expanded = open.has(l.batchId);
                return (
                  <React.Fragment key={l.id}>
                    <tr className={expanded ? 'is-selected' : ''}>
                      <td className="tpa-check">
                        <button type="button" className="expander" aria-expanded={expanded} onClick={() => toggle(l.batchId)}
                          aria-label={expanded ? tr('Replier : {label}', { label: l.label }) : tr('Déplier : {label}', { label: l.label })}>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      </td>
                      <td className="tabular tpa-log-when">{formatDateTime(l.changedAt)}</td>
                      <td className="tpa-log-who">{l.changedByName || <span className="muted">{tr('Reprise automatique')}</span>}</td>
                      <td className="nowrap"><StatusBadge def={TPM_LOG_ACTION[l.action]} /></td>
                      <td className="tpa-log-scope">{logLabelText(tr, l)}<div className="site-meta">{rangeLabel(l.monthFrom, l.monthTo)}</div></td>
                      <td className="tpa-reason">{reasonOf(l) ? <span className="tpa-reason-text" title={reasonOf(l)}>{reasonOf(l)}</span> : <span className="cell-empty">—</span>}</td>
                      <td className="tpa-log-counts tabular">
                        {l.zonesChanged != null && <span>{tr('{n} zone-mois', { n: formatInt(l.zonesChanged) })}</span>}
                        <span>{tr('{n} visite(s)', { n: formatInt(l.visitsUpdated || 0) })}</span>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="tpa-log-detail">
                        <td />
                        <td colSpan={6}>
                          {details === null ? <Skeleton height={48} /> : details.length === 0
                            ? <span className="muted">{tr('Aucun changement visite par visite (rien n\'a changé).')}</span>
                            : <LogDetails rows={details} />}
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
      {items && items.length < total && (
        <div className="card-body tpa-more">
          <Button size="sm" variant="secondary" loading={more} onClick={loadMore}>{tr('Afficher {n} de plus', { n: formatInt(Math.min(PAGE, total - items.length)) })}</Button>
        </div>
      )}
    </div>
  );
}

/** Détail d'un lot : zone × mois, visite, ou TPM × mois (indisponibilité, retour 114), avant → après. */
function LogDetails({ rows }) {
  const { tr } = useI18n();
  const shown = rows.slice(0, 200);
  const who = (name, state) => (name || (state ? tr(tpmStateLabel(state)) : tr(ROLE_LABELS.noTpm)));
  const avail = (state) => tr((TPM_AVAILABILITY[state] || {}).label || state || '');
  return (
    <>
      <ul className="tpa-log-lines">
        {shown.map((r) => (r.scope === 'tpm' ? (
          <li key={r.id}>
            <span className="tpa-log-where">{r.label}{r.month ? ` · ${shortMonthLabel(r.month)}` : ''}</span>
            <span className="tpa-log-change">
              <span className="muted">{avail(r.oldState)}{r.oldReason ? ` (${r.oldReason})` : ''}</span>
              <ArrowRight size={13} aria-hidden="true" />
              <strong>{avail(r.newState)}</strong>
              {r.newState === 'indisponible' && r.reason && <span className="muted"> ({r.reason})</span>}
            </span>
          </li>
        ) : (
          <li key={r.id}>
            <span className="tpa-log-where">{r.label}{r.month ? ` · ${shortMonthLabel(r.month)}` : ''}</span>
            <span className="tpa-log-change">
              <span className="muted">{who(r.oldProviderName, r.oldState)}</span>
              <ArrowRight size={13} aria-hidden="true" />
              <strong>{who(r.newProviderName, r.newState)}</strong>
              {r.newState && r.newProviderName && <span className="muted"> ({tr(tpmStateLabel(r.newState))})</span>}
            </span>
            {r.contractLabel && <span className="muted tpa-log-contract">{tr('selon contrat : {c}', { c: r.contractLabel })}</span>}
          </li>
        )))}
      </ul>
      {rows.length > shown.length && <span className="muted">{tr('… et {n} autre(s) ligne(s).', { n: formatInt(rows.length - shown.length) })}</span>}
    </>
  );
}
