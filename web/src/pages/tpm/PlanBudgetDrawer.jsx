import React, { useEffect, useState } from 'react';
import { Coins, AlertCircle, Wallet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr } from '../../lib/format.js';
import PostesEditor, { newPoste, rowsFromItems, itemsFromRows } from './PostesEditor.jsx';

/**
 * Planification & budget — éditeur du budget prévisionnel d'une vague de
 * collecte (feuille « Budget » du planning). Mêmes postes que la facture ;
 * le total bailleur alimente le « Planifié » de la consolidation et sert de
 * base au pré-remplissage de la facture.
 */
export default function PlanBudgetDrawer({ planId, context, month, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(planId);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const [head, setHead] = useState({ partnerId: '', contractId: '', title: '', status: 'brouillon', partnerName: '', contractNumero: '' });
  const [rows, setRows] = useState(editing ? [] : [newPoste()]);

  const partners = context?.partners || [];
  const contracts = context?.contracts || [];
  const contract = contracts.find((c) => c.id === head.contractId);

  // Jours de collecte issus de la planification terrain (visites datées +
  // déplacement) — à reporter comme quantité des postes en jours.
  const [collDays, setCollDays] = useState([]);
  useEffect(() => { api.fieldCollectionDays(month).then(setCollDays).catch(() => setCollDays([])); }, [month]);
  const days = collDays.find((d) => d.providerId === head.partnerId);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api.getPlan(planId).then((p) => {
      if (!alive) return;
      setHead({
        partnerId: p.partnerId, contractId: p.contractId, title: p.title || '', status: p.status,
        partnerName: p.partnerName, contractNumero: p.contractNumero,
      });
      setRows(rowsFromItems(p.items));
      setLoading(false);
    }).catch((e) => { if (alive) { toast.error(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [editing, planId, toast]);

  const errors = [];
  if (!editing && !head.partnerId) errors.push('Choisissez un prestataire.');
  if (!editing && !head.contractId) errors.push('Choisissez un contrat.');
  if (itemsFromRows(rows).length === 0) errors.push('Ajoutez au moins un poste prévu.');

  async function save() {
    setTouched(true);
    if (errors.length) return;
    const items = itemsFromRows(rows);
    setSaving(true);
    try {
      if (editing) {
        await api.updatePlan(planId, { items, title: head.title.trim() || undefined, status: head.status });
      } else {
        await api.createPlan({ partnerId: head.partnerId, contractId: head.contractId, periodMonth: month, title: head.title.trim() || undefined, items });
      }
      toast.success('Plan de collecte enregistré.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  const title = editing ? 'Plan de collecte — budget prévisionnel' : 'Nouveau plan de collecte';
  const subtitle = editing
    ? `${head.partnerName || ''} · ${head.contractNumero || ''}`
    : 'Budget prévisionnel des postes de la vague de collecte (base du pré-remplissage de la facture).';

  return (
    <Modal
      open variant="drawer" size="xl" title={title} subtitle={subtitle}
      onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
        <Button onClick={save} loading={saving} icon={Wallet}>Enregistrer le plan</Button></>}
    >
      {loading ? <Skeleton height={240} /> : (
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="form-grid">
            {!editing && (
              <>
                <Field label="Prestataire TPM" required error={touched && !head.partnerId ? 'Requis.' : undefined}>
                  <select className={`select ${head.partnerId ? '' : 'is-empty'}`} value={head.partnerId} onChange={(e) => setHead({ ...head, partnerId: e.target.value })}>
                    <option value="">Choisir…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Contrat suivi" required error={touched && !head.contractId ? 'Requis.' : undefined}>
                  <select className={`select ${head.contractId ? '' : 'is-empty'}`} value={head.contractId} onChange={(e) => setHead({ ...head, contractId: e.target.value })}>
                    <option value="">Choisir…</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.partnerName} · {c.numero}</option>)}
                  </select>
                </Field>
              </>
            )}
            <Field label="Intitulé du plan" hint="ex. Collecte septembre — cantines scolaires"><input className="input" value={head.title} onChange={(e) => setHead({ ...head, title: e.target.value })} /></Field>
            <Field label="Statut">
              <select className="select" value={head.status} onChange={(e) => setHead({ ...head, status: e.target.value })}>
                <option value="brouillon">Brouillon</option><option value="valide">Validé</option>
              </select>
            </Field>
          </div>

          {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>Budget Suivi/TPM du contrat : <strong>{formatAr(contract.monitoringBudget)}</strong> · barème mensuel <strong>{formatAr(contract.monthlyCeiling)}</strong></span></div>}

          {days && days.totalDays > 0 && (
            <div className="note"><Coins size={18} aria-hidden="true" /><span>Jours de collecte planifiés pour ce prestataire ({month}) : <strong>{days.totalDays} jour(s)</strong> = {days.visitDays} visite(s) datée(s) + {days.travelDays} jour(s) de déplacement. À reporter comme quantité des postes « jour » ci-dessous.</span></div>
          )}

          {touched && errors.length > 0 && <Alert tone="error" icon={AlertCircle}>{errors[0]}</Alert>}

          <PostesEditor rows={rows} onChange={setRows} funderLabel="Part bailleur (Planifié)" activities={context?.activities || []} />
        </div>
      )}
    </Modal>
  );
}
