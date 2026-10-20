import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Table2, MapPin, Building2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { ALERT_LEVELS, formatRate, inkOn, valueOf } from '../../lib/mapScale.js';
import { useThemeValue } from './MapHoverCard.jsx';

export const LEVELS = [
  { id: 'district', label: 'District' },
  { id: 'region', label: 'Région' },
  { id: 'office', label: 'Bureau' },
  { id: 'commune', label: 'Commune' },
];

/** Chiffre clé d'un thème sur TOUT le périmètre (y compris les sites rattachés à la région seulement). */
export function heroOf(theme, data, tr, lang) {
  const t = data.totals; const c = t.counts; const r = t.rates;
  const roSites = (data.regionOnly || []).reduce((a, x) => a + x.counts.sites, 0);
  const rateOr = (x) => (x.reason === 'aucun_plan' ? tr('— aucun plan') : x.value == null ? '—' : formatRate(x.value, lang));
  switch (theme.id) {
    case 'coverage': return [rateOr(r.coverage), tr('{done} sites réalisés / {active} actifs (sites distincts) · dont {data} par les données · {never} jamais visités',
      { done: formatInt(c.realised), active: formatInt(c.active), data: formatInt(c.realisedData), never: formatInt(c.neverVisited) })];
    case 'active': return [formatInt(c.active), tr('sites actifs · {n} contours · {ro} à la région seulement', { n: formatInt(data.shapes.filter((s) => s.counts.active > 0).length), ro: formatInt(roSites) })];
    case 'realised': return [formatInt(c.realised), tr('sites visités sur {active} actifs · {never} jamais visités', { active: formatInt(c.active), never: formatInt(c.neverVisited) })];
    case 'planning': return [rateOr(r.planning), tr('{n} sites prévus / {active} actifs', { n: formatInt(c.planned), active: formatInt(c.active) })];
    case 'execution': return [rateOr(r.execution), tr('{done} visites réalisées parmi {planned} prévues · {off} hors plan', { done: formatInt(c.visitsPlannedRealised), planned: formatInt(c.visitsPlanned), off: formatInt(c.visitsOffPlan) })];
    case 'riskHigh': return [rateOr(r.riskHigh), tr('{n} sites à risque élevé / {active} actifs', { n: formatInt(c.riskHigh), active: formatInt(c.active) })];
    case 'submissions': return [formatInt(c.submissions), tr('soumissions versées · {d} districts · {u} non localisées', { d: formatInt(data.shapes.filter((s) => s.counts.submissions > 0).length), u: formatInt(data.submissionsUnlocated) })];
    default: {
      const withSig = data.shapes.filter((s) => s.alertLevel != null);
      return [formatInt(withSig.length), tr('contours avec au moins un signal · {c} critiques', { c: formatInt(withSig.filter((s) => s.alertLevel === 2).length) })];
    }
  }
}

/** Zones d'un niveau de classement, avec nom et sous-ligne. */
export function zonesOf(level, data, tr) {
  if (level === 'region') return data.regions.map((z) => ({ ...z, key: `r:${z.pcode}`, sub: tr('région') }));
  if (level === 'office') return data.offices.map((z) => ({ ...z, key: `o:${z.id || 'none'}`, name: z.name || tr('Sans bureau'), sub: z.parentName || '' }));
  if (level === 'commune') return (data.communes || []).filter((z) => z.pcode).map((z) => ({ ...z, key: `c:${z.pcode}`, sub: [z.district, z.region].filter(Boolean).join(' · ') }));
  return data.shapes.map((z) => ({ ...z, sub: z.region || '' }));
}

/** Classement : valeurs numériques triées, puis « — aucun plan » ; les zones sans valeur sont omises. */
export function rankZones(zones, themeId, order = 'desc') {
  const withV = zones.map((z) => ({ z, v: valueOf(themeId, z) })).filter((x) => x.v != null);
  const num = withV.filter((x) => x.v !== 'np').sort((a, b) => (order === 'desc' ? b.v - a.v : a.v - b.v) || (b.z.counts.active - a.z.counts.active) || String(a.z.name).localeCompare(String(b.z.name)));
  return [...num, ...withV.filter((x) => x.v === 'np')];
}

/** Pastille de valeur : couleur de la classe + encre lisible ; « — aucun plan » en contour. */
export function ValueChip({ theme, zone, scale }) {
  const { tr } = useI18n();
  const fmt = useThemeValue();
  const v = valueOf(theme.id, zone);
  if (v === 'np') return <span className="mapx-chip is-np">{tr('— aucun plan')}</span>;
  const fill = scale && scale.fill(v);
  if (!fill) return <span className="mapx-chip is-empty">{fmt(theme, zone)}</span>;
  return (
    <span className="mapx-chip tabular" style={{ background: fill, color: inkOn(fill) }}>
      {theme.kind === 'sev' ? `${ALERT_LEVELS[v].icon} ` : ''}{fmt(theme, zone)}
    </span>
  );
}

/**
 * Panneau gauche (lot 6a) : chiffre clé du thème sur tout le périmètre, recherche
 * (district, commune, site), classement à pastilles par niveau (district, région,
 * bureau, commune) et sens, « Sans district reconnu », « Par activité », tableau.
 * Clavier : flèches dans le classement, Entrée = zoom, Échap = vue d'ensemble.
 */
export default function MapPanel({
  data, theme, scale, compact = false, level, onLevel, order, onOrder, hoverKey, onHoverKey,
  onPickZone, onSearchPick, onReset, onNavigate, onOpenTable, periodText, communesLoading,
}) {
  const { tr, lang } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setResults(null); return undefined; }
    let alive = true;
    const id = setTimeout(() => {
      api.mapSearch(s).then((r) => { if (alive) setResults(r.results || []); }, () => { if (alive) setResults([]); });
    }, 200);
    return () => { alive = false; clearTimeout(id); };
  }, [q]);

  const [heroValue, heroFoot] = heroOf(theme, data, tr, lang);
  const zones = useMemo(() => zonesOf(level, data, tr), [level, data, tr]);
  const ranked = useMemo(() => rankZones(zones, theme.id, order), [zones, theme.id, order]);
  const shown = compact ? ranked.slice(0, 8) : ranked;
  // Clé : P-code de la région, sinon son nom (régions sans P-code : clés uniques, jamais « ro:null »).
  const outside = [...(data.regionOnly || []).map((r, i) => ({ ...r, key: `ro:${r.pcode || r.name || i}`, sub: tr('région seulement · {n} sites', { n: formatInt(r.counts.sites) }) }))];

  const onKey = (e) => {
    const items = [...listRef.current.querySelectorAll('[data-rank]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); onReset && onReset(); }
  };

  return (
    <div className="mapx-panel">
      <div className="mapx-hero">
        <div className="mapx-hero-k">{tr(theme.label)}{compact ? ` · ${periodText}` : ''}</div>
        <div className="mapx-hero-v tabular">{heroValue}</div>
        <div className="mapx-hero-f">{heroFoot}</div>
      </div>

      {!compact && (
        <div className="mapx-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80}
            placeholder={tr('Rechercher un district, une commune, un site…')} aria-label={tr('Rechercher un district, une commune, un site…')} />
          {results && (
            <ul className="mapx-results" role="listbox" aria-label={tr('Résultats')}>
              {results.length === 0 && <li className="muted">{tr('Aucun résultat')}</li>}
              {results.map((r) => (
                <li key={`${r.kind}-${r.pcode || r.id}`}>
                  <button type="button" onClick={() => { onSearchPick(r); setResults(null); setQ(''); }}>
                    {r.kind === 'site' ? <MapPin size={13} aria-hidden="true" /> : <Building2 size={13} aria-hidden="true" />}
                    <span><b>{r.name}</b> <span className="muted">{r.kind === 'district' ? tr('district') : r.kind === 'commune' ? tr('commune · {d}', { d: r.district || '—' }) : tr('site · {c}', { c: r.commune || r.code || '—' })}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!compact && (
        <div className="seg mapx-levels" role="group" aria-label={tr('Niveau')}>
          {LEVELS.map((l) => (
            <button type="button" key={l.id} className={level === l.id ? 'is-active' : ''} aria-pressed={level === l.id} onClick={() => onLevel(l.id)}>{tr(l.label)}</button>
          ))}
        </div>
      )}
      <div className="seg mapx-order" role="group" aria-label={tr('Ordre')}>
        <button type="button" className={order === 'desc' ? 'is-active' : ''} aria-pressed={order === 'desc'} onClick={() => onOrder('desc')}>{tr('Plus élevés')}</button>
        <button type="button" className={order === 'asc' ? 'is-active' : ''} aria-pressed={order === 'asc'} onClick={() => onOrder('asc')}>{tr('Plus faibles')}</button>
      </div>

      <div className="mapx-rank" ref={listRef} onKeyDown={onKey} role="list" aria-label={tr('Classement')}>
        {level === 'commune' && communesLoading && <p className="muted mapx-pad">{tr('Chargement des communes…')}</p>}
        {shown.length === 0 && !communesLoading && <p className="muted mapx-pad">{tr('Aucune valeur sur la période')}</p>}
        {shown.map(({ z }) => (
          <button type="button" role="listitem" data-rank key={z.key} className={`mapx-row${hoverKey === z.key ? ' is-hover' : ''}`}
            onMouseEnter={() => onHoverKey && onHoverKey(z.key)} onMouseLeave={() => onHoverKey && onHoverKey(null)}
            onFocus={() => onHoverKey && onHoverKey(z.key)} onClick={() => onPickZone(level, z)}>
            <span className="mapx-row-n">
              {z.name}
              {level === 'district' && (z.districts || []).length > 1 && (
                <span className="mapx-row-plus"> + {z.districts.filter((d) => d.name !== z.name).map((d) => d.name).join(', ')}</span>
              )}
              {z.sub && <span className="mapx-row-sub">{z.sub}</span>}
            </span>
            <ValueChip theme={theme} zone={z} scale={level === 'district' ? scale : scale} />
          </button>
        ))}
        {compact && ranked.length > shown.length && <p className="muted mapx-pad">{tr('+ {n} autre(s)', { n: formatInt(ranked.length - shown.length) })}</p>}
        {!compact && level === 'district' && (outside.length > 0 || data.unplaced.sites > 0) && (
          <>
            <div className="mapx-rank-sub">{tr('Sans district reconnu')}</div>
            {outside.map((z) => (
              <div className="mapx-row is-static" key={z.key} role="listitem">
                <span className="mapx-row-n">{z.name}<span className="mapx-row-sub">{z.sub}</span></span>
                <ValueChip theme={theme} zone={z} scale={null} />
              </div>
            ))}
            {data.unplaced.sites > 0 && (
              <div className="mapx-row is-static" role="listitem">
                <span className="mapx-row-n">{tr('Sans localité')}<span className="mapx-row-sub">{tr('{n} site(s)', { n: formatInt(data.unplaced.sites) })}</span></span>
              </div>
            )}
            {onNavigate && <button type="button" className="inline-link mapx-pad" onClick={() => onNavigate('parametrage', 'localites')}>{tr('À rapprocher')}</button>}
          </>
        )}
      </div>

      {!compact && data.activities.length > 0 && (
        <div className="mapx-acts">
          <div className="mapx-rank-sub">{tr('Par activité')}</div>
          <table className="mapx-acts-t">
            <thead><tr><th>{tr('Activité')}</th><th className="num">{tr('Actifs')}</th><th className="num">{tr('Prévus')}</th><th className="num">{tr('Réalisés')}</th><th className="num">{tr('Couverture')}</th></tr></thead>
            <tbody>
              {data.activities.filter((a) => a.counts.active > 0).slice(0, 8).map((a) => (
                <tr key={a.name}>
                  <td title={a.name}>{a.name === '—' ? tr('Sans activité') : a.name}</td>
                  <td className="num tabular">{formatInt(a.counts.active)}</td>
                  <td className="num tabular">{a.counts.planned ? formatInt(a.counts.planned) : <span className="muted">{tr('— aucun plan')}</span>}</td>
                  <td className="num tabular">{formatInt(a.counts.realised)}</td>
                  <td className="num tabular">{formatRate(a.rates.coverage.value, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!compact && onOpenTable && (
        <button type="button" className="btn btn-secondary btn-sm mapx-table-btn" onClick={onOpenTable}><Table2 size={14} aria-hidden="true" />{tr('Voir en tableau')}</button>
      )}
    </div>
  );
}
