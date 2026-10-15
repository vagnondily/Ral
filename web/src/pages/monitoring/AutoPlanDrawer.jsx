import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownCircle, ArrowLeft, Ban, CalendarClock, CalendarOff, CalendarX, CheckCircle2, CircleDot, Clock,
  ExternalLink, FastForward, Gauge, HelpCircle, Info, Layers, ListChecks, Lock, MapPin, PauseCircle, Route, Settings2,
  ShieldAlert, Target, Timer, Wand2,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Field } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { WHY, POSTPONE, LEVELS, countByReason, pct, postponeText, proposalText, defaultHorizon } from '../../lib/planGen.js';
import './autoPlan.css';

/**
 * « Planification automatique » du Plan de suivi (lot 5) : période et périmètre, critères
 * (repris des paramètres enregistrés, ajustables pour CET aperçu seulement), aperçu calculé
 * par le serveur (rien n'est écrit), puis « Voir dans la grille » (propositions cochées
 * « proposé », à décocher avant d'appliquer) ou « Appliquer » directement. Les raisons
 * viennent du serveur en codes ; elles sont affichées couleur + icône + libellé.
 */
export const REASON_ICONS = {
  urgent: AlertTriangle, due: CalendarClock, place: MapPin, commune: Layers, district: Route, coverage: Target, ahead: FastForward,
  capacity: Gauge, days: Clock, year: CalendarX, interval: Timer, covered: CheckCircle2, low: ArrowDownCircle, calendar: CalendarOff,
  inactive: PauseCircle, forbidden: ShieldAlert, cancelled: Ban, unknown: HelpCircle,
};
export const LEVEL_ICONS = { haute: AlertTriangle, moyenne: CircleDot, basse: ArrowDownCircle };
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const tone = (t) => (t === 'gray' ? undefined : t);
const CONFIG_HASH = '#/processus/rbm/configuration/planification';
const NUM_LABEL = {
  minMonthsSinceVisit: 'Non visités depuis au moins (mois)', coverageTargetPct: 'Part minimale de sites couverts (%)',
  defaultVisitsPerDay: 'Suivis par jour et par agent', capacityMarginPct: 'Part de la capacité MMR utilisée (%)',
  travelDaysPerTour: 'Jours de déplacement par tournée', urgentMinGapMonths: 'Écart minimal pour un site urgent (mois)', anticipationMonths: 'Anticipation (mois)',
};
const SITES_HASH = '#/processus/rbm/sites';

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

export default function AutoPlanDrawer({ year, activities = [], districts = [], onClose, onShowInGrid, onApplied }) {
  const { tr } = useI18n();
  const toast = useToast();
  const horizon = defaultHorizon(year);
  const [saved, setSaved] = useState(null);
  const [offices, setOffices] = useState([]);
  const [scope, setScope] = useState({ from: horizon ? horizon.from : 1, to: 12, officeId: '', activity: '', district: '' });
  const [crit, setCrit] = useState(null);
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
    api.planSettings().then((s) => { setSaved(s); setCrit({ ...s.settings, levels: [...s.settings.levels] }); }).catch((e) => setError(e.message));
    api.listOffices().then((o) => setOffices(o.filter((x) => x.active))).catch(() => setOffices([]));
  }, []);

  const overrides = useMemo(() => {
    if (!saved || !crit) return {};
    const out = {};
    for (const k of Object.keys(saved.settings)) if (JSON.stringify(crit[k]) !== JSON.stringify(saved.settings[k])) out[k] = crit[k];
    return out;
  }, [saved, crit]);
  const body = { year, from: Number(scope.from), to: Number(scope.to), officeId: scope.officeId || null, activity: scope.activity || null, district: scope.district || null, params: overrides };
  const pastYear = !horizon;
  const invalid = pastYear || body.from > body.to || !crit || !crit.levels.length;

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
      subtitle={tr('Exercice {y} — visites proposées d\'après le RBM, le MMR et vos critères. Rien n\'est enregistré avant « Appliquer ».', { y: String(year) })}
      footer={footer}>
      <div ref={anchor} className="ap-root">
        {error && <Alert tone="danger" icon={AlertTriangle}>{error}</Alert>}
        {step === 'criteria' ? (
          <CriteriaForm year={year} scope={scope} setScope={setScope} crit={crit} setCrit={setCrit} saved={saved} overrides={overrides}
            offices={offices} activities={activities} districts={districts} pastYear={pastYear} monthName={monthName} />
        ) : (
          <PreviewView result={result} year={year} monthName={monthName} overrides={overrides} />
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- Critères */
function CriteriaForm({ year, scope, setScope, crit, setCrit, saved, overrides, offices, activities, districts, pastYear, monthName }) {
  const { t, tr } = useI18n();
  const now = new Date();
  const thisMonth = now.getFullYear() === year ? now.getMonth() + 1 : 1;
  const set = (k, v) => setCrit((c) => ({ ...c, [k]: v }));
  const mark = (k) => (overrides[k] !== undefined ? <span className="ap-adjusted" title={tr('Ajusté pour cet aperçu (non enregistré)')}>{tr('ajusté')}</span> : null);
  const num = (k, { min, max, step = 1 }, help) => (
    <>
      <input className="input ap-num" type="number" min={min} max={max} step={step} value={crit[k]} aria-label={tr(NUM_LABEL[k] || k)}
        onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
      {help && <span className="ap-help">{help}</span>}
    </>
  );
  const presets = [
    [tr('Ce mois'), thisMonth, thisMonth], [tr('Mois prochain'), Math.min(thisMonth + 1, 12), Math.min(thisMonth + 1, 12)], [tr('Reste de l\'exercice'), thisMonth, 12],
  ];
  if (pastYear) return <Alert tone="info" icon={Info}>{tr('Exercice passé : il n\'y a plus de mois à planifier. Choisissez l\'exercice en cours ou le suivant.')}</Alert>;
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
      </section>

      <section className="ap-section" aria-labelledby="ap-crit">
        <div className="ap-h-row">
          <h3 id="ap-crit" className="ap-h">{tr('Critères')}</h3>
          <a className="ap-link" href={CONFIG_HASH}><Settings2 size={14} aria-hidden="true" /> {tr('Paramètres enregistrés')}</a>
        </div>
        <p className="ap-help ap-hint">{tr('Repris des paramètres de la planification ; une modification ici ne vaut que pour cet aperçu.')}</p>
        {!crit ? <p className="muted">{tr('Chargement…')}</p> : (
          <div className="ap-crit">
            <div className="ap-row">
              <span className="ap-label">{tr('Objectif')} {mark('objective')}</span>
              <div className="segmented" role="radiogroup" aria-label={tr('Objectif')}>
                {[['auto', tr('Automatique')], ['mmr_complet', tr('MMR complet')], ['couverture', tr('Couverture minimale')]].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={crit.objective === v} aria-pressed={crit.objective === v} onClick={() => set('objective', v)}>{l}</button>
                ))}
              </div>
              <span className="ap-help">{crit.objective === 'auto' ? tr('Toutes les visites du MMR si la capacité le permet, sinon l\'intervalle ajusté à la capacité.')
                : crit.objective === 'mmr_complet' ? tr('Revisiter chaque site à l\'intervalle du MMR (durée ÷ risque).') : tr('Une visite par site sur l\'exercice, au moins la part ci-dessous.')}</span>
            </div>
            <div className="ap-row">
              <span className="ap-label">{tr('Priorités retenues')} {mark('levels')}</span>
              <div className="ap-levels">
                {Object.entries(LEVELS).map(([k, l]) => {
                  const Icon = LEVEL_ICONS[k];
                  const on = crit.levels.includes(k);
                  return (
                    <label key={k} className={`ap-level ap-level-${l.tone} ${on ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={(e) => set('levels', e.target.checked ? Object.keys(LEVELS).filter((x) => x === k || crit.levels.includes(x)) : crit.levels.filter((x) => x !== k))} />
                      <Icon size={14} aria-hidden="true" /> {t(`priority.${l.label}`, l.label)}
                    </label>
                  );
                })}
              </div>
              <span className="ap-help">{tr('Niveaux des Priorités du mois (score de risque et retard de visite) ; les recommandations urgentes passent toujours en premier.')}</span>
              {!crit.levels.length && <p className="field-error">{tr('Choisissez au moins un niveau.')}</p>}
            </div>
            <div className="ap-grid2">
              <Field label={<>{tr('Non visités depuis au moins (mois)')} {mark('minMonthsSinceVisit')}</>}>{num('minMonthsSinceVisit', { min: 0, max: 24 }, tr('0 = l\'intervalle du MMR suffit.'))}</Field>
              <Field label={<>{tr('Part minimale de sites couverts (%)')} {mark('coverageTargetPct')}</>}>{num('coverageTargetPct', { min: 1, max: 100 }, tr('Sur l\'exercice ; les visites déjà faites comptent.'))}</Field>
              <Field label={<>{tr('Suivis par jour et par agent')} {mark('defaultVisitsPerDay')}</>}>{num('defaultVisitsPerDay', { min: 0.5, max: 10, step: 0.5 }, tr('Quand la colonne « Suivis/j » du MMR est vide.'))}</Field>
              <Field label={<>{tr('Journée regroupée par')} {mark('dayGrouping')}</>}>
                <select className="select" value={crit.dayGrouping} onChange={(e) => set('dayGrouping', e.target.value)}>
                  <option value="lieu">{tr('Même lieu')}</option><option value="commune">{tr('Même commune')}</option><option value="district">{tr('Même district')}</option>
                </select>
              </Field>
            </div>
            <div className="ap-checks">
              <label className="check"><input type="checkbox" checked={crit.coverageCatchUp} onChange={(e) => set('coverageCatchUp', e.target.checked)} /> {tr('Rattraper les sites pas encore suivis sur l\'exercice')} {mark('coverageCatchUp')}</label>
              <label className="check"><input type="checkbox" checked={crit.multiActivityDays} onChange={(e) => set('multiActivityDays', e.target.checked)} /> {tr('Plusieurs activités dans la même journée')} {mark('multiActivityDays')}</label>
              <label className="check"><input type="checkbox" checked={crit.fillDistrict} onChange={(e) => set('fillDistrict', e.target.checked)} /> {tr('Compléter la tournée dans le district')} {mark('fillDistrict')}</label>
            </div>
            <details className="ap-more">
              <summary>{tr('Plus de critères')}</summary>
              <div className="ap-grid2">
                <Field label={<>{tr('Part de la capacité MMR utilisée (%)')} {mark('capacityMarginPct')}</>}>{num('capacityMarginPct', { min: 10, max: 200 })}</Field>
                <Field label={<>{tr('Jours de déplacement par tournée')} {mark('travelDaysPerTour')}</>}>{num('travelDaysPerTour', { min: 0, max: 10 })}</Field>
                <Field label={<>{tr('Écart minimal pour un site urgent (mois)')} {mark('urgentMinGapMonths')}</>}>{num('urgentMinGapMonths', { min: 1, max: 12 })}</Field>
                <Field label={<>{tr('Anticipation (mois)')} {mark('anticipationMonths')}</>}>{num('anticipationMonths', { min: 0, max: 6 }, tr('Compléter une journée déjà prévue avec un site dû bientôt ; 0 = non.'))}</Field>
                <Field label={<>{tr('Ligne du plan général du MMR')} {mark('generalRowMode')}</>}>
                  <select className="select" value={crit.generalRowMode} onChange={(e) => set('generalRowMode', e.target.value)}>
                    <option value="par_bureau">{tr('Modèle appliqué à chaque bureau')}</option><option value="commune">{tr('Une capacité commune')}</option>
                  </select>
                </Field>
              </div>
            </details>
            {Object.keys(overrides).length > 0 && saved && (
              <button type="button" className="link-btn ap-reset" onClick={() => setCrit({ ...saved.settings, levels: [...saved.settings.levels] })}>{tr('Revenir aux paramètres enregistrés')}</button>
            )}
          </div>
        )}
      </section>

      <section className="ap-section ap-rules" aria-labelledby="ap-rules">
        <h3 id="ap-rules" className="ap-h">{tr('Toujours respecté')}</h3>
        <ul>
          <li><Lock size={13} aria-hidden="true" /> {tr('Un site inactif ce mois-là n\'est jamais planifié (grille Sites actifs / inactifs).')}</li>
          <li><Lock size={13} aria-hidden="true" /> {tr('Zones interdites, visites annulées, visites déjà prévues ou réalisées : jamais touchées.')}</li>
          <li><Lock size={13} aria-hidden="true" /> {tr('Capacité du MMR par activité et par bureau (visites par mois, journées-agent).')}</li>
          <li><Lock size={13} aria-hidden="true" /> {tr('Prestataire (TPM) : celui du contrat de la zone, attribué à l\'enregistrement.')}</li>
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- Aperçu */
function warningText(w, tr, { monthName, poolName, year }) {
  switch (w.code) {
    case 'statut_non_renseigne':
      return { tone: 'warn', text: tr('{n} site(s) sans statut en {m} : non planifiés (la grille {y} est ouverte) — renseignez-les dans Sites (actifs / inactifs).', { n: formatInt(w.count), m: monthName(Number(String(w.month).slice(5, 7))), y: String(w.year || year) }), href: SITES_HASH, link: tr('Ouvrir Sites (actifs / inactifs)') };
    case 'grille_inconnue': return { tone: 'info', text: tr('Aucune grille d\'activation pour {y} : tous les sites du registre comptent comme actifs.', { y: String(year) }), href: SITES_HASH, link: tr('Ouvrir Sites (actifs / inactifs)') };
    case 'sans_mmr': return { tone: 'warn', text: tr('{n} site(s) dont l\'activité est absente du MMR : non planifiés.', { n: formatInt(w.count) }) };
    case 'mmr_sites_ecart': return { tone: 'info', text: tr('{a} : {t} site(s) saisi(s) au MMR, {r} au registre — la capacité est rapportée aux sites du registre.', { a: w.activity, t: formatInt(w.typed), r: formatInt(w.registry) }) };
    case 'sans_calendrier': return { tone: 'info', text: tr('Sans calendrier d\'activité : chaque mois au plus le « faisable » du MMR, et au plus faisable × durée sur l\'exercice.') };
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
  const poolLabel = new Map(result.pools.map((p) => [p.key, `${p.activity}${p.officeName ? ` — ${p.officeName}` : ''}`]));
  const poolName = (k) => poolLabel.get(k) || k;
  // Avertissements (à traiter) en clair ; notes de calcul (information) repliées. Les écarts
  // « sites saisis au MMR ≠ registre » tiennent en une ligne, le détail est dans les notes.
  const gaps = result.warnings.filter((w) => w.code === 'mmr_sites_ecart');
  const shown = result.warnings.filter((w) => w.code !== 'mmr_sites_ecart').map((w) => warningText(w, tr, { monthName, poolName, year }));
  const warnings = shown.filter((w) => w.tone === 'warn');
  const notes = shown.filter((w) => w.tone !== 'warn');
  if (gaps.length) notes.push({ tone: 'info', text: tr('{n} ligne(s) MMR : nombre de sites saisi différent du registre (écart > 10 %) — la capacité est rapportée aux sites du registre.', { n: gaps.length }) });
  for (const g of gaps) notes.push(warningText(g, tr, { monthName, poolName, year }));
  const reasons = countByReason(result.unplanned);
  const share = pct(t.covered, t.eligible);
  const period = result.fromMonth === result.toMonth ? monthName(result.fromMonth) : tr('{a} à {b}', { a: monthName(result.fromMonth), b: monthName(result.toMonth) });
  return (
    <div className="ap-preview">
      <p className="ap-period-line">
        <CalendarClock size={15} aria-hidden="true" /> {period}
        {Object.keys(overrides).length > 0 && <Badge tone="orange">{tr('critères ajustés pour cet aperçu')}</Badge>}
      </p>
      <div className="ap-tiles">
        <Tile label={tr('Visites proposées')} value={formatInt(t.proposals)} foot={tr('{n} site(s)', { n: formatInt(t.sitesPlanned) })} strong />
        <Tile label={tr('Couverture projetée')} value={share == null ? '—' : `${share} %`} foot={tr('{c} / {e} sites · objectif {o}', { c: formatInt(t.covered), e: formatInt(t.eligible), o: formatInt(t.target) })}
          tone={t.eligible ? (t.meetsTarget ? 'ok' : 'warn') : null} />
        <Tile label={tr('Journées-agent')} value={formatInt(t.journees)} foot={t.visitsPerDay == null ? '—' : tr('{v} visite(s) par journée', { v: String(t.visitsPerDay).replace('.', ',') })} />
        <Tile label={tr('Tournées')} value={formatInt(t.tours)} foot={tr('district × mois')} />
        <Tile label={tr('Non planifiés')} value={formatInt(t.unplanned)} foot={tr('sites du périmètre')} />
      </div>
      {t.proposals === 0 && <Alert tone="info" icon={Info}>{tr('Aucune visite à proposer avec ces critères : voyez ci-dessous pourquoi les sites ne sont pas planifiés.')}</Alert>}
      {warnings.length > 0 && (
        <div className="ap-warnings" role="list">
          {warnings.map((w, i) => <WarningLine key={i} w={w} />)}
        </div>
      )}
      {(notes.length > 0 || t.rbmDueGated > 0) && (
        <details className="ap-notes">
          <summary><Info size={14} aria-hidden="true" /> {tr('Notes de calcul ({n})', { n: notes.length + (t.rbmDueGated > 0 ? 1 : 0) })}</summary>
          <div className="ap-warnings" role="list">
            {t.rbmDueGated > 0 && <WarningLine w={{ tone: 'info', text: tr('{n} site(s) « à suivre » dans les Priorités du mois attendent l\'intervalle du MMR (intervalle de revisite du plan).', { n: formatInt(t.rbmDueGated) }) }} />}
            {notes.map((w, i) => <WarningLine key={i} w={w} />)}
          </div>
        </details>
      )}

      <h3 className="ap-h">{tr('Par activité et par bureau')}</h3>
      <div className="table-wrap ap-table-wrap">
        <table className="table ap-table">
          <thead><tr>
            <th scope="col">{tr('Activité et bureau')}</th>
            <th scope="col" className="num" title={tr('Sites du périmètre retenus au moins un mois (dus, urgents ou à rattraper)')}>{tr('Sites dus')}</th>
            <th scope="col" className="num">{tr('Proposées')}</th>
            <th scope="col" title={tr('Visites (existantes + proposées) face à la capacité MMR de la période')}>{tr('Capacité utilisée')}</th>
            <th scope="col" title={tr('Sites couverts sur l\'exercice (projection) face à l\'objectif')}>{tr('Couverture projetée')}</th>
            <th scope="col">{tr('Non planifiables')}</th>
          </tr></thead>
          <tbody>
            {result.pools.map((p) => {
              const used = p.months.reduce((a, m) => a + (m.used || 0), 0);
              const cap = p.capacityVisits || 0;
              const cov = pct(p.covered, p.eligible);
              const target = p.targetPct;
              const unpl = Object.entries(p.unplanned || {});
              return (
                <tr key={p.key}>
                  <td className="ap-act">
                    <span className="ap-act-name" title={p.activity}>{p.activity}</span>
                    <span className="ap-sub">{p.officeName || tr('Sans bureau')}{p.general ? ` · ${tr('plan général')}` : ''} · {p.mode === 'non_planifiable' ? tr('ne tourne pas (durée 0)') : p.mode === 'couverture' ? tr('une visite par site') : tr('intervalle {g} mois', { g: p.gateDue })}{p.mode === 'ajuste' ? ` · ${tr('ajusté à la capacité')}` : ''}</span>
                  </td>
                  <td className="num">{formatInt(p.dueSites || 0)}</td>
                  <td className="num"><strong>{formatInt(p.generatedVisits || 0)}</strong></td>
                  <td><Bar value={used} max={cap} label={cap ? `${formatInt(used)} / ${formatInt(cap)}` : tr('aucune capacité')} tone={cap && used >= cap ? 'warn' : 'ok'} /></td>
                  <td>{p.eligible ? <Bar value={p.covered} max={p.eligible} mark={target} label={`${cov} % · ${tr('objectif {o} %', { o: target })}`} tone={p.meetsTarget ? 'ok' : 'warn'} /> : <span className="muted">—</span>}</td>
                  <td><div className="ap-reasons">{unpl.length ? unpl.map(([code, n]) => <ReasonCount key={code} code={code} n={n} />) : <span className="muted">—</span>}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
          {openCode && <ReasonList code={openCode} result={result} year={year} monthName={monthName} />}
        </div>
      )}

      <h3 className="ap-h">{tr('Propositions')}</h3>
      <ProposalSample result={result} monthName={monthName} />
      <p className="ap-help">{tr('Projection : une visite planifiée compte comme faite pour les mois suivants de l\'aperçu seulement. Ailleurs, une visite seulement planifiée ne rend jamais un site « à jour ».')}</p>
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

function ReasonList({ code, result, year, monthName }) {
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
                    <span className="ap-reason-text">{proposalText(p, tr, nameOf)}</span>
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
