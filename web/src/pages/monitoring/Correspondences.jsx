import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Handshake, UserRound, Check, Pencil, Minus, AlertTriangle, Link2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';

/**
 * Correspondances des valeurs codées d'une fiche (retour n° 3) : chaque valeur
 * reçue (« 6 » = Ambovombe, « 2 » = LALANA, code d'enquêteur) reliée au bureau,
 * au partenaire ou à l'agent MEMS. MEMS relie seul quand c'est sûr ; un nom
 * seulement proche est proposé. Une correction vaut pour CETTE fiche (le même
 * code peut désigner autre chose ailleurs) et s'applique aussitôt aux
 * soumissions déjà reçues.
 */
const DIMENSIONS = [
  { id: 'field_office', label: 'Bureau', icon: Building2 },
  { id: 'partner', label: 'Partenaire', icon: Handshake },
  { id: 'agent', label: 'Agent', icon: UserRound },
];
const AUTO = '__auto__';
const NONE = '__none__';
const INTERNAL = '__internal__'; // « Interne » : suivi par l'équipe S&E (pas un partenaire externe) — dimension partenaire

export default function CorrespondencesCard({ form, canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [dimension, setDimension] = useState('field_office');
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(null); // valeur en cours d'enregistrement

  async function reload(dim = dimension) {
    try { setData(await api.monCorrespondences(form.id, dim)); }
    catch (e) { toast.error(e.message); setData({ rows: [], options: [] }); }
  }
  useEffect(() => { setData(null); reload(dimension); /* eslint-disable-next-line */ }, [form.id, dimension]);

  const names = useMemo(() => new Map((data?.options || []).map((o) => [o.id, o.name])), [data]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const o of data?.options || []) { const g = o.group || ''; if (!m.has(g)) m.set(g, []); m.get(g).push(o); }
    return [...m.entries()];
  }, [data]);
  const rows = data?.rows || [];
  const total = rows.reduce((a, r) => a + r.n, 0);
  const linked = rows.reduce((a, r) => a + r.current.filter((c) => c.id).reduce((x, c) => x + c.n, 0), 0);

  async function save(r, value) {
    const body = value === AUTO ? { mode: 'auto' }
      : value === INTERNAL ? { mode: 'internal' }
        : value === NONE ? { mode: 'ignore' } : { mode: 'link', targetId: value };
    setSaving(r.raw);
    try {
      const out = await api.monSetCorrespondence(form.id, { dimension, raw: r.raw, ...body });
      toast.success(tr('Correspondance enregistrée : {n} soumission(s) de cette fiche mises à jour.', { n: formatInt(out.submissions) }));
      await reload();
    } catch (e) { toast.error(e.message); } finally { setSaving(null); }
  }

  const selValue = (r) => (r.manual ? (r.manual.internal ? INTERNAL : (r.manual.targetId || NONE)) : AUTO);
  const autoLabel = (r) => {
    const p = r.proposal;
    if (p && p.status === 'exact' && p.ids[0]) return tr('Automatique — {name}', { name: names.get(p.ids[0]) || '…' });
    if (p && (p.status === 'code' || p.status === 'nom') && p.ids[0]) return tr('Automatique — {name}', { name: names.get(p.ids[0]) || '…' });
    return tr('Automatique');
  };

  function Proposal({ r }) {
    if (r.manual) return <Badge tone="blue" icon={Pencil}>{r.manual.internal ? tr('interne') : (r.manual.targetId ? tr('manuel') : tr('manuel · non relié'))}</Badge>;
    const p = r.proposal;
    if (!p) {
      return r.current.some((c) => c.id)
        ? <Badge tone="green" icon={Check}>{tr('auto')}</Badge>
        : <Badge tone={null} icon={Minus}>{tr('à relier')}</Badge>;
    }
    if (['exact', 'code', 'nom'].includes(p.status)) return <Badge tone="green" icon={Check}>{tr('trouvé')}</Badge>;
    if (p.status === 'propose' && p.ids.length) {
      return (
        <span className="corr-propose">
          <Badge tone="orange" icon={AlertTriangle}>{tr('proposé : {name}', { name: names.get(p.ids[0]) || '…' })}</Badge>
          {canEdit && r.editable !== false && <Button size="sm" variant="ghost" icon={Link2} loading={saving === r.raw} onClick={() => save(r, p.ids[0])}>{tr('Confirmer')}</Button>}
        </span>
      );
    }
    if (p.status === 'ambigu') return <Badge tone="orange" icon={AlertTriangle}>{tr('plusieurs possibles')}</Badge>;
    if (p.status === 'partiel') return <Badge tone="orange" icon={AlertTriangle}>{tr('selon le partenaire')}</Badge>;
    return <Badge tone={null} icon={Minus}>{tr('à relier')}</Badge>;
  }

  return (
    <Card aria-labelledby="corr-title">
      <CardHeader id="corr-title" title={tr('Correspondances des valeurs')}
        subtitle={tr('Chaque valeur codée du formulaire reliée au bureau, au partenaire ou à l\'agent MEMS. MEMS relie seul quand c\'est sûr et propose le reste ; une correction ne vaut que pour cette fiche et s\'applique aussitôt aux soumissions déjà reçues.')} />
      <div className="card-body corr-head">
        <div className="seg" role="tablist" aria-label={tr('Type de valeur')}>
          {DIMENSIONS.map((d) => (
            <button key={d.id} type="button" role="tab" aria-selected={dimension === d.id} className={dimension === d.id ? 'is-active' : ''} onClick={() => setDimension(d.id)}>
              <d.icon size={15} aria-hidden="true" /> {tr(d.label)}
            </button>
          ))}
        </div>
        {data && total > 0 && (
          <span className="muted">{tr('{v} valeur(s) · {p} % des soumissions reliées', { v: formatInt(rows.length), p: Math.round((linked / total) * 100) })}</span>
        )}
      </div>
      {data === null ? <div className="card-body"><Skeleton height={120} /></div>
        : rows.length === 0 ? (
          <EmptyState icon={Link2} title={tr('Aucune valeur reçue')}>
            {tr('Aucune soumission de cette fiche ne porte cette information (vérifiez la colonne choisie ci-dessus).')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table corr-table">
              <thead><tr>
                <th scope="col">{tr('Valeur du formulaire')}</th><th scope="col" className="num">{tr('Soumissions')}</th>
                <th scope="col">{tr('Reliée à')}</th><th scope="col">{tr('Correspondance')}</th><th scope="col">{tr('État')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.raw}>
                    <td><span className="mono">{r.raw}</span>{r.label && r.label !== r.raw && <div className="site-meta">{r.label}</div>}</td>
                    <td className="num tabular">{formatInt(r.n)}</td>
                    <td>
                      {r.current.filter((c) => c.id).length
                        ? r.current.map((c) => (c.id
                          ? <div key={c.id}>{names.get(c.id) || '…'}{r.current.length > 1 && <span className="muted"> · {formatInt(c.n)}</span>}</div>
                          : <div key="none" className="cell-empty">{tr('non reliée')} · {formatInt(c.n)}</div>))
                        : <span className="cell-empty">{tr('non reliée')}</span>}
                    </td>
                    <td>
                      {canEdit && r.editable === false ? (
                        <span className="muted">{tr('Valeur trop longue (plus de 200 caractères) : correspondance impossible ; vérifiez la colonne choisie.')}</span>
                      ) : canEdit ? (
                        <select className="select select-sm corr-select" value={selValue(r)} disabled={saving === r.raw}
                          aria-label={tr('Correspondance de « {v} »', { v: r.label || r.raw })} onChange={(e) => save(r, e.target.value)}>
                          <option value={AUTO}>{autoLabel(r)}</option>
                          {dimension === 'partner' && <option value={INTERNAL}>{tr('Interne (suivi par l\'équipe S&E)')}</option>}
                          <option value={NONE}>{tr('— Ne pas relier —')}</option>
                          {groups.map(([g, list]) => (g
                            ? <optgroup key={g} label={g}>{list.map((o) => <option key={o.id} value={o.id}>{o.name}{o.active === false ? ` (${tr('inactif')})` : ''}</option>)}</optgroup>
                            : list.map((o) => <option key={o.id} value={o.id}>{o.name}{o.active === false ? ` (${tr('inactif')})` : ''}</option>)))}
                        </select>
                      ) : <span>{r.manual ? (r.manual.internal ? tr('Interne') : (names.get(r.manual.targetId) || tr('non reliée'))) : tr('Automatique')}</span>}
                    </td>
                    <td><Proposal r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}
