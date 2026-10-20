import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, shiftMonth, shortMonthLabel } from '../../lib/format.js';
import { REASON_MIN, TPM_ZONE_STATE, monthsBetween, rangeLabel } from '../../lib/tpmAttribution.js';
import { NONE, ProviderSelect, ReasonField } from './TpmFields.jsx';

/** Plage la plus longue d'un changement (comme le serveur : tpmAttribution.MAX_SPAN_MONTHS). */
const MAX_SPAN = 24;
const span = (from, to) => monthsBetween(from, to, MAX_SPAN + 1).length;

/**
 * Changer le TPM de zones (districts, communes) sur une plage de mois — ou « Revenir au contrat »
 * (retour 58). L'aperçu (POST /preview, sans écriture) dit ce que disent les contrats, combien de
 * zone-mois changent et quelles visites PRÉVUES changeront de TPM ; l'enregistrement exige une
 * raison (sauf retour au contrat) et l'empreinte de cet aperçu : si l'affectation a changé
 * entre-temps (409), l'aperçu est relu et rien n'est écrit.
 * @param {{ mode: 'modifier'|'revenir', areas: { id, name, path, depth }[], title: string,
 *   period: { from, to }, onClose: () => void, onSaved: () => void }} props
 */
export default function TpmChangeDialog({ mode, areas, title, period, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const revert = mode === 'revenir';
  const [range, setRange] = useState({ from: period.from, to: period.to });
  const [provider, setProvider] = useState('');
  const [reason, setReason] = useState('');
  const [selectable, setSelectable] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const areaIds = useMemo(() => areas.map((a) => a.id), [areas]);
  const providerId = provider === NONE ? null : (provider || null);
  const chosen = revert || provider !== '';

  useEffect(() => {
    if (revert) return undefined;
    let live = true;
    setSelectable(null);
    api.tpmAttributionProviders(range).then((r) => { if (live) setSelectable(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [revert, range]);

  // Aperçu relu (après une courte pause) quand la plage, le TPM ou la raison change ; seul le dernier compte.
  const reasonKey = reason.trim();
  useEffect(() => {
    if (!chosen) { setPreview(null); return undefined; }
    const id = seq.current + 1; seq.current = id;
    setLoading(true);
    const timer = setTimeout(() => {
      api.tpmAttributionPreview({ areaIds, from: range.from, to: range.to, mode: revert ? 'revenir' : 'modifier', providerId, reason: reasonKey || undefined })
        .then((r) => { if (seq.current === id) { setPreview(r); setError(null); } })
        .catch((e) => { if (seq.current === id) { setPreview(null); setError(e.message); } })
        .finally(() => { if (seq.current === id) setLoading(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [chosen, areaIds, range, revert, providerId, reasonKey]);

  const counts = preview?.counts || {};
  const writes = revert ? (counts.deleted || 0) : (counts.created || 0) + (counts.updated || 0) + (counts.confirmed || 0) + (counts.deleted || 0);
  const needsReason = !revert && ((counts.created || 0) + (counts.updated || 0) + (counts.confirmed || 0)) > 0;
  const reasonOk = !needsReason || [...reasonKey].length >= REASON_MIN;
  const blocked = Boolean(preview?.notSelectable?.length);
  const canSave = Boolean(preview) && !loading && !blocked && writes > 0 && reasonOk;

  const setFrom = (m) => setRange((r) => ({ from: m, to: r.to < m ? m : (span(m, r.to) > MAX_SPAN ? shiftMonth(m, MAX_SPAN - 1) : r.to) }));
  const setTo = (m) => setRange((r) => ({ from: r.from > m ? m : (span(r.from, m) > MAX_SPAN ? shiftMonth(m, -(MAX_SPAN - 1)) : r.from), to: m }));

  async function save() {
    setSaving(true); setError(null); setStale(false);
    const body = { areaIds, from: range.from, to: range.to, reason: reasonKey || undefined, stamp: preview.stamp };
    try {
      const r = revert ? await api.tpmAttributionRevert(body) : await api.tpmAttributionSave({ ...body, providerId });
      const v = r.visits || {};
      toast.success(r.unchanged
        ? tr('Rien à enregistrer : ces zones ont déjà ce TPM.')
        : tr('Affectation enregistrée : {z} zone-mois, {v} visite(s) prévue(s) mise(s) à jour.', { z: formatInt(writes), v: formatInt(v.changed || 0) }));
      onSaved();
    } catch (e) {
      if (e.status === 409) {
        // Empreinte périmée : un autre utilisateur, un contrat ou le découpage a changé — on relit l'aperçu.
        setStale(true); setPreview(null);
        setRange((r) => ({ ...r }));
      } else setError(e.message);
    } finally { setSaving(false); }
  }

  const areaLine = areas.length === 1 ? (areas[0].path || areas[0].name).replace(/ > /g, ' › ')
    : areas.length <= 4 ? areas.map((a) => a.name).join(', ')
      : tr('{n} zones : {list}…', { n: formatInt(areas.length), list: areas.slice(0, 4).map((a) => a.name).join(', ') });
  return (
    <Modal open wide onClose={() => !saving && onClose()} title={title} subtitle={areaLine}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button>
          <Button loading={saving} disabled={!canSave} onClick={save}>{revert ? tr('Revenir au contrat') : tr('Enregistrer')}</Button>
        </>
      )}>
      <div className="tpm-dialog">
        <div className="tpm-change-period" role="group" aria-label={tr('Période')}>
          <label>{tr('Du')} <MonthSelect value={range.from} back={24} forward={18} ariaLabel={tr('Premier mois')} onChange={setFrom} /></label>
          <label>{tr('au')} <MonthSelect value={range.to} back={24} forward={18} ariaLabel={tr('Dernier mois')} onChange={setTo} /></label>
          <span className="muted">{tr('{n} mois', { n: formatInt(span(range.from, range.to)) })}</span>
        </div>

        {!revert && (
          <div className="field">
            <label className="field-label" htmlFor="tpm-change-provider">{tr('Nouveau TPM')}</label>
            {selectable ? (
              <ProviderSelect id="tpm-change-provider" selectable={selectable} value={provider} onChange={setProvider}
                noneLabel={tr('Aucun TPM (zone non suivie ces mois-là)')} />
            ) : <Skeleton height={38} />}
          </div>
        )}

        {chosen && (
          <section className="tpm-preview" aria-live="polite" aria-busy={loading || undefined}>
            <h3 className="tpm-preview-title">{tr('Aperçu')}</h3>
            {!preview ? <Skeleton height={72} /> : (
              <>
                <ContractNow contract={preview.contract} />
                <p className="tpm-preview-line">
                  <strong>{revert
                    ? tr('{n} zone-mois reviennent au contrat.', { n: formatInt(counts.deleted || 0) })
                    : tr('{n} zone-mois changent de TPM.', { n: formatInt((counts.created || 0) + (counts.updated || 0) + (counts.confirmed || 0)) })}</strong>
                  {!revert && counts.deleted > 0 && <> {tr('{n} reviennent au contrat (même TPM que lui).', { n: formatInt(counts.deleted) })}</>}
                  {!revert && (counts.sameAsContract || 0) - (counts.deleted || 0) > 0 && <> {tr('{n} ont déjà ce TPM selon contrat : rien à enregistrer.', { n: formatInt((counts.sameAsContract || 0) - (counts.deleted || 0)) })}</>}
                  {!revert && counts.unchanged > 0 && <> {tr('{n} portent déjà cette modification.', { n: formatInt(counts.unchanged) })}</>}
                </p>
                <VisitMoves visits={preview.visits} />
                {(preview.warnings || []).map((w) => (
                  <Alert key={w.code} tone="warn" icon={AlertTriangle}>
                    {w.code === 'plan_valide'
                      ? tr('Plan de suivi déjà validé pour {m} : ses visites prévues changeront de TPM.', { m: w.months.map(shortMonthLabel).join(', ') })
                      : tr('{p} n\'est pas sous contrat de suivi en {m} : choix hors contrat, à motiver.', { p: w.providerName || '', m: w.months.map(shortMonthLabel).join(', ') })}
                  </Alert>
                ))}
                {blocked && (
                  <Alert tone="danger">{tr('Ce partenaire n\'est pas sélectionnable en {m} (ni sous contrat de suivi, ni TPM actif).', { m: preview.notSelectable.map(shortMonthLabel).join(', ') })}</Alert>
                )}
              </>
            )}
          </section>
        )}

        {!revert && chosen && <ReasonField id="tpm-change-reason" value={reason} onChange={setReason} required={needsReason || !preview} />}
        {revert && (
          <ReasonField id="tpm-change-reason" value={reason} onChange={setReason} suggestions={false}
            placeholder={tr('Pourquoi revenir au contrat ? Ex. renouvellement signé, accès rétabli…')}
            hint={tr('Facultative : le retour au contrat est journalisé avec la modification effacée.')} />
        )}

        {stale && <Alert tone="warn">{tr('L\'affectation a changé entre-temps (autre utilisateur, contrat ou découpage) : l\'aperçu a été relu, vérifiez-le puis enregistrez.')}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Ce que disent les contrats sur la plage, zone par zone (segments de mois). */
function ContractNow({ contract }) {
  const { tr } = useI18n();
  if (!contract || !contract.length) return null;
  const shown = contract.slice(0, 6);
  return (
    <div className="tpm-contract-now">
      <span className="tpm-contract-now-h">{tr('Ce que disent les contrats')}</span>
      <ul>
        {shown.map((a) => (
          <li key={a.areaId}>
            <strong>{a.name}</strong>{' '}
            {a.segments.map((s, i) => (
              <span key={s.from} className="tpm-contract-seg">
                {i > 0 && ' · '}
                {s.providerName
                  ? `${s.providerName}${s.contractLabel ? ` (${tr('contrat {n}', { n: s.contractLabel })})` : ''}`
                  : tr((TPM_ZONE_STATE[s.state] || {}).label || s.state)}
                {a.segments.length > 1 && <span className="muted"> {rangeLabel(s.from, s.to)}</span>}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {contract.length > shown.length && <span className="muted">{tr('… et {n} autre(s) zone(s).', { n: formatInt(contract.length - shown.length) })}</span>}
    </div>
  );
}

/** Visites prévues qui changeront de TPM (les réalisées, annulées ou déjà facturées ne changent jamais). */
function VisitMoves({ visits }) {
  const { tr } = useI18n();
  if (!visits || !visits.changed) {
    return <p className="muted tpm-preview-line">{tr('Aucune visite prévue ne change de TPM (les visites réalisées, annulées ou déjà facturées gardent toujours le leur).')}</p>;
  }
  return (
    <div className="tpm-moves">
      <p className="tpm-preview-line">{tr('{n} visite(s) prévue(s) changeront de TPM :', { n: formatInt(visits.changed) })}</p>
      <ul>
        {(visits.moves || []).slice(0, 8).map((m) => (
          <li key={`${m.fromProviderId}>${m.toProviderId}`}>
            <span>{m.fromName || tr('aucun TPM')}</span> <ArrowRight size={13} aria-hidden="true" /> <strong>{m.toName || tr('aucun TPM')}</strong>
            <span className="muted"> · {tr('{n} visite(s)', { n: formatInt(m.visits) })}{m.datedVisits ? ` ${tr('dont {d} datée(s)', { d: formatInt(m.datedVisits) })}` : ''}</span>
          </li>
        ))}
      </ul>
      <p className="muted tpm-preview-note">{tr('Les visites réalisées, annulées ou déjà facturées gardent toujours leur TPM.')}</p>
    </div>
  );
}

