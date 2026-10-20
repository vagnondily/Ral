import React from 'react';
import { Gauge, ClipboardList, Maximize2, Link2, ChevronRight } from 'lucide-react';
import { Badge, STATUS_ICONS } from '../../../components/ui.jsx';
import MapExplorer from '../../../components/map/MapExplorer.jsx';
import CoverageUniverse from '../../../components/CoverageUniverse.jsx';
import ActivityCoverageCard from '../../../components/ActivityCoverageCard.jsx';
import { activityCoverage, groupCoverage, verdictOf, VERDICTS, pctOfRate } from '../../../lib/coverageView.js';
import { periodLabel } from '../../../lib/period.js';
import { waysText } from '../../../lib/coverageDefs.js';
import { formatInt } from '../../../lib/format.js';
import { formatRate } from '../../../lib/mapScale.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { activityIcon, activityName } from './activityMeta.js';
import { ClassBadge, ClassDonut, ClassList, ClassStack, Kpi, Section, EmptyNote } from './parts.jsx';

/**
 * Vue d'ensemble (maquette : « Management / Bailleurs ») :
 *   chiffres clés   couverture globale (sites suivis ÷ univers, retour 110), visites, indice pondéré,
 *                   visites urgentes ; l'univers est énoncé dessous (CoverageUniverse) ;
 *   activités       une tuile par activité : verdict, couverture, indice, classes des visites ;
 *   carte           couverture nationale (la carte du suivi, filtres de la page) ;
 *   répartition     classes de toutes les visites ;
 *   par activité    le tableau partagé avec la Synthèse (ActivityCoverageCard), puis les fiches sans activité.
 */
export default function OverviewView({ perf, cov, period, officeId, tabs, onOpen, onOpenMap, onNavigate }) {
  const { tr, lang } = useI18n();
  const ov = perf.overall;
  const v = ov.visits;
  const total = cov ? groupCoverage(cov.overall) : null;
  const unattached = (ov.unattachedForms || []);
  const covText = (c) => (c && c.rate != null ? formatRate(c.rate, lang) : '—');

  return (
    <div className="cvt-view">
      <PageHead icon={Gauge} title={tr('Vue d\'ensemble')} audience={tr('Management / Bailleurs')} />

      <div className="cvt-kpis">
        <Kpi label={tr('Couverture globale')} value={cov === undefined ? '…' : covText(total)}
          foot={cov === undefined ? tr('chargement…') : !total || !(total.active > 0)
            ? tr('aucun site actif sur la période')
            : <>{tr('{r} / {a} sites actifs suivis · cible 80 %', { r: formatInt(total.realised), a: formatInt(total.active) })}
              {total.realised > 0 && <span className="cov-ways">{waysText(tr, { covered: total.realised, byData: total.byData, byVisit: total.byVisit, both: total.both }, formatInt)}</span>}</>} />
        <Kpi label={tr('Visites')} value={formatInt(v.n)}
          foot={tr('{n} activité(s) avec des données · {na} non évaluée(s)', { n: formatInt(ov.activitiesWithData), na: formatInt(v.classes.na) })} />
        <Kpi label={tr('Indice pondéré')} value={ov.weightedIndex == null ? '—' : String(Math.round(ov.weightedIndex))} unit="/100" band={ov.band}
          foot={ov.weightedIndex == null ? tr('aucune visite notée') : tr('moyenne des activités, pondérée par leurs visites notées')} />
        <Kpi label={tr('Visites urgentes')} value={v.urgentPct == null ? '—' : String(Math.round(v.urgentPct))} unit="%"
          foot={v.scored ? tr('{n} visite(s) notée(s) sous 50 sur {s}', { n: formatInt(v.classes.urg), s: formatInt(v.scored) }) : tr('aucune visite notée')} />
      </div>

      {cov && <CoverageUniverse cov={cov} period={period} onNavigate={onNavigate} />}

      <div className="cvt-tiles">
        {tabs.map((a) => <ActivityTile key={a.key || '_none'} a={a} cov={activityCoverage(cov, a.category)} mapLoading={cov === undefined} onOpen={() => onOpen(a)} />)}
      </div>

      <div className="cvt-row cvt-row-2">
        <Section id="cvt-ov-map" title={tr('Couverture nationale')}
          sub={total ? tr('{n} site(s) actif(s) · couleur = couverture du district (sites suivis ÷ sites actifs)', { n: formatInt(total.active) }) : tr('Couleur = couverture du district (sites suivis ÷ sites actifs)')}
          actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenMap('coverage')}><Maximize2 size={14} aria-hidden="true" />{tr('Ouvrir la carte')}</button>}>
          <MapExplorer variant="mini" period={period || undefined} filters={{ officeId, activity: null }} initial={{ theme: 'coverage' }} onNavigate={onNavigate} mapHeight={380} />
        </Section>
        <Section fill id="cvt-ov-dist" title={tr('Répartition globale')} sub={tr('{n} visite(s) · classe du score de chaque visite', { n: formatInt(v.n) })}>
          {v.n ? (
            <div className="cvt-dist">
              <ClassDonut classes={v.classes} unit={tr('visites')} size={150} />
              <ClassList classes={v.classes} />
            </div>
          ) : <EmptyNote icon={ClipboardList} title={tr('Aucune visite sur la période')}>{tr('Les formulaires de suivi reçus sur la période apparaîtront ici, classés par leur score.')}</EmptyNote>}
        </Section>
      </div>

      {/* Couverture par activité : le MÊME tableau que la Synthèse du suivi de processus (mesures
          communes, retour 110) — toutes les activités du registre qui ont des sites actifs, celles
          sans fiche de suivi comprises ; ses lignes se somment à la tuile « Couverture globale ». */}
      {cov && <ActivityCoverageCard cov={cov} periodText={period ? periodLabel(period, lang) : ''} className="cvt-actcov" />}

      {unattached.length > 0 && (
        <Section id="cvt-ov-unatt" title={tr('Fiches sans activité')} sub={tr('Leurs visites comptent, mais sans activité elles n\'ont ni sites actifs ni modèle d\'indicateurs')}>
          <ul className="cvt-linklist">
            {unattached.map((f) => (
              <li key={f.id}>
                <span className="cvt-linklist-l">{f.label}</span>
                <span className="muted tabular">{tr('{n} visite(s)', { n: formatInt(f.submissions) })}</span>
                {onNavigate && (
                  <button type="button" className="inline-link" onClick={() => onNavigate('processus', 'donnees', f.id)}>
                    <Link2 size={13} aria-hidden="true" /> {tr('Rattacher à une activité')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** En-tête d'une page du tableau de bord : icône, titre, public visé (maquette). */
export function PageHead({ icon: Icon, title, audience }) {
  return (
    <div className="cvt-ph">
      <span className="cvt-ph-ic" aria-hidden="true"><Icon size={18} /></span>
      <h2>{title}</h2>
      {audience && <span className="cvt-ph-aud">{audience}</span>}
    </div>
  );
}

/** Verdict d'une activité : couleur + icône + libellé (« Critique », « Vigilance », « Satisfaisant »). */
export function VerdictBadge({ verdict }) {
  const { tr } = useI18n();
  const d = VERDICTS[verdict.level] || VERDICTS.na;
  return <Badge tone={d.tone} icon={STATUS_ICONS[d.icon]}>{tr(d.label)}</Badge>;
}

function ActivityTile({ a, cov, mapLoading, onOpen }) {
  const { tr, lang } = useI18n();
  const Icon = activityIcon(a);
  const verdict = verdictOf({ coverage: cov ? cov.rate : null, index: a.index });
  const covPct = cov && cov.rate != null ? pctOfRate(cov.rate) : null;
  const note = a.kind === 'modele' ? tr('Aucune fiche de suivi rattachée')
    : a.visits.n === 0 ? tr('Aucune visite sur la période')
      : tr('{n} visite(s) · {s} notée(s)', { n: formatInt(a.visits.n), s: formatInt(a.visits.scored) });
  return (
    <button type="button" className="card cvt-tile" onClick={onOpen} title={a.category || undefined}>
      <div className="cvt-tile-h">
        <span className="cvt-tile-ic" aria-hidden="true"><Icon size={17} /></span>
        <b className="cvt-tile-n">{activityName(a, tr)}</b>
        <VerdictBadge verdict={verdict} />
      </div>
      <div className="cvt-tile-m">
        <div className="cvt-tile-cov">
          <span className="tabular">{mapLoading ? '…' : covPct == null ? '—' : formatRate(cov.rate, lang)}</span>
          <small>{tr('couverture')}</small>
        </div>
        <div className="cvt-tile-idx">
          <span className="tabular">{a.index == null ? '—' : Math.round(a.index)}<small>/100</small></span>
          <ClassBadge band={a.band} bare />
        </div>
      </div>
      <ClassStack classes={a.visits.classes} unit={tr('visite(s)')} />
      <div className="cvt-tile-f">
        <span>{note}</span>
        <ChevronRight size={15} aria-hidden="true" />
      </div>
    </button>
  );
}

