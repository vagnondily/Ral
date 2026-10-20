import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, CheckCircle2, AlertTriangle, Link2, ArrowDown, ChevronDown, ChevronUp, RefreshCw, Layers, Clock, MinusCircle, XCircle, Info,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { choiceText, indexStatus, INDEX_STATUS_LABEL, classesStatus, CLASSES_STATUS_LABEL } from '../../lib/indicatorView.js';
import {
  CONFIDENCE, NO_CONFIDENCE, WARNING_LABEL, warningLabel, issueLabel, driftKeyLabel, driftValue, driftState, blockedText, blockedTargetText,
  coveragePct, initialRows, mergeRows, rowSelectable, isChecked, checkedPayload, itemError, templateErrorText, fieldIssues, positiveForField,
  cardCounts, availableFilters, effectiveFilter, filterMembers, keptNaValues, noDefaultYes, needsReload,
} from '../../lib/templateProposal.js';
import './templates.css';

// Qualité de la variable proposée : couleur + icône + libellé (jamais la couleur seule).
const CONF_ICON = { check: CheckCircle2, link: Link2, warn: AlertTriangle, none: MinusCircle };
// Filtres : leurs lignes sont décidées sur l'état CHARGÉ (lib filterMembers) — jamais sur la saisie en cours.
const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'check', label: 'À vérifier' },
  { id: 'missing', label: 'Sans variable' },
  { id: 'pending', label: 'En attente des données' },
  { id: 'update', label: 'À mettre à jour' },
  { id: 'diff', label: 'Différences' },
];
const rowId = (formId, code) => `tpl-row-${formId}-${code}`;
// Écart affiché en police à chasse fixe : codes seulement (variable, valeurs), jamais un libellé ni une méthode.
const CODE_KEYS = new Set(['sourceField', 'positiveValue', 'naValues']);

/**
 * Modèle d'indicateurs de la fiche (retours n° 12, 66 et 85) : les indicateurs
 * des tableaux de bord de référence, domaine par domaine, avec la variable du
 * formulaire proposée et CONTRÔLÉE pour chacun (type, liste, sous-table : règle
 * du serveur, indicatorProposals.bindTemplate).
 *  - Cochés d'office : SEULEMENT `suggestion.preselect` (jamais une sous-table,
 *    jamais un type incompatible) ; chaque défaut et avertissement est dit en
 *    mots, sur sa ligne.
 *  - « Créer » envoie exactement les lignes cochées à l'écran (lib/templateProposal
 *    rowSelectable : la même règle pour la case, le compte du bouton et l'envoi) ;
 *    un refus qui nomme un élément s'affiche sur SA ligne.
 *  - Jamais vide : sans modèle pour l'activité (ou sans activité), le modèle
 *    proposé d'après les variables (source « proposal ») avec sa couverture, et le
 *    choix d'un autre modèle ou du rattachement à une activité.
 *  - Un indicateur créé avant une correction du modèle est signalé « à mettre à
 *    jour » avec la modification proposée, envoyée d'un clic par la modification
 *    habituelle (PATCH, mêmes contrôles) ; un refus s'affiche sur sa ligne.
 * @param {{ form, canEdit, refreshKey?, onApplied?, onAttach?: () => void, onLoaded?: (info: { template: boolean, failed: boolean }) => void }} props
 *   onAttach : ouvre « Rattacher à une activité » de la fiche (absent = lecture seule) ;
 *   onLoaded : ce que la carte montre (un modèle ou non), pour l'état vide de la liste des indicateurs.
 */
export default function TemplateBindingCard({ form, canEdit, refreshKey = 0, onApplied, onAttach, onLoaded }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState(null); // modèle choisi par l'utilisateur (fiche sans modèle d'activité)
  const [rows, setRows] = useState({}); // code → { on, field, positive }
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(null); // code en cours de mise à jour | 'all'
  const [expanded, setExpanded] = useState(null); // null = selon l'état (replié une fois le modèle appliqué)
  const [rowErrors, setRowErrors] = useState({}); // code → refus de « Créer » qui nomme l'élément (effacé à la saisie)
  // Lignes signalées par le dernier refus : gardées pour le filtre « À vérifier » jusqu'au prochain envoi, même
  // quand l'utilisateur corrige la ligne (sinon elle disparaîtrait du filtre pendant la saisie).
  const [flagged, setFlagged] = useState({});
  // code → refus de la DERNIÈRE mise à jour depuis le modèle (V3/V4) : seulement les lignes de cette action, gardé
  // jusqu'à l'action suivante ou au prochain rechargement (sauf celui qui suit la mise à jour elle-même).
  const [driftErrors, setDriftErrors] = useState({});
  const [applyError, setApplyError] = useState(null);

  // `reset` : cases et variables repartent de la précoche (ouverture, autre modèle, après « Créer ») ;
  // sinon (indicateur modifié ailleurs, mise à jour) elles sont GARDÉES pour les éléments encore à créer.
  // Chaque rechargement efface les refus de mise à jour (la ligne a pu changer : supprimée, recréée, corrigée
  // dans la liste) — sauf `keepDriftErrors`, le rechargement qui suit la mise à jour qui vient de les produire.
  async function load(key = chosen, { reset = false, keepDriftErrors = false } = {}) {
    if (!keepDriftErrors) setDriftErrors({});
    try {
      const r = await api.monTemplate(form.id, key);
      setData(r);
      setRows((prev) => (reset ? initialRows(r.template?.items) : mergeRows(prev, r.template?.items)));
    } catch (e) {
      // Modèle choisi refusé (l'activité a changé entre-temps) : retour au modèle de la fiche.
      if (key && e.status === 400) { setChosen(null); await load(null, { reset: true }); return; }
      toast.error(templateErrorText(e, tr, { template: key }));
      setData({ failed: templateErrorText(e, tr, { template: key }), template: null, fields: [], proposal: { ranking: [] } });
    }
  }
  useEffect(() => {
    setData(null); setChosen(null); setRowErrors({}); setFlagged({}); setDriftErrors({}); setApplyError(null); setRows({});
    load(null, { reset: true });
    /* eslint-disable-next-line */
  }, [form.id, form.activityCategory]);
  // Indicateur enregistré ou supprimé dans la liste (autre carte) : « déjà créé » / « code pris » rechargés, une fois.
  useEffect(() => { if (refreshKey) load(); /* eslint-disable-next-line */ }, [refreshKey]);

  const fieldsByName = useMemo(() => new Map((data?.fields || []).map((f) => [f.name, f])), [data]);
  const items = useMemo(() => data?.template?.items || [], [data]);
  // Comptes de l'état chargé (une catégorie par élément : les badges se somment au total).
  const loaded = useMemo(() => cardCounts(items), [items]);
  const checkedCount = useMemo(() => items.filter((it) => isChecked(it, rows[it.code], fieldsByName)).length, [items, rows, fieldsByName]);
  const filters = availableFilters(loaded);
  const activeFilter = effectiveFilter(filter, filters);
  // Filtre devenu sans objet (plus rien « à mettre à jour » après une mise à jour réussie…) : retour à « Tous ».
  useEffect(() => { if (data && activeFilter !== filter) setFilter(activeFilter); }, [data, activeFilter, filter]);
  // Ce que la carte montre (un modèle ou non) : l'état vide de la liste des indicateurs en dépend.
  useEffect(() => { if (data) onLoaded?.({ template: Boolean(data.template), failed: Boolean(data.failed) }); /* eslint-disable-next-line */ }, [data]);
  const members = useMemo(() => filterMembers(items, activeFilter, { rowErrors: flagged, driftErrors }), [items, activeFilter, flagged, driftErrors]);

  if (data === null) return <Card><div className="card-body"><Skeleton height={140} /></div></Card>;

  if (data.failed) {
    return (
      <Card aria-labelledby="tpl-title">
        <CardHeader id="tpl-title" title={tr('Modèle d\'indicateurs')} />
        <div className="card-body">
          <Alert tone="error" icon={XCircle}>
            {tr('Le modèle d\'indicateurs n\'a pas pu être chargé : {msg}', { msg: data.failed })}
            {' '}<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => { setData(null); load(null, { reset: true }); }}>{tr('Réessayer')}</Button>
          </Alert>
        </div>
      </Card>
    );
  }

  const ranking = data.proposal?.ranking || [];
  const best = data.proposal?.best || null;
  const choose = (key) => { setChosen(key || null); setData(null); setRowErrors({}); setFlagged({}); setDriftErrors({}); setApplyError(null); load(key || null, { reset: true }); };
  const current = data.template ? ranking.find((r) => r.key === data.template.key) : null;

  // Choix du modèle : seulement quand l'activité rattachée n'en impose pas un (sinon : changer l'activité).
  const picker = data.source !== 'activity' && ranking.length > 0 && (
    <label className="tpl-choice">
      <span className="tpl-choice-label">{tr(data.template ? 'Utiliser un autre modèle' : 'Choisir un modèle')}</span>
      <select className="select select-sm" value={data.template?.key || ''} onChange={(e) => choose(e.target.value)}>
        {!data.template && <option value="">{tr('— choisir un modèle —')}</option>}
        {ranking.map((r) => (
          <option key={r.key} value={r.key}>
            {tr('{label} — {f} élément(s) sur {t} trouvé(s) ({p} %)', { label: r.label, f: formatInt(r.found), t: formatInt(r.total), p: coveragePct(r.coverage) })}
            {best && r.key === best.key ? ` · ${tr('proposé')}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
  // Activité : les indicateurs n'en dépendent pas ; la couverture et le plan de suivi, si.
  const activityLine = form.activityCategory ? (
    <> {data.source === 'proposal'
      ? tr('L\'activité « {a} » n\'a pas de modèle d\'indicateurs : celui-ci est proposé d\'après les variables de la fiche.', { a: form.activityCategory })
      : tr('L\'activité « {a} » n\'a pas de modèle d\'indicateurs.', { a: form.activityCategory })}</>
  ) : (
    <>
      {' '}{tr('La fiche n\'est rattachée à aucune activité : les indicateurs n\'en ont pas besoin, la couverture et le plan de suivi si.')}
      {data.template?.mmrCategory && <> {tr('Activité de ce modèle : {a}.', { a: data.template.mmrCategory })}</>}
      {canEdit && onAttach && <>{' '}<button type="button" className="inline-link" onClick={onAttach}>{tr('Rattacher la fiche à une activité')}</button></>}
    </>
  );

  if (!data.template) {
    return (
      <Card aria-labelledby="tpl-title">
        <CardHeader id="tpl-title" title={tr('Modèle d\'indicateurs')} />
        <div className="card-body">
          <Alert tone="info" icon={Sparkles}>
            {form.activityCategory
              ? tr('L\'activité « {a} » n\'a pas de modèle d\'indicateurs, et aucun modèle ne correspond assez aux variables de cette fiche (moins de 30 % de leurs éléments trouvés).', { a: form.activityCategory })
              : tr('Aucun modèle d\'indicateurs ne correspond assez aux variables de cette fiche (moins de 30 % de leurs éléments trouvés).')}
            {' '}{tr('Choisissez un modèle ci-dessous si l\'un d\'eux est le bon, ou créez les indicateurs un par un (« Nouvel indicateur »).')}
            {picker}
          </Alert>
        </div>
      </Card>
    );
  }

  const shown = items.filter((it) => members.has(it.code));
  const byDomain = [];
  for (const it of shown) {
    const last = byDomain[byDomain.length - 1];
    if (last && last.module === it.module) last.items.push(it); else byDomain.push({ module: it.module, items: [it] });
  }
  const hiddenChecked = checkedCount - shown.filter((it) => isChecked(it, rows[it.code], fieldsByName)).length;
  const set = (code, patch) => {
    setRows((r) => ({ ...r, [code]: { ...r[code], ...patch } }));
    if (rowErrors[code]) setRowErrors((e) => { const n = { ...e }; delete n[code]; return n; });
  };
  // Modèle hors activité (proposé ou choisi) : la création vise CE modèle.
  const templateParam = data.source === 'activity' ? null : data.template.key;

  async function apply() {
    const payload = checkedPayload(items, rows, fieldsByName);
    if (!payload.length) return;
    setSaving(true); setRowErrors({}); setFlagged({}); setDriftErrors({}); setApplyError(null);
    try {
      const r = await api.monApplyTemplate(form.id, payload, { template: templateParam });
      toast.success(tr('{n} indicateur(s) créé(s) depuis le modèle « {label} ».', { n: formatInt(r.applied), label: data.template.label }));
      if (r.conflicts) toast.error(tr('{n} indicateur(s) non créé(s) : leur code est déjà utilisé par un indicateur de la fiche.', { n: formatInt(r.conflicts) }));
      await load(undefined, { reset: true });
      onApplied?.();
    } catch (e) {
      const ie = itemError(e);
      const target = ie && items.find((it) => it.code === ie.item);
      if (target) {
        // Refus qui nomme l'élément (type, valeur comptée hors liste, « % = valeur » sans valeur, valeur aussi
        // hors base, variable disparue) : le motif sur SA ligne, dans la langue de l'écran ; rien n'a été créé.
        setRowErrors({ [ie.item]: templateErrorText(e, tr, { sourceField: rows[ie.item]?.field }) });
        setFlagged({ [ie.item]: true });
        setApplyError(tr('Rien n\'a été créé : « {label} » est à corriger (ligne signalée ci-dessous).', { label: target.label }));
        setFilter('all');
        setTimeout(() => document.getElementById(rowId(form.id, ie.item))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
      } else {
        // Carte périmée (modèle changé ailleurs…) : le message dit de recharger, le bouton le fait.
        const msg = templateErrorText(e, tr, { template: templateParam });
        setApplyError(needsReload(e) ? { msg, reload: true } : msg);
        toast.error(msg);
      }
    } finally { setSaving(false); }
  }

  // Mise à jour d'indicateurs depuis le modèle (R6, T3) : les modifications MONTRÉES (`expected`) partent en UNE
  // requête ; le serveur les recalcule sur les indicateurs verrouillés et n'écrit que celles qui sont encore
  // exactement celles du modèle. Résultat ligne par ligne : chaque refus est gardé sur SA ligne, dans la langue
  // de l'écran — affiché même si la ligne n'a plus d'écart après le rechargement qui suit (supprimé, déjà mis à
  // jour). Seuls les refus de CETTE action restent (V3/V4) : ceux d'avant sont effacés dès l'envoi.
  // `full` (action d'UNE ligne seulement) : applique aussi les différences (la définition du modèle).
  async function update(list, { full = false } = {}) {
    setUpdating(list.length === 1 ? list[0].code : 'all');
    setDriftErrors({}); setApplyError(null);
    const sent = list.map((it) => ({ it, patch: full ? driftState(it).fullPatch : driftState(it).patch }));
    const errors = {};
    let done = 0;
    let stale = false;
    try {
      const r = await api.monTemplateUpdates(form.id, {
        mode: full ? 'full' : 'corrections', template: templateParam, items: sent.map(({ it, patch }) => ({ id: it.existing.id, expected: patch })),
      });
      const byId = new Map((r.results || []).map((x) => [x.id, x]));
      for (const { it, patch } of sent) {
        const res = byId.get(it.existing.id);
        if (res && res.ok) { done += 1; continue; }
        const err = { status: res ? res.status : 0, message: res ? res.message : '', details: res ? res.details : null };
        errors[it.code] = templateErrorText(err, tr, { sourceField: patch.sourceField || it.existing.sourceField });
        if (needsReload(err)) stale = true;
      }
    } catch (e) {
      // La requête elle-même a échoué (réseau, fiche disparue) : rien n'est écrit, motif au niveau de la carte.
      const msg = templateErrorText(e, tr, { template: templateParam });
      setApplyError(needsReload(e) ? { msg, reload: true } : msg);
      toast.error(msg);
      setExpanded(true);
      setUpdating(null);
      return;
    }
    const failed = Object.keys(errors).length;
    setDriftErrors(errors);
    if (done) toast.success(tr('{n} indicateur(s) mis à jour selon le modèle.', { n: formatInt(done) }));
    if (failed) {
      toast.error(tr('{n} mise(s) à jour refusée(s) : le motif est affiché sur la ligne.', { n: formatInt(failed) }));
      setExpanded(true); setFilter('check');
    }
    setUpdating(null);
    if (done || stale) await load(undefined, { keepDriftErrors: true });
    if (done) onApplied?.();
  }

  // « Tout mettre à jour » : les CORRECTIONS du modèle seulement — jamais une différence (modification de l'utilisateur).
  const driftItems = items.filter((it) => driftState(it)?.updatable);
  const remaining = items.filter((it) => !it.existing && !it.taken).length;
  const open = expanded ?? (loaded.existing === 0 || loaded.corrections > 0);
  const title = data.source === 'activity' ? tr('Modèle de l\'activité : {label}', { label: data.template.label })
    : data.source === 'proposal' ? tr('Modèle proposé : {label}', { label: data.template.label })
      : tr('Modèle choisi : {label}', { label: data.template.label });
  const cov = current || best;
  const covText = cov && tr('{f} élément(s) sur {t} trouvé(s) dans les variables de la fiche ({p} %).', {
    f: formatInt(cov.found), t: formatInt(cov.total), p: coveragePct(cov.coverage),
  });
  const proposal = data.proposal || {};
  const sourceNote = data.source === 'proposal' ? (
    <Alert tone={proposal.ambiguous || !proposal.strong ? 'warning' : 'info'} icon={Sparkles}>
      <strong>{tr('Proposé d\'après les variables de la fiche')}</strong> — <span className="tpl-cov">{covText}</span>
      {' '}{proposal.ambiguous ? tr('D\'autres modèles correspondent presque autant : vérifiez le choix.')
        : !proposal.strong ? tr('Correspondance partielle : vérifiez que c\'est bien le modèle de ce formulaire.')
          : tr('Forte correspondance.')}
      {activityLine}
      <div className="tpl-choice">{tr('Pour l\'utiliser : vérifiez les variables cochées ci-dessous, puis « Créer ».')}</div>
      {picker}
    </Alert>
  ) : data.source === 'chosen' ? (
    <Alert tone="info" icon={Sparkles}>
      <strong>{tr('Modèle choisi : « {label} »', { label: data.template.label })}</strong>{covText && <> — <span className="tpl-cov">{covText}</span></>}
      {best && best.key !== data.template.key && <>{' '}<button type="button" className="inline-link" onClick={() => choose(null)}>{tr('Revenir au modèle proposé (« {label} »)', { label: best.label })}</button></>}
      {activityLine}
      {picker}
    </Alert>
  ) : null;
  const driftNote = loaded.corrections > 0 && (
    <Alert tone="warning" icon={RefreshCw}>
      {tr('{n} indicateur(s) créé(s) avant une correction du modèle : ils gardent une ancienne valeur du modèle. Rien n\'a été modifié ; la correction proposée est affichée sur chaque ligne.', { n: formatInt(loaded.corrections) })}
      <div className="tpl-alert-actions">
        {canEdit && driftItems.length > 0 && <Button size="sm" variant="secondary" icon={RefreshCw} loading={updating === 'all'} disabled={Boolean(updating)} onClick={() => update(driftItems)}>
          {tr('Tout mettre à jour ({n})', { n: formatInt(driftItems.length) })}</Button>}
        <button type="button" className="inline-link" onClick={() => { setExpanded(true); setFilter('update'); }}>{tr('Voir lesquels')}</button>
      </div>
    </Alert>
  );
  // Différences (modifications faites dans la fiche, le plus souvent) : pour information, jamais en lot.
  const diffNote = loaded.differences > 0 && (
    <Alert tone="info" icon={Info}>
      {tr('{n} indicateur(s) diffèrent du modèle sans en être une ancienne version (le plus souvent : modifiés dans la fiche). Affichés pour information ; rien ne change sans l\'action de leur ligne.', { n: formatInt(loaded.differences) })}
      {' '}<button type="button" className="inline-link" onClick={() => { setExpanded(true); setFilter('diff'); }}>{tr('Voir lesquels')}</button>
    </Alert>
  );

  if (!open) {
    return (
      <Card aria-labelledby="tpl-title">
        <CardHeader id="tpl-title" title={title}
          subtitle={tr('{n} indicateur(s) du modèle sur {t} déjà créé(s) ; {r} restant(s). Les indicateurs déjà créés ne sont pas modifiés par le modèle : modifiez-les dans la liste des indicateurs.', {
            n: formatInt(loaded.existing), t: formatInt(items.length), r: formatInt(remaining),
          })}>
          <Button variant="secondary" icon={ChevronDown} onClick={() => setExpanded(true)}>{tr('Afficher le modèle')}</Button>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="tpl-title">
      <CardHeader id="tpl-title" title={title}
        subtitle={tr('Les indicateurs de vos tableaux de bord de référence, domaine par domaine, avec la variable du formulaire proposée pour chacun. Seules les variables trouvées et vérifiées (type, liste de choix, hors sous-tableau) sont cochées d\'office : vérifiez, cochez, puis créez. Un indicateur déjà créé n\'est jamais modifié par le modèle.')}>
        {loaded.existing > 0 && <Button variant="ghost" icon={ChevronUp} onClick={() => setExpanded(false)}>{tr('Replier')}</Button>}
        {canEdit && checkedCount > 0 && <Button icon={CheckCircle2} loading={saving} onClick={apply}>{tr('Créer {n} indicateur(s)', { n: formatInt(checkedCount) })}</Button>}
      </CardHeader>
      {(sourceNote || driftNote || diffNote || applyError) && (
        <div className="card-body section-gap tpl-notes">
          {applyError && (
            <Alert tone="error" icon={XCircle}>
              {typeof applyError === 'string' ? applyError : applyError.msg}
              {applyError.reload && <>{' '}<Button size="sm" variant="secondary" icon={RefreshCw}
                onClick={() => { setApplyError(null); setData(null); load(chosen, { reset: true }); }}>{tr('Recharger le modèle')}</Button></>}
            </Alert>
          )}
          {sourceNote}{driftNote}{diffNote}
        </div>
      )}
      <div className="card-body tpl-head">
        <div className="tpl-counts">
          {/* Une catégorie par élément (lib rowCategory) : ces nombres se somment au total du modèle. */}
          {['sure', 'probable', 'a_verifier'].map((k) => {
            const Icon = CONF_ICON[CONFIDENCE[k].icon];
            return <span key={k}><Badge tone={CONFIDENCE[k].tone} icon={Icon}>{tr(CONFIDENCE[k].label)}</Badge> {formatInt(loaded[k])}</span>;
          })}
          {loaded.subtable > 0 && <span title={tr(WARNING_LABEL.groupe)}><Badge tone={null} icon={Layers}>{tr('Sous-tableau')}</Badge> {formatInt(loaded.subtable)}</span>}
          {loaded.pending > 0 && <span><Badge tone={null} icon={Clock}>{tr('En attente des données')}</Badge> {formatInt(loaded.pending)}</span>}
          <span><Badge tone={null} icon={MinusCircle}>{tr(NO_CONFIDENCE.label)}</Badge> {formatInt(loaded.none)}</span>
          {loaded.existing > 0 && <span className="muted">{tr('{n} déjà créé(s)', { n: formatInt(loaded.existing) })}</span>}
          {hiddenChecked > 0 && <span className="tpl-hidden-checked">{tr('{n} coché(s) masqué(s) par le filtre (créés aussi)', { n: formatInt(hiddenChecked) })}</span>}
        </div>
        <div className="segmented" role="group" aria-label={tr('Filtrer')}>
          {FILTERS.filter((f) => filters.includes(f.id)).map((f) => <button key={f.id} type="button" aria-pressed={activeFilter === f.id} onClick={() => setFilter(f.id)}>{tr(f.label)}</button>)}
        </div>
      </div>
      <datalist id={`tpl-fields-${form.id}`}>
        {(data.fields || []).map((f) => <option key={f.name} value={f.name}>{f.label || ''}</option>)}
      </datalist>
      <div className="table-wrap">
        <table className="table tpl-table">
          <thead><tr>
            {canEdit && <th scope="col" className="tpl-check"><span className="sr-only">{tr('Inclure')}</span></th>}
            <th scope="col">{tr('Indicateur du modèle')}</th><th scope="col">{tr('Variable du formulaire')}</th>
            <th scope="col">{tr('Valeur comptée')}</th><th scope="col">{tr('Proposition')}</th>
          </tr></thead>
          <tbody>
            {byDomain.length === 0 && (
              <tr><td colSpan={canEdit ? 5 : 4} className="muted">{tr('Aucun indicateur du modèle pour ce filtre.')}</td></tr>
            )}
            {byDomain.map((g) => (
              <React.Fragment key={g.module}>
                <tr className="tpl-domain"><th colSpan={canEdit ? 5 : 4} scope="colgroup">{g.module}</th></tr>
                {g.items.map((it) => (
                  <TemplateRow key={it.code} it={it} formId={form.id} row={rows[it.code] || {}} fieldsByName={fieldsByName}
                    canEdit={canEdit} rowError={rowErrors[it.code]} driftError={driftErrors[it.code]}
                    updating={updating} onSet={set} onUpdate={(opts) => update([it], opts)} />
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Une ligne du modèle : élément, variable proposée (modifiable), valeur comptée, qualité de la proposition. */
function TemplateRow({ it, formId, row: r, fieldsByName, canEdit, rowError, driftError, updating, onSet, onUpdate }) {
  const { tr } = useI18n();
  const s = it.suggestion || {};
  const conf = CONFIDENCE[s.confidence] || NO_CONFIDENCE;
  const ConfIcon = CONF_ICON[conf.icon];
  // Déjà créé (ou code pris) : le modèle ne le modifie pas — il se modifie dans la liste des indicateurs.
  const locked = Boolean(it.existing || it.taken);
  const edit = canEdit && !locked;
  const field = fieldsByName.get(r.field);
  const sel = rowSelectable(it, r, fieldsByName);
  const checked = Boolean(r.on) && sel.ok;
  const invalid = sel.reason === 'unknown_field';
  // Défauts de la variable ACTUELLE de la ligne (type, valeur comptée dans sa liste) — recalculés à chaque changement.
  const issues = !locked && field ? fieldIssues(it, field, r.positive) : [];
  const onSuggested = Boolean(s.field) && r.field === s.field;
  // Réponses hors base retenues pour la variable de la ligne (même règle que le serveur) : jamais comptées.
  const naKept = new Set(keptNaValues(it, field).map((v) => v.toLowerCase()));
  const ds = driftState(it);
  const warnings = it.warnings || [];
  // Sous-tableau reconnu par le catalogue de la fiche (field.repeat) sans avertissement « groupe » du modèle : dit aussi.
  const flags = [...warnings, ...(s.subtable && !warnings.includes('groupe') ? ['groupe'] : [])];
  const agg = it.agg;
  const isPct = agg === 'percent_yes' || agg === 'percent_value';
  return (
    <tr id={rowId(formId, it.code)} className={[checked ? 'is-selected' : '', rowError ? 'has-error' : ''].filter(Boolean).join(' ')}>
      {canEdit && <td className="tpl-check"><input type="checkbox" checked={checked} disabled={!sel.ok}
        aria-label={tr('Inclure « {label} »', { label: it.label })} onChange={(e) => onSet(it.code, { on: e.target.checked })} /></td>}
      <td>
        <strong>{it.label}</strong>
        <div className="site-meta">
          {it.direction === 'lower_better' && <span className="tpl-lower"><ArrowDown size={12} aria-hidden="true" /> {tr('plus bas = mieux')}</span>}
          {/* Mêmes mots que l'éditeur et le détail : indice de conformité (seuls les %) et classes. */}
          {indexStatus({ agg, scored: it.scored }) !== 'in' && <span>{tr(INDEX_STATUS_LABEL[indexStatus({ agg, scored: it.scored })])}</span>}
          {classesStatus({ scored: it.scored }) === 'complementary' && <span>{tr(CLASSES_STATUS_LABEL.complementary)}</span>}
          {it.target != null && <span>{tr('cible {v}', { v: it.target })}</span>}
          {flags.map((w) => (
            <span key={w} className={`tpl-flag ${w === 'groupe' ? 'tpl-flag-info' : 'tpl-flag-warn'}`}>
              {w === 'groupe' ? <Layers size={12} aria-hidden="true" /> : w === 'base' ? <Info size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
              {tr(warningLabel(w))}
            </span>
          ))}
          {issues.map((x) => <span key={x} className="tpl-flag tpl-flag-warn"><AlertTriangle size={12} aria-hidden="true" /> {tr(issueLabel(x))}</span>)}
          {!locked && s.pendingData && !r.field && <span className="tpl-flag tpl-flag-info"><Clock size={12} aria-hidden="true" /> {tr('Option du formulaire : sa colonne arrivera avec l\'import des données')}</span>}
          {!locked && onSuggested && (s.naDropped || []).length > 0 && <span className="tpl-flag tpl-flag-info"><Info size={12} aria-hidden="true" /> {tr('Réponses hors base retirées (absentes de la liste ou « Autre ») : {v}', { v: s.naDropped.join(', ') })}</span>}
          {it.existing && <span className="tpl-done"><CheckCircle2 size={12} aria-hidden="true" /> {tr('créé')}{it.existing.code !== it.code ? ` (${it.existing.code})` : ''}</span>}
          {it.taken && <span className="tpl-flag tpl-flag-warn"><AlertTriangle size={12} aria-hidden="true" /> {tr('code déjà utilisé par « {label} »', { label: it.taken.label })}</span>}
        </div>
        {rowError && <div className="tpl-row-error" role="alert"><XCircle size={14} aria-hidden="true" /> <span>{rowError}</span></div>}
        {/* Refus d'une mise à jour : sur la ligne même quand, après le rechargement, elle n'a plus d'écart
            (indicateur supprimé ailleurs, mise à jour déjà faite dans un autre onglet) — T2 / T5. */}
        {driftError && (
          <div className="tpl-row-error tpl-update-error" role="alert"><XCircle size={14} aria-hidden="true" /> <span>{tr('Mise à jour refusée : {msg}', { msg: driftError })}</span></div>
        )}
        {ds && (
          <div className="tpl-drift">
            {ds.corrections.length > 0 ? (
              <Badge tone={ds.kind === 'definition' ? 'orange' : 'blue'} icon={RefreshCw}>
                {tr(ds.kind === 'definition' ? 'À mettre à jour' : 'Libellé à mettre à jour')}
              </Badge>
            ) : <Badge tone={null} icon={Info}>{tr('Différent du modèle')}</Badge>}
            <span className="muted">{tr(ds.corrections.length > 0 ? 'Créé avant une correction du modèle.' : 'Le plus souvent une modification faite dans la fiche : pour information.')}</span>
            <ul className="tpl-drift-list" aria-label={tr('Modification proposée')}>
              {ds.changes.map((c) => (
                <li key={c.key}>{tr(driftKeyLabel(c.key))} : <span className={CODE_KEYS.has(c.key) ? 'mono' : undefined}>{driftValue(c.key, c.from, tr)}</span> → <span className={CODE_KEYS.has(c.key) ? 'mono' : undefined}>
                  {c.key === 'sourceField' && (c.to == null || ds.blocked) ? blockedTargetText(ds.blocked, tr) : driftValue(c.key, c.to, tr)}</span>
                  {c.origin === 'difference' && ds.corrections.length > 0 && <span className="tpl-diff-tag">{tr('différence')}</span>}</li>
              ))}
            </ul>
            {ds.blocked && <span className="tpl-drift-blocked">{blockedText(ds.blocked, tr)}</span>}
            {canEdit && ds.updatable && (
              <Button size="sm" variant="secondary" icon={RefreshCw} loading={updating === it.code} disabled={Boolean(updating)} onClick={() => onUpdate()}>{tr('Mettre à jour')}</Button>
            )}
            {canEdit && ds.applicable && (
              <Button size="sm" variant="ghost" icon={RefreshCw} loading={updating === it.code} disabled={Boolean(updating)} onClick={() => onUpdate({ full: true })}>{tr('Appliquer le modèle')}</Button>
            )}
          </div>
        )}
      </td>
      <td>
        {edit ? (
          <input className={`input input-sm mono${invalid || rowError ? ' is-invalid' : ''}`} list={`tpl-fields-${formId}`} value={r.field || ''}
            placeholder={tr('— aucune —')} aria-label={tr('Variable pour « {label} »', { label: it.label })}
            onChange={(e) => {
              // Nouvelle variable : la valeur comptée suit SA liste (lib positiveForField), jamais celle de l'ancienne.
              const v = e.target.value.trim();
              onSet(it.code, { field: v, on: Boolean(v) && fieldsByName.has(v), positive: positiveForField(it, fieldsByName.get(v), r.positive) });
            }} />
        ) : <span className="mono">{r.field || '—'}</span>}
        {field?.label && <div className="site-meta tpl-field-label" title={field.label}>{field.label}</div>}
        {invalid && <div className="site-meta text-warn">{tr('Variable inconnue dans cette fiche')}</div>}
      </td>
      <td>
        {!isPct ? <span className="muted">{tr(agg === 'mean' ? 'moyenne' : agg === 'sum' ? 'somme' : 'nombre')}</span>
          : field?.choices?.length && edit ? (
            <select className="select select-sm" value={r.positive || ''} aria-label={tr('Valeur comptée pour « {label} »', { label: it.label })}
              onChange={(e) => onSet(it.code, { positive: e.target.value })}>
              {/* Rien d'affiché qui ne serait pas envoyé : une valeur vide se voit « — à choisir — » (« % = valeur »)
                  ou « par défaut » (« % de oui » : les oui usuels sont comptés, comme dans l'éditeur). */}
              {agg === 'percent_yes' ? <option value="">{tr('— par défaut : 1, oui, yes… —')}</option>
                : !r.positive && <option value="">{tr('— à choisir —')}</option>}
              {r.positive && !field.choices.some((c) => c.value === r.positive) && <option value={r.positive}>{r.positive}</option>}
              {/* Réponses hors base de cette ligne : affichées, jamais choisissables (elles ne seraient jamais comptées). */}
              {field.choices.map((c) => (
                <option key={c.value} value={c.value} disabled={naKept.has(String(c.value).toLowerCase())}>
                  {c.value} — {choiceText(c.label, tr)}{naKept.has(String(c.value).toLowerCase()) ? ` (${tr('hors base')})` : ''}
                </option>
              ))}
            </select>
          ) : edit
            ? <input className="input input-sm mono" value={r.positive || ''} onChange={(e) => onSet(it.code, { positive: e.target.value })} aria-label={tr('Valeur comptée pour « {label} »', { label: it.label })} />
            : <span className="mono">{r.positive || '—'}</span>}
        {edit && sel.reason === 'positive_required' && <div className="site-meta text-warn">{tr('Choisissez la valeur comptée')}</div>}
        {edit && sel.reason === 'positive_not_in_list' && <div className="site-meta text-warn">{tr('Choisissez une valeur de la liste de cette variable')}</div>}
        {edit && sel.reason === 'positive_is_na' && <div className="site-meta text-warn">{tr('Valeur hors base pour cet indicateur : choisissez une autre valeur comptée')}</div>}
        {edit && agg === 'percent_yes' && !String(r.positive || '').trim() && noDefaultYes(field) && (
          <div className="site-meta text-warn">{tr('Aucune réponse de cette liste n\'est un « oui » usuel : choisissez la valeur comptée')}</div>
        )}
      </td>
      <td><Badge tone={conf.tone} icon={ConfIcon}>{tr(conf.label)}</Badge></td>
    </tr>
  );
}
