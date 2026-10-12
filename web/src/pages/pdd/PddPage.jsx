import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, PackageOpen, Boxes, Layers, AlertTriangle, ChevronLeft, CalendarClock, ChevronRight as GoIcon } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, CardHeader, EmptyState, ExpandButton, Skeleton, Stats, Usage } from '../../components/ui.jsx';
import DataList from '../../components/DataList.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Plan de Distribution d'urgence (PDD). Trois vues :
 *  • Distributions — table fidèle à la feuille « PDD base » (lignes mois ×
 *    zone × activité × modalité avec bénéficiaires et tonnages), filtrable.
 *  • Synthèse — totaux par aléa, par mois, par zone (région→district→commune)
 *    et par denrée (reproduit les feuilles de synthèse du classeur).
 *  • Pipeline — besoin planifié vs stock disponible par denrée (écart,
 *    couverture, ruptures).
 * Réutilise les zones/bureaux/partenaires de MEMS (stockés en libellé) : pas
 * de référentiel dupliqué.
 */

const HAZARD = {
  drought: { label: 'Sécheresse', color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)' },
  cyclone: { label: 'Cyclone', color: 'var(--blue-600)', bg: 'var(--blue-50)', text: 'var(--blue-700)' },
  autre: { label: 'Autre', color: 'var(--text-muted)', bg: 'var(--surface-2)', text: 'var(--text-muted)' },
};
const hz = (k) => HAZARD[k] || HAZARD.autre;

const mtFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtMt = (n) => `${mtFmt.format(Number(n) || 0).replace(/ /g, ' ')} t`;
const fmtUsd = (n) => `${formatInt(Math.round(Number(n) || 0))} $`;
const pct = (r) => `${Math.round((Number(r) || 0) * 100)} %`;

function HazardBadge({ value }) {
  const { tr } = useI18n();
  const h = hz(value);
  return <span className="badge" style={{ background: h.bg, color: h.text }}><span className="dot" style={{ background: h.color }} />{tr(h.label)}</span>;
}

export default function PddPage({ canEdit, view, onNavigate }) {
  const sub = view || 'distributions';
  return (
    <div className="section-gap">
      {sub === 'distributions' && <DistributionsView canEdit={canEdit} onNavigate={onNavigate} />}
      {sub === 'synthese' && <SynthesisView />}
      {sub === 'pipeline' && <PipelineView canEdit={canEdit} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Distributions — table fidèle à la feuille « PDD base »
// ──────────────────────────────────────────────────────────────────────────
function DistributionsView({ canEdit, onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [commodities, setCommodities] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Navigation par mois (comme le plan de suivi) : d'abord un tableau des mois,
  // clic sur un mois → ses distributions.
  const [picking, setPicking] = useState(true);
  const [month, setMonth] = useState('');
  const fileRef = useRef(null);

  const reload = useCallback(() => {
    setRows(null);
    api.pddDistributions({}).then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { api.pddCommodities().then(setCommodities).catch(() => setCommodities([])); }, []);

  const downloadTemplate = () => api.downloadPddTemplate().catch((err) => toast.error(err.message));
  const onImport = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.pddImport(f);
      toast.success(r.skipped
        ? tr('{n} distribution(s) · {items} tonnage(s) importé(s) (feuille « {sheet} ») · {skipped} ligne(s) ignorée(s).', { n: r.inserted, items: r.items, sheet: r.sheet, skipped: r.skipped })
        : tr('{n} distribution(s) · {items} tonnage(s) importé(s) (feuille « {sheet} »).', { n: r.inserted, items: r.items, sheet: r.sheet }));
      reload();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  // Lignes du mois sélectionné (ou toutes, si aucun mois).
  const monthRows = useMemo(() => (month ? (rows || []).filter((r) => r.periodMonth === month) : rows), [rows, month]);

  const agg = (list) => {
    const s = { lines: 0, beneficiaries: 0, households: 0, cashUsd: 0, totalFood: 0 };
    for (const r of list || []) {
      s.lines += 1; s.beneficiaries += r.beneficiaries || 0; s.households += r.households || 0;
      s.cashUsd += Number(r.cashUsd) || 0; s.totalFood += Number(r.totalFood) || 0;
    }
    return s;
  };
  const stats = useMemo(() => agg(picking ? rows : monthRows), [rows, monthRows, picking]);

  // Un enregistrement par mois pour le tableau de navigation.
  const monthsAgg = useMemo(() => {
    const by = new Map();
    for (const r of rows || []) {
      if (!r.periodMonth) continue;
      if (!by.has(r.periodMonth)) by.set(r.periodMonth, { month: r.periodMonth, lines: 0, beneficiaries: 0, households: 0, cashUsd: 0, totalFood: 0, hazards: new Set() });
      const m = by.get(r.periodMonth);
      m.lines += 1; m.beneficiaries += r.beneficiaries || 0; m.households += r.households || 0;
      m.cashUsd += Number(r.cashUsd) || 0; m.totalFood += Number(r.totalFood) || 0;
      if (r.hazard) m.hazards.add(r.hazard);
    }
    return [...by.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [rows]);

  const openMonth = (mm) => { setMonth(mm); setPicking(false); };

  const foodCommodities = useMemo(() => commodities.filter((c) => c.kind !== 'cash'), [commodities]);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort().map((x) => ({ id: x, label: x }));

  const columns = useMemo(() => {
    const c = {
      periodMonth: { label: tr('Mois'), sortVal: (r) => r.periodMonth, csv: (r) => r.periodMonth, render: (r) => <span className="tabular">{monthLabel(r.periodMonth)}</span> },
      activity: { label: tr('Activité'), sortVal: (r) => r.activity || '', csv: (r) => r.activity || '', render: (r) => r.activity || '—' },
      hazard: { label: tr('Aléa'), sortVal: (r) => tr(hz(r.hazard).label), csv: (r) => tr(hz(r.hazard).label), render: (r) => <HazardBadge value={r.hazard} /> },
      region: { label: tr('Région'), sortVal: (r) => r.region || '', csv: (r) => r.region || '', render: (r) => r.region || '—' },
      district: { label: tr('District'), sortVal: (r) => r.district || '', csv: (r) => r.district || '', render: (r) => r.district || '—' },
      commune: { label: tr('Commune'), sortVal: (r) => r.commune || '', csv: (r) => r.commune || '', render: (r) => <strong>{r.commune || '—'}</strong> },
      antenne: { label: tr('Antenne'), sortVal: (r) => r.antenne || '', csv: (r) => r.antenne || '', render: (r) => r.antenne || <span className="cell-empty">—</span> },
      sousBureau: { label: tr('Sous-bureau'), sortVal: (r) => r.sousBureau || '', csv: (r) => r.sousBureau || '', render: (r) => r.sousBureau || <span className="cell-empty">—</span> },
      partner: { label: tr('Partenaire'), sortVal: (r) => r.partner || '', csv: (r) => r.partner || '', render: (r) => r.partner || <span className="cell-empty">—</span> },
      corridor: { label: tr('Corridor'), sortVal: (r) => r.corridor || '', csv: (r) => r.corridor || '', render: (r) => r.corridor || <span className="cell-empty">—</span> },
      modality: { label: tr('Modalité'), sortVal: (r) => r.modality || '', csv: (r) => r.modality || '', render: (r) => r.modality || '—' },
      beneficiaries: { label: tr('Bénéficiaires'), num: true, sortVal: (r) => r.beneficiaries || 0, csv: (r) => r.beneficiaries || 0, render: (r) => <span className="tabular">{formatInt(r.beneficiaries || 0)}</span> },
      households: { label: tr('Ménages'), num: true, sortVal: (r) => r.households || 0, csv: (r) => r.households || 0, render: (r) => <span className="tabular">{formatInt(r.households || 0)}</span> },
      totalFood: { label: tr('Vivres (t)'), num: true, sortVal: (r) => Number(r.totalFood) || 0, csv: (r) => Number(r.totalFood) || 0, render: (r) => <span className="tabular mono">{Number(r.totalFood) ? fmtMt(r.totalFood) : <span className="cell-empty">—</span>}</span> },
      cashUsd: { label: tr('Cash ($)'), num: true, sortVal: (r) => Number(r.cashUsd) || 0, csv: (r) => Number(r.cashUsd) || 0, render: (r) => <span className="tabular mono">{Number(r.cashUsd) ? fmtUsd(r.cashUsd) : <span className="cell-empty">—</span>}</span> },
    };
    // Une colonne (optionnelle) par denrée — fidèle aux colonnes du classeur.
    for (const cm of foodCommodities) {
      c[`cm_${cm.code}`] = {
        label: cm.label, num: true,
        sortVal: (r) => Number(r.items?.[cm.code]) || 0,
        csv: (r) => Number(r.items?.[cm.code]) || 0,
        render: (r) => { const q = Number(r.items?.[cm.code]) || 0; return <span className="tabular mono">{q ? mtFmt.format(q).replace(/ /g, ' ') : <span className="cell-empty">—</span>}</span>; },
      };
    }
    return c;
  }, [foodCommodities, tr]);

  const filters = useMemo(() => ({
    q: { label: tr('Recherche'), type: 'search', placeholder: tr('Commune, district, activité…'),
      match: (r, v) => [r.commune, r.district, r.region, r.activity, r.partner, r.antenne].some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) },
    month: { label: tr('Mois'), type: 'select',
      options: (rr) => [{ id: '', label: tr('Tous les mois') }, ...uniq((rr || []).map((r) => r.periodMonth)).map((o) => ({ id: o.id, label: monthLabel(o.id) }))],
      match: (r, v) => r.periodMonth === v },
    hazard: { label: tr('Aléa'), type: 'select',
      options: [{ id: '', label: tr('Tous les aléas') }, { id: 'drought', label: tr('Sécheresse') }, { id: 'cyclone', label: tr('Cyclone') }, { id: 'autre', label: tr('Autre') }],
      match: (r, v) => r.hazard === v },
    region: { label: tr('Région'), type: 'select', options: (rr) => [{ id: '', label: tr('Toutes les régions') }, ...uniq((rr || []).map((r) => r.region))],
      match: (r, v) => r.region === v },
    district: { label: tr('District'), type: 'select',
      options: (rr, vals) => [{ id: '', label: tr('Tous les districts') }, ...uniq((rr || []).filter((r) => !vals.region || r.region === vals.region).map((r) => r.district))],
      match: (r, v) => r.district === v },
    modality: { label: tr('Modalité'), type: 'select', options: (rr) => [{ id: '', label: tr('Toutes') }, ...uniq((rr || []).map((r) => r.modality))],
      match: (r, v) => r.modality === v },
  }), [tr]);

  const DEFAULT_COLS = ['periodMonth', 'activity', 'hazard', 'region', 'district', 'commune', 'modality', 'beneficiaries', 'households', 'totalFood', 'cashUsd'];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tr("Distribution d'urgence — distributions")}</h1>
          <p className="page-desc">{picking
            ? tr('Choisissez un mois pour ouvrir son plan de distribution (vivres & cash par zone et activité).')
            : tr('Plan de distribution du mois : table fidèle au classeur, filtrable et exportable.')}</p>
        </div>
        <div className="header-actions">
          {!picking && <Button variant="secondary" icon={ChevronLeft} onClick={() => { setPicking(true); setMonth(''); }}>{tr('Tous les mois')}</Button>}
          {canEdit && <>
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={onImport} />
            <Button variant="ghost" icon={Download} onClick={downloadTemplate}
              title={tr("Classeur vierge au format exact de l'import (feuille « PDD base » + feuille « Lisez-moi » qui décrit chaque colonne).")}>{tr('Modèle PDD')}</Button>
            <Button variant="secondary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}
              title={tr('Importe la feuille « PDD base » : mois, zone, activité, bénéficiaires, tonnages. Réimport idempotent (les mois du fichier sont remplacés).')}>{tr('Importer le PDD')}</Button>
          </>}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {picking ? (
        <PddMonthsTable data={rows === null ? null : monthsAgg} total={stats} onOpen={openMonth}
          canEdit={canEdit} onTemplate={downloadTemplate} onImport={() => fileRef.current?.click()} />
      ) : (
        <>
          <div className="month-active-bar">
            <strong>{monthLabel(month)}</strong>
            <span className="muted">{tr('— plan de distribution du mois')}</span>
          </div>

          <Stats compact items={[
            { label: tr('Lignes'), value: formatInt(stats.lines), foot: tr('Distributions du mois') },
            { label: tr('Bénéficiaires'), value: formatInt(stats.beneficiaries), foot: tr('Toutes modalités') },
            { label: tr('Ménages'), value: formatInt(stats.households), foot: tr('Toutes modalités') },
            { label: tr('Vivres'), value: fmtMt(stats.totalFood), foot: tr('Tonnage du mois') },
            { label: tr('Cash (CBT)'), value: fmtUsd(stats.cashUsd), foot: tr('Transferts monétaires') },
          ]} />

          <DataList
            rows={monthRows} columns={columns} defaultColumns={DEFAULT_COLS}
            filters={filters} defaultFilters={['q', 'hazard', 'region', 'district']}
            storageKey="mems.pdd.dist.view.v2" pageSize={15} defaultSort={{ key: 'beneficiaries', dir: 'desc' }}
            csvName={`pdd_distributions_${month}.csv`} emptyIcon={PackageOpen} emptyTitle={tr('Aucune distribution ce mois-ci')}
            emptyChildren={canEdit ? tr('Importez un fichier PDD (.xlsx) pour alimenter le module.') : tr('Aucune distribution importée pour ce mois.')}
          />

          <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={14} aria-hidden="true" />
            <span>{tr('Zones (région/district/commune), bureaux (antenne/sous-bureau) et partenaires sont les mêmes référentiels que le reste de MEMS.')}{' '}
              {tr('Voir la {synthese} et le {pipeline}.').split(/(\{synthese\}|\{pipeline\})/).map((part, i) => (
                part === '{synthese}' ? <button key={i} type="button" className="link-cell" onClick={() => onNavigate?.('pdd', 'synthese')}>{tr('Synthèse')}</button>
                  : part === '{pipeline}' ? <button key={i} type="button" className="link-cell" onClick={() => onNavigate?.('pdd', 'pipeline')}>{tr('Pipeline')}</button>
                    : part))}</span>
          </p>
        </>
      )}
    </>
  );
}

// Tableau des mois : une ligne par mois avec ses totaux ; clic → distributions.
function PddMonthsTable({ data, total, onOpen, canEdit, onTemplate, onImport }) {
  const { tr } = useI18n();
  if (data === null) return <Card><div className="card-body"><Skeleton height={280} /></div></Card>;
  if (data.length === 0) {
    return (
      <Card>
        <EmptyState icon={PackageOpen} title={tr('Aucune distribution')}
          action={canEdit && (
            <div className="header-actions" style={{ justifyContent: 'center' }}>
              <Button variant="secondary" icon={Download} onClick={onTemplate}>{tr('1 · Télécharger le modèle')}</Button>
              <Button icon={Upload} onClick={onImport}>{tr('2 · Importer le fichier rempli')}</Button>
            </div>
          )}>
          {tr("Le plan de distribution s'alimente depuis un classeur Excel (feuille « PDD base » : une ligne par distribution — mois, zone, activité, bénéficiaires, tonnage par denrée, cash). Le modèle contient les colonnes à leur place exacte, des listes de contrôle à la saisie et une feuille « Lisez-moi » qui décrit chaque colonne. Réimporter un mois remplace ses distributions.")}
        </EmptyState>
      </Card>
    );
  }
  const maxBen = Math.max(...data.map((m) => m.beneficiaries), 1);
  return (
    <div className="card biz-card months-card">
      <div className="months-head">
        <span className="months-year">{tr('Plan de distribution — par mois')}</span>
        <div className="months-head-sum">
          <span><strong className="tabular">{formatInt(data.length)}</strong> {tr('mois')}</span>
          <span><strong className="tabular">{formatInt(total.beneficiaries)}</strong> {tr('bénéficiaires')}</span>
          <span><strong className="tabular">{fmtMt(total.totalFood)}</strong> {tr('vivres')}</span>
        </div>
      </div>
      <div className="table-wrap"><table className="table grid months-grid">
        <thead><tr>
          <th>{tr('Mois')}</th><th>{tr('Aléas')}</th><th className="num">{tr('Lignes')}</th><th className="num">{tr('Bénéficiaires')}</th>
          <th className="num">{tr('Ménages')}</th><th className="num">{tr('Vivres (t)')}</th><th className="num">{tr('Cash ($)')}</th>
          <th>{tr('Part bénéficiaires')}</th><th aria-label={tr('Action')} />
        </tr></thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.month} className="clickable month-row" onClick={() => onOpen(m.month)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m.month); }} tabIndex={0} aria-label={tr('Ouvrir {month}', { month: monthLabel(m.month) })}>
              <td><span className="month-name">{monthLabel(m.month)}</span></td>
              <td>{[...m.hazards].map((h) => <HazardBadge key={h} value={h} />)}</td>
              <td className="num tabular">{formatInt(m.lines)}</td>
              <td className="num tabular"><strong>{formatInt(m.beneficiaries)}</strong></td>
              <td className="num tabular">{formatInt(m.households)}</td>
              <td className="num tabular">{m.totalFood ? fmtMt(m.totalFood) : '—'}</td>
              <td className="num tabular">{m.cashUsd ? fmtUsd(m.cashUsd) : '—'}</td>
              <td><span className="mini-bar"><span style={{ width: `${Math.round((m.beneficiaries / maxBen) * 100)}%`, background: 'var(--blue-600)' }} /></span></td>
              <td className="num">
                <button type="button" className="btn btn-sm btn-secondary month-open" onClick={(e) => { e.stopPropagation(); onOpen(m.month); }}>
                  {tr('Ouvrir')}<GoIcon size={15} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="note"><CalendarClock size={18} aria-hidden="true" /><span>{tr('Cliquez un mois (ou « Ouvrir ») pour accéder à ses distributions détaillées.')}</span></div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Synthèse — par aléa, par mois, par zone, par denrée
// ──────────────────────────────────────────────────────────────────────────
function SynthesisView() {
  const { tr } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => { api.pddSummary({}).then(setData).catch((e) => setError(e.message)); }, []);

  const toggle = (key) => setOpen((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return (
    <>
      <div className="page-header"><div><h1 className="page-title">{tr("Distribution d'urgence — synthèse")}</h1><p className="page-desc">{tr('Chargement…')}</p></div></div>
      <Card><div className="card-body"><Skeleton height={200} /></div></Card>
    </>
  );

  const { total, byHazard, byMonth, byZone } = data;
  const months = Object.keys(byMonth || {}).sort();
  const hazards = Object.keys(byHazard || {});
  const commodityTotals = Object.entries(total.byCommodity || {}).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tr("Distribution d'urgence — synthèse")}</h1>
          <p className="page-desc">{tr('Totaux recalculés en direct : par aléa, par mois, par zone (région → district → commune) et par denrée.')}</p>
        </div>
      </div>

      <Stats compact items={[
        { label: tr('Lignes'), value: formatInt(total.lines), foot: tr('Distributions') },
        { label: tr('Bénéficiaires'), value: formatInt(total.beneficiaries), foot: tr('Toutes zones') },
        { label: tr('Ménages'), value: formatInt(total.households), foot: tr('Toutes zones') },
        { label: tr('Vivres'), value: fmtMt(total.totalFood), foot: tr('Tonnage total') },
        { label: tr('Cash (CBT)'), value: fmtUsd(total.cashUsd), foot: tr('Transferts monétaires') },
      ]} />

      <div className="pdd-two">
        <Card aria-labelledby="pdd-hz">
          <CardHeader id="pdd-hz" title={tr('Par aléa')} subtitle={tr('Réponse par type de choc.')} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">{tr('Aléa')}</th><th scope="col" className="num">{tr('Lignes')}</th><th scope="col" className="num">{tr('Bénéficiaires')}</th><th scope="col" className="num">{tr('Vivres (t)')}</th><th scope="col" className="num">{tr('Cash ($)')}</th></tr></thead>
              <tbody>
                {hazards.map((k) => (
                  <tr key={k}>
                    <td><HazardBadge value={k} /></td>
                    <td className="num mono">{formatInt(byHazard[k].lines)}</td>
                    <td className="num mono">{formatInt(byHazard[k].beneficiaries)}</td>
                    <td className="num mono">{byHazard[k].totalFood ? fmtMt(byHazard[k].totalFood) : '—'}</td>
                    <td className="num mono">{byHazard[k].cashUsd ? fmtUsd(byHazard[k].cashUsd) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card aria-labelledby="pdd-mo">
          <CardHeader id="pdd-mo" title={tr('Par mois')} subtitle={tr('Échelonnement de la réponse dans le temps.')} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">{tr('Mois')}</th><th scope="col" className="num">{tr('Lignes')}</th><th scope="col" className="num">{tr('Bénéficiaires')}</th><th scope="col" className="num">{tr('Vivres (t)')}</th><th scope="col" className="num">{tr('Cash ($)')}</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m}>
                    <td className="tabular">{monthLabel(`${m}-01`.slice(0, 7))}</td>
                    <td className="num mono">{formatInt(byMonth[m].lines)}</td>
                    <td className="num mono">{formatInt(byMonth[m].beneficiaries)}</td>
                    <td className="num mono">{byMonth[m].totalFood ? fmtMt(byMonth[m].totalFood) : '—'}</td>
                    <td className="num mono">{byMonth[m].cashUsd ? fmtUsd(byMonth[m].cashUsd) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card aria-labelledby="pdd-zone">
        <CardHeader id="pdd-zone" title={tr('Par zone')} subtitle={tr('Région → district → commune. Cliquez pour déplier.')} />
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{tr('Zone')}</th><th scope="col" className="num">{tr('Lignes')}</th><th scope="col" className="num">{tr('Bénéficiaires')}</th><th scope="col" className="num">{tr('Ménages')}</th><th scope="col" className="num">{tr('Vivres (t)')}</th><th scope="col" className="num">{tr('Cash ($)')}</th></tr></thead>
            <tbody>
              {byZone.map((R) => {
                const rk = `r:${R.name}`; const rOpen = open.has(rk);
                return (
                  <React.Fragment key={rk}>
                    <tr className={rOpen ? 'is-expanded' : ''}>
                      <td>
                        <ExpandButton expanded={rOpen} onClick={() => toggle(rk)} label={R.name} />
                        <strong style={{ marginLeft: 6 }}>{R.name}</strong>
                      </td>
                      <td className="num mono">{formatInt(R.lines)}</td>
                      <td className="num mono"><strong>{formatInt(R.beneficiaries)}</strong></td>
                      <td className="num mono">{formatInt(R.households)}</td>
                      <td className="num mono">{R.totalFood ? fmtMt(R.totalFood) : '—'}</td>
                      <td className="num mono">{R.cashUsd ? fmtUsd(R.cashUsd) : '—'}</td>
                    </tr>
                    {rOpen && R.districts.map((D) => {
                      const dk = `d:${R.name}:${D.name}`; const dOpen = open.has(dk);
                      return (
                        <React.Fragment key={dk}>
                          <tr className="subrow">
                            <td style={{ paddingLeft: 28 }}>
                              <ExpandButton expanded={dOpen} onClick={() => toggle(dk)} label={D.name} />
                              <span style={{ marginLeft: 6 }}>{D.name}</span>
                            </td>
                            <td className="num mono">{formatInt(D.lines)}</td>
                            <td className="num mono">{formatInt(D.beneficiaries)}</td>
                            <td className="num mono">{formatInt(D.households)}</td>
                            <td className="num mono">{D.totalFood ? fmtMt(D.totalFood) : '—'}</td>
                            <td className="num mono">{D.cashUsd ? fmtUsd(D.cashUsd) : '—'}</td>
                          </tr>
                          {dOpen && D.communes.map((C) => (
                            <tr key={`c:${dk}:${C.name}`} className="subrow">
                              <td style={{ paddingLeft: 56 }} className="muted">{C.name}</td>
                              <td className="num mono">{formatInt(C.lines)}</td>
                              <td className="num mono">{formatInt(C.beneficiaries)}</td>
                              <td className="num mono">{formatInt(C.households)}</td>
                              <td className="num mono">{C.totalFood ? fmtMt(C.totalFood) : '—'}</td>
                              <td className="num mono">{C.cashUsd ? fmtUsd(C.cashUsd) : '—'}</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card aria-labelledby="pdd-cm">
        <CardHeader id="pdd-cm" title={tr('Par denrée')} subtitle={tr('Tonnage total planifié par produit.')} />
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{tr('Denrée')}</th><th scope="col" className="num">{tr('Tonnage (t)')}</th><th scope="col">{tr('Part')}</th></tr></thead>
            <tbody>
              {commodityTotals.length === 0 && <tr><td colSpan={3}><EmptyState icon={Boxes} title={tr('Aucune denrée')}>{tr("Les tonnages apparaissent dès qu'un PDD est importé.")}</EmptyState></td></tr>}
              {commodityTotals.map(([name, qty]) => {
                const max = commodityTotals[0][1] || 1;
                return (
                  <tr key={name}>
                    <td><strong>{name}</strong></td>
                    <td className="num mono">{fmtMt(qty)}</td>
                    <td style={{ minWidth: 160 }}><Usage rate={qty / max} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline — besoin planifié vs stock disponible, par denrée
// ──────────────────────────────────────────────────────────────────────────
function PipelineView({ canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState('');
  const [months, setMonths] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({}); // commodity -> { available, donor }

  useEffect(() => { api.pddSummary({}).then((s) => setMonths(s.months || [])).catch(() => setMonths([])); }, []);
  const reload = useCallback(() => {
    setRows(null); setDraft({});
    api.pddPipeline(month).then(setRows).catch((e) => setError(e.message));
  }, [month]);
  useEffect(() => { reload(); }, [reload]);

  const saveStock = async (commodity) => {
    if (!month) { toast.error(tr("Choisissez d'abord un mois pour saisir le stock.")); return; }
    const d = draft[commodity] || {};
    const row = (rows || []).find((r) => r.commodity === commodity) || {};
    const availableMt = d.available != null ? Number(d.available) : Number(row.available) || 0;
    const donor = d.donor != null ? d.donor : (row.donor || '');
    try {
      await api.pddSetStock({ month, commodity, availableMt: Math.max(0, availableMt || 0), donor });
      toast.success(tr('Stock « {commodity} » enregistré.', { commodity }));
      reload();
    } catch (e) { toast.error(e.message); }
  };

  const totals = useMemo(() => {
    const t = { need: 0, available: 0, shortfalls: 0 };
    for (const r of rows || []) { t.need += r.need || 0; t.available += r.available || 0; if (r.shortfall) t.shortfalls += 1; }
    return t;
  }, [rows]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tr("Distribution d'urgence — pipeline")}</h1>
          <p className="page-desc">{tr('Besoin planifié (tonnages du PDD) confronté au stock disponible, par denrée : écart, couverture et ruptures.')}</p>
        </div>
        <div className="header-actions">
          <select className="select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={tr('Mois')}>
            <option value="">{tr('Tous les mois')}</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Stats compact items={[
        { label: tr('Besoin total'), value: rows ? fmtMt(totals.need) : '—', foot: tr('Tonnage planifié') },
        { label: tr('Stock disponible'), value: rows ? fmtMt(totals.available) : '—', foot: tr('Saisi') },
        { label: tr('Couverture'), value: rows ? pct(totals.need > 0 ? totals.available / totals.need : (totals.available > 0 ? 1 : 0)) : '—', foot: tr('Dispo / besoin') },
        { label: tr('Ruptures'), value: rows ? formatInt(totals.shortfalls) : '—', foot: tr('Denrées en déficit') },
      ]} />

      <Card aria-labelledby="pdd-pipe">
        <CardHeader id="pdd-pipe" title={tr('Pipeline par denrée')} subtitle={canEdit ? tr("Saisissez le stock disponible et le donateur pour calculer l'écart.") : tr('Lecture seule.')} />
        {rows === null ? (
          <div className="card-body"><Skeleton height={160} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Boxes} title={tr('Aucun besoin')} >{tr('Importez un PDD (onglet Distributions) pour alimenter le pipeline.')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr('Denrée')}</th>
                  <th scope="col" className="num">{tr('Besoin (t)')}</th>
                  <th scope="col" className="num">{tr('Disponible (t)')}</th>
                  <th scope="col" className="num">{tr('Écart (t)')}</th>
                  <th scope="col">{tr('Couverture')}</th>
                  <th scope="col">{tr('Donateur')}</th>
                  <th scope="col">{tr('Statut')}</th>
                  {canEdit && <th scope="col" aria-label={tr('Actions')} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = draft[r.commodity] || {};
                  const availVal = d.available != null ? d.available : (r.available ?? 0);
                  const donorVal = d.donor != null ? d.donor : (r.donor || '');
                  return (
                    <tr key={r.commodity} className={r.shortfall ? 'row-due' : ''}>
                      <td><strong>{r.commodity}</strong></td>
                      <td className="num mono">{fmtMt(r.need)}</td>
                      <td className="num mono">
                        {canEdit && month
                          ? <input className="input" type="number" min="0" step="0.001" style={{ width: 110, textAlign: 'right' }}
                              value={availVal} onChange={(e) => setDraft({ ...draft, [r.commodity]: { ...d, available: e.target.value } })}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveStock(r.commodity); }} aria-label={tr('Stock {commodity}', { commodity: r.commodity })} />
                          : fmtMt(r.available)}
                        {!month && r.stockMonth && <div className="site-meta">{tr('stock au {m}', { m: monthLabel(`${r.stockMonth}`) })}</div>}
                      </td>
                      <td className="num mono">{r.shortfall ? <span style={{ color: 'var(--red)' }}>{mtFmt.format(r.gap)}</span> : mtFmt.format(r.gap)}</td>
                      <td style={{ minWidth: 140 }}><Usage rate={r.coverage} /></td>
                      <td>
                        {canEdit && month
                          ? <input className="input" type="text" style={{ width: 150 }} placeholder={tr('Donateur')}
                              value={donorVal} onChange={(e) => setDraft({ ...draft, [r.commodity]: { ...d, donor: e.target.value } })}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveStock(r.commodity); }} aria-label={tr('Donateur {commodity}', { commodity: r.commodity })} />
                          : (r.donor || <span className="cell-empty">—</span>)}
                      </td>
                      <td>{r.shortfall
                        ? <span className="badge" style={{ background: 'var(--red-bg)', color: 'var(--red-text)' }}><span className="dot" style={{ background: 'var(--red)' }} />{tr('Rupture')}</span>
                        : <span className="badge" style={{ background: 'var(--green-bg)', color: 'var(--green-text)' }}><span className="dot" style={{ background: 'var(--green)' }} />{tr('Couvert')}</span>}</td>
                      {canEdit && <td><Button size="sm" variant="secondary" onClick={() => saveStock(r.commodity)}>{tr('Enregistrer')}</Button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!month && <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} aria-hidden="true" />
        <span>{tr('Le stock se saisit par mois. Choisissez un mois ci-dessus pour enregistrer les quantités disponibles et leur donateur.')}</span>
      </p>}
    </>
  );
}
