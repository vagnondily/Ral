import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, Upload, Gauge, Info, RotateCcw, Trash2, Save, Undo2, RefreshCw, Search, CheckSquare, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton, Stats } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatInt } from '../../lib/format.js';
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
const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d }));

export default function MmrSection({ isAdmin }) {
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
    if (!window.confirm(`Supprimer « ${p.activityCategory} » du plan général${n ? ` et ses ${n} dérogation(s)` : ''} ?`)) return;
    setWork((w) => w.flatMap((r) => {
      if (normCat(r.activityCategory) !== p.key || r.deleted) return [r];
      return r.id ? [{ ...r, deleted: true }] : [];
    }));
  }

  function addCategory() {
    const label = newCat.trim();
    if (!label) return;
    if (plan.some((p) => p.key === normCat(label))) { toast.error('Cette catégorie existe déjà.'); return; }
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
    toast.success(n ? `${n} ligne(s) alignée(s) sur le référentiel de sites.` : 'Déjà aligné sur le référentiel.');
  }

  function applyBulk(field, value) {
    const targets = plan.filter((p) => selected.has(p.key));
    targets.forEach((p) => edit(p, field, value)); // la barre d'enregistrement affiche le compte
  }

  function discard() { if (window.confirm('Abandonner toutes les modifications non enregistrées ?')) { setWork([...orig.values()].map((r) => ({ ...r }))); setReport(null); } }

  async function save() {
    if (errorsByKey.size) { toast.error('Corrigez les cellules en rouge avant d\'enregistrer.'); return; }
    setSaving(true);
    try {
      const r = await api.saveMmrBulk(changes);
      toast.success(`Paramètres MMR enregistrés (${r.created} créé(s), ${r.updated} modifié(s), ${r.deleted} supprimé(s)).`);
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
      toast.success(`${res.rows.length} ligne(s) chargée(s) dans la grille — vérifiez puis enregistrez.`);
    } catch (err) { toast.error(err.message); }
  }

  const toggle = (k) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.key));
  const officeName = scope ? offices.find((o) => o.id === scope)?.name : null;
  const syncable = plan.filter((p) => regCounts.has(p.key) && Number(p.row.numberOfSites) !== regCounts.get(p.key));

  // ---- rendu --------------------------------------------------------------
  return (
    <Card aria-labelledby="mmr-title" className="mmr-card">
      <CardHeader id="mmr-title" title="Paramètres MMR — exigences minimales de suivi"
        subtitle="Grille éditable : un plan général par catégorie d'activité, et des dérogations par bureau qui héritent du plan général. Intervalle, fréquence, cible, capacité et valeurs ajustées sont recalculés à la frappe.">
        <div className="header-actions">
        <Button variant="secondary" icon={Download} onClick={() => api.exportMmrXlsx().catch((e) => toast.error(e.message))}
          title="Classeur Excel aux formules vivantes ; modifiable hors ligne puis réimportable.">Exporter</Button>
        {isAdmin && <>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={onImport} />
          <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}
            title="Accepte l'export MEMS ou le classeur du plan de suivi (feuille « Overreaching Parameters »). Rien n'est enregistré avant « Enregistrer ».">Importer</Button>
        </>}
        </div>
      </CardHeader>

      <div className="mmr-toolbar">
        <div className="segmented" role="group" aria-label="Portée">
          <button type="button" aria-pressed={!scope} onClick={() => { setScope(''); setSelected(new Set()); }}>Plan général</button>
          <button type="button" aria-pressed={Boolean(scope)} onClick={() => { if (!scope && offices[0]) setScope(offices[0].id); setSelected(new Set()); }}>Dérogation bureau</button>
        </div>
        {scope && (
          <select className="select" value={scope} onChange={(e) => { setScope(e.target.value); setSelected(new Set()); }} aria-label="Bureau">
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <label className="mmr-search">
          <Search size={15} aria-hidden="true" />
          <input className="input" placeholder="Filtrer les catégories…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="mmr-spacer" />
        {isAdmin && syncable.length > 0 && (
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => syncSites(syncable)}
            title="Reprend le nombre de sites du référentiel (sites par activité, antennes comptées avec leur bureau).">Nb sites ← référentiel ({syncable.length})</Button>
        )}
      </div>

      {orig === null ? <div className="card-body"><Skeleton height={160} /></div> : (
        <>
          <Stats compact items={[
            { label: 'Catégories', value: formatInt(totals.categories), foot: scope ? `${totals.overrides} dérogation(s) · ${officeName}` : `${live.filter((r) => r.fieldOfficeId).length} dérogation(s) bureau` },
            { label: 'Sites', value: formatInt(totals.sites), foot: `référentiel : ${formatInt([...regCounts.values()].reduce((a, b) => a + b, 0))}` },
            { label: 'Ciblé / mois', value: fmt(totals.targetedPerMonth, 0), foot: 'sites à visiter par mois' },
            { label: 'Capacité / mois', value: fmt(totals.feasible, 0), foot: 'faisable (calculé ou saisi)' },
            { label: 'Couverture', value: totals.coverageRatio == null ? '—' : `${Math.round(totals.coverageRatio * 100)} %`, foot: 'capacité ÷ cible (lignes avec capacité)' },
          ]} />

          {report && (
            <Alert tone={report.errors.length ? 'warn' : 'info'} icon={Info}>
              <strong>{report.file}</strong> (feuille « {report.sheet} ») : {report.loaded} ligne(s) chargée(s) dans la grille, non encore enregistrée(s).
              {report.filled > 0 && <> {report.filled} nombre(s) de sites non calculé(s) dans le fichier repris du référentiel.</>}
              {report.skipped.length > 0 && <div className="mmr-report">Ignorées : {report.skipped.map((s) => `L${s.row} ${s.message}`).join(' · ')}</div>}
              {report.errors.length > 0 && <div className="mmr-report is-error">Erreurs : {report.errors.map((s) => `${s.row ? `L${s.row} ` : ''}${s.message}`).join(' · ')}</div>}
              <button type="button" className="link-btn" onClick={() => setReport(null)}>Masquer</button>
            </Alert>
          )}

          {isAdmin && selected.size > 0 && <BulkBar count={selected.size} onApply={applyBulk} onClear={() => setSelected(new Set())}
            onSync={() => syncSites(plan.filter((p) => selected.has(p.key)))}
            onRevert={scope ? () => plan.filter((p) => selected.has(p.key)).forEach(revertToGeneral) : null} />}

          {plan.length === 0 && !isAdmin ? (
            <EmptyState icon={Gauge} title="Aucun paramètre MMR">Le plan général de suivi n'a pas encore été défini.</EmptyState>
          ) : (
            <div className="table-wrap mmr-wrap">
              <table className="table mmr-grid">
                <thead>
                  <tr>
                    {isAdmin && <th scope="col" className="mmr-check"><input type="checkbox" aria-label="Tout sélectionner" checked={allShownSelected}
                      onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((p) => p.key)))} /></th>}
                    <th scope="col" className="mmr-cat">Catégorie d'activité</th>
                    <th scope="col" className="num" title={NUM_COLS[0].title}>{NUM_COLS[0].label}</th>
                    <th scope="col" className="num" title={NUM_COLS[1].title}>{NUM_COLS[1].label}</th>
                    <th scope="col" title="1 = faible · 2 = moyen · 3 = élevé">Risque</th>
                    {NUM_COLS.slice(2).map((c) => <th key={c.key} scope="col" className="num" title={c.title}>{c.label}</th>)}
                    <th scope="col" className="num mmr-derived" title="Intervalle minimal entre deux visites = durée ÷ risque">Interv.</th>
                    <th scope="col" className="num mmr-derived" title="Fréquence minimale = durée ÷ intervalle">Fréq.</th>
                    <th scope="col" className="num mmr-derived" title="Sites à visiter par mois = nb sites ÷ intervalle">Ciblé/mois</th>
                    <th scope="col" className="num mmr-derived" title="Capacité = personnes × suivis/jour × jours ouvrés (sinon faisable saisi)">Capacité</th>
                    <th scope="col" className="mmr-derived" title="Capacité ÷ ciblé">Couverture</th>
                    <th scope="col" className="num mmr-derived" title="Intervalle ajusté à la capacité (CO adjusted) = max(durée ÷ (fréquence × couverture), 1)">Interv. ajusté</th>
                    {isAdmin && <th scope="col" aria-label="Actions" />}
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
                        {isAdmin && <td className="mmr-check"><input type="checkbox" aria-label={`Sélectionner ${p.activityCategory}`} checked={selected.has(p.key)} onChange={() => toggle(p.key)} /></td>}
                        <td className="mmr-cat">
                          {isAdmin && !scope ? (
                            <input className={`cell-input cell-text ${errs.activityCategory ? 'is-invalid' : ''}`} value={row.activityCategory}
                              title={errs.activityCategory || 'Renommer (les dérogations suivent)'} aria-label="Catégorie d'activité" onChange={(e) => rename(p, e.target.value)} />
                          ) : <span className="mmr-cat-label">{p.activityCategory}</span>}
                          <span className="mmr-tags">
                            {scope && (p.inherited ? <Badge tone="blue">hérité du plan général</Badge> : <Badge tone="orange">dérogation</Badge>)}
                            {!scope && overridesByCat.get(p.key) > 0 && <Badge>{overridesByCat.get(p.key)} dérogation(s)</Badge>}
                            {scope && !p.general && <Badge tone="red">absente du plan général</Badge>}
                          </span>
                        </td>
                        <td className="num">{cell('operationDuration', { min: 0, max: 12, w: 54 })}</td>
                        <td className="num">
                          {cell('numberOfSites', { min: 0, w: 70 })}
                          {reg != null && Number(row.numberOfSites) !== reg && (
                            isAdmin
                              ? <button type="button" className="mmr-reg" onClick={() => edit(p, 'numberOfSites', reg)} title="Reprendre le nombre de sites du référentiel">référentiel : {formatInt(reg)}</button>
                              : <span className="mmr-reg">référentiel : {formatInt(reg)}</span>
                          )}
                        </td>
                        <td>
                          {isAdmin ? (
                            <select className={`cell-input cell-select risk-${row.riskLevel} ${errs.riskLevel ? 'is-invalid' : ''} ${p.inherited ? 'is-inherited' : ''}`} value={row.riskLevel} aria-label="Niveau de risque"
                              onChange={(e) => edit(p, 'riskLevel', Number(e.target.value))}>
                              {[1, 2, 3].map((n) => <option key={n} value={n}>{n} — {RISK[n]}</option>)}
                            </select>
                          ) : <Badge tone={RISK_TONE[row.riskLevel]}>{RISK[row.riskLevel] || row.riskLevel}</Badge>}
                        </td>
                        {NUM_COLS.slice(2).map((c) => <td key={c.key} className="num">{cell(c.key, { min: c.min, max: c.max, step: c.step, w: c.w - 8 })}</td>)}
                        <td className="num mmr-derived">{fmt(p.derived.interval)}</td>
                        <td className="num mmr-derived">{fmt(p.derived.frequency)}</td>
                        <td className="num mmr-derived"><strong>{fmt(p.derived.targetedPerMonth, 1)}</strong></td>
                        <td className="num mmr-derived">{fmt(p.derived.feasibleEffective, 1)}{p.derived.feasibleSource && <div className="site-meta">{p.derived.feasibleSource}</div>}</td>
                        <td className="mmr-derived">{p.derived.coverageRatio == null ? <span className="cell-empty">—</span>
                          : <Badge tone={p.derived.coverageRatio >= 1 ? 'green' : (p.derived.coverageRatio >= 0.5 ? 'orange' : 'red')}>{Math.round(p.derived.coverageRatio * 100)} %</Badge>}</td>
                        <td className="num mmr-derived" title={p.derived.adjustedFrequency != null ? `Fréquence ajustée : ${fmt(p.derived.adjustedFrequency)}` : undefined}>{fmt(p.derived.adjustedInterval)}</td>
                        {isAdmin && (
                          <td className="mmr-actions">
                            {scope && p.override && <Button size="sm" variant="ghost" icon={RotateCcw} aria-label="Revenir au plan général" title="Supprimer la dérogation et revenir au plan général" onClick={() => revertToGeneral(p)} />}
                            {!scope && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer la catégorie" title="Supprimer la catégorie (et ses dérogations)" onClick={() => removeCategory(p)} />}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={isAdmin ? 17 : 15}><EmptyState icon={Gauge} title={query ? 'Aucune catégorie ne correspond' : 'Aucune catégorie'}>
                      {query ? 'Modifiez le filtre.' : 'Ajoutez une catégorie ci-dessous ou importez le classeur du plan de suivi.'}</EmptyState></td></tr>
                  )}
                </tbody>
                {plan.length > 0 && (
                  <tfoot>
                    <tr>
                      {isAdmin && <td />}
                      <td><strong>Total</strong></td><td />
                      <td className="num"><strong>{formatInt(totals.sites)}</strong></td>
                      <td colSpan={5} /><td colSpan={2} />
                      <td className="num"><strong>{fmt(totals.targetedPerMonth, 1)}</strong></td>
                      <td className="num"><strong>{fmt(totals.feasible, 1)}</strong></td>
                      <td>{totals.coverageRatio != null && <Badge tone={totals.coverageRatio >= 1 ? 'green' : 'red'}>{Math.round(totals.coverageRatio * 100)} %</Badge>}</td>
                      <td />{isAdmin && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {isAdmin && !scope && (
            <form className="mmr-add" onSubmit={(e) => { e.preventDefault(); addCategory(); }}>
              <input className="input" list="mmr-suggest" placeholder="Nouvelle catégorie d'activité…" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="Nouvelle catégorie" />
              <datalist id="mmr-suggest">
                {[...registryCounts(registry, null).keys()].filter((k) => !plan.some((p) => p.key === k))
                  .map((k) => registry.find((r) => normCat(r.activity) === k)?.activity || k).map((label) => <option key={label} value={label} />)}
              </datalist>
              <Button type="submit" variant="secondary" icon={Plus} disabled={!newCat.trim()}>Ajouter</Button>
              <span className="hint">Suggestions : activités du référentiel de sites sans paramètre. Le nombre de sites est prérempli.</span>
            </form>
          )}

          <div className="note"><Info size={18} aria-hidden="true" /><span>
            Intervalle = durée ÷ risque · Fréquence = durée ÷ intervalle · Ciblé/mois = nb sites ÷ intervalle · Capacité = personnes × suivis/jour × jours ouvrés (sinon faisable saisi) · Couverture = capacité ÷ ciblé · Intervalle ajusté = max(durée ÷ (fréquence × couverture), 1).
            {scope && ' Sur un bureau, modifier une cellule héritée crée une dérogation ; ↺ la supprime.'}
          </span></div>
        </>
      )}

      {isAdmin && dirty && (
        <div className="mmr-savebar" role="region" aria-label="Modifications non enregistrées">
          <span><strong>{dirtyCount}</strong> modification(s) non enregistrée(s){errorsByKey.size > 0 && <span className="mmr-err"> · {errorsByKey.size} ligne(s) à corriger</span>}</span>
          <Button variant="secondary" icon={Undo2} onClick={discard} disabled={saving}>Annuler</Button>
          <Button icon={Save} onClick={save} loading={saving} disabled={errorsByKey.size > 0}>Enregistrer</Button>
        </div>
      )}
    </Card>
  );
}

/** Cellule numérique éditable en place (aspect tableur). */
function NumCell({ value, onChange, error, inherited, changed, readOnly, disabled, min, max, step = 1, w = 64 }) {
  if (readOnly) return <span className="tabular">{value === '' || value == null ? '—' : fmt(value)}</span>;
  return (
    <input className={['cell-input', 'tabular', error && 'is-invalid', inherited && 'is-inherited', changed && 'is-changed'].filter(Boolean).join(' ')}
      style={{ width: w }} type="number" inputMode="decimal" min={min} max={max} step={step}
      value={value ?? ''} disabled={disabled} title={error || (disabled ? 'Capacité calculée à partir des ressources' : undefined)}
      aria-invalid={error ? true : undefined}
      onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)} />
  );
}

function BulkBar({ count, onApply, onClear, onSync, onRevert }) {
  const [field, setField] = useState('workingDays');
  const [value, setValue] = useState('');
  return (
    <div className="mmr-bulk" role="region" aria-label="Modification groupée">
      <CheckSquare size={16} aria-hidden="true" />
      <strong>{count} sélectionnée(s)</strong>
      <span className="mmr-bulk-sep" />
      <select className="select" value={field} onChange={(e) => setField(e.target.value)} aria-label="Champ">
        {BULK_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {field === 'riskLevel'
        ? <select className="select" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Valeur"><option value="">—</option>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} — {RISK[n]}</option>)}</select>
        : <input className="input tabular" style={{ width: 96 }} type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Valeur" placeholder="valeur" />}
      <Button size="sm" onClick={() => value !== '' && onApply(field, field === 'riskLevel' ? Number(value) : value)} disabled={value === ''}>Appliquer</Button>
      <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onSync}>Nb sites ← référentiel</Button>
      {onRevert && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRevert}>Revenir au plan général</Button>}
      <span className="mmr-spacer" />
      <Button size="sm" variant="ghost" icon={X} aria-label="Désélectionner" onClick={onClear} />
    </div>
  );
}
