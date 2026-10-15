import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownCircle, ArrowLeft, Ban, Banknote, CalendarClock, CalendarOff, CalendarX, CheckCircle2, CircleDot, Clock,
  CloudRain, ExternalLink, FastForward, FileSpreadsheet, Gauge, Handshake, HelpCircle, Hourglass, Info, Layers, ListChecks, Lock, MapPin,
  PauseCircle, Route, Search, Settings2, ShieldAlert, Target, Timer, Users, Wand2, X,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Field } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, formatLocale, monthLabel } from '../../lib/format.js';
import {
  WHY, POSTPONE, STRATEGIES, READ_ONLY_META, countByReason, pct, postponeText, proposalText, defaultHorizon, needsStatement,
} from '../../lib/planGen.js';
import './autoPlan.css';

/**
 * « Planification automatique » du Plan de suivi (lot 5, retours 82, 107 et 108).
 * Le plan part des BESOINS du MMR : on choisit la période, le périmètre et la stratégie ;
 * ce que MEMS sait déjà (sites actifs, exigence et rythme du MMR, ordre du RBM, prestataire
 * du contrat) est montré en lecture seule avec sa source et le lien où cela se règle ; les
 * exceptions du mois (communes inaccessibles) sont dans « Ajustements (avancé) ». L'aperçu
 * calculé par le serveur (rien n'est écrit) dit ce qu'il faut : visites par mois, journées-
 * agent, agents et véhicules nécessaires, comparés au déclaré ; puis « Voir dans la grille »
 * (propositions « proposé », à décocher) ou « Appliquer ». Les raisons viennent du serveur en
 * codes ; elles sont affichées couleur + icône + libellé.
 */
export const REASON_ICONS = {
  urgent: AlertTriangle, deadline: Hourglass, due: CalendarClock, place: MapPin, commune: Layers, district: Route, coverage: Target,
  ahead: FastForward, capacity: Gauge, days: Clock, year: CalendarX, interval: Timer, covered: CheckCircle2, low: ArrowDownCircle,
  calendar: CalendarOff, inactive: PauseCircle, forbidden: ShieldAlert, cancelled: Ban, unknown: HelpCircle, later: CalendarClock, access: CloudRain,
};
export const LEVEL_ICONS = { haute: AlertTriangle, moyenne: CircleDot, basse: ArrowDownCircle };
const READ_ONLY_ICONS = { sites: MapPin, mmr: FileSpreadsheet, pace: Clock, priority: ShieldAlert, budget: Banknote, provider: Handshake };
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const tone = (t) => (t === 'gray' ? undefined : t);
const CONFIG_HASH = '#/processus/rbm/configuration/planification';
const SITES_HASH = '#/processus/rbm/sites';
const MMR_HASH = '#/processus/rbm/configuration/mmr';

/** Raison de report compacte (icône + nombre ; libellé au survol et pour les lecteurs d'écran). */
function ReasonCount({ code, n }) {
  const { tr } = useI18n();
  const meta = POSTPONE[code] || { label: code, tone: 'gray', icon: 'unknown' };
  const Icon = REASON_ICONS[meta.icon] || HelpCircle;
  return (
    <span className={`ap-count is-${meta.tone}`} title={`${tr(meta.label)} : ${formatInt(n)}`}>
      <Icon size={13} aria-hidden="true" /><span className="sr-only">{tr(meta.label)}</span> {formatInt(n)}
    </span>
  );
}

export function ReasonBadge({ meta, children }) {
  const { tr } = useI18n();
  if (!meta) return null;
  return <Badge tone={tone(meta.tone)} icon={REASON_ICONS[meta.icon]}>{children || tr(meta.label)}</Badge>;
}

export default function AutoPlanDrawer({ year, activities = [], districts = [], communes = [], onClose, onShowInGrid, onApplied }) {
  const { tr } = useI18n();
  const toast = useToast();
  const horizon = defaultHorizon(year);
  const [saved, setSaved] = useState(null);
  const [offices, setOffices] = useState([]);
  const [scope, setScope] = useState({ from: horizon ? horizon.from : 1, to: 12, officeId: '', activity: '', district: '' });
  const [crit, setCrit] = useState(null);
  const [excluded, setExcluded] = useState([]);
  const [step, setStep] = useState('criteria');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [lastBody, setLastBody] = useState(null);
  const [error, setError] = useState(null);
  const anchor = useRef(null);
  // Changement d'étape : le panneau revient en haut (l'aperçu ne s'ouvre jamais au milieu).
  useEffect(() => {
    const body = anchor.current && anchor.current.closest('.dialog-body');
    if (body) body.scrollTop = 0;
  }, [step]);

  useEffect(() => {
    api.planSettings().then((s) => { setSaved(s); setCrit({ ...s.settings }); }).catch((e) => setError(e.message));
    api.listOffices().then((o) => setOffices(o.filter((x) => x.active))).catch(() => setOffices([]));
  }, []);

  const overrides = useMemo(() => {
    if (!saved || !crit) return {};
    const out = {};
    for (const k of Object.keys(saved.settings)) if (crit[k] !== saved.settings[k]) out[k] = crit[k];
    return out;
  }, [saved, crit]);
  const body = {
    year, from: Number(scope.from), to: Number(scope.to), officeId: scope.officeId || null, activity: scope.activity || null, district: scope.district || null,
    params: overrides, adjust: { excludedCommunes: excluded.map((c) => ({ district: c.district, commune: c.commune })) },
  };
  const pastYear = !horizon;
  const bounds = (saved && saved.bounds) || {};
  const outOf = (k) => crit && bounds[k] && (!Number.isInteger(crit[k]) || crit[k] < bounds[k][0] || crit[k] > bounds[k][1]);
  const invalid = pastYear || body.from > body.to || !crit || outOf('agentsPerVehicle') || outOf('fieldDaysPerMonth');

  async function compute() {
    setBusy(true); setError(null);
    try {
      const r = await api.planPreview(body);
      setResult(r); setLastBody(body); setStep('preview');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function applyAll() {
    if (!result || !result.proposals.length) return;
    if (!window.confirm(tr('Enregistrer les {n} visites proposées ? Les visites déjà prévues, réalisées ou annulées ne sont jamais modifiées.', { n: formatInt(result.proposals.length) }))) return;
    setBusy(true); setError(null);
    try {
      const r = await api.planApply({ ...lastBody, fingerprint: result.fingerprint, sections: result.sections, keep: result.proposals.map((p) => ({ siteId: p.siteId, month: p.month })), changes: [] });
      toast.success(tr('Plan enregistré : {n} visite(s) planifiée(s).', { n: formatInt(r.created) }));
      onApplied(r);
    } catch (e) {
      if (e.status === 409 && e.details && e.details.code === 'plan_inputs_changed') setError(tr('Les données ont changé depuis l\'aperçu : recalculez-le avant d\'appliquer.'));
      else setError(e.message);
    } finally { setBusy(false); }
  }

  const monthName = (m) => monthLabel(`${year}-${String(m).padStart(2, '0')}`);
  const footer = step === 'criteria' ? (
    <>
      <Button variant="secondary" onClick={onClose}>{tr('Fermer')}</Button>
      <Button icon={Wand2} loading={busy} disabled={invalid} onClick={compute}>{tr('Calculer l\'aperçu')}</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep('criteria')}>{tr('Critères')}</Button>
      <span className="ap-foot-spacer" />
      <Button variant="secondary" icon={CheckCircle2} loading={busy} disabled={!result || !result.proposals.length} onClick={applyAll}>{tr('Appliquer tout')}</Button>
      <Button icon={ListChecks} disabled={!result || !result.proposals.length} onClick={() => onShowInGrid(result, lastBody)}>{tr('Voir dans la grille')}</Button>
    </>
  );

  return (
    <Modal open onClose={onClose} variant="drawer" size="xl" title={tr('Planification automatique')}
      subtitle={tr('Exercice {y} — le plan suit le MMR, le RBM et la grille des sites actifs ; il dit les agents et les véhicules nécessaires. Rien n\'est enregistré avant « Appliquer ».', { y: String(year) })}
      footer={footer}>
      <div ref={anchor} className="ap-root">
        {error && <Alert tone="danger" icon={AlertTriangle}>{error}</Alert>}
        {step === 'criteria' ? (
          <CriteriaForm year={year} scope={scope} setScope={setScope} crit={crit} setCrit={setCrit} saved={saved} overrides={overrides}
            offices={offices} activities={activities} districts={districts} communes={communes} excluded={excluded} setExcluded={setExcluded}
            pastYear={pastYear} monthName={monthName} />
        ) : (
          <PreviewView result={result} year={year} monthName={monthName} overrides={overrides} />
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- Critères */
function CriteriaForm({ year, scope, setScope, crit, setCrit, saved, overrides, offices, activities, districts, communes, excluded, setExcluded, pastYear, monthName }) {
  const { tr } = useI18n();
  const now = new Date();
  const thisMonth = now.getFullYear() === year ? now.getMonth() + 1 : 1;
  const set = (k, v) => setCrit((c) => ({ ...c, [k]: v }));
  const mark = (k) => (overrides[k] !== undefined ? <span className="ap-adjusted" title={tr('Ajusté pour cet aperçu (non enregistré)')}>{tr('ajusté')}</span> : null);
  const presets = [
    [tr('Ce mois'), thisMonth, thisMonth], [tr('Mois prochain'), Math.min(thisMonth + 1, 12), Math.min(thisMonth + 1, 12)], [tr('Reste de l\'exercice'), thisMonth, 12],
  ];
  if (pastYear) return <Alert tone="info" icon={Info}>{tr('Exercice passé : il n\'y a plus de mois à planifier. Choisissez l\'exercice en cours ou le suivant.')}</Alert>;
  const numInput = (k, label) => {
    const b = (saved && saved.bounds && saved.bounds[k]) || [1, 99];
    return (
      <input className="input ap-num" type="number" min={b[0]} max={b[1]} step={1} value={crit[k] ?? ''} aria-label={label}
        onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
    );
  };
  return (
    <div className="ap-form">
      <section className="ap-section" aria-labelledby="ap-scope">
        <h3 id="ap-scope" className="ap-h">{tr('Période et périmètre')}</h3>
        <div className="ap-period">
          <Field label={tr('Du mois')}>
            <select className="select" value={scope.from} onChange={(e) => setScope({ ...scope, from: Number(e.target.value) })}>
              {MONTHS.filter((m) => m >= thisMonth).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </Field>
          <Field label={tr('au mois')}>
            <select className="select" value={scope.to} onChange={(e) => setScope({ ...scope, to: Number(e.target.value) })}>
              {MONTHS.filter((m) => m >= thisMonth).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </Field>
          <div className="ap-presets" role="group" aria-label={tr('Raccourcis de période')}>
            {presets.map(([l, a, b]) => (
              <button key={l} type="button" className={`ap-chip ${scope.from === a && scope.to === b ? 'is-on' : ''}`} aria-pressed={scope.from === a && scope.to === b}
                onClick={() => setScope({ ...scope, from: a, to: b })}>{l}</button>
            ))}
          </div>
        </div>
        {scope.from > scope.to && <p className="field-error">{tr('Le mois de début est après le mois de fin.')}</p>}
        <div className="ap-grid3">
          <Field label={tr('Bureau')}>
            <select className="select" value={scope.officeId} onChange={(e) => setScope({ ...scope, officeId: e.target.value })}>
              <option value="">{tr('Tous les bureaux')}</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label={tr('Activité')}>
            <select className="select" value={scope.activity} onChange={(e) => setScope({ ...scope, activity: e.target.value })}>
              <option value="">{tr('Toutes les activités')}</option>
              {activities.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label={tr('District')}>
            <select className="select" value={scope.district} onChange={(e) => setScope({ ...scope, district: e.target.value })}>
              <option value="">{tr('Tous les districts')}</option>
              {districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        </div>
        <p className="ap-help">{tr('La répartition est calculée jusqu\'à décembre pour équilibrer la charge ; l\'aperçu montre la période choisie.')}</p>
      </section>

      <section className="ap-section" aria-labelledby="ap-strat">
        <div className="ap-h-row">
          <h3 id="ap-strat" className="ap-h">{tr('Stratégie')} {mark('strategy')}</h3>
          <a className="ap-link" href={CONFIG_HASH}><Settings2 size={14} aria-hidden="true" /> {tr('Paramètres enregistrés')}</a>
        </div>
        {!crit ? <p className="muted">{tr('Chargement…')}</p> : (
          <div className="ap-strategies" role="radiogroup" aria-label={tr('Stratégie')}>
            {Object.entries(STRATEGIES).map(([k, s]) => (
              <label key={k} className={`ap-strategy ${crit.strategy === k ? 'is-on' : ''}`}>
                <input type="radio" name="ap-strategy" value={k} checked={crit.strategy === k} onChange={() => set('strategy', k)} />
                <span className="ap-strategy-text">
                  <span className="ap-strategy-label">{tr(s.label)}{k === (saved && saved.defaults && saved.defaults.strategy) ? <span className="ap-default"> · {tr('par défaut')}</span> : null}</span>
                  <span className="ap-strategy-help">{tr(s.help)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="ap-section" aria-labelledby="ap-known">
        <h3 id="ap-known" className="ap-h">{tr('Ce que MEMS reprend (lecture seule)')}</h3>
        <ul className="ap-known">
          {((saved && saved.readOnly) || []).map((r) => {
            const meta = READ_ONLY_META[r.key] || { title: r.key, icon: 'mmr' };
            const Icon = READ_ONLY_ICONS[meta.icon] || Info;
            return (
              <li key={r.key}>
                <Icon size={15} aria-hidden="true" />
                <span className="ap-known-text">
                  <strong>{tr(meta.title)}</strong> — {tr(r.source.label)}
                  {(r.source.kind === 'classeur' || r.source.ref !== meta.link) && <span className="ap-known-src">{r.source.kind === 'classeur' ? r.source.ref : tr(r.source.ref)}</span>}
                </span>
                {meta.href && <a className="ap-link" href={meta.href}>{tr(meta.link)} <ExternalLink size={12} aria-hidden="true" /></a>}
              </li>
            );
          })}
        </ul>
      </section>

      {crit && (
        <details className="ap-more" open={excluded.length > 0 || overrides.agentsPerVehicle !== undefined || overrides.fieldDaysPerMonth !== undefined}>
          <summary>{tr('Ajustements pour ce plan (avancé)')}</summary>
          <div className="ap-adjust">
            <div className="ap-row">
              <span className="ap-label"><CloudRain size={14} aria-hidden="true" /> {tr('Communes exclues pour l\'accès')}</span>
              <span className="ap-help">{tr('Saison des pluies, route coupée : les sites de ces communes ne sont pas planifiés dans ce plan (raison « accès »).')}</span>
              <CommunePicker communes={communes} excluded={excluded} setExcluded={setExcluded} />
            </div>
            <div className="ap-grid2">
              <Field label={<>{tr('Agents par véhicule')} {mark('agentsPerVehicle')}</>}>
                {numInput('agentsPerVehicle', tr('Agents par véhicule'))}
                <span className="ap-help">{tr('Remplace pour ce plan la valeur enregistrée ({v}).', { v: saved ? String(saved.settings.agentsPerVehicle) : '—' })}</span>
              </Field>
              <Field label={<>{tr('Jours de terrain par agent et par mois')} {mark('fieldDaysPerMonth')}</>}>
                {numInput('fieldDaysPerMonth', tr('Jours de terrain par agent et par mois'))}
                <span className="ap-help">{tr('Utilisé seulement quand le MMR ne donne pas les jours ouvrés ; remplace pour ce plan la valeur enregistrée ({v}).', { v: saved ? String(saved.settings.fieldDaysPerMonth) : '—' })}</span>
              </Field>
            </div>
            {Object.keys(overrides).length > 0 && saved && (
              <button type="button" className="link-btn ap-reset" onClick={() => setCrit({ ...saved.settings })}>{tr('Revenir aux paramètres enregistrés')}</button>
            )}
          </div>
        </details>
      )}

      <section className="ap-section ap-rules" aria-labelledby="ap-rules">
        <h3 id="ap-rules" className="ap-h">{tr('Toujours respecté')}</h3>
        <ul>
          <li><Lock size={13} aria-hidden="true" /> {tr('Un site inactif ce mois-là n\'est jamais planifié (grille Sites actifs / inactifs).')}</li>
          <li><Lock size={13} aria-hidden="true" /> {tr('Écart minimal du MMR entre deux visites d\'un même site.')}</li>
          <li><Lock size={13} aria-hidden="true" /> {tr('Zones interdites, visites annulées, visites déjà prévues ou réalisées : jamais touchées.')}</li>
          <li><Lock size={13} aria-hidden="true" /> {tr('Une journée = un agent dans une commune, toutes activités ; une tournée = un district.')}</li>
          <li><Lock size={13} aria-hidden="true" /> {tr('Prestataire (TPM) : celui du contrat de la zone, attribué à l\'enregistrement.')}</li>
        </ul>
      </section>
    </div>
  );
}

/** Liste des communes à exclure (accès), avec recherche. */
function CommunePicker({ communes, excluded, setExcluded }) {
  const { tr } = useI18n();
  const [q, setQ] = useState('');
  const keyOf = (c) => `${String(c.district || '').toLowerCase()}|${String(c.commune || '').toLowerCase()}`;
  const chosen = new Set(excluded.map(keyOf));
  const needle = q.trim().toLowerCase();
  const list = communes.filter((c) => !needle || `${c.commune} ${c.district}`.toLowerCase().includes(needle)).slice(0, 200);
  const toggle = (c) => setExcluded((cur) => (chosen.has(keyOf(c)) ? cur.filter((x) => keyOf(x) !== keyOf(c)) : [...cur, { district: c.district, commune: c.commune }]));
  return (
    <div className="ap-communes">
      {excluded.length > 0 && (
        <div className="ap-chips" aria-label={tr('Communes exclues')}>
          {excluded.map((c) => (
            <span key={keyOf(c)} className="ap-chip is-on">
              {c.commune}{c.district ? ` · ${c.district}` : ''}
              <button type="button" className="ap-chip-x" aria-label={tr('Retirer {c}', { c: c.commune })} onClick={() => toggle(c)}><X size={12} aria-hidden="true" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="ap-search">
        <Search size={14} aria-hidden="true" />
        <input className="input" type="search" value={q} placeholder={tr('Chercher une commune ou un district')} aria-label={tr('Chercher une commune ou un district')} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="ap-commune-list">
        {list.map((c) => (
          <li key={keyOf(c)}>
            <label className="check">
              <input type="checkbox" checked={chosen.has(keyOf(c))} onChange={() => toggle(c)} />
              {c.commune} <span className="muted">· {c.district || '—'} · {tr('{n} site(s)', { n: formatInt(c.sites) })}</span>
            </label>
          </li>
        ))}
        {!list.length && <li className="muted">{tr('Aucune commune.')}</li>}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- Aperçu */
function warningText(w, tr, { monthName, poolName, year }) {
  switch (w.code) {
    case 'statut_non_renseigne':
      return { tone: 'warn', text: tr('{n} site(s) sans statut en {m} : non planifiés (la grille {y} est ouverte) — renseignez-les dans Sites (actifs / inactifs).', { n: formatInt(w.count), m: monthName(Number(String(w.month).slice(5, 7))), y: String(w.year || year) }), href: SITES_HASH, link: tr('Ouvrir Sites (actifs / inactifs)') };
    case 'grille_inconnue': return { tone: 'info', text: tr('Aucune grille d\'activation pour {y} : tous les sites du registre comptent comme actifs.', { y: String(year) }), href: SITES_HASH, link: tr('Ouvrir Sites (actifs / inactifs)') };
    case 'sans_mmr': return { tone: 'warn', text: tr('{n} site(s) dont l\'activité est absente du MMR : à paramétrer ({a}).', { n: formatInt(w.count), a: (w.activities || []).map((a) => (a === '—' ? tr('sans activité') : a)).join(', ') || '—' }), href: MMR_HASH, link: tr('Ouvrir Exigences (MMR)') };
    case 'vpd_defaut': return { tone: 'warn', text: tr('Suivis par jour non renseignés au MMR pour {a} : 1 visite par journée retenue, à paramétrer.', { a: (w.activities || []).join(', ') }), href: MMR_HASH, link: tr('Ouvrir Exigences (MMR)') };
    case 'jours_defaut': return { tone: 'info', text: tr('Jours ouvrés non renseignés au MMR pour {a} : le paramètre « jours de terrain par agent et par mois » est utilisé.', { a: (w.activities || []).join(', ') }), href: MMR_HASH, link: tr('Ouvrir Exigences (MMR)') };
    case 'communes_exclues': return { tone: 'info', text: tr('{c} commune(s) exclue(s) pour l\'accès : {s} site(s) non planifiés dans ce plan.', { c: formatInt(w.communes), s: formatInt(w.sites) }) };
    case 'mmr_sites_ecart': return { tone: 'info', text: tr('{a} : {t} site(s) saisi(s) au MMR, {r} au registre — l\'exigence est calculée sur les sites du registre.', { a: w.activity, t: formatInt(w.typed), r: formatInt(w.registry) }) };
    case 'sans_calendrier': return { tone: 'info', text: tr('Sans calendrier d\'activité : les visites se répartissent sur les mois actifs des sites (grille Sites actifs / inactifs).') };
    case 'duree_nulle': return { tone: 'info', text: tr('{p} : durée MMR nulle, l\'activité n\'est pas planifiée.', { p: poolName(w.pool) }) };
    case 'capacite_inconnue': return { tone: 'warn', text: tr('{p} : aucune capacité (faisable) au MMR, rien n\'est proposé.', { p: poolName(w.pool) }) };
    case 'engagements_depassent': return { tone: 'warn', text: tr('{p} : les visites déjà prévues dépassent la capacité certains mois (rien n\'est retiré).', { p: poolName(w.pool) }) };
    case 'horizon_passe': return { tone: 'info', text: tr('Exercice passé : rien à planifier.') };
    default: return { tone: 'info', text: w.code };
  }
}

function PreviewView({ result, year, monthName, overrides }) {
  const { tr } = useI18n();
  const [openCode, setOpenCode] = useState(null);
  if (!result) return null;
  const t = result.totals;
  const needs = result.needs || { months: [], offices: [], peak: { agents: 0, vehicles: 0 }, agentsPerVehicle: 4 };
  const poolLabel = new Map(result.pools.map((p) => [p.key, `${p.activity}${p.officeName ? ` — ${p.officeName}` : ''}`]));
  const poolName = (k) => poolLabel.get(k) || k;
  const gaps = result.warnings.filter((w) => w.code === 'mmr_sites_ecart');
  const shown = result.warnings.filter((w) => w.code !== 'mmr_sites_ecart').map((w) => warningText(w, tr, { monthName, poolName, year }));
  const warnings = shown.filter((w) => w.tone === 'warn');
  const notes = shown.filter((w) => w.tone !== 'warn');
  notes.push(...ruleNotes(result, tr));
  if (gaps.length) notes.push({ tone: 'info', text: tr('{n} ligne(s) MMR : nombre de sites saisi différent du registre (écart > 10 %) — l\'exigence est calculée sur les sites du registre.', { n: gaps.length }) });
  for (const g of gaps) notes.push(warningText(g, tr, { monthName, poolName, year }));
  const reasons = countByReason(result.unplanned);
  const statement = needsStatement(result, { tr, monthName, num: formatInt });
  const period = result.fromMonth === result.toMonth ? monthName(result.fromMonth) : tr('{a} à {b}', { a: monthName(result.fromMonth), b: monthName(result.toMonth) });
  const agentDays = needs.months.reduce((a, m) => a + m.agentDays, 0);
  const visitsToDo = needs.months.reduce((a, m) => a + m.visits, 0);
  const peakMonth = needs.months.find((m) => m.month === needs.peak.agentsMonth);
  const declared = peakMonth ? peakMonth.declared : null;
  const dec = (v) => (v == null ? '—' : Number(v).toLocaleString(formatLocale(), { maximumFractionDigits: 1 }));
  return (
    <div className="ap-preview">
      <p className="ap-period-line">
        <CalendarClock size={15} aria-hidden="true" /> {period} · {tr(STRATEGIES[result.strategy] ? STRATEGIES[result.strategy].label : result.strategy)}
        {Object.keys(overrides).length > 0 && <Badge tone="orange">{tr('critères ajustés pour cet aperçu')}</Badge>}
      </p>
      <div className="ap-statement" role="note">
        {statement.lead.map((s, i) => <p key={i}>{s}</p>)}
        {statement.gaps.length > 0 && (
          <ul className="ap-gaps">
            {statement.gaps.slice(0, 8).map((g, i) => <li key={i}><Users size={14} aria-hidden="true" /> {g}</li>)}
            {statement.gaps.length > 8 && <li className="muted">{tr('… et {n} autre(s) : voir « Par bureau ».', { n: formatInt(statement.gaps.length - 8) })}</li>}
          </ul>
        )}
      </div>
      <div className="ap-tiles">
        <Tile label={tr('Visites planifiées')} value={formatInt(t.proposals)} foot={tr('{n} site(s)', { n: formatInt(t.sitesPlanned) })} strong />
        <Tile label={tr('Journées-agent')} value={formatInt(agentDays)} foot={tr('{v} visite(s) à faire', { v: formatInt(visitsToDo) })} />
        <Tile label={tr('Agents nécessaires')} value={formatInt(needs.peak.agents)}
          foot={declared != null ? tr('{p} déclaré(s) au MMR', { p: formatInt(declared) }) : tr('non déclaré au MMR')}
          tone={declared != null ? (needs.peak.agents > declared ? 'warn' : 'ok') : null} />
        <Tile label={tr('Véhicules nécessaires')} value={formatInt(needs.peak.vehicles)} foot={tr('{k} agents par véhicule · pic', { k: formatInt(needs.agentsPerVehicle) })} />
        <Tile label={tr('Non planifiés')} value={formatInt(t.unplanned)} foot={tr('sites du périmètre')} />
      </div>
      {t.proposals === 0 && <Alert tone="info" icon={Info}>{tr('Aucune visite à proposer : voyez ci-dessous pourquoi les sites ne sont pas planifiés.')}</Alert>}
      {warnings.length > 0 && (
        <div className="ap-warnings" role="list">
          {warnings.map((w, i) => <WarningLine key={i} w={w} />)}
        </div>
      )}
      {notes.length > 0 && (
        <details className="ap-notes">
          <summary><Info size={14} aria-hidden="true" /> {tr('Règles appliquées et notes de calcul ({n})', { n: notes.length })}</summary>
          <div className="ap-warnings" role="list">
            {notes.map((w, i) => <WarningLine key={i} w={w} />)}
          </div>
        </details>
      )}

      <h3 className="ap-h">{tr('Par mois')}</h3>
      <div className="table-wrap ap-table-wrap">
        <table className="table ap-table">
          <thead><tr>
            <th scope="col">{tr('Mois')}</th>
            <th scope="col" className="num">{tr('Sites')}</th>
            <th scope="col" className="num">{tr('Visites à faire')}</th>
            <th scope="col" className="num" title={tr('Sites à suivre au minimum par mois selon le MMR (sites ÷ écart minimal)')}>{tr('Minimum MMR')}</th>
            <th scope="col" className="num">{tr('Journées-agent')}</th>
            <th scope="col" className="num">{tr('Agents nécessaires')}</th>
            <th scope="col" className="num">{tr('Déclarés')}</th>
            <th scope="col" className="num">{tr('Véhicules (pic · moyenne)')}</th>
          </tr></thead>
          <tbody>
            {needs.months.map((m) => (
              <tr key={m.month}>
                <td>{monthName(m.month)}</td>
                <td className="num">{formatInt(m.sites)}</td>
                <td className="num"><strong>{formatInt(m.visits)}</strong></td>
                <td className="num">{formatInt(Math.ceil(t.mmrPerMonth || 0))}</td>
                <td className="num">{formatInt(m.agentDays)}</td>
                <td className="num"><strong>{formatInt(m.agentsNeeded)}</strong></td>
                <td className="num">{m.declared == null ? <span className="muted">—</span> : formatInt(m.declared)}{m.gap > 0 && <Badge tone="red">{tr('il manque {g}', { g: formatInt(m.gap) })}</Badge>}</td>
                <td className="num">{formatInt(m.vehiclesPeak)} · {dec(m.vehiclesAvg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ap-h">{tr('Par bureau')}</h3>
      <div className="table-wrap ap-table-wrap">
        <table className="table ap-table">
          <thead><tr>
            <th scope="col">{tr('Bureau')}</th>
            <th scope="col">{tr('Mois')}</th>
            <th scope="col" className="num">{tr('Visites')}</th>
            <th scope="col" className="num">{tr('Journées-agent')}</th>
            <th scope="col" className="num" title={tr('Jours ouvrés du MMR, sinon le paramètre de repli')}>{tr('Jours / agent')}</th>
            <th scope="col" className="num">{tr('Agents nécessaires')}</th>
            <th scope="col" className="num">{tr('Déclarés')}</th>
            <th scope="col" className="num">{tr('Véhicules (pic · moyenne)')}</th>
          </tr></thead>
          <tbody>
            {needs.offices.map((o) => (
              <tr key={`${o.officeId}|${o.month}`} className={o.gap > 0 ? 'ap-row-gap' : ''}>
                <td>{o.officeName || tr('Sans bureau')}</td>
                <td>{monthName(o.month)}</td>
                <td className="num">{formatInt(o.visits)}</td>
                <td className="num">{formatInt(o.agentDays)}</td>
                <td className="num">{formatInt(o.workingDays)}{o.workingDaysSource !== 'mmr' && <span className="ap-src" title={tr('Paramètre de repli : le MMR ne donne pas les jours ouvrés')}> *</span>}</td>
                <td className="num"><strong>{formatInt(o.agentsNeeded)}</strong></td>
                <td className="num">{o.declared == null ? <span className="muted">—</span> : formatInt(o.declared)}{o.gap > 0 && <Badge tone="red">{tr('il manque {g}', { g: formatInt(o.gap) })}</Badge>}</td>
                <td className="num">{formatInt(o.vehiclesPeak)} · {dec(o.vehiclesAvg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {needs.offices.some((o) => o.workingDaysSource !== 'mmr') && <p className="ap-help">{tr('* jours ouvrés absents du MMR : paramètre « jours de terrain par agent et par mois ».')}</p>}

      <h3 className="ap-h">{tr('Par zone')}</h3>
      <div className="ap-months">
        {needs.months.map((m) => (
          <details key={m.month} className="ap-month">
            <summary><strong>{monthName(m.month)}</strong> · {tr('{z} district(s) · {d} journée(s)-agent · {v} visite(s)', { z: formatInt(m.zones.length), d: formatInt(m.agentDays), v: formatInt(m.visits) })}</summary>
            <ul className="ap-zones">
              {m.zones.map((z) => (
                <li key={z.district}>
                  <span className="ap-zone-head"><Route size={13} aria-hidden="true" /> {tr('Tournée {n} — {d}', { n: z.tour, d: z.district })} · {tr('{j} journée(s), {v} visite(s), {s} site(s) par jour', { j: formatInt(z.agentDays), v: formatInt(z.visits), s: dec(z.sitesPerDay) })}</span>
                  <span className="ap-zone-communes">{z.communes.slice(0, 12).map((c) => `${c.commune} (${tr('{j} j', { j: c.agentDays })})`).join(' · ')}{z.communes.length > 12 ? ` · ${tr('… et {n} autre(s)', { n: z.communes.length - 12 })}` : ''}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>

      <h3 className="ap-h">{tr('Par activité et par bureau')}</h3>
      <PoolsTable result={result} />

      <h3 className="ap-h">{tr('Sites non planifiés et pourquoi')}</h3>
      {reasons.length === 0 ? <p className="muted">{tr('Tous les sites du périmètre ont une visite sur la période.')}</p> : (
        <div className="ap-why">
          <div className="ap-why-chips" role="group" aria-label={tr('Raisons')}>
            {reasons.map(({ code, count }) => (
              <button key={code} type="button" className={`ap-why-chip ${openCode === code ? 'is-on' : ''}`} aria-pressed={openCode === code} onClick={() => setOpenCode(openCode === code ? null : code)}>
                <ReasonBadge meta={POSTPONE[code]} /> <strong>{formatInt(count)}</strong>
              </button>
            ))}
          </div>
          {openCode && <ReasonList code={openCode} result={result} year={year} />}
        </div>
      )}

      <h3 className="ap-h">{tr('Visites proposées')}</h3>
      <ProposalSample result={result} monthName={monthName} />
      <p className="ap-help">{tr('Projection : une visite planifiée compte comme faite pour les mois suivants de l\'aperçu seulement. Ailleurs, une visite seulement planifiée ne rend jamais un site « à jour ».')}</p>
    </div>
  );
}

/** Règles appliquées, avec leur source (notes de l'aperçu). */
function ruleNotes(result, tr) {
  const out = [];
  if (result.strategy === 'capacite') {
    out.push({ tone: 'info', text: tr('Capacité du MMR (agents × suivis par jour × jours ouvrés, sinon « faisable ») : jamais dépassée ; les sites passent dans l\'ordre du RBM.'), href: MMR_HASH, link: tr('Ouvrir Exigences (MMR)') });
  } else {
    out.push({ tone: 'info', text: tr('Exigence du MMR par bureau et activité : visites par site = risque, écart minimal = durée ÷ risque, sites par mois = sites ÷ écart.'), href: MMR_HASH, link: tr('Ouvrir Exigences (MMR)') });
    out.push({ tone: 'info', text: tr('Chaque mois, chaque activité reçoit sa part : visites restantes ÷ mois restants ; un site dont c\'est le dernier mois possible passe d\'abord.') });
  }
  out.push({ tone: 'info', text: tr('Ordre du RBM : recommandation urgente, risque élevé, jamais visité, puis la plus longue absence de visite.'), href: '#/processus/rbm/priorites', link: tr('Ouvrir Priorités du mois') });
  out.push({ tone: 'info', text: tr('Journée = un agent dans une commune, toutes activités ; les sites d\'une même commune sont regroupés, puis ceux du district (tournée).') });
  out.push({ tone: 'info', text: tr('Agents = journées-agent ÷ jours de terrain par agent ; véhicules d\'un jour = agents d\'un même district ÷ agents par véhicule.') });
  return out;
}

function PoolsTable({ result }) {
  const { tr } = useI18n();
  const needsMode = result.strategy !== 'capacite';
  return (
    <div className="table-wrap ap-table-wrap">
      <table className="table ap-table">
        <thead><tr>
          <th scope="col">{tr('Activité et bureau')}</th>
          {needsMode ? (
            <>
              <th scope="col" className="num">{tr('Sites')}</th>
              <th scope="col" className="num" title={tr('Visites exigées par site sur l\'exercice et écart minimal entre deux visites')}>{tr('Exigence')}</th>
              <th scope="col" className="num">{tr('Faites ou prévues')}</th>
              <th scope="col" className="num">{tr('Planifiées')}</th>
              <th scope="col" className="num" title={tr('Planifiées après la période, ou qui ne tiennent plus dans l\'exercice')}>{tr('Plus tard · hors exercice')}</th>
            </>
          ) : (
            <>
              <th scope="col" className="num">{tr('Proposées')}</th>
              <th scope="col">{tr('Capacité utilisée')}</th>
              <th scope="col">{tr('Couverture projetée')}</th>
            </>
          )}
          <th scope="col">{tr('Non planifiables')}</th>
        </tr></thead>
        <tbody>
          {result.pools.map((p) => {
            const unpl = Object.entries(p.unplanned || {});
            const used = (p.months || []).reduce((a, m) => a + (m.used || 0), 0);
            const cap = p.capacityVisits || 0;
            const cov = pct(p.covered, p.eligible);
            return (
              <tr key={p.key}>
                <td className="ap-act">
                  <span className="ap-act-name" title={p.activity}>{p.activity}</span>
                  <span className="ap-sub">{p.officeName || tr('Sans bureau')}{p.general ? ` · ${tr('plan général')}` : ''}{p.mode === 'non_planifiable' ? ` · ${tr('ne tourne pas (durée 0)')}` : ''}</span>
                </td>
                {needsMode ? (
                  <>
                    <td className="num">{formatInt(p.eligible || 0)}</td>
                    <td className="num">{p.perSite ? tr('{v} / site · {g} mois', { v: p.perSite, g: p.gap ?? '—' }) : '—'}</td>
                    <td className="num">{formatInt(p.doneYear || 0)}</td>
                    <td className="num"><strong>{formatInt(p.generatedVisits || 0)}</strong></td>
                    <td className="num">{formatInt(p.laterVisits || 0)} · {formatInt(p.unmet || 0)}</td>
                  </>
                ) : (
                  <>
                    <td className="num"><strong>{formatInt(p.generatedVisits || 0)}</strong></td>
                    <td><Bar value={used} max={cap} label={cap ? `${formatInt(used)} / ${formatInt(cap)}` : tr('aucune capacité')} tone={cap && used >= cap ? 'warn' : 'ok'} /></td>
                    <td>{p.eligible ? <Bar value={p.covered} max={p.eligible} label={`${cov} %`} tone={cov >= 80 ? 'ok' : 'warn'} /> : <span className="muted">—</span>}</td>
                  </>
                )}
                <td><div className="ap-reasons">{unpl.length ? unpl.map(([code, n]) => <ReasonCount key={code} code={code} n={n} />) : <span className="muted">—</span>}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WarningLine({ w }) {
  return (
    <div role="listitem" className={`ap-warning is-${w.tone}`}>
      {w.tone === 'warn' ? <AlertTriangle size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
      <span>{w.text}{w.href && <> <a href={w.href} className="ap-link">{w.link} <ExternalLink size={12} aria-hidden="true" /></a></>}</span>
    </div>
  );
}

function Tile({ label, value, foot, tone: tn, strong }) {
  return (
    <div className={`ap-tile ${strong ? 'is-strong' : ''} ${tn ? `is-${tn}` : ''}`}>
      <span className="ap-tile-label">{label}</span>
      <span className="ap-tile-value">{value}</span>
      {foot && <span className="ap-tile-foot">{foot}</span>}
    </div>
  );
}

function Bar({ value, max, label, tone: tn = 'ok', mark }) {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="ap-bar" title={label}>
      <div className="ap-bar-track" aria-hidden="true">
        <div className={`ap-bar-fill is-${tn}`} style={{ width: `${w}%` }} />
        {mark != null && <div className="ap-bar-mark" style={{ left: `${Math.min(100, mark)}%` }} />}
      </div>
      <span className="ap-bar-label">{label}</span>
    </div>
  );
}

function ReasonList({ code, result, year }) {
  const { tr } = useI18n();
  const rows = result.unplanned.filter((u) => u.code === code);
  const shown = rows.slice(0, 60);
  return (
    <div className="ap-reason-list">
      <ul>
        {shown.map((u) => {
          const s = result.sites[u.siteId] || {};
          return (
            <li key={u.siteId}>
              <span className="ap-site">{s.name || '—'} <span className="ap-id">{s.publicId || s.code}</span></span>
              <span className="ap-place">{[s.commune, s.district].filter(Boolean).join(' · ')}{s.activity ? ` · ${s.activity}` : ''}</span>
              <span className="ap-reason-text">{postponeText(u, tr, (m) => monthLabel(m), year)}</span>
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length && <p className="ap-help">{tr('… et {n} autre(s).', { n: formatInt(rows.length - shown.length) })}</p>}
    </div>
  );
}

function ProposalSample({ result, monthName }) {
  const { tr } = useI18n();
  const nameOf = (id) => (result.sites[id] || {}).name || null;
  const byMonth = new Map();
  for (const p of result.proposals) { if (!byMonth.has(p.month)) byMonth.set(p.month, []); byMonth.get(p.month).push(p); }
  if (!result.proposals.length) return <p className="muted">{tr('Aucune.')}</p>;
  return (
    <div className="ap-months">
      {[...byMonth.entries()].map(([m, list]) => {
        const tours = (result.tours.find((x) => x.month === m) || { tours: [] }).tours;
        return (
          <details key={m} className="ap-month">
            <summary><strong>{monthName(m)}</strong> · {tr('{n} visite(s)', { n: formatInt(list.length) })} · {tr('{t} tournée(s)', { t: formatInt(tours.length) })}</summary>
            <ul className="ap-tours">
              {tours.map((tour) => (
                <li key={tour.no}><Route size={13} aria-hidden="true" /> {tr('Tournée {n} — {d} : {c} commune(s), {j} journée(s), {v} visite(s)', { n: tour.no, d: tour.district, c: tour.communes, j: tour.days, v: tour.visits })}</li>
              ))}
            </ul>
            <ul className="ap-props">
              {list.slice(0, 40).map((p) => {
                const s = result.sites[p.siteId] || {};
                return (
                  <li key={`${p.siteId}|${p.month}`}>
                    <ReasonBadge meta={WHY[p.why]} />
                    <span className="ap-site">{s.name || '—'} <span className="ap-id">{s.publicId || s.code}</span></span>
                    <span className="ap-reason-text">{proposalText(p, tr, nameOf)}{p.date ? ` · ${p.date.slice(8, 10)}/${p.date.slice(5, 7)}` : ''}</span>
                  </li>
                );
              })}
              {list.length > 40 && <li className="ap-help">{tr('… et {n} autre(s) : voir dans la grille.', { n: formatInt(list.length - 40) })}</li>}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
