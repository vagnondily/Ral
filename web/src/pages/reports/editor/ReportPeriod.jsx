import React from 'react';
import PeriodSelect from '../../../components/PeriodSelect.jsx';
import { usePeriod } from '../../../components/PeriodBanner.jsx';
import { periodLabel } from '../../../lib/period.js';

/** Période d'un rapport : sélecteur « du … au … » commun (préréglages, volume par mois, 60 mois au plus). */
export default function ReportPeriod({ value, onChange, disabled, compact, align }) {
  const { counts, latest, today } = usePeriod({ scope: 'local', defaultRule: 'current', urlSync: false });
  if (disabled) return <span className="rd-period-ro">{periodLabel(value, document.documentElement.lang === 'en' ? 'en' : 'fr')}</span>;
  return <PeriodSelect value={value} onChange={(p) => p && onChange(p)} counts={counts} today={today} latest={latest} withFullYear maxSpan={60} compact={compact} align={align} />;
}
