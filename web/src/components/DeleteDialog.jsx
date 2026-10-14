import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { Button, Field, Alert } from './ui.jsx';
import { ApiError } from '../api/client.js';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Dialogue de suppression commun (retour n° 56).
 *
 * - document NON validé → simple confirmation ;
 * - document VALIDÉ → justificatif OBLIGATOIRE (zone de texte) ;
 * - le serveur reste la source de vérité : un refus 409 (donnée reliée) ou 400
 *   (justificatif manquant) s'affiche dans le dialogue, sans le fermer.
 *
 * `onConfirm(justification)` doit renvoyer une promesse (l'appel API). En cas
 * de succès, `onDone` est appelé ; sinon l'erreur est montrée ici.
 */
export default function DeleteDialog({ open, onClose, title, description, validated, onConfirm, onDone }) {
  const { tr } = useI18n();
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function close() {
    if (busy) return;
    setJustification('');
    setError(null);
    onClose();
  }

  async function confirm() {
    if (validated && !justification.trim()) {
      setError(tr('Un justificatif est obligatoire pour supprimer un document validé.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(validated ? justification.trim() : undefined);
      setJustification('');
      onDone?.();
    } catch (e) {
      // 409 = donnée reliée, 400 = justificatif manquant : message serveur.
      if (e instanceof ApiError) setError(e.message);
      else setError(tr('La suppression a échoué. Réessayez.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title || tr('Supprimer ce document ?')}
      footer={(
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>{tr('Annuler')}</Button>
          <Button variant="danger" icon={Trash2} loading={busy} onClick={confirm}>{tr('Supprimer')}</Button>
        </>
      )}
    >
      {description && <p className="muted" style={{ marginTop: 0 }}>{description}</p>}
      {validated ? (
        <Alert tone="warn">
          {tr('Ce document est validé. Il ne peut être supprimé que s’il ne porte aucune donnée reliée, et avec un justificatif qui sera inscrit au journal des suppressions.')}
        </Alert>
      ) : (
        <p>{tr('Cette action est définitive. La suppression sera inscrite au journal des suppressions.')}</p>
      )}
      {validated && (
        <Field label={tr('Justificatif')} required error={null} hint={tr('Pourquoi ce document validé est-il supprimé ?')}>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={tr('Ex. : doublon créé par erreur, document de test…')}
          />
        </Field>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}
