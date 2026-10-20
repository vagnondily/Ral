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
  AGG_LABEL, CONFIDENCE, NO_CONFIDENCE, WARNING_LABEL, warningLabel, issueLabel, typeText, driftKeyLabel, driftValue, driftState,
  coveragePct, initialRows, rowSelectable, isChecked, checkedPayload, itemError,
} from '../../lib/templateProposal.js';
import './templates.css';

// Qualité de la variable proposée : couleur + icône + libellé (jamais la couleur seule).
const CONF_ICON = { check: CheckCircle2, link: Link2, warn: AlertTriangle, none: MinusCircle };
const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'check', label: 'À vérifier' },
  { id: 'missing', label: 'Sans variable' },
  { id: 'update', label: 'À mettre à jour' },
];
const rowId = (formId, code) => `tpl-row-${formId}-${code}`;

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
 * @param {{ form, canEdit, refreshKey?, onApplied?, onAttach?: () => void }} props
 *   onAttach : ouvre « Rattacher à une activité » de la fiche (absent = lecture seule).
 */
export default function TemplateBindingCard({ form, canEdit, refreshKey = 0, onApplied, onAttach }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState(null); // modèle choisi par l'utilisateur (fiche sans modèle d'activité)
  const [rows, setRows] = useState({}); // code → { on, field, positive }
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(null); // code en cours de mise à jour | 'all'
  const [expanded, setExpanded] = useState(null); // null = selon l'état (replié une fois le modèle appliqué)
  const [rowErrors, setRowErrors] = useState({}); // code → refus de « Créer » qui nomme l'élément
  const [driftErrors, setDriftErrors] = useState({}); // code → refus de la mise à jour (PATCH)
  const [applyError, setApplyError] = useState(null);

  async function load(key = chosen) {
    try {
      const r = await api.monTemplate(form.id, key);
      setData(r);
      setRows(initialRows(r.template?.items));
    } catch (e) {
      // Modèle choisi refusé (l'activité a changé entre-temps) : retour au modèle de la fiche.
      if (key && e.status === 400) { setChosen(null); await load(null); return; }
      toast.error(e.message);
      setData({ failed: e.message, template: null, fields: [], proposal: { ranking: [] } });
    }
  }
  useEffect(() => {
    setData(null); setChosen(null); setRowErrors({}); setDriftErrors({}); setApplyError(null);
    load(null);
    /* eslint-disable-next-line */
  }, [form.id, form.activityCategory]);
  // Indicateur enregistré ou supprimé dans la liste (autre carte) : « déjà créé » / « code pris » rechargés, une fois.
  useEffect(() => { if (refreshKey) load(); /* eslint-disable-next-line */ }, [refreshKey]);

  const fieldsByName = useMemo(() => new Map((data?.fields || []).map((f) => [f.name, f])), [data]);
  const fieldNames = useMemo(() => new Set(fieldsByName.keys()), [fieldsByName]);
  const items = useMemo(() => data?.template?.items || [], [data]);
  const counts = useMemo(() => {
    const c = { sure: 0, probable: 0, a_verifier: 0, none: 0, existing: 0, taken: 0, checked: 0, drift: 0 };
    for (const it of items) {
      c[it.suggestion?.confidence || 'none'] += 1;
      if (it.existing) c.existing += 1;
      if (it.existing?.drift) c.drift += 1;
      if (it.taken) c.taken += 1;
      if (isChecked(it, rows[it.code], fieldNames)) c.checked += 1;
    }
    return c;
  }, [items, rows, fieldNames]);

  if (data === null) return <Card><div className="card-body"><Skeleton height={140} /></div></Card>;

  if (data.failed) {
    return (
      <Card aria-labelledby="tpl-title">
        <CardHeader id="tpl-title" title={tr('Modèle d\'indicateurs')} />
        <div className="card-body">
          <Alert tone="error" icon={XCircle}>
            {tr('Le modèle d\'indicateurs n\'a pas pu être chargé : {msg}', { msg: data.failed })}
            {' '}<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => { setData(null); load(null); }}>{tr('Réessayer')}</Button>
          </Alert>
        </div>
      </Card>
    );
  }

  const ranking = data.proposal?.ranking || [];
  const best = data.proposal?.best || null;
  const choose = (key) => { setChosen(key || null); setData(null); setRowErrors({}); setApplyError(null); load(key || null); };
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

  const shown = items.filter((it) => {
    const s = it.suggestion || {};
    const r = rows[it.code] || {};
    if (filter === 'check') {
      return s.confidence === 'a_verifier' || (!it.existing && (s.issues || []).length > 0) || (r.field && !fieldNames.has(r.field))
        || (it.warnings || []).some((w) => w === 'sens' || w === 'base') || Boolean(rowErrors[it.code]);
    }
    if (filter === 'missing') return !r.field;
    if (filter === 'update') return Boolean(it.existing?.drift);
    return true;
  });
  const byDomain = [];
  for (const it of shown) {
    const last = byDomain[byDomain.length - 1];
    if (last && last.module === it.module) last.items.push(it); else byDomain.push({ module: it.module, items: [it] });
  }
  const hiddenChecked = counts.checked - shown.filter((it) => isChecked(it, rows[it.code], fieldNames)).length;
  const set = (code, patch) => {
    setRows((r) => ({ ...r, [code]: { ...r[code], ...patch } }));
    if (rowErrors[code]) setRowErrors((e) => { const n = { ...e }; delete n[code]; return n; });
  };
  // Modèle hors activité (proposé ou choisi) : la création vise CE modèle.
  const templateParam = data.source === 'activity' ? null : data.template.key;

  async function apply() {
    const payload = checkedPayload(items, rows, fieldNames);
    if (!payload.length) return;
    setSaving(true); setRowErrors({}); setApplyError(null);
    try {
      const r = await api.monApplyTemplate(form.id, payload, { template: templateParam });
      toast.success(tr('{n} indicateur(s) créé(s) depuis le modèle « {label} ».', { n: formatInt(r.applied), label: data.template.label }));
      if (r.conflicts) toast.error(tr('{n} indicateur(s) non créé(s) : leur code est déjà utilisé par un indicateur de la fiche.', { n: formatInt(r.conflicts) }));
      await load();
      onApplied?.();
    } catch (e) {
      const ie = itemError(e);
      const target = ie && items.find((it) => it.code === ie.item);
      if (target) {
        // Refus qui nomme l'élément (type de variable incompatible) : le motif sur SA ligne, rien n'a été créé.
        const msg = ie.code === 'type_mismatch'
          ? tr('La variable « {field} » ({type}) ne convient pas à la méthode « {agg} » de cet indicateur : choisissez une autre variable.', {
            field: ie.field || rows[ie.item]?.field || '—', type: typeText(ie.type, tr), agg: AGG_LABEL[ie.agg] ? tr(AGG_LABEL[ie.agg]) : (ie.agg || '—'),
          })
          : e.message;
        setRowErrors({ [ie.item]: msg });
        setApplyError(tr('Rien n\'a été créé : « {label} » est à corriger (ligne signalée ci-dessous).', { label: target.label }));
        setFilter('all');
        setTimeout(() => document.getElementById(rowId(form.id, ie.item))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
      } else {
        setApplyError(e.message);
        toast.error(e.message);
      }
    } finally { setSaving(false); }
  }

  // Mise à jour d'un indicateur créé avant une correction du modèle : la modification habituelle
  // (PATCH, mêmes contrôles), l'une après l'autre ; chaque refus est gardé sur sa ligne.
  async function update(list) {
    setUpdating(list.length === 1 ? list[0].code : 'all');
    const errors = {};
    let done = 0;
    for (const it of list) {
      try {
        await api.monUpdateIndicator(it.existing.id, driftState(it).patch); // une après l'autre : chaque PATCH est contrôlé seul
        done += 1;
      } catch (e) { errors[it.code] = e.message; }
    }
    const failed = Object.keys(errors).length;
    setDriftErrors((prev) => {
      const next = { ...prev };
      for (const it of list) delete next[it.code];
      return { ...next, ...errors };
    });
    if (done) toast.success(tr('{n} indicateur(s) mis à jour selon le modèle.', { n: formatInt(done) }));
    if (failed) {
      toast.error(tr('{n} mise(s) à jour refusée(s) : le motif est affiché sur la ligne.', { n: formatInt(failed) }));
      setExpanded(true); setFilter('update');
    }
    setUpdating(null);
    if (done) { await load(); onApplied?.(); }
  }

  const driftItems = items.filter((it) => driftState(it)?.updatable);
  const remaining = items.filter((it) => !it.existing && !it.taken).length;
  const open = expanded ?? (counts.existing === 0 || counts.drift > 0);
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
  const driftNote = counts.drift > 0 && (
    <Alert tone="warning" icon={RefreshCw}>
      {tr('{n} indicateur(s) créé(s) avant une correction du modèle : leur définition diffère de celle du modèle. Rien n\'a été modifié ; la modification proposée est affichée sur chaque ligne.', { n: formatInt(counts.drift) })}
      {canEdit && driftItems.length > 0 && <>{' '}<Button size="sm" variant="secondary" icon={RefreshCw} loading={updating === 'all'} disabled={Boolean(updating)} onClick={() => update(driftItems)}>
        {tr('Tout mettre à jour ({n})', { n: formatInt(driftItems.length) })}</Button></>}
      {' '}<button type="button" className="inline-link" onClick={() => { setExpanded(true); setFilter('update'); }}>{tr('Voir lesquels')}</button>
    </Alert>
  );

  if (!open) {
    return (
      <Card aria-labelledby="tpl-title">
        <CardHeader id="tpl-title" title={title}
          subtitle={tr('{n} indicateur(s) du modèle sur {t} déjà créé(s) ; {r} restant(s). Les indicateurs déjà créés ne sont pas modifiés par le modèle : modifiez-les dans la liste des indicateurs.', {
            n: formatInt(counts.existing), t: formatInt(items.length), r: formatInt(remaining),
          })}>
          <Button variant="secondary" icon={ChevronDown} onClick={() => setExpanded(true)}>{tr('Afficher le modèle')}</Button>
        </CardHeader>
      </Card>
    );
  }

  const summary = data.summary || {};
  return (
    <Card aria-labelledby="tpl-title">
      <CardHeader id="tpl-title" title={title}
        subtitle={tr('Les indicateurs de vos tableaux de bord de référence, domaine par domaine, avec la variable du formulaire proposée pour chacun. Seules les variables trouvées et vérifiées (type, liste de choix, hors sous-tableau) sont cochées d\'office : vérifiez, cochez, puis créez. Un indicateur déjà créé n\'est jamais modifié par le modèle.')}>
        {counts.existing > 0 && <Button variant="ghost" icon={ChevronUp} onClick={() => setExpanded(false)}>{tr('Replier')}</Button>}
        {canEdit && counts.checked > 0 && <Button icon={CheckCircle2} loading={saving} onClick={apply}>{tr('Créer {n} indicateur(s)', { n: formatInt(counts.checked) })}</Button>}
      </CardHeader>
      {(sourceNote || driftNote || applyError) && (
        <div className="card-body section-gap tpl-notes">
          {applyError && <Alert tone="error" icon={XCircle}>{applyError}</Alert>}
          {sourceNote}{driftNote}
        </div>
      )}
      <div className="card-body tpl-head">
        <div className="tpl-counts">
          {['sure', 'probable', 'a_verifier'].map((k) => {
            const Icon = CONF_ICON[CONFIDENCE[k].icon];
            return <span key={k}><Badge tone={CONFIDENCE[k].tone} icon={Icon}>{tr(CONFIDENCE[k].label)}</Badge> {formatInt(counts[k])}</span>;
          })}
          <span><Badge tone={null} icon={MinusCircle}>{tr(NO_CONFIDENCE.label)}</Badge> {formatInt(counts.none)}</span>
          {summary.subtable > 0 && <span title={tr(WARNING_LABEL.groupe)}><Badge tone={null} icon={Layers}>{tr('Sous-tableau')}</Badge> {formatInt(summary.subtable)}</span>}
          {summary.pendingData > 0 && <span><Badge tone={null} icon={Clock}>{tr('En attente des données')}</Badge> {formatInt(summary.pendingData)}</span>}
          {counts.existing > 0 && <span className="muted">{tr('{n} déjà créé(s)', { n: formatInt(counts.existing) })}</span>}
          {hiddenChecked > 0 && <span className="tpl-hidden-checked">{tr('{n} coché(s) masqué(s) par le filtre (créés aussi)', { n: formatInt(hiddenChecked) })}</span>}
        </div>
        <div className="segmented" role="group" aria-label={tr('Filtrer')}>
          {FILTERS.filter((f) => f.id !== 'update' || counts.drift > 0).map((f) => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{tr(f.label)}</button>)}
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
                  <TemplateRow key={it.code} it={it} formId={form.id} row={rows[it.code] || {}} field={fieldsByName.get(rows[it.code]?.field)}
                    fieldNames={fieldNames} canEdit={canEdit} rowError={rowErrors[it.code]} driftError={driftErrors[it.code]}
                    updating={updating} onSet={set} onUpdate={() => update([it])} />
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
function TemplateRow({ it, formId, row: r, field, fieldNames, canEdit, rowError, driftError, updating, onSet, onUpdate }) {
  const { tr } = useI18n();
  const s = it.suggestion || {};
  const conf = CONFIDENCE[s.confidence] || NO_CONFIDENCE;
  const ConfIcon = CONF_ICON[conf.icon];
  // Déjà créé (ou code pris) : le modèle ne le modifie pas — il se modifie dans la liste des indicateurs.
  const locked = Boolean(it.existing || it.taken);
  const edit = canEdit && !locked;
  const sel = rowSelectable(it, r, fieldNames);
  const checked = Boolean(r.on) && sel.ok;
  const invalid = sel.reason === 'unknown_field';
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
          {!locked && (s.issues || []).map((x) => <span key={x} className="tpl-flag tpl-flag-warn"><AlertTriangle size={12} aria-hidden="true" /> {tr(issueLabel(x))}</span>)}
          {!locked && s.pendingData && <span className="tpl-flag tpl-flag-info"><Clock size={12} aria-hidden="true" /> {tr('Option du formulaire : sa colonne arrivera avec l\'import des données')}</span>}
          {!locked && (s.naDropped || []).length > 0 && <span className="tpl-flag tpl-flag-info"><Info size={12} aria-hidden="true" /> {tr('Réponses hors base retirées (absentes de la liste ou « Autre ») : {v}', { v: s.naDropped.join(', ') })}</span>}
          {it.existing && <span className="tpl-done"><CheckCircle2 size={12} aria-hidden="true" /> {tr('créé')}{it.existing.code !== it.code ? ` (${it.existing.code})` : ''}</span>}
          {it.taken && <span className="tpl-flag tpl-flag-warn"><AlertTriangle size={12} aria-hidden="true" /> {tr('code déjà utilisé par « {label} »', { label: it.taken.label })}</span>}
        </div>
        {rowError && <div className="tpl-row-error" role="alert"><XCircle size={14} aria-hidden="true" /> <span>{rowError}</span></div>}
        {ds && (
          <div className="tpl-drift">
            <Badge tone={ds.kind === 'definition' ? 'orange' : 'blue'} icon={RefreshCw}>
              {tr(ds.kind === 'definition' ? 'À mettre à jour' : 'Libellé à mettre à jour')}
            </Badge>
            <span className="muted">{tr(ds.former ? 'Créé avant une correction du modèle.' : 'Différent du modèle actuel.')}</span>
            <ul className="tpl-drift-list" aria-label={tr('Modification proposée')}>
              {ds.changes.map((c) => (
                <li key={c.key}>{tr(driftKeyLabel(c.key))} : <span className="mono">{driftValue(c.key, c.from, tr)}</span> → <span className="mono">
                  {c.key === 'sourceField' && c.to == null
                    ? tr('{v} (pas encore dans cette fiche)', { v: (it.variables || [])[0] || '—' })
                    : driftValue(c.key, c.to, tr)}</span></li>
              ))}
            </ul>
            {ds.blocked && (
              <span className="tpl-drift-blocked">{tr('La variable du modèle n\'est pas encore dans cette fiche : la mise à jour sera proposée après l\'import de ses données. D\'ici là, modifiez l\'indicateur à la main si besoin (liste des indicateurs).')}</span>
            )}
            {canEdit && ds.updatable && (
              <Button size="sm" variant="secondary" icon={RefreshCw} loading={updating === it.code} disabled={Boolean(updating)} onClick={onUpdate}>{tr('Mettre à jour')}</Button>
            )}
            {driftError && <div className="tpl-row-error" role="alert"><XCircle size={14} aria-hidden="true" /> <span>{tr('Mise à jour refusée : {msg}', { msg: driftError })}</span></div>}
          </div>
        )}
      </td>
      <td>
        {edit ? (
          <input className={`input input-sm mono${invalid || rowError ? ' is-invalid' : ''}`} list={`tpl-fields-${formId}`} value={r.field || ''}
            placeholder={tr('— aucune —')} aria-label={tr('Variable pour « {label} »', { label: it.label })}
            onChange={(e) => { const v = e.target.value.trim(); onSet(it.code, { field: v, on: Boolean(v) && fieldNames.has(v) }); }} />
        ) : <span className="mono">{r.field || '—'}</span>}
        {field?.label && <div className="site-meta tpl-field-label" title={field.label}>{field.label}</div>}
        {invalid && <div className="site-meta text-warn">{tr('Variable inconnue dans cette fiche')}</div>}
      </td>
      <td>
        {!isPct ? <span className="muted">{tr(agg === 'mean' ? 'moyenne' : agg === 'sum' ? 'somme' : 'nombre')}</span>
          : field?.choices?.length && edit ? (
            <select className="select select-sm" value={r.positive || ''} aria-label={tr('Valeur comptée pour « {label} »', { label: it.label })}
              onChange={(e) => onSet(it.code, { positive: e.target.value })}>
              {/* Rien d'affiché qui ne serait pas envoyé : une valeur vide se voit « — à choisir — ». */}
              {!r.positive && <option value="">{tr('— à choisir —')}</option>}
              {r.positive && !field.choices.some((c) => c.value === r.positive) && <option value={r.positive}>{r.positive}</option>}
              {field.choices.map((c) => <option key={c.value} value={c.value}>{c.value} — {choiceText(c.label, tr)}</option>)}
            </select>
          ) : edit
            ? <input className="input input-sm mono" value={r.positive || ''} onChange={(e) => onSet(it.code, { positive: e.target.value })} aria-label={tr('Valeur comptée pour « {label} »', { label: it.label })} />
            : <span className="mono">{r.positive || '—'}</span>}
        {edit && sel.reason === 'positive_required' && <div className="site-meta text-warn">{tr('Choisissez la valeur comptée')}</div>}
      </td>
      <td><Badge tone={conf.tone} icon={ConfIcon}>{tr(conf.label)}</Badge></td>
    </tr>
  );
}
