import React from 'react';
import { currentMonth, formatInt, monthLabel } from '../lib/format.js';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Sélecteur de mois minimal : un simple menu déroulant natif (`.select`),
 * cohérent avec les autres contrôles de l'app — pas de widget calendrier.
 * Fenêtre par défaut : `back` mois en arrière → `forward` mois en avant.
 *   - `options` : liste fermée de mois (ex. les mois qui ont des données) au lieu de la fenêtre ;
 *   - `counts`  : { 'AAAA-MM': n } affiché à côté du mois ;
 *   - `allowAll`: ajoute « Toutes les périodes » (valeur '') — la valeur vide n'est
 *     alors plus remplacée par le mois courant.
 */
export default function MonthSelect({ value, onChange, back = 18, forward = 3, ariaLabel, className = '', allowAll = false, options, counts }) {
  const { tr } = useI18n();
  const cur = currentMonth();
  let opts;
  if (Array.isArray(options)) {
    opts = [...options].sort().reverse();
  } else {
    const [cy, cm] = cur.split('-').map(Number);
    opts = [];
    for (let i = -forward; i <= back; i += 1) {
      const d = new Date(Date.UTC(cy, cm - 1 - i, 1));
      opts.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
  }
  const val = allowAll ? (value || '') : (value || cur);
  if (val && !opts.includes(val)) opts.unshift(val); // garde la valeur courante même hors fenêtre
  return (
    <select className={`select month-select ${className}`} value={val} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel ?? tr('Mois')}>
      {allowAll && <option value="">{tr('Toutes les périodes')}</option>}
      {opts.map((m) => <option key={m} value={m}>{monthLabel(m)}{counts && counts[m] != null ? ` (${formatInt(counts[m])})` : ''}</option>)}
    </select>
  );
}
