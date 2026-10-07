import React from 'react';
import { currentMonth, monthLabel } from '../lib/format.js';

/**
 * Sélecteur de mois minimal : un simple menu déroulant natif (`.select`),
 * cohérent avec les autres contrôles de l'app — pas de widget calendrier.
 * Fenêtre par défaut : `back` mois en arrière → `forward` mois en avant.
 */
export default function MonthSelect({ value, onChange, back = 18, forward = 3, ariaLabel = 'Mois', className = '' }) {
  const cur = currentMonth();
  const [cy, cm] = cur.split('-').map(Number);
  const opts = [];
  for (let i = -forward; i <= back; i += 1) {
    const d = new Date(Date.UTC(cy, cm - 1 - i, 1));
    opts.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const val = value || cur;
  if (!opts.includes(val)) opts.unshift(val); // garde la valeur courante même hors fenêtre
  return (
    <select className={`select month-select ${className}`} value={val} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {opts.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </select>
  );
}
