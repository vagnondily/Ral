import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownCircle, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Columns3, Download, FileSpreadsheet,
  Filter, Layers, ListChecks, Map as MapIcon, PauseCircle, Plus, RotateCcw, Save, Search, ShieldAlert, Upload, X, CalendarRange,
} from 'lucide-react';
import L from 'leaflet';
import { TILES_URL, probeTiles } from '../../components/map/TileUnderlay.jsx';
import { loadGeo } from '../../components/map/useMapData.js';
import 'leaflet/dist/leaflet.css';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, Field, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, formatLocale, monthLabel } from '../../lib/format.js';
import { applyPending, boardKpis, monthTotals, pendingKey, rateTone, visitRate } from '../../lib/planBoard.js';
import PlanAutoDrawer from './PlanAutoDrawer.jsx';
import './planBoard.css';
import TpmZoneCell from './TpmZoneCell.jsx';

/**
 * Plan de suivi « type Excel » (classeur RBM) : par exercice, chaque site porte
 * ses visites exigées par le MMR de son bureau × activité, faites, prévues et
 * le reste ; on planifie en cochant les mois. Quatre vues : sites proposés
 * (classés) avec la grille des mois, registre complet (vue standard), déjà
 * visités, carte (fond libre, sans clé d'API). Modification groupée, ajout de
 * site, gabarit d'activité, export / import Excel avec aperçu. Les calculs
 * font foi côté serveur ; l'écran ne fait que refléter les coches en attente.
 */
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const PAGE = 100;
const PRIORITY = {
  Haute: { tone: 'red', icon: AlertTriangle }, Moyenne: { tone: 'orange', icon: CircleDot }, Basse: { tone: 'green', icon: ArrowDownCircle },
};
const SECURITY = { 0: 'Aucune restriction', 1: 'Restriction modérée', 3: 'Restriction stricte', 99: 'Zone interdite' };
const COLS_KEY = 'mems.planBoard.cols';
const shortMonth = (m) => new Date(Date.UTC(2026, m - 1, 1)).toLocaleString(formatLocale(), { month: 'short', timeZone: 'UTC' });
const thisYear = () => new Date().getFullYear();

const ALL_VIEWS = ['plan', 'standard', 'visited', 'map'];

/**
 * `views` : vues proposées par l'onglet qui l'affiche (retour du 14/10) — le
 * « Plan de suivi » montre le plan, les sites déjà visités et la carte ; la vue
 * standard (critères de risque des sites) vit dans « Configuration RBM ».
 */
export default function PlanBoardPage({ canEdit, embedded = false, initialView = 'plan', views = ALL_VIEWS }) {
  const { t, tr } = useI18n();
  const toast = useToast();
  const [year, setYear] = useState(thisYear);
  const [adjusted, setAdjusted] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(initialView);
  const [filters, setFilters] = useState({ q: '', bureau: '', district: '', commune: '', activity: '', status: '', priority: '' });
  const [pending, setPending] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null); // 'bulk' | 'add' | 'template' | { import }
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.planBoard(year, { adjusted })); } catch (e) { setError(e.message); }
  }, [year, adjusted]);
  useEffect(() => { setData(null); setPending({}); setSelected(new Set()); load(); }, [load]);

  const refs = data?.refs || { activities: [], poiSubtypes: [], modalities: [] };
  const pendingCount = Object.keys(pending).length;
  useEffect(() => {
    if (!pendingCount) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  const original = useMemo(() => new Map((data?.sites || []).map((s) => [s.id, s])), [data]);
  const sites = useMemo(() => applyPending(data?.sites || [], pending), [data, pending]);
  const options = useMemo(() => {
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fr'));
    return {
      bureaux: uniq(sites.map((s) => s.bureau)), districts: uniq(sites.map((s) => s.district)),
      communes: uniq(sites.filter((s) => !filters.district || s.district === filters.district).map((s) => s.commune)),
      activities: uniq(sites.map((s) => s.activity)),
    };
  }, [sites, filters.district]);
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return sites.filter((s) => (!q || [s.publicId, s.locationId, s.name, s.commune, s.district].some((v) => String(v || '').toLowerCase().includes(q)))
      && (!filters.bureau || s.bureau === filters.bureau) && (!filters.district || s.district === filters.district)
      && (!filters.commune || s.commune === filters.commune) && (!filters.activity || s.activity === filters.activity)
      && (!filters.status || (filters.status === 'none' ? !s.status : s.status === filters.status))
      && (!filters.priority || s.priority === filters.priority));
  }, [sites, filters]);
  const kpis = useMemo(() => boardKpis(filtered), [filtered]);
  const rows = useMemo(() => {
    if (view === 'plan') return filtered.filter((s) => !s.inactive && !s.forbidden);
    if (view === 'visited') return filtered.filter((s) => s.done > 0);
    return filtered;
  }, [filtered, view]);
  useEffect(() => { setPage(1); }, [filters, view]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v, ...(k === 'district' ? { commune: '' } : {}) }));
  const activeFilters = Object.entries(filters).filter(([, v]) => v).length;

  function toggleMonth(site, month, planned) {
    const base = original.get(site.id);
    const was = (base.months || []).some((m) => m.month === month && m.status === 'planifie');
    setPending((p) => {
      const n = { ...p }; const k = pendingKey(site.id, month);
      if (planned === was) delete n[k]; else n[k] = planned;
      return n;
    });
  }

  async function savePlan() {
    setSaving(true);
    try {
      const changes = Object.entries(pending).map(([k, planned]) => { const [siteId, m] = k.split('|'); return { siteId, month: Number(m), planned }; });
      const r = await api.planBoardSetMonths({ year, changes });
      toast.success(tr('Planification enregistrée : {a} visite(s) ajoutée(s), {r} retirée(s).', { a: r.added, r: r.removed }));
      if (r.skippedInactive) toast.error(tr('{n} mois inactif(s) non planifié(s).', { n: r.skippedInactive }));
      setPending({}); await load();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allSelected) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.add(r.id)); return n; });

  async function onImportFile(file) {
    if (!file) return;
    try { setModal({ import: { file, preview: await api.planBoardImport(file, { commit: false }) } }); } catch (e) { toast.error(e.message); }
    if (fileRef.current) fileRef.current.value = '';
  }

  const years = [thisYear() + 1, thisYear(), thisYear() - 1, thisYear() - 2];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="section-gap pb">
      <div className="page-header">
        <div>
          {!embedded && <h1 className="page-title">{tr('Plan de suivi')}</h1>}
          <p className="page-desc">{tr('Visites exigées par le MMR de chaque site (bureau × activité), faites, prévues et restantes sur l\'exercice ; planifiez en cochant les mois.')}</p>
        </div>
        <div className="header-actions">
          <label className="pb-year"><span>{tr('Exercice')}</span>
            <select className="select" value={year} onChange={(e) => { if (!pendingCount || window.confirm(tr('Abandonner les modifications non enregistrées ?'))) setYear(Number(e.target.value)); }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="check pb-adjusted" title={tr('Visites exigées selon la fréquence « CO adjusted » du MMR (ce que la capacité permet), arrondie à l\'entier supérieur.')}>
            <input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} /> {tr('Fréquence ajustée')}
          </label>
          <Button variant="secondary" icon={Download} onClick={() => api.planBoardExport(year).catch((e) => toast.error(e.message))}>{tr('Exporter')}</Button>
          {canEdit && <>
            <Button variant="secondary" icon={CalendarRange} onClick={() => setModal('autoplan')}>{tr('Planifier (période)')}</Button>
            <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setModal('template')}>{tr('Gabarit d\'activité')}</Button>
            <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>{tr('Importer')}</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => onImportFile(e.target.files[0])} />
            <Button icon={Plus} onClick={() => setModal('add')}>{tr('Ajouter un site')}</Button>
          </>}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? <Skeleton height={420} /> : <>
        <Stats items={[
          { label: tr('Total des sites'), value: formatInt(kpis.total) },
          { label: tr('Sites actifs'), value: formatInt(kpis.active) },
          { label: tr('Sites planifiés'), value: formatInt(kpis.planned) },
          { label: tr('Sites à visiter'), value: formatInt(kpis.toVisit) },
          { label: tr('Sites suivis'), value: formatInt(kpis.followed) },
          { label: tr('Sites alimentés'), value: formatInt(kpis.fed), foot: tr('données reçues') },
        ]} />
        <Stats compact items={[
          { label: tr('Visites restant à faire'), value: formatInt(kpis.remainingVisits) },
          { label: tr('dont non encore planifiées'), value: formatInt(kpis.notYetPlanned) },
          { label: tr('Sites sans aucun plan'), value: formatInt(kpis.withoutPlan) },
          { label: tr('Jamais visités'), value: formatInt(kpis.neverVisited) },
          { label: tr('MMR de l\'exercice'), value: kpis.mmrRate == null ? '—' : `${kpis.mmrRate.toLocaleString(formatLocale())} %`,
            foot: tr('{d} / {r} visites exigées', { d: formatInt(kpis.doneVisits), r: formatInt(kpis.requiredVisits) }),
            children: <span className={`pb-tone pb-tone-${rateTone(kpis.mmrRate)}`} aria-hidden="true" /> },
          { label: tr('Sans paramètre MMR'), value: formatInt(kpis.unparametered), foot: tr('activité absente du MMR') },
        ]} />

        <Card className="pb-card">
          <div className="pb-filters" role="search">
            <label className="pb-search"><Search size={15} aria-hidden="true" />
              <input className="input" value={filters.q} placeholder={tr('ID, localité, commune…')} aria-label={tr('Rechercher')} onChange={(e) => setFilter('q', e.target.value)} />
            </label>
            <FilterSelect label={tr('Bureau')} value={filters.bureau} onChange={(v) => setFilter('bureau', v)} options={options.bureaux} all={tr('Tous les bureaux')} />
            <FilterSelect label={tr('District')} value={filters.district} onChange={(v) => setFilter('district', v)} options={options.districts} all={tr('Tous les districts')} />
            <FilterSelect label={tr('Commune')} value={filters.commune} onChange={(v) => setFilter('commune', v)} options={options.communes} all={tr('Toutes les communes')} />
            <FilterSelect label={tr('Activité')} value={filters.activity} onChange={(v) => setFilter('activity', v)} options={options.activities} all={tr('Toutes les activités')} />
            <FilterSelect label={tr('Statut')} value={filters.status} onChange={(v) => setFilter('status', v)} all={tr('Tous les statuts')}
              options={[['Active', tr('Active')], ['Inactive', tr('Inactive')], ['none', tr('Non renseigné')]]} />
            <FilterSelect label={tr('Priorité')} value={filters.priority} onChange={(v) => setFilter('priority', v)} all={tr('Toutes les priorités')}
              options={Object.keys(PRIORITY).map((p) => [p, t(`priority.${p}`, p)])} />
            {activeFilters > 0 && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setFilters({ q: '', bureau: '', district: '', commune: '', activity: '', status: '', priority: '' })}>{tr('Réinitialiser')}</Button>}
          </div>

          <div className="pb-viewbar">
            {views.length > 1 && (
              <div className="segmented" role="tablist" aria-label={tr('Vue')}>
                {[['plan', tr('Plan de suivi'), ListChecks], ['standard', tr('Vue standard'), Columns3], ['visited', tr('Déjà visités'), CheckCircle2], ['map', tr('Carte'), MapIcon]]
                  .filter(([k]) => views.includes(k)).map(([k, l, Icon]) => (
                    <button key={k} type="button" role="tab" aria-selected={view === k} aria-pressed={view === k} onClick={() => setView(k)}><Icon size={14} aria-hidden="true" /> {l}</button>
                  ))}
              </div>
            )}
            <span className="pb-count">{tr('{n} site(s)', { n: formatInt(rows.length) })}{view === 'plan' ? ` · ${tr('classés par reste à faire, priorité puis ancienneté')}` : ''}</span>
            {view === 'standard' && <ColumnChooser />}
          </div>

          {selected.size > 0 && canEdit && view !== 'map' && (
            <div className="pb-selbar" role="region" aria-label={tr('Sélection')}>
              <strong>{tr('{n} site(s) sélectionné(s)', { n: formatInt(selected.size) })}</strong>
              <Button size="sm" icon={Layers} onClick={() => setModal('bulk')}>{tr('Modification groupée')}</Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>{tr('Désélectionner')}</Button>
            </div>
          )}

          {view === 'map' ? <PlanMap sites={filtered} /> : rows.length === 0 ? (
            <p className="pb-empty">{view === 'visited' ? tr('Aucun site visité sur l\'exercice dans ce périmètre.') : tr('Aucun site dans ce périmètre.')}</p>
          ) : (
            <div className="table-wrap pb-table-wrap">
              {view === 'plan' && <PlanTable rows={pageRows} offset={(page - 1) * PAGE} allRows={rows} capacity={data.capacity} pending={pending}
                canEdit={canEdit} selected={selected} onSelect={toggleSel} allSelected={allSelected} onSelectAll={toggleAll} onToggle={toggleMonth} />}
              {view === 'standard' && <StandardTable rows={pageRows} selected={selected} onSelect={toggleSel} allSelected={allSelected} onSelectAll={toggleAll} canEdit={canEdit} />}
              {view === 'visited' && <VisitedTable rows={pageRows} year={year} selected={selected} onSelect={toggleSel} allSelected={allSelected} onSelectAll={toggleAll} canEdit={canEdit} />}
            </div>
          )}
          {view !== 'map' && totalPages > 1 && (
            <div className="pager">
              <button type="button" className="pager-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={tr('Page précédente')}><ChevronLeft size={16} /></button>
              <span className="pager-info">{tr('Page {p} / {t}', { p: page, t: totalPages })}</span>
              <button type="button" className="pager-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label={tr('Page suivante')}><ChevronRight size={16} /></button>
            </div>
          )}
        </Card>

        {pendingCount > 0 && (
          <div className="mmr-savebar pb-savebar">
            <span>{tr('{n} modification(s) de planification non enregistrée(s)', { n: pendingCount })}</span>
            <Button variant="secondary" onClick={() => setPending({})}>{tr('Annuler')}</Button>
            <Button icon={Save} loading={saving} onClick={savePlan}>{tr('Enregistrer')}</Button>
          </div>
        )}
      </>}

      {modal === 'bulk' && <BulkModal year={year} siteIds={[...selected]} refs={refs} onClose={() => setModal(null)}
        onDone={async () => { setModal(null); setSelected(new Set()); setPending({}); await load(); }} />}
      {modal === 'add' && <AddSiteModal refs={refs} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); }} />}
      {modal === 'autoplan' && <PlanAutoDrawer year={year} onClose={() => setModal(null)} onDone={async () => { setModal(null); setPending({}); await load(); }} />}
      {modal === 'template' && <TemplateModal year={year} refs={refs} onClose={() => setModal(null)} />}
      {modal?.import && <ImportModal state={modal.import} onClose={() => setModal(null)} onDone={async () => { setModal(null); setPending({}); await load(); }} />}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, all }) {
  return (
    <select className={`select pb-filter ${value ? 'is-set' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label}>
      <option value="">{all}</option>
      {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}

function PriorityBadge({ value }) {
  const { t } = useI18n();
  const p = PRIORITY[value];
  return p ? <Badge tone={p.tone} icon={p.icon}>{t(`priority.${value}`, value)}</Badge> : <span className="muted">—</span>;
}

function StatusCell({ site }) {
  const { tr } = useI18n();
  if (site.forbidden) return <Badge tone="red" icon={ShieldAlert}>{tr('Zone interdite')}</Badge>;
  if (site.status === 'Active') return <Badge tone="green" icon={CheckCircle2}>{tr('Active')}</Badge>;
  if (site.status === 'Inactive') return <Badge icon={PauseCircle}>{tr('Inactive')}</Badge>;
  // Aucun mois renseigné : le site compte comme actif (planifiable) — on le dit au lieu d'un « — ».
  return <span className="muted" title={tr('Aucun statut saisi pour l\'exercice : le site est considéré comme actif.')}>{tr('Active (par défaut)')}</span>;
}

const lastVisit = (s) => (s.lastVisitMonth ? monthLabel(s.lastVisitMonth) : null);

function SelectCell({ id, selected, onSelect, label }) {
  return <td className="pb-cb pb-stick"><input type="checkbox" checked={selected.has(id)} onChange={() => onSelect(id)} aria-label={label} /></td>;
}
function SelectAllHead({ allSelected, onSelectAll, label }) {
  return <th scope="col" className="pb-cb pb-stick"><input type="checkbox" checked={allSelected} onChange={onSelectAll} aria-label={label} /></th>;
}

/* ------------------------------------------------------------- Sites proposés + grille des mois */
function PlanTable({ rows, offset, allRows, capacity, pending, canEdit, selected, onSelect, allSelected, onSelectAll, onToggle }) {
  const { tr } = useI18n();
  const totals = useMemo(() => monthTotals(allRows, capacity), [allRows, capacity]);
  return (
    <table className="table pb-table pb-plan">
      <thead>
        <tr>
          {canEdit && <SelectAllHead allSelected={allSelected} onSelectAll={onSelectAll} label={tr('Tout sélectionner')} />}
          <th scope="col" className="num pb-stick pb-stick-rank">{tr('Rang')}</th><th scope="col" className="pb-stick pb-stick-name">{tr('Localité')}</th><th scope="col">{tr('Bureau')}</th>
          <th scope="col">{tr('District')}</th><th scope="col">{tr('Commune')}</th><th scope="col">{tr('Activité')}</th>
          <th scope="col" title={tr('TPM de la zone du site : celui des contrats de suivi, ou une modification motivée (onglet Affectation des TPM)')}>{tr('Prestataire (TPM)')}</th><th scope="col">{tr('Priorité')}</th>
          <th scope="col" className="num" title={tr('Visites exigées par le MMR sur l\'exercice')}>{tr('Exigées')}</th>
          <th scope="col" className="num">{tr('Faites')}</th><th scope="col" className="num">{tr('Prévues')}</th><th scope="col" className="num">{tr('Reste')}</th>
          <th scope="col">{tr('Dernière visite')}</th>
          {MONTHS.map((m) => <th key={m} scope="col" className="pb-mh" title={monthLabel(`2026-${String(m).padStart(2, '0')}`).replace(/ \d+$/, '')}>{shortMonth(m)}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          <tr key={s.id}>
            {canEdit && <SelectCell id={s.id} selected={selected} onSelect={onSelect} label={tr('Sélectionner {name}', { name: s.name })} />}
            <td className="num muted pb-stick pb-stick-rank">{offset + i + 1}</td>
            <td className="pb-stick pb-stick-name"><span className="pb-name" title={s.name}>{s.name}</span><span className="pb-id" title={s.locationId ? `${tr('Code POI')} : ${s.locationId}` : undefined}>{s.publicId || s.locationId}</span></td>
            <td className="pb-clip" title={s.bureau || ''}>{s.bureau || '—'}</td><td className="pb-clip">{s.district}</td><td className="pb-clip" title={s.commune}>{s.commune}</td>
            <td className="pb-act" title={s.activity || ''}>{s.activity || <span className="muted">—</span>}</td>
            <TpmZoneCell tpm={s.tpm} months={s.months} />
            <td><PriorityBadge value={s.priority} /></td>
            <td className="num">{s.required == null ? <span className="muted" title={tr('Activité absente du MMR')}>—</span> : s.required}</td>
            <td className="num">{s.done}</td><td className="num">{s.planned}</td>
            <td className={`num ${s.remaining > 0 ? 'pb-rest' : ''}`}>{s.remaining}</td>
            <td>
              {lastVisit(s) || <span className="muted">{tr('Jamais')}</span>}
              {s.nextPlannedMonth && <div className="site-meta">{tr('prévue {m}', { m: monthLabel(s.nextPlannedMonth) })}</div>}
            </td>
            {MONTHS.map((m) => {
              const cell = (s.months || []).find((x) => x.month === m);
              const inactive = s.monthStatus && s.monthStatus[m] === false;
              const label = `${s.name} — ${monthLabel(`2026-${String(m).padStart(2, '0')}`).replace(/ \d+$/, '')}`;
              if (cell && cell.status === 'realise') return <td key={m} className="pb-m is-done" title={`${tr('Réalisée{d}', { d: cell.date ? ` (${cell.date})` : '' })}${cell.provider ? ` · ${cell.provider}` : ''}`}><Check size={14} aria-label={tr('Réalisée')} /></td>;
              const isPending = pending[pendingKey(s.id, m)] !== undefined;
              return (
                <td key={m} className={`pb-m ${inactive ? 'is-inactive' : ''} ${isPending ? 'is-pending' : ''}`} title={inactive ? tr('Mois inactif : non planifiable') : (cell?.provider ? `${tr('Prévue')} · ${cell.provider}` : undefined)}>
                  <input type="checkbox" checked={Boolean(cell)} disabled={!canEdit || inactive} aria-label={label}
                    onChange={(e) => onToggle(s, m, e.target.checked)} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={canEdit ? 14 : 13} className="pb-foot-l">{tr('Visites du mois (prévues + réalisées) / ciblé MMR')}</th>
          {totals.map((t) => (
            <td key={t.month} className={`pb-m pb-total pb-tone-${rateTone(t.rate)} ${t.overCapacity ? 'is-over' : ''}`}
              title={tr('Prévues {n} · ciblé {j} · faisable {k}', { n: t.count, j: t.targeted ?? '—', k: t.feasible ?? '—' })}>
              <strong>{t.count}</strong>{t.targeted != null && <small>/{Math.round(t.targeted)}</small>}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

/* ------------------------------------------------------------- Vue standard (registre) */
const STD_COLUMNS = [
  ['status', 'Statut'], ['poiSubtype', 'Sous-type de lieu'], ['activity', 'Activité'], ['providers', 'Prestataire (TPM)'], ['bureau', 'Bureau'], ['region', 'Région'],
  ['district', 'District'], ['commune', 'Commune'], ['urbanArea', 'Zone urbaine'], ['gps', 'GPS'], ['security', 'Sécurité'],
  ['synergies', 'Synergies'], ['modalityType', 'Modalité'], ['beneficiaryNumber', 'Bénéficiaires'], ['newPartner', 'Nouveau partenaire'],
  ['experiencedPartner', 'Partenaire expérimenté'], ['lastVisitDate', 'Dernière visite (historique)'], ['issuesProcess', 'Problèmes (suivi interne)'],
  ['issuesPartnerReport', 'Problèmes (rapport partenaire)'], ['issuesCFM', 'Problèmes (plaintes)'], ['fraud', 'Fraude et corruption'],
  ['finalScore', 'Score'], ['priority', 'Priorité'], ['riskLevel', 'Niveau de risque'],
];
const DEFAULT_COLS = ['status', 'poiSubtype', 'activity', 'bureau', 'district', 'commune', 'security', 'modalityType', 'beneficiaryNumber', 'finalScore', 'priority'];
function readCols() {
  try { const v = JSON.parse(localStorage.getItem(COLS_KEY)); if (Array.isArray(v) && v.length) return v.filter((k) => STD_COLUMNS.some(([c]) => c === k)); } catch { /* ignore */ }
  return DEFAULT_COLS;
}
const colsListeners = new Set();
function useStdCols() {
  const [cols, setCols] = useState(readCols);
  useEffect(() => { colsListeners.add(setCols); return () => colsListeners.delete(setCols); }, []);
  const update = (next) => { try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ } colsListeners.forEach((f) => f(next)); };
  return [cols, update];
}

function ColumnChooser() {
  const { tr } = useI18n();
  const [cols, setCols] = useStdCols();
  return (
    <details className="pb-cols">
      <summary><Columns3 size={14} aria-hidden="true" /> {tr('Colonnes')}</summary>
      <div className="pb-cols-menu">
        {STD_COLUMNS.map(([k, l]) => (
          <label key={k} className="check"><input type="checkbox" checked={cols.includes(k)}
            onChange={(e) => setCols(e.target.checked ? STD_COLUMNS.map(([c]) => c).filter((c) => c === k || cols.includes(c)) : cols.filter((c) => c !== k))} /> {tr(l)}</label>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setCols(DEFAULT_COLS)}>{tr('Colonnes par défaut')}</Button>
      </div>
    </details>
  );
}

function StandardCell({ k, s }) {
  const { tr } = useI18n();
  switch (k) {
    case 'status': return <StatusCell site={s} />;
    case 'priority': return <PriorityBadge value={s.priority} />;
    case 'gps': return s.gpsLat != null ? <span className="tabular">{Number(s.gpsLat).toFixed(4)}, {Number(s.gpsLng).toFixed(4)}</span> : <span className="muted">—</span>;
    case 'security': return s.security == null ? '—' : <span title={tr(SECURITY[s.security] || '')}>{s.security}{Number(s.security) >= 99 && <ShieldAlert size={13} className="pb-forbid" aria-label={tr('Zone interdite')} />}</span>;
    case 'riskLevel': return s.riskLevel ? tr({ faible: 'Faible', moyenne: 'Moyen', elevee: 'Élevé' }[s.riskLevel] || s.riskLevel) : '—';
    case 'beneficiaryNumber': return s.beneficiaryNumber == null ? '—' : formatInt(s.beneficiaryNumber);
    default: return s[k] == null || s[k] === '' ? <span className="muted">—</span> : String(s[k]);
  }
}

function StandardTable({ rows, selected, onSelect, allSelected, onSelectAll, canEdit }) {
  const { tr } = useI18n();
  const [cols] = useStdCols();
  const numeric = new Set(['security', 'synergies', 'beneficiaryNumber', 'newPartner', 'experiencedPartner', 'issuesProcess', 'issuesPartnerReport', 'issuesCFM', 'fraud', 'finalScore']);
  return (
    <table className="table pb-table">
      <thead><tr>
        {canEdit && <SelectAllHead allSelected={allSelected} onSelectAll={onSelectAll} label={tr('Tout sélectionner')} />}
        <th scope="col">{tr('ID')}</th><th scope="col">{tr('Localité')}</th>
        {cols.map((k) => <th key={k} scope="col" className={numeric.has(k) ? 'num' : ''}>{tr(STD_COLUMNS.find(([c]) => c === k)[1])}</th>)}
      </tr></thead>
      <tbody>{rows.map((s) => (
        <tr key={s.id}>
          {canEdit && <SelectCell id={s.id} selected={selected} onSelect={onSelect} label={tr('Sélectionner {name}', { name: s.name })} />}
          <td className="pb-id-cell">{s.locationId || '—'}</td><td><span className="pb-name">{s.name}</span></td>
          {cols.map((k) => <td key={k} className={numeric.has(k) ? 'num' : ''}><StandardCell k={k} s={s} /></td>)}
        </tr>
      ))}</tbody>
    </table>
  );
}

/* ------------------------------------------------------------- Déjà visités */
function VisitedTable({ rows, year, selected, onSelect, allSelected, onSelectAll, canEdit }) {
  const { tr } = useI18n();
  return (
    <table className="table pb-table">
      <thead><tr>
        {canEdit && <SelectAllHead allSelected={allSelected} onSelectAll={onSelectAll} label={tr('Tout sélectionner')} />}
        <th scope="col">{tr('Localité')}</th><th scope="col">{tr('Bureau')}</th><th scope="col">{tr('District')}</th><th scope="col">{tr('Commune')}</th>
        <th scope="col">{tr('Activité')}</th><th scope="col" className="num">{tr('Visites faites')}</th><th scope="col">{tr('Dates des visites')}</th>
        <th scope="col" className="num">{tr('Exigées')}</th><th scope="col" className="num">{tr('Reste')}</th><th scope="col" className="num">{tr('Données reçues')}</th>
      </tr></thead>
      <tbody>{rows.map((s) => (
        <tr key={s.id}>
          {canEdit && <SelectCell id={s.id} selected={selected} onSelect={onSelect} label={tr('Sélectionner {name}', { name: s.name })} />}
          <td><span className="pb-name">{s.name}</span><span className="pb-id" title={s.locationId ? `${tr('Code POI')} : ${s.locationId}` : undefined}>{s.publicId || s.locationId}</span></td>
          <td>{s.bureau || '—'}</td><td>{s.district}</td><td>{s.commune}</td><td className="pb-act">{s.activity || '—'}</td>
          <td className="num">{s.done}</td>
          <td className="pb-dates">{(s.months || []).filter((m) => m.status === 'realise').map((m) => m.date || monthLabel(`${year}-${String(m.month).padStart(2, '0')}`)).join(' · ')}</td>
          <td className="num">{s.required ?? '—'}</td><td className={`num ${s.remaining > 0 ? 'pb-rest' : ''}`}>{s.remaining}</td>
          <td className="num">{formatInt(s.dataCount || 0)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/* ------------------------------------------------------------- Carte (fond vectoriel hors ligne ; OSM facultatif) */
const TONE_COLOR = { ok: '#0f7b40', warn: '#c77700', bad: '#d13438', na: '#8b93a1' };

function PlanMap({ sites }) {
  const { tr } = useI18n();
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const outlines = useRef(null);
  const tileLayer = useRef(null);
  const probeSeq = useRef(0);
  // Fond en ligne : éteint par défaut (lot 6a) ; false · 'probing' · true.
  const [tiles, setTiles] = useState(false);
  const [tilesDown, setTilesDown] = useState(false);
  const placed = sites.filter((s) => s.mapLat != null && s.mapLng != null);
  const approx = placed.filter((s) => s.geo !== 'gps').length;

  useEffect(() => {
    if (!el.current || map.current) return undefined;
    map.current = L.map(el.current, { zoomControl: true, preferCanvas: true }).setView([-19, 46.8], 6);
    // Fond hors ligne : contours des districts embarqués (mêmes que la carte du suivi), sous les points.
    map.current.createPane('mems-outlines').style.zIndex = 350;
    let alive = true;
    loadGeo().then((geo) => {
      if (!alive || !map.current) return;
      const css = getComputedStyle(document.documentElement);
      const tok = (n, d) => css.getPropertyValue(n).trim() || d;
      outlines.current = L.geoJSON(geo, {
        pane: 'mems-outlines', interactive: false,
        style: { color: tok('--map-line', '#b9c0cc'), weight: 0.8, fillColor: tok('--map-empty', '#eef1f5'), fillOpacity: 1 },
      }).addTo(map.current);
    }).catch(() => { /* contours absents : les points restent lisibles */ });
    return () => { alive = false; probeSeq.current += 1; map.current.remove(); map.current = null; };
  }, []);

  // Fond OpenStreetMap seulement après UNE tuile sonde réussie : hors connexion, jamais de rafale
  // de tuiles en échec ; une erreur de tuile ensuite coupe la couche.
  const toggleTiles = async (on) => {
    const seq = probeSeq.current + 1; probeSeq.current = seq;
    setTilesDown(false);
    const drop = () => {
      if (tileLayer.current && map.current) map.current.removeLayer(tileLayer.current);
      tileLayer.current = null;
      if (outlines.current) outlines.current.setStyle({ fillOpacity: 1 });
    };
    if (!on) { drop(); setTiles(false); return; }
    setTiles('probing');
    const ok = await probeTiles();
    if (probeSeq.current !== seq || !map.current) return;
    if (!ok) { setTiles(false); setTilesDown(true); return; }
    let errors = 0;
    const layerT = L.tileLayer(TILES_URL, { maxZoom: 18, attribution: '© OpenStreetMap' });
    layerT.on('tileerror', () => { errors += 1; if (errors === 4) { probeSeq.current += 1; drop(); setTiles(false); setTilesDown(true); } });
    layerT.addTo(map.current);
    tileLayer.current = layerT;
    if (outlines.current) outlines.current.setStyle({ fillOpacity: 0 });
    setTiles(true);
  };

  useEffect(() => {
    if (!map.current) return;
    if (layer.current) layer.current.remove();
    const g = L.featureGroup();
    for (const s of placed) {
      const tone = rateTone(visitRate(s));
      const exact = s.geo === 'gps';
      const m = L.circleMarker([s.mapLat, s.mapLng], {
        radius: exact ? 6 : 5, color: TONE_COLOR[tone], weight: exact ? 1.5 : 2, fillColor: TONE_COLOR[tone],
        fillOpacity: exact ? 0.85 : 0.15, dashArray: exact ? null : '3 3',
      });
      // Contenu du popup construit en DOM (textContent) : aucune donnée injectée comme HTML.
      const box = document.createElement('div'); box.className = 'pb-pop';
      const add = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; box.appendChild(n); };
      add('strong', `${s.name}${s.locationId ? ` (${s.locationId})` : ''}`);
      add('span', [s.commune, s.district, s.bureau].filter(Boolean).join(' · '));
      add('span', s.activity || tr('Activité non renseignée'));
      add('span', tr('Exigées {r} · faites {d} · prévues {p} · reste {x}', { r: s.required ?? '—', d: s.done, p: s.planned, x: s.remaining }));
      if (!exact) add('em', s.geo === 'district' ? tr('Position approximative (centre du district)') : tr('Position approximative (commune)'));
      m.bindPopup(box);
      g.addLayer(m);
    }
    g.addTo(map.current);
    layer.current = g;
    if (placed.length) map.current.fitBounds(g.getBounds().pad(0.15), { maxZoom: 11 });
  }, [placed, tr]);

  return (
    <div className="pb-map-wrap">
      <div ref={el} className="pb-map" role="region" aria-label={tr('Carte des sites du plan de suivi')} />
      <div className="pb-legend" aria-label={tr('Légende')}>
        <strong>{tr('Visites réalisées / prévues')}</strong>
        {[['ok', tr('≥ 90 %')], ['warn', tr('50 à 90 %')], ['bad', tr('< 50 %')], ['na', tr('Aucune visite')]].map(([k, l]) => <span key={k}><i style={{ background: TONE_COLOR[k] }} />{l}</span>)}
        <span><i className="is-approx" />{tr('Position approximative')}</span>
        {TILES_URL && (
          <label className="pb-legend-check">
            <input type="checkbox" checked={tiles !== false} disabled={tiles === 'probing'} onChange={(e) => toggleTiles(e.target.checked)} />
            {tr('Fond OpenStreetMap (en ligne)')}
          </label>
        )}
      </div>
      <p className="hint pb-map-note">
        {tr('{n} site(s) placé(s) dont {a} approximatif(s) ; {m} sans position (ni GPS ni commune localisée).', { n: formatInt(placed.length), a: formatInt(approx), m: formatInt(sites.length - placed.length) })}
        {tilesDown && ` ${tr('Fond en ligne indisponible (hors connexion) : la carte reste complète sans fond')}`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- Modification groupée */
const UNCHANGED = '__';
function BulkModal({ year, siteIds, refs, onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [offices, setOffices] = useState([]);
  const [set, setSet] = useState({});
  const [status, setStatus] = useState({ mode: UNCHANGED, from: 1, to: 12 });
  const [plan, setPlan] = useState({ mode: UNCHANGED, month: new Date().getMonth() + 1, fromMonth: new Date().getMonth() + 1 });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.listOffices().then((o) => setOffices(o.filter((x) => x.active))).catch(() => setOffices([])); }, []);

  const field = (k, v) => setSet((s) => { const n = { ...s }; if (v === UNCHANGED) delete n[k]; else n[k] = v; return n; });
  const sel = (k, opts, numeric) => (
    <select className="select" value={set[k] === undefined ? UNCHANGED : (set[k] === null ? '' : String(set[k]))}
      onChange={(e) => field(k, e.target.value === UNCHANGED ? UNCHANGED : e.target.value === '' ? null : numeric ? Number(e.target.value) : e.target.value)}>
      <option value={UNCHANGED}>{tr('— inchangé —')}</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const crit = (max) => Array.from({ length: max + 1 }, (_, i) => [String(i), String(i)]);
  const monthOpts = MONTHS.map((m) => <option key={m} value={m}>{monthLabel(`${year}-${String(m).padStart(2, '0')}`)}</option>);

  const payload = { year, siteIds };
  if (Object.keys(set).length) payload.set = set;
  if (status.mode !== UNCHANGED) payload.status = { from: Number(status.from), to: Number(status.to), active: status.mode === 'clear' ? null : status.mode === 'active' };
  if (plan.mode === 'plan' || plan.mode === 'unplan') payload.plan = { month: Number(plan.month), planned: plan.mode === 'plan' };
  if (plan.mode === 'auto') payload.plan = { auto: true, fromMonth: Number(plan.fromMonth) };
  const invalid = (payload.status && payload.status.from > payload.status.to) || (!payload.set && !payload.status && !payload.plan);

  const officeName = (id) => offices.find((o) => o.id === id)?.name || '—';
  const recap = [
    ...Object.entries(set).map(([k, v]) => tr('{field} → {value}', { field: tr(BULK_LABEL[k]), value: v == null ? tr('(vide)') : k === 'fieldOfficeId' ? officeName(v) : String(v) })),
    payload.status && tr('Statut {s} de {a} à {b}', { s: status.mode === 'clear' ? tr('effacé') : tr(status.mode === 'active' ? 'Active' : 'Inactive'), a: monthLabel(`${year}-${String(status.from).padStart(2, '0')}`), b: monthLabel(`${year}-${String(status.to).padStart(2, '0')}`) }),
    plan.mode === 'plan' && tr('Planifier {m}', { m: monthLabel(`${year}-${String(plan.month).padStart(2, '0')}`) }),
    plan.mode === 'unplan' && tr('Retirer la planification de {m} (les visites réalisées sont conservées)', { m: monthLabel(`${year}-${String(plan.month).padStart(2, '0')}`) }),
    plan.mode === 'auto' && tr('Répartir les visites restantes selon le MMR à partir de {m}', { m: monthLabel(`${year}-${String(plan.fromMonth).padStart(2, '0')}`) }),
  ].filter(Boolean);

  async function apply() {
    setBusy(true);
    try {
      const r = await api.planBoardBulk(payload);
      const parts = [tr('{n} site(s) traité(s)', { n: r.sites })];
      if (r.plan) parts.push(tr('{a} visite(s) planifiée(s), {d} retirée(s)', { a: r.plan.added, d: r.plan.removed }));
      if (r.plan?.skippedSites) parts.push(tr('{n} site(s) ignoré(s) (inactif, zone interdite ou activité hors MMR)', { n: r.plan.skippedSites }));
      if (r.plan?.skippedInactive) parts.push(tr('{n} mois inactif(s) non planifié(s)', { n: r.plan.skippedInactive }));
      toast.success(parts.join(' · '));
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} variant="drawer" wide title={tr('Modification groupée')} subtitle={tr('{n} site(s) — tout est appliqué en une seule fois, ou rien.', { n: siteIds.length })}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button><Button icon={Check} loading={busy} disabled={invalid} onClick={apply}>{tr('Appliquer')}</Button></>}>
      <div className="section-gap pb-bulk">
        <fieldset className="pb-fs"><legend>{tr('Registre')}</legend>
          <div className="pb-grid2">
            <Field label={tr('Bureau')}>{sel('fieldOfficeId', offices.map((o) => [o.id, o.name]))}</Field>
            <Field label={tr('Activité')}>{sel('activity', refs.activities.map((a) => [a, a]))}</Field>
            <Field label={tr('Sous-type de lieu')}>{sel('poiSubtype', refs.poiSubtypes.map((p) => [p.label, p.label]))}</Field>
            <Field label={tr('Modalité')}>{sel('modalityType', refs.modalities.map((m) => [m, m]))}</Field>
            <Field label={tr('Sécurité')}>{sel('security', Object.entries(SECURITY).map(([v, l]) => [v, `${v} — ${tr(l)}`]), true)}</Field>
            <Field label={tr('Fraude et corruption')}>{sel('fraud', crit(2), true)}</Field>
            <Field label={tr('Partenaire expérimenté')}>{sel('experiencedPartner', crit(2), true)}</Field>
            <Field label={tr('Nouveau partenaire')}>{sel('newPartner', crit(1), true)}</Field>
            <Field label={tr('Synergies')}>{sel('synergies', crit(1), true)}</Field>
            <Field label={tr('Problèmes (suivi interne)')}>{sel('issuesProcess', crit(2), true)}</Field>
            <Field label={tr('Problèmes (rapport partenaire)')}>{sel('issuesPartnerReport', crit(2), true)}</Field>
            <Field label={tr('Problèmes (plaintes)')}>{sel('issuesCFM', crit(2), true)}</Field>
          </div>
        </fieldset>
        <fieldset className="pb-fs"><legend>{tr('Statut mensuel')}</legend>
          <div className="pb-grid3">
            <Field label={tr('Statut')}><select className="select" value={status.mode} onChange={(e) => setStatus({ ...status, mode: e.target.value })}>
              <option value={UNCHANGED}>{tr('— inchangé —')}</option><option value="active">{tr('Active')}</option><option value="inactive">{tr('Inactive')}</option><option value="clear">{tr('Effacer')}</option>
            </select></Field>
            <Field label={tr('Du mois')}><select className="select" disabled={status.mode === UNCHANGED} value={status.from} onChange={(e) => setStatus({ ...status, from: e.target.value })}>{monthOpts}</select></Field>
            <Field label={tr('au mois')}><select className="select" disabled={status.mode === UNCHANGED} value={status.to} onChange={(e) => setStatus({ ...status, to: e.target.value })}>{monthOpts}</select></Field>
          </div>
        </fieldset>
        <fieldset className="pb-fs"><legend>{tr('Planification')}</legend>
          <div className="pb-grid2">
            <Field label={tr('Action')}><select className="select" value={plan.mode} onChange={(e) => setPlan({ ...plan, mode: e.target.value })}>
              <option value={UNCHANGED}>{tr('— aucune —')}</option><option value="plan">{tr('Planifier un mois')}</option>
              <option value="unplan">{tr('Retirer un mois')}</option><option value="auto">{tr('Répartir selon le MMR')}</option>
            </select></Field>
            {(plan.mode === 'plan' || plan.mode === 'unplan') && <Field label={tr('Mois')}><select className="select" value={plan.month} onChange={(e) => setPlan({ ...plan, month: e.target.value })}>{monthOpts}</select></Field>}
            {plan.mode === 'auto' && <Field label={tr('À partir de')} hint={tr('Les visites restantes de chaque site sont réparties régulièrement sur les mois libres et actifs.')}>
              <select className="select" value={plan.fromMonth} onChange={(e) => setPlan({ ...plan, fromMonth: e.target.value })}>{monthOpts}</select></Field>}
          </div>
        </fieldset>
        <div className="pb-recap" aria-live="polite">
          <strong>{tr('Récapitulatif')}</strong>
          {recap.length ? <ul>{recap.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="hint">{tr('Aucune modification choisie.')}</p>}
          {payload.status && payload.status.from > payload.status.to && <p className="field-error">{tr('Le mois de début est après le mois de fin.')}</p>}
        </div>
      </div>
    </Modal>
  );
}
const BULK_LABEL = {
  fieldOfficeId: 'Bureau', activity: 'Activité', poiSubtype: 'Sous-type de lieu', modalityType: 'Modalité', security: 'Sécurité',
  fraud: 'Fraude et corruption', experiencedPartner: 'Partenaire expérimenté', newPartner: 'Nouveau partenaire', synergies: 'Synergies',
  issuesProcess: 'Problèmes (suivi interne)', issuesPartnerReport: 'Problèmes (rapport partenaire)', issuesCFM: 'Problèmes (plaintes)',
};

/* ------------------------------------------------------------- Ajouter un site */
function AddSiteModal({ refs, onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [offices, setOffices] = useState([]);
  const [areas, setAreas] = useState({ regions: [], districts: [], communes: [] });
  const [f, setF] = useState({ name: '', poiSubtype: '', activity: '', fieldOfficeId: '', region: '', regionId: '', district: '', districtId: '', commune: '',
    urbanArea: '', gpsLat: '', gpsLng: '', modalityType: '', beneficiaryNumber: '', security: 0, synergies: 0, newPartner: 0, experiencedPartner: 0 });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.listOffices().then((o) => setOffices(o.filter((x) => x.active))).catch(() => setOffices([]));
    api.listAdminAreas({ depth: 1 }).then((r) => setAreas((a) => ({ ...a, regions: r }))).catch(() => {});
  }, []);
  const up = (patch) => setF((x) => ({ ...x, ...patch }));
  async function pickRegion(id) {
    const r = areas.regions.find((x) => x.id === id);
    up({ regionId: id, region: r?.name || '', districtId: '', district: '', commune: '' });
    setAreas((a) => ({ ...a, districts: [], communes: [] }));
    if (id) { const d = await api.listAdminAreas({ depth: 2, parentId: id }).catch(() => []); setAreas((a) => ({ ...a, districts: d })); }
  }
  async function pickDistrict(id) {
    const d = areas.districts.find((x) => x.id === id);
    up({ districtId: id, district: d?.name || '', commune: '' });
    setAreas((a) => ({ ...a, communes: [] }));
    if (id) { const c = await api.listAdminAreas({ depth: 3, parentId: id }).catch(() => []); setAreas((a) => ({ ...a, communes: c })); }
  }
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const lat = num(f.gpsLat); const lng = num(f.gpsLng);
  const gpsInvalid = (f.gpsLat !== '' || f.gpsLng !== '') && (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180);
  const invalid = !f.name.trim() || !f.district.trim() || !f.commune.trim() || gpsInvalid;

  async function submit() {
    setBusy(true);
    try {
      const r = await api.planBoardAddSite({
        name: f.name.trim(), region: f.region || undefined, district: f.district.trim(), commune: f.commune.trim(),
        activity: f.activity || undefined, fieldOfficeId: f.fieldOfficeId || null, poiSubtype: f.poiSubtype || null, urbanArea: f.urbanArea || null,
        gpsLat: lat, gpsLng: lng, modalityType: f.modalityType || null, beneficiaryNumber: num(f.beneficiaryNumber),
        security: Number(f.security), synergies: Number(f.synergies), newPartner: Number(f.newPartner), experiencedPartner: Number(f.experiencedPartner),
      });
      toast.success(tr('Site {id} ajouté.', { id: r.locationId || '' }));
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  const crit = (k, max) => <select className="select" value={f[k]} onChange={(e) => up({ [k]: e.target.value })}>{Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select>;
  return (
    <Modal open onClose={onClose} variant="drawer" wide title={tr('Ajouter un site')} subtitle={tr('L\'identifiant L### est attribué automatiquement ; le site est « Active » pour le mois en cours.')}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button><Button icon={Plus} loading={busy} disabled={invalid} onClick={submit}>{tr('Ajouter')}</Button></>}>
      <div className="section-gap pb-bulk">
        <Field label={tr('Nom de la localité')} required><input className="input" value={f.name} maxLength={200} onChange={(e) => up({ name: e.target.value })} /></Field>
        <div className="pb-grid2">
          <Field label={tr('Sous-type de lieu')}><select className="select" value={f.poiSubtype} onChange={(e) => up({ poiSubtype: e.target.value })}>
            <option value="">—</option>{refs.poiSubtypes.map((p) => <option key={p.code} value={p.label}>{p.label} ({p.code})</option>)}</select></Field>
          <Field label={tr('Activité')} hint={refs.activities.length ? undefined : tr('Aucune activité dans le MMR.')}><select className="select" value={f.activity} onChange={(e) => up({ activity: e.target.value })}>
            <option value="">—</option>{refs.activities.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
          <Field label={tr('Bureau')}><select className="select" value={f.fieldOfficeId} onChange={(e) => up({ fieldOfficeId: e.target.value })}>
            <option value="">—</option>{offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
          <Field label={tr('Zone urbaine')}><input className="input" value={f.urbanArea} maxLength={120} onChange={(e) => up({ urbanArea: e.target.value })} /></Field>
        </div>
        <fieldset className="pb-fs"><legend>{tr('Localisation')}</legend>
          <div className="pb-grid3">
            <Field label={tr('Région')}>{areas.regions.length
              ? <select className="select" value={f.regionId} onChange={(e) => pickRegion(e.target.value)}><option value="">—</option>{areas.regions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              : <input className="input" value={f.region} onChange={(e) => up({ region: e.target.value })} />}</Field>
            <Field label={tr('District')} required>{areas.districts.length
              ? <select className="select" value={f.districtId} onChange={(e) => pickDistrict(e.target.value)}><option value="">—</option>{areas.districts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              : <input className="input" value={f.district} onChange={(e) => up({ district: e.target.value })} />}</Field>
            <Field label={tr('Commune')} required>{areas.communes.length
              ? <select className="select" value={f.commune} onChange={(e) => up({ commune: e.target.value })}><option value="">—</option>{areas.communes.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}</select>
              : <input className="input" value={f.commune} onChange={(e) => up({ commune: e.target.value })} />}</Field>
            <Field label={tr('Latitude')}><input className="input" inputMode="decimal" value={f.gpsLat} onChange={(e) => up({ gpsLat: e.target.value.replace(',', '.') })} placeholder="-23.35" /></Field>
            <Field label={tr('Longitude')} error={gpsInvalid ? tr('Coordonnées invalides.') : undefined}><input className="input" inputMode="decimal" value={f.gpsLng} onChange={(e) => up({ gpsLng: e.target.value.replace(',', '.') })} placeholder="43.67" /></Field>
          </div>
        </fieldset>
        <fieldset className="pb-fs"><legend>{tr('Critères RBM')}</legend>
          <div className="pb-grid3">
            <Field label={tr('Sécurité')}><select className="select" value={f.security} onChange={(e) => up({ security: e.target.value })}>
              {Object.entries(SECURITY).map(([v, l]) => <option key={v} value={v}>{v} — {tr(l)}</option>)}</select></Field>
            <Field label={tr('Modalité')}><select className="select" value={f.modalityType} onChange={(e) => up({ modalityType: e.target.value })}>
              <option value="">—</option>{refs.modalities.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
            <Field label={tr('Bénéficiaires')}><input className="input" type="number" min="0" value={f.beneficiaryNumber} onChange={(e) => up({ beneficiaryNumber: e.target.value })} /></Field>
            <Field label={tr('Synergies')}>{crit('synergies', 1)}</Field>
            <Field label={tr('Nouveau partenaire')}>{crit('newPartner', 1)}</Field>
            <Field label={tr('Partenaire expérimenté')}>{crit('experiencedPartner', 2)}</Field>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- Gabarit d'activité */
function TemplateModal({ year, refs, onClose }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [activity, setActivity] = useState(refs.activities[0] || '');
  return (
    <Modal open onClose={onClose} title={tr('Gabarit d\'activité')} subtitle={tr('Registre vierge au format du classeur (listes déroulantes, définitions des critères), avec l\'activité préremplie. Remplissez-le hors ligne puis réimportez-le.')}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Fermer')}</Button>
        <Button icon={Download} onClick={() => api.planBoardTemplate(year, activity).then(onClose).catch((e) => toast.error(e.message))}>{tr('Télécharger')}</Button></>}>
      <Field label={tr('Activité')}>
        <select className="select" value={activity} onChange={(e) => setActivity(e.target.value)}>
          <option value="">{tr('Aucune (activité à saisir)')}</option>
          {refs.activities.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------- Import : aperçu puis enregistrement */
function ImportModal({ state, onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const p = state.preview;
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  async function commit() {
    setBusy(true);
    try {
      const r = await api.planBoardImport(state.file, { commit: true, skipErrors: skip });
      toast.success(tr('Import enregistré : {c} site(s) créé(s), {u} mis à jour.', { c: r.created, u: r.updated }));
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} variant="drawer" wide title={tr('Aperçu de l\'import')} subtitle={tr('{file} — feuille « {sheet} », exercice {y}. Rien n\'est enregistré avant validation.', { file: state.file.name, sheet: p.sheet, y: p.year })}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button>
        <Button icon={Save} loading={busy} disabled={p.rejected > 0 && !skip} onClick={commit}>{tr('Enregistrer')}</Button></>}>
      <div className="section-gap">
        <Stats compact items={[
          { label: tr('Lignes lues'), value: formatInt(p.read) }, { label: tr('À créer'), value: formatInt(p.created) },
          { label: tr('À mettre à jour'), value: formatInt(p.updated) }, { label: tr('Rejetées'), value: formatInt(p.rejected) },
          { label: tr('Avertissements'), value: formatInt(p.warningCount) },
        ]} />
        {p.rejected > 0 && <>
          <Alert tone="danger" icon={AlertTriangle}>{tr('{n} ligne(s) rejetée(s) : corrigez le fichier, ou enregistrez seulement les lignes valides.', { n: p.rejected })}</Alert>
          <label className="check"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> {tr('Écarter les lignes rejetées et enregistrer les autres')}</label>
        </>}
        {[['errors', p.errors, p.errorCount, tr('Lignes rejetées')], ['warnings', p.warnings, p.warningCount, tr('Avertissements')]].map(([k, list, count, title]) => (list.length > 0 && (
          <div key={k}>
            <h3 className="pb-subh"><Filter size={14} aria-hidden="true" /> {title} ({formatInt(count)})</h3>
            <div className="table-wrap pb-issues"><table className="table">
              <thead><tr><th scope="col" className="num">{tr('Ligne')}</th><th scope="col">{tr('Motif')}</th></tr></thead>
              <tbody>{list.map((e, i) => <tr key={i}><td className="num">{e.line}</td><td>{e.message}</td></tr>)}</tbody>
            </table></div>
          </div>
        )))}
      </div>
    </Modal>
  );
}
