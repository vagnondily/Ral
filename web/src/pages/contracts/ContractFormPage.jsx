import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Save, Send, Info, FileUp } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button, Card, CardHeader, Field, PageHeader, Alert } from '../../components/ui.jsx';
import { BudgetItemsEditor, itemsToPayload, itemsFromBudget } from '../../components/BudgetItems.jsx';
import AreasSelector from '../../components/AreasSelector.jsx';
import { useToast } from '../../components/Toast.jsx';

function emptyForm() {
  const y = new Date().getFullYear();
  return {
    partnerId: '', activityIds: [], numeroFla: '', numeroPo: '', numeroVendor: '',
    dateDebut: `${y}-01-01`, dateFin: `${y}-12-31`, items: [], areas: [], feePct: 0.07,
    justification: '', validatorId: '',
  };
}

function fromDetail(detail) {
  const c = detail.contract;
  return {
    partnerId: c.partnerId || '', activityIds: detail.activities.map((a) => a.id),
    numeroFla: c.numeroFla || '', numeroPo: c.numeroPo || '', numeroVendor: c.numeroVendor || '',
    dateDebut: c.dateDebut, dateFin: c.dateFin,
    items: itemsFromBudget(detail.budget),
    areas: (detail.areas || []).map((a) => ({ adminAreaId: a.adminAreaId, path: a.path })),
    feePct: c.managementFeePct ?? 0.07,
    justification: '', validatorId: '',
  };
}

/**
 * Full-page contract form (create / edit draft / amend). An amendment follows
 * the SAME process as a new contract — it carries the full revised detail
 * (partner, activities, districts, budget postes, dates, commission) plus a
 * justification and a validator.
 */
export default function ContractFormPage({ mode = 'create', contractId, onDone, onCancel }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [partners, setPartners] = useState(null);
  const [activities, setActivities] = useState(null);
  const [validators, setValidators] = useState([]);
  const [detail, setDetail] = useState(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const isAmend = mode === 'amend';
  const isEdit = mode === 'edit';

  useEffect(() => {
    api.listPartners().then(setPartners).catch(() => setPartners([]));
    api.listActivities().then((a) => setActivities(a.filter((x) => x.active !== false))).catch(() => setActivities([]));
    if (isAmend) api.listValidators().then(setValidators).catch(() => setValidators([]));
    if ((isEdit || isAmend) && contractId) {
      api.getContract(contractId).then((d) => { setDetail(d); setForm(fromDetail(d)); }).catch((e) => setLoadErr(e.message));
    }
  }, [contractId, isEdit, isAmend]);

  const selectedActivities = useMemo(
    () => (activities || []).filter((a) => form.activityIds.includes(a.id)),
    [activities, form.activityIds]
  );

  const errors = {
    partnerId: !form.partnerId ? 'Choisissez un partenaire.' : null,
    activityIds: form.activityIds.length === 0 ? 'Sélectionnez au moins une activité.' : null,
    dateFin: form.dateFin <= form.dateDebut ? 'La date de fin doit suivre la date de début.' : null,
    justification: isAmend && form.justification.trim().length < 10 ? 'Justification requise (10 caractères min.).' : null,
    validatorId: isAmend && !form.validatorId ? 'Choisissez un valideur.' : null,
  };
  const err = (k) => (touched ? errors[k] : undefined);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function toggleActivity(id) {
    const has = form.activityIds.includes(id);
    const items = has ? form.items.filter((it) => it.activityId !== id) : form.items;
    set({ activityIds: has ? form.activityIds.filter((x) => x !== id) : [...form.activityIds, id], items });
  }

  const partnerLabel = (p) => `${p.name}${p.typeLabel ? ` · ${p.typeLabel}` : ''}`;

  // Import d'un Excel FLA → pré-remplit les postes (et la commission).
  async function onImportFile(e) {
    const file = e.target.files?.[0];
    if (file) {
      setImporting(true);
      try {
        const { items, feePct } = await api.importBudget(file);
        // Activité par défaut des postes importés : la 1ʳᵉ activité sélectionnée,
        // sinon on sélectionne automatiquement la 1ʳᵉ activité disponible.
        let activityIds = form.activityIds;
        let actId = form.activityIds[0];
        if (!actId && (activities || []).length) { actId = activities[0].id; activityIds = [actId]; }
        const rows = items.map((it) => ({ lineCode: it.lineCode, description: it.description, unitCount: it.unitCount, unitCost: it.unitCost, activityId: actId }));
        set({ items: rows, activityIds, feePct: feePct != null ? feePct : form.feePct });
        toast.success(`${rows.length} poste(s) importé(s) depuis l'Excel.`);
      } catch (err) { toast.error(err.message); }
      finally { setImporting(false); }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) { toast.error('Corrigez les champs en rouge.'); return; }
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
      areas: form.areas.map((a) => ({ adminAreaId: a.adminAreaId })),
    };
    setSaving(true);
    try {
      if (isAmend) {
        const res = await api.requestAmendment(contractId, { ...payload, justification: form.justification.trim(), validatorId: form.validatorId });
        toast.success(`Avenant ${res.code} soumis pour validation.`);
        onDone(contractId);
      } else if (isEdit) {
        await api.updateContract(contractId, { ...payload, version: detail.contract.version });
        toast.success('Brouillon enregistré.');
        onDone(contractId);
      } else {
        const { id } = await api.createContract(payload);
        toast.success('Contrat créé en brouillon.');
        onDone(id);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  const title = isAmend ? `Avenant — ${detail?.contract.partnerName || ''}`
    : isEdit ? `Modifier ${detail?.contract.numero || 'le contrat'}` : 'Nouveau contrat';
  const desc = isAmend
    ? 'Un avenant reprend le même processus qu\'un nouveau contrat : révisez le détail complet, puis soumettez pour validation.'
    : 'Renseignez le partenaire, les activités, les zones d\'intervention et le budget FLA par postes.';

  if (loadErr) return <div className="section-gap"><Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onCancel}>Retour</Button><Alert tone="error">{loadErr}</Alert></div>;

  return (
    <form className="section-gap contract-form-page" onSubmit={handleSubmit} noValidate>
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onCancel} className="back-link">Retour aux contrats</Button>
      <PageHeader title={title} description={desc} />

      <Card>
        <CardHeader title="Identité du partenariat" />
        <div className="card-body form-grid">
          <div className="span-2">
            <Field label="Partenaire" htmlFor="ct-partner" required hint="Configuré dans Paramétrage › Partenaires." error={err('partnerId')}>
              <select id="ct-partner" className={`select ${form.partnerId ? '' : 'is-empty'}`} value={form.partnerId}
                onChange={(e) => set({ partnerId: e.target.value })}>
                <option value="">{partners === null ? 'Chargement…' : 'Choisir un partenaire…'}</option>
                {(partners || []).map((p) => <option key={p.id} value={p.id}>{partnerLabel(p)}</option>)}
              </select>
            </Field>
          </div>
          <div className="span-2 field">
            <span className="field-label" id="ct-act">Activités couvertes <span className="req" aria-hidden="true">*</span></span>
            <div className="chips" role="group" aria-labelledby="ct-act">
              {activities === null && <span className="muted" style={{ fontSize: 14 }}>Chargement…</span>}
              {(activities || []).map((a) => (
                <button type="button" key={a.id} className="chip" aria-pressed={form.activityIds.includes(a.id)} onClick={() => toggleActivity(a.id)}>{a.label}</button>
              ))}
            </div>
            {err('activityIds') && <span className="field-error">{err('activityIds')}</span>}
            <span className="field-hint">Configurées dans Paramétrage › Activités (multi-sélection). L'activité de chaque poste se choisit dans le budget.</span>
          </div>
          <div className="span-2"><Field label="N° FLA" htmlFor="ct-fla" hint="Field Level Agreement — ex. FLA-2025-AIN-MULTI-003">
            <input id="ct-fla" className="input mono" value={form.numeroFla} onChange={(e) => set({ numeroFla: e.target.value })} /></Field></div>
          <Field label="N° PO" htmlFor="ct-po"><input id="ct-po" className="input mono" value={form.numeroPo} onChange={(e) => set({ numeroPo: e.target.value })} /></Field>
          <Field label="N° Vendor" htmlFor="ct-vendor"><input id="ct-vendor" className="input mono" value={form.numeroVendor} onChange={(e) => set({ numeroVendor: e.target.value })} /></Field>
          <Field label="Date de début" htmlFor="ct-debut" required><input id="ct-debut" type="date" className="input" value={form.dateDebut} onChange={(e) => set({ dateDebut: e.target.value })} /></Field>
          <Field label="Date de fin" htmlFor="ct-fin" required error={err('dateFin')}><input id="ct-fin" type="date" className="input" value={form.dateFin} onChange={(e) => set({ dateFin: e.target.value })} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Zones d'intervention affectées au prestataire" subtitle="Districts / communes du découpage administratif (Paramétrage › Localités)." />
        <div className="card-body">
          <AreasSelector value={form.areas} onChange={(areas) => set({ areas })} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Budget FLA — postes (nb unités × coût unitaire)" subtitle="Le montant, les totaux par activité et le Total de l'accord (plafond) sont calculés. Barème mensuel = total ÷ nombre de mois.">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onImportFile} />
          <Button type="button" variant="secondary" icon={FileUp} loading={importing} onClick={() => fileRef.current?.click()}>
            Importer depuis Excel
          </Button>
        </CardHeader>
        <div className="card-body">
          <div className="note" style={{ marginBottom: 16 }}>
            <Info size={18} aria-hidden="true" />
            <span>Importez votre fichier <strong>budget FLA (.xlsx)</strong> pour remplir automatiquement les postes et la commission (feuilles « Détails Section … »). Vous pourrez ensuite ajuster.</span>
          </div>
          <BudgetItemsEditor
            activities={selectedActivities}
            items={form.items}
            onItems={(items) => set({ items })}
            feePct={form.feePct}
            onFee={(feePct) => set({ feePct })}
          />
        </div>
      </Card>

      {isAmend && (
        <Card>
          <CardHeader title="Validation de l'avenant" />
          <div className="card-body form-grid">
            <div className="span-2"><Field label="Justification" htmlFor="am-just" required error={err('justification')}>
              <textarea id="am-just" className="input" rows={3} value={form.justification} onChange={(e) => set({ justification: e.target.value })} placeholder="Motif de l'avenant (extension, révision budgétaire, nouvelles zones…)" />
            </Field></div>
            <div className="span-2"><Field label="Valideur" htmlFor="am-validator" required hint="Une autre personne que vous (séparation des tâches)." error={err('validatorId')}>
              <select id="am-validator" className="select" value={form.validatorId} onChange={(e) => set({ validatorId: e.target.value })}>
                <option value="">Choisir un valideur…</option>
                {validators.map((v) => <option key={v.id} value={v.id}>{v.email}</option>)}
              </select>
            </Field></div>
          </div>
        </Card>
      )}

      <div className="note"><Info size={18} aria-hidden="true" />
        <span>{isAmend ? 'L\'avenant suit le circuit de validation : il ne s\'applique qu\'après approbation du valideur.' : 'Le contrat est créé en brouillon ; vous le soumettez ensuite à un valideur.'}</span>
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={onCancel} disabled={saving} type="button">Annuler</Button>
        <Button type="submit" icon={isAmend ? Send : Save} loading={saving}>
          {isAmend ? 'Soumettre l\'avenant' : isEdit ? 'Enregistrer' : 'Créer le brouillon'}
        </Button>
      </div>
    </form>
  );
}
