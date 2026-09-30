import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { currentMonth, monthLabel, shiftMonth } from '../lib/format.js';

/** French month stepper — replaces <input type="month">, whose label follows
 * the browser's locale (it showed "September 2026" in an all-French UI). */
export default function MonthPicker({ value, onChange }) {
  const isCurrent = value === currentMonth();
  return (
    <div className="month-picker" role="group" aria-label="Choisir le mois du plan">
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Mois précédent" title="Mois précédent">
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <span className="month-label" aria-live="polite">{monthLabel(value)}</span>
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Mois suivant" title="Mois suivant">
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {!isCurrent && (
        <button type="button" className="btn btn-ghost today-btn" onClick={() => onChange(currentMonth())}>
          Ce mois-ci
        </button>
      )}
    </div>
  );
}
