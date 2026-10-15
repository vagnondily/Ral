import React, { useEffect, useState } from 'react';
import { UserPlus, Pencil, Trash2, Users, CheckCircle2, MinusCircle } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Avatar, Badge, Button, EmptyState, Field, IconButton, Skeleton } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { formatDate } from '../../../lib/contracts.js';
import { useI18n } from '../../../lib/i18n.jsx';

const FONCTIONS = ['Coordinateur de terrain', 'Superviseur', 'Agent de collecte', 'Enquêteur', 'Contrôleur qualité'];
const empty = () => ({ name: '', fonction: '', code: '', phone: '' });

/**
 * Agents du prestataire, gérés EN LIGNE (plus de fenêtre) : ajouter, modifier (ligne dépliée
 * sous l'agent), désactiver ou réactiver. Un agent qui porte des données (formulaires,
 * formations, évaluations) ne se supprime jamais : il se désactive et garde son historique.
 * Le code d'enquêteur relie automatiquement ses formulaires reçus (Correspondances) — il sert
 * à sa note automatique.
 */
export default function ProviderAgentsTab({ providerId, canEdit, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(null);   // { id, ...champs } en cours de modification
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = () => api.partnerAgents(providerId).then(setRows).catch((e) => { setError(e.message); setRows([]); });
  useEffect(() => { load(); }, [providerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (msg) => { toast.success(msg); load(); onChanged(); };
  const clean = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v]));

  async function add(e) {
    e.preventDefault();
    if (draft.name.trim().length < 2) return;
    setBusy(true);
    try {
      await api.addPartnerAgent(providerId, Object.fromEntries(Object.entries(clean(draft)).filter(([, v]) => v != null)));
      setDraft(empty());
      done(tr('Agent ajouté.'));
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function save(e) {
    e.preventDefault();
    if (!edit || edit.name.trim().length < 2) return;
    setBusy(true);
    try {
      const { id, ...patch } = clean(edit);
      await api.patchPartnerAgent(providerId, id, patch);
      setEdit(null);
      done(tr('Agent mis à jour.'));
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  async function setActive(a, active) {
    try { await api.patchPartnerAgent(providerId, a.id, { active }); done(tr(active ? 'Agent réactivé.' : 'Agent désactivé : son historique est conservé.')); }
    catch (err) { toast.error(err.message); }
  }
  async function remove(a) {
    try { await api.removePartnerAgent(providerId, a.id); done(tr('Agent supprimé.')); }
    catch (err) { toast.error(err.message); }
  }

  if (rows === null) return <div className="card-body"><Skeleton height={120} /></div>;
  const startEdit = (a) => setEdit({
    id: a.id, name: a.name, fonction: a.fonction || '', code: a.code || '', phone: a.phone || '', email: a.email || '',
    sex: a.sex || '', startedOn: a.startedOn || '', endedOn: a.endedOn || '',
  });
  const cols = canEdit ? 8 : 6;
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  return (
    <>
      {error && <div className="card-body"><Alert tone="error">{error}</Alert></div>}
      <div className="card-body pv-intro">
        <Users size={16} aria-hidden="true" />
        <span>{tr('Le code d\'enquêteur est celui saisi dans les formulaires Kobo : il relie automatiquement les formulaires reçus à l\'agent et alimente sa note automatique.')}</span>
      </div>
      {rows.length === 0 && !canEdit ? (
        <EmptyState icon={Users} title={tr('Aucun agent')}>{tr('Aucun agent enregistré pour ce prestataire.')}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table grid pv-agents">
            <thead><tr>
              <th scope="col">{tr('Agent')}</th><th scope="col">{tr('Fonction')}</th><th scope="col">{tr("Code d'enquêteur")}</th>
              {canEdit && <th scope="col">{tr('Téléphone')}</th>}
              <th scope="col" className="num">{tr('Formulaires reçus')}</th><th scope="col" className="num">{tr('Formations')}</th>
              <th scope="col">{tr('Statut')}</th>{canEdit && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <React.Fragment key={a.id}>
                  <tr className={`${a.active ? '' : 'is-muted'} ${edit && edit.id === a.id ? 'is-editing' : ''}`}>
                    <td><span className="agent pv-nowrap"><Avatar name={a.name} /><strong>{a.name}</strong></span>
                      {a.startedOn && <span className="pv-sub">{tr('Depuis le {date}', { date: formatDate(a.startedOn) })}</span>}</td>
                    <td>{a.fonction || <span className="cell-empty">—</span>}</td>
                    <td className="mono">{a.code || <span className="cell-empty">—</span>}</td>
                    {canEdit && <td className="pv-nowrap">{a.phone || <span className="cell-empty">—</span>}</td>}
                    <td className="num tabular">{a.submissions || <span className="cell-empty">0</span>}</td>
                    <td className="num tabular">{a.trainings || <span className="cell-empty">0</span>}</td>
                    <td>{a.active ? <Badge tone="green" icon={CheckCircle2}>{tr('Actif')}</Badge> : <Badge icon={MinusCircle}>{tr('Inactif')}</Badge>}</td>
                    {canEdit && (
                      <td><div className="row-actions">
                        <IconButton icon={Pencil} label={tr('Modifier {name}', { name: a.name })} size="sm" onClick={() => (edit && edit.id === a.id ? setEdit(null) : startEdit(a))} />
                        {a.active
                          ? <Button size="sm" variant="ghost" onClick={() => setActive(a, false)}>{tr('Désactiver')}</Button>
                          : <Button size="sm" variant="ghost" onClick={() => setActive(a, true)}>{tr('Réactiver')}</Button>}
                        {!a.submissions && !a.trainings && <IconButton icon={Trash2} label={tr('Supprimer {name}', { name: a.name })} size="sm" onClick={() => remove(a)} />}
                      </div></td>
                    )}
                  </tr>
                  {edit && edit.id === a.id && (
                    <tr className="pv-edit-row">
                      <td colSpan={cols}>
                        <form className="pv-edit-form" onSubmit={save}>
                          <Field label={tr("Nom de l'agent")} htmlFor="ag-e-name" required><input id="ag-e-name" className="input" maxLength={160} value={edit.name} onChange={set('name')} /></Field>
                          <Field label={tr('Fonction')} htmlFor="ag-e-fn"><input id="ag-e-fn" className="input" list="pv-fonctions" maxLength={120} value={edit.fonction} onChange={set('fonction')} /></Field>
                          <Field label={tr("Code d'enquêteur")} htmlFor="ag-e-code"><input id="ag-e-code" className="input mono" maxLength={60} value={edit.code} onChange={set('code')} /></Field>
                          <Field label={tr('Téléphone')} htmlFor="ag-e-phone"><input id="ag-e-phone" className="input" maxLength={40} value={edit.phone} onChange={set('phone')} /></Field>
                          <Field label={tr('Courriel')} htmlFor="ag-e-mail"><input id="ag-e-mail" type="email" className="input" maxLength={160} value={edit.email} onChange={set('email')} /></Field>
                          <Field label={tr('Sexe')} htmlFor="ag-e-sex">
                            <select id="ag-e-sex" className="select" value={edit.sex} onChange={set('sex')}><option value="">—</option><option value="F">{tr('Femme')}</option><option value="M">{tr('Homme')}</option></select>
                          </Field>
                          <Field label={tr('Entrée')} htmlFor="ag-e-from"><input id="ag-e-from" type="date" className="input" value={edit.startedOn} onChange={set('startedOn')} /></Field>
                          <Field label={tr('Sortie')} htmlFor="ag-e-to"><input id="ag-e-to" type="date" className="input" value={edit.endedOn} onChange={set('endedOn')} /></Field>
                          <div className="pv-edit-actions">
                            <Button variant="secondary" onClick={() => setEdit(null)} disabled={busy}>{tr('Annuler')}</Button>
                            <Button type="submit" loading={busy} disabled={edit.name.trim().length < 2}>{tr('Enregistrer')}</Button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={cols} className="muted" style={{ textAlign: 'center', padding: 16 }}>{tr("Aucun agent pour l'instant.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <form className="card-body pv-add" onSubmit={add}>
          <span className="pv-add-title">{tr('Ajouter un agent')}</span>
          <input className="input" placeholder={tr("Nom de l'agent")} aria-label={tr("Nom de l'agent")} value={draft.name} maxLength={160} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" placeholder={tr('Fonction')} aria-label={tr('Fonction')} list="pv-fonctions" value={draft.fonction} maxLength={120} onChange={(e) => setDraft({ ...draft, fonction: e.target.value })} />
          <input className="input" placeholder={tr("Code d'enquêteur")} aria-label={tr("Code d'enquêteur")} value={draft.code} maxLength={60} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          <input className="input" placeholder={tr('Téléphone')} aria-label={tr('Téléphone')} value={draft.phone} maxLength={40} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <Button type="submit" icon={UserPlus} loading={busy} disabled={draft.name.trim().length < 2}>{tr('Ajouter')}</Button>
        </form>
      )}
      <datalist id="pv-fonctions">{FONCTIONS.map((f) => <option key={f} value={f} />)}</datalist>
    </>
  );
}
