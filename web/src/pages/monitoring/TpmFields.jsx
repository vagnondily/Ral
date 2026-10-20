import React from 'react';
import { PencilLine } from 'lucide-react';
import { STATUS_ICONS } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, shortMonthLabel } from '../../lib/format.js';
import { INTERNAL_HINT, REASON_MAX, REASON_MIN, REASON_SUGGESTIONS, TPM_VISIT, TPM_ZONE_STATE, detachedHint, internalWhy, visitTpmKey, visitInternal } from '../../lib/tpmAttribution.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import { tpmTabHref } from './TpmZoneCell.jsx';
import './tpmAttribution.css';

/** Valeur du sélecteur pour « aucun TPM » : suivi INTERNE par l'équipe S&E (retour 114). */
export const NONE = '__none__';

/** Prestataires d'une liste de choix (règle commune) par groupe : « contrat » puis « tpm ». */
export const groupOf = (selectable, key) => ((selectable && selectable.groups) || []).find((g) => g.key === key)?.providers || [];

/**
 * Liste de choix d'un TPM — la règle commune « prestataire actif au mois M » (lot 8) : d'abord les
 * prestataires sous contrat de suivi sur la période (avec leurs contrats et, s'ils ne couvrent
 * pas tous les mois, lesquels), puis les autres TPM actifs (un choix hors contrat).
 */
export function ProviderSelect({ id, selectable, value, onChange, allowNone = true, noneLabel, placeholder, disabled }) {
  const { tr } = useI18n();
  const months = (selectable && selectable.months) || [];
  const contrat = groupOf(selectable, 'contrat');
  const others = groupOf(selectable, 'tpm');
  const partial = (p) => (p.months && p.months.length && p.months.length < months.length
    ? ` · ${tr('{m} seulement', { m: p.months.map(shortMonthLabel).join(', ') })}` : '');
  // Indisponible (retour 114) : dit dans l'option ; désactivée quand le TPM l'est sur tous les mois.
  const off = (p) => ((p.unavailableMonths || []).length ? ` · ${tr('indisponible : {m}', { m: p.unavailableMonths.map(shortMonthLabel).join(', ') })}` : '');
  const allOff = (p) => months.length > 0 && (p.unavailableMonths || []).length >= months.length;
  return (
    <select id={id} className={`select ${value ? '' : 'is-empty'}`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder || tr('Choisir un TPM…')}</option>
      {contrat.length > 0 && (
        <optgroup label={tr('Sous contrat de suivi sur la période')}>
          {contrat.map((p) => <option key={p.id} value={p.id} disabled={allOff(p)}>{p.name}{p.contracts?.length ? ` — ${p.contracts.map((c) => c.contractLabel || c.numero).join(', ')}` : ''}{partial(p)}{off(p)}</option>)}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label={tr('Autres TPM actifs (hors contrat)')}>
          {others.map((p) => <option key={p.id} value={p.id} disabled={allOff(p)}>{p.name}{off(p)}</option>)}
        </optgroup>
      )}
      {allowNone && <optgroup label={tr('Suivi interne')}><option value={NONE}>{noneLabel || tr('Interne (équipe S&E)')}</option></optgroup>}
    </select>
  );
}

/** Raison d'un changement : zone de texte avec compteur, suggestions qui insèrent un texte modifiable. */
export function ReasonField({ id, value, onChange, required, hint, placeholder, suggestions = true }) {
  const { tr } = useI18n();
  const n = [...value.trim()].length;
  const short = required && n > 0 && n < REASON_MIN;
  return (
    <div className="field tpm-reason">
      <label className="field-label" htmlFor={id}>
        {tr('Raison du changement')}{required ? <span className="req" aria-hidden="true">*</span> : <span className="muted"> {tr('(facultative)')}</span>}
      </label>
      <textarea id={id} className="input tpm-reason-input" rows={3} maxLength={REASON_MAX} value={value}
        onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`} aria-invalid={short || undefined}
        placeholder={placeholder || tr('Pourquoi ce TPM ? Ex. contrat en cours de renouvellement, accès, capacité…')} />
      <div className="tpm-reason-foot" id={`${id}-hint`}>
        <span className={short ? 'tpm-reason-err' : 'muted'}>
          {hint || (required ? tr('Obligatoire : {n} caractères au moins, relue longtemps après.', { n: REASON_MIN }) : tr('Laissez une trace si utile.'))}
        </span>
        <span className="muted tabular">{formatInt(n)} / {formatInt(REASON_MAX)}</span>
      </div>
      {suggestions && (
        <div className="tpm-suggest" role="group" aria-label={tr('Suggestions de raison')}>
          {REASON_SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="tpm-chip" onClick={() => onChange(value.trim() ? `${value.trim()} — ${tr(s)}` : `${tr(s)} : `)}>{tr(s)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * TPM d'une visite (Affectation & visites) : le TPM de sa zone, tiré des contrats — couleur + icône
 * + libellé ; une origine (« contrat FLA-… », « modifié pour cette visite »). Sans TPM : « Interne »
 * (suivi par l'équipe S&E, retour 114), jamais « à affecter » ; le lien mène à l'onglet Affectation
 * des TPM de la zone. Le bouton ouvre le changement motivé.
 */
export function VisitTpmCell({ visit, canEdit, onEdit }) {
  const { tr } = useI18n();
  const def = TPM_VISIT[visitTpmKey(visit)] || TPM_VISIT['zone:'];
  const Icon = STATUS_ICONS[def.icon];
  const src = visit.providerSource || 'zone';
  const internal = !visit.providerId && visitInternal(visit);
  const origin = src === 'visite'
    ? tr('modifié : {r}', { r: visit.providerReason || '' })
    : src === 'reprise' ? ({ realise: tr('visite réalisée : TPM gardé'), annule: tr('visite annulée : TPM gardé') }[visit.status] || tr('TPM gardé tel qu\'il a été saisi'))
      : internal ? internalWhy(tr, { state: visit.providerZoneState })
        : visit.providerZoneState === 'a_arbitrer' ? tr('plusieurs contrats : choisir')
          : visit.contractLabel ? tr('contrat {n}', { n: visit.contractLabel }) : tr(def.label);
  return (
    <div className={`tpm-visit tpm-tone-${def.tone || 'none'}`} title={`${tr(def.label)} — ${origin}`}>
      <span className="pb-tpm-main">
        <Icon size={13} aria-hidden="true" className="pb-tpm-ic" />
        {visit.providerId
          ? <span className="pb-tpm-name">{visit.providerName}</span>
          : internal
            ? <a className="pb-tpm-name pb-tpm-internal" href={tpmTabHref({ zone: visit.zoneDistrictId, month: visit.periodMonth })} title={tr(INTERNAL_HINT)}>{tr(ROLE_LABELS.noTpm)}</a>
            : <span className="pb-tpm-name tpm-none">{tr(def.label)}</span>}
        {canEdit && (
          <button type="button" className="tpm-edit" onClick={() => onEdit(visit)} aria-label={tr('Changer le TPM de {s}', { s: visit.siteName })} title={tr('Changer le TPM (raison obligatoire)')}>
            <PencilLine size={13} aria-hidden="true" />
          </button>
        )}
      </span>
      <span className="pb-tpm-origin">{origin}</span>
    </div>
  );
}

/** Origine d'un TPM de zone (cellule de la règle) : « contrat FLA-… », « modifié : raison », « aucun contrat actif… ». */
export function zoneTpmOrigin(tr, tpm) {
  if (!tpm) return '';
  switch (tpm.state) {
    case 'contrat': return tr('contrat {n}', { n: tpm.contractLabel || tpm.numero || '' });
    case 'modifie': return tr('modifié : {r}', { r: tpm.reason || '' });
    case 'a_arbitrer': return tr('{n} contrats : choisir', { n: (tpm.candidates || []).length || 2 });
    case 'sans_contrat': return detachedHint(tr, tpm) || internalWhy(tr, tpm);
    default: return internalWhy(tr, tpm);
  }
}

/**
 * TPM de la ZONE d'un site pour un mois (listes de sites : Priorités du mois du RBM…) — la même
 * règle que les visites : couleur + icône + libellé, origine en dessous ; sans TPM, « Interne »
 * (équipe S&E, retour 114) mène à l'onglet Affectation des TPM.
 */
export function ZoneTpmLabel({ tpm, month }) {
  const { tr } = useI18n();
  if (!tpm) return <span className="cell-empty">—</span>;
  const def = TPM_ZONE_STATE[tpm.state] || TPM_ZONE_STATE.sans_contrat;
  const Icon = STATUS_ICONS[def.icon];
  const origin = zoneTpmOrigin(tr, tpm);
  return (
    <div className={`tpm-visit tpm-tone-${def.tone || 'none'}`} title={`${tr(def.label)} — ${origin}`}>
      <span className="pb-tpm-main">
        <Icon size={13} aria-hidden="true" className="pb-tpm-ic" />
        {tpm.providerId
          ? <span className="pb-tpm-name">{tpm.providerName}</span>
          : <a className="pb-tpm-name pb-tpm-internal" href={tpmTabHref({ zone: tpm.areaId, month })} onClick={(e) => e.stopPropagation()} title={tr(INTERNAL_HINT)}>{tr(ROLE_LABELS.noTpm)}</a>}
      </span>
      <span className="pb-tpm-origin">{origin}</span>
    </div>
  );
}
