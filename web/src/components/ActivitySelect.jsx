import React from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { useProgrammeActivities, findActivity, findSubActivity, activityOptionLabel } from '../lib/programmeActivities.js';

/**
 * Liste des ACTIVITÉS DE PROGRAMME (suivi de processus) — la seule façon de saisir une activité
 * hors du Paramétrage (migration 105). La valeur est le libellé officiel ; une valeur existante
 * écrite autrement (ancienne graphie, code) est reconnue et affichée sous son libellé officiel.
 * Une valeur inconnue du référentiel reste visible, signalée, pour être corrigée.
 *
 * @param {object} p
 * @param {string} p.value               libellé courant ('' = aucune)
 * @param {(label: string, activity: object|null) => void} p.onChange
 * @param {boolean} [p.allowEmpty=true]  propose « — aucune — »
 * @param {string} [p.emptyLabel]
 */
export default function ActivitySelect({ value, onChange, allowEmpty = true, emptyLabel, id, className = 'select', disabled, required, ariaLabel }) {
  const { tr } = useI18n();
  const { activities } = useProgrammeActivities();
  if (activities === null) {
    return <select id={id} className={className} disabled aria-label={ariaLabel} aria-busy="true"><option>{tr('Chargement…')}</option></select>;
  }
  const current = findActivity(activities, value);
  const selected = current ? current.label : (value || '');
  const offered = activities.filter((a) => a.active !== false || (current && a.id === current.id));
  const unknown = value && !current;
  return (
    <select id={id} className={`${className} ${selected ? '' : 'is-empty'}`} value={selected} disabled={disabled} required={required} aria-label={ariaLabel}
      aria-invalid={unknown || undefined}
      onChange={(e) => { const a = activities.find((x) => x.label === e.target.value) || null; onChange(a ? a.label : '', a); }}>
      {(allowEmpty || !selected) && <option value="">{emptyLabel || tr('— Aucune —')}</option>}
      {unknown && <option value={value}>{tr('{value} — inconnue du référentiel', { value })}</option>}
      {offered.map((a) => (
        <option key={a.id} value={a.label}>{a.active === false ? tr('{label} (désactivée)', { label: activityOptionLabel(a) }) : activityOptionLabel(a)}</option>
      ))}
    </select>
  );
}

/**
 * Sous-activité (Activity_tag) d'un site : celles de l'activité choisie ; sans activité, toutes,
 * groupées par activité (en choisir une fixe aussi l'activité). Valeur = code.
 * @param {(code: string, sub: object|null) => void} p.onChange  sub porte son activité (sub.activity)
 */
export function SubActivitySelect({ value, activityLabel, onChange, id, className = 'select', disabled, ariaLabel }) {
  const { tr } = useI18n();
  const { activities } = useProgrammeActivities();
  if (activities === null) {
    return <select id={id} className={className} disabled aria-label={ariaLabel} aria-busy="true"><option>{tr('Chargement…')}</option></select>;
  }
  const activity = findActivity(activities, activityLabel);
  const current = findSubActivity(activities, value);
  const selected = current ? current.code : (value || '');
  const unknown = value && !current;
  const groups = (activity ? [activity] : activities.filter((a) => a.active !== false))
    .map((a) => ({ a, subs: (a.subActivities || []).filter((s) => s.active !== false || (current && s.id === current.id)) }))
    .filter((g) => g.subs.length);
  const pick = (code) => {
    const s = findSubActivity(activities, code);
    onChange(s ? s.code : '', s);
  };
  return (
    <select id={id} className={`${className} ${selected ? '' : 'is-empty'}`} value={selected} disabled={disabled} aria-label={ariaLabel}
      aria-invalid={unknown || undefined} onChange={(e) => pick(e.target.value)}>
      <option value="">{groups.length ? tr('— Aucune —') : tr('Aucune sous-activité pour cette activité')}</option>
      {unknown && <option value={value}>{tr('{value} — inconnue du référentiel', { value })}</option>}
      {activity
        ? groups.flatMap((g) => g.subs).map((s) => <option key={s.id} value={s.code}>{`${s.code} — ${s.label}`}</option>)
        : groups.map((g) => (
          <optgroup key={g.a.id} label={g.a.label}>
            {g.subs.map((s) => <option key={s.id} value={s.code}>{`${s.code} — ${s.label}`}</option>)}
          </optgroup>
        ))}
    </select>
  );
}
