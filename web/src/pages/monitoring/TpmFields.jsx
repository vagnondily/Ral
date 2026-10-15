import React from 'react';
import { PencilLine } from 'lucide-react';
import { STATUS_ICONS } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, shortMonthLabel } from '../../lib/format.js';
import { REASON_MAX, REASON_MIN, REASON_SUGGESTIONS, TPM_VISIT, visitTpmKey } from '../../lib/tpmAttribution.js';
import './tpmAttribution.css';

/** Valeur du sélecteur pour « aucun TPM » (zone non suivie, visite désaffectée). */
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
  return (
    <select id={id} className={`select ${value ? '' : 'is-empty'}`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder || tr('Choisir un TPM…')}</option>
      {contrat.length > 0 && (
        <optgroup label={tr('Sous contrat de suivi sur la période')}>
          {contrat.map((p) => <option key={p.id} value={p.id}>{p.name}{p.contracts?.length ? ` — ${p.contracts.map((c) => c.numero).join(', ')}` : ''}{partial(p)}</option>)}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label={tr('Autres TPM actifs (hors contrat)')}>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </optgroup>
      )}
      {allowNone && <optgroup label={tr('Aucun TPM')}><option value={NONE}>{noneLabel || tr('Aucun TPM (zone non suivie)')}</option></optgroup>}
    </select>
  );
}

/** Raison d'un changement : zone de texte avec compteur, suggestions qui insèrent un texte modifiable. */
export function ReasonField({ id, value, onChange, required, hint }) {
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
        placeholder={tr('Pourquoi ce TPM ? Ex. contrat en cours de renouvellement, accès, capacité…')} />
      <div className="tpm-reason-foot" id={`${id}-hint`}>
        <span className={short ? 'tpm-reason-err' : 'muted'}>
          {hint || (required ? tr('Obligatoire : {n} caractères au moins, relue longtemps après.', { n: REASON_MIN }) : tr('Laissez une trace si utile.'))}
        </span>
        <span className="muted tabular">{formatInt(n)} / {formatInt(REASON_MAX)}</span>
      </div>
      <div className="tpm-suggest" role="group" aria-label={tr('Suggestions de raison')}>
        {REASON_SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="tpm-chip" onClick={() => onChange(value.trim() ? `${value.trim()} — ${tr(s)}` : `${tr(s)} : `)}>{tr(s)}</button>
        ))}
      </div>
    </div>
  );
}

/**
 * TPM d'une visite (Affectation & visites) : le TPM de sa zone, tiré des contrats — couleur + icône
 * + libellé ; une origine (« contrat FLA-… », « modifié pour cette visite », « à affecter — aucun
 * contrat actif »). Le bouton ouvre le changement motivé.
 */
export function VisitTpmCell({ visit, canEdit, onEdit }) {
  const { tr } = useI18n();
  const def = TPM_VISIT[visitTpmKey(visit)] || TPM_VISIT['zone:'];
  const Icon = STATUS_ICONS[def.icon];
  const src = visit.providerSource || 'zone';
  const origin = src === 'visite'
    ? tr('modifié : {r}', { r: visit.providerReason || '' })
    : src === 'reprise' ? ({ realise: tr('visite réalisée : TPM gardé'), annule: tr('visite annulée : TPM gardé') }[visit.status] || tr('TPM gardé tel qu\'il a été saisi'))
      : visit.providerZoneState === 'sans_contrat' ? tr('aucun contrat actif sur cette zone ce mois')
        : visit.providerZoneState === 'district_inconnu' ? tr('district du site non reconnu')
          : visit.providerZoneState === 'a_arbitrer' ? tr('plusieurs contrats : choisir')
            : visit.contractLabel ? tr('contrat {n}', { n: visit.contractLabel }) : tr(def.label);
  return (
    <div className={`tpm-visit tpm-tone-${def.tone || 'none'}`} title={`${tr(def.label)} — ${origin}`}>
      <span className="pb-tpm-main">
        <Icon size={13} aria-hidden="true" className="pb-tpm-ic" />
        <span className={`pb-tpm-name ${visit.providerId ? '' : 'tpm-none'}`}>{visit.providerName || tr('À affecter')}</span>
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
