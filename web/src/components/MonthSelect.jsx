import React from 'react';
import { currentMonth, formatInt, monthLabel } from '../lib/format.js';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Sélecteur de mois minimal : un simple menu déroulant natif (`.select`),
 * cohérent avec les autres contrôles de l'app — pas de widget calendrier.
 * Fenêtre par défaut : `back` mois en arrière → `forward` mois en avant.
 *
 * `counts` (facultatif, { 'AAAA-MM': n }) : volume de données de chaque mois,
 * affiché dans l'option (« Juillet 2026 · 74 ») ; un mois sans donnée est grisé.
 * Les mois qui ont des données hors de la fenêtre y sont ajoutés.
 */
export default function MonthSelect({ value, onChange, back = 18, forward = 3, ariaLabel, className = '', counts = null }) {
  const { tr } = useI18n();
  const cur = currentMonth();
  const [cy, cm] = cur.split('-').map(Number);
  const opts = [];
  for (let i = -forward; i <= back; i += 1) {
    const d = new Date(Date.UTC(cy, cm - 1 - i, 1));
    opts.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const val = value || cur;
  if (!opts.includes(val)) opts.push(val); // garde la valeur courante même hors fenêtre
  if (counts) for (const m of Object.keys(counts)) if (counts[m] > 0 && !opts.includes(m)) opts.push(m);
  opts.sort((a, b) => b.localeCompare(a)); // du plus récent au plus ancien
  const label = (m) => {
    if (!counts) return monthLabel(m);
    const n = counts[m] || 0;
    return n > 0 ? `${monthLabel(m)} · ${formatInt(n)}` : `${monthLabel(m)} · —`;
  };
  return (
    <select className={`select month-select ${className}`} value={val} onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel ?? tr('Mois')} title={counts ? tr('Le nombre après le mois : formulaires reçus ce mois-là') : undefined}>
      {opts.map((m) => (
        <option key={m} value={m} className={counts && !(counts[m] > 0) ? 'month-empty' : undefined}>{label(m)}</option>
      ))}
    </select>
  );
}
