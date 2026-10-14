import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { Button, Field, Alert } from './ui.jsx';
import { ApiError } from '../api/client.js';
import { useI18n } from '../lib/i18n.jsx';

/** Justificatif minimal d'un document validé (= deletionPolicy.MIN_JUSTIFICATION côté serveur). */
const MIN_JUSTIFICATION = 10;

/** Données reliées, par clé du serveur (deletionPolicy.LINKED_LABELS). */
const LINKED = {
  reports: ['{n} rapport', '{n} rapports'],
  factures: ['{n} facture remplie', '{n} factures remplies'],
  plans: ['{n} plan de collecte', '{n} plans de collecte'],
  amendments: ['{n} avenant', '{n} avenants'],
  renewals: ['{n} renouvellement', '{n} renouvellements'],
  visits: ['{n} visite de terrain', '{n} visites de terrain'],
  items: ['{n} poste de dépense', '{n} postes de dépense'],
  booked: ['Montant compté dans la consolidation', 'Montants comptés dans la consolidation'],
  applied: ['Modification appliquée au contrat', 'Modifications appliquées au contrat'],
};

const chars = (s) => [...s.trim()].length;

/**
 * Dialogue de suppression commun (retour n° 56).
 *
 * - document NON validé → simple confirmation ;
 * - document VALIDÉ → justificatif OBLIGATOIRE d'au moins 10 caractères, avec
 *   compteur ; réservé à l'administrateur (la page ne propose le bouton qu'à lui) ;
 * - `blockers` (données reliées connues d'avance, ex. un contrat) : le dialogue
 *   explique d'emblée pourquoi la suppression est impossible, sans bouton actif ;
 * - le serveur reste la source de vérité : un refus (409 donnée reliée, 403
 *   rôle, 400 justificatif) s'affiche ici, traduit, avec la liste des données
 *   reliées, sans fermer le dialogue.
 *
 * `onConfirm(justification)` doit renvoyer une promesse (l'appel API). En cas
 * de succès, `onDone` est appelé ; sinon l'erreur est montrée ici.
 */
export default function DeleteDialog({ open, onClose, title, description, validated, blockers = [], blockedHint, onConfirm, onDone }) {
  const { tr } = useI18n();
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const blocked = blockers.length > 0;
  const count = chars(justification);
  const tooShort = validated && count < MIN_JUSTIFICATION;

  function close() {
    if (busy) return;
    setJustification('');
    setError(null);
    onClose();
  }

  function refusal(e) {
    const reason = e.details?.reason;
    if (reason === 'linked_data') {
      return { text: tr('Suppression impossible : des données sont reliées à ce document.'), linked: e.details.linked || [] };
    }
    if (reason === 'admin_required') return { text: tr('Seul un administrateur peut supprimer un document validé.') };
    if (reason === 'justification_required') {
      return { text: tr('Un justificatif d’au moins {n} caractères est obligatoire pour supprimer un document validé.', { n: e.details.min || MIN_JUSTIFICATION }) };
    }
    return { text: e.message };
  }

  async function confirm() {
    if (blocked) return;
    if (tooShort) {
      setError({ text: tr('Un justificatif d’au moins {n} caractères est obligatoire pour supprimer un document validé.', { n: MIN_JUSTIFICATION }) });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(validated ? justification.trim() : undefined);
      setJustification('');
      onDone?.();
    } catch (e) {
      if (e instanceof ApiError) setError(refusal(e));
      else setError({ text: tr('La suppression a échoué. Réessayez.') });
    } finally {
      setBusy(false);
    }
  }

  const linkedList = (list) => (
    <ul className="linked-list">
      {list.map((l) => {
        const pair = LINKED[l.key];
        const text = pair ? tr(pair[l.count === 1 ? 0 : 1], { n: l.count }) : `${l.count} ${l.label}`;
        return <li key={l.key}>{text}</li>;
      })}
    </ul>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={title || tr('Supprimer ce document ?')}
      footer={(
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>{blocked ? tr('Fermer') : tr('Annuler')}</Button>
          {!blocked && (
            <Button variant="danger" icon={Trash2} loading={busy} disabled={tooShort} onClick={confirm}>{tr('Supprimer')}</Button>
          )}
        </>
      )}
    >
      {description && <p className="muted" style={{ marginTop: 0 }}>{description}</p>}
      {blocked ? (
        <Alert tone="warn">
          <div>{tr('Suppression impossible : des données sont reliées à ce document.')}</div>
          {linkedList(blockers)}
          {blockedHint && <div>{blockedHint}</div>}
        </Alert>
      ) : validated ? (
        <Alert tone="warn">
          {tr('Ce document est validé. Il ne peut être supprimé que s’il ne porte aucune donnée reliée, et avec un justificatif qui sera inscrit au journal des suppressions.')}
        </Alert>
      ) : (
        <p>{tr('Cette action est définitive. La suppression sera inscrite au journal des suppressions.')}</p>
      )}
      {validated && !blocked && (
        <Field
          label={tr('Justificatif')}
          required
          error={null}
          hint={tr('Pourquoi ce document validé est-il supprimé ? {n} / {min} caractères minimum.', { n: count, min: MIN_JUSTIFICATION })}
        >
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            maxLength={1000}
            aria-invalid={tooShort && count > 0 ? true : undefined}
            placeholder={tr('Ex. : doublon créé par erreur, document de test…')}
          />
        </Field>
      )}
      {error && (
        <Alert tone="danger">
          <div>{error.text}</div>
          {error.linked?.length > 0 && linkedList(error.linked)}
        </Alert>
      )}
    </Modal>
  );
}
