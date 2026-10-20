import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../../../api/client.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { Field } from '../../../components/ui.jsx';
import { FILTERS } from './blockTypes.js';
import ReportPeriod from './ReportPeriod.jsx';
import { periodLabel } from '../../../lib/period.js';

/**
 * Bureaux en ARBRE : chaque bureau suivi de ses antennes, et de leurs propres antennes (profondeur
 * quelconque) ; `depth` sert au retrait. Un bureau sans parent connu reste à la racine. Pur.
 */
export function officeTree(offices) {
  const list = offices || [];
  const ids = new Set(list.map((o) => o.id));
  const kids = new Map();
  for (const o of list) {
    const p = o.parentId && ids.has(o.parentId) ? o.parentId : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(o);
  }
  const out = []; const seen = new Set();
  const walk = (parent, depth) => {
    for (const o of (kids.get(parent) || []).sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
      if (seen.has(o.id)) continue; // un cycle de parenté ne boucle jamais
      seen.add(o.id); out.push({ ...o, depth }); walk(o.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Listes de choix des filtres : bureaux (arbre, antennes en retrait), activités (registre des sites ET
 * fiches, retour 102), districts (noms des tableaux de bord), prestataires, fiches.
 */
export function useFilterOptions(forms, offices) {
  const [partners, setPartners] = useState([]);
  const [choices, setChoices] = useState({ activities: [], districts: [] });
  useEffect(() => {
    let alive = true;
    api.listPartners().then((r) => { if (alive) setPartners((r || []).filter((p) => p.active !== false)); }).catch(() => {});
    api.reportFilterOptions().then((r) => { if (alive && r) setChoices({ activities: r.activities || [], districts: r.districts || [] }); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const fromForms = (forms || []).map((f) => f.activityCategory).filter(Boolean);
  const byKey = new Map();
  for (const a of [...choices.activities.map((x) => x.label), ...fromForms]) {
    const k = String(a).trim().toLowerCase();
    if (k && !byKey.has(k)) byKey.set(k, String(a).trim());
  }
  const activities = [...byKey.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  const districts = choices.districts.map((d) => d.label);
  return { partners, activities, districts, offices: officeTree(offices) };
}

/** Libellé lisible de la valeur d'un filtre (bureau, activité, partenaire, fiche). */
export function filterValueLabel(key, value, { forms, offices, partners }, tr) {
  if (value == null || value === '') return null;
  if (value === 'all') return tr('Tous');
  if (key === 'office') {
    if (value === 'unlinked') return tr('Sans bureau MEMS');
    const o = (offices || []).find((x) => `id:${x.id}` === value);
    return o ? o.name : tr('Bureau (libellé ou code d\'une fiche)');
  }
  if (key === 'formId') { const f = (forms || []).find((x) => x.id === value); return f ? f.label : value; }
  if (key === 'partnerId') { const p = (partners || []).find((x) => x.id === value); return p ? p.name : value; }
  return value;
}

function Options({ fkey, opts, officeKinds }) {
  const { tr } = useI18n();
  if (fkey === 'office') {
    return (
      <>
        {(!officeKinds || officeKinds.includes('id')) && <optgroup label={tr('Bureaux MEMS (avec leurs antennes)')}>{opts.offices.map((o) => <option key={o.id} value={`id:${o.id}`}>{`${'\u00a0\u00a0'.repeat(o.depth || 0)}${o.depth ? '· ' : ''}${o.name}`}</option>)}</optgroup>}
        {(!officeKinds || officeKinds.includes('unlinked')) && <option value="unlinked">{tr('Sans bureau MEMS')}</option>}
      </>
    );
  }
  if (fkey === 'activity') return opts.activities.map((a) => <option key={a} value={a}>{a}</option>);
  if (fkey === 'district') return (opts.districts || []).map((d) => <option key={d} value={d}>{d}</option>);
  if (fkey === 'partnerId') return opts.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>);
  if (fkey === 'formId') return opts.forms.map((f) => <option key={f.id} value={f.id}>{f.label}</option>);
  return null;
}

/** Filtres du RAPPORT (appliqués à tous les blocs qui les prennent en charge). */
export function ReportFiltersEditor({ filters, onChange, forms, opts, disabled }) {
  const { tr } = useI18n();
  const set = (k, v) => onChange({ ...(filters || {}), [k]: v || undefined });
  const all = { ...opts, forms };
  return (
    <div className="rd-filters-grid">
      {FILTERS.map((f) => (
        <Field key={f.key} label={tr(f.label)}>
          <select className="select" value={(filters || {})[f.key] || ''} disabled={disabled} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">{tr('Tous')}</option>
            <Options fkey={f.key} opts={all} />
            {f.key === 'office' && filters && filters.office && !String(filters.office).startsWith('id:') && filters.office !== 'unlinked' && <option value={filters.office}>{filterValueLabel('office', filters.office, all, tr)}</option>}
          </select>
        </Field>
      ))}
    </div>
  );
}

/**
 * Volet « Filtres » d'un bloc : chaque filtre dit « hérite du rapport (valeur) » ou sa valeur
 * propre ; « Tous » ignore le filtre du rapport ; un filtre que le jeu ne sait pas appliquer est
 * grisé avec sa raison (jamais un total national présenté comme celui d'un bureau).
 * @param {string[]|null} supported filtres du catalogue pris en charge ('office', 'activity'…) ; null = tous
 */
export default function FiltersPane({ block, doc, supported, officeKinds, forms, opts, onChange }) {
  const { tr, lang } = useI18n();
  const filters = (block.params && block.params.filters) || {};
  const reportF = doc.filters || {};
  const all = { ...opts, forms };
  const set = (k, v) => onChange({ ...filters, [k]: v === '' ? undefined : v });
  const ownPeriod = !!filters.period;
  return (
    <div className="section-gap">
      <p className="hint">{tr('Un filtre vide hérite du rapport ; « Tous » ignore le filtre du rapport pour ce bloc.')}</p>
      {/* Période du bloc : celle du rapport, ou la sienne (plage ou mois cochés, retour 68). */}
      <Field label={tr('Période')} hint={ownPeriod ? null : tr('Hérite du rapport : {v}', { v: periodLabel(doc.period, lang) })}>
        <select className="select" value={ownPeriod ? 'own' : ''} onChange={(e) => set('period', e.target.value === 'own' ? { ...doc.period } : undefined)}>
          <option value="">{tr('Hérite du rapport ({v})', { v: periodLabel(doc.period, lang) })}</option>
          <option value="own">{tr('Période propre à ce bloc')}</option>
        </select>
        {ownPeriod && <div className="rd-filter-period"><ReportPeriod value={filters.period} onChange={(pp) => set('period', pp)} /></div>}
      </Field>
      {FILTERS.map((f) => {
        const ok = !supported || supported.includes(f.cat);
        const own = filters[f.key];
        const inherited = filterValueLabel(f.key, reportF[f.key], all, tr) || tr('Tous');
        if (!ok) {
          return (
            <div key={f.key} className="rd-filter-off">
              <strong><Lock size={12} aria-hidden="true" /> {tr(f.label)}</strong>
              <span>{tr(f.unsupported)}</span>
            </div>
          );
        }
        const foreign = f.key === 'office' && own && own !== 'all' && officeKinds && !officeKinds.includes(own === 'unlinked' ? 'unlinked' : own.split(':')[0]);
        return (
          <Field key={f.key} label={tr(f.label)} hint={own == null ? tr('Hérite du rapport : {v}', { v: inherited }) : null}>
            <select className="select" value={own == null ? '' : own} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">{tr('Hérite du rapport ({v})', { v: inherited })}</option>
              <option value="all">{tr('Tous (ignorer le filtre du rapport)')}</option>
              <Options fkey={f.key} opts={all} officeKinds={officeKinds} />
              {foreign && <option value={own}>{filterValueLabel('office', own, all, tr)}</option>}
            </select>
            {foreign && <p className="hint">{tr('Ce jeu ne se filtre que par bureau MEMS.')}</p>}
          </Field>
        );
      })}
      {block.type === 'data' && (!supported || supported.includes('module')) && (
        <Field label={tr('Domaine (module)')} hint={tr('Nom exact du domaine des indicateurs.')}>
          <input className="input" value={filters.module || ''} maxLength={120} onChange={(e) => set('module', e.target.value)} />
        </Field>
      )}
    </div>
  );
}
