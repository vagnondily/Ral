import React, { useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { currentMonth, monthLabel } from '../lib/format.js';
import { usePopover } from './listView.jsx';

const MONTHS_SHORT = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

/**
 * Sélecteur de mois : on ouvre la LISTE des mois et on clique sur le mois voulu
 * pour afficher son plan (plutôt qu'un pas-à-pas gauche/droite). Un sélecteur
 * d'année permet de changer d'année ; « Ce mois-ci » revient au mois courant.
 */
export default function MonthPicker({ value, onChange }) {
  const pop = usePopover();
  const cur = currentMonth();
  const [y, m] = (value || cur).split('-').map(Number);
  const [year, setYear] = useState(y);
  const [curY, curM] = cur.split('-').map(Number);

  function pick(mi) { onChange(`${year}-${String(mi + 1).padStart(2, '0')}`); pop.setOpen(false); }

  return (
    <div className="month-dd pop-anchor" ref={pop.ref}>
      <button type="button" className="btn btn-secondary month-dd-trigger" onClick={() => { setYear(y); pop.setOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={pop.open}>
        <Calendar size={16} aria-hidden="true" />
        <span className="month-dd-label">{monthLabel(value)}</span>
        <ChevronRight size={15} aria-hidden="true" className="month-dd-caret" />
      </button>
      {pop.open && (
        <div className="pop-menu month-dd-panel" role="menu">
          <div className="month-dd-year">
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setYear((v) => v - 1)} aria-label="Année précédente"><ChevronLeft size={16} /></button>
            <span className="month-dd-year-label">{year}</span>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setYear((v) => v + 1)} aria-label="Année suivante"><ChevronRight size={16} /></button>
          </div>
          <div className="month-dd-grid">
            {MONTHS_SHORT.map((lbl, i) => {
              const sel = year === y && i + 1 === m;
              const isCur = year === curY && i + 1 === curM;
              return (
                <button type="button" key={lbl} className={`month-cell ${sel ? 'is-selected' : ''} ${isCur ? 'is-current' : ''}`} onClick={() => pick(i)}>
                  {sel && <Check size={13} aria-hidden="true" />}{lbl}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn btn-ghost month-dd-today" onClick={() => { onChange(cur); pop.setOpen(false); }}>Ce mois-ci</button>
        </div>
      )}
    </div>
  );
}
