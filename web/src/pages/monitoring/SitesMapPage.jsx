import React, { useMemo, useState } from 'react';
import { Layers, MapPin, ShieldAlert } from 'lucide-react';
import { PageHeader, Skeleton } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { PeriodBanner, SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import MapExplorer from '../../components/map/MapExplorer.jsx';
import { formatInt } from '../../lib/format.js';
import { formatRate } from '../../lib/mapScale.js';
import { single } from '../../lib/period.js';
import { useI18n } from '../../lib/i18n.jsx';

/** Durée maximale acceptée par /api/map/districts et /api/map/points. */
const MAP_MAX_SPAN = 36;

/**
 * Suivi de processus › Carte des sites (lot 6a) : la carte partagée (thème « Sites
 * actifs », toutes les couches de points, fond vectoriel hors ligne — plus de tuiles
 * OpenStreetMap obligatoires) et le REGISTRE GÉOGRAPHIQUE région → district, lu dans la
 * même réponse (/api/map/districts) : sites, actifs, réalisés, couverture, mix de
 * risque, GPS — chaque site compté une fois (plus de 1 294 sites ni de 32 « districts »
 * textuels), districts du découpage (P-code), sans district reconnu à part.
 */
export default function SitesMapPage({ onNavigate, isAdmin = false }) {
  const { tr } = useI18n();
  // Plafond de /api/map/* : 36 mois — une période de session plus longue (budget : 60) est ramenée.
  // Défaut = MOIS COURANT (les sites actifs sont de ce mois) et non le dernier mois de données
  // (souvent sans site actif → carte vide). Le repli registre couvre un mois courant sans activation.
  const per = usePeriod({ scope: 'analysis', defaultRule: 'current', maxSpan: MAP_MAX_SPAN });
  const [data, setData] = useState(null);
  const initial = useMemo(() => ({ theme: 'active', layers: { gps: true, derived: true, communes: true, collect: false } }), []);

  return (
    <div className="section-gap">
      <PageHeader title={tr('Carte des sites')}
        description={tr('Registre des sites sur le fond vectoriel des districts (hors ligne) : districts colorés selon le thème, sites GPS et positions déduites des collectes ; registre géographique région → district ci-dessous.')}>
        {per.ready && <PeriodSelect value={per.period} onChange={(p) => per.setPeriod(p)} counts={per.counts} latest={per.latest} today={per.today} maxSpan={MAP_MAX_SPAN} align="right" />}
      </PageHeader>
      <PeriodBanner auto={per.auto} period={per.period} />
      <SessionPeriodNote source={per.source} onReset={per.resetToDefault} />
      <MapExplorer variant="full" period={per.period || undefined} initial={initial} onNavigate={onNavigate} isAdmin={isAdmin}
        storageKey="mems.map.sites" onDataChange={setData} />
      {data ? <GeoRegister data={data} /> : <Skeleton height={240} />}
    </div>
  );
}

function RiskBar({ e, m, f, total }) {
  const { tr } = useI18n();
  const pc = (n) => (total ? (n / total) * 100 : 0);
  return (
    <span className="riskbar" title={tr('Élevé {e} · Moyen {m} · Faible {f}', { e, m, f })}>
      <span style={{ width: `${pc(e)}%`, background: 'var(--red)' }} />
      <span style={{ width: `${pc(m)}%`, background: 'var(--orange)' }} />
      <span style={{ width: `${pc(f)}%`, background: 'var(--green)' }} />
    </span>
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

/** Registre géographique : région → district (P-code), sites distincts, lu dans la réponse de la carte. */
function GeoRegister({ data }) {
  const { tr, lang } = useI18n();
  const [closed, setClosed] = useState({});
  const tree = useMemo(() => {
    const byRegion = new Map();
    for (const r of data.regions) byRegion.set(r.name, { ...r, districts: [], only: null });
    for (const d of data.districts) {
      const k = d.region || '—';
      if (!byRegion.has(k)) byRegion.set(k, { name: k, counts: { sites: 0 }, rates: {}, districts: [], only: null });
      byRegion.get(k).districts.push(d);
    }
    for (const r of data.regionOnly) if (byRegion.has(r.name)) byRegion.get(r.name).only = r;
    return [...byRegion.values()].filter((r) => r.counts.sites > 0 || r.districts.some((d) => d.counts.sites > 0))
      .sort((a, b) => b.counts.sites - a.counts.sites);
  }, [data]);
  const t = data.totals.counts;
  const districtsWithSites = data.districts.filter((d) => d.counts.sites > 0).length;
  const row = (z, label, cls, extra) => (
    <tr className={cls} key={label + (z.pcode || '')}>
      <td>{label}{extra}</td>
      <td className="num tabular">{formatInt(z.counts.sites)}</td>
      <td className="num tabular">{formatInt(z.counts.active)}</td>
      <td className="num tabular">{formatInt(z.counts.realised)}</td>
      <td className="num tabular">{z.rates.coverage ? formatRate(z.rates.coverage.value, lang) : '—'}</td>
      <td><RiskBar e={z.counts.riskHigh} m={z.counts.riskMid} f={z.counts.riskLow} total={z.counts.active} /></td>
      <td className="num tabular">{formatInt(z.counts.gps)}</td>
    </tr>
  );
  return (
    <>
      {/* 4 tuiles, 2 par ligne sous 1 100 px (cd-kpis-4) : une grille fixée en ligne ignorait les
          règles responsives et débordait à 390 px. */}
      <div className="biz-kpis cd-kpis-4" style={{ marginTop: 16 }}>
        <Kpi icon={MapPin} tone="blue" label={tr('Sites du registre')} value={formatInt(t.sites)} foot={tr('{n} actif(s) sur la période', { n: formatInt(t.active) })} />
        <Kpi icon={Layers} tone="blue" label={tr('Districts portant des sites')} value={formatInt(districtsWithSites)} foot={tr('{n} région(s)', { n: formatInt(tree.length) })} />
        <Kpi icon={Layers} tone={data.unplaced.sites || data.regionOnly.length ? 'amber' : 'green'} label={tr('Sans district reconnu')}
          value={formatInt(data.regionOnly.reduce((a, r) => a + r.counts.sites, 0) + data.unplaced.sites)}
          foot={tr('{ro} à la région seulement · {u} sans localité', { ro: formatInt(data.regionOnly.reduce((a, r) => a + r.counts.sites, 0)), u: formatInt(data.unplaced.sites) })} />
        <Kpi icon={ShieldAlert} tone={t.gps ? 'green' : 'amber'} label={tr('Géolocalisés (GPS)')} value={formatInt(t.gps)} foot={tr('{n} sans GPS', { n: formatInt(t.sites - t.gps) })} />
      </div>
      <div className="card biz-card">
        <div className="card-header"><div><div className="card-title">{tr('Registre géographique')}</div>
          <div className="card-sub">{tr('Région → district du découpage (P-code) · sites distincts · réalisés et couverture sur la période')}</div></div></div>
        <div className="table-wrap"><table className="table grid">
          <thead><tr><th>{tr('Région / District')}</th><th className="num">{tr('Sites')}</th><th className="num">{tr('Actifs')}</th><th className="num">{tr('Réalisés')}</th>
            <th className="num">{tr('Couverture')}</th><th>{tr('Mix de risque')}</th><th className="num">{tr('GPS')}</th></tr></thead>
          <tbody>
            {tree.map((R) => {
              const open = !closed[R.name];
              return (
                <React.Fragment key={R.name}>
                  <tr className="clickable map-region" onClick={() => setClosed((s) => ({ ...s, [R.name]: open }))}>
                    <td colSpan={1}><strong>{open ? '▾' : '▸'} {R.name}</strong></td>
                    <td className="num tabular"><strong>{formatInt(R.counts.sites)}</strong></td>
                    <td className="num tabular">{formatInt(R.counts.active || 0)}</td>
                    <td className="num tabular">{formatInt(R.counts.realised || 0)}</td>
                    <td className="num tabular">{R.rates.coverage ? formatRate(R.rates.coverage.value, lang) : '—'}</td>
                    <td>{R.counts.active ? <RiskBar e={R.counts.riskHigh} m={R.counts.riskMid} f={R.counts.riskLow} total={R.counts.active} /> : null}</td>
                    <td className="num tabular">{formatInt(R.counts.gps || 0)}</td>
                  </tr>
                  {open && R.districts.filter((d) => d.counts.sites > 0).map((d) => row(d, d.name, 'map-district', d.sharedWith && d.sharedWith.length ? <span className="muted"> · {tr('contour partagé')}</span> : null))}
                  {open && R.only && row(R.only, tr('Rattachés à la région seulement'), 'map-district is-muted')}
                </React.Fragment>
              );
            })}
            {data.unplaced.sites > 0 && row(data.unplaced, tr('Sans localité'), 'map-region')}
          </tbody>
          <tfoot>{row(data.totals, tr('Total'), '')}</tfoot>
        </table></div>
      </div>
    </>
  );
}
