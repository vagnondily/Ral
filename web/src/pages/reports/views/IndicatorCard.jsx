import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { BAND, Empty, Tone, num } from './common.jsx';

/**
 * Carte de résultat d'un indicateur (retour 45, infographie) : anneau du pourcentage (ou la
 * valeur pour une moyenne / un total), base n, cible, classe avec icône + libellé, phrase
 * d'interprétation écrite par le serveur dans la langue du rapport et encadré d'alerte sous le
 * seuil. Mêmes chiffres que la liste des résultats (rien n'est recalculé ici).
 */
export default function IndicatorCard({ data }) {
  const { tr } = useI18n();
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const r = data.rows[0];
  const pct = r.agg === 'percent_yes' || r.agg === 'percent_value' || r.agg == null;
  const v = r.value == null ? null : Number(r.value);
  const R = 34; const C = 2 * Math.PI * R;
  const share = pct && v != null ? Math.max(0, Math.min(100, v)) / 100 : 0;
  const color = `var(--cd-${r.band || 'na'})`;
  return (
    <div className="rb-card">
      <svg viewBox="0 0 84 84" className="rb-card-ring" role="img" aria-label={`${r.label} : ${v == null ? '—' : num(v, 1)}${pct ? ' %' : ''}`}>
        <circle cx="42" cy="42" r={R} fill="none" stroke="var(--border)" strokeWidth="9" />
        {pct && v != null && <circle cx="42" cy="42" r={R} fill="none" stroke={color} strokeWidth="9" strokeDasharray={`${C * share} ${C}`} transform="rotate(-90 42 42)" strokeLinecap="butt" />}
        <text x="42" y="46" textAnchor="middle" className="rb-card-v">{v == null ? '—' : `${num(v, pct ? 0 : 1)}${pct ? '%' : ''}`}</text>
      </svg>
      <div className="rb-card-body">
        <strong className="rb-card-title">{r.label}</strong>
        <div className="rb-card-meta">
          <Tone tone={r.band || 'na'}>{tr(BAND[r.band || 'na'][0])}</Tone>
          <span>n = {num(r.base || 0)}</span>
          {r.target != null && <span>{tr('Cible')} {num(r.target, 1)}{pct ? ' %' : ''}</span>}
        </div>
        <p className="rb-card-sentence">{r.sentence}</p>
        {r.alert && <p className="rb-card-alert" role="note"><AlertTriangle size={14} aria-hidden="true" /> {r.alert}</p>}
      </div>
    </div>
  );
}
