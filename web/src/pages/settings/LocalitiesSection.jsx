import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, Plus, Pencil, Trash2, Search, MapPin, MapPinned, Globe2, Save, ChevronLeft, ChevronRight, Info, AlertTriangle, FileDown, Link2, Map as MapIcon } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, formatDateTime } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';
import PlaceMatchQueue from './PlaceMatchQueue.jsx';
import MapShapesTab from './MapShapesTab.jsx';
import SitesSection from './SitesSection.jsx';

/**
 * Paramétrage › Localités : (1) pays & découpage — identité, vocabulaire des
 * niveaux, import du shapefile et récapitulatif par niveau ; (2) répertoire —
 * liste paginée côté serveur (≈ 19 000 unités), filtres en cascade, recherche,
 * export, création / modification / suppression.
 */
const TABS = ['pays', 'repertoire', 'sites', 'rapprocher', 'contours'];

export default function LocalitiesSection({ isAdmin, canEdit = isAdmin, initialTab }) {
  const { tr } = useI18n();
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : 'pays');
  const [country, setCountry] = useState(null);
  const toast = useToast();

  const reload = useCallback(async () => {
    try { setCountry(await api.getCountry()); } catch (e) { toast.error(e.message); setCountry({ profile: {}, levels: [] }); }
  }, [toast]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="section-gap">
      <div className="segmented loc-tabs" role="tablist" aria-label={tr('Localités')}>
        <button type="button" role="tab" aria-selected={tab === 'pays'} aria-pressed={tab === 'pays'} onClick={() => setTab('pays')}>
          <Globe2 size={15} aria-hidden="true" /> {tr('Pays & découpage')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'repertoire'} aria-pressed={tab === 'repertoire'} onClick={() => setTab('repertoire')} disabled={!country?.levels?.length}>
          <MapPinned size={15} aria-hidden="true" /> {tr('Répertoire des localités')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'sites'} aria-pressed={tab === 'sites'} onClick={() => setTab('sites')}>
          <MapPin size={15} aria-hidden="true" /> {tr('Sites')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'rapprocher'} aria-pressed={tab === 'rapprocher'} onClick={() => setTab('rapprocher')} disabled={!country?.levels?.length}>
          <Link2 size={15} aria-hidden="true" /> {tr('À rapprocher')}
        </button>
        {isAdmin && (
          <button type="button" role="tab" aria-selected={tab === 'contours'} aria-pressed={tab === 'contours'} onClick={() => setTab('contours')} disabled={!country?.levels?.length}>
            <MapIcon size={15} aria-hidden="true" /> {tr('Contours de la carte')}
          </button>
        )}
      </div>
      {country === null ? <Card><div className="card-body"><Skeleton height={220} /></div></Card>
        : tab === 'pays' ? <CountryTab country={country} isAdmin={isAdmin} onChanged={reload} />
          : tab === 'sites' ? <SitesSection isAdmin={isAdmin} onOpenTab={setTab} />
          : tab === 'rapprocher' ? <PlaceMatchQueue canEdit={canEdit} />
            : tab === 'contours' ? <MapShapesTab isAdmin={isAdmin} />
            : <DirectoryTab levels={country.levels} isAdmin={isAdmin} onChanged={reload} />}
    </div>
  );
}

/* ------------------------------------------------------------ Pays & découpage */

function CountryTab({ country, isAdmin, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const p = country.profile || {};
    setForm({
      name: p.name || country.tenantName || '', iso3: p.iso3 || '', currency: p.currency || '',
      centerLat: p.centerLat ?? '', centerLng: p.centerLng ?? '', note: p.note || '',
      levels: country.levels.map((l) => ({ depth: l.depth, code: l.code, label: l.label, labelPlural: l.labelPlural })),
    });
  }, [country]);

  if (!form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLevel = (depth, k, v) => setForm((f) => ({ ...f, levels: f.levels.map((l) => (l.depth === depth ? { ...l, [k]: v } : l)) }));
  const levelsValid = form.levels.every((l) => l.label.trim() && l.labelPlural.trim());

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error(tr('Indiquez le nom du pays.')); return; }
    if (!levelsValid) { toast.error(tr('Chaque niveau doit avoir un libellé singulier et pluriel.')); return; }
    setSaving(true);
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v));
      await api.saveCountry({
        name: form.name.trim(), iso3: form.iso3.trim() || null, currency: form.currency.trim() || null,
        centerLat: num(form.centerLat), centerLng: num(form.centerLng), note: form.note.trim() || null,
        levels: form.levels.map((l) => ({ depth: l.depth, label: l.label.trim(), labelPlural: l.labelPlural.trim() })),
      });
      toast.success(tr('Identité du pays enregistrée.'));
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  async function onImport(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (country.levels.length && !window.confirm(tr('L\'import met à jour le découpage actuel ({n} unités) : les unités retrouvées (par P-code ou par nom) gardent leurs liens avec les contrats ; celles absentes du fichier seront supprimées. Continuer ?', { n: country.levels.reduce((a, l) => a + l.units, 0) }))) return;
    setImporting(true);
    try {
      let r;
      try { r = await api.importAdminBreakdown(file); } catch (err) {
        // Des zones de contrat dépendent d'unités absentes du fichier : confirmation explicite.
        if (err.status !== 409 || err.details?.code !== 'CONFIRM_REMOVALS') throw err;
        const d = err.details;
        if (!window.confirm(tr('{r} unité(s) absente(s) du fichier seront supprimées ; {z} zone(s) de {c} contrat(s) en dépendent et seront à resélectionner dans ces contrats. Importer quand même ?', { r: d.removed, z: d.contractZones, c: d.contracts }))) return;
        r = await api.importAdminBreakdown(file, { confirm: true });
      }
      setResult(r);
      toast.success(tr('{n} unité(s) importée(s) sur {l} niveau(x).', { n: r.areas, l: r.levels }));
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setImporting(false); }
  }

  const total = country.levels.reduce((a, l) => ({ units: a.units + l.units, pcode: a.pcode + l.withPcode, gps: a.gps + l.withGps }), { units: 0, pcode: 0, gps: 0 });
  const codeLike = country.levels.reduce((a, l) => a + (l.codeLikeNames || 0), 0);
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const coverageBadge = (n, d) => (d === 0 ? <span className="cell-empty">—</span>
    : n === d ? <Badge tone="green">{tr('complet')}</Badge>
      : <Badge tone={n === 0 ? 'red' : 'orange'}>{tr('partiel · {p} %', { p: pct(n, d) })}</Badge>);

  return (
    <>
      <Card aria-labelledby="loc-id-title">
        <CardHeader id="loc-id-title" title={<><span className="step-dot">1</span> {tr('Identité et vocabulaire')}</>}
          subtitle={tr('Nom, devise, centre de la carte et libellés des niveaux administratifs.')} />
        <form className="card-body loc-form" onSubmit={save}>
          <div className="form-grid loc-grid-3">
            <Field label={tr('Nom du pays')} required><input className="input" value={form.name} disabled={!isAdmin} onChange={(e) => set('name', e.target.value)} maxLength={120} /></Field>
            <Field label={tr('Code ISO')} hint={tr('Trois lettres — MDG, COD, ETH')}><input className="input mono" value={form.iso3} disabled={!isAdmin} maxLength={3} onChange={(e) => set('iso3', e.target.value.toUpperCase())} placeholder="MDG" /></Field>
            <Field label={tr('Devise locale')} hint={tr('Utilisée pour les contrats de prestataires')}><input className="input mono" value={form.currency} disabled={!isAdmin} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} placeholder="MGA" /></Field>
          </div>
          <div className="form-grid loc-grid-3">
            <Field label={tr('Latitude du centre')} hint={tr('Cadre la carte avant tout import de contours')}><input className="input tabular" type="number" step="any" min="-90" max="90" value={form.centerLat} disabled={!isAdmin} onChange={(e) => set('centerLat', e.target.value)} /></Field>
            <Field label={tr('Longitude du centre')}><input className="input tabular" type="number" step="any" min="-180" max="180" value={form.centerLng} disabled={!isAdmin} onChange={(e) => set('centerLng', e.target.value)} /></Field>
            <Field label={tr('Note')}><input className="input" value={form.note} disabled={!isAdmin} maxLength={500} onChange={(e) => set('note', e.target.value)} /></Field>
          </div>
          <div className="field">
            <span className="field-label">{tr('Libellés des niveaux administratifs')}</span>
            {form.levels.length === 0 ? <p className="hint">{tr('Les niveaux apparaissent après l\'import du découpage (étape 2).')}</p> : (
              <div className="table-wrap"><table className="table loc-levels">
                <thead><tr><th scope="col">{tr('Code du schéma')}</th><th scope="col">{tr('Singulier')}</th><th scope="col">{tr('Pluriel')}</th></tr></thead>
                <tbody>{form.levels.map((l) => (
                  <tr key={l.depth}>
                    <td><span className="mono loc-code">{l.code || `adm${l.depth}`}</span></td>
                    <td><input className={`input ${!l.label.trim() ? 'is-invalid' : ''}`} value={l.label} disabled={!isAdmin} maxLength={60} onChange={(e) => setLevel(l.depth, 'label', e.target.value)} aria-label={tr('Singulier')} /></td>
                    <td><input className={`input ${!l.labelPlural.trim() ? 'is-invalid' : ''}`} value={l.labelPlural} disabled={!isAdmin} maxLength={60} onChange={(e) => setLevel(l.depth, 'labelPlural', e.target.value)} aria-label={tr('Pluriel')} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <span className="field-hint">{tr('Singulier et pluriel sont exigés : un niveau non nommé s\'afficherait « adm4 » dans l\'application.')}</span>
          </div>
          {isAdmin && <div className="loc-actions"><Button type="submit" icon={Save} loading={saving} disabled={!levelsValid}>{tr('Enregistrer l\'identité')}</Button></div>}
        </form>
      </Card>

      <Card aria-labelledby="loc-cut-title">
        <CardHeader id="loc-cut-title" title={<><span className="step-dot">2</span> {tr('Découpage administratif — shapefile, .dbf ou .csv')}</>}
          subtitle={tr('Construit l\'arbre région → district → commune → fokontany, avec P-codes et coordonnées.')}>
          <div className="header-actions">
            <Button variant="ghost" icon={FileDown} onClick={() => downloadCsvTemplate(form.levels, tr)}>{tr('Modèle CSV')}</Button>
            {isAdmin && <>
              <input ref={fileRef} type="file" accept=".zip,.dbf,.csv,.txt,.xlsx,.xls" hidden onChange={onImport} />
              <Button icon={Upload} loading={importing} onClick={() => fileRef.current?.click()}>{tr('Importer un fichier')}</Button>
            </>}
          </div>
        </CardHeader>
        <div className="card-body section-gap">
          <div className="note"><Info size={18} aria-hidden="true" /><span>
            {tr('Formats : .zip de shapefile (le plus détaillé est retenu ; .shp/.dbf/.prj/.cpg lus), .dbf seul, ou .csv. Les colonnes sont reconnues par leur nom : ADM1_FR / ADM1_EN / ADM1_PCODE …, ou Région, District, Commune, Fokontany (+ « P-code », Latitude, Longitude). Le niveau pays (adm0) est ignoré. Un nouvel import met le découpage à jour : les unités retrouvées gardent leurs liens.')}
            {' '}{tr('Vous pouvez aussi fournir un XLSForm Kobo qui contient le référentiel (listes de choix ADM1CODE › ADM2CODE › …) : les codes officiels et les noms sont lus jusqu\'au fokontany.')}
          </span></div>
          {country.profile?.breakdownSource && (
            <p className="loc-vintage">{tr('Millésime')} : <strong className="mono">{country.profile.breakdownSource}</strong> — {formatDateTime(country.profile.breakdownImportedAt)} · {tr('{n} unité(s) au total', { n: total.units })}</p>
          )}
          {codeLike > 0 && (
            <Alert tone="warn" icon={AlertTriangle}>{tr('{n} unité(s) portent un code au lieu d\'un nom (import antérieur au correctif) : réimportez le shapefile pour retrouver les noms et les P-codes.', { n: codeLike })}</Alert>
          )}
          {result && (
            <Alert tone={result.warnings?.length || result.contractZonesStillDetached > 0 ? 'warn' : 'info'}>
              {tr('{n} unité(s) importée(s) · {p} avec P-code · {g} avec coordonnées.', { n: result.areas, p: result.withPcode, g: result.withGps })}
              {result.kept != null && (
                <div className="mmr-report">{tr('{k} conservée(s) avec leurs liens · {a} ajoutée(s) · {r} supprimée(s).', { k: result.kept, a: result.added, r: result.removed })}</div>
              )}
              {result.contractZonesRelinked > 0 && (
                <div className="mmr-report">{tr('{n} zone(s) de contrat détachée(s) par un import précédent ont été rattachées de nouveau.', { n: result.contractZonesRelinked })}</div>
              )}
              {result.contractZonesStillDetached > 0 && (
                <div className="mmr-report">{tr('{n} zone(s) de contrat restent détachées : ouvrez les contrats concernés pour les resélectionner.', { n: result.contractZonesStillDetached })}</div>
              )}
              {result.warnings?.map((w) => <div key={w} className="mmr-report">{w}</div>)}
            </Alert>
          )}
          {country.levels.length === 0 ? (
            <EmptyState icon={MapPinned} title={tr('Aucun découpage')}>{tr('Importez le shapefile du pays (ou un .csv conforme au modèle) pour alimenter les listes en cascade, le répertoire et les cartes.')}</EmptyState>
          ) : (
            <div className="table-wrap"><table className="table">
              <caption className="sr-only">{tr('Récapitulatif par niveau')}</caption>
              <thead><tr>
                <th scope="col">{tr('Niveau')}</th><th scope="col" className="num">{tr('Unités du découpage')}</th>
                <th scope="col" className="num">{tr('Avec P-code')}</th><th scope="col">{tr('P-codes')}</th>
                <th scope="col" className="num">{tr('Avec coordonnées')}</th><th scope="col">{tr('Fond de carte')}</th>
              </tr></thead>
              <tbody>{country.levels.map((l) => (
                <tr key={l.depth}>
                  <td><strong>{l.label}</strong> <span className="mono loc-code">{l.code}</span></td>
                  <td className="num tabular">{formatInt(l.units)}</td>
                  <td className="num tabular">{formatInt(l.withPcode)}</td><td>{coverageBadge(l.withPcode, l.units)}</td>
                  <td className="num tabular">{formatInt(l.withGps)}</td><td>{coverageBadge(l.withGps, l.units)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td><strong>{tr('Total')}</strong></td><td className="num"><strong>{formatInt(total.units)}</strong></td>
                <td className="num"><strong>{formatInt(total.pcode)}</strong></td><td /><td className="num"><strong>{formatInt(total.gps)}</strong></td><td /></tr></tfoot>
            </table></div>
          )}
        </div>
      </Card>
    </>
  );
}

function downloadCsvTemplate(levels, tr) {
  const labels = levels.length ? levels.map((l) => l.label) : ['Région', 'District', 'Commune', 'Fokontany'];
  const header = [...labels.flatMap((l) => [l, `${l} P-code`]), 'Latitude', 'Longitude'];
  const example = labels.flatMap((l, i) => [`${tr('Exemple')} ${l}`, `MG${String(i + 1).repeat(2)}`]).concat([-18.9, 47.5]);
  // Libellés de niveaux saisis par l'utilisateur : écrivain CSV partagé (échappement + formules neutralisées).
  downloadCsv('Modele_localites.csv', [header, example]);
}

/* ------------------------------------------------------------------ Répertoire */

const PAGE_SIZE = 50;

/** Sélecteurs en cascade des ancêtres (un par niveau au-dessus de `depth`). */
function useCascade(levels, depth) {
  const [chain, setChain] = useState([]);     // ids choisis, index = depth-1
  const [options, setOptions] = useState({}); // depth → unités
  useEffect(() => {
    api.listAdminAreas({ depth: 1 }).then((o) => setOptions((m) => ({ ...m, 1: o }))).catch(() => {});
  }, [levels]);
  const choose = useCallback((d, id) => {
    setChain((c) => { const n = c.slice(0, d - 1); if (id) n[d - 1] = id; return n; });
    setOptions((m) => { const n = { ...m }; Object.keys(n).forEach((k) => { if (Number(k) > d) delete n[k]; }); return n; });
    if (id) api.listAdminAreas({ depth: d + 1, parentId: id }).then((o) => setOptions((m) => ({ ...m, [d + 1]: o }))).catch(() => {});
  }, []);
  const ancestorId = chain.slice(0, depth - 1).filter(Boolean).pop() || null;
  return { chain, options, choose, ancestorId, setChain };
}

function DirectoryTab({ levels, isAdmin, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [depth, setDepth] = useState(levels[levels.length - 1]?.depth || 1);
  const { chain, options, choose, ancestorId } = useCascade(levels, depth);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null); // { row? } | null
  const level = levels.find((l) => l.depth === depth);
  const above = levels.filter((l) => l.depth < depth);

  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => { setPage(1); }, [depth, ancestorId, debounced]);

  const query = useMemo(() => ({ depth, ancestorId: ancestorId || undefined, q: debounced || undefined }), [depth, ancestorId, debounced]);
  const load = useCallback(async () => {
    try { setData(await api.listLocalities({ ...query, page, pageSize: PAGE_SIZE })); } catch (e) { toast.error(e.message); setData({ rows: [], total: 0 }); }
  }, [query, page, toast]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function remove(row) {
    let cascade = false;
    if (row.childCount > 0) {
      if (!window.confirm(tr('« {name} » contient des sous-unités. Supprimer AUSSI toute sa descendance ?', { name: row.name }))) return;
      cascade = true;
    } else if (!window.confirm(tr('Supprimer « {name} » ?', { name: row.name }))) return;
    try {
      const r = await api.deleteLocality(row.id, { cascade });
      toast.success(tr('{n} unité(s) supprimée(s).', { n: r.deleted }) + (r.contractsDetached ? ` ${tr('{n} zone(s) de contrat détachée(s) (chemin conservé).', { n: r.contractsDetached })}` : ''));
      load(); onChanged();
    } catch (e) { toast.error(e.message); }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <Card aria-labelledby="loc-dir-title">
      <CardHeader id="loc-dir-title" title={tr('Répertoire des localités')}>
        <div className="header-actions">
          <Button variant="secondary" icon={Download} onClick={() => api.exportLocalitiesCsv(query, `Localites_${level?.labelPlural || 'export'}.csv`).catch((e) => toast.error(e.message))}>{tr('Exporter')}</Button>
          {isAdmin && <Button icon={Plus} onClick={() => setEdit({ depth })}>{tr('Ajouter')}</Button>}
        </div>
      </CardHeader>

      <div className="loc-filters">
        <label className="loc-filter">
          <span className="sr-only">{tr('Niveau')}</span>
          <select className="select" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label={tr('Niveau')}>
            {levels.map((l) => <option key={l.depth} value={l.depth}>{l.labelPlural}</option>)}
          </select>
        </label>
        {above.map((l) => (
          <select key={l.depth} className="select" value={chain[l.depth - 1] || ''} aria-label={l.label}
            disabled={l.depth > 1 && !chain[l.depth - 2]} onChange={(e) => choose(l.depth, e.target.value || null)}>
            <option value="">{tr('Tous les {label}', { label: l.labelPlural.toLowerCase() })}</option>
            {(options[l.depth] || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ))}
        <label className="mmr-search">
          <Search size={15} aria-hidden="true" />
          <input className="input" placeholder={tr('Rechercher un nom ou un P-code…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="mmr-spacer" />
        {data && <span className="loc-count" aria-live="polite">{tr('{n} {label} · page {p} sur {t}', { n: data.total, label: (data.total > 1 ? level?.labelPlural : level?.label)?.toLowerCase() || '', p: page, t: pages })}</span>}
      </div>

      {data === null ? <div className="card-body"><Skeleton height={300} /></div> : data.rows.length === 0 ? (
        <EmptyState icon={MapPinned} title={tr('Aucune localité')}>{debounced || ancestorId ? tr('Aucun résultat pour ces filtres.') : tr('Ce niveau ne contient encore aucune unité.')}</EmptyState>
      ) : (
        <div className="table-wrap loc-wrap"><table className="table loc-table">
          <thead><tr>
            {above.map((l) => <th key={l.depth} scope="col">{l.label}</th>)}
            <th scope="col">{level?.label}</th>
            <th scope="col">{tr('P-code')}</th>
            <th scope="col" className="num">{tr('Latitude')}</th><th scope="col" className="num">{tr('Longitude')}</th>
            {depth < levels.length && <th scope="col" className="num">{tr('Sous-unités')}</th>}
            <th scope="col" className="num">{tr('Sites')}</th>
            {isAdmin && <th scope="col" aria-label={tr('Actions')} />}
          </tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.id} onDoubleClick={() => isAdmin && setEdit({ row: r, depth })}>
              {above.map((l, i) => <td key={l.depth} className="loc-muted">{r.ancestors[i] || '—'}</td>)}
              <td><strong>{r.name}</strong></td>
              <td>{r.pcode ? <span className="mono loc-pcode">{r.pcode}</span> : <span className="cell-empty">—</span>}</td>
              <td className="num tabular">{r.lat == null ? '—' : r.lat.toFixed(5)}</td>
              <td className="num tabular">{r.lng == null ? '—' : r.lng.toFixed(5)}</td>
              {depth < levels.length && <td className="num tabular">{formatInt(r.childCount)}</td>}
              <td className="num tabular">{r.siteCount ? formatInt(r.siteCount) : <span className="cell-empty">—</span>}</td>
              {isAdmin && <td className="mmr-actions">
                <Button size="sm" variant="ghost" icon={Pencil} aria-label={tr('Modifier')} title={tr('Modifier')} onClick={() => setEdit({ row: r, depth })} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} title={tr('Supprimer')} onClick={() => remove(r)} />
              </td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {data && data.total > PAGE_SIZE && (
        <div className="loc-pager">
          <span>{tr('{a}–{b} sur {n}', { a: (page - 1) * PAGE_SIZE + 1, b: Math.min(page * PAGE_SIZE, data.total), n: data.total })}</span>
          <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={tr('Page précédente')} />
          <span className="tabular">{page} / {pages}</span>
          <Button size="sm" variant="secondary" icon={ChevronRight} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={tr('Page suivante')} />
        </div>
      )}

      {edit && <LocalityModal levels={levels} depth={edit.depth} row={edit.row} presetParentChain={chain}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); onChanged(); }} />}
    </Card>
  );
}

/* --------------------------------------------------------- Création / édition */

function LocalityModal({ levels, depth: initialDepth, row, presetParentChain, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(row);
  const [depth, setDepth] = useState(initialDepth);
  const [form, setForm] = useState({ name: row?.name || '', pcode: row?.pcode || '', lat: row?.lat ?? '', lng: row?.lng ?? '' });
  const [parentChain, setParentChain] = useState([]);
  const [options, setOptions] = useState({});
  const [saving, setSaving] = useState(false);
  const level = levels.find((l) => l.depth === depth);
  const parents = levels.filter((l) => l.depth < depth);

  // Pré-sélection : parent actuel (édition) ou filtres du répertoire (création).
  useEffect(() => {
    let alive = true;
    (async () => {
      const opts = { 1: await api.listAdminAreas({ depth: 1 }) };
      let chain = [];
      if (editing && row.parentId) {
        // Remonte la chaîne par les noms d'ancêtres.
        for (let d = 1; d < depth; d += 1) {
          const found = (opts[d] || []).find((o) => o.name === row.ancestors[d - 1]);
          if (!found) break;
          chain[d - 1] = found.id;
          if (d + 1 < depth) opts[d + 1] = await api.listAdminAreas({ depth: d + 1, parentId: found.id });
        }
      } else {
        chain = presetParentChain.slice(0, depth - 1);
        for (let d = 1; d < depth - 1 && chain[d - 1]; d += 1) opts[d + 1] = await api.listAdminAreas({ depth: d + 1, parentId: chain[d - 1] });
      }
      if (alive) { setOptions(opts); setParentChain(chain); }
    })().catch(() => {});
    return () => { alive = false; };
  }, [depth, editing, row, presetParentChain]);

  async function choose(d, id) {
    const chain = parentChain.slice(0, d - 1); if (id) chain[d - 1] = id;
    setParentChain(chain);
    const next = { ...options }; Object.keys(next).forEach((k) => { if (Number(k) > d) delete next[k]; });
    if (id && d + 1 < depth) next[d + 1] = await api.listAdminAreas({ depth: d + 1, parentId: id });
    setOptions(next);
  }

  const parentId = depth > 1 ? parentChain[depth - 2] || null : null;
  const errors = {
    name: !form.name.trim() ? tr('Obligatoire') : null,
    parent: depth > 1 && !parentId ? tr('Choisissez l\'unité parente') : null,
    lat: form.lat !== '' && (Number(form.lat) < -90 || Number(form.lat) > 90) ? tr('Entre -90 et 90') : null,
    lng: form.lng !== '' && (Number(form.lng) < -180 || Number(form.lng) > 180) ? tr('Entre -180 et 180') : null,
    pcode: form.pcode && !/^[A-Za-z0-9._-]+$/.test(form.pcode) ? tr('Lettres, chiffres, . _ -') : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  async function save(e) {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    const num = (v) => (v === '' ? null : Number(v));
    try {
      if (editing) {
        const patch = { name: form.name.trim(), pcode: form.pcode.trim() || null, lat: num(form.lat), lng: num(form.lng) };
        if (parentId !== row.parentId) patch.parentId = parentId;
        const r = await api.updateLocality(row.id, patch);
        toast.success(r.descendants ? tr('Localité modifiée — {n} sous-unité(s) mise(s) à jour.', { n: r.descendants }) : tr('Localité modifiée.'));
      } else {
        await api.createLocality({ depth, parentId, name: form.name.trim(), pcode: form.pcode.trim() || null, lat: num(form.lat), lng: num(form.lng) });
        toast.success(tr('Localité ajoutée.'));
      }
      onSaved();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }

  return (
    <Modal open variant="drawer" onClose={() => !saving && onClose()}
      title={editing ? tr('Modifier « {name} »', { name: row.name }) : tr('Nouvelle localité')}
      subtitle={editing ? row.ancestors.concat(row.name).join(' › ') : tr('Choisissez le niveau et l\'unité parente, puis le nom.')}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="loc-form" icon={Save} loading={saving} disabled={invalid}>{tr('Enregistrer')}</Button></>}>
      <form id="loc-form" onSubmit={save} className="section-gap">
        <Field label={tr('Niveau')}>
          <select className="select" value={depth} disabled={editing} onChange={(e) => { setDepth(Number(e.target.value)); setParentChain([]); }}>
            {levels.map((l) => <option key={l.depth} value={l.depth}>{l.label} ({l.code})</option>)}
          </select>
        </Field>
        {parents.map((l) => (
          <Field key={l.depth} label={l.label} error={l.depth === depth - 1 ? errors.parent : null}>
            <select className="select" value={parentChain[l.depth - 1] || ''} disabled={l.depth > 1 && !parentChain[l.depth - 2]} onChange={(e) => choose(l.depth, e.target.value || null)}>
              <option value="">{tr('— choisir —')}</option>
              {(options[l.depth] || []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.pcode ? ` · ${o.pcode}` : ''}</option>)}
            </select>
          </Field>
        ))}
        {editing && parents.length > 0 && <p className="hint">{tr('Changer le parent déplace la localité et toute sa descendance.')}</p>}
        <Field label={tr('Nom')} required>
          <input className="input" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label={tr('P-code')} hint={tr('Unique dans le pays (ex. MG11101001001)')} error={errors.pcode}>
          <input className="input mono" value={form.pcode} maxLength={40} onChange={(e) => setForm({ ...form, pcode: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label={tr('Latitude')} error={errors.lat}><input className="input tabular" type="number" step="any" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></Field>
          <Field label={tr('Longitude')} error={errors.lng}><input className="input tabular" type="number" step="any" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></Field>
        </div>
        {editing && <p className="hint">{tr('Renommer met à jour le chemin de toute la descendance. Les sites et contrats déjà saisis gardent leur libellé.')}</p>}
      </form>
    </Modal>
  );
}
