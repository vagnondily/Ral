import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { Button, Field } from '../../components/ui.jsx';
import { BudgetItemsEditor, itemsToPayload, itemsFromBudget } from '../../components/BudgetItems.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { ROLE_LABELS, joinParts, typeLabelOf } from '../../lib/roles.js';

function emptyForm() {
  const y = new Date().getFullYear();
  return {
    partnerId: '', activityIds: [], numeroFla: '', numeroPo: '', numeroVendor: '',
    dateDebut: `${y}-01-01`, dateFin: `${y}-12-31`, items: [], feePct: 0.07,
  };
}

function fromDetail(detail) {
  const c = detail.contract;
  return {
    partnerId: c.partnerId || '', activityIds: detail.activities.map((a) => a.id),
    numeroFla: c.numeroFla || '', numeroPo: c.numeroPo || '', numeroVendor: c.numeroVendor || '',
    dateDebut: c.dateDebut, dateFin: c.dateFin,
    items: itemsFromBudget(detail.budget), feePct: c.managementFeePct ?? 0.07,
  };
}

export default function ContractFormDrawer({ open, onClose, detail, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [partners, setPartners] = useState(null);
  const [activities, setActivities] = useState(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const editing = Boolean(detail);

  useEffect(() => {
    if (!open) return;
    setForm(detail ? fromDetail(detail) : emptyForm());
    setTouched(false);
    api.listPartners().then(setPartners).catch(() => setPartners([]));
    api.listActivities().then((a) => setActivities(a.filter((x) => x.active !== false))).catch(() => setActivities([]));
  }, [open, detail]);

  const selectedActivities = useMemo(
    () => (activities || []).filter((a) => form.activityIds.includes(a.id)),
    [activities, form.activityIds]
  );

  const errors = {
    partnerId: !form.partnerId ? tr('Choisissez un partenaire.') : null,
    activityIds: form.activityIds.length === 0 ? tr('Sélectionnez au moins une activité.') : null,
    dateFin: form.dateFin <= form.dateDebut ? tr('La date de fin doit suivre la date de début.') : null,
  };
  const err = (k) => (touched ? errors[k] : undefined);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function toggleActivity(id) {
    const has = form.activityIds.includes(id);
    // Removing an activity drops its budget items.
    const items = has ? form.items.filter((it) => it.activityId !== id) : form.items;
    set({ activityIds: has ? form.activityIds.filter((x) => x !== id) : [...form.activityIds, id], items });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const payload = {
      partnerId: form.partnerId,
      activityIds: form.activityIds,
      numeroFla: form.numeroFla.trim(),
      numeroPo: form.numeroPo.trim(),
      numeroVendor: form.numeroVendor.trim(),
      dateDebut: form.dateDebut,
      dateFin: form.dateFin,
      managementFeePct: form.feePct,
      budget: itemsToPayload(form.items),
    };
    setSaving(true);
    try {
      if (editing) {
        await api.updateContract(detail.contract.id, { ...payload, version: detail.contract.version });
        toast.success(tr('Brouillon enregistré.'));
        onSaved(detail.contract.id);
      } else {
        const { id } = await api.createContract(payload);
        toast.success(tr('Contrat créé en brouillon.'));
        onSaved(id);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  const partnerLabel = (p) => joinParts(p.name, p.typeCode || p.typeLabel ? tr(typeLabelOf(p.typeCode, p.typeLabel)) : null);

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      variant="drawer"
      size="xl"
      title={editing ? tr('Modifier {numero}', { numero: detail.contract.numero }) : tr('Nouveau contrat')}
      subtitle={editing ? tr("Brouillon — modifiable jusqu'à sa soumission.") : tr('Créé en brouillon, numéroté automatiquement.')}
      initialFocus="#ct-partner"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button>
          <Button type="submit" form="contract-form" loading={saving}>{editing ? tr('Enregistrer') : tr('Créer le brouillon')}</Button>
        </>
      }
    >
      <form id="contract-form" onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
        <div className="form-grid">
          <div className="span-2">
            <Field label={tr(ROLE_LABELS.holder)} htmlFor="ct-partner" required hint={tr('Le partenaire qui signe le contrat (partenaire de mise en œuvre, ou TPM pour son propre contrat). Configuré dans Paramétrage › Partenaires.')} error={err('partnerId')}>
              <select id="ct-partner" className={`select ${form.partnerId ? '' : 'is-empty'}`} value={form.partnerId}
                onChange={(e) => set({ partnerId: e.target.value })} aria-invalid={Boolean(err('partnerId')) || undefined}>
                <option value="">{partners === null ? tr('Chargement…') : tr('Choisir un partenaire…')}</option>
                {(partners || []).map((p) => <option key={p.id} value={p.id}>{partnerLabel(p)}</option>)}
              </select>
            </Field>
          </div>

          <div className="span-2 field">
            <span className="field-label" id="ct-act">{tr('Activités couvertes')} <span className="req" aria-hidden="true">*</span></span>
            <div className="chips" role="group" aria-labelledby="ct-act">
              {activities === null && <span className="muted" style={{ fontSize: 14 }}>{tr('Chargement…')}</span>}
              {(activities || []).map((a) => (
                <button type="button" key={a.id} className="chip" aria-pressed={form.activityIds.includes(a.id)} onClick={() => toggleActivity(a.id)}>{a.label}</button>
              ))}
            </div>
            {err('activityIds') && <span className="field-error">{err('activityIds')}</span>}
            <span className="field-hint">{tr('Configurées dans Paramétrage › Activités (multi-sélection).')}</span>
          </div>

          <div className="span-2">
            <Field label={tr('N° FLA')} htmlFor="ct-fla" hint={tr('Field Level Agreement — ex. FLA-2025-AIN-MULTI-003')}>
              <input id="ct-fla" className="input mono" value={form.numeroFla} onChange={(e) => set({ numeroFla: e.target.value })} />
            </Field>
          </div>
          <Field label={tr('N° PO')} htmlFor="ct-po"><input id="ct-po" className="input mono" value={form.numeroPo} onChange={(e) => set({ numeroPo: e.target.value })} /></Field>
          <Field label={tr('N° Vendor')} htmlFor="ct-vendor"><input id="ct-vendor" className="input mono" value={form.numeroVendor} onChange={(e) => set({ numeroVendor: e.target.value })} /></Field>
          <Field label={tr('Date de début')} htmlFor="ct-debut" required><input id="ct-debut" type="date" className="input" value={form.dateDebut} onChange={(e) => set({ dateDebut: e.target.value })} /></Field>
          <Field label={tr('Date de fin')} htmlFor="ct-fin" required error={err('dateFin')}><input id="ct-fin" type="date" className="input" value={form.dateFin} onChange={(e) => set({ dateFin: e.target.value })} aria-invalid={Boolean(err('dateFin')) || undefined} /></Field>
        </div>

        <div className="field">
          <span className="field-label">{tr('Budget FLA — postes (nb unités × coût unitaire), par activité')}</span>
          <span className="field-hint" style={{ marginBottom: 8 }}>{tr("Les montants et le total de l'accord sont calculés. Ce total est le plafond du contrat ; le barème mensuel = total ÷ nombre de mois.")}</span>
          <BudgetItemsEditor
            activities={selectedActivities}
            items={form.items}
            onItems={(items) => set({ items })}
            feePct={form.feePct}
            onFee={(feePct) => set({ feePct })}
          />
        </div>
      </form>
    </Modal>
  );
}
