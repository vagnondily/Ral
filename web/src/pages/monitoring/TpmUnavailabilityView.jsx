import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarOff, CalendarCheck, Download, PencilLine } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, EmptyState, Skeleton, StatusBadge } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { currentMonth, formatDateTime, formatInt, shiftMonth, shortMonthLabel } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';
import {
  REASON_MIN, TPM_AVAILABILITY, UNAVAILABILITY_MAX_SPAN, UNAVAILABILITY_SUGGESTIONS, endRangeOf, monthsBetween, rangeLabel, unavailabilityListRange,
} from '../../lib/tpmAttribution.js';
import { ROLE_LABELS } from '../../lib/roles.js';
import { ReasonField } from './TpmFields.jsx';
import { VisitMoves } from './TpmChangeDialog.jsx';
import './tpmAttribution.css';

/** Plage la plus longue d'une décision (comme le serveur : tpmAttribution.MAX_SPAN_MONTHS). */
const MAX_SPAN = UNAVAILABILITY_MAX_SPAN;
const span = (from, to) => monthsBetween(from, to, MAX_SPAN + 1).length;

/**
 * Indisponibilités des TPM (retour 114 : « même avec un contrat, si cette entité n'est pas
 * disponible, on doit le faire ») — vue de l'onglet « Affectation des TPM ». Un TPM déclaré
 * indisponible sur des mois, avec un motif : ses zones passent en suivi interne (équipe S&E), ou à
 * l'autre TPM du contrat s'il y en a un ; y mettre fin les lui rend. Les visites prévues suivent ;
 * réalisées, annulées, figées, facturées ou motivées jamais. Chaque décision passe par un aperçu
 * (sans écriture) et reste au journal (avant → après, motif, auteur).
 * Props : { canEdit, period: { from, to }, onChanged }.
 */
export default function TpmUnavailabilityView({ canEdit, period, onChanged }) {
  const { tr } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // { mode, providerId?, from?, to?, reason? }
  const today = currentMonth();
  // Plage lue : bornée à 24 mois (plafond du serveur) ; une période qui la chevauche est rendue entière.
  const range = unavailabilityListRange(period, today);
  const activeTpm = new Set(((data && data.tpms) || []).map((t) => t.id));

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.tpmUnavailability(range)); } catch (e) { setError(e.message); }
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [load]);

  function exportCsv() {
    const lines = [[tr('TPM'), tr('Du'), tr('Au'), tr('Mois'), tr('Motif'), tr('Par'), tr('Le')]];
    for (const p of data.periods) lines.push([p.providerName, p.from, p.to, p.months, p.reason, p.updatedByName || '', p.updatedAt ? String(p.updatedAt).slice(0, 10) : '']);
    downloadCsv(`indisponibilites_tpm_${range.from}_${range.to}.csv`, lines);
  }

  return (
    <div className="card tpa-card">
      <div className="pb-filters tpa-filters">
        <p className="tpm-rule-note tpa-off-note">
          {tr('Un TPM indisponible ne suit plus ses zones pendant ces mois : la zone passe à l\'autre TPM de son contrat s\'il y en a un, sinon en suivi interne (équipe S&E). Les visites prévues suivent ; les visites réalisées, annulées ou déjà facturées ne changent jamais.')}
        </p>
        <span className="mmr-spacer" />
        <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!data || !data.periods.length}>{tr('Exporter (CSV)')}</Button>
        {canEdit && <Button size="sm" icon={CalendarOff} onClick={() => setDialog({ mode: 'poser' })} disabled={!data}>{tr('Déclarer une indisponibilité…')}</Button>}
        <p className="tpa-off-range">
          {tr('Indisponibilités qui touchent {p}.', { p: rangeLabel(range.from, range.to) })}
          {range.capped && <> {tr('Plage limitée à {n} mois : choisissez une période plus courte pour voir au-delà.', { n: formatInt(MAX_SPAN) })}</>}
        </p>
      </div>
      {error && <div className="card-body"><Alert tone="danger">{error}</Alert></div>}
      {!data ? <div className="card-body"><Skeleton height={160} /></div> : data.periods.length === 0 ? (
        <EmptyState title={tr('Aucune indisponibilité')}>
          {tr('Aucun TPM n\'est déclaré indisponible de {p}. Les zones suivent leurs contrats.', { p: rangeLabel(range.from, range.to) })}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table tpa-table">
            <thead>
              <tr>
                <th scope="col">{tr('TPM')}</th>
                <th scope="col">{tr('Période')}</th>
                <th scope="col">{tr('État')}</th>
                <th scope="col">{tr('Motif')}</th>
                <th scope="col">{tr('Décidé par')}</th>
                {canEdit && <th scope="col" className="tpa-actions"><span className="sr-only">{tr('Actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.periods.map((p) => {
                const ending = endRangeOf(p, today);
                const isTpm = activeTpm.has(p.providerId);
                return (
                  <tr key={`${p.providerId}|${p.from}`}>
                    <td><strong>{p.providerName}</strong>{!isTpm && <span className="tpa-tag">{tr('plus TPM actif')}</span>}</td>
                    <td className="tabular">{rangeLabel(p.from, p.to)}<div className="site-meta">{tr('{n} mois', { n: formatInt(p.months) })}</div></td>
                    <td><StatusBadge def={TPM_AVAILABILITY.indisponible} /></td>
                    <td className="tpa-reason"><span className="tpa-reason-text" title={p.reason}>{p.reason}</span></td>
                    <td className="tpa-log-who">{p.updatedByName || '—'}{p.updatedAt && <div className="site-meta">{formatDateTime(p.updatedAt)}</div>}</td>
                    {canEdit && (
                      <td className="tpa-actions">
                        <button type="button" className="tpm-edit" disabled={!isTpm}
                          title={isTpm ? tr('Changer le motif…') : tr('Ce partenaire n\'est plus un TPM actif : on peut seulement mettre fin à son indisponibilité.')}
                          aria-label={tr('Changer le motif · {p}', { p: p.providerName })}
                          onClick={() => setDialog({ mode: 'poser', providerId: p.providerId, providerName: p.providerName, from: p.from, to: p.to, reason: p.reason })}><PencilLine size={14} aria-hidden="true" /></button>
                        <button type="button" className="tpm-edit" disabled={!ending}
                          title={ending ? tr('Mettre fin…') : tr('Période passée : elle est déjà terminée.')}
                          aria-label={tr('Mettre fin · {p}', { p: p.providerName })}
                          onClick={() => ending && setDialog({ mode: 'retirer', providerId: p.providerId, providerName: p.providerName, ...ending })}><CalendarCheck size={14} aria-hidden="true" /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dialog && data && (
        <UnavailabilityDialog {...dialog} tpms={data.tpms} onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); if (onChanged) onChanged(); }} />
      )}
    </div>
  );
}

/**
 * Déclarer un TPM indisponible (ou changer le motif), ou y mettre fin, sur une plage de mois. L'aperçu
 * (POST /unavailability/preview, sans écriture) dit combien de mois changent, quelles zones passent en
 * suivi interne (ou à un autre TPM) et quelles visites PRÉVUES changent ; l'enregistrement exige un
 * motif (10 caractères au moins) et l'empreinte de l'aperçu (409 → aperçu relu, rien d'écrit).
 */
function UnavailabilityDialog({ mode, providerId: initialProvider = '', providerName = '', from, to, reason: initialReason = '', tpms, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const end = mode === 'retirer';
  const cur = currentMonth();
  const [provider, setProvider] = useState(initialProvider || '');
  const [range, setRange] = useState({ from: from || cur, to: to || cur });
  const [reason, setReason] = useState(initialReason || '');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const reasonKey = reason.trim();

  useEffect(() => {
    if (!provider) { setPreview(null); return undefined; }
    const id = seq.current + 1; seq.current = id;
    setLoading(true);
    const timer = setTimeout(() => {
      api.tpmUnavailabilityPreview({ providerId: provider, from: range.from, to: range.to, mode: end ? 'retirer' : 'poser', reason: reasonKey || undefined })
        .then((r) => { if (seq.current === id) { setPreview(r); setError(null); } })
        .catch((e) => { if (seq.current === id) { setPreview(null); setError(e.message); } })
        .finally(() => { if (seq.current === id) setLoading(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [provider, range, end, reasonKey]);

  const counts = (preview && preview.counts) || {};
  const writes = end ? (counts.deleted || 0) : (counts.created || 0) + (counts.updated || 0);
  const reasonOk = end || [...reasonKey].length >= REASON_MIN;
  const canSave = Boolean(preview) && !loading && writes > 0 && reasonOk;
  const setFrom = (m) => setRange((r) => ({ from: m, to: r.to < m ? m : (span(m, r.to) > MAX_SPAN ? shiftMonth(m, MAX_SPAN - 1) : r.to) }));
  const setTo = (m) => setRange((r) => ({ from: r.from > m ? m : (span(r.from, m) > MAX_SPAN ? shiftMonth(m, -(MAX_SPAN - 1)) : r.from), to: m }));
  // Nom du TPM : celui de la liste des TPM actifs, sinon celui de la ligne (partenaire qui n'est plus un
  // TPM actif, dont on met fin à l'indisponibilité — U3, U8) : jamais un dialogue sans nom.
  const listed = tpms.find((t) => t.id === provider);
  const name = (listed && listed.name) || (provider === initialProvider ? providerName : '') || '';

  async function save() {
    setSaving(true); setError(null); setStale(false);
    const body = { providerId: provider, from: range.from, to: range.to, reason: reasonKey || undefined, stamp: preview.stamp };
    try {
      const r = end ? await api.tpmUnavailabilityEnd(body) : await api.tpmUnavailabilitySave(body);
      const v = (r && r.visits) || {};
      toast.success(r.unchanged
        ? tr('Rien à enregistrer : ces mois sont déjà dans cet état.')
        : tr('Enregistré : {m} mois, {v} visite(s) prévue(s) mise(s) à jour.', { m: formatInt(writes), v: formatInt(v.changed || 0) }));
      onSaved();
    } catch (e) {
      if (e.status === 409) { setStale(true); setPreview(null); setRange((r) => ({ ...r })); } else setError(e.message);
    } finally { setSaving(false); }
  }

  const zones = (preview && preview.zones) || { toInternal: 0, toOther: 0, back: 0, list: [] };
  return (
    <Modal open wide onClose={() => !saving && onClose()}
      title={end ? tr('Mettre fin à l\'indisponibilité') : (initialProvider ? tr('Changer le motif d\'indisponibilité') : tr('Déclarer un TPM indisponible'))}
      subtitle={name || undefined}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button>
          <Button loading={saving} disabled={!canSave} onClick={save}>{end ? tr('Mettre fin') : tr('Enregistrer')}</Button>
        </>
      )}>
      <div className="tpm-dialog">
        <div className="field">
          <label className="field-label" htmlFor="tpm-off-provider">{tr('TPM')}</label>
          <select id="tpm-off-provider" className={`select ${provider ? '' : 'is-empty'}`} value={provider} disabled={Boolean(initialProvider)} onChange={(e) => setProvider(e.target.value)}>
            <option value="">{tr(ROLE_LABELS.chooseTpm)}</option>
            {tpms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {provider && !listed && <option value={provider}>{tr('{n} (plus TPM actif)', { n: name || '—' })}</option>}
          </select>
        </div>
        <div className="tpm-change-period" role="group" aria-label={tr('Période')}>
          <label>{tr('Du')} <MonthSelect value={range.from} back={24} forward={24} ariaLabel={tr('Premier mois')} onChange={setFrom} /></label>
          <label>{tr('au')} <MonthSelect value={range.to} back={24} forward={24} ariaLabel={tr('Dernier mois')} onChange={setTo} /></label>
          <span className="muted">{tr('{n} mois', { n: formatInt(span(range.from, range.to)) })}</span>
        </div>

        {provider && (
          <section className="tpm-preview" aria-live="polite" aria-busy={loading || undefined}>
            <h3 className="tpm-preview-title">{tr('Aperçu')}</h3>
            {!preview ? <Skeleton height={72} /> : (
              <>
                <p className="tpm-preview-line">
                  <strong>{end
                    ? tr('{n} mois redeviennent disponibles.', { n: formatInt(counts.deleted || 0) })
                    : tr('{n} mois deviennent indisponibles.', { n: formatInt(counts.created || 0) })}</strong>
                  {!end && counts.updated > 0 && <> {tr('{n} mois déjà indisponibles changent de motif.', { n: formatInt(counts.updated) })}</>}
                  {!end && counts.unchanged > 0 && <> {tr('{n} mois portent déjà ce motif.', { n: formatInt(counts.unchanged) })}</>}
                  {end && counts.nothing > 0 && <> {tr('{n} mois n\'étaient pas indisponibles.', { n: formatInt(counts.nothing) })}</>}
                </p>
                <p className="tpm-preview-line">
                  {end
                    ? tr('{n} zone-mois reviennent à ce TPM.', { n: formatInt(zones.back) })
                    : tr('{i} zone-mois passent en suivi interne (équipe S&E), {o} à un autre TPM du contrat.', { i: formatInt(zones.toInternal), o: formatInt(zones.toOther) })}
                  {zones.list.length > 0 && <span className="muted"> {zones.list.map((z) => `${z.name || '—'} ${shortMonthLabel(z.month)}`).join(' · ')}{(zones.toInternal + zones.toOther + zones.back) > zones.list.length ? ' …' : ''}</span>}
                </p>
                <VisitMoves visits={preview.visits} />
                {(preview.warnings || []).map((w) => (
                  <Alert key={w.code} tone="warn" icon={AlertTriangle}>
                    {tr('Plan de suivi déjà validé pour {m} : ses visites prévues changeront de TPM.', { m: w.months.map(shortMonthLabel).join(', ') })}
                  </Alert>
                ))}
              </>
            )}
          </section>
        )}

        {end ? (
          <ReasonField id="tpm-off-reason" value={reason} onChange={setReason} suggestions={false}
            placeholder={tr('Pourquoi y mettre fin ? Ex. équipe de retour, contrat repris…')}
            hint={tr('Facultative : la fin est journalisée avec le motif d\'origine.')} />
        ) : (
          <>
            <ReasonField id="tpm-off-reason" value={reason} onChange={setReason} required suggestions={false}
              placeholder={tr('Pourquoi ce TPM est-il indisponible ? Ex. équipe mobilisée ailleurs, contrat suspendu…')} />
            <div className="tpm-suggest" role="group" aria-label={tr('Suggestions de motif')}>
              {UNAVAILABILITY_SUGGESTIONS.map((x) => (
                <button key={x} type="button" className="tpm-chip" onClick={() => setReason(reasonKey ? `${reasonKey} — ${tr(x)}` : `${tr(x)} : `)}>{tr(x)}</button>
              ))}
            </div>
          </>
        )}

        {stale && <Alert tone="warn">{tr('Les indisponibilités de ce TPM ont changé entre-temps : l\'aperçu a été relu, vérifiez-le puis enregistrez.')}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
