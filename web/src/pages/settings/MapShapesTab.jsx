import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Link2, MapPinned, PenLine, EyeOff, AlertTriangle, CircleDashed, Crosshair } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';

/** Rapprochement district ↔ contour : couleur + icône + libellé (jamais la couleur seule). */
const HOW = {
  exact: { label: 'Exact', tone: 'green', icon: CheckCircle2, ok: true },
  normalise: { label: 'Normalisé', tone: 'green', icon: CheckCircle2, ok: true },
  manuel: { label: 'Manuel', tone: 'blue', icon: PenLine, ok: true },
  parent: { label: 'Contour parent', tone: 'orange', icon: Link2 },
  masque: { label: 'Non dessiné', tone: 'yellow', icon: EyeOff },
  conflit: { label: 'Conflit', tone: 'red', icon: AlertTriangle },
  aucun: { label: 'Aucun contour', tone: 'red', icon: CircleDashed },
};
const AUTO = '__auto__';
const HIDE = '__hide__';

/**
 * Paramétrage › Localités › « Contours de la carte » (lot 6a) : chaque district du
 * découpage du compte (P-code), son rapprochement avec un contour de la carte
 * (exact, normalisé, contour parent, manuel, aucun, conflit) et une correction
 * manuelle : un des 119 contours, « Ne pas dessiner », ou retour à l'automatique.
 * La correction se voit aussitôt sur la carte et dans la fiche au survol.
 */
export default function MapShapesTab({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.mapShapeLinks().then(setData, (e) => setError(e.message));
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = all ? data.districts : data.districts.filter((d) => !HOW[d.how]?.ok || d.how === 'manuel' || d.stale);
    return [...list].sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name));
  }, [data, all]);

  if (!isAdmin) return <Alert tone="info">{tr('Cette rubrique est réservée aux administrateurs.')}</Alert>;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Card><div className="card-body"><Skeleton height={240} /></div></Card>;

  const change = async (d, value) => {
    setBusy(d.pcode);
    try {
      if (value === AUTO) await api.mapShapeLinkClear(d.pcode);
      else await api.mapShapeLinkSet(d.pcode, value === HIDE ? null : value);
      toast.success(tr('Correspondance enregistrée : visible aussitôt sur la carte.'));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  const fillCentres = async () => {
    setBusy('centres');
    try {
      const r = await api.mapFillCentres();
      toast.success(tr('{n} centre(s) de district renseigné(s).', { n: formatInt(r.updated) }));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  const toCheck = data.districts.filter((d) => !HOW[d.how]?.ok || d.stale).length;
  const withoutCentre = data.districts.filter((d) => d.shapeKey && !d.hasCentre).length;

  return (
    <Card>
      <CardHeader title={tr('Contours de la carte')}
        subtitle={tr('{n} district(s) du découpage · {c} contour(s) de la carte ({set}) · {k} à vérifier', { n: formatInt(data.districts.length), c: formatInt(data.shapes.length), set: data.shapeSet, k: formatInt(toCheck) })}>
        <label className="mapx-check" style={{ padding: 0 }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>{tr('Afficher tous les districts')}</span>
        </label>
        {withoutCentre > 0 && (
          <Button variant="secondary" size="sm" icon={Crosshair} loading={busy === 'centres'} onClick={fillCentres}>
            {tr('Renseigner {n} centre(s) de district', { n: formatInt(withoutCentre) })}
          </Button>
        )}
      </CardHeader>
      {data.conflicts.length > 0 && (
        <div className="card-body"><Alert tone="warning">{tr('{n} contour(s) revendiqué(s) par plusieurs districts : dessinés partagés, à corriger ci-dessous.', { n: data.conflicts.length })}</Alert></div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>{tr('P-code')}</th><th>{tr('District')}</th><th>{tr('Région')}</th><th className="num">{tr('Sites')}</th>
            <th>{tr('Correspondance')}</th><th>{tr('Contour')}</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="muted"><MapPinned size={14} aria-hidden="true" /> {tr('Tous les districts ont un contour exact : rien à vérifier.')}</td></tr>
            )}
            {rows.map((d) => {
              const how = HOW[d.how] || HOW.aucun;
              const value = !d.manual ? AUTO : d.shapeKey ? d.shapeKey : HIDE;
              return (
                <tr key={d.pcode}>
                  <td className="mono">{d.pcode}</td>
                  <td><strong>{d.name}</strong>{d.sharedWith.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{tr('Contour partagé avec {list}', { list: d.sharedWith.map((p) => (data.districts.find((x) => x.pcode === p) || {}).name || p).join(', ') })}</div>}</td>
                  <td>{d.region || '—'}</td>
                  <td className="num tabular">{formatInt(d.sites)}</td>
                  <td><Badge tone={how.tone} icon={how.icon}>{tr(how.label)}</Badge>{d.stale && <div className="muted" style={{ fontSize: 12 }}>{tr('Correction obsolète (contour absent)')}</div>}</td>
                  <td>
                    <select className="select" value={value} disabled={busy === d.pcode} aria-label={tr('Contour de {d}', { d: d.name })}
                      onChange={(e) => change(d, e.target.value)}>
                      <option value={AUTO}>{d.manual ? tr('Automatique') : tr('Automatique : {s}', { s: d.shapeName || tr('aucun') })}</option>
                      <option value={HIDE}>{tr('Ne pas dessiner')}</option>
                      {data.shapes.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
