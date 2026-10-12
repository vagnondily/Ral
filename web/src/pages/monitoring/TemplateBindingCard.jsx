import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, CheckCircle2, AlertTriangle, Link2, ArrowDown } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';

// Qualité de la variable proposée : couleur + icône + libellé (jamais la couleur seule).
const CONFIDENCE = {
  sure: { label: 'Trouvée', tone: 'green', icon: CheckCircle2 },
  probable: { label: 'Probable', tone: 'blue', icon: Link2 },
  a_verifier: { label: 'À vérifier', tone: 'orange', icon: AlertTriangle },
};
const WARNINGS = { sens: 'Sens à vérifier', groupe: 'Sous-table non importée', ratio: 'Moyenne × 100' };
const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'check', label: 'À vérifier' },
  { id: 'missing', label: 'Sans variable' },
];

/**
 * Modèle d'indicateurs de l'activité de la fiche (retour n° 12) : les
 * indicateurs des tableaux de bord de référence, domaine par domaine, avec la
 * variable du formulaire proposée pour chacun. L'utilisateur vérifie, coche,
 * puis crée les indicateurs en une fois ; ils alimentent ensuite la Synthèse,
 * Couverture & performance et le concepteur de rapport. Rien n'est créé sans lui.
 */
export default function TemplateBindingCard({ form, canEdit, onApplied }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState({}); // code → { on, field, positive }
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await api.monTemplate(form.id);
      setData(r);
      const init = {};
      for (const it of r.template?.items || []) {
        const s = it.suggestion || {};
        const field = it.existing?.sourceField || s.field || '';
        // Cochés d'office : variable trouvée ou probable, pas encore créés. « À vérifier » : à cocher soi-même.
        init[it.code] = { on: Boolean(field) && !it.existing && (s.confidence === 'sure' || s.confidence === 'probable'), field, positive: it.existing?.positiveValue ?? s.positiveValue ?? '' };
      }
      setRows(init);
    } catch (e) { toast.error(e.message); setData({ template: null, fields: [] }); }
  }
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line */ }, [form.id, form.activityCategory]);

  const fieldsByName = useMemo(() => new Map((data?.fields || []).map((f) => [f.name, f])), [data]);
  const items = data?.template?.items || [];
  const counts = useMemo(() => {
    const c = { sure: 0, probable: 0, a_verifier: 0, none: 0, existing: 0, on: 0 };
    for (const it of items) {
      c[it.suggestion?.confidence || 'none'] += 1;
      if (it.existing) c.existing += 1;
      const r = rows[it.code];
      if (r?.on && r.field && fieldsByName.has(r.field)) c.on += 1;
    }
    return c;
  }, [items, rows, fieldsByName]);

  if (data === null) return <Card><div className="card-body"><Skeleton height={140} /></div></Card>;
  if (!data.template) {
    return form.activityCategory ? null : (
      <Alert tone="info" icon={Sparkles}>{tr('Rattachez la fiche à une activité pour profiter de son modèle d\'indicateurs (variables proposées automatiquement).')}</Alert>
    );
  }

  const shown = items.filter((it) => {
    if (filter === 'check') return it.suggestion?.confidence === 'a_verifier' || (rows[it.code]?.field && !fieldsByName.has(rows[it.code].field));
    if (filter === 'missing') return !rows[it.code]?.field;
    return true;
  });
  const byDomain = [];
  for (const it of shown) {
    const last = byDomain[byDomain.length - 1];
    if (last && last.module === it.module) last.items.push(it); else byDomain.push({ module: it.module, items: [it] });
  }
  const set = (code, patch) => setRows((r) => ({ ...r, [code]: { ...r[code], ...patch } }));

  async function apply() {
    const payload = items.filter((it) => rows[it.code]?.on && rows[it.code].field && fieldsByName.has(rows[it.code].field))
      .map((it) => ({ code: it.code, sourceField: rows[it.code].field, positiveValue: rows[it.code].positive === '' ? null : rows[it.code].positive }));
    if (!payload.length) return;
    setSaving(true);
    try {
      const r = await api.monApplyTemplate(form.id, payload);
      toast.success(tr('{n} indicateur(s) créé(s) ou mis à jour depuis le modèle « {label} ».', { n: formatInt(r.applied), label: data.template.label }));
      await load();
      onApplied?.();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Card aria-labelledby="tpl-title">
      <CardHeader id="tpl-title" title={tr('Modèle de l\'activité : {label}', { label: data.template.label })}
        subtitle={tr('Les indicateurs de vos tableaux de bord de référence, domaine par domaine. Pour chacun, la variable du formulaire est proposée : vérifiez-la, cochez, puis créez les indicateurs. Ils alimentent ensuite la Synthèse, Couverture & performance et les rapports.')}>
        {canEdit && <Button icon={CheckCircle2} loading={saving} disabled={!counts.on} onClick={apply}>{tr('Créer {n} indicateur(s)', { n: formatInt(counts.on) })}</Button>}
      </CardHeader>
      <div className="card-body tpl-head">
        <div className="tpl-counts">
          <span><Badge tone="green" icon={CheckCircle2}>{tr('Trouvée')}</Badge> {formatInt(counts.sure)}</span>
          <span><Badge tone="blue" icon={Link2}>{tr('Probable')}</Badge> {formatInt(counts.probable)}</span>
          <span><Badge tone="orange" icon={AlertTriangle}>{tr('À vérifier')}</Badge> {formatInt(counts.a_verifier)}</span>
          <span><Badge tone={null}>{tr('Sans variable')}</Badge> {formatInt(counts.none)}</span>
          {counts.existing > 0 && <span className="muted">{tr('{n} déjà créé(s)', { n: formatInt(counts.existing) })}</span>}
        </div>
        <div className="segmented" role="group" aria-label={tr('Filtrer')}>
          {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{tr(f.label)}</button>)}
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
                  return (
                    <tr key={it.code} className={r.on ? 'is-selected' : ''}>
                      {canEdit && <td className="tpl-check"><input type="checkbox" checked={Boolean(r.on)} disabled={!r.field || invalid}
                        aria-label={tr('Inclure « {label} »', { label: it.label })} onChange={(e) => set(it.code, { on: e.target.checked })} /></td>}
                      <td>
                        <strong>{it.label}</strong>
                        <div className="site-meta">
                          {it.direction === 'lower_better' && <span className="tpl-lower"><ArrowDown size={12} aria-hidden="true" /> {tr('plus bas = mieux')}</span>}
                          {!it.scored && <span>{tr('hors indice')}</span>}
                          {(it.warnings || []).map((w) => <span key={w} className="text-warn">{tr(WARNINGS[w] || w)}</span>)}
                          {it.existing && <span className="tpl-done"><CheckCircle2 size={12} aria-hidden="true" /> {tr('créé')}</span>}
                        </div>
                      </td>
                      <td>
                        {canEdit ? (
                          <input className={`input input-sm mono${invalid ? ' is-invalid' : ''}`} list={`tpl-fields-${form.id}`} value={r.field || ''}
                            placeholder={tr('— aucune —')} aria-label={tr('Variable pour « {label} »', { label: it.label })}
                            onChange={(e) => set(it.code, { field: e.target.value.trim(), on: Boolean(e.target.value.trim()) && fieldsByName.has(e.target.value.trim()) })} />
                        ) : <span className="mono">{r.field || '—'}</span>}
                        {field?.label && <div className="site-meta tpl-field-label" title={field.label}>{field.label}</div>}
                        {invalid && <div className="site-meta text-warn">{tr('Variable inconnue dans cette fiche')}</div>}
                      </td>
                      <td>
                        {it.agg === 'mean' || it.agg === 'sum' || it.agg === 'count' ? <span className="muted">{tr(it.agg === 'mean' ? 'moyenne' : it.agg === 'sum' ? 'somme' : 'nombre')}</span>
                          : field?.choices?.length && canEdit ? (
                            <select className="select select-sm" value={r.positive || ''} aria-label={tr('Valeur comptée pour « {label} »', { label: it.label })}
                              onChange={(e) => set(it.code, { positive: e.target.value })}>
                              {!field.choices.some((c) => c.value === r.positive) && r.positive && <option value={r.positive}>{r.positive}</option>}
                              {field.choices.map((c) => <option key={c.value} value={c.value}>{c.value} — {c.label}</option>)}
                            </select>
                          ) : canEdit
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
