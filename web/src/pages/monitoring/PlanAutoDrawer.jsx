import React, { useEffect, useMemo, useState } from 'react';
import {
  Eye, Wand2, Trash2, SlidersHorizontal, ChevronDown, ChevronRight, CalendarRange, Download, Filter, Target, X,
  CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Field, Stats } from '../../components/ui.jsx';
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
// Date AAAA-MM-JJ → « 3 mars ».
const shortDate = (d) => {
  try { return new Date(`${d}T00:00:00Z`).toLocaleString(formatLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  catch { return d; }
};
// Niveau de risque : numérique MMR (1/2/3) ou libellé site → clé i18n.
const RISK_LABEL = { 1: 'Faible', 2: 'Moyen', 3: 'Élevé', faible: 'Faible', moyenne: 'Moyen', elevee: 'Élevé' };
// Nombre à une décimale au plus, locale de l'écran (ex. intervalle « 4,5 »).
const num1 = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString(formatLocale(), { maximumFractionDigits: 1 }));
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

// Raisons d'un site non couvert / d'une visite non placée (moteur : planAuto REASONS).
const REASON_LABEL = {
  capacity: 'capacité du mois atteinte',
  inactive: 'mois inactifs (grille Sites actifs / inactifs)',
  cancelled: 'mois d\'une visite annulée',
  gap: 'intervalle avec une visite existante',
  period: 'période trop courte',
};
// Raisons d'une affectation non écrite à l'application (relues en base).
const SKIP_LABEL = { existing: 'déjà une visite ce mois', inactive: 'mois inactif', forbidden: 'zone interdite' };
// Sections de l'empreinte des entrées (planFingerprint) : ce qui a changé depuis l'aperçu.
const SECTION_LABEL = {
  registre: 'registre des sites', visites: 'visites', activation: 'sites actifs / inactifs',
  mmr: 'paramètres MMR', tpm: 'TPM des zones', parametres: 'période ou réglages',
};
const STRATEGIES = [
  { key: 'besoins', label: 'Selon les besoins (MMR)', hint: 'Toutes les visites exigées par le MMR (et le RBM pour les sites sans MMR) sont placées. La capacité déclarée est comparée et signalée, jamais un plafond.' },
  { key: 'capacite', label: 'Limiter à la capacité déclarée', hint: 'Le plan reste dans le faisable du MMR (fréquence et intervalle ajustés) ; ce qui ne tient pas est signalé, avec sa raison.' },
];

/**
 * Génération du plan de suivi sur une PÉRIODE (retours 82, 107, 108).
 * Ce que MEMS sait déjà n'est jamais redemandé : exigences, écarts, cible / mois, capacité,
 * suivis / jour, jours ouvrés et personnes viennent du MMR (repli RBM selon le risque du site) et
 * sont montrés en LECTURE SEULE avec leur source. On choisit : la période, le périmètre (bureau,
 * activité, district), la stratégie, et quelques options S&E repliées (communes inaccessibles,
 * renfort des sites urgents, agents par véhicule, jours de terrain, écrire dates et agents).
 * La période part de l'exercice affiché par le Plan de suivi (`year`), jamais d'un mois échu ;
 * « Appliquer » renvoie l'empreinte de l'aperçu : si les données ont changé, le serveur refuse (409)
 * et l'écran demande de relancer l'aperçu.
 * @param {{ year: number, sites?: object[], onClose: Function, onDone: Function }} props
 *   `sites` : sites du Plan de suivi (listes du périmètre et des communes).
 */
export default function PlanAutoDrawer({ year, sites = [], onClose, onDone }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const nowMonth = monthFromNow(0);
  // « Libellé : n » — espace avant les deux-points en français seulement.
  const kv = (label, n) => `${label}${lang === 'fr' ? ' : ' : ': '}${formatInt(n)}`;
  const boardYear = String(year || yearOf(nowMonth));
  const pastYear = boardYear < yearOf(nowMonth);
  // Exercice courant : du mois courant à décembre ; exercice à venir : toute l'année.
  const start = boardYear === yearOf(nowMonth) ? nowMonth : `${boardYear}-01`;
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(`${boardYear}-12`);
  const [stale, setStale] = useState(null); // sections changées depuis l'aperçu (409)
  const [scope, setScope] = useState({ fieldOfficeId: '', activity: '', district: '' });
  const [strategy, setStrategy] = useState('besoins');
  const [reinforceUrgent, setReinforceUrgent] = useState(false);
  const [excluded, setExcluded] = useState([]);       // [{ district, commune }]
  const [agentsPerVehicle, setAgentsPerVehicle] = useState(4);
  const [fieldDaysPerMonth, setFieldDaysPerMonth] = useState(20);
  const [writeSchedule, setWriteSchedule] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [offices, setOffices] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listOffices().then((o) => setOffices((o || []).filter((x) => x.active !== false))).catch(() => setOffices([])); }, []);

  const sameYear = yearOf(from) === yearOf(to);
  const allPast = Boolean(to) && to < nowMonth;
  const invalid = !from || !to || from > to || !sameYear || allPast;
  const reset = () => { setPreview(null); setStale(null); };
  const setPeriod = (f, t) => { setFrom(f); setTo(t); reset(); };
  const up = (setter) => (v) => { setter(v); reset(); };

  // Préréglages de période (dans l'exercice du mois de départ).
  const y = yearOf(from);
  // Un préréglage qui donne la même période qu'un précédent n'est pas répété (en octobre, le
  // trimestre et le semestre s'arrêtent en décembre, comme « Reste de l'année »).
  const presets = [
    { key: 'rest', label: tr('Reste de l\'année'), f: from, t: `${y}-12` },
    { key: 'quarter', label: tr('Trimestre'), f: from, t: ym(y, mOf(from) + 2) },
    { key: 'semester', label: tr('Semestre'), f: from, t: ym(y, mOf(from) + 5) },
    { key: 'year', label: tr('Toute l\'année'), f: `${y}-01`, t: `${y}-12` },
  ].filter((p) => !(p.key === 'rest' && p.f === `${y}-01`))  // depuis janvier : « Toute l'année »
    .filter((p, i, all) => all.findIndex((q) => q.f === p.f && q.t === p.t) === i);
  const presetActive = (p) => from === p.f && to === p.t;

  // Listes du périmètre, tirées du Plan de suivi (aucune saisie libre).
  const lists = useMemo(() => {
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fr'));
    const inDistrict = (s) => !scope.district || norm(s.district) === norm(scope.district);
    const communes = new Map();
    for (const s of sites) {
      if (!s.commune || !inDistrict(s)) continue;
      const k = `${norm(s.district)}|${norm(s.commune)}`;
      if (!communes.has(k)) communes.set(k, { district: s.district || '', commune: s.commune });
    }
    return {
      activities: uniq(sites.map((s) => s.activity)),
      districts: uniq(sites.map((s) => s.district)),
      communes: [...communes.values()].sort((a, b) => `${a.district} ${a.commune}`.localeCompare(`${b.district} ${b.commune}`, 'fr')),
    };
  }, [sites, scope.district]);
  // Bureaux : les bureaux puis leurs antennes (une antenne est comprise dans son bureau).
  const officeOptions = useMemo(() => {
    const top = offices.filter((o) => !o.parentId).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
    const out = [];
    for (const o of top) {
      out.push({ id: o.id, label: o.name });
      for (const c of offices.filter((x) => x.parentId === o.id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'))) {
        out.push({ id: c.id, label: `↳ ${c.name}` });
      }
    }
    for (const o of offices) if (o.parentId && !offices.some((p) => p.id === o.parentId)) out.push({ id: o.id, label: o.name });
    return out;
  }, [offices]);

  const scopeBody = useMemo(() => {
    const out = {};
    if (scope.fieldOfficeId) out.fieldOfficeId = scope.fieldOfficeId;
    if (scope.activity) out.activity = scope.activity;
    if (scope.district) out.district = scope.district;
    return out;
  }, [scope]);
  const payload = useMemo(() => ({
    from, to,
    ...(Object.keys(scopeBody).length ? { scope: scopeBody } : {}),
    settings: {
      strategy,
      reinforceUrgent,
      excludedCommunes: excluded.map((c) => ({ district: c.district || '', commune: c.commune })),
      agentsPerVehicle: Math.min(10, Math.max(1, Math.round(Number(agentsPerVehicle)) || 4)),
      fieldDaysPerMonth: Math.min(26, Math.max(1, Math.round(Number(fieldDaysPerMonth)) || 20)),
      writeSchedule,
    },
  }), [from, to, scopeBody, strategy, reinforceUrgent, excluded, agentsPerVehicle, fieldDaysPerMonth, writeSchedule]);
  const optionsCount = (reinforceUrgent ? 1 : 0) + (excluded.length ? 1 : 0) + (writeSchedule ? 1 : 0)
    + (Number(agentsPerVehicle) !== 4 ? 1 : 0) + (Number(fieldDaysPerMonth) !== 20 ? 1 : 0);

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
  // Export CSV « base de budget » : par unité (TPM / bureau) et par mois — visites, journées-agent,
  // agents, véhicules et jours de terrain. On y ajoute ses coûts journaliers pour obtenir le budget.
  function exportBudget() {
    if (!preview) return;
    const bureau = tr('Interne (équipe S&E)');
    const rows = [[tr('Unité (TPM / bureau)'), tr('Mois'), tr('Visites à faire'), tr('dont nouvelles'), tr('Journées-agent'), tr('Agents'),
      tr('Véhicules (pic / jour)'), tr('Véhicules (moyenne / jour)'), tr('Jours de terrain'), tr('Source des jours de terrain')]];
    for (const t of preview.byTpm || []) {
      const label = t.assigned ? t.tpm : bureau;
      for (const m of t.perMonth || []) {
        rows.push([label, m.month, m.visits, m.count, m.agentDays, m.agents, m.vehiclesPeak, m.vehiclesAvg,
          m.workingDays ?? '', m.workingDaysSource ? tr(m.workingDaysSource === 'mmr' ? 'MMR (jours ouvrés)' : 'paramètre du plan') : '']);
      }
      rows.push([label, tr('Total / pic'), t.visits, t.planned, t.agentDays, t.agentsPeak, t.vehiclesPeak, '', '', '']);
    }
    downloadCsv(`plan-suivi-budget-${from}_${to}.csv`, rows);
    toast.success(tr('Export CSV téléchargé.'));
  }
  async function clearPlanned() {
    if (invalid) return;
    if (!window.confirm(tr('Effacer les visites prévues libres de la période ? Sont toujours conservées : les visites réalisées ou annulées, celles des mois échus, celles déjà facturées, figées, datées, affectées à un agent ou dont le TPM a été choisi avec une raison.'))) return;
    setBusy(true);
    try {
      const r = await api.planAutoClear({ from, to, ...(Object.keys(scopeBody).length ? { scope: scopeBody } : {}) });
      toast.success(r.kept ? tr('{n} planification(s) effacée(s) · {k} conservée(s) (mois échus, facturées, figées, datées, affectées ou motivées).', { n: r.deleted, k: r.kept })
        : tr('{n} planification(s) effacée(s).', { n: r.deleted }));
      reset();
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  const maxCount = preview ? Math.max(1, ...preview.perMonth.map((m) => m.count + m.existing)) : 1;
  const cov = preview ? (preview.summary.coverageRate ?? 0) : 0;
  const covColor = cov >= 80 ? 'var(--green-500, #2e9e5b)' : cov >= 50 ? 'var(--amber-500, #d99100)' : 'var(--red-500, #d64545)';
  const sum = preview ? preview.summary : null;
  const resMonths = preview && preview.resources ? preview.resources.months || [] : [];
  const peakMonth = preview && preview.resources && preview.resources.peak ? resMonths.find((m) => m.month === preview.resources.peak.agentsMonth) || null : null;

  // Échantillon de sites réels (avec leurs mois prévus) pour un aperçu concret.
  const sample = useMemo(() => {
    if (!preview) return [];
    const bySite = new Map();
    for (const a of preview.sample || []) {
      if (!bySite.has(a.siteId)) bySite.set(a.siteId, { name: a.name || '—', commune: a.commune, district: a.district, activity: a.activity || null, tpm: a.tpm || null, visits: [] });
      bySite.get(a.siteId).visits.push(a);
    }
    return [...bySite.values()].slice(0, 8).map((s) => ({ ...s, visits: s.visits.sort((a, b) => String(a.month).localeCompare(String(b.month))) }));
  }, [preview]);

  const addExcluded = (key) => {
    const c = lists.communes.find((x) => `${norm(x.district)}|${norm(x.commune)}` === key);
    if (!c || excluded.some((x) => norm(x.district) === norm(c.district) && norm(x.commune) === norm(c.commune))) return;
    setExcluded([...excluded, c]); reset();
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={tr('Générer le plan de suivi')} size="editor"
      footer={<>
        <Button variant="ghost" icon={Trash2} onClick={clearPlanned} disabled={busy || invalid}
          title={tr('Supprimer les visites prévues libres de la période et du périmètre pour repartir d\'un plan propre.')}>{tr('Effacer les planifications')}</Button>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button>
        {!preview
          ? <Button icon={Eye} loading={busy} disabled={invalid} onClick={runPreview}>{tr('Aperçu')}</Button>
          : <>
            <Button variant="secondary" icon={Download} onClick={exportBudget} disabled={busy}
              title={tr('Exporter les ressources du plan par unité et par mois (visites, journées-agent, agents, véhicules) — base du budget.')}>{tr('Budget (CSV)')}</Button>
            <Button variant="secondary" icon={Eye} loading={busy} disabled={invalid} onClick={runPreview}>{tr('Recalculer')}</Button>
            <Button icon={Wand2} loading={busy} disabled={invalid || Boolean(stale)} onClick={apply}
              title={stale ? tr('Les données ont changé : relancez l\'aperçu.') : undefined}>{tr('Appliquer')}</Button>
          </>}
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 18 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {tr('Le plan part des besoins du MMR (visites par site, écart minimal, sites à suivre par mois) et de la priorité du RBM ; les sites d\'une même commune sont suivis ensemble, toutes activités confondues. Choisissez la période et le périmètre, prévisualisez, puis appliquez — rien n\'est écrit avant « Appliquer ».')}
        </p>

        {/* 1 — Période */}
        <section style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarRange size={16} className="muted" aria-hidden="true" />
            <strong style={{ fontSize: 13 }}>{tr('Période')}</strong>
          </div>
          <div className="chips">
            {presets.map((p) => (
              <button key={p.key} type="button" className="chip" aria-pressed={presetActive(p)} onClick={() => setPeriod(p.f, p.t)}>{p.label}</button>
            ))}
          </div>
          <div className="form-grid">
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

        {/* 2 — Périmètre */}
        <section style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={16} className="muted" aria-hidden="true" />
            <strong style={{ fontSize: 13 }}>{tr('Périmètre')}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Field label={tr('Bureau')} htmlFor="pa-office" hint={tr('Antennes comprises.')}>
              <select id="pa-office" className="select" value={scope.fieldOfficeId} onChange={(e) => { setScope({ ...scope, fieldOfficeId: e.target.value }); reset(); }}>
                <option value="">{tr('Tous les bureaux')}</option>
                {officeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
            <Field label={tr('Activité')} htmlFor="pa-activity">
              <select id="pa-activity" className="select" value={scope.activity} onChange={(e) => { setScope({ ...scope, activity: e.target.value }); reset(); }}>
                <option value="">{tr('Toutes les activités')}</option>
                {lists.activities.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label={tr('District')} htmlFor="pa-district">
              <select id="pa-district" className="select" value={scope.district} onChange={(e) => { setScope({ ...scope, district: e.target.value }); reset(); }}>
                <option value="">{tr('Tous les districts')}</option>
                {lists.districts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{tr('Seuls les sites du périmètre sont planifiés ; les visites des autres sites comptent dans la charge (mêmes agents, mêmes véhicules).')}</span>
        </section>

        {/* 3 — Stratégie */}
        <section style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={16} className="muted" aria-hidden="true" />
            <strong style={{ fontSize: 13 }} id="pa-strategy-label">{tr('Stratégie')}</strong>
          </div>
          <div role="radiogroup" aria-labelledby="pa-strategy-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {STRATEGIES.map((s) => (
              <label key={s.key} className="check-row" style={{ alignItems: 'flex-start', border: `1px solid ${strategy === s.key ? 'var(--blue-600, #0f6cbd)' : 'var(--border)'}`,
                background: strategy === s.key ? 'var(--blue-50, #eff6fc)' : 'var(--surface)', borderRadius: 'var(--radius, 9px)', padding: '10px 12px' }}>
                <input type="radio" name="pa-strategy" value={s.key} checked={strategy === s.key} onChange={() => up(setStrategy)(s.key)} style={{ marginTop: 2 }} />
                <span style={{ display: 'grid', gap: 2 }}>
                  <strong style={{ fontSize: 13 }}>{tr(s.label)}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{tr(s.hint)}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* 4 — Options S&E (repliées) */}
        <section>
          <button type="button" onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions} aria-controls="pa-options"
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>
            {showOptions ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            <SlidersHorizontal size={15} className="muted" aria-hidden="true" /> {tr('Options S&E')}
            {optionsCount > 0 && <span className="muted" style={{ fontWeight: 400 }}>· {tr('{n} réglée(s)', { n: optionsCount })}</span>}
          </button>
          {showOptions && (
            <div id="pa-options" style={{ display: 'grid', gap: 14, marginTop: 12 }}>
              <Field label={tr('Communes inaccessibles')} htmlFor="pa-access" hint={tr('Leurs sites ne sont pas planifiés sur la période (sécurité, routes coupées) ; ils sont comptés à part.')}>
                <select id="pa-access" className="select" value="" onChange={(e) => addExcluded(e.target.value)}>
                  <option value="">{tr('Ajouter une commune…')}</option>
                  {lists.communes.map((c) => {
                    const k = `${norm(c.district)}|${norm(c.commune)}`;
                    return <option key={k} value={k}>{c.district ? `${c.commune} · ${c.district}` : c.commune}</option>;
                  })}
                </select>
              </Field>
              {excluded.length > 0 && (
                <div className="chips areas-chips">
                  {excluded.map((c) => (
                    <span key={`${c.district}|${c.commune}`} className="chip is-static">
                      {c.district ? `${c.commune} · ${c.district}` : c.commune}
                      <button type="button" className="chip-x" aria-label={tr('Retirer {c}', { c: c.commune })}
                        onClick={() => { setExcluded(excluded.filter((x) => x !== c)); reset(); }}><X size={14} aria-hidden="true" /></button>
                    </span>
                  ))}
                </div>
              )}
              <label className="check-row" style={{ display: 'flex', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={reinforceUrgent} onChange={(e) => up(setReinforceUrgent)(e.target.checked)} />
                <span>{tr('Renfort des sites urgents (RBM) : une visite de plus au premier mois possible, sans attendre l\'écart')}</span>
              </label>
              <div className="form-grid">
                <Field label={tr('Agents par véhicule')} htmlFor="pa-apv" hint={tr('Agents qui partent ensemble dans un véhicule (1 à 10).')}>
                  <input id="pa-apv" type="number" min="1" max="10" step="1" className="input" value={agentsPerVehicle} onChange={(e) => up(setAgentsPerVehicle)(e.target.value)} />
                </Field>
                <Field label={tr('Jours de terrain par agent et par mois')} htmlFor="pa-fdm" hint={tr('Utilisé seulement si le MMR ne donne pas les jours ouvrés (1 à 26).')}>
                  <input id="pa-fdm" type="number" min="1" max="26" step="1" className="input" value={fieldDaysPerMonth} onChange={(e) => up(setFieldDaysPerMonth)(e.target.value)} />
                </Field>
              </div>
              <label className="check-row" style={{ display: 'flex', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={writeSchedule} onChange={(e) => up(setWriteSchedule)(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ display: 'grid', gap: 2 }}>
                  <span>{tr('Écrire les dates et les agents')}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{writeSchedule
                    ? tr('Chaque visite reçoit le jour de terrain de sa tournée et un rôle générique (« Agent 1 », « Agent 2 »…). Les jours de collecte (budget) comptent alors ces visites, et « Effacer les planifications » les conserve (visites datées et affectées).')
                    : tr('Non coché : les visites sont créées au mois seul ; dates et agents se saisissent ensuite.')}</span>
                </span>
              </label>
            </div>
          )}
        </section>

        {/* 5 — Résultat */}
        {preview ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
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
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 12px', fontSize: 12, marginBottom: 4 }}>
                <span className="muted">{tr('Couverture des sites')}</span>
                <span><strong>{formatInt(sum.sitesCovered)}</strong> / {formatInt(sum.sitesActivePlannable)}{sum.coverageRate != null ? ` · ${num1(sum.coverageRate)} %` : ''}</span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-2)', overflow: 'hidden' }} role="progressbar"
                aria-valuenow={Math.round(cov)} aria-valuemin={0} aria-valuemax={100} aria-label={tr('Couverture des sites')}>
                <div style={{ height: '100%', width: `${Math.min(100, cov)}%`, background: covColor, transition: 'width .3s' }} />
              </div>
            </div>

            <Stats compact items={[
              { label: tr('Visites à créer'), value: formatInt(sum.planned), foot: sum.renfort > 0 ? tr('dont {n} de renfort', { n: formatInt(sum.renfort) }) : tr('{n} déjà prévue(s) ou réalisée(s)', { n: formatInt(sum.existingInPeriod) }) },
              { label: tr('Agents (pic)'), value: formatInt(sum.agentsTotalPeak), foot: sum.agentsPeakMonth ? tr('{m} · moyenne {a}', { m: shortMonth(sum.agentsPeakMonth), a: num1(sum.agentsAvg) }) : '—' },
              { label: tr('Véhicules (pic / jour)'), value: formatInt(sum.vehiclesPeak), foot: tr('{n} agent(s) par véhicule', { n: formatInt(preview.resources.agentsPerVehicle) }) },
              { label: tr('Personnes déclarées (MMR)'), value: sum.agentsDeclared != null ? formatInt(sum.agentsDeclared) : '—', foot: sum.agentsDeclared == null ? tr('non renseignées au MMR') : tr('au mois le plus chargé') },
            ]} />
            {sum.agentsGap != null && (sum.agentsGap > 0
              ? <Alert tone="warning" icon={AlertTriangle}>{tr('Il manque {n} agent(s) au mois le plus chargé ({m}) par rapport aux personnes déclarées au MMR : renforcez les équipes ou étalez le plan.', { n: formatInt(sum.agentsGap), m: shortMonth(sum.agentsPeakMonth) })}</Alert>
              : <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} aria-hidden="true" /> {tr('Les personnes déclarées au MMR suffisent au mois le plus chargé ({k} de marge).', { k: formatInt(-sum.agentsGap) })}</span>)}

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <span className="muted">{kv(tr('Pilotées par le MMR'), sum.mmrDriven)}</span>
              <span className="muted">{kv(tr('Repli RBM (sans MMR)'), sum.rbmFallback)}</span>
              {sum.alreadyCovered > 0 && <span className="muted">{kv(tr('Déjà planifiés (conservés)'), sum.alreadyCovered)}</span>}
              {sum.latePlanned > 0 && <span className="muted">{kv(tr('Prévues antérieures re-planifiées'), sum.latePlanned)}</span>}
              {sum.forbidden > 0 && <span className="muted">{kv(tr('Zones interdites exclues'), sum.forbidden)}</span>}
              {sum.access > 0 && <span className="muted">{kv(tr('Sites des communes inaccessibles'), sum.access)}</span>}
              {sum.inactive > 0 && <span className="muted">{kv(tr('Sites inactifs toute la période'), sum.inactive)}</span>}
              {sum.unplaced > 0 && <span className="muted">{kv(tr('Visites non placées'), sum.unplaced)}</span>}
            </div>

            {sum.monthsOverCapacity > 0 && (
              <Alert tone={sum.strategy === 'besoins' ? 'warning' : 'info'}>
                {sum.strategy === 'besoins'
                  ? tr('Les besoins dépassent la capacité déclarée (faisable du MMR) sur {n} mois-activité(s) : prévoyez les moyens, ou choisissez « Limiter à la capacité déclarée ».', { n: formatInt(sum.monthsOverCapacity) })
                  : tr('{n} mois-activité(s) au-delà de la capacité déclarée par les seules visites déjà prévues.', { n: formatInt(sum.monthsOverCapacity) })}
              </Alert>
            )}
            {sum.monthsBelowTarget > 0 && (
              <Alert tone="info">{tr('{n} mois-activité(s) sous le plancher « sites à suivre par mois » du MMR : pas assez de visites dues ou possibles ces mois-là (voir « Par activité »).', { n: formatInt(sum.monthsBelowTarget) })}</Alert>
            )}
            {sum.noActivity > 0 && (
              <Alert tone="warning">
                {tr('{n} site(s) sans activité : non planifiés. Renseignez leur activité (et leur MMR) dans la Configuration pour les suivre.', { n: formatInt(sum.noActivity) })}
              </Alert>
            )}
            {sum.alreadyCovered > 0 && (
              <Alert tone="info">
                {tr('{n} site(s) ont déjà des visites dans la période : le générateur n\'ajoute que les manquants. Pour repartir d\'un plan neuf, cliquez « Effacer les planifications ».', { n: formatInt(sum.alreadyCovered) })}
              </Alert>
            )}
            {sum.rbmFallback > 0 && (
              <Alert tone="info">
                {tr('{n} site(s) avec activité mais sans paramètre MMR : planifiés au repli RBM (fréquence du risque). Complétez leur MMR dans la Configuration pour un suivi exact.', { n: formatInt(sum.rbmFallback) })}
              </Alert>
            )}
            {sum.activitiesNeedingQuota > 0 && (
              <Alert tone="info">
                {tr('Suivis par jour non renseignés pour {n} activité(s) : compté 1 visite par journée-agent. Renseignez « Suivis/j » dans la Configuration MMR pour un effectif exact.', { n: formatInt(sum.activitiesNeedingQuota) })}
              </Alert>
            )}
            {sum.sitesUncovered > 0 && (
              <Alert tone="warning">
                {tr('{n} site(s) non couvert(s) sur la période, par raison :', { n: formatInt(sum.sitesUncovered) })}
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {Object.entries(sum.uncoveredByReason || {}).filter(([, n]) => n > 0).map(([k, n]) => (
                    <li key={k}>{formatInt(n)} — {tr(REASON_LABEL[k] || k)}</li>
                  ))}
                </ul>
                {(sum.uncoveredByReason || {}).capacity > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{tr('Capacité : augmentez la capacité (faisable) des activités concernées dans la Configuration MMR, ou choisissez la stratégie « Selon les besoins (MMR) ».')}</div>
                )}
              </Alert>
            )}
            {Array.isArray(preview.uncovered) && preview.uncovered.length > 0 && (
              <details>
                <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>{tr('Sites non couverts et leur raison ({n} sur {total})', { n: formatInt(preview.uncovered.length), total: formatInt(preview.uncoveredTotal) })}</summary>
                <div style={{ overflowX: 'auto' }}>
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
                </div>
              </details>
            )}

            {/* Par activité : valeurs du MMR / RBM en lecture seule, avec leur source */}
            {Array.isArray(preview.byActivity) && preview.byActivity.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>{tr('Par activité — valeurs du MMR et du RBM (lecture seule) et résultat')}</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ background: 'var(--surface)', minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th scope="col" style={{ minWidth: 220 }}>{tr('Activité')}</th>
                        <th scope="col">{tr('Source')}</th>
                        <th scope="col" className="num" title={tr('Visites exigées par site sur l\'exercice')}>{tr('Visites / site')}</th>
                        <th scope="col" className="num" title={tr('Écart minimal du MMR → écart appliqué au plan (mois entiers)')}>{tr('Écart (mois)')}</th>
                        <th scope="col" className="num" title={tr('Sites à suivre par mois (plancher)')}>{tr('Cible / mois')}</th>
                        <th scope="col" className="num" title={tr('Visites faisables par mois (capacité déclarée)')}>{tr('Capacité / mois')}</th>
                        <th scope="col" className="num" title={tr('Suivis par jour et par agent')}>{tr('Suivis / j')}</th>
                        <th scope="col" className="num" title={tr('Jours ouvrés par mois')}>{tr('Jours ouvrés')}</th>
                        <th scope="col" className="num" title={tr('Personnes déclarées au MMR')}>{tr('Personnes')}</th>
                        <th scope="col" className="num">{tr('Sites')}</th>
                        <th scope="col" className="num">{tr('Planifiées')}</th>
                        <th scope="col" className="num" title={tr('Mois au-delà de la capacité · mois sous la cible')}>{tr('Écarts')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.byActivity.map((a, i) => {
                        const m = a.mmr || {};
                        const mmrItv = a.parametered ? (preview.settings.adjusted && m.adjustedInterval ? m.adjustedInterval : m.interval) : null;
                        return (
                          <tr key={`${a.key || 'rbm'}-${i}`}>
                            <td>
                              <strong>{a.activity || tr('Sans activité')}</strong>
                              <div className="muted" style={{ fontSize: 11 }}>{a.parametered ? (a.fieldOffice || tr('Tous (plan général)')) : tr('Risque {r}', { r: tr(RISK_LABEL[a.riskLevel] || '—') })}</div>
                            </td>
                            <td>{a.source === 'mmr'
                              ? <Badge tone="blue" icon={Info}>{tr('MMR')}</Badge>
                              : <Badge icon={Info}>{a.mmrIncomplete ? tr('RBM (MMR incomplet)') : tr('RBM')}</Badge>}</td>
                            <td className="num">{a.requiredUsed != null ? formatInt(a.requiredUsed) : '—'}</td>
                            <td className="num">{a.source === 'mmr' && Number(mmrItv) > 0 ? <>{num1(mmrItv)} → <strong>{formatInt(a.stepUsed)}</strong></> : (a.stepUsed != null ? <strong>{formatInt(a.stepUsed)}</strong> : (a.stepsUsed || []).join(' / ') || '—')}</td>
                            <td className="num">{a.parametered ? num1(m.targetedPerMonth) : '—'}</td>
                            <td className="num">{a.parametered ? num1(m.feasible) : '—'}</td>
                            <td className="num">{a.parametered && m.visitsPerDay != null ? num1(m.visitsPerDay) : <span className="muted" title={tr('Non renseigné : 1 visite par journée-agent')}>—</span>}</td>
                            <td className="num">{a.parametered && m.workingDays != null ? formatInt(m.workingDays) : <span className="muted" title={tr('Non renseigné : paramètre « jours de terrain » du plan')}>—</span>}</td>
                            <td className="num">{a.parametered && m.personsToDeploy != null ? formatInt(m.personsToDeploy) : '—'}</td>
                            <td className="num">{formatInt(a.sites)}</td>
                            <td className="num"><strong>{formatInt(a.planned)}</strong></td>
                            <td className="num">
                              {a.monthsOverCapacity > 0 && <Badge tone="orange" icon={AlertTriangle}>{tr('{n} > capacité', { n: formatInt(a.monthsOverCapacity) })}</Badge>}
                              {a.monthsBelowTarget > 0 && <> <Badge icon={Info}>{tr('{n} < cible', { n: formatInt(a.monthsBelowTarget) })}</Badge></>}
                              {!a.monthsOverCapacity && !a.monthsBelowTarget && <span className="muted">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>
                  {tr('Source : Configuration › MMR (ligne du bureau, sinon plan général) ; lecture seule, à modifier dans la Configuration. Écart appliqué = écart minimal du MMR arrondi au mois supérieur, ramené si besoin pour que les visites exigées tiennent dans la durée de l\'opération. Repli RBM (site sans MMR) : risque élevé tous les {e} mois, moyen tous les {m} mois, faible tous les {f} mois.', {
                    e: formatInt(preview.rules.rbmMonths.elevee), m: formatInt(preview.rules.rbmMonths.moyenne), f: formatInt(preview.rules.rbmMonths.faible),
                  })}
                </span>
              </div>
            )}

            {/* Ressources : par mois (total), puis par unité */}
            {resMonths.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>{tr('Ressources par mois — visites à faire (nouvelles et déjà prévues), toutes unités')}</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ background: 'var(--surface)', minWidth: 700 }}>
                    <thead>
                      <tr>
                        <th scope="col">{tr('Mois')}</th>
                        <th scope="col" className="num">{tr('Visites')}</th>
                        <th scope="col" className="num" title={tr('Journées d\'un agent dans une commune, toutes activités')}>{tr('Journées-agent')}</th>
                        <th scope="col" className="num">{tr('Agents')}</th>
                        <th scope="col" className="num">{tr('Déclarés (MMR)')}</th>
                        <th scope="col" className="num">{tr('Écart')}</th>
                        <th scope="col" className="num">{tr('Véhicules (pic)')}</th>
                        <th scope="col" className="num">{tr('Véhicules (moy.)')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resMonths.map((m) => (
                        <tr key={m.month}>
                          <td>{shortMonth(m.month)} {m.month.slice(0, 4)}</td>
                          <td className="num">{formatInt(m.visits)}</td>
                          <td className="num">{formatInt(m.agentDays)}</td>
                          <td className="num"><strong>{formatInt(m.agentsNeeded)}</strong></td>
                          <td className="num">{m.declared != null ? formatInt(m.declared) : '—'}</td>
                          <td className="num">{m.gap == null ? '—' : m.gap > 0
                            ? <Badge tone="red" icon={AlertTriangle}>{tr('{n} manquant(s)', { n: formatInt(m.gap) })}</Badge>
                            : <Badge tone="green" icon={CheckCircle2}>{tr('suffisant')}</Badge>}</td>
                          <td className="num">{formatInt(m.vehiclesPeak)}</td>
                          <td className="num">{num1(m.vehiclesAvg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>
                  {tr('Une journée-agent = un agent dans une commune ; les visites d\'une commune (toutes activités) remplissent les journées selon les suivis par jour du MMR. Agents = ⌈journées-agent ÷ jours de terrain⌉ par unité ; véhicules d\'un jour = ⌈agents du district ÷ {n}⌉, additionnés sur les districts.', { n: formatInt(preview.resources.agentsPerVehicle) })}
                </span>
              </div>
            )}
            {Array.isArray(preview.byTpm) && preview.byTpm.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>{tr('Par unité de suivi (TPM du contrat de la zone, sinon bureau)')}</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ background: 'var(--surface)', minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th scope="col">{tr('Unité')}</th>
                        <th scope="col" className="num">{tr('Sites')}</th>
                        <th scope="col" className="num">{tr('Visites')}</th>
                        <th scope="col" className="num">{tr('Journées-agent')}</th>
                        <th scope="col" className="num">{tr('Agents (pic)')}</th>
                        <th scope="col" className="num">{tr('Agents (moy.)')}</th>
                        <th scope="col" className="num">{tr('Véhicules (pic)')}</th>
                        <th scope="col">{tr('Jours de terrain')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.byTpm.map((t, i) => (
                        <tr key={`${t.unitKey || 'na'}-${i}`}>
                          <td>{t.assigned ? <strong>{t.tpm}</strong> : <span className="muted">{tr('Interne (équipe S&E)')}</span>}</td>
                          <td className="num">{formatInt(t.sites)}</td>
                          <td className="num">{formatInt(t.visits)}{t.planned !== t.visits ? <span className="muted"> ({tr('{n} nouv.', { n: formatInt(t.planned) })})</span> : null}</td>
                          <td className="num">{formatInt(t.agentDays)}</td>
                          <td className="num"><strong>{formatInt(t.agentsPeak)}</strong></td>
                          <td className="num">{num1(t.agentsAvg)}</td>
                          <td className="num">{formatInt(t.vehiclesPeak)}</td>
                          <td className="muted">{t.workingDaysSource === 'mmr' ? tr('jours ouvrés du MMR') : tr('paramètre : {n} j / mois', { n: formatInt(preview.resources.fieldDaysPerMonth) })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>{tr('Le TPM d\'un site = contrat de suivi actif de sa zone ; sans contrat, le suivi est fait par le bureau (en interne).')}</span>
              </div>
            )}
            {peakMonth && Array.isArray(peakMonth.zones) && peakMonth.zones.length > 0 && (
              <details>
                <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>{tr('Sites par jour et par zone — {m} (mois le plus chargé)', { m: `${shortMonth(peakMonth.month)} ${peakMonth.month.slice(0, 4)}` })}</summary>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ background: 'var(--surface)', marginTop: 6 }}>
                    <thead><tr><th scope="col">{tr('District')}</th><th scope="col" className="num">{tr('Communes')}</th><th scope="col" className="num">{tr('Visites')}</th><th scope="col" className="num">{tr('Journées-agent')}</th><th scope="col" className="num">{tr('Sites / jour')}</th></tr></thead>
                    <tbody>
                      {peakMonth.zones.map((z) => (
                        <tr key={z.district || '—'}>
                          <td><strong>{z.district || '—'}</strong></td>
                          <td className="num">{formatInt((z.communes || []).length)}</td>
                          <td className="num">{formatInt(z.visits)}</td>
                          <td className="num">{formatInt(z.agentDays)}</td>
                          <td className="num">{num1(z.sitesPerDay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {sample.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>{tr('Exemples de sites et leurs visites prévues')}</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ background: 'var(--surface)' }}>
                    <thead><tr><th scope="col">{tr('Site')}</th><th scope="col">{tr('Commune')}</th><th scope="col">{tr('Activité')}</th><th scope="col">{tr('TPM')}</th><th scope="col">{writeSchedule ? tr('Visites (date · agent)') : tr('Mois prévus')}</th></tr></thead>
                    <tbody>
                      {sample.map((s, i) => (
                        <tr key={`${s.name}-${i}`}>
                          <td><strong>{s.name}</strong></td>
                          <td className="muted">{s.commune || '—'}</td>
                          <td className="muted">{s.activity || '—'}</td>
                          <td className="muted">{s.tpm || tr('Interne (équipe S&E)')}</td>
                          <td>{s.visits.map((v) => (writeSchedule && v.date ? `${shortDate(v.date)} · ${v.agent}` : shortMonth(v.month))).join(' — ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>{tr('Échantillon · le plan complet compte {v} visite(s) et couvre {n} site(s).', { v: formatInt(preview.sampleTotal ?? sum.planned), n: formatInt(sum.sitesCovered) })}</span>
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{tr('Répartition par mois')}</div>
            <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ background: 'var(--surface)' }}>
              <thead><tr><th scope="col">{tr('Mois')}</th><th scope="col" className="num">{tr('Nouvelles')}</th><th scope="col" className="num">{tr('Déjà prévues')}</th><th scope="col" style={{ width: '50%' }}><span className="sr-only">{tr('Charge du mois')}</span></th></tr></thead>
              <tbody>
                {preview.perMonth.map((m) => (
                  <tr key={m.month}>
                    <td>{shortMonth(m.month)} {m.month.slice(0, 4)}</td>
                    <td className="num">{formatInt(m.count)}</td>
                    <td className="num muted">{formatInt(m.existing)}</td>
                    <td>
                      <span style={{ display: 'inline-flex', width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-2)' }}>
                        <span style={{ width: `${Math.round((m.existing / maxCount) * 100)}%`, background: 'var(--border-strong, #ccd2dc)' }} />
                        <span style={{ width: `${Math.round((m.count / maxCount) * 100)}%`, background: 'var(--blue-500, #0f6cbd)' }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {tr('« Appliquer » crée ces visites comme « planifiées », exactement celles de cet aperçu (si les données ont changé entre-temps, rien n\'est écrit). Idempotent : un site déjà prévu ce mois n\'est pas dupliqué, et l\'intervalle est respecté face aux visites existantes.')}
              {' '}{preview.writeSchedule
                ? tr('Option cochée : chaque visite reçoit sa date et son agent ; les jours de collecte (budget) comptent ces visites et « Effacer les planifications » les conserve.')
                : tr('Les visites sont créées au mois seul (sans date ni agent).')}
            </p>
          </section>
        ) : <Alert tone="info">{tr('Choisissez la période et le périmètre puis cliquez sur « Aperçu » pour voir la répartition et les ressources avant d\'écrire.')}</Alert>}
      </div>
    </Modal>
  );
}
