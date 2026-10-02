import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Layers, ShieldAlert } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatInt } from '../../lib/format.js';

const RISK = {
  elevee: { label: 'Élevé', color: '#d64545' },
  moyenne: { label: 'Moyen', color: '#e08a1e' },
  faible: { label: 'Faible', color: '#2e9e5b' },
};
const MG_CENTER = [-19.5, 46.7]; // Madagascar

/**
 * Carte des sites sur fond OpenStreetMap (gratuit, sans clé). Les sites
 * géolocalisés (GPS) sont tracés en marqueurs colorés par risque ; un
 * explorateur région → district → commune couvre tous les sites (même sans
 * GPS), avec mix de risque et couverture. Si un fond de contours (shapefile /
 * GeoJSON) est importé plus tard, il pourra se superposer ici.
 */
export default function SitesMapPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openRegion, setOpenRegion] = useState({});
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    api.fieldMap().then(setData).catch((e) => { setError(e.message); toast.error(e.message); });
    /* eslint-disable-next-line */
  }, []);

  const points = useMemo(() => data?.points || [], [data]);
  const communes = useMemo(() => data?.communes || [], [data]);

  // Carte Leaflet (OSM) — initialisée dès que le conteneur est rendu (après le
  // chargement des données ; le div n'existe pas pendant le squelette).
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return undefined;
    const map = L.map(mapEl.current, { scrollWheelZoom: false }).setView(MG_CENTER, 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return undefined;
  }, [data]);

  // Nettoyage à la destruction du composant.
  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  // (Re)trace les marqueurs quand les points changent.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
    if (!points.length) { map.setView(MG_CENTER, 5); return; }
    const group = L.layerGroup();
    const latlngs = [];
    for (const p of points) {
      latlngs.push([p.lat, p.lng]);
      L.circleMarker([p.lat, p.lng], {
        radius: 6, color: '#fff', weight: 1.5,
        fillColor: RISK[p.riskLevel]?.color || '#0f6cbd', fillOpacity: 0.9,
      }).bindPopup(`<strong>${p.name}</strong><br>${p.commune || ''}${p.antenneName ? ` · ${p.antenneName}` : ''}<br>Risque : ${RISK[p.riskLevel]?.label || p.riskLevel}`).addTo(group);
    }
    group.addTo(map);
    layerRef.current = group;
    try { map.fitBounds(L.latLngBounds(latlngs).pad(0.2)); } catch { /* single/no point */ }
    // Leaflet a besoin d'un recalcul de taille quand le conteneur vient d'apparaître.
    setTimeout(() => map.invalidateSize(), 100);
  }, [points]);

  const kpis = useMemo(() => {
    const regions = new Set(), districts = new Set();
    let sites = 0;
    for (const c of communes) { if (c.region) regions.add(c.region); if (c.district) districts.add(`${c.region}|${c.district}`); sites += c.sites; }
    return { regions: regions.size, districts: districts.size, communes: communes.length, sites, geo: points.length };
  }, [communes, points]);

  const tree = useMemo(() => {
    const r = new Map();
    for (const c of communes) {
      const reg = c.region || '—';
      if (!r.has(reg)) r.set(reg, { region: reg, sites: 0, elevee: 0, moyenne: 0, faible: 0, visited: 0, districts: new Map() });
      const R = r.get(reg); R.sites += c.sites; R.elevee += c.elevee; R.moyenne += c.moyenne; R.faible += c.faible; R.visited += c.visited;
      const dk = c.district || '—';
      if (!R.districts.has(dk)) R.districts.set(dk, { district: dk, sites: 0, elevee: 0, moyenne: 0, faible: 0, visited: 0 });
      const D = R.districts.get(dk); D.sites += c.sites; D.elevee += c.elevee; D.moyenne += c.moyenne; D.faible += c.faible; D.visited += c.visited;
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
      <PageHeader title="Carte des sites" description="Fond OpenStreetMap (gratuit) : les sites géolocalisés sont tracés en marqueurs colorés par risque. L'explorateur région → district → commune couvre tous les sites, avec mix de risque et couverture." />

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
            <div className="card-header"><div className="card-title">Carte (OpenStreetMap)</div>
              <div className="card-sub">Sites géolocalisés, couleur = niveau de risque. {kpis.geo === 0 && 'Importez les coordonnées GPS pour voir les points ici.'}</div></div>
            <div className="card-body">
              <div ref={mapEl} className="site-map" />
              <div className="map-legend">
                {Object.entries(RISK).map(([k, v]) => <span key={k}><span className="dot" style={{ background: v.color }} />{v.label}</span>)}
              </div>
            </div>
          </div>

          <div className="card biz-card">
            <div className="table-wrap"><table className="table grid">
              <thead><tr><th>Région / District</th><th className="num">Sites</th><th>Mix de risque</th><th className="num">Visités</th><th className="num">Couverture</th></tr></thead>
              <tbody>
                {tree.map((R) => {
                  const open = openRegion[R.region] !== false;
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
