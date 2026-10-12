import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { Alert, Button, Field } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatAr, todayISO } from '../../lib/format.js';
import { amendmentCode, formatDate } from '../../lib/contracts.js';

function useValidators(open) {
  const [list, setList] = useState(null);
  useEffect(() => { if (open) api.listValidators().then(setList).catch(() => setList([])); }, [open]);
  return list;
}

function ValidatorSelect({ id, value, onChange, validators, error }) {
  const { tr } = useI18n();
  return (
    <Field label={tr('Valideur')} htmlFor={id} required hint={tr('Une autre personne que vous (séparation des tâches).')} error={error}>
      <select id={id} className={`select ${value ? '' : 'is-empty'}`} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error) || undefined} disabled={validators === null}>
        <option value="">{validators === null ? tr('Chargement…') : tr('Choisir un valideur…')}</option>
        {(validators || []).map((v) => <option key={v.id} value={v.id}>{v.email}</option>)}
      </select>
    </Field>
  );
}

function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); return true; }
    catch (err) { toast.error(err.message); return false; }
    finally { setBusy(false); }
  }
  return [busy, run];
}

const clampISO = (v, min, max) => (v < min ? min : v > max ? max : v);

export function SubmitDialog({ open, onClose, detail, onDone }) {
  const { tr } = useI18n();
  const validators = useValidators(open);
  const [validatorId, setValidatorId] = useState('');
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, run] = useAction();
  const c = detail.contract;
  useEffect(() => { if (open) { setValidatorId(c.validatorId || ''); setComment(''); setTouched(false); } }, [open, c.validatorId]);

  async function submit() {
    setTouched(true);
    if (!validatorId) return;
    if (await run(() => api.submitContract(c.id, { validatorId, comment: comment.trim() || undefined, version: c.version }), tr('Contrat soumis pour validation.'))) onDone();
  }
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={tr('Soumettre pour validation')} subtitle={`${c.partnerName} · ${c.numero}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button loading={busy} onClick={submit}>{tr('Soumettre')}</Button></>}>
      <p>{tr("Le contrat ne sera plus modifiable pendant sa validation. Le valideur pourra l'approuver (il devient actif) ou le rejeter avec un motif.")}</p>
      <ValidatorSelect id="sub-validator" value={validatorId} onChange={setValidatorId} validators={validators} error={touched && !validatorId ? tr('Choisissez un valideur.') : undefined} />
      <Field label={tr('Message au valideur')} htmlFor="sub-comment" hint={tr('Facultatif.')}><textarea id="sub-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
    </Modal>
  );
}

export function DecisionDialog({ open, onClose, detail, amendment, approve, onDone }) {
  const { tr } = useI18n();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, run] = useAction();
  const c = detail.contract;
  const title = amendment
    ? tr(approve ? "Approuver l'avenant {code} ?" : "Rejeter l'avenant {code} ?", { code: amendmentCode(amendment.number) })
    : tr(approve ? 'Approuver le contrat ?' : 'Rejeter le contrat ?');
  useEffect(() => { if (open) { setComment(''); setTouched(false); } }, [open]);

  async function decide() {
    setTouched(true);
    if (!approve && comment.trim().length === 0) return;
    const b = { comment: comment.trim() || undefined };
    const call = amendment
      ? () => (approve ? api.approveAmendment(c.id, amendment.id, b) : api.rejectAmendment(c.id, amendment.id, b))
      : () => (approve ? api.approveContract(c.id, { ...b, version: c.version }) : api.rejectContract(c.id, { ...b, version: c.version }));
    const msg = amendment ? (approve ? tr('Avenant {code} approuvé et appliqué.', { code: amendmentCode(amendment.number) }) : tr('Avenant rejeté.'))
      : (approve ? tr('Contrat approuvé : il est désormais actif.') : tr('Contrat rejeté.'));
    if (await run(call, msg)) onDone();
  }
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} subtitle={`${c.partnerName} · ${c.numero}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button loading={busy} onClick={decide}>{approve ? tr('Approuver') : tr('Rejeter')}</Button></>}>
      {approve
        ? <p>{amendment ? tr("Les modifications de l'avenant seront appliquées immédiatement et publiées aux autres modules.") : tr('Le contrat devient actif ; son activation est publiée aux modules Planning et Reporting.')}</p>
        : <p>{amendment ? tr("L'avenant sera clôturé sans effet sur le contrat.") : tr('Le contrat repassera en correction chez son rédacteur.')}</p>}
      <Field label={approve ? tr('Commentaire') : tr('Motif du rejet')} htmlFor="dec-comment" required={!approve}
        hint={approve ? tr("Facultatif — conservé dans l'historique.") : tr("Obligatoire — conservé dans l'historique.")}
        error={touched && !approve && !comment.trim() ? tr('Le motif est obligatoire.') : undefined}>
        <textarea id="dec-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Amendment: revise the end date and/or the management fee, with the same
 * validation circuit. Budget lines are revised by a new version if needed. */
export function AmendmentDrawer({ open, onClose, detail, onDone }) {
  const { tr } = useI18n();
  const c = detail.contract;
  const validators = useValidators(open);
  const currentFeePctDisplay = Math.round((c.managementFeePct ?? 0.07) * 1000) / 10;
  const [justification, setJustification] = useState('');
  const [newDateFin, setNewDateFin] = useState('');
  const [feePctPct, setFeePctPct] = useState('');
  const [validatorId, setValidatorId] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, run] = useAction();

  useEffect(() => { if (open) { setJustification(''); setNewDateFin(''); setFeePctPct(''); setValidatorId(''); setTouched(false); } }, [open]);

  const dateChanged = newDateFin && newDateFin !== c.dateFin;
  const feeChanged = feePctPct !== '' && Number(feePctPct) !== currentFeePctDisplay;
  const hasChange = dateChanged || feeChanged;
  const errs = {
    justification: justification.trim().length < 10 ? tr('Justification requise (10 caractères minimum).') : null,
    change: !hasChange ? tr('Modifiez la date de fin ou la commission de gestion.') : null,
    date: dateChanged && newDateFin <= c.dateDebut ? tr('La date de fin doit suivre la date de début.') : null,
    fee: feeChanged && (Number(feePctPct) < 0 || Number(feePctPct) > 100) ? tr('Commission entre 0 et 100 %.') : null,
    validator: !validatorId ? tr('Choisissez un valideur.') : null,
  };

  async function submit() {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    if (await run(() => api.requestAmendment(c.id, {
      justification: justification.trim(),
      newDateFin: dateChanged ? newDateFin : undefined,
      newFeePct: feeChanged ? Number(feePctPct) / 100 : undefined,
      validatorId,
    }), tr('Avenant soumis pour validation.'))) onDone();
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={tr('Avenant {code}', { code: amendmentCode(c.amendmentCount + 1) })}
      subtitle={`${c.partnerName} · ${c.reference || c.numero}`} initialFocus="#am-just"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button loading={busy} onClick={submit}>{tr("Soumettre l'avenant")}</Button></>}>
      <Alert tone="info" icon={Info}>{tr("L'avenant suit le même circuit que le contrat : il ne s'applique qu'après approbation du valideur.")}</Alert>
      <Field label={tr('Justification')} htmlFor="am-just" required error={touched ? errs.justification : undefined}>
        <textarea id="am-just" className="input" value={justification} onChange={(e) => setJustification(e.target.value)} />
      </Field>
      <Field label={tr('Nouvelle date de fin')} htmlFor="am-date" hint={tr('Actuelle : {value}. Laisser vide pour ne pas la changer.', { value: formatDate(c.dateFin) })} error={touched ? errs.date : undefined}>
        <input id="am-date" type="date" className="input" value={newDateFin} onChange={(e) => setNewDateFin(e.target.value)} />
      </Field>
      <Field label={tr('Nouvelle commission de gestion (%)')} htmlFor="am-fee" hint={tr('Actuelle : {value} %. Laisser vide pour ne pas la changer.', { value: currentFeePctDisplay })} error={touched ? errs.fee : undefined}>
        <input id="am-fee" type="number" min="0" max="100" step="0.5" className="input tabular" value={feePctPct} onChange={(e) => setFeePctPct(e.target.value)} placeholder={String(currentFeePctDisplay)} />
      </Field>
      {touched && errs.change && <span className="field-error">{errs.change}</span>}
      <ValidatorSelect id="am-validator" value={validatorId} onChange={setValidatorId} validators={validators} error={touched ? errs.validator : undefined} />
    </Modal>
  );
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function RenewDialog({ open, onClose, detail, onDone }) {
  const { tr } = useI18n();
  const c = detail.contract;
  const start = addDaysISO(c.dateFin, 1);
  const [newDateFin, setNewDateFin] = useState('');
  const [numeroFla, setNumeroFla] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, run] = useAction();
  useEffect(() => { if (open) { setNewDateFin(addDaysISO(start, 364)); setNumeroFla(''); setTouched(false); } }, [open, start]);
  const dateErr = !newDateFin || newDateFin <= start ? tr('Doit être après le {date}.', { date: formatDate(start) }) : null;

  async function renew() {
    setTouched(true);
    if (dateErr) return;
    let created;
    if (await run(async () => { created = await api.renewContract(c.id, { newDateFin, numeroFla: numeroFla.trim() || undefined }); }, tr('Renouvellement créé en brouillon.'))) onDone(created.id);
  }
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={tr('Renouveler le contrat')} subtitle={tr('{partner} · échéance le {date}', { partner: c.partnerName, date: formatDate(c.dateFin) })}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button loading={busy} onClick={renew}>{tr('Créer le renouvellement')}</Button></>}>
      <p>{tr('Un nouveau contrat est créé en brouillon, lié à celui-ci, avec le même partenaire, ses activités et sa structure budgétaire. Il suit ensuite le circuit de validation normal.')}</p>
      <div className="form-grid">
        <Field label={tr('Début')} htmlFor="rn-start" hint={tr("Lendemain de l'échéance actuelle.")}><input id="rn-start" className="input" value={formatDate(start)} disabled /></Field>
        <Field label={tr('Nouvelle date de fin')} htmlFor="rn-end" required error={touched ? dateErr : undefined}><input id="rn-end" type="date" className="input" value={newDateFin} onChange={(e) => setNewDateFin(e.target.value)} /></Field>
      </div>
      <Field label={tr('Nouveau N° FLA')} htmlFor="rn-fla" hint={tr('Facultatif — peut être complété sur le brouillon.')}><input id="rn-fla" className="input mono" value={numeroFla} onChange={(e) => setNumeroFla(e.target.value)} /></Field>
    </Modal>
  );
}

export function TerminateDialog({ open, onClose, detail, onDone }) {
  const { tr } = useI18n();
  const c = detail.contract;
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, run] = useAction();
  useEffect(() => { if (open) { setReason(''); setEffectiveDate(clampISO(todayISO(), c.dateDebut, c.dateFin)); setTouched(false); } }, [open, c.dateDebut, c.dateFin]);
  const errs = {
    reason: reason.trim().length < 10 ? tr('Motif obligatoire (10 caractères minimum).') : null,
    date: !effectiveDate || effectiveDate < c.dateDebut || effectiveDate > c.dateFin ? tr('Entre le {start} et le {end}.', { start: formatDate(c.dateDebut), end: formatDate(c.dateFin) }) : null,
  };
  async function confirm() {
    setTouched(true);
    if (errs.reason || errs.date) return;
    if (await run(() => api.terminateContract(c.id, { reason: reason.trim(), effectiveDate, version: c.version }), tr('Contrat résilié.'))) onDone();
  }
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={tr('Résilier le contrat ?')} subtitle={`${c.partnerName} · ${c.reference || c.numero}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button loading={busy} onClick={confirm}>{tr('Résilier définitivement')}</Button></>}>
      <Alert tone="warn" icon={AlertCircle}>{tr('Action définitive : le contrat sera verrouillé et sa résiliation publiée aux modules Planning, Alertes et Reporting.')}</Alert>
      <Field label={tr('Motif')} htmlFor="tm-reason" required error={touched ? errs.reason : undefined}><textarea id="tm-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Field label={tr("Date d'effet")} htmlFor="tm-date" required error={touched ? errs.date : undefined}><input id="tm-date" type="date" className="input" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></Field>
    </Modal>
  );
}
