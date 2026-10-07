import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Coins, Search, Send, ShieldCheck, AlertCircle, CheckCircle2, Lock, Info,
} from 'lucide-react';
import { api } from '../api/client.js';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, ExpandButton, PageHeader, Progress, RiskBadge, Skeleton, Stats,
} from '../components/ui.jsx';
import Modal from '../components/Modal.jsx';
import MonthSelect from '../components/MonthSelect.jsx';
import Stepper from '../components/Stepper.jsx';
import { useToast } from '../components/Toast.jsx';
import MissionCalendarDrawer from './MissionCalendarDrawer.jsx';
import { currentMonth, formatAr, formatDateTime, formatInt, formatTime, monthLabel, PLAN_STATUS } from '../lib/format.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function groupDays(list) {
  const out = {};
  for (const d of list) (out[d.assignmentId] ||= []).push(d.missionDate);
  return out;
}

/** Mission days per provider as the UI currently knows them — used to
 * detect when the background worker's totals have caught up. */
function expectedByProvider(assignments, days) {
  const map = new Map();
  for (const a of assignments) {
    const n = days[a.id]?.length || 0;
    if (a.tpmProviderId && n > 0) map.set(a.tpmProviderId, (map.get(a.tpmProviderId) || 0) + n);
  }
  return map;
}

function expensesMatch(expenses, expected) {
  return expenses.length === expected.size && expenses.every((e) => expected.get(e.tpmProviderId) === e.missionDaysCount);
}

export default function AssignmentPage({ canEdit }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [providers, setProviders] = useState([]);
  const [plan, setPlan] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [days, setDays] = useState({});
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const [query, setQuery] = useState('');
  const [calendarFor, setCalendarFor] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [openBudget, setOpenBudget] = useState(() => new Set());
  const toggleBudget = (id) =>
    setOpenBudget((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const loadSeq = useRef(0);
  const syncSeq = useRef(0);

  const load = useCallback(async (m) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [prov, res] = await Promise.all([api.listProviders(), api.getMonthlyPlan(m)]);
      const md = await api.listMissionDays(res.plan.id);
      if (seq !== loadSeq.current) return; // a newer month was requested meanwhile
      setProviders(prov);
      setPlan(res.plan);
      setAssignments(res.assignments);
      setExpenses(res.expenses);
      setDays(groupDays(md));
    } catch (err) {
      if (seq === loadSeq.current) setLoadError(err.message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCalendarFor(null);
    syncSeq.current += 1; // cancel any in-flight budget polling for the old month
    setRecalculating(false);
    load(month);
  }, [month, load]);

  /** Expense totals are computed by the background worker. Poll the
   * read-only endpoint until they reflect what's on screen (or give up). */
  const syncExpenses = useCallback(async (planId, nextAssignments, nextDays) => {
    const seq = ++syncSeq.current;
    setRecalculating(true);
    const expected = expectedByProvider(nextAssignments, nextDays);
    try {
      for (let i = 0; i < 15; i += 1) {
        await sleep(i === 0 ? 400 : 700);
        const res = await api.listExpenses(planId);
        if (seq !== syncSeq.current) return;
        setExpenses(res);
        if (expensesMatch(res, expected)) break;
      }
    } catch {
      /* the next change or a reload will resync */
    } finally {
      if (seq === syncSeq.current) setRecalculating(false);
    }
  }, []);

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const status = plan?.status || 'draft';
  const canAssign = canEdit && status === 'draft';
  const canPlan = canEdit && status !== 'validated';
  const lockReason = !canEdit
    ? 'Votre rôle donne un accès en lecture seule.'
    : status === 'validated'
      ? 'Le plan est validé : le calendrier est verrouillé.'
      : '';

  const stats = useMemo(() => {
    const total = assignments.length;
    const assigned = assignments.filter((a) => a.tpmProviderId).length;
    const withAgent = assignments.filter((a) => a.tpmAgentId).length;
    const totalDays = assignments.reduce((n, a) => n + (days[a.id]?.length || 0), 0);
    const sitesPlanned = assignments.filter((a) => (days[a.id]?.length || 0) > 0).length;
    const mobilized = new Set(assignments.filter((a) => a.tpmProviderId).map((a) => a.tpmProviderId)).size;
    const budget = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const lastComputed = expenses.reduce((t, e) => (e.computedAt > t ? e.computedAt : t), '');
    return { total, assigned, withAgent, totalDays, sitesPlanned, mobilized, budget, lastComputed };
  }, [assignments, days, expenses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) =>
      [a.siteName, a.commune, a.activity, a.tpmProviderName, a.tpmAgentName].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [assignments, query]);

  async function handleAssign(a, tpmProviderId, tpmAgentId) {
    const provider = providerById.get(tpmProviderId);
    const agent = provider?.agents.find((ag) => ag.id === tpmAgentId);
    const prev = assignments;
    const next = assignments.map((row) =>
      row.id === a.id
        ? { ...row, tpmProviderId: tpmProviderId || null, tpmProviderName: provider?.name || null, tpmAgentId: agent?.id || null, tpmAgentName: agent?.name || null }
        : row
    );
    setAssignments(next); // optimistic
    try {
      await api.upsertAssignment(plan.id, { siteId: a.siteId, tpmProviderId: tpmProviderId || null, tpmAgentId: agent?.id || null });
      if (!tpmProviderId && days[a.id]?.length) {
        toast.info(`${a.siteName} n'a plus de prestataire : ses ${days[a.id].length} jours ne sont plus budgétés.`);
      }
      syncExpenses(plan.id, next, days);
    } catch (err) {
      setAssignments(prev);
      toast.error(err.message);
    }
  }

  async function handleToggleDay(iso) {
    const a = assignments.find((row) => row.id === calendarFor);
    if (!a) return;
    const prev = days;
    const current = new Set(days[a.id] || []);
    if (current.has(iso)) current.delete(iso);
    else current.add(iso);
    const next = { ...days, [a.id]: [...current].sort() };
    setDays(next); // optimistic
    try {
      await api.toggleMissionDay(a.id, iso);
      syncExpenses(plan.id, assignments, next);
    } catch (err) {
      setDays(prev);
      toast.error(err.message);
    }
  }

  async function handleAdvance() {
    setAdvancing(true);
    try {
      const updated = await api.advancePlan(plan.id);
      setPlan(updated);
      setConfirmOpen(false);
      toast.success(updated.status === 'submitted' ? `Plan de ${monthLabel(month)} soumis.` : `Plan de ${monthLabel(month)} validé.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdvancing(false);
    }
  }

  const steps = [
    { key: 'draft', label: 'Brouillon', date: status === 'draft' ? 'En cours' : 'Terminé' },
    { key: 'submitted', label: 'Soumis', date: plan?.submittedAt ? formatDateTime(plan.submittedAt) : null },
    { key: 'validated', label: 'Validé', date: plan?.validatedAt ? formatDateTime(plan.validatedAt) : null, final: status === 'validated' },
  ];
  const stepIndex = ['draft', 'submitted', 'validated'].indexOf(status);
  const unassigned = stats.total - stats.assigned;
  const calendarAssignment = assignments.find((a) => a.id === calendarFor);

  return (
    <div className="section-gap">
      <PageHeader
        title="Affectation & calendrier"
        description="Affectez chaque site à un prestataire TPM puis à l'un de ses agents, planifiez les jours de mission et suivez le budget du mois."
      >
        <MonthSelect value={month} onChange={setMonth} />
      </PageHeader>

      {loadError ? (
        <Card>
          <EmptyState icon={AlertCircle} title="Impossible de charger le plan" action={<Button variant="secondary" onClick={() => load(month)}>Réessayer</Button>}>
            {loadError}
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Plan workflow */}
          <Card>
            <div className="plan-bar">
              {loading && !plan ? (
                <Skeleton height={36} />
              ) : (
                <>
                  <Stepper steps={steps} current={stepIndex} label={`Statut du plan de ${monthLabel(month)}`} />
                  <div className="toolbar">
                    <Badge tone={PLAN_STATUS[status].tone} dot>{PLAN_STATUS[status].label}</Badge>
                    {canEdit && status === 'draft' && (
                      <Button icon={Send} onClick={() => setConfirmOpen(true)} disabled={loading}>Soumettre le plan</Button>
                    )}
                    {canEdit && status === 'submitted' && (
                      <Button icon={ShieldCheck} onClick={() => setConfirmOpen(true)} disabled={loading}>Valider le plan</Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Key figures — one compact band */}
          <Stats
            items={[
              {
                label: 'Sites couverts',
                value: loading ? '—' : stats.assigned,
                suffix: loading ? null : `/ ${stats.total}`,
                children: <Progress value={stats.total ? (stats.assigned / stats.total) * 100 : 0} label="Taux de couverture des sites" />,
                foot: loading ? '' : `${stats.withAgent} avec agent désigné`,
              },
              {
                label: 'Jours de mission',
                value: loading ? '—' : formatInt(stats.totalDays),
                foot: loading ? '' : `${stats.sitesPlanned} site${stats.sitesPlanned > 1 ? 's' : ''} planifié${stats.sitesPlanned > 1 ? 's' : ''}`,
              },
              {
                label: 'Budget du mois',
                value: loading ? '—' : formatInt(stats.budget),
                suffix: 'Ar',
                foot: recalculating ? (
                  <><span className="spinner" aria-hidden="true" style={{ width: 12, height: 12 }} /> Recalcul en cours…</>
                ) : stats.lastComputed ? (
                  `Calculé à ${formatTime(stats.lastComputed)}`
                ) : (
                  'Aucune mission budgétée'
                ),
              },
              {
                label: 'Prestataires mobilisés',
                value: loading ? '—' : stats.mobilized,
                suffix: loading ? null : `/ ${providers.length}`,
                foot: 'Sous contrat ce mois-ci',
              },
            ]}
          />

          {/* Assignment table */}
          <Card aria-labelledby="assign-title">
            <CardHeader
              id="assign-title"
              title="Affectation par site"
              subtitle={canAssign ? "D'abord le prestataire, ensuite l'agent." : status !== 'draft' ? 'Plan soumis : les affectations sont figées.' : 'Lecture seule.'}
            >
              <div className="input-wrap search">
                <Search size={18} aria-hidden="true" />
                <label htmlFor="site-search" className="sr-only">Rechercher un site</label>
                <input
                  id="site-search"
                  className="input"
                  type="search"
                  placeholder="Site, commune, prestataire…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </CardHeader>

            {canEdit && status === 'draft' && unassigned > 0 && !loading && (
              <div style={{ padding: '16px 20px 0' }}>
                <Alert tone="warn" icon={Info}>
                  {unassigned} site{unassigned > 1 ? 's' : ''} sans prestataire TPM pour {monthLabel(month).toLowerCase()}.
                </Alert>
              </div>
            )}

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Activité</th>
                    <th scope="col">Risque</th>
                    <th scope="col">Prestataire TPM</th>
                    <th scope="col">Agent</th>
                    <th scope="col" className="num">Jours</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? [0, 1, 2, 3, 4].map((i) => (
                        <tr key={i} aria-hidden="true">
                          {[180, 50, 70, 170, 170, 30, 110].map((w, j) => (
                            <td key={j}><Skeleton width={w} height={j === 0 ? 34 : 20} /></td>
                          ))}
                        </tr>
                      ))
                    : filtered.map((a) => {
                        const provider = providerById.get(a.tpmProviderId);
                        const n = days[a.id]?.length || 0;
                        return (
                          <tr key={a.id} className={calendarFor === a.id ? 'is-selected' : ''}>
                            <td>
                              <div className="site-name">{a.siteName}</div>
                              <div className="site-meta">{a.commune || '—'}</div>
                            </td>
                            <td><span className="tag">{a.activity || '—'}</span></td>
                            <td><RiskBadge level={a.riskLevel} /></td>
                            <td>
                              {canAssign ? (
                                <select
                                  className={`select ${a.tpmProviderId ? '' : 'is-empty'}`}
                                  value={a.tpmProviderId || ''}
                                  onChange={(e) => handleAssign(a, e.target.value || null, null)}
                                  aria-label={`Prestataire TPM pour ${a.siteName}`}
                                >
                                  <option value="">Choisir un prestataire…</option>
                                  {providers.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                              ) : (
                                a.tpmProviderName || <span className="cell-empty">Non affecté</span>
                              )}
                            </td>
                            <td>
                              {canAssign ? (
                                <select
                                  className={`select ${a.tpmAgentId ? '' : 'is-empty'}`}
                                  value={a.tpmAgentId || ''}
                                  disabled={!provider}
                                  onChange={(e) => handleAssign(a, a.tpmProviderId, e.target.value || null)}
                                  aria-label={`Agent pour ${a.siteName}`}
                                  title={provider ? undefined : "Choisissez d'abord un prestataire"}
                                >
                                  <option value="">{provider ? 'Choisir un agent…' : '—'}</option>
                                  {(provider?.agents || []).map((ag) => (
                                    <option key={ag.id} value={ag.id}>{ag.name}</option>
                                  ))}
                                </select>
                              ) : (
                                a.tpmAgentName || <span className="cell-empty">Non désigné</span>
                              )}
                            </td>
                            <td className="num">{n > 0 ? <strong>{n}</strong> : <span className="cell-empty">0</span>}</td>
                            <td style={{ textAlign: 'right' }}>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={canPlan ? CalendarDays : Lock}
                                disabled={!a.tpmProviderId}
                                title={a.tpmProviderId ? undefined : "Affectez d'abord un prestataire"}
                                onClick={() => setCalendarFor(a.id)}
                              >
                                {canPlan ? 'Planifier' : 'Consulter'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
              {!loading && filtered.length === 0 && (
                <EmptyState icon={Search} title={assignments.length ? 'Aucun site ne correspond' : 'Aucun site pour ce bureau'}>
                  {assignments.length ? 'Modifiez votre recherche.' : 'Les sites suivis apparaîtront ici.'}
                </EmptyState>
              )}
            </div>
          </Card>

          {/* Budget */}
          <Card aria-labelledby="budget-title">
            <CardHeader id="budget-title" title="Budget de mission" subtitle="Jours de mission × barème du prestataire, recalculé automatiquement.">
              {recalculating ? (
                <Badge tone="blue"><span className="spinner" aria-hidden="true" style={{ width: 12, height: 12 }} /> Recalcul en cours…</Badge>
              ) : (
                stats.lastComputed && <Badge tone="green"><CheckCircle2 size={14} aria-hidden="true" /> À jour · {formatTime(stats.lastComputed)}</Badge>
              )}
            </CardHeader>
            {expenses.length === 0 ? (
              <EmptyState icon={Coins} title="Aucune dépense ce mois-ci">
                Planifiez des jours de mission sur un site affecté pour alimenter le budget.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col" className="cell-expander"><span className="sr-only">Déplier</span></th>
                      <th scope="col">Prestataire TPM</th>
                      <th scope="col" className="num">Sites</th>
                      <th scope="col" className="num">Jours</th>
                      <th scope="col" className="num">Barème / jour</th>
                      <th scope="col" className="num">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e) => {
                      const rate = Number(providerById.get(e.tpmProviderId)?.dailyRate || 0);
                      const siteRows = assignments.filter((a) => a.tpmProviderId === e.tpmProviderId && (days[a.id]?.length || 0) > 0);
                      const isOpen = openBudget.has(e.tpmProviderId);
                      return (
                        <React.Fragment key={e.tpmProviderId}>
                          <tr className={`clickable ${isOpen ? 'is-expanded' : ''}`} onClick={() => toggleBudget(e.tpmProviderId)}>
                            <td className="cell-expander">
                              <ExpandButton expanded={isOpen} onClick={() => toggleBudget(e.tpmProviderId)} label={`détail par site de ${e.tpmProviderName}`} />
                            </td>
                            <td><strong>{e.tpmProviderName}</strong></td>
                            <td className="num">{siteRows.length}</td>
                            <td className="num">{e.missionDaysCount}</td>
                            <td className="num">{formatAr(rate)}</td>
                            <td className="num"><strong>{formatAr(e.amount)}</strong></td>
                          </tr>
                          {isOpen && siteRows.map((a) => {
                            const n = days[a.id].length;
                            return (
                              <tr className="subrow" key={a.id}>
                                <td />
                                <td>
                                  <div className="indent">
                                    <div>{a.siteName}</div>
                                    <div className="site-meta">{a.tpmAgentName || 'Agent non désigné'}</div>
                                  </div>
                                </td>
                                <td className="num" />
                                <td className="num">{n}</td>
                                <td className="num">{formatAr(rate)}</td>
                                <td className="num">{formatAr(n * rate)}</td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td>Total</td>
                      <td className="num" />
                      <td className="num">{expenses.reduce((n, e) => n + e.missionDaysCount, 0)}</td>
                      <td className="num" />
                      <td className="num">{formatAr(stats.budget)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <MissionCalendarDrawer
        open={Boolean(calendarAssignment)}
        onClose={() => setCalendarFor(null)}
        month={month}
        assignment={calendarAssignment}
        provider={providerById.get(calendarAssignment?.tpmProviderId)}
        selectedDays={days[calendarFor] || []}
        editable={canPlan}
        lockReason={lockReason}
        onToggle={handleToggleDay}
      />

      <Modal
        open={confirmOpen}
        onClose={() => !advancing && setConfirmOpen(false)}
        title={status === 'draft' ? 'Soumettre le plan ?' : 'Valider le plan ?'}
        subtitle={`Plan de suivi TPM — ${monthLabel(month)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={advancing}>Annuler</Button>
            <Button icon={status === 'draft' ? Send : ShieldCheck} loading={advancing} onClick={handleAdvance}>
              {status === 'draft' ? 'Soumettre' : 'Valider définitivement'}
            </Button>
          </>
        }
      >
        {status === 'draft' ? (
          <>
            <p>Les affectations prestataire / agent seront figées. Le calendrier des missions restera modifiable jusqu'à la validation.</p>
            {unassigned > 0 && (
              <Alert tone="warn" icon={AlertCircle}>
                {unassigned > 1
                  ? `${unassigned} sites n'ont pas de prestataire et ne seront pas suivis ce mois-ci.`
                  : "1 site n'a pas de prestataire et ne sera pas suivi ce mois-ci."}
              </Alert>
            )}
          </>
        ) : (
          <p>Le calendrier et le budget ({formatAr(stats.budget)}, {stats.totalDays} jours) seront verrouillés. Cette action est définitive.</p>
        )}
      </Modal>
    </div>
  );
}
