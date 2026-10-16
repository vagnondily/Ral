import React, { useMemo, useState } from 'react';
import { Eye, Wand2, Trash2, SlidersHorizontal, ChevronDown, ChevronRight, CalendarRange, Download } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, formatLocale } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';

// Mois AAAA-MM décalé de n mois à partir d'aujourd'hui.
function monthFromNow(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
const yearOf = (ym) => ym.slice(0, 4);
const mOf = (ym) => Number(ym.slice(5, 7));
const ym = (y, m) => `${y}-${String(Math.min(12, Math.max(1, m))).padStart(2, '0')}`;
// 'YYYY-MM' → nom de mois court (ex. « mars »).
const shortMonth = (m) => {
  try { return new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)).toLocaleString(formatLocale(), { month: 'short', timeZone: 'UTC' }); }
  catch { return m; }
};
// Niveau de risque : numérique MMR (1/2/3) ou libellé site → clé i18n.
const RISK_LABEL = { 1: 'Faible', 2: 'Moyen', 3: 'Élevé', faible: 'Faible', moyenne: 'Moyen', elevee: 'Élevé' };
// Nombre à une décimale au plus, locale FR (ex. intervalle « 4,5 »).
const num1 = (n) => (n == null ? '—' : Number(n).toLocaleString(formatLocale(), { maximumFractionDigits: 1 }));

// Raisons d'un site non couvert / d'une visite non placée (moteur : planAuto REASONS).
const REASON_LABEL = {
  capacity: 'capacité du mois atteinte',
  inactive: 'mois inactifs (grille Sites actifs / inactifs)',
  cancelled: 'mois d\'une visite annulée',
  gap: 'intervalle avec une visite existante',
  period: 'période trop courte ou mois exclus',
};
// Raisons d'une affectation non écrite à l'application (relues en base).
const SKIP_LABEL = { existing: 'déjà une visite ce mois', inactive: 'mois inactif', forbidden: 'zone interdite' };
// Sections de l'empreinte des entrées (planFingerprint) : ce qui a changé depuis l'aperçu.
const SECTION_LABEL = {
  registre: 'registre des sites', visites: 'visites', activation: 'sites actifs / inactifs',
  mmr: 'paramètres MMR', tpm: 'TPM des zones', parametres: 'période ou réglages',
};

/**
 * Assistant de génération automatique du plan de suivi sur une PÉRIODE (retour 82).
 * Simple par défaut : choisir la période → Aperçu → Appliquer. Les réglages fins
 * (capacité, débordement, fréquence de repli…) sont dans « Options avancées ».
 * Les visites EXIGÉES viennent du MMR (fréquence + intervalle) et la priorité du RBM.
 * La période part de l'exercice affiché par le Plan de suivi (`year`), jamais d'un mois échu ;
 * « Appliquer » renvoie l'empreinte de l'aperçu : si les données ont changé, le serveur refuse
 * (409) et l'écran demande de relancer l'aperçu.
 */
export default function PlanAutoDrawer({ year, onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const nowMonth = monthFromNow(0);
  const boardYear = String(year || yearOf(nowMonth));
  const pastYear = boardYear < yearOf(nowMonth);
  // Exercice courant : du mois courant à décembre ; exercice à venir : toute l'année.
  const start = boardYear === yearOf(nowMonth) ? nowMonth : `${boardYear}-01`;
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(`${boardYear}-12`); // par défaut : jusqu'à décembre (même exercice)
  const [stale, setStale] = useState(null); // sections changées depuis l'aperçu (409)
  const [freq, setFreq] = useState({ elevee: 1, moyenne: 2, faible: 3 }); // repli = fréquence RBM (retour 82)
  const [capacity, setCapacity] = useState('');
  const [useMmrCapacity, setUseMmrCapacity] = useState(true);
  const [adjusted, setAdjusted] = useState(false);
  const [risk, setRisk] = useState('');
  const [exclude, setExclude] = useState('');
  const [overflow, setOverflow] = useState(10);
  const [groupByCommune, setGroupByCommune] = useState(true);
  const [useGps, setUseGps] = useState(true);
  const [balanceByTpm, setBalanceByTpm] = useState(true);
  const [coverAllOnce, setCoverAllOnce] = useState(false);
  const [tpmCapacity, setTpmCapacity] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const sameYear = yearOf(from) === yearOf(to);
  const allPast = Boolean(to) && to < nowMonth;
  const invalid = !from || !to || from > to || !sameYear || allPast;
  const reset = () => { setPreview(null); setStale(null); };
  const setPeriod = (f, t) => { setFrom(f); setTo(t); reset(); };

  // Préréglages de période (dans l'exercice du mois de départ).
  const y = yearOf(from);
  const presets = [
    { key: 'rest', label: tr('Reste de l\'année'), f: from, t: `${y}-12` },
    { key: 'quarter', label: tr('Trimestre'), f: from, t: ym(y, mOf(from) + 2) },
    { key: 'semester', label: tr('Semestre'), f: from, t: ym(y, mOf(from) + 5) },
    { key: 'year', label: tr('Toute l\'année'), f: `${y}-01`, t: `${y}-12` },
  ];

  const payload = useMemo(() => ({
    from, to, adjusted,
    ...(risk ? { risk } : {}),
    settings: {
      frequency: { elevee: Number(freq.elevee) || 1, moyenne: Number(freq.moyenne) || 2, faible: Number(freq.faible) || 3 },
      ...(Number(capacity) > 0 ? { capacityPerMonth: Number(capacity) } : {}),
      ...(Number(tpmCapacity) > 0 ? { tpmCapacityPerMonth: Number(tpmCapacity) } : {}),
      useMmrCapacity,
      overflowPct: Number(overflow) || 0,
      groupByCommune,
      useGps,
      balanceByTpm,
      coverAllOnce,
      excludeMonths: exclude.split(',').map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}$/.test(s)),
    },
  }), [from, to, risk, freq, capacity, tpmCapacity, useMmrCapacity, overflow, groupByCommune, useGps, balanceByTpm, coverAllOnce, adjusted, exclude]);

  async function runPreview() {
    if (invalid) return;
    setBusy(true);
    try { setPreview(await api.planAutoPreview(payload)); setStale(null); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function apply() {
    if (invalid || !preview || stale) return;
    setBusy(true);
    try {
      const r = await api.planAutoApply({ ...payload, fingerprint: preview.fingerprint, sections: preview.sections });
      // Toujours « N créées sur M prévues » ; l'écart a sa raison (relue en base).
      const why = Object.entries(r.skipped || {}).filter(([, n]) => n > 0)
        .map(([k, n]) => `${formatInt(n)} ${tr(SKIP_LABEL[k] || k)}`).join(' · ');
      const msg = tr('{n} visite(s) créée(s) sur {m} prévue(s).', { n: formatInt(r.created), m: formatInt(r.planned) });
      if (r.created < r.planned) toast.info(`${msg} ${tr('Non créées : {why}.', { why: why || tr('déjà planifiées entre-temps') })}`);
      else toast.success(msg);
      onDone();
    } catch (e) {
      if (e.status === 409 && e.details && e.details.code === 'plan_inputs_changed') setStale(e.details.sections || []);
      else toast.error(e.message);
    } finally { setBusy(false); }
  }
  // Export CSV « base de budget » : par TPM/bureau et par mois — visites (= jours de collecte)
  // et agents. On y ajoute ses coûts journaliers dans Excel pour obtenir le budget.
  function exportBudget() {
    if (!preview) return;
    const bureau = tr('Bureau (suivi interne)');
    const rows = [[tr('Unité (TPM / bureau)'), tr('Mois'), tr('Visites (jours de collecte)'), tr('Agents')]];
    for (const t of preview.byTpm || []) {
      const label = t.assigned ? t.tpm : bureau;
      (t.perMonth || []).forEach((m, i) => {
        const agents = t.agentMonths && t.agentMonths[i] ? t.agentMonths[i].agents : '';
        rows.push([label, m.month, m.count, agents]);
      });
      rows.push([label, tr('Total / pic'), t.planned, t.agentsPeak != null ? `${t.agentsKnown ? '' : '≥ '}${t.agentsPeak}` : '']);
    }
    downloadCsv(`plan-suivi-budget-${from}_${to}.csv`, rows);
    toast.success(tr('Export CSV téléchargé.'));
  }
  async function clearPlanned() {
    if (invalid) return;
    if (!window.confirm(tr('Effacer les visites prévues libres de la période ? Sont toujours conservées : les visites réalisées ou annulées, celles des mois échus, celles déjà facturées, figées, datées, affectées à un agent ou dont le TPM a été choisi avec une raison.'))) return;
    setBusy(true);
    try {
      const r = await api.planAutoClear({ from, to, ...(risk ? { risk } : {}) });
      toast.success(r.kept ? tr('{n} planification(s) effacée(s) · {k} conservée(s) (mois échus, facturées, figées, datées, affectées ou motivées).', { n: r.deleted, k: r.kept })
        : tr('{n} planification(s) effacée(s).', { n: r.deleted }));
      reset();
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  const maxCount = preview ? Math.max(1, ...preview.perMonth.map((m) => m.count)) : 1;
  const cov = preview ? (preview.summary.coverageRate ?? 0) : 0;
  const covColor = cov >= 80 ? 'var(--green-500, #2e9e5b)' : cov >= 50 ? 'var(--amber-500, #d99100)' : 'var(--red-500, #d64545)';
  const presetActive = (p) => from === p.f && to === p.t;

  // Échantillon de sites réels (avec leurs mois prévus) pour un aperçu concret.
  const sample = useMemo(() => {
    if (!preview) return [];
    const bySite = new Map();
    for (const a of preview.sample || []) {
      if (!bySite.has(a.siteId)) bySite.set(a.siteId, { name: a.name || '—', commune: a.commune, district: a.district, activity: a.activity || null, tpm: a.tpm || null, months: [] });
      bySite.get(a.siteId).months.push(a.month);
    }
    return [...bySite.values()].slice(0, 8).map((s) => ({ ...s, months: [...new Set(s.months)].sort() }));
  }, [preview]);

  return (
    <Modal open onClose={() => !busy && onClose()} title={tr('Générer le plan de suivi')} size="editor"
      footer={<>
        <Button variant="ghost" icon={Trash2} onClick={clearPlanned} disabled={busy || invalid}
          title={tr('Supprimer les visites planifiées de la période pour repartir d\'un plan propre.')}>{tr('Effacer les planifications')}</Button>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button>
        {!preview
          ? <Button icon={Eye} loading={busy} disabled={invalid} onClick={runPreview}>{tr('Aperçu')}</Button>
          : <>
            <Button variant="secondary" icon={Download} onClick={exportBudget} disabled={busy}
              title={tr('Exporter le plan (visites = jours de collecte, agents) par TPM/bureau et par mois — base du budget.')}>{tr('Budget (CSV)')}</Button>
            <Button variant="secondary" icon={Eye} loading={busy} disabled={invalid} onClick={runPreview}>{tr('Recalculer')}</Button>
            <Button icon={Wand2} loading={busy} disabled={invalid || Boolean(stale)} onClick={apply}
              title={stale ? tr('Les données ont changé : relancez l\'aperçu.') : undefined}>{tr('Appliquer')}</Button>
          </>}
      </>}>
      <div style={{ display: 'grid', gap: 18 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {tr('Le plan reprend les visites exigées par le MMR (fréquence et intervalle) et la priorité du RBM. Choisissez la période, prévisualisez, puis appliquez — rien n\'est écrit avant « Appliquer ».')}
        </p>

        {/* Étape 1 — Période */}
        <section style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarRange size={16} className="muted" />
            <strong style={{ fontSize: 13 }}>{tr('Période')}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {presets.map((p) => (
              <button key={p.key} type="button" className={`chip ${presetActive(p) ? 'is-on' : ''}`}
                onClick={() => setPeriod(p.f, p.t)}
                style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 12px', fontSize: 13,
                  background: presetActive(p) ? 'var(--blue-50, #eff6fc)' : 'var(--surface)', color: presetActive(p) ? 'var(--blue-700, #1f4fd6)' : 'var(--text)', fontWeight: presetActive(p) ? 600 : 400 }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label={tr('Du mois')} htmlFor="pa-from"><input id="pa-from" type="month" className="input" min={nowMonth} value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} /></Field>
            <Field label={tr('Au mois')} htmlFor="pa-to" error={from > to ? tr('Période invalide.') : (!sameYear ? tr('La période doit tenir dans un seul exercice (même année).') : (allPast ? tr('Période entièrement échue : choisissez des mois à partir de {m}.', { m: nowMonth }) : undefined))}>
              <input id="pa-to" type="month" className="input" min={nowMonth} value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
            </Field>
          </div>
          {pastYear && <Alert tone="info">{tr('Exercice {y} échu : aucune visite ne se planifie dans un mois passé.', { y: boardYear })}</Alert>}
          {!pastYear && from < nowMonth && to >= nowMonth && (
            <span className="muted" style={{ fontSize: 12 }}>{tr('Les mois échus de la période ne sont jamais planifiés : le plan commence en {m}.', { m: nowMonth })}</span>
          )}
        </section>

        {/* Options avancées (repliées par défaut) */}
        <section>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>
            {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <SlidersHorizontal size={15} className="muted" /> {tr('Options avancées')}
          </button>
          {showAdvanced && (
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label={tr('Niveau de risque')} htmlFor="pa-risk" hint={tr('Limiter la génération à un niveau de risque.')}>
                  <select id="pa-risk" className="select" value={risk} onChange={(e) => { setRisk(e.target.value); reset(); }}>
                    <option value="">{tr('Tous')}</option>
                    <option value="elevee">{tr('Risque élevé')}</option>
                    <option value="moyenne">{tr('Risque moyen')}</option>
                    <option value="faible">{tr('Risque faible')}</option>
                  </select>
                </Field>
                <Field label={tr('Mois à exclure')} htmlFor="pa-excl" hint={tr('Mois AAAA-MM séparés par des virgules (ex. saison des pluies).')}>
                  <input id="pa-excl" className="input" value={exclude} onChange={(e) => { setExclude(e.target.value); reset(); }} placeholder="2026-01, 2026-02" />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <label className="check"><input type="checkbox" checked={groupByCommune} onChange={(e) => { setGroupByCommune(e.target.checked); reset(); }} /> {tr('Regrouper les sites par commune (tournées)')}</label>
                <label className="check"><input type="checkbox" checked={useGps} onChange={(e) => { setUseGps(e.target.checked); reset(); }} /> {tr('Regrouper au plus proche (GPS si disponible)')}</label>
                <label className="check"><input type="checkbox" checked={balanceByTpm} onChange={(e) => { setBalanceByTpm(e.target.checked); reset(); }} /> {tr('Équilibrer la charge entre les TPM')}</label>
                <label className="check" title={tr('Force au moins une visite par site même si la capacité mensuelle est dépassée. À réserver aux cas où la couverture prime sur la capacité réelle.')}><input type="checkbox" checked={coverAllOnce} onChange={(e) => { setCoverAllOnce(e.target.checked); reset(); }} /> {tr('Couvrir tous les sites au moins une fois (ignorer la capacité)')}</label>
                <label className="check"><input type="checkbox" checked={useMmrCapacity} onChange={(e) => { setUseMmrCapacity(e.target.checked); reset(); }} /> {tr('Respecter la capacité mensuelle du MMR')}</label>
                <label className="check"><input type="checkbox" checked={adjusted} onChange={(e) => { setAdjusted(e.target.checked); reset(); }} /> {tr('Fréquence MMR ajustée (CO adjusted)')}</label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <Field label={tr('Capacité par mois')} htmlFor="pa-cap" hint={tr('Plafond global de visites par mois ; le surplus glisse au mois suivant.')}>
                  <input id="pa-cap" type="number" min="1" className="input" value={capacity} onChange={(e) => { setCapacity(e.target.value); reset(); }} placeholder={tr('Illimité')} />
                </Field>
                <Field label={tr('Capacité par TPM et par mois')} htmlFor="pa-tcap" hint={tr('Plafond de visites par TPM et par mois ; le surplus glisse au mois suivant.')}>
                  <input id="pa-tcap" type="number" min="1" className="input" value={tpmCapacity} onChange={(e) => { setTpmCapacity(e.target.value); reset(); }} placeholder={tr('Illimité')} />
                </Field>
                <Field label={tr('Débordement autorisé (%)')} htmlFor="pa-ov" hint={tr('Dépassement toléré de la capacité avant de reporter au mois suivant.')}>
                  <input id="pa-ov" type="number" min="0" max="100" className="input" value={overflow} onChange={(e) => { setOverflow(e.target.value); reset(); }} />
                </Field>
              </div>
              <Field label={tr('Fréquence des sites sans paramètre MMR (mois entre deux visites)')} htmlFor="pa-fe">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <label className="muted" style={{ fontSize: 12 }}>{tr('Risque élevé')}<input id="pa-fe" type="number" min="1" max="12" className="input" value={freq.elevee} onChange={(e) => { setFreq({ ...freq, elevee: e.target.value }); reset(); }} /></label>
                  <label className="muted" style={{ fontSize: 12 }}>{tr('Risque moyen')}<input type="number" min="1" max="12" className="input" value={freq.moyenne} onChange={(e) => { setFreq({ ...freq, moyenne: e.target.value }); reset(); }} /></label>
                  <label className="muted" style={{ fontSize: 12 }}>{tr('Risque faible')}<input type="number" min="1" max="12" className="input" value={freq.faible} onChange={(e) => { setFreq({ ...freq, faible: e.target.value }); reset(); }} /></label>
                </div>
              </Field>
            </div>
          )}
        </section>

        {/* Étape 2 — Résultat */}
        {preview ? (
          <section style={{ display: 'grid', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <strong style={{ fontSize: 13 }}>{tr('Aperçu du plan')}</strong>
            {stale && (
              <Alert tone="warning">
                {tr('Les données ont changé : relancez l\'aperçu.')}
                {stale.length > 0 && <> {tr('Changé depuis l\'aperçu : {list}.', { list: stale.map((s) => tr(SECTION_LABEL[s] || s)).join(', ') })}</>}
                {' '}<Button size="sm" variant="secondary" icon={Eye} loading={busy} onClick={runPreview}>{tr('Relancer l\'aperçu')}</Button>
              </Alert>
            )}
            {preview.period && preview.period.pastMonths && preview.period.pastMonths.length > 0 && (
              <Alert tone="info">{tr('{n} mois échu(s) non planifié(s) : le plan commence en {m}.', { n: formatInt(preview.period.pastMonths.length), m: preview.period.from })}</Alert>
            )}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span className="muted">{tr('Couverture des sites')}</span>
                <span><strong>{formatInt(preview.summary.sitesCovered)}</strong> / {formatInt(preview.summary.sitesActivePlannable)}{preview.summary.coverageRate != null ? ` · ${preview.summary.coverageRate} %` : ''}</span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, cov)}%`, background: covColor, transition: 'width .3s' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <span>{tr('Visites planifiées')} : <strong>{formatInt(preview.summary.planned)}</strong></span>
              <span className="muted">{tr('Pilotées par le MMR')} : {formatInt(preview.summary.mmrDriven)}</span>
              <span className="muted">{tr('Repli RBM (sans MMR)')} : {formatInt(preview.summary.rbmFallback)}</span>
              {preview.summary.latePlanned > 0 && <span className="muted">{tr('Prévues antérieures re-planifiées')} : {formatInt(preview.summary.latePlanned)}</span>}
              {preview.summary.forbidden > 0 && <span className="muted">{tr('Zones interdites exclues')} : {formatInt(preview.summary.forbidden)}</span>}
              {preview.summary.unplaced > 0 && <span className="muted">{tr('Visites non placées')} : {formatInt(preview.summary.unplaced)}</span>}
              {preview.summary.existingInPeriod > 0 && <span className="muted">{tr('Déjà prévues ou réalisées sur la période')} : {formatInt(preview.summary.existingInPeriod)}</span>}
              {preview.summary.inactive > 0 && <span className="muted">{tr('Sites inactifs toute la période')} : {formatInt(preview.summary.inactive)}</span>}
              {preview.summary.agentsTotalPeak != null && <span>{tr('Effectif à mobiliser (pic)')} : <strong>{preview.summary.agentsTotalKnown ? '' : '≥ '}{formatInt(preview.summary.agentsTotalPeak)}</strong> {tr('agents')}</span>}
            </div>
            {preview.summary.noActivity > 0 && (
              <Alert tone="warning">
                {tr('{n} site(s) sans activité : non planifiés. Renseignez leur activité (et leur MMR) dans la Configuration pour les suivre.', { n: formatInt(preview.summary.noActivity) })}
              </Alert>
            )}
            {preview.summary.rbmFallback > 0 && (
              <Alert tone="info">
                {tr('{n} site(s) avec activité mais sans paramètre MMR : planifiés au repli RBM (fréquence du risque). Complétez leur MMR dans la Configuration pour un suivi exact.', { n: formatInt(preview.summary.rbmFallback) })}
              </Alert>
            )}
            {preview.summary.sitesUncovered > 0 && (
              <Alert tone="warning">
                {tr('{n} site(s) non couvert(s) sur la période, par raison :', { n: formatInt(preview.summary.sitesUncovered) })}
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {Object.entries(preview.summary.uncoveredByReason || {}).filter(([, n]) => n > 0).map(([k, n]) => (
                    <li key={k}>{formatInt(n)} — {tr(REASON_LABEL[k] || k)}</li>
                  ))}
                </ul>
                {(preview.summary.uncoveredByReason || {}).capacity > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{tr('Capacité : augmentez la capacité (faisable) des activités concernées dans la Configuration MMR, ou décochez « Respecter la capacité mensuelle du MMR » dans les options.')}</div>
                )}
              </Alert>
            )}
            {Array.isArray(preview.uncovered) && preview.uncovered.length > 0 && (
              <details>
                <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>{tr('Sites non couverts et leur raison ({n} sur {total})', { n: formatInt(preview.uncovered.length), total: formatInt(preview.uncoveredTotal) })}</summary>
                <table className="table" style={{ background: 'var(--surface)', marginTop: 6 }}>
                  <thead><tr><th scope="col">{tr('Site')}</th><th scope="col">{tr('District')}</th><th scope="col">{tr('Commune')}</th><th scope="col">{tr('Raison')}</th><th scope="col" className="num">{tr('Visites dues')}</th></tr></thead>
                  <tbody>
                    {preview.uncovered.map((u) => (
                      <tr key={u.siteId}>
                        <td><strong>{u.name || '—'}</strong></td><td className="muted">{u.district || '—'}</td><td className="muted">{u.commune || '—'}</td>
                        <td>{tr(REASON_LABEL[u.reason] || u.reason)}</td><td className="num">{formatInt(u.needed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
            {preview.summary.activitiesNeedingQuota > 0 && (
              <Alert tone="info">
                {tr('Effectif en agents non calculé pour {n} activité(s) : renseignez le quota journalier (visites/jour/agent) et les jours ouvrés par mois dans la Configuration MMR.', { n: formatInt(preview.summary.activitiesNeedingQuota) })}
              </Alert>
            )}
            {Array.isArray(preview.byActivity) && preview.byActivity.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>{tr('Par activité — paramètres de base du MMR et résultat')}</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ background: 'var(--surface)', minWidth: 760 }}>
                    <thead>
                      <tr>
                        <th scope="col">{tr('Activité')}</th>
                        <th scope="col">{tr('Risque')}</th>
                        <th scope="col" className="num" title={tr('Visites exigées par site sur l\'exercice')}>{tr('Fréq./an')}</th>
                        <th scope="col" className="num" title={tr('Mois entre deux visites (arrondi au supérieur pour le plan)')}>{tr('Intervalle')}</th>
                        <th scope="col" className="num" title={tr('Sites à visiter par mois')}>{tr('Cible/mois')}</th>
                        <th scope="col" className="num" title={tr('Visites réalisables par mois')}>{tr('Capacité/mois')}</th>
                        <th scope="col" className="num">{tr('Sites')}</th>
                        <th scope="col" className="num">{tr('Planifiées')}</th>
                        <th scope="col" className="num" title={tr('Agents à mobiliser au mois le plus chargé = ⌈visites ÷ (quota journalier × jours ouvrés)⌉')}>{tr('Agents (pic)')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.byActivity.map((a, i) => {
                        // Intervalle effectif : ajusté (si demandé) sinon de base ; le MMR peut
                        // ne pas être paramétré (durée 0) → intervalle/fréquence absents.
                        const mmrItv = a.mmr && (preview.settings.adjusted && a.mmr.adjustedInterval ? a.mmr.adjustedInterval : a.mmr.interval);
                        const hasItv = a.parametered && Number(mmrItv) > 0;
                        const freq = a.parametered && a.mmr && Number(a.mmr.frequency) > 0 ? a.mmr.frequency : null;
                        const showStep = hasItv && a.stepUsed !== Number(mmrItv); // « pas » utile seulement si l'arrondi change l'intervalle (ex. 4,5 → 5)
                        return (
                          <tr key={`${a.activity || 'rbm'}-${i}`}>
                            <td>
                              <strong>{a.activity || tr('Sans activité')}</strong>
                              <div className="muted" style={{ fontSize: 11 }}>{a.parametered ? (a.fieldOffice || tr('Tous (plan général)')) : tr('repli RBM')}</div>
                            </td>
                            <td className="muted">{tr(RISK_LABEL[(a.mmr && a.mmr.riskLevel) || a.riskLevel] || '—')}</td>
                            <td className="num">{freq != null ? num1(freq) : '—'}</td>
                            <td className="num">{hasItv ? num1(mmrItv) : '—'}{showStep ? <span className="muted"> ({tr('pas')} {a.stepUsed})</span> : null}</td>
                            <td className="num">{a.parametered && a.mmr ? num1(a.mmr.targetedPerMonth) : '—'}</td>
                            <td className="num">{a.parametered && a.mmr ? num1(a.mmr.feasible) : '—'}{a.mmr && a.mmr.feasibleOverridden ? '*' : ''}</td>
                            <td className="num">{formatInt(a.sites)}</td>
                            <td className="num"><strong>{formatInt(a.planned)}</strong></td>
                            <td className="num">{a.staffing && a.staffing.agentsPeak != null
                              ? <strong>{formatInt(a.staffing.agentsPeak)}</strong>
                              : <span className="muted" title={tr('Quota journalier / jours ouvrés non renseignés dans le MMR')}>—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>
                  {tr('Intervalle = mois entre deux visites ; « pas » = intervalle arrondi au supérieur appliqué au plan.')}
                  {preview.byActivity.some((a) => a.mmr && a.mmr.feasibleOverridden) ? ` ${tr('* capacité saisie dans l\'assistant.')}` : ''}
                </span>
              </div>
            )}
            {Array.isArray(preview.byTpm) && preview.byTpm.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>{tr('Par TPM — charge mensuelle (contrat de suivi de la zone)')}</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ background: 'var(--surface)', minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th scope="col">{tr('TPM')}</th>
                        <th scope="col" className="num">{tr('Sites')}</th>
                        <th scope="col" className="num">{tr('Planifiées')}</th>
                        <th scope="col" className="num" title={tr('Agents à mobiliser au mois le plus chargé pour cette unité (toutes activités)')}>{tr('Agents (pic)')}</th>
                        {preview.byTpm[0].perMonth.map((m) => <th key={m.month} scope="col" className="num">{shortMonth(m.month)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.byTpm.map((t, i) => (
                        <tr key={`${t.tpm || 'na'}-${i}`}>
                          <td>{t.assigned ? <strong>{t.tpm}</strong> : <span className="muted">{tr('Bureau (suivi interne — zone sans TPM)')}</span>}</td>
                          <td className="num">{formatInt(t.sites)}</td>
                          <td className="num"><strong>{formatInt(t.planned)}</strong></td>
                          <td className="num">{t.agentsPeak != null
                            ? <strong>{formatInt(t.agentsPeak)}{!t.agentsKnown ? '+' : ''}</strong>
                            : <span className="muted">—</span>}</td>
                          {t.perMonth.map((m) => <td key={m.month} className="num">{m.count ? formatInt(m.count) : <span className="muted">·</span>}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>{tr('Le TPM d\'un site = contrat de suivi actif de sa zone ; sans contrat, le suivi est fait par le bureau (en interne). La charge est répartie sur la période pour éviter les mois vides.')}</span>
              </div>
            )}
            {sample.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>{tr('Exemples de sites et leurs visites prévues')}</span>
                <table className="table" style={{ background: 'var(--surface)' }}>
                  <thead><tr><th scope="col">{tr('Site')}</th><th scope="col">{tr('Commune')}</th><th scope="col">{tr('Activité')}</th><th scope="col">{tr('TPM')}</th><th scope="col">{tr('Mois prévus')}</th></tr></thead>
                  <tbody>
                    {sample.map((s, i) => (
                      <tr key={`${s.name}-${i}`}>
                        <td><strong>{s.name}</strong></td>
                        <td className="muted">{s.commune || '—'}</td>
                        <td className="muted">{s.activity || '—'}</td>
                        <td className="muted">{s.tpm || tr('Bureau')}</td>
                        <td>{s.months.map((m) => shortMonth(m)).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <span className="muted" style={{ fontSize: 11 }}>{tr('Échantillon · le plan complet compte {v} visite(s) et couvre {n} site(s).', { v: formatInt(preview.sampleTotal ?? preview.summary.planned), n: formatInt(preview.summary.sitesCovered) })}</span>
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{tr('Répartition par mois')}</div>
            <table className="table" style={{ background: 'var(--surface)' }}>
              <thead><tr><th scope="col">{tr('Mois')}</th><th scope="col" className="num">{tr('Visites')}</th><th scope="col" style={{ width: '55%' }} /></tr></thead>
              <tbody>
                {preview.perMonth.map((m) => (
                  <tr key={m.month}>
                    <td className="mono">{m.month}</td>
                    <td className="num">{formatInt(m.count)}</td>
                    <td><span style={{ display: 'inline-block', height: 8, borderRadius: 4, background: 'var(--blue-500, #0f6cbd)', width: `${Math.round((m.count / maxCount) * 100)}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>{tr('« Appliquer » crée ces visites comme « planifiées », exactement celles de cet aperçu (si les données ont changé entre-temps, rien n\'est écrit). Idempotent : un site déjà prévu ce mois n\'est pas dupliqué, et l\'intervalle est respecté face aux visites existantes.')}</p>
          </section>
        ) : <Alert tone="info">{tr('Choisissez la période puis cliquez sur « Aperçu » pour voir la répartition avant d\'écrire.')}</Alert>}
      </div>
    </Modal>
  );
}
