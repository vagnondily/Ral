import React, { useEffect, useState } from 'react';
import { Coins, AlertCircle, Wallet, MapPin, CalendarCheck } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { dayLabel, formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { richText } from '../../lib/contracts.js';
import { useI18n } from '../../lib/i18n.jsx';
import PostesEditor, { newPoste, rowsFromItems, itemsFromRows } from './PostesEditor.jsx';
import { invalidPctRows } from '../../lib/postesMath.js';

/**
 * Planification & budget — éditeur du budget prévisionnel d'une vague de
 * collecte (feuille « Budget » du planning). Mêmes postes que la facture ;
 * le total bailleur alimente le « Planifié » de la consolidation et sert de
 * base au pré-remplissage de la facture.
 */
export default function PlanBudgetDrawer({ planId, context, month, onClose, onSaved }) {
  const { tr } = useI18n();
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

  // Retour 58 — règle unique : le TPM d'un contrat de suivi est le TPM rattaché (plans, factures),
  // sinon son titulaire. Choisir le contrat propose ce TPM ; choisir le TPM propose son contrat.
  const [contractTpms, setContractTpms] = useState({});
  useEffect(() => {
    if (editing || !month) return undefined;
    let alive = true;
    const m = String(month).slice(0, 7);
    api.tpmAttributionProviders({ from: m, to: m }).then((r) => { if (alive) setContractTpms(r.contractTpms || {}); }).catch(() => {});
    return () => { alive = false; };
  }, [editing, month]);
  const tpmsOf = (contractId) => contractTpms[contractId] || [];
  const choosePartner = (partnerId) => setHead((h) => {
    if (h.contractId || !partnerId) return { ...h, partnerId };
    const own = contracts.filter((c) => tpmsOf(c.id).some((p) => p.id === partnerId));
    return { ...h, partnerId, contractId: own.length === 1 ? own[0].id : '' };
  });
  const chooseContract = (contractId) => setHead((h) => {
    const tpms = tpmsOf(contractId);
    return { ...h, contractId, partnerId: h.partnerId || (tpms.length === 1 ? tpms[0].id : '') };
  });
  const headTpms = tpmsOf(head.contractId);
  const otherTpm = Boolean(head.contractId && head.partnerId && headTpms.length && !headTpms.some((p) => p.id === head.partnerId));

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
  if (!editing && !head.partnerId) errors.push(tr('Choisissez un prestataire.'));
  if (!editing && !head.contractId) errors.push(tr('Choisissez un contrat.'));
  if (itemsFromRows(rows).length === 0) errors.push(tr('Ajoutez au moins un poste prévu.'));
  // Un % bailleur illisible ou hors 0–100 est refusé, jamais ramené en silence à 0 ou 100 %.
  if (invalidPctRows(rows).length > 0) errors.push(tr('% bailleur invalide : saisissez un nombre entre 0 et 100 (vide = 100 %).'));

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
      toast.success(tr('Plan de collecte enregistré.'));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  const title = editing ? tr('Plan de collecte — budget prévisionnel') : tr('Nouveau plan de collecte');
  const subtitle = editing
    ? `${head.partnerName || ''} · ${head.contractNumero || ''}`
    : tr('Budget prévisionnel des postes de la vague de collecte (base du pré-remplissage de la facture).');

  return (
    <Modal
      open variant="drawer" size="xl" title={title} subtitle={subtitle}
      onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button>
        <Button onClick={save} loading={saving} icon={Wallet}>{tr('Enregistrer le plan')}</Button></>}
    >
      {loading ? <Skeleton height={240} /> : (
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="form-grid">
            {!editing && (
              <>
                <Field label={tr('Prestataire TPM')} required error={touched && !head.partnerId ? tr('Requis.') : undefined}
                  hint={headTpms.length ? tr('TPM du contrat : {p}', { p: headTpms.map((p) => p.name).join(', ') }) : undefined}>
                  <select className={`select ${head.partnerId ? '' : 'is-empty'}`} value={head.partnerId} onChange={(e) => choosePartner(e.target.value)}>
                    <option value="">{tr('Choisir…')}</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label={tr('Contrat suivi')} required error={touched && !head.contractId ? tr('Requis.') : undefined}>
                  <select className={`select ${head.contractId ? '' : 'is-empty'}`} value={head.contractId} onChange={(e) => chooseContract(e.target.value)}>
                    <option value="">{tr('Choisir…')}</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.partnerName} · {c.numero}</option>)}
                  </select>
                </Field>
              </>
            )}
            <Field label={tr('Intitulé du plan')} hint={tr('ex. Collecte septembre — cantines scolaires')}><input className="input" value={head.title} onChange={(e) => setHead({ ...head, title: e.target.value })} /></Field>
            <Field label={tr('Statut')}>
              <select className="select" value={head.status} onChange={(e) => setHead({ ...head, status: e.target.value })}>
                <option value="brouillon">{tr('Brouillon')}</option><option value="valide">{tr('Validé')}</option>
              </select>
            </Field>
          </div>

          {otherTpm && (
            <Alert tone="warn">{tr('Ce prestataire n\'est pas le TPM de ce contrat ({p}) : vérifiez le couple prestataire × contrat.', { p: headTpms.map((p) => p.name).join(', ') })}</Alert>
          )}
          {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>{richText(tr('Budget Suivi/TPM du contrat : <strong>{budget}</strong> · barème mensuel <strong>{ceiling}</strong>', { budget: formatAr(contract.monitoringBudget), ceiling: formatAr(contract.monthlyCeiling) }))}</span></div>}

          {head.partnerId && <AssignedSites providerId={head.partnerId} month={month} days={days}
            onReportDays={() => {
              // Les postes exprimés en jours (per diem, véhicule…) reçoivent le nombre de jours de collecte.
              const isDay = (r) => /\b(jours?|j|days?|hj|homme[- ]jours?)\b/i.test(String(r.unit || ''));
              const n = rows.filter(isDay).length;
              if (!n) { toast.info(tr('Aucun poste en jours : indiquez « jour » comme unité des postes concernés.')); return; }
              setRows(rows.map((r) => (isDay(r) ? { ...r, unitCount: String(days.totalDays) } : r)));
              toast.success(tr('{days} jour(s) reportés sur {n} poste(s) en jours.', { days: days.totalDays, n }));
            }} />}

          {touched && errors.length > 0 && <Alert tone="error" icon={AlertCircle}>{errors[0]}</Alert>}

          <PostesEditor rows={rows} onChange={setRows} funderLabel={tr('Part bailleur (Planifié)')} activities={context?.activities || []} />
        </div>
      )}
    </Modal>
  );
}

/**
 * Sites affectés au prestataire pour le mois (retour n° 8) : les visites que
 * l'affectation terrain lui a confiées justifient le budget prévisionnel —
 * jours de collecte = visites datées + jours de déplacement.
 */
function AssignedSites({ providerId, month, days, onReportDays }) {
  const { tr } = useI18n();
  const [visits, setVisits] = useState(null);
  useEffect(() => {
    let alive = true;
    setVisits(null);
    api.fieldVisits({ month, providerId }).then((v) => { if (alive) setVisits((v || []).filter((x) => x.status !== 'annule')); })
      .catch(() => { if (alive) setVisits([]); });
    return () => { alive = false; };
  }, [providerId, month]);
  if (visits === null) return <Skeleton height={80} />;
  const sites = new Set(visits.map((v) => v.siteId)).size;
  return (
    <section className="assigned-sites" aria-labelledby="as-title">
      <div className="assigned-head">
        <h4 id="as-title"><MapPin size={16} aria-hidden="true" /> {tr('Sites affectés en {month}', { month: monthLabel(month) })}</h4>
        <span className="muted">{tr('{sites} site(s) · {visits} visite(s)', { sites: formatInt(sites), visits: formatInt(visits.length) })}
          {days && days.totalDays > 0 ? ` · ${tr('{total} jour(s) de collecte ({visitDays} visite(s) datée(s) + {travel} de déplacement)', { total: days.totalDays, visitDays: days.visitDays, travel: days.travelDays })}` : ''}</span>
        {days && days.totalDays > 0 && <Button size="sm" variant="secondary" icon={CalendarCheck} onClick={onReportDays}>{tr('Reporter les jours dans les postes')}</Button>}
      </div>
      {visits.length === 0 ? (
        <p className="muted">{tr('Aucun site affecté à ce prestataire pour ce mois : affectez les visites dans « Suivi de processus › Affectation & visites » ; elles justifieront ce budget.')}</p>
      ) : (
        <div className="table-wrap assigned-table"><table className="table table-compact">
          <thead><tr><th scope="col">{tr('Site')}</th><th scope="col">{tr('Commune')}</th><th scope="col">{tr('Activité')}</th>
            <th scope="col">{tr('Date de visite')}</th><th scope="col">{tr('Statut')}</th></tr></thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id}>
                <td><strong>{v.siteName}</strong>{v.agent && <div className="site-meta">{v.agent}</div>}</td>
                <td>{v.commune || '—'}</td><td>{v.activity || '—'}</td>
                <td className="tabular">{v.visitDate ? dayLabel(String(v.visitDate).slice(0, 10)) : <span className="muted">{tr('non datée')}</span>}</td>
                <td>{v.status === 'realise' ? <Badge tone="green">{tr('Réalisée')}</Badge> : <Badge tone="blue">{tr('Planifiée')}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

