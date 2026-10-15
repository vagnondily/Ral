import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, History, Minus, RotateCcw, Save, Search, Upload, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, EmptyState, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatDateTime, formatInt, formatLocale } from '../../lib/format.js';
import { MONTHS, activeInYear, cellValue, nextValue, pendingKey, totals, unpack } from '../../lib/activation.js';
import './activation.css';

/**
 * Sites (actifs / inactifs) — retour 64. Fidèle à la feuille « Site Actif » du
 * classeur d'activation : pour chaque site du registre, Oui / Non / vide par
 * mois de l'exercice, AVANT de planifier le mois. Un site inactif un mois n'est
 * pas planifiable ce mois-là (règle du plan de suivi). Chaque changement est
 * journalisé avec son motif ; aller-retour Excel au format du classeur.
 * Écran distinct du plan de suivi : ici on dit SI un site est actif, là-bas
 * QUAND on le visite.
 */
const PAGE = 100;
const thisYear = () => new Date().getFullYear();
const thisMonth = () => new Date().getMonth() + 1;
const monthShort = (m) => new Date(Date.UTC(2026, m - 1, 1)).toLocaleString(formatLocale(), { month: 'short', timeZone: 'UTC' });
const monthLong = (m) => new Date(Date.UTC(2026, m - 1, 1)).toLocaleString(formatLocale(), { month: 'long', timeZone: 'UTC' });

export default function SitesActivationPage({ canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ q: '', bureau: '', district: '', activity: '', status: '' });
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
    return { bureaux: uniq(rows.map((r) => r.bureau)), districts: uniq(rows.map((r) => r.district)), activities: uniq(rows.map((r) => r.activity)) };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filters.q.trim().toLowerCase();
    return data.filter((r) => {
      if (q && ![r.ident, r.publicId, r.name, r.commune, r.district, r.fokontany].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (filters.bureau && r.bureau !== filters.bureau) return false;
      if (filters.district && r.district !== filters.district) return false;
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
  const focusTotal = monthTotals[focus - 1] || { active: 0, inactive: 0, unknown: 0 };
  const activeYear = useMemo(() => filtered.filter((r) => activeInYear(r, pending)).length, [filtered, pending]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
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
    const ids = [...selected];
    setPending((p) => {
      const n = { ...p };
      for (const id of ids) {
        const row = data.find((r) => r.id === id); if (!row) continue;
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

  if (error) return <Alert tone="danger">{error}</Alert>;
  const years = [thisYear() - 1, thisYear(), thisYear() + 1];

  return (
    <div className="section-gap act">
      <div className="act-head">
        <label className="pb-year">{tr('Exercice')}
          <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="pb-year">{tr('Mois observé')}
          <select className="select" value={focus} onChange={(e) => setFocus(Number(e.target.value))}>
            {MONTHS.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
          </select>
        </label>
        <span className="mmr-spacer" />
        <Button variant="secondary" icon={Download} onClick={exportXlsx}>{tr('Exporter le classeur')}</Button>
        {canEdit && <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>{tr('Importer')}</Button>}
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={pickFile} />
      </div>

      {!data ? <Skeleton height={110} /> : (
        <Stats items={[
          { label: tr('Sites du registre'), value: formatInt(filtered.length), foot: activeFilters ? tr('selon les filtres') : tr('tous les sites') },
          { label: tr('Actifs en {m}', { m: monthLong(focus) }), value: formatInt(focusTotal.active), foot: tr('planifiables ce mois') },
          { label: tr('Inactifs en {m}', { m: monthLong(focus) }), value: formatInt(focusTotal.inactive), foot: tr('jamais planifiés ce mois') },
          { label: tr('Non renseignés en {m}', { m: monthLong(focus) }), value: formatInt(focusTotal.unknown), foot: tr('à compléter') },
          { label: tr('Actifs sur l\'exercice'), value: formatInt(activeYear), foot: tr('au moins un mois à Oui') },
        ]} />
      )}

      <Card className="pb-card">
        <div className="pb-filters">
          <label className="pb-search">
            <Search size={15} aria-hidden="true" />
            <input className="input" placeholder={tr('Identifiant, localité, commune…')} value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
          </label>
          {[['bureau', 'Tous les bureaux', options.bureaux], ['district', 'Tous les districts', options.districts], ['activity', 'Toutes les activités', options.activities]].map(([k, all, list]) => (
            <select key={k} className={`select pb-filter ${filters[k] ? 'is-set' : ''}`} value={filters[k]} onChange={(e) => setFilter(k, e.target.value)} aria-label={tr(all)}>
              <option value="">{tr(all)}</option>
              {list.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ))}
          <select className={`select pb-filter ${filters.status ? 'is-set' : ''}`} value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label={tr('Statut du mois observé')}>
            <option value="">{tr('Tous les statuts ({m})', { m: monthShort(focus) })}</option>
            <option value="oui">{tr('Actifs ({m})', { m: monthShort(focus) })}</option>
            <option value="non">{tr('Inactifs ({m})', { m: monthShort(focus) })}</option>
            <option value="vide">{tr('Non renseignés ({m})', { m: monthShort(focus) })}</option>
          </select>
          {activeFilters > 0 && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setFilters({ q: '', bureau: '', district: '', activity: '', status: '' })}>{tr('Effacer les filtres')}</Button>}
        </div>

        <p className="act-hint">
          {canEdit
            ? tr('Cliquez une case pour passer de Oui à Non, puis à vide. Un site inactif un mois n\'est jamais planifié ce mois-là dans le plan de suivi.')
            : tr('Un site inactif un mois n\'est jamais planifié ce mois-là dans le plan de suivi.')}
        </p>

        {selected.size > 0 && canEdit && (
          <div className="pb-selbar" role="region" aria-label={tr('Sélection')}>
            <strong>{tr('{n} site(s) sélectionné(s)', { n: formatInt(selected.size) })}</strong>
            <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'bulk' })}>{tr('Changer le statut sur une plage de mois')}</Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>{tr('Désélectionner')}</Button>
          </div>
        )}

        {!data ? <div className="card-body"><Skeleton height={320} /></div> : filtered.length === 0 ? (
          <EmptyState title={tr('Aucun site')}>{activeFilters ? tr('Aucun site ne correspond à ces filtres.') : tr('Le registre des sites est vide : ajoutez ou importez des sites dans Paramétrage › Localités › Sites.')}</EmptyState>
        ) : (
          <div className="table-wrap act-wrap">
            <table className="table act-table">
              <thead>
                <tr>
                  {canEdit && <th scope="col" className="act-check"><input type="checkbox" checked={allOnPage} onChange={selectPage} aria-label={tr('Sélectionner la page')} /></th>}
                  <th scope="col" className="act-ident">{tr('Identifiant')}</th>
                  <th scope="col" className="act-name">{tr('Localité')}</th>
                  <th scope="col" className="act-place">{tr('Commune · district')}</th>
                  {MONTHS.map((m) => <th key={m} scope="col" className={`act-m ${m === focus ? 'is-focus' : ''}`}>{monthShort(m)}</th>)}
                  <th scope="col" className="act-reason">{tr('Motif du changement')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? 'is-selected' : undefined}>
                    {canEdit && <td className="act-check"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={tr('Sélectionner {n}', { n: r.name })} /></td>}
                    <td className="act-ident">
                      <span className="mono act-ident-main">{r.ident || '—'}</span>
                      {r.publicId && r.publicId !== r.ident && <span className="mono act-sub" title={tr('Identifiant du site dans MEMS')}>{r.publicId}</span>}
                    </td>
                    <td className="act-name"><strong>{r.name}</strong>{r.activity && <span className="act-sub" title={r.activity}>{r.activity}</span>}</td>
                    <td className="act-place">
                      <span>{[r.commune, r.district].filter(Boolean).join(' · ') || '—'}</span>
                      {r.bureau && <span className="act-sub">{r.bureau}</span>}
                    </td>
                    {MONTHS.map((m) => {
                      const v = cellValue(r.months, pending, r.id, m);
                      const changed = Object.prototype.hasOwnProperty.call(pending, pendingKey(r.id, m));
                      return (
                        <td key={m} className={`act-m ${m === focus ? 'is-focus' : ''}`}>
                          <MonthCell value={v} changed={changed} disabled={!canEdit} onClick={() => toggle(r, m)}
                            label={`${r.name} · ${monthLong(m)}`} />
                        </td>
                      );
                    })}
                    <td className="act-reason">
                      {r.reason ? <span className="act-reason-text" title={`${r.reason} · ${formatDateTime(r.reasonAt)}`}>{r.reason}</span> : <span className="cell-empty">—</span>}
                      <button type="button" className="act-history" onClick={() => setModal({ kind: 'history', site: r })} aria-label={tr('Journal de {n}', { n: r.name })} title={tr('Journal des changements')}>
                        <History size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={canEdit ? 4 : 3} className="act-foot-label">{tr('Actifs (sur {n} sites)', { n: formatInt(filtered.length) })}</th>
                  {monthTotals.map((t) => <td key={t.month} className={`act-m act-foot ${t.month === focus ? 'is-focus' : ''}`}>{formatInt(t.active)}</td>)}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {data && filtered.length > PAGE && (
          <div className="loc-pager">
            <span>{tr('{a}–{b} sur {n}', { a: (page - 1) * PAGE + 1, b: Math.min(page * PAGE, filtered.length), n: filtered.length })}</span>
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{tr('Précédent')}</Button>
            <span className="tabular">{page} / {pages}</span>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{tr('Suivant')}</Button>
          </div>
        )}
      </Card>

      {pendingCount > 0 && canEdit && (
        <div className="act-savebar" role="region" aria-label={tr('Changements à enregistrer')}>
          <strong>{tr('{n} changement(s) non enregistré(s)', { n: formatInt(pendingCount) })}</strong>
          <input className="input act-savebar-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
            placeholder={tr('Motif du changement (facultatif, relu longtemps après)')} aria-label={tr('Motif du changement')} />
          <Button variant="ghost" onClick={() => setPending({})} disabled={saving}>{tr('Annuler')}</Button>
          <Button icon={Save} loading={saving} onClick={save}>{tr('Enregistrer')}</Button>
        </div>
      )}

      {modal?.kind === 'bulk' && <BulkStatusModal count={selected.size} onClose={() => setModal(null)} onApply={applyRange} />}
      {modal?.kind === 'import' && <ImportModal state={modal} onClose={() => setModal(null)} onCommit={commitImport} />}
      {modal?.kind === 'history' && <HistoryModal site={modal.site} year={year} onClose={() => setModal(null)} />}
    </div>
  );
}

/** Case d'un mois : couleur + icône + libellé (jamais la couleur seule). */
function MonthCell({ value, changed, disabled, onClick, label }) {
  const { tr } = useI18n();
  const text = value === true ? tr('Oui') : value === false ? tr('Non') : tr('non renseigné');
  const cls = value === true ? 'is-yes' : value === false ? 'is-no' : 'is-empty';
  return (
    <button type="button" className={`act-cell ${cls} ${changed ? 'is-changed' : ''}`} disabled={disabled} onClick={onClick}
      aria-label={`${label} : ${text}${changed ? ` (${tr('modifié')})` : ''}`} title={changed ? tr('Modifié, à enregistrer') : undefined}>
      {value === true && <><Check size={12} aria-hidden="true" /><span>{tr('Oui')}</span></>}
      {value === false && <><Minus size={12} aria-hidden="true" /><span>{tr('Non')}</span></>}
      {value === null && <span aria-hidden="true">·</span>}
    </button>
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
