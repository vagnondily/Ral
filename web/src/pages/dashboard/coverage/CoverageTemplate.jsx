import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Info, LayoutGrid } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Skeleton } from '../../../components/ui.jsx';
import { PeriodBanner, SessionPeriodNote } from '../../../components/PeriodBanner.jsx';
import MapExplorer from '../../../components/map/MapExplorer.jsx';
import { fetchMapDistricts } from '../../../components/map/useMapData.js';
import { isTabActivity, activityKeyOf } from '../../../lib/coverageView.js';
import { monthLabel } from '../../../lib/format.js';
import { periodLabel, single } from '../../../lib/period.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { activityIcon, activityName, tabIdOf } from './activityMeta.js';
import OverviewView from './OverviewView.jsx';
import ActivityView from './ActivityView.jsx';
import './coverage.css';

/**
 * « Couverture & performance du suivi » — le tableau de bord de la maquette de l'utilisateur
 * (retours 40, 66, 67, 85), section par section, rempli par MEMS :
 *   en-tête   période commune (PeriodSelect de la page) et bureau (avec ses antennes) ;
 *   onglets   Vue d'ensemble + une activité par onglet — activités tirées de MEMS (fiches de
 *             suivi et registre des sites), jamais une liste codée en dur ;
 *   pages     d'une activité : Synthèse, Salle de contrôle, Carte, Performance, Bulletin,
 *             Qualité, Contrôle, Agents, Aide (menu de gauche, comme la maquette).
 * Sources : GET /api/dashboards/performance (indicateurs et visites, même calcul que les
 * Résultats et le concepteur) et GET /api/dashboards/coverage (retour 110 : univers = sites actifs
 * de la période, « suivi » = visite déclarée OU données reçues — la même réponse que la Synthèse
 * du suivi de processus, et la même couverture que la carte) ; /api/map/districts pour la carte,
 * la liste des bureaux et les signaux de sites.
 * Un rechargement garde l'écran précédent atténué (aucun saut de mise en page).
 */

const TAB_KEY = 'mems.coverage.tab';
const PAGE_KEY = 'mems.coverage.page';
const OFFICE_KEY = 'mems.coverage.office';
const session = () => { try { return window.sessionStorage; } catch { return null; } };
const readSession = (k) => { try { const s = session(); return s ? s.getItem(k) : null; } catch { return null; } };
const writeSession = (k, v) => { try { const s = session(); if (!s) return; if (v == null) s.removeItem(k); else s.setItem(k, v); } catch { /* stockage indisponible */ } };

export default function CoverageTemplate({ per, opened = null, onNavigate }) {
  const { tr, lang } = useI18n();
  const { period, ready, auto, source, capped, resetToDefault, periods, setPeriod } = per;
  const [officeId, setOfficeId] = useState(() => (opened && opened.officeId) || readSession(OFFICE_KEY) || null);
  const [tab, setTab] = useState(() => readSession(TAB_KEY) || 'overview');
  const [page, setPage] = useState(() => (opened ? 'carte' : readSession(PAGE_KEY) || 'synthese'));
  // « Ouvrir la carte » (Dashboard › Vue d'ensemble, ou la carte de la vue d'ensemble) : carte complète.
  const [fullMap, setFullMap] = useState(() => (opened && !opened.activity ? { theme: opened.theme || 'coverage' } : null));
  const openedActivity = useRef(opened && opened.activity ? opened : null);
  const [res, setRes] = useState({ key: null, data: null, error: null }); // dernière réponse reçue
  const [mapRes, setMapRes] = useState({ key: null, data: undefined });
  const [covRes, setCovRes] = useState({ key: null, data: undefined }); // mesures de couverture (retour 110)
  const key = period ? `${period.from}|${period.to}|${officeId || ''}` : '';

  useEffect(() => { writeSession(TAB_KEY, tab); }, [tab]);
  useEffect(() => { writeSession(PAGE_KEY, page); }, [page]);
  useEffect(() => { writeSession(OFFICE_KEY, officeId); }, [officeId]);

  useEffect(() => {
    if (!ready || !period) return undefined;
    let alive = true;
    api.dashPerformance(period, { officeId }).then(
      (data) => {
        if (!alive) return;
        setRes({ key, data, error: null });
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      },
      (e) => { if (alive) setRes((r) => ({ key, data: r.data, error: e.message })); },
    );
    // Couverture : les mesures communes (retour 110) ; la carte (cache partagé) pour les bureaux et la carte.
    api.dashCoverage(period, { officeId }).then((data) => { if (alive) setCovRes({ key, data }); }, (e) => { if (alive) setCovRes({ key, data: null, error: e.message }); });
    fetchMapDistricts(period, { officeId }).then((data) => { if (alive) setMapRes({ key, data }); }, () => { if (alive) setMapRes({ key, data: null }); });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const perf = res.data;
  const refreshing = !!perf && res.key !== key;
  // Dernières réponses (gardées pendant un rechargement, comme le reste) ; undefined = en cours, null = échec.
  const mapAll = mapRes.data;
  const covAll = covRes.data;
  const tabs = useMemo(() => (perf ? perf.activities.filter(isTabActivity) : []), [perf]);
  const current = tab === 'overview' ? null : tabs.find((a) => tabIdOf(a) === tab) || null;

  // Lien « Ouvrir la carte » d'une activité : onglet de l'activité, page Carte (une fois).
  useEffect(() => {
    const o = openedActivity.current;
    if (!o || !tabs.length) return;
    openedActivity.current = null;
    const hit = tabs.find((a) => activityKeyOf(a.category) === activityKeyOf(o.activity));
    if (hit) { setTab(tabIdOf(hit)); setPage('carte'); } else setFullMap({ theme: o.theme || 'coverage', activity: o.activity });
  }, [tabs]);
  // Onglet mémorisé disparu (bureau ou période changés) : la vue d'ensemble.
  useEffect(() => { if (perf && tab !== 'overview' && !current) setTab('overview'); }, [perf, tab, current]);

  const offices = (mapAll && mapAll.filtersAvailable && mapAll.filtersAvailable.offices) || [];
  const noData = perf && !auto && perf.overall.visits.n === 0;
  const lastMonth = periods && (periods.default?.month || periods.latestMonth);

  const openActivity = (a, p = 'synthese') => { setFullMap(null); setTab(tabIdOf(a)); setPage(p); window.scrollTo?.({ top: 0 }); };

  return (
    <div className={`cvt${refreshing ? ' is-refreshing' : ''}`} aria-busy={refreshing ? 'true' : undefined}>
      <div className="cd-headbar">
        <div className="cd-headbar-period">
          <PeriodBanner auto={auto} period={period} />
          <SessionPeriodNote source={source} capped={capped} onReset={resetToDefault} />
        </div>
        <label className="cvt-office">
          <span>{tr('Bureau')}</span>
          <select className="select" value={officeId || ''} onChange={(e) => setOfficeId(e.target.value || null)} disabled={!offices.length && !officeId}>
            <option value="">{tr('Tous les bureaux')}</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{`${'   '.repeat(o.depth || 0)}${o.hasChildren ? tr('{name} (et ses antennes)', { name: o.name }) : o.name}`}</option>
            ))}
          </select>
        </label>
      </div>

      {res.error && <Alert tone="error">{res.error}</Alert>}
      {covRes.error && <Alert tone="error">{tr('Mesures de couverture indisponibles : {e}', { e: covRes.error })}</Alert>}
      {noData && (
        <div className="period-banner"><Alert tone="info" icon={Info}>
          {tr('Aucune donnée reçue sur la période ({p}).', { p: periodLabel(period, lang) })}
          {lastMonth && (lastMonth < period.from || lastMonth > period.to) && (
            <>{' '}{tr('Dernières données : {last}.', { last: monthLabel(lastMonth) })}{' '}
              <button type="button" className="inline-link" onClick={() => setPeriod(single(lastMonth))}>{tr('Voir {m}', { m: monthLabel(lastMonth) })}</button></>
          )}
        </Alert></div>
      )}

      {!perf ? (!res.error && <Skeleton height={420} />) : fullMap ? (
        <div className="cvt-fullmap">
          <button type="button" className="btn btn-secondary btn-sm cvt-back" onClick={() => setFullMap(null)}>
            <ArrowLeft size={15} aria-hidden="true" />{tr('Retour au tableau de bord')}
          </button>
          <MapExplorer variant="full" period={period || undefined} onNavigate={onNavigate}
            initial={{ theme: fullMap.theme, officeId, activity: fullMap.activity || null }} />
        </div>
      ) : (
        <>
          <div className="cvt-tabs" role="tablist" aria-label={tr('Activités')}>
            <TabButton id="overview" active={tab === 'overview'} icon={LayoutGrid} label={tr('Vue d\'ensemble')} onClick={() => setTab('overview')} />
            {tabs.map((a) => (
              <TabButton key={tabIdOf(a)} id={tabIdOf(a)} active={tab === tabIdOf(a)} icon={activityIcon(a)} label={activityName(a, tr)}
                title={a.category || undefined} onClick={() => { setTab(tabIdOf(a)); if (!page) setPage('synthese'); }} />
            ))}
          </div>
          {current
            ? <ActivityView key={tabIdOf(current)} activity={current} perf={perf} period={period} periods={periods} officeId={officeId}
                covAll={covAll} page={page} onPage={setPage} onPick={(m) => setPeriod(single(m))} onNavigate={onNavigate}
                onOpenMap={(theme, activity) => setFullMap({ theme: theme || 'coverage', activity: activity || null })} />
            : <OverviewView perf={perf} cov={covAll} period={period} officeId={officeId} tabs={tabs}
                onOpen={openActivity} onOpenMap={(theme) => setFullMap({ theme: theme || 'coverage' })} onNavigate={onNavigate} />}
        </>
      )}
    </div>
  );
}

function TabButton({ id, active, icon: Icon, label, title, onClick }) {
  return (
    <button type="button" role="tab" id={`cvt-tab-${id}`} aria-selected={active} title={title}
      className={`cvt-tab${active ? ' is-active' : ''}`} onClick={onClick}>
      <Icon size={16} aria-hidden="true" />{label}
    </button>
  );
}
