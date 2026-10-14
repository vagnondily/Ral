import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { currentMonth, formatInt, monthLabel } from '../lib/format.js';
import {
  MAX_SPAN, addMonths, monthsOf, normalize, periodLabel, presetOf, presets as buildPresets, samePeriod, spanMonths, summarizeCounts,
} from '../lib/period.js';

/**
 * Sélecteur de période « du … au … » (lot 1b, retour n° 47) : préréglages +
 * période personnalisée (deux mois), mini-histogramme du volume de données et
 * synthèse (« 6 mois · 224 formulaires reçus · 1 mois sans données »).
 *
 *   value      { from, to } | null (null = toutes les périodes, si `allowAll`)
 *   onChange   (period | null, { preset }) — appelé à l'application seulement
 *   counts     { 'AAAA-MM': n } — formulaires reçus par mois (histogramme, options)
 *   today      mois courant (défaut : celui du navigateur) ; latest = dernier mois avec des données
 *   presets    identifiants des préréglages proposés (défaut : tous) ; withFullYear (documents)
 *   maxSpan    durée maximale (lib/periodCaps : celle des endpoints de l'écran ; 60 mois par
 *              défaut) — un préréglage plus long n'est pas proposé, et la fenêtre le dit
 *   forward    mois futurs proposés (3)
 *   countLabel phrase du volume de `counts` (défaut « {n} formulaire(s) reçu(s) sur la période » ;
 *              ex. « {n} rapport(s) sur la période », « {n} ligne(s) de distribution sur la période »)
 *   align      'left' | 'right' ; compact (barre de filtres) ; ariaLabel
 *
 * L'état n'est jamais invalide : si « Du » dépasse « Au », l'autre borne suit.
 * Accessibilité : bouton aria-haspopup="dialog" / aria-expanded ; fenêtre role="dialog" ;
 * à l'ouverture le focus va sur le préréglage actif ; Échap ou un clic dehors ferme et
 * rend le focus au bouton.
 */
export default function PeriodSelect({
  value, onChange, counts = null, today, latest = null, allowAll = false, presets: presetIds,
  withFullYear = false, maxSpan = MAX_SPAN, forward = 3, align = 'left', ariaLabel, compact = false,
  countLabel = '{n} formulaire(s) reçu(s) sur la période',
}) {
  const { tr, lang } = useI18n();
  const T = today || currentMonth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || { from: T, to: T });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  const list = useMemo(() => {
    const all = buildPresets(T, latest, { withFullYear })
      .filter((p) => spanMonths(p.period) <= maxSpan); // jamais une période que l'écran refuserait
    return presetIds ? all.filter((p) => presetIds.includes(p.id)) : all;
  }, [T, latest, withFullYear, presetIds, maxSpan]);
  const activePreset = value ? presetOf(value, list) : (allowAll ? 'all' : null);

  // Le bouton reste monté : le focus y revient tout de suite (avant que la fenêtre, et le
  // préréglage qui avait le focus, ne disparaissent).
  const close = (focusTrigger = true) => {
    if (focusTrigger && triggerRef.current) triggerRef.current.focus();
    setOpen(false);
  };
  const openPop = () => { setDraft(value || { from: T, to: T }); setOpen(true); };

  // Clic dehors : ferme (le focus reste où l'utilisateur a cliqué).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  // Échap (focus dans le sélecteur) : ferme et rend le focus au bouton, sans fermer aussi le
  // tiroir ou la fenêtre qui contient le sélecteur (propagation arrêtée ici).
  const onKeyDown = (e) => {
    if (open && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(true); }
  };
  // À l'ouverture : focus sur le préréglage actif (sinon le premier).
  useEffect(() => {
    if (!open || !popRef.current) return;
    const el = popRef.current.querySelector('.period-preset[aria-pressed="true"]') || popRef.current.querySelector('.period-preset');
    if (el) el.focus();
  }, [open]);

  const apply = (p, preset = null) => {
    try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:apply'); } catch { /* sans incidence */ }
    onChange(p, { preset });
    close(true);
  };

  // Mois proposés : du plus récent (T + forward) au plus ancien (60 mois avant T), plus les mois avec données.
  const options = useMemo(() => {
    const set = new Set();
    for (let i = -forward; i < maxSpan; i += 1) set.add(addMonths(T, -i));
    if (counts) for (const m of Object.keys(counts)) if (counts[m] > 0) set.add(m);
    for (const m of [draft.from, draft.to, value && value.from, value && value.to]) if (m) set.add(m);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [T, forward, maxSpan, counts, draft.from, draft.to, value]);
  // Avec le volume, le mois en forme courte (« Nov. 2025 · 40 ») tient dans le champ.
  const optionLabel = (m) => {
    if (!counts) return monthLabel(m);
    const n = counts[m] || 0;
    return `${periodLabel({ from: m, to: m }, lang, { short: true })} · ${n > 0 ? formatInt(n) : '—'}`;
  };
  const setFrom = (from) => setDraft((d) => (from > d.to ? { from, to: from } : { ...d, from }));
  const setTo = (to) => setDraft((d) => (to < d.from ? { from: to, to } : { ...d, to }));

  const span = spanMonths(draft);
  const tooLong = span > maxSpan;
  const sum = counts ? summarizeCounts(draft, counts) : null;
  // Mini-histogramme : 12 mois finissant à « Au ».
  const strip = useMemo(() => monthsOf({ from: addMonths(draft.to, -11), to: draft.to }), [draft.to]);
  const maxN = Math.max(1, ...strip.map((m) => (counts && counts[m]) || 0));

  const valueLabel = value ? periodLabel(value, lang, { short: true }) : tr('Toutes les périodes');
  const valueSpan = value ? spanMonths(value) : 0;

  return (
    <div className={`period-select ${compact ? 'is-compact' : ''}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button" ref={triggerRef}
        className="btn btn-secondary period-trigger"
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${ariaLabel || tr('Période')} — ${value ? periodLabel(value, lang) : tr('Toutes les périodes')}`}
        onClick={() => (open ? close(false) : openPop())}
      >
        <CalendarRange size={16} aria-hidden="true" />
        <span className="period-trigger-label">{valueLabel}</span>
        {valueSpan > 1 && <span className="period-trigger-span">· {tr('{n} mois', { n: valueSpan })}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={`pop-menu period-pop ${align === 'right' ? 'is-right' : ''}`} role="dialog" aria-label={tr('Choisir la période')} ref={popRef}>
          <div className="period-cols">
            <div className="period-presets" role="group" aria-label={tr('Préréglages')}>
              <div className="pop-menu-label">{tr('Préréglages')}</div>
              {allowAll && (
                <button type="button" className="period-preset" aria-pressed={activePreset === 'all'} onClick={() => apply(null, 'all')}>
                  <span className="period-preset-label">{tr('Toutes les périodes')}</span>
                </button>
              )}
              {list.map((p) => (
                <button key={p.id} type="button" className="period-preset" aria-pressed={activePreset === p.id}
                  onClick={() => apply(p.period, p.id)}>
                  <span className="period-preset-label">{tr(p.label, p.params)}</span>
                  {/* Indication : « T4 2026 », sinon la plage (« Sept. 2026 ») ; rien quand le libellé la dit déjà (« Année 2025 »). */}
                  {(p.hint || !p.params) && (
                    <span className="period-hint">{p.hint ? tr(p.hint.text, p.hint.params) : periodLabel(p.period, lang, { short: true })}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="period-custom">
              <div className="pop-menu-label">{tr('Personnalisée')}</div>
              <div className="period-range">
                <label className="period-field">
                  <span>{tr('Du')}</span>
                  <select className="select" value={draft.from} onChange={(e) => setFrom(e.target.value)}>
                    {options.map((m) => <option key={m} value={m} className={counts && !(counts[m] > 0) ? 'month-empty' : undefined}>{optionLabel(m)}</option>)}
                  </select>
                </label>
                <label className="period-field">
                  <span>{tr('Au')}</span>
                  <select className="select" value={draft.to} onChange={(e) => setTo(e.target.value)}>
                    {options.map((m) => <option key={m} value={m} className={counts && !(counts[m] > 0) ? 'month-empty' : undefined}>{optionLabel(m)}</option>)}
                  </select>
                </label>
              </div>
              {counts && (
                <div className="period-strip" aria-hidden="true">
                  {strip.map((m) => {
                    const n = counts[m] || 0;
                    const inRange = m >= draft.from && m <= draft.to;
                    const cls = `period-bar${inRange ? ' is-in' : ''}${inRange && n === 0 ? ' is-empty' : ''}`;
                    // Mois vide de la plage : barre pleine hauteur hachurée (et compté dans la synthèse).
                    const h = inRange && n === 0 ? 100 : Math.max(8, Math.round((n / maxN) * 100));
                    return <span key={m} className={cls} title={optionLabel(m)} style={{ height: `${h}%` }} />;
                  })}
                </div>
              )}
              <p className="period-sum">
                {tr('{n} mois', { n: span })}
                {sum && <> · {tr(countLabel, { n: formatInt(sum.submissions) })}</>}
                {sum && <> · {sum.emptyMonths ? tr('{n} mois sans données', { n: sum.emptyMonths }) : tr('chaque mois a des données')}</>}
              </p>
              {tooLong
                ? <p className="field-error">{tr('{n} mois au plus', { n: maxSpan })}</p>
                : maxSpan < MAX_SPAN && <p className="period-cap">{tr('{n} mois au plus sur cet écran (temps de calcul).', { n: maxSpan })}</p>}
            </div>
          </div>
          <div className="period-foot">
            <button type="button" className="btn btn-ghost" onClick={() => close(true)}>{tr('Annuler')}</button>
            <button type="button" className="btn btn-primary" disabled={tooLong || (value && samePeriod(normalize(draft), value))}
              onClick={() => apply(normalize(draft), null)}>
              {tr('Appliquer')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
