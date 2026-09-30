import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Wallet, AlertCircle, Trash2, FileText } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stats } from '../../components/ui.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatAr, formatInt } from '../../lib/format.js';
import PlanBudgetDrawer from './PlanBudgetDrawer.jsx';

const PLAN_STATUS = { brouillon: { label: 'Brouillon', tone: 'yellow' }, valide: { label: 'Validé', tone: 'green' } };

/**
 * Planification & budget — les budgets prévisionnels des vagues de collecte du
 * mois. Chaque plan (prestataire × contrat) porte des postes prévus qui
 * alimentent le « Planifié » de la consolidation et pré-remplissent la facture.
 */
export default function PlanningPage({ canEdit }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [context, setContext] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null); // {planId?} | null

  async function reload() {
    setError(null);
    try {
      const [ctx, list] = await Promise.all([api.reportsContext(), api.listPlans({ month })]);
      setContext(ctx); setPlans(list);
    } catch (err) { setError(err.message); setPlans((p) => p || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [month]);

  const stats = useMemo(() => {
    const list = plans || [];
    return {
      count: list.length,
      planned: list.reduce((n, p) => n + (p.plannedFunder || 0), 0),
      total: list.reduce((n, p) => n + (p.plannedTotal || 0), 0),
      valides: list.filter((p) => p.status === 'valide').length,
    };
  }, [plans]);

  async function remove(id) {
    try { await api.deletePlan(id); toast.success('Plan supprimé.'); reload(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <div className="section-gap">
      <PageHeader title="Planification & budget" description="Budget prévisionnel des vagues de collecte : postes prévus par prestataire et contrat. Le total « part bailleur » alimente le Planifié de la consolidation et sert de base à la facture.">
        <MonthPicker value={month} onChange={setMonth} />
        {canEdit && <Button icon={Plus} onClick={() => setDrawer({})}>Nouveau plan</Button>}
      </PageHeader>

      <Stats items={[
        { label: 'Plans du mois', value: plans ? stats.count : '—', foot: `${stats.valides} validé(s)` },
        { label: 'Planifié (part bailleur)', value: plans ? formatInt(stats.planned) : '—', suffix: 'Ar', foot: 'Alimente la consolidation' },
        { label: 'Budget total prévu', value: plans ? formatInt(stats.total) : '—', suffix: 'Ar', foot: 'Bailleur + ONG' },
        { label: 'Contrats couverts', value: context ? context.contracts.length : '—', foot: 'Avec budget Suivi/TPM' },
      ]} />

      <Card aria-labelledby="plan-title">
        <CardHeader id="plan-title" title="Plans de collecte du mois" subtitle="Un plan par prestataire et contrat. Cliquez pour éditer les postes prévus." />
        {error && <div style={{ padding: '16px 20px 0' }}><Alert tone="error" icon={AlertCircle}>{error}</Alert></div>}
        {plans === null ? <div className="card-body"><Skeleton height={120} /></div> : plans.length === 0 ? (
          <EmptyState icon={Wallet} title="Aucun plan ce mois-ci"
            action={canEdit && <Button icon={Plus} onClick={() => setDrawer({})}>Nouveau plan</Button>}>
            Créez le budget prévisionnel d'une vague de collecte pour pré-remplir la facture ensuite.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">Prestataire TPM</th><th scope="col">Contrat</th><th scope="col">Intitulé</th>
                <th scope="col" className="num">Planifié (bailleur)</th><th scope="col" className="num">Total prévu</th>
                <th scope="col">Statut</th><th scope="col" />
              </tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDrawer({ planId: p.id })}>
                    <td><strong>{p.partnerName}</strong></td>
                    <td>{p.contractPartner}<div className="site-meta mono">{p.contractNumero}</div></td>
                    <td>{p.title || <span className="cell-empty">—</span>}</td>
                    <td className="num mono">{formatAr(p.plannedFunder)}</td>
                    <td className="num mono">{formatAr(p.plannedTotal)}</td>
                    <td><Badge tone={PLAN_STATUS[p.status]?.tone} dot>{PLAN_STATUS[p.status]?.label || p.status}</Badge></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" icon={FileText} onClick={() => setDrawer({ planId: p.id })}>Éditer</Button>
                      {canEdit && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(p.id)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="note"><Wallet size={18} aria-hidden="true" /><span>La <strong>part bailleur</strong> des postes prévus est le « Planifié » comparé au budget de suivi. Depuis une facture, « Pré-remplir depuis le plan » reprend ces postes.</span></div>

      {drawer && <PlanBudgetDrawer planId={drawer.planId} context={context} month={month} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); reload(); }} />}
    </div>
  );
}
