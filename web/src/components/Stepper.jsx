import React from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';

/** steps: [{ key, label, date }], current: index of the active step. */
export default function Stepper({ steps, current, label }) {
  const { tr } = useI18n();
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((s, i) => {
        const done = i < current || (i === current && s.final);
        const isCurrent = i === current && !s.final;
        return (
          <li
            key={s.key}
            className={`step ${done ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="step-dot">{done ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>
            <span className="step-text">
              <span className="step-name">{s.label}</span>
              <span className="step-date">{s.date || (isCurrent ? tr('En cours') : ' ')}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
