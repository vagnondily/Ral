import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Trash2, UserPlus, Users, Save, X, MessageSquare, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, Field, IconButton, Skeleton, Stats, StatusBadge } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import ProviderSelect from '../../components/ProviderSelect.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDate } from '../../lib/contracts.js';
import { ATTENDANCE, TRAINING_STATUS, formatPct } from '../../lib/trainings.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Fiche d'une formation (lot 8, retour 28.2) — #/tpm/formations/<id> (ou /nouvelle) :
 * informations de base, thèmes couverts, dates, lieu, formateur ; les prestataires et leurs
 * agents participants (présence, pré-test / post-test, avis) ; l'évaluation de la formation
 * (bilan calculé par le serveur, avis des participants, synthèse rédigée).
 */
export default function TrainingSessionPage({ sessionId, canEdit, onNavigate }) {
  const { tr } = useI18n();
  const isNew = sessionId === 'nouvelle';
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(isNew);
  const back = () => onNavigate('tpm', 'formations');

  const reload = () => api.getTraining(sessionId).then((x) => { setS(x); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { if (!isNew) { setS(null); reload(); } }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="section-gap"><Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux formations')}</Button><Alert tone="error">{error}</Alert></div>;
  if (isNew) {
    return (
      <div className="section-gap">
        <div>
          <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux formations')}</Button>
          <h1 className="page-title">{tr('Nouvelle formation')}</h1>
        </div>
        <Card><InfoForm onCancel={back} onSaved={(x) => onNavigate('tpm', 'formations', x.id)} /></Card>
      </div>
    );
  }
  if (!s) return <div className="section-gap"><Skeleton height={40} width="40%" /><Skeleton height={90} /><Skeleton height={260} /></div>;

  const sum = s.summary;
  const dates = s.startDate === s.endDate ? formatDate(s.startDate) : `${formatDate(s.startDate)} – ${formatDate(s.endDate)}`;
  return (
    <div className="section-gap">
      <div>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux formations')}</Button>
        <div className="detail-head">
          <div>
            <h1 className="page-title">{s.title}</h1>
            <div className="detail-meta">
              <StatusBadge map={TRAINING_STATUS} value={s.status} />
              <span className="tabular">{dates}</span>
              <span className="muted">· {tr(sum.days > 1 ? '{n} jours' : '{n} jour', { n: sum.days })}</span>
              {s.place && <span className="muted">· {s.place}</span>}
              {s.origin === 'reprise' && <Badge>{tr('Reprise de l\'historique')}</Badge>}
            </div>
          </div>
          {canEdit && !editing && <div className="toolbar"><Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>{tr('Modifier')}</Button></div>}
        </div>
      </div>

      <Stats items={[
        { label: tr('Participants'), value: sum.participants, foot: tr('{n} TPM', { n: sum.providers }) },
        { label: tr('Présence'), value: formatPct(sum.attendance.rate, tr),
          foot: sum.attendance.notRecorded ? tr('{n} présence(s) non renseignée(s)', { n: sum.attendance.notRecorded }) : tr('Présents et partiels ÷ renseignés') },
        { label: tr('Pré-test → post-test'), value: sum.tests.avgPost == null ? '—' : `${formatPct(sum.tests.avgPre, tr)} → ${formatPct(sum.tests.avgPost, tr)}`,
          foot: sum.tests.avgProgress == null ? tr('Moyennes en % du barème') : tr('Progression moyenne : {p} points', { p: sum.tests.avgProgress }) },
        { label: tr('Réussite'), value: formatPct(sum.tests.passRate, tr), foot: tr('Post-test ≥ {p} % du barème', { p: sum.tests.passMark }) },
      ]} />

      <Card>
        {editing ? <InfoForm session={s} onCancel={() => setEditing(false)} onSaved={(x) => { setS(x); setEditing(false); }} onDeleted={back} /> : <InfoView s={s} />}
      </Card>

      <ParticipantsCard s={s} canEdit={canEdit} onChanged={reload} />
      <FeedbackCard s={s} canEdit={canEdit} onSaved={setS} />
    </div>
  );
}

/** Informations de base, thèmes, organisation et règles des tests. */
function InfoView({ s }) {
  const { tr } = useI18n();
  return (
    <>
      <CardHeader title={tr('Informations')} />
      <div className="kv-grid tr-kv">
        <table className="kv"><tbody>
          <tr><th>{tr('Objectif')}</th><td className="pv-wrap">{s.objective || '—'}</td></tr>
          <tr><th>{tr('Thèmes couverts')}</th><td>{s.themes.length ? <div className="chips">{s.themes.map((t) => <span key={t.id} className="chip">{t.label}</span>)}</div> : '—'}</td></tr>
          <tr><th>{tr('Lieu')}</th><td>{s.place || '—'}</td></tr>
        </tbody></table>
        <table className="kv"><tbody>
          <tr><th>{tr('Formateur')}</th><td>{s.trainer || '—'}</td></tr>
          <tr><th>{tr('Organisateur')}</th><td>{s.organiserName || tr('Interne (équipe S&E)')}</td></tr>
          <tr><th>{tr('Tests')}</th><td>{tr('Notes sur {max} · réussite à {p} % du barème', { max: s.scoreMax, p: s.passMark })}</td></tr>
        </tbody></table>
      </div>
    </>
  );
}

/** Création ou modification des informations (thèmes compris) ; suppression d'une formation sans donnée. */
function InfoForm({ session, onCancel, onSaved, onDeleted }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    title: session?.title || '', startDate: session?.startDate || '', endDate: session?.endDate || '', place: session?.place || '',
    trainer: session?.trainer || '', organiserId: session?.organiserId || '', status: session?.status || 'planifiee',
    scoreMax: String(session?.scoreMax ?? 20), passMark: String(session?.passMark ?? 70), objective: session?.objective || '',
    themes: (session?.themes || []).map((t) => t.label),
  }));
  const [theme, setTheme] = useState('');
  const [known, setKnown] = useState([]);
  const [partners, setPartners] = useState([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    api.trainingThemes().then(setKnown).catch(() => setKnown([]));
    api.partnerProviders().then((rows) => setPartners(rows.filter((p) => p.active))).catch(() => setPartners([]));
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const addTheme = () => {
    const v = theme.replace(/\s+/g, ' ').trim();
    if (v.length < 2) return;
    if (!f.themes.some((x) => x.toLowerCase() === v.toLowerCase())) setF((x) => ({ ...x, themes: [...x.themes, v] }));
    setTheme('');
  };
  const errors = {
    title: f.title.trim().length < 2 ? tr('Requis.') : null,
    startDate: !f.startDate ? tr('Requis.') : null,
    endDate: !f.endDate ? tr('Requis.') : (f.startDate && f.endDate < f.startDate ? tr('La fin précède le début.') : null),
    scoreMax: !(Number(f.scoreMax) > 0) ? tr('Barème positif requis.') : null,
    passMark: !(Number(f.passMark) >= 0 && Number(f.passMark) <= 100) ? tr('Entre 0 et 100.') : null,
  };
  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    try {
      const payload = {
        title: f.title.trim(), startDate: f.startDate, endDate: f.endDate, place: f.place, trainer: f.trainer,
        organiserId: f.organiserId || null, status: f.status, scoreMax: Number(f.scoreMax), passMark: Number(f.passMark),
        objective: f.objective, themes: f.themes,
      };
      const x = session ? await api.updateTraining(session.id, payload) : await api.createTraining(payload);
      toast.success(tr(session ? 'Formation mise à jour.' : 'Formation créée : ajoutez maintenant les participants.'));
      onSaved(x);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteTraining(session.id); toast.success(tr('Formation supprimée.')); onDeleted(); }
    catch (err) { toast.error(err.message); setBusy(false); setConfirmDelete(false); }
  }
  const err = (k) => (touched ? errors[k] : undefined);
  return (
    <form className="card-body tr-form" onSubmit={save}>
      <div className="form-grid">
        <div className="span-2"><Field label={tr('Titre de la formation')} htmlFor="tr-title" required error={err('title')}>
          <input id="tr-title" className="input" maxLength={200} value={f.title} onChange={set('title')} placeholder={tr('Ex. Formation des enquêteurs — suivi de processus')} />
        </Field></div>
        <Field label={tr('Début')} htmlFor="tr-start" required error={err('startDate')}><input id="tr-start" type="date" className="input" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label={tr('Fin')} htmlFor="tr-end" required error={err('endDate')}><input id="tr-end" type="date" className="input" value={f.endDate} onChange={set('endDate')} /></Field>
        <Field label={tr('Lieu')} htmlFor="tr-place"><input id="tr-place" className="input" maxLength={200} value={f.place} onChange={set('place')} /></Field>
        <Field label={tr('Formateur')} htmlFor="tr-trainer"><input id="tr-trainer" className="input" maxLength={200} value={f.trainer} onChange={set('trainer')} /></Field>
        <Field label={tr('Organisateur')} htmlFor="tr-org">
          <select id="tr-org" className="select" value={f.organiserId} onChange={set('organiserId')}>
            <option value="">{tr('Interne (équipe S&E)')}</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={tr('Statut')} htmlFor="tr-status">
          <select id="tr-status" className="select" value={f.status} onChange={set('status')}>
            {Object.entries(TRAINING_STATUS).map(([id, d]) => <option key={id} value={id}>{tr(d.label)}</option>)}
          </select>
        </Field>
        <Field label={tr('Barème des tests (note maximale)')} htmlFor="tr-max" required error={err('scoreMax')}>
          <input id="tr-max" className="input tabular" inputMode="decimal" value={f.scoreMax} onChange={set('scoreMax')} />
        </Field>
        <Field label={tr('Seuil de réussite (% du barème)')} htmlFor="tr-pass" required error={err('passMark')}>
          <input id="tr-pass" className="input tabular" inputMode="decimal" value={f.passMark} onChange={set('passMark')} />
        </Field>
        <div className="span-2"><Field label={tr('Thèmes couverts')} htmlFor="tr-theme" hint={tr('Choisissez un thème existant ou saisissez-en un nouveau, puis « Ajouter ».')}>
          <div className="tr-theme-row">
            <input id="tr-theme" className="input" list="tr-themes" maxLength={200} value={theme} onChange={(e) => setTheme(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTheme(); } }} />
            <Button variant="secondary" onClick={addTheme} disabled={theme.trim().length < 2}>{tr('Ajouter')}</Button>
          </div>
          <datalist id="tr-themes">{known.map((t) => <option key={t.id} value={t.label} />)}</datalist>
          {f.themes.length > 0 && (
            <div className="chips" style={{ marginTop: 8 }}>{f.themes.map((t) => (
              <span key={t} className="chip">{t}<button type="button" className="chip-x" onClick={() => setF((x) => ({ ...x, themes: x.themes.filter((y) => y !== t) }))} aria-label={tr('Retirer {name}', { name: t })}><X size={13} /></button></span>
            ))}</div>
          )}
        </Field></div>
        <div className="span-2"><Field label={tr('Objectif')} htmlFor="tr-obj"><textarea id="tr-obj" className="input" rows={2} maxLength={2000} value={f.objective} onChange={set('objective')} /></Field></div>
      </div>
      <div className="pv-eval-actions">
        {session && <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} disabled={busy}>{tr('Supprimer')}</Button>}
        <span className="pv-spacer" />
        <Button variant="secondary" onClick={onCancel} disabled={busy}>{tr('Annuler')}</Button>
        <Button type="submit" icon={Save} loading={busy}>{tr(session ? 'Enregistrer' : 'Créer la formation')}</Button>
      </div>
      {confirmDelete && (
        <Modal open title={tr('Supprimer la formation ?')} onClose={() => setConfirmDelete(false)}
          footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>{tr('Annuler')}</Button><Button variant="danger" onClick={remove} loading={busy}>{tr('Supprimer')}</Button></>}>
          <p>{tr('Une formation qui porte des présences ou des notes ne se supprime pas : passez-la au statut « annulée ».')}</p>
        </Modal>
      )}
    </form>
  );
}

/**
 * Prestataires et agents participants : ajout de tous les agents actifs d'un prestataire (liste
 * de choix selon la règle « prestataire actif » sur les dates de la formation) ou d'un agent ;
 * présence, jours, pré-test, post-test, satisfaction et avis saisis en grille, enregistrés en
 * une fois (contrôles du serveur : notes ≤ barème, jours ≤ durée, pas de note pour un absent).
 */
function ParticipantsCard({ s, canEdit, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(() => s.participants.map(editable));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState('');
  useEffect(() => { setRows(s.participants.map(editable)); setDirty(false); }, [s]);
  useEffect(() => {
    setAgentId('');
    if (!providerId) { setAgents([]); return; }
    api.partnerAgents(providerId).then(setAgents).catch(() => setAgents([]));
  }, [providerId]);

  const period = { from: s.startDate.slice(0, 7), to: s.endDate.slice(0, 7) };
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.providerId || '';
      if (!m.has(k)) m.set(k, { id: k, name: r.providerName || tr('Sans TPM'), rows: [] });
      m.get(k).rows.push(r);
    }
    return [...m.values()];
  }, [rows, tr]);
  const byId = new Map(s.participants.map((p) => [p.agentId, p]));
  const inSession = new Set(rows.map((r) => r.agentId));

  const change = (agent, k, v) => { setRows((list) => list.map((r) => (r.agentId === agent ? { ...r, [k]: v } : r))); setDirty(true); };
  async function add(input) {
    setBusy(true);
    try {
      const r = await api.addTrainingParticipants(s.id, input);
      toast.success(r.added ? tr('{n} participant(s) ajouté(s).', { n: r.added }) : tr('Ces agents participent déjà.'));
      setAgentId('');
      onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      await api.saveTrainingParticipants(s.id, rows.map(toPayload));
      toast.success(tr('Présences, notes et avis enregistrés.'));
      onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function remove(r) {
    try { await api.removeTrainingParticipant(s.id, r.agentId); toast.success(tr('Participant retiré.')); onChanged(); }
    catch (e) { toast.error(e.message); }
  }

  const num = (v) => (v === '' ? '' : v);
  const cols = canEdit ? 9 : 8;
  return (
    <Card>
      <CardHeader title={tr('TPM et agents participants')} subtitle={tr('Présence, tests (sur {max}) et avis de chaque participant.', { max: s.scoreMax })}>
        {canEdit && rows.length > 0 && <Button icon={Save} onClick={save} loading={busy} disabled={!dirty}>{tr('Enregistrer les présences et notes')}</Button>}
      </CardHeader>
      {canEdit && (
        <div className="card-body tr-add">
          <Users size={16} aria-hidden="true" className="muted" />
          <ProviderSelect period={period} value={providerId} onChange={setProviderId} placeholder={tr('Choisir un TPM…')} ariaLabel={tr('TPM')} />
          <Button variant="secondary" icon={UserPlus} disabled={!providerId || busy} onClick={() => add({ providerId })}>{tr('Ajouter tous ses agents actifs')}</Button>
          <span className="muted">{tr('ou')}</span>
          <select className={`select ${agentId ? '' : 'is-empty'}`} value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!providerId} aria-label={tr('Agent')}>
            <option value="">{tr('Un agent…')}</option>
            {agents.filter((a) => !inSession.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}{a.active ? '' : ` (${tr('inactif')})`}</option>)}
          </select>
          <Button variant="secondary" disabled={!agentId || busy} onClick={() => add({ agentIds: [agentId] })}>{tr('Ajouter')}</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="card-body muted">{tr('Aucun participant pour l\'instant. Ajoutez les agents d\'un TPM.')}</div>
      ) : (
        <div className="table-wrap">
          <table className="table tr-grid">
            <thead><tr>
              <th scope="col">{tr('Agent')}</th><th scope="col">{tr('Présence')}</th><th scope="col" className="num">{tr('Jours')}</th>
              <th scope="col" className="num">{tr('Pré-test')}</th><th scope="col" className="num">{tr('Post-test')}</th>
              <th scope="col" className="num">{tr('Progression')}</th><th scope="col">{tr('Satisfaction')}</th><th scope="col">{tr('Avis du participant')}</th>
              {canEdit && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}
            </tr></thead>
            {groups.map((g) => (
              <tbody key={g.id}>
                <tr className="tr-group"><th scope="rowgroup" colSpan={cols}>{g.name} <span className="muted">· {tr(g.rows.length > 1 ? '{n} agents' : '{n} agent', { n: g.rows.length })}</span></th></tr>
                {g.rows.map((r) => {
                  const saved = byId.get(r.agentId) || {};
                  return (
                    <tr key={r.agentId}>
                      <td><strong className="pv-nowrap">{r.agentName}</strong>{r.agentCode && <span className="pv-sub mono">{r.agentCode}</span>}</td>
                      <td>{canEdit ? (
                        <select className="select tr-cell" value={r.attendance} onChange={(e) => change(r.agentId, 'attendance', e.target.value)} aria-label={tr('Présence de {name}', { name: r.agentName })}>
                          <option value="">—</option>{ATTENDANCE.map((a) => <option key={a.id} value={a.id}>{tr(a.label)}</option>)}
                        </select>) : (r.attendance ? tr((ATTENDANCE.find((a) => a.id === r.attendance) || {}).label) : '—')}</td>
                      <td className="num">{canEdit ? <input className="input tr-cell tr-num" inputMode="decimal" value={num(r.daysPresent)} onChange={(e) => change(r.agentId, 'daysPresent', e.target.value)} aria-label={tr('Jours de présence de {name}', { name: r.agentName })} /> : (r.daysPresent || '—')}</td>
                      <td className="num">{canEdit ? <input className="input tr-cell tr-num" inputMode="decimal" value={num(r.preScore)} onChange={(e) => change(r.agentId, 'preScore', e.target.value)} aria-label={tr('Pré-test de {name}', { name: r.agentName })} /> : (r.preScore === '' ? '—' : r.preScore)}</td>
                      <td className="num">{canEdit ? <input className="input tr-cell tr-num" inputMode="decimal" value={num(r.postScore)} onChange={(e) => change(r.agentId, 'postScore', e.target.value)} aria-label={tr('Post-test de {name}', { name: r.agentName })} /> : (r.postScore === '' ? '—' : r.postScore)}</td>
                      <td className="num tabular">{saved.progress == null ? <span className="cell-empty">—</span>
                        : <span className={saved.pass === false ? 'text-warn' : ''}>{saved.progress > 0 ? '+' : ''}{tr('{p} pts', { p: saved.progress })}</span>}</td>
                      <td>{canEdit ? (
                        <select className="select tr-cell" value={r.satisfaction} onChange={(e) => change(r.agentId, 'satisfaction', e.target.value)} aria-label={tr('Satisfaction de {name}', { name: r.agentName })}>
                          <option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                        </select>) : (r.satisfaction ? `${r.satisfaction} / 5` : '—')}</td>
                      <td>{canEdit ? <input className="input tr-cell" maxLength={1000} value={r.feedback} onChange={(e) => change(r.agentId, 'feedback', e.target.value)} placeholder={tr('Facultatif')} aria-label={tr('Avis de {name}', { name: r.agentName })} /> : (r.feedback || '—')}</td>
                      {canEdit && <td><IconButton icon={Trash2} size="sm" label={tr('Retirer {name}', { name: r.agentName })} onClick={() => remove(r)} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {dirty && <div className="card-body tr-dirty"><Info size={15} aria-hidden="true" />{tr('Modifications non enregistrées.')}</div>}
    </Card>
  );
}

/** Évaluation de la formation : avis des participants (satisfaction, commentaires), agents à revoir, synthèse rédigée. */
function FeedbackCard({ s, canEdit, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [text, setText] = useState(s.feedbackSummary || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(s.feedbackSummary || ''); }, [s.feedbackSummary]);
  const sat = s.summary.satisfaction;
  const max = Math.max(1, ...sat.distribution.map((d) => d.n));
  const comments = s.participants.filter((p) => p.feedback);
  async function save() {
    setBusy(true);
    try { onSaved(await api.updateTraining(s.id, { feedbackSummary: text })); toast.success(tr('Synthèse enregistrée.')); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader title={tr('Évaluation de la formation')} subtitle={tr('Avis des participants et bilan.')} />
      <div className="card-body tr-feedback">
        <section className="pv-panel">
          <h3 className="pv-panel-title">{tr('Satisfaction des participants')}</h3>
          <div className="tr-sat"><span className="tr-sat-v tabular">{sat.avg == null ? '—' : tr('{n} / 5', { n: sat.avg })}</span>
            <span className="muted">{tr('{n} avis', { n: sat.n })}</span></div>
          <div className="tr-dist" role="list">
            {[...sat.distribution].reverse().map((d) => (
              <div key={d.value} className="tr-dist-row" role="listitem">
                <span className="tabular">{d.value}</span>
                <span className="tr-dist-bar"><span style={{ width: `${(d.n / max) * 100}%` }} /></span>
                <span className="tabular muted">{d.n}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="pv-panel">
          <h3 className="pv-panel-title"><MessageSquare size={16} aria-hidden="true" />{tr('Commentaires')}</h3>
          {comments.length === 0 ? <p className="muted">{tr('Aucun commentaire saisi.')}</p> : (
            <ul className="tr-comments">{comments.map((p) => <li key={p.agentId}><strong>{p.agentName}</strong><span>{p.feedback}</span></li>)}</ul>
          )}
          {s.summary.toReview.length > 0 && (
            <p className="pv-callout"><Info size={15} aria-hidden="true" />{tr('À revoir (post-test sous le seuil) : {names}', { names: s.summary.toReview.map((x) => x.agentName).join(', ') })}</p>
          )}
        </section>
        <section className="pv-panel span-2">
          <h3 className="pv-panel-title">{tr('Synthèse de la formation')}</h3>
          {canEdit ? (
            <>
              <textarea className="input" rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} aria-label={tr('Synthèse de la formation')}
                placeholder={tr('Ce qui a bien fonctionné, ce qu\'il faut améliorer, suites à donner.')} />
              <div><Button size="sm" variant="secondary" icon={Save} onClick={save} loading={busy} disabled={text === (s.feedbackSummary || '')}>{tr('Enregistrer la synthèse')}</Button></div>
            </>
          ) : <p className="pv-wrap">{s.feedbackSummary || <span className="muted">{tr('Pas encore de synthèse.')}</span>}</p>}
        </section>
      </div>
    </Card>
  );
}

const str = (v) => (v == null ? '' : String(v));
function editable(p) {
  return { ...p, attendance: p.attendance || '', daysPresent: str(p.daysPresent), preScore: str(p.preScore), postScore: str(p.postScore), satisfaction: str(p.satisfaction), feedback: p.feedback || '' };
}
const numOrNull = (v) => { const t = String(v).trim().replace(',', '.'); return t === '' ? null : Number(t); };
function toPayload(r) {
  return {
    agentId: r.agentId, attendance: r.attendance || null, daysPresent: numOrNull(r.daysPresent), preScore: numOrNull(r.preScore),
    postScore: numOrNull(r.postScore), satisfaction: r.satisfaction === '' ? null : Number(r.satisfaction), feedback: r.feedback.trim() || null,
  };
}
