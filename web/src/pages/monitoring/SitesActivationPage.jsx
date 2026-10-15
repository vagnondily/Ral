import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Download, History, Info, Layers, PauseCircle, RotateCcw, Save, Search, Upload, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatDateTime, formatInt, formatLocale } from '../../lib/format.js';
import { MONTHS, activeInYear, cellValue, hasGrid, isActiveMonth, nextValue, pendingKey, totals, unpack } from '../../lib/activation.js';
import './planBoard.css';
import './activation.css';

/**
 * Sites (actifs / inactifs) — retour 64. Fidèle à la feuille « Site Actif » du
 * classeur d'activation : pour chaque site du registre, Oui / Non / vide par
 * mois de l'exercice, AVANT de planifier le mois. Un site inactif un mois n'est
 * pas planifiable ce mois-là (règle du plan de suivi). Chaque changement est
 * journalisé avec son motif ; aller-retour Excel au format du classeur.
 *
 * Même forme que le Plan de suivi (retour du 15/10) : en-tête (exercice,
 * exporter, importer), deux bandeaux de chiffres, barre de filtres, tableau
 * dense à colonnes figées et grille des 12 mois, ligne de totaux, barre
 * d'enregistrement. Écran distinct : ici on dit SI un site est actif, le plan
 * dit QUAND on le visite.
 */
const PAGE = 100;
const thisYear = () => new Date().getFullYear();
const thisMonth = () => new Date().getMonth() + 1;
const monthShort = (m) => new Date(Date.UTC(2026, m - 1, 1)).toLocaleString(formatLocale(), { month: 'short', timeZone: 'UTC' });
const monthLong = (m) => new Date(Date.UTC(2026, m - 1, 1)).toLocaleString(formatLocale(), { month: 'long', timeZone: 'UTC' });
const EMPTY_FILTERS = { q: '', bureau: '', district: '', commune: '', activity: '', status: '' };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const tone = (rate) => (rate == null ? 'none' : rate >= 90 ? 'ok' : rate >= 50 ? 'warn' : 'bad');

export default function SitesActivationPage({ canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [focus, setFocus] = useState(thisMonth);
  const [pending, setPending] = useState({});
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null); // { kind:'bulk' } | { kind:'import', file, preview } | { kind:'history', site }
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.activationGrid(year);
      setData(r.rows.map((x) => ({ ...x, months: unpack(x.m) })));
    } catch (e) { setError(e.message); }
  }, [year]);
  useEffect(() => { setData(null); setPending({}); setSelected(new Set()); setFocus(year === thisYear() ? thisMonth() : 1); load(); }, [load, year]);

  const pendingCount = Object.keys(pending).length;
  useEffect(() => {
    if (!pendingCount) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  const options = useMemo(() => {
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fr'));
    const rows = data || [];
    return {
      bureaux: uniq(rows.map((r) => r.bureau)), districts: uniq(rows.map((r) => r.district)),
      communes: uniq(rows.filter((r) => !filters.district || r.district === filters.district).map((r) => r.commune)),
      activities: uniq(rows.map((r) => r.activity)),
    };
  }, [data, filters.district]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filters.q.trim().toLowerCase();
    return data.filter((r) => {
      if (q && ![r.ident, r.publicId, r.name, r.commune, r.district, r.fokontany].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (filters.bureau && r.bureau !== filters.bureau) return false;
      if (filters.district && r.district !== filters.district) return false;
      if (filters.commune && r.commune !== filters.commune) return false;
      if (filters.activity && r.activity !== filters.activity) return false;
      if (filters.status) {
        const v = cellValue(r.months, pending, r.id, focus);
        if (filters.status === 'oui' && v !== true) return false;
        if (filters.status === 'non' && v !== false) return false;
        if (filters.status === 'vide' && v !== null) return false;
      }
      return true;
    });
  }, [data, filters, pending, focus]);
  useEffect(() => { setPage(1); }, [filters, focus]);

  const monthTotals = useMemo(() => totals(filtered, pending), [filtered, pending]);
  // Règle unique (tableaux de bord, planification) : grille ouverte → seul « Oui » est actif.
  const yearHasGrid = useMemo(() => hasGrid(data || [], pending), [data, pending]);
  const kpis = useMemo(() => {
    const f = monthTotals[focus - 1] || { active: 0, inactive: 0, unknown: 0 };
    let activeYear = 0; let inactiveYear = 0; let entries = 0; let exits = 0; let filled = 0; let withReason = 0;
    for (const r of filtered) {
      const vals = MONTHS.map((m) => cellValue(r.months, pending, r.id, m));
      if (activeInYear(r, pending)) activeYear += 1;
      if (vals.every((v) => v === false)) inactiveYear += 1;
      filled += vals.filter((v) => v !== null).length;
      if (r.reason) withReason += 1;
      if (focus > 1) {
        const now = isActiveMonth(vals[focus - 1], yearHasGrid); const before = isActiveMonth(vals[focus - 2], yearHasGrid);
        if (now && !before) entries += 1;
        if (!now && before) exits += 1;
      }
    }
    return { ...f, activeYear, inactiveYear, entries, exits, withReason, completeness: pct(filled, filtered.length * 12) };
  }, [filtered, monthTotals, pending, focus, yearHasGrid]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v, ...(k === 'district' ? { commune: '' } : {}) }));
  const activeFilters = Object.values(filters).filter(Boolean).length;

  function setCell(row, month, value) {
    const saved = row.months[month] === undefined ? null : row.months[month];
    setPending((p) => {
      const n = { ...p }; const k = pendingKey(row.id, month);
      if (value === saved) delete n[k]; else n[k] = value;
      return n;
    });
  }
  const toggle = (row, month) => setCell(row, month, nextValue(cellValue(row.months, pending, row.id, month)));

  function applyRange({ from, to, value }) {
    const byId = new Map((data || []).map((r) => [r.id, r]));
    setPending((p) => {
      const n = { ...p };
      for (const id of selected) {
        const row = byId.get(id); if (!row) continue;
        for (let m = from; m <= to; m += 1) {
          const saved = row.months[m] === undefined ? null : row.months[m];
          const k = pendingKey(id, m);
          if (value === saved) delete n[k]; else n[k] = value;
        }
      }
      return n;
    });
    setModal(null);
  }

  /** Cases sans statut enregistré, parmi les sites affichés, sur [from..to]. */
  const countBlank = (from, to) => {
    let n = 0;
    for (const r of filtered) for (let m = from; m <= to; m += 1) if (r.months[m] === undefined) n += 1;
    return n;
  };
  /**
   * « Renseigner les cases vides » : une action serveur, sous verrou et en une
   * transaction (3 000 sites × 12 mois restent une petite requête) ; un Oui / Non
   * déjà saisi ne change jamais. Journalisée avec le motif.
   */
  async function fillBlanks({ from, to, value, reason: why }) {
    const r = await api.activationFill({ year, from, to, value, siteIds: filtered.map((x) => x.id), reason: why || undefined });
    toast.success(tr('Cases vides renseignées : {n} case(s) sur {s} site(s).', { n: formatInt(r.changes), s: formatInt(r.sites) }));
    setModal(null); await load();
  }

  async function save() {
    setSaving(true);
    try {
      const changes = Object.entries(pending).map(([k, active]) => { const [siteId, m] = k.split('|'); return { siteId, month: Number(m), active }; });
      const r = await api.saveActivation({ year, changes, reason: reason.trim() || undefined });
      toast.success(tr('Statuts enregistrés : {a} activation(s), {d} désactivation(s), {c} effacement(s).', { a: r.activated, d: r.deactivated, c: r.cleared }));
      setPending({}); setReason(''); await load();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function exportXlsx() {
    try { await api.activationExport(year); } catch (e) { toast.error(e.message); }
  }
  async function pickFile(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setModal({ kind: 'import', file, preview: null, error: null });
    try {
      const preview = await api.activationImport(file, { commit: false, year });
      setModal({ kind: 'import', file, preview, error: null });
    } catch (err) { setModal({ kind: 'import', file, preview: null, error: err.message }); }
  }
  async function commitImport() {
    const m = modal; setModal({ ...m, busy: true });
    try {
      const r = await api.activationImport(m.file, { commit: true, year });
      toast.success(tr('Classeur importé : {n} changement(s) sur {s} site(s).', { n: r.changes, s: r.sites }));
      setModal(null); setPending({}); await load();
    } catch (err) { setModal({ ...m, busy: false, error: err.message }); }
  }

  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const selectPage = () => setSelected((s) => { const n = new Set(s); if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.add(r.id)); return n; });
  const changeYear = (y) => { if (!pendingCount || window.confirm(tr('Abandonner les modifications non enregistrées ?'))) setYear(y); };
  const years = [thisYear() - 1, thisYear(), thisYear() + 1];
  const focusLabel = monthLong(focus);

  return (
    <div className="section-gap pb act">
      <div className="page-header">
        <div>
          <p className="page-desc">{tr('Pour chaque site du registre, actif (Oui) ou inactif (Non) chaque mois de l\'exercice, avant de planifier. Un site inactif un mois n\'est jamais planifié ce mois-là dans le plan de suivi.')}</p>
        </div>
        <div className="header-actions">
          <label className="pb-year"><span>{tr('Exercice')}</span>
            <select className="select" value={year} onChange={(e) => changeYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="pb-year"><span>{tr('Mois observé')}</span>
            <select className="select act-month-select" value={focus} onChange={(e) => setFocus(Number(e.target.value))}>
              {MONTHS.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </label>
          <Button variant="secondary" icon={Download} onClick={exportXlsx}>{tr('Exporter')}</Button>
          {canEdit && <>
            <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>{tr('Importer')}</Button>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={pickFile} />
          </>}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? <Skeleton height={420} /> : <>
        <Stats items={[
          { label: tr('Total des sites'), value: formatInt(filtered.length), foot: activeFilters ? tr('selon les filtres') : tr('registre des sites') },
          { label: tr('Actifs en {m}', { m: focusLabel }), value: formatInt(kpis.active), foot: tr('« Oui » : planifiables ce mois') },
          { label: tr('Inactifs en {m}', { m: focusLabel }), value: formatInt(kpis.inactive), foot: tr('« Non » : jamais planifiés ce mois') },
          { label: tr('Non renseignés en {m}', { m: focusLabel }), value: formatInt(kpis.unknown),
            foot: yearHasGrid ? tr('comptés inactifs : à renseigner') : tr('comptés actifs (aucune grille {y})', { y: year }) },
          { label: tr('Actifs sur l\'exercice'), value: formatInt(kpis.activeYear), foot: tr('au moins un mois à Oui') },
          { label: tr('Inactifs toute l\'année'), value: formatInt(kpis.inactiveYear), foot: tr('12 mois à Non') },
        ]} />
        <Stats compact items={[
          { label: tr('Entrées en {m}', { m: focusLabel }), value: focus > 1 ? formatInt(kpis.entries) : '—', foot: tr('inactifs le mois précédent, actifs ce mois') },
          { label: tr('Sorties en {m}', { m: focusLabel }), value: focus > 1 ? formatInt(kpis.exits) : '—', foot: tr('actifs le mois précédent, inactifs ce mois') },
          { label: tr('Grille renseignée'), value: kpis.completeness == null ? '—' : `${kpis.completeness.toLocaleString(formatLocale())} %`,
            foot: tr('cases Oui / Non sur l\'exercice'), children: <span className={`pb-tone pb-tone-${tone(kpis.completeness)}`} aria-hidden="true" /> },
          { label: tr('Avec un motif'), value: formatInt(kpis.withReason), foot: tr('changement expliqué') },
          { label: tr('Modifications en attente'), value: formatInt(pendingCount), foot: pendingCount ? tr('à enregistrer') : tr('aucune') },
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
            <FilterSelect label={tr('Statut du mois observé')} value={filters.status} onChange={(v) => setFilter('status', v)} all={tr('Tous les statuts ({m})', { m: monthShort(focus) })}
              options={[['oui', tr('Actifs ({m})', { m: monthShort(focus) })], ['non', tr('Inactifs ({m})', { m: monthShort(focus) })], ['vide', tr('Non renseignés ({m})', { m: monthShort(focus) })]]} />
            {activeFilters > 0 && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setFilters(EMPTY_FILTERS)}>{tr('Réinitialiser')}</Button>}
          </div>

          <div className="pb-viewbar">
            <span className="pb-count">
              {tr('{n} site(s)', { n: formatInt(filtered.length) })}
              {canEdit ? ` · ${tr('cliquez une case : Oui → Non → vide')}` : ''}
            </span>
            <span className="act-legend" aria-hidden="true">
              <span className="act-chip is-yes">{tr('Oui')}</span> {tr('actif')}
              <span className="act-chip is-no">{tr('Non')}</span> {tr('inactif')}
              <span className="act-chip is-empty">·</span> {tr('non renseigné')}
            </span>
          </div>

          {filtered.length > 0 && (!yearHasGrid || kpis.unknown > 0) && (
            <div className="act-rule" role="note">
              <Info size={14} aria-hidden="true" />
              <span>
                {yearHasGrid
                  ? tr('{n} site(s) sans statut en {m} : comptés inactifs — ni planifiés, ni comptés dans les tableaux de bord — tant que la case reste vide.', { n: formatInt(kpis.unknown), m: focusLabel })
                  : tr('Aucune grille pour {y} : tous les sites comptent actifs, dans le plan comme dans les tableaux de bord, jusqu\'au premier statut saisi ou importé.', { y: year })}
              </span>
              {canEdit && <Button size="sm" variant="secondary" icon={Layers} onClick={() => setModal({ kind: 'fill' })}>{tr('Renseigner les cases vides…')}</Button>}
            </div>
          )}

          {selected.size > 0 && canEdit && (
            <div className="pb-selbar" role="region" aria-label={tr('Sélection')}>
              <strong>{tr('{n} site(s) sélectionné(s)', { n: formatInt(selected.size) })}</strong>
              <Button size="sm" icon={Layers} onClick={() => setModal({ kind: 'bulk' })}>{tr('Modification groupée')}</Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>{tr('Désélectionner')}</Button>
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="pb-empty">{activeFilters ? tr('Aucun site ne correspond à ces filtres.') : tr('Le registre des sites est vide : ajoutez ou importez des sites dans Paramétrage › Localités › Sites.')}</p>
          ) : (
            <div className="table-wrap pb-table-wrap">
              <table className="table pb-table pb-plan act-plan">
                <thead>
                  <tr>
                    {canEdit && <th scope="col" className="pb-cb pb-stick"><input type="checkbox" checked={allOnPage} onChange={selectPage} aria-label={tr('Sélectionner la page')} /></th>}
                    <th scope="col" className="num pb-stick pb-stick-rank">{tr('N°')}</th>
                    <th scope="col" className="pb-stick pb-stick-name">{tr('Localité')}</th>
                    <th scope="col">{tr('Bureau')}</th><th scope="col">{tr('District')}</th><th scope="col">{tr('Commune')}</th>
                    <th scope="col">{tr('Activité')}</th>
                    <th scope="col">{tr('Statut ({m})', { m: monthShort(focus) })}</th>
                    <th scope="col">{tr('Motif du changement')}</th>
                    {MONTHS.map((m) => <th key={m} scope="col" className={`pb-mh ${m === focus ? 'is-focus' : ''}`} title={monthLong(m)}>{monthShort(m)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={selected.has(r.id) ? 'is-selected' : undefined}>
                      {canEdit && <td className="pb-cb pb-stick"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={tr('Sélectionner {n}', { n: r.name })} /></td>}
                      <td className="num muted pb-stick pb-stick-rank">{(page - 1) * PAGE + i + 1}</td>
                      <td className="pb-stick pb-stick-name">
                        <span className="pb-name" title={r.name}>{r.name}</span>
                        <span className="pb-id" title={r.publicId ? `${tr('Identifiant du site dans MEMS')} : ${r.publicId}` : undefined}>{r.ident || r.publicId || '—'}</span>
                      </td>
                      <td className="pb-clip" title={r.bureau || ''}>{r.bureau || '—'}</td>
                      <td className="pb-clip">{r.district || '—'}</td>
                      <td className="pb-clip" title={r.commune || ''}>{r.commune || '—'}</td>
                      <td className="pb-act" title={r.activity || ''}>{r.activity || <span className="muted">—</span>}</td>
                      <td><FocusStatus value={cellValue(r.months, pending, r.id, focus)} yearHasGrid={yearHasGrid} year={year} /></td>
                      <td className="act-reason">
                        {r.reason ? <span className="act-reason-text" title={`${r.reason} · ${formatDateTime(r.reasonAt)}`}>{r.reason}</span> : <span className="muted">—</span>}
                        <button type="button" className="act-history" onClick={() => setModal({ kind: 'history', site: r })} aria-label={tr('Journal de {n}', { n: r.name })} title={tr('Journal des changements')}>
                          <History size={14} aria-hidden="true" />
                        </button>
                      </td>
                      {MONTHS.map((m) => (
                        <MonthCell key={m} value={cellValue(r.months, pending, r.id, m)} focus={m === focus}
                          changed={Object.prototype.hasOwnProperty.call(pending, pendingKey(r.id, m))}
                          disabled={!canEdit} onClick={() => toggle(r, m)} label={`${r.name} — ${monthLong(m)}`} />
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={canEdit ? 9 : 8} className="pb-foot-l">{tr('Sites actifs du mois / sites du périmètre')}</th>
                    {monthTotals.map((t) => (
                      // Actifs selon la règle unique ; pas de couleur de seuil : un site inactif est un fait, pas un retard.
                      <td key={t.month} className={`pb-m pb-total act-total ${t.month === focus ? 'is-focus' : ''}`}
                        title={tr('Oui {a} · Non {n} · non renseignés {u}', { a: t.active, n: t.inactive, u: t.unknown })}>
                        <strong>{formatInt(yearHasGrid ? t.active : t.active + t.unknown)}</strong><small>/{formatInt(filtered.length)}</small>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="pager act-pager">
              <button type="button" className="pager-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={tr('Page précédente')}><ChevronLeft size={16} /></button>
              <span className="pager-info">{tr('Page {p} / {t}', { p: page, t: pages })}</span>
              <button type="button" className="pager-btn" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={tr('Page suivante')}><ChevronRight size={16} /></button>
            </div>
          )}
        </Card>

        {pendingCount > 0 && canEdit && (
          <div className="mmr-savebar pb-savebar act-savebar" role="region" aria-label={tr('Changements à enregistrer')}>
            <span>{tr('{n} changement(s) non enregistré(s)', { n: formatInt(pendingCount) })}</span>
            <input className="input act-savebar-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
              placeholder={tr('Motif du changement (facultatif, relu longtemps après)')} aria-label={tr('Motif du changement')} />
            <Button variant="secondary" onClick={() => setPending({})} disabled={saving}>{tr('Annuler')}</Button>
            <Button icon={Save} loading={saving} onClick={save}>{tr('Enregistrer')}</Button>
          </div>
        )}
      </>}

      {modal?.kind === 'bulk' && <BulkStatusModal count={selected.size} onClose={() => setModal(null)} onApply={applyRange} />}
      {modal?.kind === 'fill' && <FillBlanksModal sites={filtered.length} initial={{ from: focus, to: 12 }} countBlank={countBlank}
        pendingCount={pendingCount} onClose={() => setModal(null)} onFill={fillBlanks} />}
      {modal?.kind === 'import' && <ImportModal state={modal} onClose={() => setModal(null)} onCommit={commitImport} />}
      {modal?.kind === 'history' && <HistoryModal site={modal.site} year={year} onClose={() => setModal(null)} />}
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

/**
 * Statut du mois observé : couleur + icône + libellé (jamais la couleur seule),
 * selon la règle unique (grille ouverte → une case vide compte inactive).
 */
function FocusStatus({ value, yearHasGrid, year }) {
  const { tr } = useI18n();
  if (value === true) return <Badge tone="green" icon={CheckCircle2}>{tr('Actif')}</Badge>;
  if (value === false) return <Badge icon={PauseCircle}>{tr('Inactif')}</Badge>;
  if (yearHasGrid) {
    return <span title={tr('Aucun statut pour ce mois : compté inactif (non planifié) tant que la case reste vide.')}>
      <Badge tone="orange" icon={CircleDashed}>{tr('À renseigner')}</Badge></span>;
  }
  return <span className="muted" title={tr('Aucune grille pour {y} : tous les sites comptent actifs.', { y: year })}>{tr('Actif (par défaut)')}</span>;
}

/**
 * Case d'un mois, dans la grille du plan de suivi : « Oui » / « Non » comme le
 * classeur ; Non sur fond rayé (comme un mois inactif du plan) ; une
 * modification non enregistrée est cerclée de bleu.
 */
function MonthCell({ value, focus, changed, disabled, onClick, label }) {
  const { tr } = useI18n();
  const text = value === true ? tr('Oui') : value === false ? tr('Non') : tr('non renseigné');
  const cls = `${value === true ? 'is-yes' : value === false ? 'is-no' : 'is-empty'}${changed ? ' is-changed' : ''}`;
  return (
    <td className={`pb-m act-m ${value === false ? 'is-inactive' : ''} ${focus ? 'is-focus' : ''}`}>
      <button type="button" className={`act-chip ${cls}`} disabled={disabled} onClick={onClick}
        aria-label={`${label} : ${text}${changed ? ` (${tr('modifié')})` : ''}`} title={changed ? tr('Modifié, à enregistrer') : text}>
        {value === true ? tr('Oui') : value === false ? tr('Non') : '·'}
      </button>
    </td>
  );
}

function BulkStatusModal({ count, onClose, onApply }) {
  const { tr } = useI18n();
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(12);
  const [value, setValue] = useState('oui');
  const v = value === 'oui' ? true : value === 'non' ? false : null;
  return (
    <Modal open onClose={onClose} title={tr('Changer le statut de {n} site(s)', { n: formatInt(count) })}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Annuler')}</Button>
          <Button disabled={from > to} onClick={() => onApply({ from, to, value: v })}>{tr('Appliquer à la grille')}</Button>
        </>
      )}>
      <div className="act-bulk">
        <div className="seg" role="radiogroup" aria-label={tr('Statut')}>
          {[['oui', 'Actif (Oui)'], ['non', 'Inactif (Non)'], ['vide', 'Non renseigné']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'is-active' : ''} onClick={() => setValue(k)}>{tr(l)}</button>
          ))}
        </div>
        <div className="act-bulk-range">
          <label>{tr('De')}
            <select className="select" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {MONTHS.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </label>
          <label>{tr('à')}
            <select className="select" value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {MONTHS.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </label>
        </div>
        {from > to && <Alert tone="warn">{tr('Le premier mois doit précéder le dernier.')}</Alert>}
        <p className="muted">{tr('Les cases changent dans la grille ; rien n\'est enregistré avant « Enregistrer », avec le motif du changement.')}</p>
      </div>
    </Modal>
  );
}

/**
 * Renseigner d'un coup les cases vides des sites affichés : compte annoncé avant,
 * motif, puis une seule action serveur (jamais un Oui / Non saisi modifié).
 */
function FillBlanksModal({ sites, initial, countBlank, pendingCount, onClose, onFill }) {
  const { tr } = useI18n();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [value, setValue] = useState('oui');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const blanks = from <= to ? countBlank(from, to) : 0;
  async function go() {
    setBusy(true); setErr(null);
    try { await onFill({ from, to, value: value === 'oui', reason: why.trim() }); } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={tr('Renseigner les cases vides de {n} site(s)', { n: formatInt(sites) })}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button>
          <Button icon={Save} loading={busy} disabled={from > to || blanks === 0 || pendingCount > 0} onClick={go}>
            {tr('Enregistrer {n} case(s)', { n: formatInt(blanks) })}
          </Button>
        </>
      )}>
      <div className="act-bulk">
        <p className="muted">{tr('Tous les sites affichés (selon les filtres). Seules les cases vides changent : un Oui ou un Non déjà saisi reste tel quel.')}</p>
        {pendingCount > 0 && <Alert tone="warn">{tr('Enregistrez ou annulez d\'abord les {n} modification(s) en attente.', { n: formatInt(pendingCount) })}</Alert>}
        <div className="seg" role="radiogroup" aria-label={tr('Statut')}>
          {[['oui', 'Actif (Oui)'], ['non', 'Inactif (Non)']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'is-active' : ''} onClick={() => setValue(k)}>{tr(l)}</button>
          ))}
        </div>
        <div className="act-bulk-range">
          <label>{tr('De')}
            <select className="select" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {MONTHS.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </label>
          <label>{tr('à')}
            <select className="select" value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {MONTHS.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </label>
        </div>
        {from > to && <Alert tone="warn">{tr('Le premier mois doit précéder le dernier.')}</Alert>}
        <label className="act-fill-reason">{tr('Motif du changement')}
          <input className="input" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)}
            placeholder={tr('Ex. : grille ouverte pour le second semestre')} />
        </label>
        <p className="act-fill-count" aria-live="polite">
          {blanks === 0 ? tr('Aucune case vide sur cette période.')
            : tr('{n} case(s) vide(s) passeront à « {v} ».', { n: formatInt(blanks), v: value === 'oui' ? tr('Oui') : tr('Non') })}
        </p>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
    </Modal>
  );
}

function ImportModal({ state, onClose, onCommit }) {
  const { tr } = useI18n();
  const p = state.preview;
  return (
    <Modal open onClose={() => !state.busy && onClose()} title={tr('Importer le classeur des sites actifs')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={state.busy}>{tr('Annuler')}</Button>
          <Button icon={Upload} loading={state.busy} disabled={!p || p.changes === 0} onClick={onCommit}>
            {p ? tr('Appliquer {n} changement(s)', { n: formatInt(p.changes) }) : tr('Appliquer')}
          </Button>
        </>
      )}>
      <p className="muted" style={{ marginTop: 0 }}>{state.file?.name}</p>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {!p && !state.error && <Skeleton height={140} />}
      {p && (
        <div className="act-import">
          <Stats compact items={[
            { label: tr('Lignes lues'), value: formatInt(p.rows), foot: tr('exercice {y}', { y: p.year }) },
            { label: tr('Sites reconnus'), value: formatInt(p.matched), foot: tr('par Identifiant (Code POI + Tag_code)') },
            { label: tr('Changements'), value: formatInt(p.changes), foot: tr('{a} Oui · {d} Non', { a: formatInt(p.activated), d: formatInt(p.deactivated) }) },
          ]} />
          <p className="muted">{tr('Une case vide dans le classeur laisse le mois inchangé.')}</p>
          {p.unknownCount > 0 && (
            <Alert tone="warn">
              <div>{tr('{n} ligne(s) ne correspondent à aucun site du registre : elles sont ignorées (les sites viennent du registre). Importez-les d\'abord dans Paramétrage › Localités › Sites.', { n: formatInt(p.unknownCount) })}</div>
              <ul className="linked-list">{p.unknown.slice(0, 5).map((u) => <li key={u.line}>{tr('ligne {l}', { l: u.line })} · <span className="mono">{u.ident}</span>{u.name ? ` · ${u.name}` : ''}</li>)}</ul>
            </Alert>
          )}
          {p.ambiguousCount > 0 && <Alert tone="warn">{tr('{n} identifiant(s) portés par plusieurs sites du registre : ignorés.', { n: formatInt(p.ambiguousCount) })}</Alert>}
          {p.duplicateCount > 0 && <Alert tone="info">{tr('{n} site(s) en double dans le fichier : la première ligne fait foi.', { n: formatInt(p.duplicateCount) })}</Alert>}
          {p.errorCount > 0 && (
            <Alert tone="warn">
              <div>{tr('{n} ligne(s) à corriger :', { n: formatInt(p.errorCount) })}</div>
              <ul className="linked-list">{p.errors.slice(0, 5).map((e, i) => <li key={i}>{e.line ? `${tr('ligne {l}', { l: e.line })} · ` : ''}{e.message}</li>)}</ul>
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}

function HistoryModal({ site, year, onClose }) {
  const { tr } = useI18n();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api.activationHistory(site.id, year).then((r) => { if (live) setRows(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [site.id, year]);
  const label = (v) => (v === true ? tr('Oui') : v === false ? tr('Non') : tr('non renseigné'));
  return (
    <Modal open onClose={onClose} title={tr('Journal · {n}', { n: site.name })}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!rows && !error && <Skeleton height={120} />}
      {rows && rows.length === 0 && <p className="muted">{tr('Aucun changement enregistré pour {y}.', { y: year })}</p>}
      {rows && rows.length > 0 && (
        <ol className="act-hist">
          {rows.map((h, i) => (
            <li key={i}>
              <div className="act-hist-head">
                <strong>{monthLong(h.month)}</strong>
                <span className="act-hist-change">{label(h.before)} → <b>{label(h.after)}</b></span>
                {h.source === 'import' && <span className="act-hist-tag">{tr('import')}</span>}
              </div>
              {h.reason && <p className="act-hist-reason">{h.reason}</p>}
              <div className="act-hist-meta">{formatDateTime(h.changedAt)}{h.changedBy ? ` · ${h.changedBy}` : ''}</div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
