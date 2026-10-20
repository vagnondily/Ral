import React, { useEffect, useState } from 'react';
import { CalendarSearch, Link2, ListChecks, SlidersHorizontal, Sparkles } from 'lucide-react';
import { api } from '../../../api/client.js';
import { fetchMapDistricts } from '../../../components/map/useMapData.js';
import { activityCoverage, groupCoverage, lastDataMonth, zoneCoverage } from '../../../lib/coverageView.js';
import { formatInt, monthLabel } from '../../../lib/format.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { PAGES, activityName, activityQuery } from './activityMeta.js';
import { PageHead } from './OverviewView.jsx';
import { EmptyNote } from './parts.jsx';
import { SynthesisPage, PerformancePage, BulletinPage } from './ActivitySynthesis.jsx';
import { ControlRoomPage, QualityPage } from './ActivityIndicators.jsx';
import { MapPage, IntegrityPage, AgentsPage } from './ActivityField.jsx';
import HelpPage from './HelpPage.jsx';

/**
 * Une activité (onglet de la maquette) : menu des pages à gauche, page à droite. Chaque page
 * annonce son public (« Management / Bailleurs », « Analystes »…), comme la maquette.
 * Données : l'activité mise en forme par le serveur (perf.activities) ; sa couverture = les mesures
 * communes (GET /api/dashboards/coverage FILTRÉ sur l'activité : univers, suivis, bureaux — retour
 * 110), en attendant la ligne de l'activité dans la réponse de la page ; les signaux de sites lus
 * dans la réponse de la carte filtrée (celle que la carte de la page dessine) ; la tendance
 * mensuelle et les agents chargés à la demande (pages qui les montrent).
 */

const TREND_PAGES = new Set(['synthese', 'performance', 'bulletin']);

export default function ActivityView({ activity: a, period, periods, officeId, covAll, page, onPage, onPick, onNavigate, onOpenMap }) {
  const { tr } = useI18n();
  const current = PAGES.find((p) => p.id === page) || PAGES[0];
  const hasForms = a.forms.length > 0;
  const q = activityQuery(a);
  const periodKey = period ? `${period.from}|${period.to}` : '';

  // Couverture de l'activité (mesures communes, par bureau compris) et signaux de sites (carte filtrée,
  // même cache que la carte de la page).
  const [covAct, setCovAct] = useState(undefined);
  const [mapAct, setMapAct] = useState(undefined);
  useEffect(() => {
    if (!period || !a.category) { setCovAct(null); setMapAct(null); return undefined; }
    let alive = true;
    api.dashCoverage(period, { officeId, activity: a.category }).then((d) => { if (alive) setCovAct(d); }, () => { if (alive) setCovAct(null); });
    fetchMapDistricts(period, { officeId, activity: a.category }).then((d) => { if (alive) setMapAct(d); }, () => { if (alive) setMapAct(null); });
    return () => { alive = false; };
  }, [periodKey, officeId, a.category]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tendance mensuelle et agents : à la demande, gardés tant que l'activité et les filtres ne changent pas.
  const [trend, setTrend] = useState({ key: null, data: null, error: null });
  const [agents, setAgents] = useState({ key: null, data: null, error: null });
  const dataKey = `${periodKey}|${officeId || ''}|${a.key}`;
  useEffect(() => {
    if (!period || !hasForms || !TREND_PAGES.has(current.id) || trend.key === dataKey) return undefined;
    let alive = true;
    api.dashPerformanceTrend(period, { officeId, ...q }).then((d) => { if (alive) setTrend({ key: dataKey, data: d, error: null }); },
      (e) => { if (alive) setTrend({ key: dataKey, data: null, error: e.message }); });
    return () => { alive = false; };
  }, [dataKey, current.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!period || !hasForms || current.id !== 'agents' || agents.key === dataKey) return undefined;
    let alive = true;
    api.dashPerformanceAgents(period, { officeId, ...q }).then((d) => { if (alive) setAgents({ key: dataKey, data: d, error: null }); },
      (e) => { if (alive) setAgents({ key: dataKey, data: null, error: e.message }); });
    return () => { alive = false; };
  }, [dataKey, current.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cov = covAct ? groupCoverage(covAct.overall) : activityCoverage(covAll, a.category);
  const covLoading = a.category ? (covAct === undefined && !activityCoverage(covAll, a.category)) : false;
  const sites = mapAct ? zoneCoverage(mapAct.totals) : null; // signaux de sites (carte)
  const trendData = trend.key === dataKey ? trend : { data: null, error: null, loading: true };
  const agentsData = agents.key === dataKey ? agents : { data: null, error: null, loading: true };
  const gate = dataGate({ a, periods, period, tr, onPick, onNavigate });
  const ctx = { a, cov, covLoading, covAct, sites, period, officeId, gate, trend: trendData, agents: agentsData, onNavigate, onOpenMap, onPage };
  const name = activityName(a, tr);

  return (
    <div className="cvt-act">
      <nav className="cvt-side" aria-label={tr('Pages de l\'activité')}>
        <div className="cvt-side-lbl">{tr('Pages')}</div>
        {PAGES.map((p) => (
          <button key={p.id} type="button" className={`cvt-pbtn${current.id === p.id ? ' is-active' : ''}`} aria-current={current.id === p.id ? 'page' : undefined}
            onClick={() => onPage(p.id)}>
            <p.icon size={17} aria-hidden="true" />{tr(p.label)}
          </button>
        ))}
      </nav>
      <div className="cvt-view">
        <PageHead icon={current.icon} title={tr(current.label)} audience={`${name} · ${tr(current.audience)}`} />
        {a.category && <div className="cvt-act-cat">{tr('Activité MEMS : {c}', { c: a.category })}</div>}
        {current.id === 'synthese' && <SynthesisPage {...ctx} />}
        {current.id === 'controle' && <ControlRoomPage {...ctx} />}
        {current.id === 'carte' && <MapPage {...ctx} />}
        {current.id === 'performance' && <PerformancePage {...ctx} />}
        {current.id === 'bulletin' && <BulletinPage {...ctx} />}
        {current.id === 'qualite' && <QualityPage {...ctx} />}
        {current.id === 'integrite' && <IntegrityPage {...ctx} />}
        {current.id === 'agents' && <AgentsPage {...ctx} />}
        {current.id === 'aide' && <HelpPage {...ctx} />}
      </div>
    </div>
  );
}

/**
 * Pourquoi les blocs d'indicateurs d'une activité seraient vides — et quoi faire. Rend null
 * quand il y a des visites et des indicateurs ; sinon la note à afficher à leur place :
 *   aucune fiche rattachée → rattacher une fiche (Données & indicateurs) ;
 *   fiches sans indicateur → configurer, ou appliquer le modèle de l'activité ;
 *   aucune visite sur la période → dernier mois avec des données (« Voir … »).
 */
function dataGate({ a, periods, period, tr, onPick, onNavigate }) {
  const go = (formId, tab) => onNavigate && onNavigate('processus', 'donnees', formId, tab);
  if (!a.forms.length) {
    return (
      <EmptyNote icon={Link2} title={tr('Aucune fiche de suivi n\'est rattachée à cette activité')}
        action={onNavigate && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate('processus', 'donnees')}><Link2 size={14} aria-hidden="true" />{tr('Rattacher une fiche')}</button>}>
        {a.templateKey
          ? tr('Un modèle d\'indicateurs existe pour cette activité : rattachez la fiche qui reçoit ses formulaires (Données & indicateurs › la fiche › Activité), puis appliquez le modèle.')
          : tr('Rattachez la fiche qui reçoit les formulaires de cette activité (Données & indicateurs › la fiche › Activité) : ses indicateurs alimenteront ce tableau de bord.')}
      </EmptyNote>
    );
  }
  if (!a.indicatorCount) {
    return (
      <EmptyNote icon={ListChecks} title={tr('Aucun indicateur n\'est encore configuré pour cette activité')}
        action={onNavigate && a.forms.map((f) => (
          <span key={f.id} className="cvt-gate-form">
            <b>{f.label}</b>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => go(f.id, 'config')}><SlidersHorizontal size={14} aria-hidden="true" />{tr('Configurer les indicateurs')}</button>
            {a.templateKey && <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(f.id, 'modele')}><Sparkles size={14} aria-hidden="true" />{tr('Appliquer le modèle d\'activité')}</button>}
          </span>
        ))}>
        {a.visits.n > 0
          ? tr('Les données arrivent ({n} visite(s) sur la période), mais aucun indicateur ne les transforme encore en résultats : indice, modules et points forts apparaîtront dès qu\'un indicateur sera défini.', { n: formatInt(a.visits.n) })
          : tr('Aucun indicateur ne transforme encore les données de cette activité en résultats : indice, modules et points forts apparaîtront dès qu\'un indicateur sera défini.')}
      </EmptyNote>
    );
  }
  if (!a.visits.n) {
    const last = lastDataMonth(periods, a.forms.map((f) => f.id));
    const outside = last && period && (last < period.from || last > period.to);
    return (
      <EmptyNote icon={CalendarSearch} title={tr('Aucune visite de cette activité sur la période')}
        action={outside && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick(last)}>{tr('Voir {m}', { m: monthLabel(last) })}</button>}>
        {last ? tr('Dernières données de cette activité : {m}.', { m: monthLabel(last) }) : tr('Aucune donnée reçue pour cette activité.')}
      </EmptyNote>
    );
  }
  return null;
}
