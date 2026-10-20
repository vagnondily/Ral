import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Plus, Trash2, ShieldCheck, Save, Info, ChevronLeft } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Badge, Button, EmptyState, Field, Skeleton, StatusBadge, STATUS_ICONS } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { formatDate, periodLabel } from '../../../lib/contracts.js';
import { currentMonth, formatLocale, shiftMonth, todayISO } from '../../../lib/format.js';
import { BANDS, EVAL_STATUS, RATINGS, bandOf, formatScore, gridScore } from '../../../lib/evaluation.js';
import { useI18n } from '../../../lib/i18n.jsx';

/**
 * Évaluation du prestataire TPM (retour 28.1) : grille structurée (critères notés de 1 à 4,
 * commentaire par critère), datée, par un évaluateur, historisée ; brouillon → validée par
 * une AUTRE personne. La note est calculée et figée par le serveur ; l'écran n'en montre
 * qu'un aperçu pendant la saisie (lib/evaluation.js, miroir testé).
 */
export default function ProviderEvaluationTab({ providerId, provider, canEdit, user, onChanged, startNew = false, onStarted }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [criteria, setCriteria] = useState(null);
  const [openId, setOpenId] = useState(startNew && canEdit ? 'new' : null); // évaluation ouverte (id) ou 'new'
  useEffect(() => { if (startNew) { if (canEdit) setOpenId('new'); if (onStarted) onStarted(); } }, [startNew]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState(null);

  const load = () => api.providerEvaluations(providerId).then(setList).catch((e) => { setError(e.message); setList([]); });
  useEffect(() => { load(); }, [providerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.evaluationCriteria('prestataire').then(setCriteria).catch(() => setCriteria([])); }, []);

  // Après un enregistrement, une validation ou un refus « version périmée », l'évaluation ouverte est
  // RECHARGÉE même si c'est la même : la clé du panneau porte un compteur (sinon React le garde tel
  // quel — « Valider » tournait sans fin et la version à relire n'arrivait jamais).
  const [rev, setRev] = useState(0);
  const refresh = (id) => { load(); onChanged(); setOpenId(id); setRev((n) => n + 1); };
  if (list === null) return <div className="card-body"><Skeleton height={140} /></div>;
  if (openId) {
    return (
      <EvaluationPanel key={`${openId}:${rev}`} providerId={providerId} provider={provider} evaluationId={openId === 'new' ? null : openId}
        criteria={criteria || []} canEdit={canEdit} user={user}
        onBack={() => setOpenId(null)} onSaved={refresh} onDeleted={() => { toast.success(tr('Brouillon supprimé.')); refresh(null); }} />
    );
  }
  return (
    <>
      {error && <div className="card-body"><Alert tone="error">{error}</Alert></div>}
      <div className="data-toolbar">
        <div className="data-toolbar-left"><span className="muted">{tr('Grille d\'appréciation du TPM et moyenne des notes de ses agents sur la période.')}</span></div>
        <div className="data-toolbar-right">{canEdit && <Button size="sm" icon={Plus} onClick={() => setOpenId('new')}>{tr('Nouvelle évaluation')}</Button>}</div>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={tr('Pas encore évalué')}
          action={canEdit && <Button icon={Plus} onClick={() => setOpenId('new')}>{tr('Évaluer le TPM')}</Button>}>
          {tr('Une évaluation porte sur une période (un trimestre, par exemple) : chaque critère est noté de 1 à 4, avec un commentaire, puis une autre personne la valide.')}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table grid">
            <thead><tr>
              <th scope="col">{tr('Période évaluée')}</th><th scope="col">{tr('Évaluée le')}</th><th scope="col">{tr('Évaluateur')}</th>
              <th scope="col" className="num">{tr('Grille')}</th><th scope="col" className="num">{tr('Moyenne des agents')}</th>
              <th scope="col">{tr('Note du TPM')}</th><th scope="col">{tr('Statut')}</th><th scope="col" />
            </tr></thead>
            <tbody>
              {list.map((e) => {
                const score = e.status === 'validee' ? e.finalScore : null;
                return (
                  <tr key={e.id} className="clickable" onDoubleClick={() => setOpenId(e.id)}>
                    <td>{periodLabel(`${e.periodFrom}-01`, `${e.periodTo}-01`, tr)}</td>
                    <td className="tabular">{formatDate(e.evaluatedOn)}</td>
                    <td>{e.evaluatedByName}</td>
                    <td className="num tabular">{e.gridScore == null ? '—' : formatScore(e.gridScore)}</td>
                    <td className="num tabular">{e.status === 'validee' ? (e.agentsScore == null ? <span className="cell-empty">{tr('aucune note')}</span> : formatScore(e.agentsScore)) : <span className="cell-empty">{tr('à la validation')}</span>}</td>
                    <td>{score == null ? <span className="cell-empty">—</span>
                      : <span className="pv-score-cell"><strong className="tabular">{formatScore(score)}</strong><StatusBadge map={BANDS} value={e.band} /></span>}</td>
                    <td><StatusBadge map={EVAL_STATUS} value={e.status} /></td>
                    <td style={{ textAlign: 'right' }}><Button size="sm" variant="secondary" onClick={() => setOpenId(e.id)}>{tr('Ouvrir')}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Une évaluation : saisie (brouillon) ou lecture (validée) avec « Pourquoi cette note ? ». */
function EvaluationPanel({ providerId, provider, evaluationId, criteria, canEdit, user, onBack, onSaved, onDeleted }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [ev, setEv] = useState(evaluationId ? null : 'new');
  const [form, setForm] = useState(() => defaultForm());
  const [grid, setGrid] = useState([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!evaluationId) {
      setGrid(criteria.filter((c) => c.active).map((c) => ({ code: c.code, label: c.label, help: c.help, weight: c.weight, rating: null, comment: '' })));
      return;
    }
    api.providerEvaluation(providerId, evaluationId).then((e) => {
      setEv(e);
      setForm({ periodFrom: e.periodFrom, periodTo: e.periodTo, evaluatedOn: e.evaluatedOn, comment: e.comment || '' });
      const help = new Map(criteria.map((c) => [c.code, c.help]));
      setGrid(e.scores.map((s) => ({ ...s, help: help.get(s.code) || null, comment: s.comment || '' })));
    }).catch((err) => { toast.error(err.message); onBack(); });
  }, [evaluationId, criteria.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => gridScore(grid), [grid]);
  if (ev === null) return <div className="card-body"><Skeleton height={220} /></div>;

  const isNew = ev === 'new';
  const validated = !isNew && ev.status === 'validee';
  const mine = !isNew && ev.evaluatedBy === user.id;
  // Séparation des tâches : l'évaluateur saisit ; une AUTRE personne valide, sans retoucher la grille.
  const editable = canEdit && !validated && (isNew || mine);
  const canValidate = canEdit && !isNew && !validated && !mine;
  const periodBad = form.periodTo < form.periodFrom;
  const setRating = (code, rating) => setGrid((g) => g.map((s) => (s.code === code ? { ...s, rating } : s)));
  const setComment = (code, comment) => setGrid((g) => g.map((s) => (s.code === code ? { ...s, comment } : s)));
  const payload = () => ({
    periodFrom: form.periodFrom, periodTo: form.periodTo, evaluatedOn: form.evaluatedOn, comment: form.comment.trim() || null,
    ratings: grid.map((s) => ({ code: s.code, rating: s.rating, comment: (s.comment || '').trim() || null })),
  });

  async function save() {
    setTouched(true);
    if (periodBad) return;
    setBusy(true);
    try {
      const saved = isNew ? await api.createProviderEvaluation(providerId, payload()) : await api.updateProviderEvaluation(providerId, ev.id, payload());
      toast.success(tr('Brouillon enregistré.'));
      onSaved(saved.id);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function validate() {
    setBusy(true);
    try {
      await api.validateProviderEvaluation(providerId, ev.id, ev.updatedAt);
      toast.success(tr('Évaluation validée : la note est figée.'));
      onSaved(ev.id); // rechargée : la note figée et « Pourquoi cette note ? » s'affichent
    } catch (err) {
      toast.error(err.message);
      // Brouillon modifié depuis son affichage : on recharge la version à jour, à relire avant de valider.
      if (err.status === 409 && err.details && err.details.code === 'stale') onSaved(ev.id);
    } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteProviderEvaluation(providerId, ev.id); onDeleted(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }

  const title = isNew ? tr('Nouvelle évaluation — {name}', { name: provider.name })
    : tr('Évaluation {period}', { period: periodLabel(`${ev.periodFrom}-01`, `${ev.periodTo}-01`, tr) });

  return (
    <div className="card-body pv-eval">
      <div className="pv-eval-head">
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={onBack}>{tr('Toutes les évaluations')}</Button>
        <div className="pv-eval-title">
          <h3>{title}</h3>
          {!isNew && <StatusBadge map={EVAL_STATUS} value={ev.status} />}
          {!isNew && <span className="muted">{tr('Par {name}', { name: ev.evaluatedByName })}{validated && ` · ${tr('validée par {name} le {date}', { name: ev.validatedByName, date: formatDate(String(ev.validatedAt).slice(0, 10)) })}`}</span>}
        </div>
      </div>

      {validated ? <Why ev={ev} /> : (
        <>
          <div className="pv-eval-fields">
            <Field label={tr('Période évaluée — du')} htmlFor="ev-from" required>
              <input id="ev-from" type="month" className="input" value={form.periodFrom} disabled={!editable} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} />
            </Field>
            <Field label={tr('au')} htmlFor="ev-to" required error={touched && periodBad ? tr('La fin précède le début.') : undefined}>
              <input id="ev-to" type="month" className="input" value={form.periodTo} disabled={!editable} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} />
            </Field>
            <Field label={tr("Date de l'évaluation")} htmlFor="ev-date" required>
              <input id="ev-date" type="date" className="input" value={form.evaluatedOn} disabled={!editable} onChange={(e) => setForm({ ...form, evaluatedOn: e.target.value })} />
            </Field>
            <div className="pv-eval-score" aria-live="polite">
              <span className="stat-label">{tr('Grille (aperçu)')}</span>
              <span className="pv-eval-score-v tabular">{formatScore(preview.score)}</span>
              {preview.score != null && <StatusBadge map={BANDS} value={bandOf(preview.score)} />}
              <span className="field-hint">{tr('{n} critère(s) notés sur {t}', { n: preview.rated, t: preview.total })}</span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table pv-grid-table">
              <thead><tr><th scope="col">{tr('Critère')}</th><th scope="col">{tr('Appréciation')}</th><th scope="col">{tr('Commentaire')}</th></tr></thead>
              <tbody>
                {grid.map((s) => (
                  <tr key={s.code}>
                    <td className="pv-crit"><strong>{tr(s.label)}</strong>{s.help && <span className="pv-sub">{tr(s.help)}</span>}</td>
                    <td>
                      <div className="segmented rating-seg" role="radiogroup" aria-label={tr(s.label)}>
                        {RATINGS.map((r) => (
                          <button key={r.value} type="button" role="radio" aria-checked={s.rating === r.value} aria-pressed={s.rating === r.value}
                            disabled={!editable} className={`r-${r.value}`} onClick={() => setRating(s.code, s.rating === r.value ? null : r.value)} title={tr(r.label)}>
                            <span className="rating-n">{r.value}</span><span className="rating-l">{tr(r.label)}</span>
                          </button>
                        ))}
                      </div>
                    </td>
                    <td><input className="input cell-input" value={s.comment} maxLength={1000} disabled={!editable} placeholder={tr('Facultatif')}
                      aria-label={tr('Commentaire : {label}', { label: tr(s.label) })} onChange={(e) => setComment(s.code, e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Field label={tr('Appréciation générale')} htmlFor="ev-comment" hint={tr('Points forts, points à améliorer, recommandations.')}>
            <textarea id="ev-comment" className="input" rows={3} maxLength={2000} value={form.comment} disabled={!editable} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          </Field>

          {!isNew && ev.preview && (
            <div className="note"><Info size={18} aria-hidden="true" /><span>{ev.preview.agentsCount
              ? tr('À la validation, la note du TPM combinera la grille ({g} %) et la moyenne de ses {n} agent(s) notés sur la période ({q} %) : aperçu {score}.', { g: 100 - ev.preview.agentsWeight, q: ev.preview.agentsWeight, n: ev.preview.agentsCount, score: formatScore(ev.preview.finalScore) })
              : tr('Aucun agent de ce TPM n\'a de note sur la période : la note du TPM sera celle de la grille.')}</span></div>
          )}
          {editable && (
            <div className="form-actions pv-eval-actions">
              {!isNew && <Button variant="ghost" icon={Trash2} onClick={remove} disabled={busy}>{tr('Supprimer le brouillon')}</Button>}
              <span className="pv-spacer" />
              <Button variant="secondary" onClick={onBack} disabled={busy}>{tr('Annuler')}</Button>
              <Button icon={Save} onClick={save} loading={busy}>{tr('Enregistrer le brouillon')}</Button>
            </div>
          )}
          {editable && !isNew && <p className="field-hint pv-duty">{tr('Séparation des tâches : une autre personne (administrateur ou gestionnaire) valide cette évaluation.')}</p>}
          {canValidate && (
            <div className="form-actions pv-eval-actions">
              <span className="muted">{preview.complete ? tr('Brouillon de {name} : relisez la grille, puis validez pour figer la note.', { name: ev.evaluatedByName })
                : tr('Brouillon de {name} : tous les critères doivent être notés avant la validation.', { name: ev.evaluatedByName })}</span>
              <span className="pv-spacer" />
              {/* Un administrateur peut aussi supprimer le brouillon d'un autre (le serveur le contrôle). */}
              {user.role === 'admin' && <Button variant="ghost" icon={Trash2} onClick={remove} disabled={busy}>{tr('Supprimer le brouillon')}</Button>}
              <Button variant="secondary" onClick={onBack} disabled={busy}>{tr('Fermer')}</Button>
              <Button icon={ShieldCheck} onClick={validate} loading={busy} disabled={!preview.complete}>{tr('Valider')}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** « Pourquoi cette note ? » : la grille, la moyenne des agents et la règle appliquée, figées à la validation. */
function Why({ ev }) {
  const { tr } = useI18n();
  const d = ev.detail || {};
  const q = ev.agentsWeight ?? 0;
  const ratingLabel = (r) => (RATINGS.find((x) => x.value === r) || {}).label;
  return (
    <div className="pv-why">
      <div className="pv-why-hero">
        <div>
          <span className="stat-label">{tr('Note du TPM')}</span>
          <span className="pv-why-score tabular">{formatScore(ev.finalScore)}</span>
          <StatusBadge map={BANDS} value={ev.band} />
        </div>
        <p className="pv-why-rule">
          {d.basis === 'both'
            ? tr('Note = moyenne des agents × {q} % + grille × {g} % = {a} × {q} % + {b} × {g} %.', { q, g: 100 - q, a: formatScore(ev.agentsScore), b: formatScore(ev.gridScore) })
            : tr('Aucun agent noté sur la période : la note est celle de la grille ({b}).', { b: formatScore(ev.gridScore) })}
          {' '}{tr('Bandes : 16 et plus Excellent, 12 et plus Bon, 10 et plus Moyen, sinon Insuffisant.')}
        </p>
      </div>
      <h4 className="pv-panel-title">{tr('Grille du TPM : {s}', { s: formatScore(ev.gridScore) })}</h4>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">{tr('Critère')}</th><th scope="col">{tr('Appréciation')}</th><th scope="col" className="num">{tr('Équivalent sur 20')}</th><th scope="col" className="num">{tr('Poids')}</th><th scope="col">{tr('Commentaire')}</th></tr></thead>
          <tbody>
            {ev.scores.map((s, i) => {
              const g = (d.grid || [])[i] || {};
              return (
                <tr key={s.code}>
                  <td>{tr(s.label)}</td>
                  <td>{s.rating ? <Badge tone={(RATINGS.find((x) => x.value === s.rating) || {}).tone} icon={STATUS_ICONS[(RATINGS.find((x) => x.value === s.rating) || {}).icon]}>{s.rating} · {tr(ratingLabel(s.rating))}</Badge> : '—'}</td>
                  <td className="num tabular">{g.on20 == null ? '—' : g.on20.toLocaleString(formatLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                  <td className="num tabular">{g.weightPct == null ? '—' : tr('{p} %', { p: g.weightPct })}</td>
                  <td className="muted">{s.comment || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h4 className="pv-panel-title">{tr('Notes des agents sur la période')}</h4>
      {(d.agents || []).length === 0 ? <p className="muted">{tr('Aucun agent noté sur la période.')}</p> : (
        <ul className="pv-agent-scores">{d.agents.map((a) => (
          <li key={a.agentId}><span>{a.name}</span><span className="tabular">{a.score == null ? tr('pas de note') : formatScore(a.score)}</span></li>
        ))}</ul>
      )}
      {ev.comment && <><h4 className="pv-panel-title">{tr('Appréciation générale')}</h4><p className="pv-why-comment">{ev.comment}</p></>}
    </div>
  );
}

function defaultForm() {
  const m = currentMonth();
  return { periodFrom: shiftMonth(m, -3), periodTo: shiftMonth(m, -1), evaluatedOn: todayISO(), comment: '' };
}
