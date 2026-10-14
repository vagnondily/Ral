import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../../../api/client.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { Field } from '../../../components/ui.jsx';
import { FILTERS } from './blockTypes.js';

/** Listes de choix des filtres : bureaux (antennes en retrait), activités (fiches), partenaires, fiches. */
export function useFilterOptions(forms, offices) {
  const [partners, setPartners] = useState([]);
  useEffect(() => {
    let alive = true;
    api.listPartners().then((r) => { if (alive) setPartners((r || []).filter((p) => p.active !== false)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const activities = [...new Set((forms || []).map((f) => f.activityCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  // Bureaux de premier niveau, chacun suivi de ses antennes.
  const tops = (offices || []).filter((o) => !o.parentId);
  const ordered = tops.flatMap((o) => [o, ...(offices || []).filter((a) => a.parentId === o.id)]);
  const orphans = (offices || []).filter((o) => o.parentId && !tops.some((t) => t.id === o.parentId));
  return { partners, activities, offices: [...ordered, ...orphans] };
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
        {(!officeKinds || officeKinds.includes('id')) && <optgroup label={tr('Bureaux MEMS')}>{opts.offices.map((o) => <option key={o.id} value={`id:${o.id}`}>{o.parentId ? `· ${o.name}` : o.name}</option>)}</optgroup>}
        {(!officeKinds || officeKinds.includes('unlinked')) && <option value="unlinked">{tr('Sans bureau MEMS')}</option>}
      </>
    );
  }
  if (fkey === 'activity') return opts.activities.map((a) => <option key={a} value={a}>{a}</option>);
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
  const { tr } = useI18n();
  const filters = (block.params && block.params.filters) || {};
  const reportF = doc.filters || {};
  const all = { ...opts, forms };
  const set = (k, v) => onChange({ ...filters, [k]: v === '' ? undefined : v });
  return (
    <div className="section-gap">
      <p className="hint">{tr('Un filtre vide hérite du rapport ; « Tous » ignore le filtre du rapport pour ce bloc.')}</p>
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
