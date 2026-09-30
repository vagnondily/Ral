import React from 'react';
import { Handshake, UserRound, Banknote, ShieldAlert, Lock } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { Alert, Button, RiskBadge } from '../components/ui.jsx';
import { dayLabel, formatAr, monthGrid, monthLabel, todayISO } from '../lib/format.js';

const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function MissionCalendarDrawer({ open, onClose, month, assignment, provider, selectedDays, editable, lockReason, onToggle }) {
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
      title="Calendrier de mission"
      subtitle={`${assignment.siteName} · ${assignment.commune || '—'}`}
      footer={<Button onClick={onClose}>Terminé</Button>}
    >
      <div className="cal-meta">
        <p className="fact">
          <Handshake size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">Prestataire</span><strong>{provider?.name || '—'}</strong></span>
        </p>
        <p className="fact">
          <UserRound size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">Agent</span><strong>{assignment.tpmAgentName || <span className="muted">Non désigné</span>}</strong></span>
        </p>
        <p className="fact">
          <Banknote size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">Barème</span><strong className="tabular">{formatAr(rate)}</strong> <span className="muted">/ jour</span></span>
        </p>
        <p className="fact">
          <ShieldAlert size={16} aria-hidden="true" />
          <span><span className="cal-meta-label">Niveau de risque</span><RiskBadge level={assignment.riskLevel} /></span>
        </p>
      </div>

      {!editable && <Alert tone="info" icon={Lock}>{lockReason}</Alert>}

      <div className="cal-month">
        <span>{monthLabel(month)}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>
          {editable ? 'Cliquez sur un jour pour le planifier' : 'Lecture seule'}
        </span>
      </div>

      <div className="cal-grid" role="group" aria-label={`Jours de mission, ${monthLabel(month)}`}>
        {DOW.map((d) => (
          <span key={d} className="cal-dow" aria-hidden="true">{d}</span>
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
              aria-label={`${dayLabel(c.iso)}${selected.has(c.iso) ? ', mission planifiée' : ''}`}
              disabled={!editable}
              onClick={() => onToggle(c.iso)}
            >
              {c.day}
            </button>
          )
        )}
      </div>

      <div className="cal-legend" aria-hidden="true">
        <span><i style={{ background: 'var(--blue-600)', borderColor: 'var(--blue-600)' }} /> Mission planifiée</span>
        <span><i style={{ borderColor: 'var(--blue-500)', borderWidth: 2 }} /> Aujourd'hui</span>
        <span><i style={{ background: 'var(--canvas)' }} /> Week-end</span>
      </div>

      <div className="cal-summary">
        <span>
          <strong className="tabular">{selected.size}</strong> jour{selected.size > 1 ? 's' : ''} planifié{selected.size > 1 ? 's' : ''}
        </span>
        <span>
          Coût estimé <strong className="tabular">{formatAr(selected.size * rate)}</strong>
        </span>
      </div>
    </Modal>
  );
}
