import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { Alert, Button, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { REASON_MIN } from '../../lib/tpmAttribution.js';
import { NONE, ProviderSelect, ReasonField } from './TpmFields.jsx';

/**
 * Changer le TPM de visites (retour 58) : par défaut une visite suit le TPM de sa zone (contrats) ;
 * « Autre TPM » est un écart motivé pour CES visites (raison obligatoire, journalisé), « Revenir au
 * TPM de la zone » efface l'écart. Pour toute une zone, préférez l'onglet Affectation des TPM.
 * @param {{ visits: object[], onClose: () => void, onSaved: () => void }} props
 */
export default function TpmVisitDialog({ visits, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const months = useMemo(() => [...new Set(visits.map((v) => v.periodMonth))].sort(), [visits]);
  const anyException = visits.some((v) => (v.providerSource || 'zone') !== 'zone');
  const anyReprise = visits.some((v) => v.providerSource === 'reprise');
  const [action, setAction] = useState(anyException ? 'zone' : 'set');
  const [provider, setProvider] = useState('');
  const [reason, setReason] = useState('');
  const [selectable, setSelectable] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.tpmAttributionProviders({ from: months[0], to: months[months.length - 1] })
      .then((r) => { if (live) setSelectable(r); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [months]);

  const needsReason = action !== 'zone';
  const reasonOk = !needsReason || [...reason.trim()].length >= REASON_MIN;
  const ready = action === 'zone' || action === 'keep' || provider;

  async function save() {
    setSaving(true); setError(null);
    try {
      const r = await api.tpmAttributionVisits({
        visitIds: visits.map((v) => v.id), action,
        providerId: action === 'set' ? (provider === NONE ? null : provider) : undefined,
        reason: reason.trim() || undefined,
      });
      toast.success(r.updated
        ? tr('TPM mis à jour sur {n} visite(s).', { n: formatInt(r.updated) })
        : tr('Rien à changer : ces visites ont déjà ce TPM.'));
      onSaved();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  const title = visits.length === 1
    ? tr('TPM de la visite · {s}', { s: visits[0].siteName })
    : tr('TPM de {n} visites', { n: formatInt(visits.length) });
  return (
    <Modal open onClose={() => !saving && onClose()} title={title}
      subtitle={months.map(monthLabel).join(', ')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button>
          <Button loading={saving} disabled={!ready || !reasonOk} onClick={save}>{tr('Enregistrer')}</Button>
        </>
      )}>
      <div className="tpm-dialog">
        {visits.length === 1 && (
          <p className="muted tpm-dialog-now">
            {tr('TPM actuel : {p}', { p: visits[0].providerName || tr('aucun') })}
          </p>
        )}
        <div className="tpm-options" role="radiogroup" aria-label={tr('TPM de la visite')}>
          <label className={`tpm-option ${action === 'zone' ? 'is-active' : ''}`}>
            <input type="radio" name="tpm-action" checked={action === 'zone'} onChange={() => setAction('zone')} />
            <span><strong>{tr('TPM de la zone (contrats)')}</strong><span className="muted">{tr('La visite suit le TPM du contrat qui couvre sa zone ce mois-là, ou la modification de la zone.')}</span></span>
          </label>
          <label className={`tpm-option ${action === 'set' ? 'is-active' : ''}`}>
            <input type="radio" name="tpm-action" checked={action === 'set'} onChange={() => setAction('set')} />
            <span><strong>{tr('Autre TPM pour cette visite')}</strong><span className="muted">{tr('Écart motivé, gardé même si le contrat change ; raison obligatoire.')}</span></span>
          </label>
          {anyReprise && (
            <label className={`tpm-option ${action === 'keep' ? 'is-active' : ''}`}>
              <input type="radio" name="tpm-action" checked={action === 'keep'} onChange={() => setAction('keep')} />
              <span><strong>{tr('Garder le TPM saisi avant la règle')}</strong><span className="muted">{tr('Devient un écart motivé ; raison obligatoire.')}</span></span>
            </label>
          )}
        </div>
        {action === 'set' && (
          <div className="field">
            <label className="field-label" htmlFor="tpm-visit-provider">{tr('Nouveau TPM')}</label>
            {selectable ? <ProviderSelect id="tpm-visit-provider" selectable={selectable} value={provider} onChange={setProvider} noneLabel={tr('Aucun TPM (désaffecter)')} />
              : <Skeleton height={38} />}
          </div>
        )}
        {needsReason && <ReasonField id="tpm-visit-reason" value={reason} onChange={setReason} required />}
        <p className="muted tpm-dialog-note">
          {tr('Pour toute une zone (district, commune) et plusieurs mois, utilisez l\'onglet Affectation des TPM : toutes les visites de la zone en profitent.')}
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
