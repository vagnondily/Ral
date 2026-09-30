import React, { useEffect, useMemo, useState } from 'react';
import { Plus, FileText, ShieldCheck, X, Coins, AlertCircle, Info, Paperclip } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatAr, formatInt, formatDateTime } from '../../lib/format.js';
import { REPORT_KIND, REPORT_STATUS, formatDate } from '../../lib/contracts.js';

export default function ReportsPage({ canEdit, onOpenContract }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [context, setContext] = useState(null);
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(false);
  const [decide, setDecide] = useState(null); // {report, approve}

  async function reload() {
    setError(null);
    try {
      const [ctx, list] = await Promise.all([api.reportsContext(), api.listReports({ month })]);
      setContext(ctx); setReports(list);
    } catch (err) { setError(err.message); setReports((r) => r || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [month]);

  const stats = useMemo(() => {
    const list = reports || [];
    const fin = list.filter((r) => r.kind === 'financier');
    const justified = fin.filter((r) => r.status === 'valide').reduce((n, r) => n + (r.reportedAmount || 0), 0);
    const pending = list.filter((r) => r.status === 'soumis').length;
    return { total: list.length, justified, pending, tech: list.filter((r) => r.kind === 'technique').length };
  }, [reports]);

  async function runDecision(report, approve, comment) {
    try {
      if (approve) await api.approveReport(report.id, { comment });
      else await api.rejectReport(report.id, { comment });
      toast.success(approve ? 'Rapport validé.' : 'Rapport rejeté.');
      setDecide(null); reload();
    } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="section-gap">
      <PageHeader title="Rapports & dépenses" description="L'assignation des dépenses du suivi tiers se fait ici : chaque mois, les prestataires TPM produisent des rapports financiers (montant justifié) et techniques, rattachés au budget mensuel planifié — à faire avant le rapportage.">
        <MonthPicker value={month} onChange={setMonth} />
        {canEdit && <Button icon={Plus} onClick={() => setModal(true)}>Nouveau rapport</Button>}
      </PageHeader>

      <Stats items={[
        { label: 'Rapports du mois', value: reports ? stats.total : '—', foot: `${stats.tech} technique(s)` },
        { label: 'Dépenses justifiées (validées)', value: reports ? formatInt(stats.justified) : '—', suffix: 'Ar', foot: 'Rapports financiers validés' },
        { label: 'En attente de validation', value: reports ? stats.pending : '—', foot: 'Statut « soumis »' },
        { label: 'Contrats suivis', value: context ? context.contracts.length : '—', foot: 'Avec budget Suivi/TPM' },
      ]} />

      <Card aria-labelledby="rep-title">
        <CardHeader id="rep-title" title="Rapports du mois" subtitle="Un rapport financier et un technique attendus par prestataire, contrat et mois." />
        {error && <div style={{ padding: '16px 20px 0' }}><Alert tone="error" icon={AlertCircle}>{error}</Alert></div>}
        {reports === null ? <div className="card-body"><Skeleton height={120} /></div> : reports.length === 0 ? (
          <EmptyState icon={FileText} title="Aucun rapport ce mois-ci"
            action={canEdit && <Button icon={Plus} onClick={() => setModal(true)}>Nouveau rapport</Button>}>
            Enregistrez les rapports financiers et techniques des prestataires TPM pour ce mois.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">Prestataire TPM</th><th scope="col">Contrat</th><th scope="col">Type</th>
                <th scope="col" className="num">Prévu</th><th scope="col" className="num">Justifié</th>
                <th scope="col">Document</th><th scope="col">Statut</th><th scope="col" />
              </tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.partnerName}</strong></td>
                    <td><button type="button" className="link-cell" onClick={() => onOpenContract(r.contractId)}>{r.contractPartner}</button><div className="site-meta mono">{r.contractNumero}</div></td>
                    <td><Badge tone={REPORT_KIND[r.kind].tone}>{REPORT_KIND[r.kind].label}</Badge></td>
                    <td className="num">{r.plannedAmount != null ? formatAr(r.plannedAmount) : <span className="cell-empty">—</span>}</td>
                    <td className="num">{r.kind === 'financier' ? formatAr(r.reportedAmount || 0) : <span className="cell-empty">—</span>}</td>
                    <td>{r.documentName ? <span className="agent" style={{ gap: 6 }}><Paperclip size={14} aria-hidden="true" />{r.documentName}</span> : <span className="cell-empty">—</span>}{r.reference && <div className="site-meta mono">{r.reference}</div>}</td>
                    <td><Badge tone={REPORT_STATUS[r.status].tone} dot>{REPORT_STATUS[r.status].label}</Badge></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canEdit && r.status === 'soumis' && <>
                        <Button size="sm" variant="ghost" icon={ShieldCheck} onClick={() => setDecide({ report: r, approve: true })}>Valider</Button>
                        <Button size="sm" variant="ghost" icon={X} onClick={() => setDecide({ report: r, approve: false })}>Rejeter</Button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="note"><Info size={18} aria-hidden="true" /><span>Les rapports financiers validés alimentent la consommation du budget « Suivi/TPM » (section IV) du contrat. L'upload réel des fichiers viendra dans une itération ultérieure (métadonnées d'abord).</span></div>

      {modal && <ReportModal month={month} context={context} onClose={() => setModal(false)} onSaved={() => { setModal(false); reload(); }} />}
      {decide && <DecideModal decide={decide} onClose={() => setDecide(null)} onConfirm={runDecision} />}
    </div>
  );
}

function ReportModal({ month, context, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ partnerId: '', contractId: '', kind: 'financier', reportedAmount: '', plannedAmount: '', reference: '', documentName: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const partners = context?.partners || [];
  const contracts = context?.contracts || [];
  const contract = contracts.find((c) => c.id === form.contractId);
  const isFin = form.kind === 'financier';
  const errs = {
    partnerId: !form.partnerId ? 'Choisissez un prestataire.' : null,
    contractId: !form.contractId ? 'Choisissez un contrat.' : null,
    reportedAmount: isFin && !(Number(form.reportedAmount) >= 0 && form.reportedAmount !== '') ? 'Montant justifié requis.' : null,
  };

  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    setSaving(true);
    try {
      await api.createReport({
        partnerId: form.partnerId, contractId: form.contractId, periodMonth: month, kind: form.kind,
        reportedAmount: isFin ? Number(form.reportedAmount) : undefined,
        plannedAmount: form.plannedAmount !== '' ? Number(form.plannedAmount) : undefined,
        reference: form.reference.trim() || undefined, documentName: form.documentName.trim() || undefined,
      });
      toast.success('Rapport enregistré.');
      onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title="Nouveau rapport" subtitle="Rattaché au budget mensuel planifié du suivi tiers." initialFocus="#rp-partner"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button type="submit" form="report-form" loading={saving}>Enregistrer</Button></>}>
      <form id="report-form" onSubmit={save} noValidate style={{ display: 'grid', gap: 16 }}>
        <div className="form-grid">
          <Field label="Prestataire TPM" htmlFor="rp-partner" required error={touched ? errs.partnerId : undefined}>
            <select id="rp-partner" className={`select ${form.partnerId ? '' : 'is-empty'}`} value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })}>
              <option value="">Choisir…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Contrat suivi" htmlFor="rp-contract" required error={touched ? errs.contractId : undefined}>
            <select id="rp-contract" className={`select ${form.contractId ? '' : 'is-empty'}`} value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>
              <option value="">Choisir…</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.partnerName} · {c.numero}</option>)}
            </select>
          </Field>
        </div>
        {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>Total de l'accord : <strong>{formatAr(contract.grandTotal)}</strong> · barème mensuel <strong>{formatAr(contract.monthlyCeiling)}</strong> ({contract.periodMonths} mois) · budget Suivi/TPM {formatAr(contract.monitoringBudget)}</span></div>}

        <div className="field">
          <span className="field-label">Type de rapport</span>
          <div className="chips" role="group" aria-label="Type de rapport">
            {['financier', 'technique'].map((k) => (
              <button type="button" key={k} className="chip" aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{REPORT_KIND[k].label}</button>
            ))}
          </div>
        </div>

        <div className="form-grid">
          <Field label="Budget prévu du mois (Ar)" htmlFor="rp-planned" hint={contract ? `Barème mensuel : ${formatAr(contract.monthlyCeiling)}` : 'Total ÷ nombre de mois.'}>
            <MoneyInput id="rp-planned" value={form.plannedAmount} onChange={(v) => setForm({ ...form, plannedAmount: v })} />
          </Field>
          {isFin && (
            <Field label="Montant justifié (Ar)" htmlFor="rp-amount" required error={touched ? errs.reportedAmount : undefined}>
              <MoneyInput id="rp-amount" value={form.reportedAmount} onChange={(v) => setForm({ ...form, reportedAmount: v })} invalid={Boolean(touched && errs.reportedAmount)} />
            </Field>
          )}
        </div>
        <div className="form-grid">
          <Field label="Nom du document" htmlFor="rp-doc" hint="Métadonnée (fichier non stocké pour l'instant).">
            <input id="rp-doc" className="input" value={form.documentName} onChange={(e) => setForm({ ...form, documentName: e.target.value })} placeholder="Rapport_financier_AINA_2026-06.pdf" />
          </Field>
          <Field label="Référence" htmlFor="rp-ref"><input id="rp-ref" className="input mono" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        </div>
      </form>
    </Modal>
  );
}

function DecideModal({ decide, onClose, onConfirm }) {
  const { report, approve } = decide;
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setTouched(true);
    if (!approve && comment.trim().length === 0) return;
    setBusy(true);
    await onConfirm(report, approve, comment.trim() || undefined);
    setBusy(false);
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title={approve ? 'Valider le rapport ?' : 'Rejeter le rapport ?'}
      subtitle={`${report.partnerName} · ${report.contractNumero} · ${REPORT_KIND[report.kind].label}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Annuler</Button><Button loading={busy} onClick={go}>{approve ? 'Valider' : 'Rejeter'}</Button></>}>
      {approve
        ? <p>{report.kind === 'financier' ? `Le montant justifié (${formatAr(report.reportedAmount || 0)}) sera comptabilisé dans la consommation du budget Suivi/TPM du contrat.` : 'Le rapport technique sera marqué comme validé.'}</p>
        : <p>Le rapport repassera à corriger côté prestataire.</p>}
      <Field label={approve ? 'Commentaire' : 'Motif du rejet'} htmlFor="dc-comment" required={!approve} error={touched && !approve && !comment.trim() ? 'Motif obligatoire.' : undefined}>
        <textarea id="dc-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  );
}
