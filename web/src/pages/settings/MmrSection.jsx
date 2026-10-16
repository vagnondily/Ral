import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, Upload, Gauge, Info, RotateCcw, Trash2, Save, Undo2, RefreshCw, Search, CheckSquare, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton, Stats } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatInt, formatLocale } from '../../lib/format.js';
import { useI18n } from '../../lib/i18n.jsx';
import { richText } from '../../lib/contracts.js';
import {
  INPUT_FIELDS, resolvePlan, summarizePlan, registryCounts, rowErrors, toPayload, isChanged, normCat,
} from '../../lib/mmr.js';

/**
 * Paramètres MMR — grille éditable « type Excel » (feuille Overreaching
 * Parameters du plan de suivi). Un plan général par catégorie d'activité, des
 * dérogations par bureau qui HÉRITENT du plan général tant qu'elles ne sont pas
 * modifiées. Toutes les modifications restent locales jusqu'à « Enregistrer »,
 * qui envoie un seul lot transactionnel (PUT /settings/mmr/bulk).
 */
const RISK = { 1: 'Faible', 2: 'Moyen', 3: 'Élevé' };
const RISK_TONE = { 1: 'green', 2: 'orange', 3: 'red' };
const NUM_COLS = [
  { key: 'operationDuration', label: 'Durée', title: "Durée d'opération dans l'année (mois)", w: 62, min: 0, max: 12 },
  { key: 'numberOfSites', label: 'Nb sites', title: 'Nombre de sites actifs', w: 76, min: 0 },
  { key: 'personsToDeploy', label: 'Pers.', title: 'Personnes à déployer', w: 60, min: 0 },
  { key: 'visitsPerDay', label: 'Suivis/j', title: 'Suivis réalisables par jour et par personne', w: 64, min: 0, step: 0.5 },
  { key: 'workingDays', label: 'Jours', title: 'Jours ouvrés par mois', w: 58, min: 0, max: 31 },
  { key: 'feasible', label: 'Faisable', title: 'Faisable saisi (sites/mois) — ignoré si la capacité est calculée', w: 70, min: 0 },
];
const BULK_FIELDS = [
  ['operationDuration', 'Durée (mois)'], ['riskLevel', 'Risque (1-3)'], ['personsToDeploy', 'Personnes'],
  ['visitsPerDay', 'Suivis / jour'], ['workingDays', 'Jours ouvrés'], ['feasible', 'Faisable saisi'],
];
let tmpSeq = 0;
const tmpKey = () => `new-${(tmpSeq += 1)}`;
const fromServer = (r) => ({ ...Object.fromEntries(INPUT_FIELDS.map((k) => [k, r[k] ?? ''])), key: r.id, id: r.id, fieldOfficeId: r.fieldOfficeId || null, activityCategory: r.activityCategory });
const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString(formatLocale(), { maximumFractionDigits: d }));

export default function MmrSection({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [orig, setOrig] = useState(null);       // Map key → ligne enregistrée
  const [work, setWork] = useState([]);         // lignes de travail (copie éditable)
  const [offices, setOffices] = useState([]);
  const [registry, setRegistry] = useState([]);
  const [scope, setScope] = useState('');       // '' = plan général, sinon id bureau
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState(null);   // compte rendu d'import
  const [newCat, setNewCat] = useState('');
  const fileRef = useRef(null);

  async function reload() {
    try {
      const [rows, reg] = await Promise.all([api.listMmr(), api.mmrRegistry().catch(() => [])]);
      setOrig(new Map(rows.map((r) => [r.id, fromServer(r)])));
      setWork(rows.map(fromServer));
      setRegistry(reg);
      setSelected(new Set());
    } catch (e) { toast.error(e.message); setOrig(new Map()); setWork([]); }
  }
  useEffect(() => {
    reload();
    api.listOffices().then((o) => setOffices(o.filter((x) => x.active))).catch(() => setOffices([]));
    /* eslint-disable-next-line */
  }, []);

  // ---- état dérivé ------------------------------------------------------
  const live = useMemo(() => work.filter((r) => !r.deleted), [work]);
  const plan = useMemo(() => resolvePlan(live, scope || null), [live, scope]);
  const regCounts = useMemo(() => registryCounts(registry, scope || null), [registry, scope]);
  const shown = useMemo(() => {
    const q = normCat(query);
    return q ? plan.filter((p) => normCat(p.activityCategory).includes(q)) : plan;
  }, [plan, query]);
  const totals = useMemo(() => summarizePlan(plan), [plan]);
  const overridesByCat = useMemo(() => {
    const m = new Map();
    for (const r of live) if (r.fieldOfficeId) m.set(normCat(r.activityCategory), (m.get(normCat(r.activityCategory)) || 0) + 1);
    return m;
  }, [live]);
  const errorsByKey = useMemo(() => {
    const m = new Map(); const seen = new Map();
    for (const r of live) {
      const errs = rowErrors(r);
      const dupKey = `${r.fieldOfficeId || ''}|${normCat(r.activityCategory)}`;
      if (seen.has(dupKey)) errs.activityCategory = 'Catégorie en double';
      seen.set(dupKey, r.key);
      if (Object.keys(errs).length) m.set(r.key, errs);
    }
    return m;
  }, [live]);
  const changes = useMemo(() => {
    if (!orig) return { upserts: [], deletes: [] };
    const deletes = work.filter((r) => r.deleted && r.id).map((r) => r.id);
    const upserts = live.filter((r) => isChanged(r, r.id ? orig.get(r.id) : null)).map(toPayload);
    return { upserts, deletes };
  }, [work, live, orig]);
  const dirtyCount = changes.upserts.length + changes.deletes.length;
  const dirty = dirtyCount > 0;

  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // ---- mutations locales -------------------------------------------------
  const patchRow = (key, patch) => setWork((w) => w.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Édite une cellule d'une ligne du plan affiché ; sur un bureau, une ligne héritée devient une dérogation. */
  function edit(p, field, value) {
    if (p.override || !scope) { patchRow((p.override || p.general).key, { [field]: value }); return; }
    const base = p.general;
    setWork((w) => [...w, { ...Object.fromEntries(INPUT_FIELDS.map((k) => [k, base[k] ?? ''])), key: tmpKey(), id: null, fieldOfficeId: scope, activityCategory: base.activityCategory, [field]: value }]);
  }

  /** Renomme une catégorie du plan général et ses dérogations (elles y sont liées par le libellé). */
  function rename(p, value) {
    const old = normCat(p.activityCategory);
    setWork((w) => w.map((r) => (normCat(r.activityCategory) === old && !r.deleted ? { ...r, activityCategory: value } : r)));
  }

  const dropRow = (row) => setWork((w) => (row.id ? w.map((r) => (r.key === row.key ? { ...r, deleted: true } : r)) : w.filter((r) => r.key !== row.key)));

  function revertToGeneral(p) { if (p.override) dropRow(p.override); }

  function removeCategory(p) {
    const n = overridesByCat.get(p.key) || 0;
    if (!window.confirm(n ? tr('Supprimer « {cat} » du plan général et ses {n} dérogation(s) ?', { cat: p.activityCategory, n }) : tr('Supprimer « {cat} » du plan général ?', { cat: p.activityCategory }))) return;
    setWork((w) => w.flatMap((r) => {
      if (normCat(r.activityCategory) !== p.key || r.deleted) return [r];
      return r.id ? [{ ...r, deleted: true }] : [];
    }));
  }

  function addCategory() {
    const label = newCat.trim();
    if (!label) return;
    if (plan.some((p) => p.key === normCat(label))) { toast.error(tr('Cette catégorie existe déjà.')); return; }
    const sites = registryCounts(registry, null).get(normCat(label)) || 0;
    setWork((w) => [...w, { key: tmpKey(), id: null, fieldOfficeId: null, activityCategory: label, operationDuration: 12, numberOfSites: sites, riskLevel: 2, personsToDeploy: '', visitsPerDay: '', workingDays: '', feasible: '', note: '' }]);
    setNewCat('');
  }

  function syncSites(targets) {
    let n = 0;
    for (const p of targets) {
      const reg = regCounts.get(p.key);
      if (reg != null && Number(p.row.numberOfSites) !== reg) { edit(p, 'numberOfSites', reg); n += 1; }
    }
    toast.success(n ? tr('{n} ligne(s) alignée(s) sur le référentiel de sites.', { n }) : tr('Déjà aligné sur le référentiel.'));
  }

  // Compléter depuis le référentiel (plan général) : aligne les lignes existantes
  // sur le vrai nombre de sites par activité ET crée les activités manquantes
  // (celles qui ont des sites au registre mais pas de ligne MMR).
  function completeFromRegistry() {
    const allReg = registryCounts(registry, null); // normCat → nb de sites
    const existing = new Set(plan.map((p) => p.key));
    const toAdd = [...allReg.entries()].filter(([k, n]) => !existing.has(k) && n > 0).map(([k, n]) => ({
      key: tmpKey(), id: null, fieldOfficeId: null,
      activityCategory: registry.find((r) => normCat(r.activity) === k)?.activity || k,
      operationDuration: 12, numberOfSites: n, riskLevel: 2, personsToDeploy: '', visitsPerDay: '', workingDays: '', feasible: '', note: '',
    }));
    const toSync = live.filter((r) => !r.deleted && !r.fieldOfficeId
      && allReg.get(normCat(r.activityCategory)) != null
      && Number(r.numberOfSites) !== allReg.get(normCat(r.activityCategory)));
    const syncKeys = new Set(toSync.map((r) => r.key));
    if (!toAdd.length && !toSync.length) { toast.success(tr('Déjà complet et aligné sur le référentiel.')); return; }
    setWork((w) => w.map((r) => (syncKeys.has(r.key) ? { ...r, numberOfSites: allReg.get(normCat(r.activityCategory)) } : r)).concat(toAdd));
    toast.success(tr('{a} activité(s) ajoutée(s), {s} ligne(s) alignée(s). Pensez à enregistrer.', { a: toAdd.length, s: toSync.length }));
  }

  function applyBulk(field, value) {
    const targets = plan.filter((p) => selected.has(p.key));
    targets.forEach((p) => edit(p, field, value)); // la barre d'enregistrement affiche le compte
  }

  function discard() { if (window.confirm(tr('Abandonner toutes les modifications non enregistrées ?'))) { setWork([...orig.values()].map((r) => ({ ...r }))); setReport(null); } }

  async function save() {
    if (errorsByKey.size) { toast.error(tr('Corrigez les cellules en rouge avant d\'enregistrer.')); return; }
    setSaving(true);
    try {
      const r = await api.saveMmrBulk(changes);
      toast.success(tr('Paramètres MMR enregistrés ({c} créé(s), {u} modifié(s), {d} supprimé(s)).', { c: r.created, u: r.updated, d: r.deleted }));
      setReport(null);
      await reload();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function onImport(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      const res = await api.importMmrXlsx(file);
      // Fusion dans la grille : met à jour la ligne de même portée × catégorie, sinon l'ajoute.
      setWork((w) => {
        const next = [...w];
        for (const row of res.rows) {
          const fill = row.numberOfSitesMissing ? (registryCounts(registry, row.fieldOfficeId).get(normCat(row.activityCategory)) ?? row.numberOfSites) : row.numberOfSites;
          const vals = Object.fromEntries(INPUT_FIELDS.map((k) => [k, k === 'numberOfSites' ? fill : (row[k] ?? '')]));
          const i = next.findIndex((r) => !r.deleted && (r.fieldOfficeId || null) === (row.fieldOfficeId || null) && normCat(r.activityCategory) === normCat(row.activityCategory));
          if (i >= 0) next[i] = { ...next[i], ...vals };
          else next.push({ ...vals, key: tmpKey(), id: null, fieldOfficeId: row.fieldOfficeId || null, activityCategory: row.activityCategory });
        }
        return next;
      });
      setReport({ file: file.name, sheet: res.sheet, loaded: res.rows.length, filled: res.rows.filter((r) => r.numberOfSitesMissing).length, errors: res.errors, skipped: res.skipped });
      toast.success(tr('{n} ligne(s) chargée(s) dans la grille — vérifiez puis enregistrez.', { n: res.rows.length }));
    } catch (err) { toast.error(err.message); }
  }

  const toggle = (k) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.key));
  const officeName = scope ? offices.find((o) => o.id === scope)?.name : null;
  const syncable = plan.filter((p) => regCounts.has(p.key) && Number(p.row.numberOfSites) !== regCounts.get(p.key));
  // Activités qui ont des sites au registre mais pas de ligne (plan général seulement).
  const missingCats = scope ? 0 : [...registryCounts(registry, null).entries()]
    .filter(([k, n]) => n > 0 && !plan.some((p) => p.key === k)).length;

  // ---- rendu --------------------------------------------------------------
  return (
    <Card aria-labelledby="mmr-title" className="mmr-card">
      <CardHeader id="mmr-title" title={tr('Paramètres MMR — exigences minimales de suivi')}
        subtitle={tr('Grille éditable : un plan général par catégorie d\'activité, et des dérogations par bureau qui héritent du plan général. Intervalle, fréquence, cible, capacité et valeurs ajustées sont recalculés à la frappe.')}>
        <div className="header-actions">
        <Button variant="secondary" icon={Download} onClick={() => api.exportMmrXlsx().catch((e) => toast.error(e.message))}
          title={tr('Classeur Excel aux formules vivantes ; modifiable hors ligne puis réimportable.')}>{tr('Exporter')}</Button>
        {isAdmin && <>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={onImport} />
          <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}
            title={tr('Accepte l\'export MEMS ou le classeur du plan de suivi (feuille « Overreaching Parameters »). Rien n\'est enregistré avant « Enregistrer ».')}>{tr('Importer')}</Button>
        </>}
        </div>
      </CardHeader>

      <div className="mmr-toolbar">
        <div className="segmented" role="group" aria-label={tr('Portée')}>
          <button type="button" aria-pressed={!scope} onClick={() => { setScope(''); setSelected(new Set()); }}>{tr('Plan général')}</button>
          <button type="button" aria-pressed={Boolean(scope)} onClick={() => { if (!scope && offices[0]) setScope(offices[0].id); setSelected(new Set()); }}>{tr('Dérogation bureau')}</button>
        </div>
        {scope && (
          <select className="select" value={scope} onChange={(e) => { setScope(e.target.value); setSelected(new Set()); }} aria-label={tr('Bureau')}>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <label className="mmr-search">
          <Search size={15} aria-hidden="true" />
          <input className="input" placeholder={tr('Filtrer les catégories…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="mmr-spacer" />
        {isAdmin && !scope && (syncable.length > 0 || missingCats > 0) && (
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={completeFromRegistry}
            title={tr('Aligne le nombre de sites sur le référentiel ET ajoute les activités du registre sans paramètre MMR.')}>{tr('Compléter depuis le référentiel ({n})', { n: syncable.length + missingCats })}</Button>
        )}
        {isAdmin && syncable.length > 0 && (
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => syncSites(syncable)}
            title={tr('Reprend le nombre de sites du référentiel (sites par activité, antennes comptées avec leur bureau).')}>{tr('Nb sites ← référentiel ({n})', { n: syncable.length })}</Button>
        )}
      </div>

      {orig === null ? <div className="card-body"><Skeleton height={160} /></div> : (
        <>
          <Stats compact items={[
            { label: tr('Catégories'), value: formatInt(totals.categories), foot: scope ? tr('{n} dérogation(s) · {office}', { n: totals.overrides, office: officeName }) : tr('{n} dérogation(s) bureau', { n: live.filter((r) => r.fieldOfficeId).length }) },
            { label: tr('Sites'), value: formatInt(totals.sites), foot: tr('référentiel : {n}', { n: formatInt([...regCounts.values()].reduce((a, b) => a + b, 0)) }) },
            { label: tr('Ciblé / mois'), value: fmt(totals.targetedPerMonth, 0), foot: tr('sites à visiter par mois') },
            { label: tr('Capacité / mois'), value: fmt(totals.feasible, 0), foot: tr('faisable (calculé ou saisi)') },
            { label: tr('Couverture'), value: totals.coverageRatio == null ? '—' : tr('{p} %', { p: Math.round(totals.coverageRatio * 100) }), foot: tr('capacité ÷ cible (lignes avec capacité)') },
          ]} />

          {report && (
            <Alert tone={report.errors.length ? 'warn' : 'info'} icon={Info}>
              {richText(tr('<strong>{file}</strong> (feuille « {sheet} ») : {n} ligne(s) chargée(s) dans la grille, non encore enregistrée(s).', { file: report.file, sheet: report.sheet, n: report.loaded }))}
              {report.filled > 0 && <> {tr('{n} nombre(s) de sites non calculé(s) dans le fichier repris du référentiel.', { n: report.filled })}</>}
              {report.skipped.length > 0 && <div className="mmr-report">{tr('Ignorées : {list}', { list: report.skipped.map((s) => `L${s.row} ${s.message}`).join(' · ') })}</div>}
              {report.errors.length > 0 && <div className="mmr-report is-error">{tr('Erreurs : {list}', { list: report.errors.map((s) => `${s.row ? `L${s.row} ` : ''}${s.message}`).join(' · ') })}</div>}
              <button type="button" className="link-btn" onClick={() => setReport(null)}>{tr('Masquer')}</button>
            </Alert>
          )}

          {isAdmin && selected.size > 0 && <BulkBar count={selected.size} onApply={applyBulk} onClear={() => setSelected(new Set())}
            onSync={() => syncSites(plan.filter((p) => selected.has(p.key)))}
            onRevert={scope ? () => plan.filter((p) => selected.has(p.key)).forEach(revertToGeneral) : null} />}

          {plan.length === 0 && !isAdmin ? (
            <EmptyState icon={Gauge} title={tr('Aucun paramètre MMR')}>{tr('Le plan général de suivi n\'a pas encore été défini.')}</EmptyState>
          ) : (
            <div className="table-wrap mmr-wrap">
              <table className="table mmr-grid">
                <thead>
                  <tr>
                    {isAdmin && <th scope="col" className="mmr-check"><input type="checkbox" aria-label={tr('Tout sélectionner')} checked={allShownSelected}
                      onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((p) => p.key)))} /></th>}
                    <th scope="col" className="mmr-cat">{tr('Catégorie d\'activité')}</th>
                    <th scope="col" className="num" title={tr(NUM_COLS[0].title)}>{tr(NUM_COLS[0].label)}</th>
                    <th scope="col" className="num" title={tr(NUM_COLS[1].title)}>{tr(NUM_COLS[1].label)}</th>
                    <th scope="col" title={tr('1 = faible · 2 = moyen · 3 = élevé')}>{tr('Risque')}</th>
                    {NUM_COLS.slice(2).map((c) => <th key={c.key} scope="col" className="num" title={tr(c.title)}>{tr(c.label)}</th>)}
                    <th scope="col" className="num mmr-derived" title={tr('Intervalle minimal entre deux visites = durée ÷ risque')}>{tr('Interv.')}</th>
                    <th scope="col" className="num mmr-derived" title={tr('Fréquence minimale = durée ÷ intervalle')}>{tr('Fréq.')}</th>
                    <th scope="col" className="num mmr-derived" title={tr('Sites à visiter par mois = nb sites ÷ intervalle')}>{tr('Ciblé/mois')}</th>
                    <th scope="col" className="num mmr-derived" title={tr('Capacité = personnes × suivis/jour × jours ouvrés (sinon faisable saisi)')}>{tr('Capacité')}</th>
                    <th scope="col" className="mmr-derived" title={tr('Capacité ÷ ciblé')}>{tr('Couverture')}</th>
                    <th scope="col" className="num mmr-derived" title={tr('Intervalle ajusté à la capacité (CO adjusted) = max(durée ÷ (fréquence × couverture), 1)')}>{tr('Interv. ajusté')}</th>
                    {isAdmin && <th scope="col" aria-label={tr('Actions')} />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const row = p.row; const errs = errorsByKey.get(row.key) || {};
                    const base = p.override ? orig.get(p.override.id) : orig.get(p.general?.id);
                    const rowDirty = !p.inherited && (row.id ? isChanged(row, base) : true);
                    const reg = regCounts.get(p.key);
                    const cell = (field, extra = {}) => (
                      <NumCell value={row[field]} error={errs[field]} inherited={p.inherited} readOnly={!isAdmin}
                        changed={!p.inherited && base != null && String(row[field] ?? '') !== String(base[field] ?? '')}
                        disabled={field === 'feasible' && p.derived.computedCapacity != null}
                        onChange={(v) => edit(p, field, v)} {...extra} />
                    );
                    return (
                      <tr key={p.key} className={[p.inherited && 'is-inherited', rowDirty && 'is-dirty', selected.has(p.key) && 'is-selected'].filter(Boolean).join(' ')}>
                        {isAdmin && <td className="mmr-check"><input type="checkbox" aria-label={tr('Sélectionner {name}', { name: p.activityCategory })} checked={selected.has(p.key)} onChange={() => toggle(p.key)} /></td>}
                        <td className="mmr-cat">
                          {isAdmin && !scope ? (
                            <input className={`cell-input cell-text ${errs.activityCategory ? 'is-invalid' : ''}`} value={row.activityCategory}
                              title={errs.activityCategory ? tr(errs.activityCategory) : tr('Renommer (les dérogations suivent)')} aria-label={tr('Catégorie d\'activité')} onChange={(e) => rename(p, e.target.value)} />
                          ) : <span className="mmr-cat-label">{p.activityCategory}</span>}
                          <span className="mmr-tags">
                            {scope && (p.inherited ? <Badge tone="blue">{tr('hérité du plan général')}</Badge> : <Badge tone="orange">{tr('dérogation')}</Badge>)}
                            {!scope && overridesByCat.get(p.key) > 0 && <Badge>{tr('{n} dérogation(s)', { n: overridesByCat.get(p.key) })}</Badge>}
                            {scope && !p.general && <Badge tone="red">{tr('absente du plan général')}</Badge>}
                          </span>
                        </td>
                        <td className="num">{cell('operationDuration', { min: 0, max: 12, w: 54 })}</td>
                        <td className="num">
                          {cell('numberOfSites', { min: 0, w: 70 })}
                          {reg != null && Number(row.numberOfSites) !== reg && (
                            isAdmin
                              ? <button type="button" className="mmr-reg" onClick={() => edit(p, 'numberOfSites', reg)} title={tr('Reprendre le nombre de sites du référentiel')}>{tr('référentiel : {n}', { n: formatInt(reg) })}</button>
                              : <span className="mmr-reg">{tr('référentiel : {n}', { n: formatInt(reg) })}</span>
                          )}
                        </td>
                        <td>
                          {isAdmin ? (
                            <select className={`cell-input cell-select risk-${row.riskLevel} ${errs.riskLevel ? 'is-invalid' : ''} ${p.inherited ? 'is-inherited' : ''}`} value={row.riskLevel} aria-label={tr('Niveau de risque')}
                              onChange={(e) => edit(p, 'riskLevel', Number(e.target.value))}>
                              {[1, 2, 3].map((n) => <option key={n} value={n}>{n} — {tr(RISK[n])}</option>)}
                            </select>
                          ) : <Badge tone={RISK_TONE[row.riskLevel]}>{RISK[row.riskLevel] ? tr(RISK[row.riskLevel]) : row.riskLevel}</Badge>}
                        </td>
                        {NUM_COLS.slice(2).map((c) => <td key={c.key} className="num">{cell(c.key, { min: c.min, max: c.max, step: c.step, w: c.w - 8 })}</td>)}
                        <td className="num mmr-derived">{fmt(p.derived.interval)}</td>
                        <td className="num mmr-derived">{fmt(p.derived.frequency)}</td>
                        <td className="num mmr-derived"><strong>{fmt(p.derived.targetedPerMonth, 1)}</strong></td>
                        <td className="num mmr-derived">{fmt(p.derived.feasibleEffective, 1)}{p.derived.feasibleSource && <div className="site-meta">{tr(p.derived.feasibleSource)}</div>}</td>
                        <td className="mmr-derived">{p.derived.coverageRatio == null ? <span className="cell-empty">—</span>
                          : <Badge tone={p.derived.coverageRatio >= 1 ? 'green' : (p.derived.coverageRatio >= 0.5 ? 'orange' : 'red')}>{tr('{p} %', { p: Math.round(p.derived.coverageRatio * 100) })}</Badge>}</td>
                        <td className="num mmr-derived" title={p.derived.adjustedFrequency != null ? tr('Fréquence ajustée : {v}', { v: fmt(p.derived.adjustedFrequency) }) : undefined}>{fmt(p.derived.adjustedInterval)}</td>
                        {isAdmin && (
                          <td className="mmr-actions">
                            {scope && p.override && <Button size="sm" variant="ghost" icon={RotateCcw} aria-label={tr('Revenir au plan général')} title={tr('Supprimer la dérogation et revenir au plan général')} onClick={() => revertToGeneral(p)} />}
                            {!scope && <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer la catégorie')} title={tr('Supprimer la catégorie (et ses dérogations)')} onClick={() => removeCategory(p)} />}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={isAdmin ? 17 : 15}><EmptyState icon={Gauge} title={query ? tr('Aucune catégorie ne correspond') : tr('Aucune catégorie')}>
                      {query ? tr('Modifiez le filtre.') : tr('Ajoutez une catégorie ci-dessous ou importez le classeur du plan de suivi.')}</EmptyState></td></tr>
                  )}
                </tbody>
                {plan.length > 0 && (
                  <tfoot>
                    <tr>
                      {isAdmin && <td />}
                      <td><strong>{tr('Total')}</strong></td><td />
                      <td className="num"><strong>{formatInt(totals.sites)}</strong></td>
                      <td colSpan={5} /><td colSpan={2} />
                      <td className="num"><strong>{fmt(totals.targetedPerMonth, 1)}</strong></td>
                      <td className="num"><strong>{fmt(totals.feasible, 1)}</strong></td>
                      <td>{totals.coverageRatio != null && <Badge tone={totals.coverageRatio >= 1 ? 'green' : 'red'}>{tr('{p} %', { p: Math.round(totals.coverageRatio * 100) })}</Badge>}</td>
                      <td />{isAdmin && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {isAdmin && !scope && (
            <form className="mmr-add" onSubmit={(e) => { e.preventDefault(); addCategory(); }}>
              <input className="input" list="mmr-suggest" placeholder={tr('Nouvelle catégorie d\'activité…')} value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label={tr('Nouvelle catégorie')} />
              <datalist id="mmr-suggest">
                {[...registryCounts(registry, null).keys()].filter((k) => !plan.some((p) => p.key === k))
                  .map((k) => registry.find((r) => normCat(r.activity) === k)?.activity || k).map((label) => <option key={label} value={label} />)}
              </datalist>
              <Button type="submit" variant="secondary" icon={Plus} disabled={!newCat.trim()}>{tr('Ajouter')}</Button>
              <span className="hint">{tr('Suggestions : activités du référentiel de sites sans paramètre. Le nombre de sites est prérempli.')}</span>
            </form>
          )}

          <div className="note"><Info size={18} aria-hidden="true" /><span>
            {tr('Intervalle = durée ÷ risque · Fréquence = durée ÷ intervalle · Ciblé/mois = nb sites ÷ intervalle · Capacité = personnes × suivis/jour × jours ouvrés (sinon faisable saisi) · Couverture = capacité ÷ ciblé · Intervalle ajusté = max(durée ÷ (fréquence × couverture), 1).')}
            {scope && ` ${tr('Sur un bureau, modifier une cellule héritée crée une dérogation ; ↺ la supprime.')}`}
          </span></div>
        </>
      )}

      {isAdmin && dirty && (
        <div className="mmr-savebar" role="region" aria-label={tr('Modifications non enregistrées')}>
          <span>{richText(tr('<strong>{n}</strong> modification(s) non enregistrée(s)', { n: dirtyCount }))}{errorsByKey.size > 0 && <span className="mmr-err"> · {tr('{n} ligne(s) à corriger', { n: errorsByKey.size })}</span>}</span>
          <Button variant="secondary" icon={Undo2} onClick={discard} disabled={saving}>{tr('Annuler')}</Button>
          <Button icon={Save} onClick={save} loading={saving} disabled={errorsByKey.size > 0}>{tr('Enregistrer')}</Button>
        </div>
      )}
    </Card>
  );
}

/** Cellule numérique éditable en place (aspect tableur). */
function NumCell({ value, onChange, error, inherited, changed, readOnly, disabled, min, max, step = 1, w = 64 }) {
  const { tr } = useI18n();
  if (readOnly) return <span className="tabular">{value === '' || value == null ? '—' : fmt(value)}</span>;
  return (
    <input className={['cell-input', 'tabular', error && 'is-invalid', inherited && 'is-inherited', changed && 'is-changed'].filter(Boolean).join(' ')}
      style={{ width: w }} type="number" inputMode="decimal" min={min} max={max} step={step}
      value={value ?? ''} disabled={disabled} title={error ? tr(error) : (disabled ? tr('Capacité calculée à partir des ressources') : undefined)}
      aria-invalid={error ? true : undefined}
      onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)} />
  );
}

function BulkBar({ count, onApply, onClear, onSync, onRevert }) {
  const { tr } = useI18n();
  const [field, setField] = useState('workingDays');
  const [value, setValue] = useState('');
  return (
    <div className="mmr-bulk" role="region" aria-label={tr('Modification groupée')}>
      <CheckSquare size={16} aria-hidden="true" />
      <strong>{tr('{n} sélectionnée(s)', { n: count })}</strong>
      <span className="mmr-bulk-sep" />
      <select className="select" value={field} onChange={(e) => setField(e.target.value)} aria-label={tr('Champ')}>
        {BULK_FIELDS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
      </select>
      {field === 'riskLevel'
        ? <select className="select" value={value} onChange={(e) => setValue(e.target.value)} aria-label={tr('Valeur')}><option value="">—</option>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} — {tr(RISK[n])}</option>)}</select>
        : <input className="input tabular" style={{ width: 96 }} type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} aria-label={tr('Valeur')} placeholder={tr('valeur')} />}
      <Button size="sm" onClick={() => value !== '' && onApply(field, field === 'riskLevel' ? Number(value) : value)} disabled={value === ''}>{tr('Appliquer')}</Button>
      <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onSync}>{tr('Nb sites ← référentiel')}</Button>
      {onRevert && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRevert}>{tr('Revenir au plan général')}</Button>}
      <span className="mmr-spacer" />
      <Button size="sm" variant="ghost" icon={X} aria-label={tr('Désélectionner')} onClick={onClear} />
    </div>
  );
}
