import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, CheckCircle2, AlertTriangle, Link2, ArrowDown, ChevronDown, ChevronUp, RefreshCw, Layers, Clock } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { choiceText, indexStatus, INDEX_STATUS_LABEL, classesStatus, CLASSES_STATUS_LABEL } from '../../lib/indicatorView.js';
import { DRIFT_KEY_LABEL, driftValue, coveragePct } from '../../lib/templateProposal.js';

// Qualité de la variable proposée : couleur + icône + libellé (jamais la couleur seule).
const CONFIDENCE = {
  sure: { label: 'Trouvée', tone: 'green', icon: CheckCircle2 },
  probable: { label: 'Probable', tone: 'blue', icon: Link2 },
  a_verifier: { label: 'À vérifier', tone: 'orange', icon: AlertTriangle },
};
// Avertissements du modèle (indicatorTemplates.json) et défauts de la liaison (indicatorProposals.bindItem).
const WARNINGS = {
  sens: 'Sens à vérifier',
  groupe: 'Sous-table : disponible après import des sous-tables',
  base: 'Base : toutes les visites (question obligatoire)',
};
const ISSUES = { type: 'Type de variable incompatible avec la méthode', positive: 'Valeur comptée absente de la liste' };
const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'check', label: 'À vérifier' },
  { id: 'missing', label: 'Sans variable' },
  { id: 'update', label: 'À mettre à jour' },
];

/**
 * Modèle d'indicateurs de la fiche (retours n° 12, 66 et 85) : les indicateurs
 * des tableaux de bord de référence, domaine par domaine, avec la variable du
 * formulaire proposée et CONTRÔLÉE pour chacun (type, liste, sous-table : règle
 * du serveur, indicatorProposals). Seuls les éléments sûrs sont cochés d'office ;
 * l'utilisateur vérifie, coche, puis crée les indicateurs en une fois. La carte
 * n'est jamais vide : sans modèle pour l'activité (ou sans activité), elle montre
 * le modèle proposé d'après les variables de la fiche, ou permet d'en choisir un.
 * Un indicateur créé avant une correction du modèle est signalé « à mettre à
 * jour » : la modification proposée passe par la modification habituelle (PATCH).
 */
export default function TemplateBindingCard({ form, canEdit, refreshKey = 0, onApplied }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState(null); // modèle choisi par l'utilisateur (fiche sans modèle d'activité)
  const [rows, setRows] = useState({}); // code → { on, field, positive }
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(null); // code en cours de mise à jour | 'all'
  const [expanded, setExpanded] = useState(null); // null = selon l'état (replié une fois le modèle appliqué)

  async function load(key = chosen) {
    try {
      const r = await api.monTemplate(form.id, key);
      setData(r);
      const init = {};
      for (const it of r.template?.items || []) {
        const s = it.suggestion || {};
        const field = it.existing?.sourceField || s.field || '';
        // Cochés d'office : la règle sûre du serveur (variable trouvée, type et liste vérifiés, hors sous-table).
        init[it.code] = { on: Boolean(s.preselect) && !it.existing && !it.taken, field, positive: it.existing?.positiveValue ?? s.positiveValue ?? '' };
      }
      setRows(init);
    } catch (e) { toast.error(e.message); setData({ template: null, fields: [], proposal: { ranking: [] } }); }
  }
  useEffect(() => { setData(null); setChosen(null); load(null); /* eslint-disable-next-line */ }, [form.id, form.activityCategory]);
  // Indicateur enregistré ou supprimé dans la liste (autre carte) : « déjà créé » / « code pris » rechargés, une fois.
  useEffect(() => { if (refreshKey) load(); /* eslint-disable-next-line */ }, [refreshKey]);

  const fieldsByName = useMemo(() => new Map((data?.fields || []).map((f) => [f.name, f])), [data]);
  const items = data?.template?.items || [];
  const counts = useMemo(() => {
    const c = { sure: 0, probable: 0, a_verifier: 0, none: 0, existing: 0, taken: 0, on: 0, drift: 0 };
    for (const it of items) {
      c[it.suggestion?.confidence || 'none'] += 1;
      if (it.existing) c.existing += 1;
      if (it.existing?.drift) c.drift += 1;
      if (it.taken) c.taken += 1;
      const r = rows[it.code];
      if (r?.on && !it.existing && !it.taken && r.field && fieldsByName.has(r.field)) c.on += 1;
    }
    return c;
  }, [items, rows, fieldsByName]);

  if (data === null) return <Card><div className="card-body"><Skeleton height={140} /></div></Card>;

  const ranking = data.proposal?.ranking || [];
  const choose = (key) => { setChosen(key || null); setData(null); load(key || null); };
  // Choix d'un autre modèle : seulement quand l'activité rattachée n'en impose pas un.
  const picker = data.source !== 'activity' && ranking.length > 0 && (
    <label className="tpl-picker">
      <span>{tr('Modèle')}</span>
      <select className="select select-sm" value={data.template?.key || ''} onChange={(e) => choose(e.target.value)}>
        {!data.template && <option value="">{tr('— choisir un modèle —')}</option>}
        {ranking.map((r) => (
          <option key={r.key} value={r.key}>{tr('{label} ({p} %)', { label: r.label, p: coveragePct(r.coverage) })}</option>
        ))}
      </select>
    </label>
  );

  if (!data.template) {
    return (
      <Card aria-labelledby="tpl-title">
        <CardHeader id="tpl-title" title={tr('Modèle d\'indicateurs')}>{picker}</CardHeader>
        <div className="card-body">
          <Alert tone="info" icon={Sparkles}>
            {form.activityCategory
              ? tr('L\'activité « {a} » n\'a pas de modèle d\'indicateurs, et aucun modèle ne correspond aux variables de cette fiche.', { a: form.activityCategory })
              : tr('Aucun modèle d\'indicateurs ne correspond aux variables de cette fiche.')}
            {' '}{tr('Choisissez un modèle ci-dessus, ou créez les indicateurs un par un (« Nouvel indicateur »).')}
          </Alert>
        </div>
      </Card>
    );
  }

  const shown = items.filter((it) => {
    if (filter === 'check') return it.suggestion?.confidence === 'a_verifier' || (it.suggestion?.issues || []).length > 0 || (rows[it.code]?.field && !fieldsByName.has(rows[it.code].field));
    if (filter === 'missing') return !rows[it.code]?.field;
    if (filter === 'update') return Boolean(it.existing?.drift);
    return true;
  });
  const byDomain = [];
  for (const it of shown) {
    const last = byDomain[byDomain.length - 1];
    if (last && last.module === it.module) last.items.push(it); else byDomain.push({ module: it.module, items: [it] });
  }
  const set = (code, patch) => setRows((r) => ({ ...r, [code]: { ...r[code], ...patch } }));
  // Modèle hors activité (proposé ou choisi) : la création vise CE modèle.
  const templateParam = data.source === 'activity' ? null : data.template.key;

  async function apply() {
    const payload = items.filter((it) => !it.existing && !it.taken && rows[it.code]?.on && rows[it.code].field && fieldsByName.has(rows[it.code].field))
      .map((it) => ({ code: it.code, sourceField: rows[it.code].field, positiveValue: rows[it.code].positive === '' ? null : rows[it.code].positive }));
    if (!payload.length) return;
    setSaving(true);
    try {
      const r = await api.monApplyTemplate(form.id, payload, { template: templateParam });
      toast.success(tr('{n} indicateur(s) créé(s) depuis le modèle « {label} ».', { n: formatInt(r.applied), label: data.template.label }));
      if (r.conflicts) toast.error(tr('{n} indicateur(s) non créé(s) : leur code est déjà utilisé par un indicateur de la fiche.', { n: formatInt(r.conflicts) }));
      await load();
      onApplied?.();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  // Mise à jour d'un indicateur créé avant une correction du modèle : la modification habituelle (PATCH, mêmes contrôles).
  const updatable = (it) => it.existing?.drift && Object.keys(it.existing.drift.patch || {}).length > 0;
  async function update(list) {
    setUpdating(list.length === 1 ? list[0].code : 'all');
    let done = 0;
    try {
      for (const it of list) {
        await api.monUpdateIndicator(it.existing.id, it.existing.drift.patch); // l'une après l'autre : chaque PATCH est contrôlé seul
        done += 1;
      }
      toast.success(tr('{n} indicateur(s) mis à jour selon le modèle.', { n: formatInt(done) }));
    } catch (e) { toast.error(e.message); }
    finally { setUpdating(null); await load(); onApplied?.(); }
  }

  const driftItems = items.filter(updatable);
  const remaining = items.filter((it) => !it.existing && !it.taken).length;
  const open = expanded ?? (counts.existing === 0 || counts.drift > 0);
  const title = data.source === 'activity' ? tr('Modèle de l\'activité : {label}', { label: data.template.label })
    : data.source === 'proposal' ? tr('Modèle proposé : {label}', { label: data.template.label })
      : tr('Modèle choisi : {label}', { label: data.template.label });
  const best = data.proposal?.best;
  const sourceNote = data.source === 'proposal' ? (
    <Alert tone="info" icon={Sparkles}>
      {tr('Modèle proposé d\'après les variables de la fiche : {p} % de ses éléments y sont trouvés.', { p: coveragePct(best?.coverage) })}
      {' '}{form.activityCategory
        ? tr('L\'activité « {a} » n\'a pas de modèle d\'indicateurs.', { a: form.activityCategory })
        : tr('La fiche n\'est rattachée à aucune activité : les indicateurs n\'en dépendent pas, la couverture et le plan de suivi si (« Modifier la fiche »).')}
    </Alert>
  ) : data.source === 'chosen' ? (
    <Alert tone="info" icon={Sparkles}>{tr('Modèle choisi : « {label} ».', { label: data.template.label })}</Alert>
  ) : null;
  const driftNote = counts.drift > 0 && (
    <Alert tone="warning" icon={RefreshCw}>
      {tr('{n} indicateur(s) créé(s) avant une correction du modèle : leur définition diffère de celle du modèle (rien n\'a été modifié).', { n: formatInt(counts.drift) })}
      {canEdit && driftItems.length > 0 && <>{' '}<Button size="sm" variant="secondary" icon={RefreshCw} loading={updating === 'all'} onClick={() => update(driftItems)}>
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

  return (
    <Card aria-labelledby="tpl-title">
      <CardHeader id="tpl-title" title={title}
        subtitle={tr('Les indicateurs de vos tableaux de bord de référence, domaine par domaine. Pour chacun, la variable du formulaire est proposée : vérifiez-la, cochez, puis créez les indicateurs. Les indicateurs déjà créés ne sont pas modifiés : modifiez-les dans la liste des indicateurs.')}>
        {picker}
        {counts.existing > 0 && <Button variant="ghost" icon={ChevronUp} onClick={() => setExpanded(false)}>{tr('Replier')}</Button>}
        {canEdit && counts.on > 0 && <Button icon={CheckCircle2} loading={saving} onClick={apply}>{tr('Créer {n} indicateur(s)', { n: formatInt(counts.on) })}</Button>}
      </CardHeader>
      {(sourceNote || driftNote) && <div className="card-body section-gap tpl-notes">{sourceNote}{driftNote}</div>}
      <div className="card-body tpl-head">
        <div className="tpl-counts">
          <span><Badge tone="green" icon={CheckCircle2}>{tr('Trouvée')}</Badge> {formatInt(counts.sure)}</span>
          <span><Badge tone="blue" icon={Link2}>{tr('Probable')}</Badge> {formatInt(counts.probable)}</span>
          <span><Badge tone="orange" icon={AlertTriangle}>{tr('À vérifier')}</Badge> {formatInt(counts.a_verifier)}</span>
          <span><Badge tone={null}>{tr('Sans variable')}</Badge> {formatInt(counts.none)}</span>
          {data.summary?.subtable > 0 && <span><Badge tone={null} icon={Layers}>{tr('Sous-table')}</Badge> {formatInt(data.summary.subtable)}</span>}
          {counts.existing > 0 && <span className="muted">{tr('{n} déjà créé(s)', { n: formatInt(counts.existing) })}</span>}
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
            {byDomain.map((g) => (
              <React.Fragment key={g.module}>
                <tr className="tpl-domain"><th colSpan={canEdit ? 5 : 4} scope="colgroup">{g.module}</th></tr>
                {g.items.map((it) => {
                  const r = rows[it.code] || {};
                  const field = fieldsByName.get(r.field);
                  const invalid = r.field && !field;
                  const conf = CONFIDENCE[it.suggestion?.confidence];
                  const ConfIcon = conf?.icon;
                  const s = it.suggestion || {};
                  const drift = it.existing?.drift;
                  // Déjà créé (ou code pris) : le modèle ne le modifie pas — il se modifie dans la liste des indicateurs.
                  const locked = Boolean(it.existing || it.taken);
                  const edit = canEdit && !locked;
                  return (
                    <tr key={it.code} className={r.on ? 'is-selected' : ''}>
                      {canEdit && <td className="tpl-check"><input type="checkbox" checked={Boolean(r.on) && !locked} disabled={locked || !r.field || invalid}
                        aria-label={tr('Inclure « {label} »', { label: it.label })} onChange={(e) => set(it.code, { on: e.target.checked })} /></td>}
                      <td>
                        <strong>{it.label}</strong>
                        <div className="site-meta">
                          {it.direction === 'lower_better' && <span className="tpl-lower"><ArrowDown size={12} aria-hidden="true" /> {tr('plus bas = mieux')}</span>}
                          {/* Mêmes mots que l'éditeur et le détail : indice de conformité (seuls les %) et classes. */}
                          {indexStatus({ agg: it.agg, scored: it.scored }) !== 'in' && <span>{tr(INDEX_STATUS_LABEL[indexStatus({ agg: it.agg, scored: it.scored })])}</span>}
                          {classesStatus({ scored: it.scored }) === 'complementary' && <span>{tr(CLASSES_STATUS_LABEL.complementary)}</span>}
                          {it.target != null && <span>{tr('cible {v}', { v: it.target })}</span>}
                          {(it.warnings || []).map((w) => <span key={w} className="text-warn">{tr(WARNINGS[w] || w)}</span>)}
                          {!locked && (s.issues || []).map((x) => <span key={x} className="text-warn">{tr(ISSUES[x] || x)}</span>)}
                          {!locked && s.pendingData && <span className="text-warn"><Clock size={12} aria-hidden="true" /> {tr('Option : disponible après l\'import des données')}</span>}
                          {it.existing && <span className="tpl-done"><CheckCircle2 size={12} aria-hidden="true" /> {tr('créé')}{it.existing.code !== it.code ? ` (${it.existing.code})` : ''}</span>}
                          {it.taken && <span className="text-warn">{tr('code déjà utilisé par « {label} »', { label: it.taken.label })}</span>}
                        </div>
                        {drift && (
                          <div className="tpl-drift">
                            <Badge tone={drift.kind === 'definition' ? 'orange' : 'blue'} icon={RefreshCw}>
                              {tr(drift.kind === 'definition' ? 'À mettre à jour' : 'Libellé corrigé')}
                            </Badge>
                            <span className="muted">{tr(drift.former ? 'Le modèle a été corrigé depuis sa création.' : 'Différent du modèle actuel.')}</span>
                            <ul className="tpl-drift-list">
                              {drift.changes.map((c) => (
                                <li key={c.key}>{tr(DRIFT_KEY_LABEL[c.key] || c.key)} : <span className="mono">{driftValue(c.key, c.from, tr)}</span> → <span className="mono">{c.to == null && c.key === 'sourceField' ? tr('variable du modèle absente des données') : driftValue(c.key, c.to, tr)}</span></li>
                              ))}
                            </ul>
                            {canEdit && updatable(it) && (
                              <Button size="sm" variant="secondary" icon={RefreshCw} loading={updating === it.code} disabled={Boolean(updating)}
                                onClick={() => update([it])}>{tr('Mettre à jour')}</Button>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        {edit ? (
                          <input className={`input input-sm mono${invalid ? ' is-invalid' : ''}`} list={`tpl-fields-${form.id}`} value={r.field || ''}
                            placeholder={tr('— aucune —')} aria-label={tr('Variable pour « {label} »', { label: it.label })}
                            onChange={(e) => set(it.code, { field: e.target.value.trim(), on: Boolean(e.target.value.trim()) && fieldsByName.has(e.target.value.trim()) })} />
                        ) : <span className="mono">{r.field || '—'}</span>}
                        {field?.label && <div className="site-meta tpl-field-label" title={field.label}>{field.label}</div>}
                        {invalid && <div className="site-meta text-warn">{tr('Variable inconnue dans cette fiche')}</div>}
                      </td>
                      <td>
                        {it.agg === 'mean' || it.agg === 'sum' || it.agg === 'count' ? <span className="muted">{tr(it.agg === 'mean' ? 'moyenne' : it.agg === 'sum' ? 'somme' : 'nombre')}</span>
                          : field?.choices?.length && edit ? (
                            <select className="select select-sm" value={r.positive || ''} aria-label={tr('Valeur comptée pour « {label} »', { label: it.label })}
                              onChange={(e) => set(it.code, { positive: e.target.value })}>
                              {!field.choices.some((c) => c.value === r.positive) && r.positive && <option value={r.positive}>{r.positive}</option>}
                              {field.choices.map((c) => <option key={c.value} value={c.value}>{c.value} — {choiceText(c.label, tr)}</option>)}
                            </select>
                          ) : edit
                            ? <input className="input input-sm mono" value={r.positive || ''} onChange={(e) => set(it.code, { positive: e.target.value })} aria-label={tr('Valeur comptée pour « {label} »', { label: it.label })} />
                            : <span className="mono">{r.positive || '—'}</span>}
                      </td>
                      <td>{conf ? <Badge tone={conf.tone} icon={ConfIcon}>{tr(conf.label)}</Badge> : <span className="muted">{tr('aucune')}</span>}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
