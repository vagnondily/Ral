import React, { useEffect, useState } from 'react';
import { GraduationCap, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Badge, Button, EmptyState, Skeleton, StatusBadge } from '../../../components/ui.jsx';
import { formatDate } from '../../../lib/contracts.js';
import { ATTENDANCE, TRAINING_STATUS, formatPct } from '../../../lib/trainings.js';
import { useI18n } from '../../../lib/i18n.jsx';

/**
 * Formations suivies par les agents du prestataire (sessions, retour 28.2) : une carte par
 * session — dates, thèmes, statut — et ses agents avec présence, pré-test → post-test et
 * réussite. Le prestataire est celui de l'agent AU MOMENT de la formation.
 */
export default function ProviderTrainingsTab({ providerId, canEdit, onNavigate }) {
  const { tr } = useI18n();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.trainingsByProvider(providerId).then(setRows).catch((e) => { setError(e.message); setRows([]); }); }, [providerId]);

  if (rows === null) return <div className="card-body"><Skeleton height={120} /></div>;
  if (error) return <div className="card-body"><Alert tone="error">{error}</Alert></div>;
  const toolbar = (
    <div className="data-toolbar">
      <div className="data-toolbar-left"><span className="muted">{tr('Formations suivies par les agents de ce TPM.')}</span></div>
      <div className="data-toolbar-right">
        {canEdit && <Button size="sm" icon={Plus} onClick={() => onNavigate('tpm', 'formations', 'nouvelle')}>{tr('Nouvelle formation')}</Button>}
      </div>
    </div>
  );
  if (!rows.length) {
    return <>{toolbar}<EmptyState icon={GraduationCap} title={tr('Aucune formation')}>{tr('Aucun agent de ce TPM n\'a encore participé à une formation.')}</EmptyState></>;
  }
  const att = (a) => (a ? tr((ATTENDANCE.find((x) => x.id === a) || {}).label) : '—');
  return (
    <>
      {toolbar}
      <div className="table-wrap">
        <table className="table tr-grid">
          <thead><tr>
            <th scope="col">{tr('Agent')}</th><th scope="col">{tr('Présence')}</th><th scope="col" className="num">{tr('Pré-test')}</th>
            <th scope="col" className="num">{tr('Post-test')}</th><th scope="col" className="num">{tr('Progression')}</th><th scope="col">{tr('Résultat')}</th>
          </tr></thead>
          {rows.map((s) => (
            <tbody key={s.id}>
              <tr className="tr-group">
                <th scope="rowgroup" colSpan={6}>
                  <div className="tr-session-head">
                    <button type="button" className="inline-link pv-left" onClick={() => onNavigate('tpm', 'formations', s.id)}>{s.title}</button>
                    <span className="muted tabular">{s.startDate === s.endDate ? formatDate(s.startDate) : `${formatDate(s.startDate)} – ${formatDate(s.endDate)}`}</span>
                    <StatusBadge map={TRAINING_STATUS} value={s.status} />
                    {s.themes.length > 0 && <span className="muted">{s.themes.map((t) => t.label).join(' · ')}</span>}
                  </div>
                </th>
              </tr>
              {s.agents.map((a) => (
                <tr key={a.agentId}>
                  <td>{a.agentName}</td>
                  <td>{att(a.attendance)}</td>
                  <td className="num tabular">{formatPct(a.prePct, tr)}</td>
                  <td className="num tabular">{formatPct(a.postPct, tr)}</td>
                  <td className="num tabular">{a.progress == null ? '—' : `${a.progress > 0 ? '+' : ''}${tr('{p} pts', { p: a.progress })}`}</td>
                  <td>{a.pass == null ? <span className="cell-empty">—</span> : a.pass ? <Badge tone="green" icon={CheckCircle2}>{tr('Réussi')}</Badge> : <Badge tone="orange" icon={AlertTriangle}>{tr('À revoir')}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
