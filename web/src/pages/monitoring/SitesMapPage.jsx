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
const MG_CENTER = [-19.5, 46.7];

// Normalisation pour joindre les noms de districts (données ↔ geoBoundaries).
const strip = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[-_]/g, ' ').replace(/\b(atsimo|androy|ouest|est|nord|sud|avaratra|atsinanana)\b/g, '')
  .replace(/\s+/g, ' ').trim();
const ALIAS = { 'fort dauphin': 'taolagnaro', taolagnaro: 'taolagnaro', tolagnaro: 'taolagnaro' };
const normDistrict = (s) => { const k = strip(s); return ALIAS[k] || k; };

// Échelle choroplèthe (nombre de sites par district).
const choro = (n) => (n === 0 ? '#e3e5ea' : n < 10 ? '#dbe9f6' : n < 30 ? '#9ecae1' : n < 60 ? '#4a98d4' : n < 120 ? '#1f6fb2' : '#0b4a86');

/**
 * Carte des sites sur fond OpenStreetMap (gratuit). Deux couches : marqueurs des
 * sites géolocalisés (couleur = risque) et zones administratives (choroplèthe par
 * district, contours Madagascar ADM2 geoBoundaries, jointe à nos données par nom).
 */
export default function SitesMapPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [layer, setLayer] = useState('markers');
  const [openRegion, setOpenRegion] = useState({});
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const geojsonRef = useRef(null); // cache des contours

  useEffect(() => {
    api.fieldMap().then(setData).catch((e) => { setError(e.message); toast.error(e.message); });
    /* eslint-disable-next-line */
  }, []);

  const points = useMemo(() => data?.points || [], [data]);
  const communes = useMemo(() => data?.communes || [], [data]);

  // Agrégat par district (clé normalisée) pour la choroplèthe.
  const byDistrict = useMemo(() => {
    const m = new Map();
    for (const c of communes) {
      const k = normDistrict(c.district);
      if (!k) continue;
      if (!m.has(k)) m.set(k, { name: c.district, region: c.region, sites: 0, elevee: 0, moyenne: 0, faible: 0, visited: 0 });
      const d = m.get(k); d.sites += c.sites; d.elevee += c.elevee; d.moyenne += c.moyenne; d.faible += c.faible; d.visited += c.visited;
    }
    return m;
  }, [communes]);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return undefined;
    const map = L.map(mapEl.current, { scrollWheelZoom: false }).setView(MG_CENTER, 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return undefined;
  }, [data]);
  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  // (Re)construit la couche active (marqueurs ou zones).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const clear = () => { if (overlayRef.current) { overlayRef.current.remove(); overlayRef.current = null; } };

    if (layer === 'markers') {
      clear();
      if (!points.length) { map.setView(MG_CENTER, 5); return undefined; }
      const group = L.layerGroup(); const latlngs = [];
      for (const p of points) {
        latlngs.push([p.lat, p.lng]);
        L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: RISK[p.riskLevel]?.color || '#0f6cbd', fillOpacity: 0.9 })
          .bindPopup(`<strong>${p.name}</strong><br>${p.commune || ''}${p.antenneName ? ` · ${p.antenneName}` : ''}<br>Risque : ${RISK[p.riskLevel]?.label || p.riskLevel}`).addTo(group);
      }
      group.addTo(map); overlayRef.current = group;
      try { map.fitBounds(L.latLngBounds(latlngs).pad(0.2)); } catch { /* */ }
      setTimeout(() => map.invalidateSize(), 60);
      return undefined;
    }

    // Zones : charge les contours (cache) puis trace la choroplèthe.
    const render = (gj) => {
      if (cancelled) return;
      clear();
      const lyr = L.geoJSON(gj, {
        style: (f) => {
          const d = byDistrict.get(normDistrict(f.properties.name));
          return { color: '#fff', weight: 1, fillColor: choro(d?.sites || 0), fillOpacity: d ? 0.75 : 0.25 };
        },
        onEachFeature: (f, l) => {
          const d = byDistrict.get(normDistrict(f.properties.name));
          const cov = d && d.sites ? Math.round((d.visited / d.sites) * 100) : 0;
          l.bindPopup(`<strong>${f.properties.name}</strong><br>${d ? `${d.sites} site(s) · ${cov} % visités<br>Élevé ${d.elevee} · Moyen ${d.moyenne} · Faible ${d.faible}` : 'Aucun site référencé'}`);
          l.on({ mouseover: () => l.setStyle({ weight: 2.5 }), mouseout: () => l.setStyle({ weight: 1 }) });
        },
      });
      lyr.addTo(map); overlayRef.current = lyr;
      try { map.fitBounds(lyr.getBounds().pad(0.05)); } catch { /* */ }
      setTimeout(() => map.invalidateSize(), 60);
    };
    if (geojsonRef.current) { render(geojsonRef.current); }
    else {
      fetch('mdg-adm2.geojson').then((r) => r.json()).then((gj) => { geojsonRef.current = gj; render(gj); })
        .catch(() => toast.error('Contours de districts indisponibles.'));
    }
    return () => { cancelled = true; };
  }, [layer, points, byDistrict]); // eslint-disable-line

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
      <PageHeader title="Carte des sites" description="Fond OpenStreetMap (gratuit). Deux couches : marqueurs des sites géolocalisés (couleur = risque) et zones administratives (choroplèthe par district, contours Madagascar ADM2). L'explorateur ci-dessous couvre tous les sites." />

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
            <div className="card-header">
              <div><div className="card-title">Carte (OpenStreetMap)</div>
                <div className="card-sub">{layer === 'markers' ? 'Sites géolocalisés, couleur = niveau de risque.' : 'Districts colorés selon le nombre de sites (choroplèthe). Contours : geoBoundaries ADM2 (CC BY).'}</div></div>
              <div className="seg" role="group" aria-label="Couche">
                <button type="button" className={layer === 'markers' ? 'is-active' : ''} onClick={() => setLayer('markers')}>Marqueurs</button>
                <button type="button" className={layer === 'zones' ? 'is-active' : ''} onClick={() => setLayer('zones')}>Zones (districts)</button>
              </div>
            </div>
            <div className="card-body">
              <div ref={mapEl} className="site-map" />
              <div className="map-legend">
                {layer === 'markers'
                  ? Object.entries(RISK).map(([k, v]) => <span key={k}><span className="dot" style={{ background: v.color }} />{v.label}</span>)
                  : [['< 10', choro(5)], ['10–29', choro(20)], ['30–59', choro(45)], ['60–119', choro(90)], ['120+', choro(200)]].map(([lab, col]) => <span key={lab}><span className="dot" style={{ background: col }} />{lab}</span>)}
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
