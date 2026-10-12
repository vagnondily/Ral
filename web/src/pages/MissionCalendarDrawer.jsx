import React from 'react';
import { Handshake, UserRound, Banknote, ShieldAlert, Lock } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { Alert, Button, RiskBadge } from '../components/ui.jsx';
import { dayLabel, formatAr, monthGrid, monthLabel, todayISO } from '../lib/format.js';
import { useI18n } from '../lib/i18n.jsx';

const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function MissionCalendarDrawer({ open, onClose, month, assignment, provider, selectedDays, editable, lockReason, onToggle }) {
  const { tr } = useI18n();
  if (!assignment) return null;
  const cells = monthGrid(month);
  const today = todayISO();
  const selected = new Set(selectedDays);
  const rate = Number(provider?.dailyRate || 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="drawer"
      title={tr('Calendrier de mission')}
      subtitle={`${assignment.siteName} · ${assignment.commune || '—'}`}
      footer={<Button onClick={onClose}>{tr('Terminé')}</Button>}
    >
      <div className="cal-meta">
        <p className="fact">
          <Handshake size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">{tr('Prestataire')}</span><strong>{provider?.name || '—'}</strong></span>
        </p>
        <p className="fact">
          <UserRound size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">{tr('Agent')}</span><strong>{assignment.tpmAgentName || <span className="muted">{tr('Non désigné')}</span>}</strong></span>
        </p>
        <p className="fact">
          <Banknote size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">{tr('Barème')}</span><strong className="tabular">{formatAr(rate)}</strong> <span className="muted">{tr('/ jour')}</span></span>
        </p>
        <p className="fact">
          <ShieldAlert size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">{tr('Niveau de risque')}</span><RiskBadge level={assignment.riskLevel} /></span>
        </p>
      </div>

      {!editable && <Alert tone="info" icon={Lock}>{lockReason}</Alert>}

      <div className="cal-month">
        <span>{monthLabel(month)}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>
          {editable ? tr('Cliquez sur un jour pour le planifier') : tr('Lecture seule')}
        </span>
      </div>

      <div className="cal-grid" role="group" aria-label={tr('Jours de mission, {month}', { month: monthLabel(month) })}>
        {DOW.map((d) => (
          <span key={d} className="cal-dow" aria-hidden="true">{tr(d)}</span>
        ))}
        {cells.map((c, i) =>
          c === null ? (
            <span key={`blank-${i}`} aria-hidden="true" />
          ) : (
            <button
              key={c.iso}
              type="button"
              className={['cal-day', c.weekend && 'is-weekend', c.iso === today && 'is-today', selected.has(c.iso) && 'is-selected']
                .filter(Boolean)
                .join(' ')}
              aria-pressed={selected.has(c.iso)}
              aria-label={selected.has(c.iso) ? tr('{day}, mission planifiée', { day: dayLabel(c.iso) }) : dayLabel(c.iso)}
              disabled={!editable}
              onClick={() => onToggle(c.iso)}
            >
              {c.day}
            </button>
          )
        )}
      </div>

      <div className="cal-legend" aria-hidden="true">
        <span><i style={{ background: 'var(--blue-600)', borderColor: 'var(--blue-600)' }} /> {tr('Mission planifiée')}</span>
        <span><i style={{ borderColor: 'var(--blue-500)', borderWidth: 2 }} /> {tr("Aujourd'hui")}</span>
        <span><i style={{ background: 'var(--canvas)' }} /> {tr('Week-end')}</span>
      </div>

      <div className="cal-summary">
        <span>
          <strong className="tabular">{selected.size}</strong> {tr(selected.size > 1 ? 'jours planifiés' : 'jour planifié')}
        </span>
        <span>
          {tr('Coût estimé')} <strong className="tabular">{formatAr(selected.size * rate)}</strong>
        </span>
      </div>
    </Modal>
  );
}
