import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, Layers, ShieldAlert } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatInt } from '../../lib/format.js';

const RISK = {
  elevee: { label: 'Élevé', color: 'var(--red)' },
  moyenne: { label: 'Moyen', color: 'var(--orange)' },
  faible: { label: 'Faible', color: 'var(--green)' },
};

/**
 * Carte des sites : répartition géographique du référentiel. Scatter GPS (pour
 * les sites géolocalisés) + explorateur région → district → commune avec le mix
 * de risque et la couverture. Recalculé en direct, sans dépendance externe.
 */
export default function SitesMapPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openRegion, setOpenRegion] = useState({});

  useEffect(() => {
    api.fieldMap().then(setData).catch((e) => { setError(e.message); toast.error(e.message); });
    /* eslint-disable-next-line */
  }, []);

  const points = data?.points || [];
  const communes = data?.communes || [];

  const kpis = useMemo(() => {
    const regions = new Set(), districts = new Set();
    let sites = 0;
    for (const c of communes) { if (c.region) regions.add(c.region); if (c.district) districts.add(`${c.region}|${c.district}`); sites += c.sites; }
    return { regions: regions.size, districts: districts.size, communes: communes.length, sites, geo: points.length };
  }, [communes, points]);

  // Projection GPS → SVG (bbox auto-fit).
  const scatter = useMemo(() => {
    if (points.length === 0) return null;
    const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const W = 760, H = 460, pad = 30;
    const sx = (lng) => (maxLng === minLng ? W / 2 : pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad));
    const sy = (lat) => (maxLat === minLat ? H / 2 : pad + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * pad));
    return { W, H, dots: points.map((p) => ({ ...p, x: sx(p.lng), y: sy(p.lat) })) };
  }, [points]);

  // Hiérarchie région → district → communes.
  const tree = useMemo(() => {
    const r = new Map();
    for (const c of communes) {
      const reg = c.region || '—';
      if (!r.has(reg)) r.set(reg, { region: reg, sites: 0, elevee: 0, moyenne: 0, faible: 0, visited: 0, districts: new Map() });
      const R = r.get(reg); R.sites += c.sites; R.elevee += c.elevee; R.moyenne += c.moyenne; R.faible += c.faible; R.visited += c.visited;
      const dk = c.district || '—';
      if (!R.districts.has(dk)) R.districts.set(dk, { district: dk, sites: 0, elevee: 0, moyenne: 0, faible: 0, visited: 0, communes: [] });
      const D = R.districts.get(dk); D.sites += c.sites; D.elevee += c.elevee; D.moyenne += c.moyenne; D.faible += c.faible; D.visited += c.visited; D.communes.push(c);
    }
    return [...r.values()].sort((a, b) => b.sites - a.sites);
  }, [communes]);

  const RiskBar = ({ e, m, f, total }) => {
    const pc = (n) => (total ? (n / total) * 100 : 0);
    return (
      <span className="riskbar" title={`Élevé ${e} · Moyen ${m} · Faible ${f}`}>
        <span style={{ width: `${pc(e)}%`, background: 'var(--red)' }} />
        <span style={{ width: `${pc(m)}%`, background: 'var(--orange)' }} />
        <span style={{ width: `${pc(f)}%`, background: 'var(--green)' }} />
      </span>
    );
  };

  return (
    <div className="page">
      <PageHeader title="Carte des sites" description="Répartition géographique du référentiel de sites : points géolocalisés et explorateur région → district → commune, avec le mix de risque et la couverture (visites réalisées)." />

      {error && <Alert tone="error">{error}</Alert>}

      {data === null ? <Skeleton height={360} /> : (
        <>
          <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <Kpi icon={Layers} tone="blue" label="Régions" value={formatInt(kpis.regions)} />
            <Kpi icon={Layers} tone="blue" label="Districts" value={formatInt(kpis.districts)} />
            <Kpi icon={MapPin} tone="blue" label="Communes" value={formatInt(kpis.communes)} />
            <Kpi icon={MapPin} tone="blue" label="Sites" value={formatInt(kpis.sites)} />
            <Kpi icon={ShieldAlert} tone={kpis.geo ? 'green' : 'amber'} label="Géolocalisés (GPS)" value={formatInt(kpis.geo)} foot={`${kpis.sites - kpis.geo} sans GPS`} />
          </div>

          <div className="card biz-card" style={{ marginBottom: 16 }}>
            <div className="card-header"><div className="card-title">Points géolocalisés</div>
              <div className="card-sub">Sites disposant de coordonnées GPS, colorés par niveau de risque.</div></div>
            <div className="card-body">
              {scatter ? (
                <>
                  <svg viewBox={`0 0 ${scatter.W} ${scatter.H}`} className="map-svg" role="img" aria-label="Carte des sites géolocalisés">
                    <rect x="0" y="0" width={scatter.W} height={scatter.H} fill="var(--surface-2)" rx="8" />
                    {scatter.dots.map((d) => (
                      <circle key={d.id} cx={d.x} cy={d.y} r="5" fill={RISK[d.riskLevel]?.color || 'var(--blue-600)'} fillOpacity="0.8" stroke="#fff" strokeWidth="1">
                        <title>{d.name} — {d.commune} ({RISK[d.riskLevel]?.label})</title>
                      </circle>
                    ))}
                  </svg>
                  <div className="map-legend">
                    {Object.entries(RISK).map(([k, v]) => <span key={k}><span className="dot" style={{ background: v.color }} />{v.label}</span>)}
                  </div>
                </>
              ) : (
                <p className="muted">Aucun site géolocalisé pour l'instant. Importez les coordonnées GPS (Master Data / Risk-based site selection) pour les voir ici. L'explorateur ci-dessous couvre tous les sites.</p>
              )}
            </div>
          </div>

          <div className="card biz-card">
            <div className="table-wrap"><table className="table grid">
              <thead><tr><th>Région / District</th><th className="num">Sites</th><th>Mix de risque</th><th className="num">Visités</th><th className="num">Couverture</th></tr></thead>
              <tbody>
                {tree.map((R) => {
                  const open = openRegion[R.region] !== false; // ouvert par défaut
                  return (
                    <React.Fragment key={R.region}>
                      <tr className="clickable map-region" onClick={() => setOpenRegion((s) => ({ ...s, [R.region]: !open }))}>
                        <td><strong>{open ? '▾' : '▸'} {R.region}</strong></td>
                        <td className="num tabular"><strong>{formatInt(R.sites)}</strong></td>
                        <td><RiskBar e={R.elevee} m={R.moyenne} f={R.faible} total={R.sites} /></td>
                        <td className="num tabular">{formatInt(R.visited)}</td>
                        <td className="num tabular">{R.sites ? Math.round((R.visited / R.sites) * 100) : 0} %</td>
                      </tr>
                      {open && [...R.districts.values()].sort((a, b) => b.sites - a.sites).map((D) => (
                        <tr key={R.region + D.district} className="map-district">
                          <td style={{ paddingLeft: 28 }}>{D.district}</td>
                          <td className="num tabular">{formatInt(D.sites)}</td>
                          <td><RiskBar e={D.elevee} m={D.moyenne} f={D.faible} total={D.sites} /></td>
                          <td className="num tabular">{formatInt(D.visited)}</td>
                          <td className="num tabular">{D.sites ? Math.round((D.visited / D.sites) * 100) : 0} %</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, foot, tone }) {
  return (
    <div className="biz-kpi">
      <div className={`biz-kpi-ic ${tone || ''}`}><Icon size={18} aria-hidden="true" /></div>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label">{label}</div>
        <div className="biz-kpi-value tabular">{value}</div>
        {foot && <div className="biz-kpi-foot">{foot}</div>}
      </div>
    </div>
  );
}
