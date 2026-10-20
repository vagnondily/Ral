import React from 'react';
import { Maximize2, TrendingUp } from 'lucide-react';
import { STATUS_ICONS } from '../../../components/ui.jsx';
import CodeLabel from '../../../components/CodeLabel.jsx';
import MapExplorer from '../../../components/map/MapExplorer.jsx';
import { INDICATOR_STATUS } from '../../../lib/indicatorView.js';
import { VERDICTS, coverageStatusOf, officeCoverageByName, trendArrow, verdictOf } from '../../../lib/coverageView.js';
import { waysText } from '../../../lib/coverageDefs.js';
import { formatInt, monthLabel } from '../../../lib/format.js';
import { formatRate } from '../../../lib/mapScale.js';
import { periodLabel } from '../../../lib/period.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { activityIcon, activityName } from './activityMeta.js';
import { ClassBadge, ClassDonut, ClassList, IndexTrend, Kpi, MeterRow, ModuleRadar, Section, EmptyNote, fmtDelta } from './parts.jsx';

/**
 * Pages « Synthèse », « Performance » et « Bulletin » d'une activité (maquette). Chiffres du
 * serveur (indicateurs, visites) et des mesures communes de couverture (retour 110 : sites suivis
 * par visite déclarée ou données reçues ÷ sites actifs) ; aucun recalcul ici.
 */

const noDomain = (name, tr) => (name === '(sans dimension)' ? tr('Sans module') : name);

/** Bandeau « Décision » : verdict (couverture et indice lus ensemble), indice, évolution. */
function VerdictBanner({ a, cov, trend }) {
  const { tr, lang } = useI18n();
  const v = verdictOf({ coverage: cov ? cov.rate : null, index: a.index });
  const d = VERDICTS[v.level];
  const Icon = activityIcon(a);
  const VIcon = STATUS_ICONS[d.icon];
  const arrow = trendArrow(trend && trend.data ? trend.data.delta : null);
  const basis = v.basis === 'coverage' ? tr('sur la couverture seule (aucune visite notée)')
    : v.basis === 'index' ? tr('sur l\'indice seul (aucun site actif)') : null;
  return (
    <div className={`cvt-verdict is-${v.level}`} role="status">
      <span className="cvt-verdict-ic" aria-hidden="true"><Icon size={22} /></span>
      <div className="cvt-verdict-b">
        <div className="cvt-verdict-k">{tr('Décision')}</div>
        <div className="cvt-verdict-t">{VIcon && <VIcon size={17} aria-hidden="true" />}{tr(d.label)} · {tr(d.action)}</div>
        <div className="cvt-verdict-d">{tr(d.text)}{basis && <> — {basis}</>}</div>
      </div>
      <div className="cvt-verdict-n">
        <div className="tabular">{a.index == null ? '—' : Math.round(a.index)}<small>/100</small>
          {arrow.delta != null && <span className={`cvt-arrow is-${arrow.tone}`} title={tr('{d} pt(s) par rapport au mois noté précédent', { d: fmtDelta(arrow.delta) })}>{arrow.arrow}</span>}</div>
        <div className="cvt-verdict-l">{tr('indice · couverture {c}', { c: cov && cov.rate != null ? formatRate(cov.rate, lang) : '—' })}</div>
      </div>
    </div>
  );
}

/** Les quatre chiffres clés d'une activité (couverture, indice, action urgente, visites). */
function ActivityKpis({ a, cov, covLoading }) {
  const { tr, lang } = useI18n();
  const v = a.visits;
  const st = coverageStatusOf(cov ? cov.rate : null);
  return (
    <div className="cvt-kpis">
      <Kpi label={tr('Couverture')} value={covLoading ? '…' : cov && cov.rate != null ? formatRate(cov.rate, lang) : '—'}
        foot={covLoading ? tr('chargement…') : cov && cov.active > 0
          ? <>{tr('{r} / {a} sites actifs suivis · cible 80 %', { r: formatInt(cov.realised), a: formatInt(cov.active) })}{st && <> · {tr(st.label)}</>}
            {cov.realised > 0 && <span className="cov-ways">{waysText(tr, { covered: cov.realised, byData: cov.byData, byVisit: cov.byVisit, both: cov.both }, formatInt)}</span>}</>
          : a.kind === 'sans' ? tr('fiche sans activité : aucun site actif') : tr('aucun site actif sur la période')} />
      <Kpi label={tr('Indice')} value={a.index == null ? '—' : String(Math.round(a.index))} unit="/100" band={a.band}
        foot={a.index == null ? tr('aucune visite notée') : null} />
      <Kpi label={tr('Action urgente')} value={v.urgentPct == null ? '—' : String(Math.round(v.urgentPct))} unit="%"
        foot={v.scored ? tr('{n} visite(s) sous 50 sur {s} notée(s)', { n: formatInt(v.classes.urg), s: formatInt(v.scored) }) : tr('aucune visite notée')} />
      <Kpi label={tr('Visites')} value={formatInt(v.n)}
        foot={v.n ? tr('{p} % non évaluées', { p: v.naPct == null ? 0 : Math.round(v.naPct) }) : tr('aucune visite sur la période')} />
    </div>
  );
}

function trendSentence(trend, tr) {
  const d = trend && trend.data ? trend.data.delta : null;
  if (!d || d.value == null) return null;
  const arrow = trendArrow(d);
  if (d.delta == null) return tr('Indice de {m} : {v}/100 (un seul mois noté sur la fenêtre).', { m: monthLabel(d.month), v: Math.round(d.value) });
  return tr('Indice {w} ({d} pt(s) entre {p} et {m}).', { w: tr(arrow.word), d: fmtDelta(d.delta), p: monthLabel(d.previousMonth), m: monthLabel(d.month) });
}

/** Carte « Tendance de l'indice » (fenêtre des tendances : 12 mois au moins finissant à la période). */
function TrendCard({ trend, height = 170, objective = false, fill = false }) {
  const { tr, lang } = useI18n();
  const months = trend && trend.data ? trend.data.months : [];
  const scored = months.filter((m) => m.index != null).length;
  const sentence = trendSentence(trend, tr);
  return (
    <Section fill={fill} id="cvt-trend" title={tr('Tendance de l\'indice')}
      sub={trend && trend.data ? tr('Mensuelle · {p} · seuil 50', { p: periodLabel(trend.data.window, lang, { short: true }) }) : tr('Mensuelle · seuil 50')}>
      {trend && trend.error ? <p className="muted">{trend.error}</p>
        : !trend || !trend.data ? <p className="muted">{tr('chargement…')}</p>
          : scored === 0 ? <EmptyNote icon={TrendingUp} title={tr('Aucun mois noté sur la fenêtre')}>{tr('La tendance apparaîtra dès qu\'une visite aura répondu à un indicateur noté.')}</EmptyNote>
            : (
              <>
                <IndexTrend months={months} height={height} label={tr('Indice de conformité par mois, de {a} à {b}', { a: monthLabel(months[0].month), b: monthLabel(months[months.length - 1].month) })} />
                {sentence && <p className="cvt-narr">{sentence}{objective && <> {tr('Objectif : franchir 65 (satisfaisant).')}</>}</p>}
              </>
            )}
    </Section>
  );
}

/** Profil par module : un module par ligne, du plus faible au plus solide (modules de l'indice). */
function DimsList({ dims, stacked = false }) {
  const { tr } = useI18n();
  if (!dims.length) return <p className="muted">{tr('Aucun module noté sur la période.')}</p>;
  return (
    <div className="cvt-meters">
      {dims.map((d) => <MeterRow key={d.name} stacked={stacked} label={noDomain(d.name, tr)} sub={tr('{n} ind.', { n: d.n })} value={d.score} band={d.band} />)}
    </div>
  );
}

export function SynthesisPage({ a, cov, covLoading, period, officeId, gate, trend, onNavigate, onOpenMap }) {
  const { tr } = useI18n();
  const weak = a.dims.slice(0, 3);
  return (
    <>
      <VerdictBanner a={a} cov={cov} trend={trend} />
      <ActivityKpis a={a} cov={cov} covLoading={covLoading} />
      {gate}
      <div className="cvt-row cvt-row-3">
        <Section id="cvt-syn-map" title={tr('Implantation des sites')}
          sub={a.category ? tr('Couleur = couverture du district (sites suivis ÷ sites actifs) · points = sites') : tr('Fiches sans activité : aucun site rattaché')}
          actions={a.category && onOpenMap && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenMap('coverage', a.category)}><Maximize2 size={14} aria-hidden="true" />{tr('Ouvrir la carte')}</button>}>
          {a.category
            ? <MapExplorer variant="mini" period={period || undefined} filters={{ officeId, activity: a.category }} initial={{ theme: 'coverage' }} onNavigate={onNavigate} mapHeight={320} />
            : <EmptyNote title={tr('Aucun site à placer')}>{tr('Rattachez ces fiches à une activité pour voir leurs sites et leur couverture.')}</EmptyNote>}
        </Section>
        <Section fill id="cvt-syn-dist" title={tr('Répartition')} sub={tr('{n} visite(s) · classe du score de chaque visite', { n: formatInt(a.visits.n) })}>
          {a.visits.n ? (
            <div className="cvt-dist is-stacked">
              <ClassDonut classes={a.visits.classes} unit={tr('visites')} />
              <ClassList classes={a.visits.classes} />
            </div>
          ) : <p className="muted">{tr('Aucune visite sur la période.')}</p>}
        </Section>
        <Section fill id="cvt-syn-dims" title={tr('Profil par module')} sub={tr('Conformité (%) · modules de l\'indice')}>
          <DimsList dims={a.dims} stacked />
        </Section>
      </div>
      <div className="cvt-row cvt-row-2">
        <Section fill id="cvt-syn-weak" title={tr('Modules à renforcer en priorité')} sub={tr('Les 3 plus faibles')}>
          {weak.length ? (
            <ol className="cvt-prio">
              {weak.map((d, i) => (
                <li key={d.name}>
                  <span className="cvt-prio-n tabular">{i + 1}</span>
                  <div>
                    <div className="cvt-prio-t"><b>{noDomain(d.name, tr)}</b> — <span className="tabular">{d.score} %</span> <ClassBadge band={d.band} bare /></div>
                    {d.inds[0] && <div className="cvt-prio-s">{tr('Plus bas : « {l} » ({p} %).', { l: d.inds[0].label, p: d.inds[0].pct })}</div>}
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="muted">{tr('Aucun module noté sur la période.')}</p>}
        </Section>
        <TrendCard trend={trend} />
      </div>
    </>
  );
}

export function PerformancePage({ a, gate, trend, covAct, onNavigate }) {
  const { tr, lang } = useI18n();
  const arrow = trendArrow(trend && trend.data ? trend.data.delta : null);
  const strongest = a.dims.length ? a.dims[a.dims.length - 1] : null;
  const weakest = a.dims.length ? a.dims[0] : null;
  const officeCov = officeCoverageByName(covAct);
  return (
    <>
      <div className="cvt-kpis">
        <Kpi label={tr('Indice global')} value={a.index == null ? '—' : String(Math.round(a.index))} unit="/100" band={a.band} />
        <Kpi label={tr('Évolution')} value={arrow.delta == null ? '—' : `${fmtDelta(arrow.delta)} ${arrow.arrow}`}
          foot={arrow.delta == null ? tr('un seul mois noté ou aucun') : tr('{w} par rapport au mois noté précédent', { w: tr(arrow.word) })} />
        <Kpi label={tr('Module le plus fort')} value={strongest ? `${strongest.score} %` : '—'} foot={strongest ? noDomain(strongest.name, tr) : tr('aucun module noté')} />
        <Kpi label={tr('Module le plus faible')} value={weakest ? `${weakest.score} %` : '—'} foot={weakest ? noDomain(weakest.name, tr) : tr('aucun module noté')} />
      </div>
      {gate}
      <div className="cvt-row cvt-row-2">
        <Section id="cvt-perf-radar" title={tr('Profil par module')} sub={tr('Radar des {n} module(s) de l\'indice', { n: a.dims.length })}>
          <ModuleRadar dims={a.dims} label={tr('Profil par module : {list}', { list: a.dims.map((d) => `${d.name} ${d.score}`).join(', ') })} />
        </Section>
        <TrendCard trend={trend} height={210} objective fill />
      </div>
      <Section id="cvt-perf-dims" title={tr('Détail par module')} sub={tr('Score de conformité par module (modules de l\'indice, puis complémentaires hors indice)')}>
        <DimsList dims={a.dims} />
        {a.complementary.length > 0 && (
          <>
            <div className="cvt-subhead">{tr('Modules complémentaires (hors indice)')}</div>
            <DimsList dims={a.complementary} />
          </>
        )}
      </Section>
      <div className="cvt-row cvt-row-2">
        <Section id="cvt-perf-top" title={tr('Points forts')} sub={tr('Les {n} indicateurs les mieux tenus', { n: a.top.length })}>
          {a.top.length ? <div className="cvt-meters">{a.top.map((x, i) => <MeterRow key={`${x.label}-${i}`} label={x.label} value={x.score} band={x.band} right={`${x.pct} %`} title={x.lower ? tr('« plus bas = mieux » : score orienté {s}', { s: Math.round(x.score) }) : undefined} />)}</div>
            : <p className="muted">{tr('Aucun indicateur en % sur la période.')}</p>}
        </Section>
        <Section id="cvt-perf-flop" title={tr('Points faibles')} sub={tr('Les {n} indicateurs à renforcer', { n: a.flop.length })}>
          {a.flop.length ? <div className="cvt-meters">{a.flop.map((x, i) => <MeterRow key={`${x.label}-${i}`} label={x.label} value={x.score} band={x.band} right={`${x.pct} %`} title={x.lower ? tr('« plus bas = mieux » : score orienté {s}', { s: Math.round(x.score) }) : undefined} />)}</div>
            : <p className="muted">{tr('Aucun indicateur en % sur la période.')}</p>}
        </Section>
      </div>
      <Section id="cvt-perf-bur" title={tr('Comparaison des bureaux')} sub={tr('Indice de conformité, visites et couverture des sites de chaque bureau')}>
        <BureauTable rows={a.bureaux} officeCov={officeCov} onNavigate={onNavigate} lang={lang} />
      </Section>
    </>
  );
}

/** Tableau des bureaux : indice (barre + classe), visites, score moyen, urgentes, couverture des sites. */
export function BureauTable({ rows, officeCov, onNavigate, lang }) {
  const { tr } = useI18n();
  if (!rows.length) return <p className="muted">{tr('Aucune visite rattachée à un bureau sur la période.')}</p>;
  return (
    <div className="cvt-tablewrap">
      <table className="table cvt-table">
        <thead>
          <tr>
            <th className="num">#</th><th>{tr('Bureau')}</th><th className="num">{tr('Visites')}</th><th className="cvt-col-bar">{tr('Indice')}</th>
            <th className="num">{tr('Score moyen')}</th><th className="num">{tr('Urgentes')}</th><th className="num">{tr('Couverture')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => {
            // Couverture des sites d'un bureau MEMS (relié), lue par son nom dans les mesures communes.
            const c = officeCov && b.status === 'relie' && b.name ? officeCov.get(String(b.name).toLowerCase()) : null;
            return (
              <tr key={b.key}>
                <td className="num tabular muted">{i + 1}</td>
                <td><CodeLabel row={b} onNavigate={onNavigate} /></td>
                <td className="num tabular">{formatInt(b.visits)}</td>
                <td className="cvt-col-bar">
                  <span className="cvt-inlinebar"><span className={`cvt-bg-${b.band}`} style={{ width: `${b.index == null ? 0 : Math.max(2, b.index)}%` }} /></span>
                  <span className="tabular cvt-inlinebar-v">{b.index == null ? '—' : Math.round(b.index)}</span>
                  <ClassBadge band={b.band} bare />
                </td>
                <td className="num tabular">{b.meanScore == null ? '—' : Math.round(b.meanScore)}</td>
                <td className="num tabular">{formatInt(b.urgent)}</td>
                <td className="num tabular" title={c ? tr('{r} / {a} sites actifs suivis', { r: formatInt(c.realised), a: formatInt(c.active) }) : tr('Couverture des sites : bureau MEMS seulement')}>
                  {c && c.rate != null ? formatRate(c.rate, lang) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Bulletin narratif (maquette « Communication ») : phrases entières, chiffres en gras, générées
 * depuis les chiffres de la page — aucune valeur saisie à la main.
 */
export function BulletinPage({ a, cov, period, gate, trend }) {
  const { tr, lang } = useI18n();
  const v = verdictOf({ coverage: cov ? cov.rate : null, index: a.index });
  const d = VERDICTS[v.level];
  const name = activityName(a, tr);
  const weakest = a.dims[0];
  const strongest = a.dims.length > 1 ? a.dims[a.dims.length - 1] : null;
  const b = (x) => <b>{x}</b>;
  const rich = (template, vars) => template.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <React.Fragment key={i}>{vars[part]}</React.Fragment> : part));
  const sentence = trendSentence(trend, tr);
  const urgentBand = INDICATOR_STATUS.urg.label;
  return (
    <Section id="cvt-bull" className="cvt-bull" title={tr('Bulletin de suivi')} sub={`${name} — ${period ? periodLabel(period, lang) : ''}`}>
      {gate}
      <p>
        {cov && cov.active > 0
          ? rich(tr('Le suivi a couvert {r} site(s) actif(s) sur {a} ({c}), dont {d} par données reçues et {v} par visites déclarées.'), {
            r: b(formatInt(cov.realised)), a: b(formatInt(cov.active)), c: b(formatRate(cov.rate, lang)), d: formatInt(cov.byData), v: formatInt(cov.byVisit),
          })
          : tr('Aucun site actif de cette activité sur la période : la couverture ne se mesure pas.')}
        {' '}
        {a.index != null
          ? rich(tr('Indice de conformité {i}, niveau {l}.'), { i: b(`${Math.round(a.index)}/100`), l: b(tr(INDICATOR_STATUS[a.band].label).toLowerCase()) })
          : tr('Aucune visite notée : l\'indice n\'est pas évalué.')}
      </p>
      {a.visits.scored > 0 && (
        <p>
          {rich(tr('{n} visite(s) en {u} ({p} des visites notées).'), { n: b(formatInt(a.visits.classes.urg)), u: tr(urgentBand).toLowerCase(), p: b(`${Math.round(a.visits.urgentPct || 0)} %`) })}
          {weakest && <>{' '}{rich(tr('Module le plus faible : {m} ({s} %).'), { m: b(noDomain(weakest.name, tr)), s: weakest.score })}</>}
          {strongest && <>{' '}{rich(tr('Le mieux tenu : {m} ({s} %).'), { m: b(noDomain(strongest.name, tr)), s: strongest.score })}</>}
        </p>
      )}
      {sentence && <p>{sentence}</p>}
      <p>{b(tr('Recommandation —'))} {tr(d.text)}</p>
      <p className="cvt-bull-foot">{tr('Bulletin recalculé en direct à partir des fiches, indicateurs, visites et du registre des sites — aucun chiffre saisi à la main.')}</p>
    </Section>
  );
}
