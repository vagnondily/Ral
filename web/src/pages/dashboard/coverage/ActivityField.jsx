import React from 'react';
import { AlertTriangle, Link2Off, MapPin, ShieldAlert, UserRound } from 'lucide-react';
import CodeLabel from '../../../components/CodeLabel.jsx';
import MapExplorer from '../../../components/map/MapExplorer.jsx';
import { officeCoverageByName, siteSignals, sortSignals } from '../../../lib/coverageView.js';
import { formatInt, monthLabel } from '../../../lib/format.js';
import { formatRate } from '../../../lib/mapScale.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { ClassBadge, ClassStack, CoverageBadge, Kpi, MeterRow, Section, EmptyNote, coverageBand } from './parts.jsx';
import { BureauTable } from './ActivitySynthesis.jsx';

/**
 * Pages « Carte », « Contrôle » et « Agents » d'une activité (maquette). La carte est LA carte du
 * suivi (components/map), filtrée sur l'activité et le bureau de la page ; la couverture par bureau
 * = les mesures communes (retour 110 : sites suivis ÷ sites actifs du bureau) ; les signaux viennent
 * du serveur (visites, indicateurs) et des sites (réponse de la carte) ; la qualité de saisie par
 * agent est celle du concepteur de rapport (même décompte).
 */

const noDomain = (name, tr) => (name === '(sans dimension)' ? tr('Sans module') : name);

export function MapPage({ a, period, officeId, covAct, onNavigate, onOpenMap }) {
  const { tr, lang } = useI18n();
  if (!a.category) {
    return <EmptyNote icon={MapPin} title={tr('Aucun site à placer')}>{tr('Rattachez ces fiches à une activité pour voir leurs sites et leur couverture.')}</EmptyNote>;
  }
  const offices = [...officeCoverageByName(covAct).values()].filter((o) => o.active > 0);
  return (
    <>
      <MapExplorer variant="compact" title={tr('Couverture géographique')} period={period || undefined} filters={{ officeId, activity: a.category }}
        initial={{ theme: 'coverage' }} onNavigate={onNavigate} onOpenFull={onOpenMap ? (st) => onOpenMap(st.theme, a.category) : undefined} />
      <div className="cvt-row cvt-row-2">
        <Section id="cvt-map-perf" title={tr('Performance par bureau')} sub={tr('Indice de conformité de chaque bureau (visites de la période)')}>
          {a.bureaux.length ? (
            <div className="cvt-meters">
              {a.bureaux.map((b, i) => (
                <MeterRow key={b.key} rank={i + 1} label={<CodeLabel row={b} onNavigate={onNavigate} />} sub={tr('{n} visite(s)', { n: formatInt(b.visits) })}
                  value={b.index} band={b.band} />
              ))}
            </div>
          ) : <p className="muted">{tr('Aucune visite rattachée à un bureau sur la période.')}</p>}
        </Section>
        <Section fill id="cvt-map-cov" title={tr('Couverture par bureau')} sub={tr('Sites actifs suivis (visite déclarée ou données reçues) ÷ sites actifs du bureau')}>
          {covAct === undefined ? <p className="muted">{tr('chargement…')}</p> : offices.length ? (
            <div className="cvt-meters">
              {offices.map((c) => (
                <MeterRow key={c.name} label={c.name === '—' ? tr('Sans bureau') : c.name} sub={tr('{r} / {a} sites', { r: formatInt(c.realised), a: formatInt(c.active) })}
                  value={c.rate == null ? null : c.rate * 100} band={coverageBand(c.rate)} badge={<CoverageBadge rate={c.rate} bare />}
                  right={c.rate == null ? '—' : formatRate(c.rate, lang)} />
              ))}
            </div>
          ) : <p className="muted">{tr('Aucun site actif rattaché à un bureau.')}</p>}
        </Section>
      </div>
    </>
  );
}

/** Phrase d'un signal de risque (codes du serveur et de la carte), dans la langue de l'écran. */
function signalText(s, tr) {
  switch (s.kind) {
    case 'urgent_visits': return tr('{n} visite(s) en « Action urgente » (score < 50) — à auditer.', { n: formatInt(s.n) });
    case 'na_visits': return tr('{p} % des visites sans score ({n}) : aucune réponse comptée à un indicateur noté.', { p: Math.round(s.pct), n: formatInt(s.n) });
    case 'weak_module': return tr('Module « {m} » à {s} %.', { m: noDomain(s.module, tr), s: s.score });
    case 'weak_indicator': return tr('« {l} » à {p} % (module {m}).', { l: s.label, p: s.pct, m: noDomain(s.module, tr) });
    case 'no_indicator': return tr('La fiche « {f} » reçoit des données ({n} visite(s)) sans aucun indicateur.', { f: s.formLabel, n: formatInt(s.n) });
    case 'high_untouched': return tr('{n} site(s) actif(s) à risque élevé ni prévu(s) ni suivi(s).', { n: formatInt(s.n) });
    case 'never_visited': return tr('{n} site(s) actif(s) jamais suivi(s) : ni visite déclarée ni données reçues.', { n: formatInt(s.n) });
    default: return s.kind;
  }
}

export function IntegrityPage({ a, sites, gate, onNavigate }) {
  const { tr } = useI18n();
  const signals = sortSignals([...a.signals, ...siteSignals(sites)]);
  const v = a.visits;
  return (
    <>
      <div className="cvt-row cvt-row-2">
        <Section fill id="cvt-int-sig" title={tr('Signaux de risque')} sub={tr('Points à contrôler, du plus grave au moins grave')}>
          {signals.length ? (
            <ul className="cvt-signals">
              {signals.map((s, i) => (
                <li key={`${s.kind}-${i}`}><ClassBadge band={s.tone} bare /><span>{signalText(s, tr)}</span></li>
              ))}
            </ul>
          ) : <EmptyNote icon={ShieldAlert} title={tr('Aucun signal sur la période')}>{tr('Ni visite urgente, ni module sous 65, ni site à risque élevé laissé sans suivi.')}</EmptyNote>}
        </Section>
        <Section id="cvt-int-size" title={tr('Ampleur du risque')} sub={tr('Indicateurs de contrôle')}>
          <div className="cvt-dq">
            <div className="cvt-dqc"><div className="cvt-dqc-n tabular">{formatInt(v.classes.urg)}</div><div className="cvt-dqc-l">{tr('Visites urgentes')}</div></div>
            <div className="cvt-dqc"><div className="cvt-dqc-n tabular">{v.naPct == null ? '—' : `${Math.round(v.naPct)} %`}</div><div className="cvt-dqc-l">{tr('Visites non évaluées')}</div></div>
            <div className="cvt-dqc"><div className="cvt-dqc-n tabular">{sites ? formatInt(sites.highUntouched) : '—'}</div><div className="cvt-dqc-l">{tr('Sites à risque élevé non suivis')}</div></div>
            <div className="cvt-dqc"><div className="cvt-dqc-n tabular">{sites ? formatInt(sites.neverVisited) : '—'}</div><div className="cvt-dqc-l">{tr('Sites jamais suivis')}</div></div>
          </div>
          <ClassStack classes={v.classes} unit={tr('visite(s)')} height={16} />
        </Section>
      </div>
      <Section id="cvt-int-urg" title={tr('Visites les plus faibles')} sub={tr('Visites en « Action urgente », du score le plus bas au plus haut ({n} au plus)', { n: 15 })}>
        {gate || (a.urgent.length ? (
          <div className="cvt-tablewrap">
            <table className="table cvt-table">
              <thead><tr><th className="num">{tr('Score')}</th><th>{tr('Mois')}</th><th>{tr('Site')}</th><th>{tr('Bureau')}</th><th>{tr('Agent')}</th><th className="num">{tr('Indicateurs répondus')}</th>{a.forms.length > 1 && <th>{tr('Fiche')}</th>}</tr></thead>
              <tbody>
                {a.urgent.map((u) => (
                  <tr key={u.id}>
                    <td className="num tabular"><ClassBadge band="urg" bare /> {Math.round(u.score)}</td>
                    <td>{u.month ? monthLabel(u.month) : '—'}</td>
                    <td>{u.site || <span className="muted">{tr('Non renseigné')}</span>}</td>
                    <td>{u.bureau ? <CodeLabel row={u.bureau} onNavigate={onNavigate} /> : <span className="muted">{tr('Non renseigné')}</span>}</td>
                    <td>{u.agent || <span className="muted">{tr('Non renseigné')}</span>}</td>
                    <td className="num tabular">{formatInt(u.answered)}</td>
                    {a.forms.length > 1 && <td>{u.formLabel}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{tr('Aucune visite en « Action urgente » sur la période.')}</p>)}
      </Section>
    </>
  );
}

/** Remplissage d'un agent : bon (≥ 70 %), moyen (≥ 50 %), insuffisant (< 50 %, comme le serveur). */
const fillTone = (f) => (f == null ? 'na' : f >= 70 ? 'exc' : f >= 50 ? 'imp' : 'urg');

export function AgentsPage({ gate, agents, onNavigate }) {
  const { tr } = useI18n();
  if (gate) return gate;
  if (agents.error) return <p className="muted">{agents.error}</p>;
  if (!agents.data) return <p className="muted">{tr('chargement…')}</p>;
  const { rows = [], totals } = { rows: agents.data.agents, totals: agents.data.totals };
  const max = Math.max(1, ...rows.map((r) => r.visits));
  const avg = totals.avgFill;
  return (
    <>
      <div className="cvt-kpis">
        <Kpi icon={UserRound} label={tr('Agents actifs')} value={formatInt(totals.agents)} foot={tr('ont saisi des visites sur la période')} />
        <Kpi label={tr('Remplissage moyen')} value={avg == null ? '—' : String(Math.round(avg))} unit="%" band={avg == null ? null : fillTone(avg)} foot={tr('réponses exploitables du formulaire')} />
        <Kpi label={tr('Saisie insuffisante')} value={formatInt(totals.lowFill)} foot={tr('agent(s) sous 50 % de remplissage')} band={totals.lowFill ? 'urg' : 'exc'} />
        <Kpi label={tr('Complétude du score')} value={totals.completeness == null ? '—' : String(Math.round(totals.completeness))} unit="%" foot={tr('visites avec un score')} />
      </div>
      <Section id="cvt-agents" title={tr('Qualité de saisie par agent')} sub={tr('Taux de remplissage = réponses exploitables ÷ réponses attendues aux indicateurs notés. Trié par nombre de visites.')}>
        {rows.length ? (
          <div className="cvt-tablewrap">
            <table className="table cvt-table">
              <thead>
                <tr>
                  <th className="num">#</th><th>{tr('Agent')}</th><th className="cvt-col-bar">{tr('Visites saisies')}</th><th className="cvt-col-bar">{tr('Taux de remplissage')}</th>
                  <th className="num">{tr('% sans score')}</th><th className="num">{tr('Indice moyen')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td className="num tabular muted">{i + 1}</td>
                    <td className="cvt-agent">
                      {r.status === 'saisi'
                        ? <>{r.name}<span className="cvt-agent-raw" title={tr('nom saisi, non relié à un agent MEMS')}><Link2Off size={12} aria-label={tr('nom saisi, non relié à un agent MEMS')} /></span></>
                        : <CodeLabel row={r} onNavigate={onNavigate} />}
                    </td>
                    <td className="cvt-col-bar"><span className="cvt-inlinebar"><span className="cvt-bg-blue" style={{ width: `${(r.visits / max) * 100}%` }} /></span><span className="tabular cvt-inlinebar-v">{formatInt(r.visits)}</span></td>
                    <td className="cvt-col-bar">
                      <span className="cvt-inlinebar"><span className={`cvt-bg-${fillTone(r.fill)}`} style={{ width: `${r.fill == null ? 0 : Math.max(2, r.fill)}%` }} /></span>
                      <span className="tabular cvt-inlinebar-v">{r.fill == null ? '—' : `${Math.round(r.fill)} %`}</span>
                      {r.fill != null && r.fill < 50 && <AlertTriangle size={13} className="cvt-ic-warn" aria-label={tr('saisie insuffisante')} />}
                    </td>
                    <td className="num tabular">{r.naPct == null ? '—' : `${Math.round(r.naPct)} %`}</td>
                    <td className="num tabular">{r.index == null ? '—' : <>{Math.round(r.index)} <ClassBadge band={r.band} bare /></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{tr('Aucun agent sur la période.')}</p>}
        {rows.length > 0 && (
          <p className="cvt-narr">
            {tr('Sur {n} agent(s), le remplissage moyen est de {f} %.', { n: formatInt(totals.agents), f: avg == null ? '—' : Math.round(avg) })}{' '}
            {totals.lowFill
              ? tr('{n} agent(s) saisissent moins de la moitié des réponses attendues — à accompagner en priorité (formation, contrôle de saisie).', { n: formatInt(totals.lowFill) })
              : tr('Aucun agent sous 50 % : la saisie est globalement fiable.')}
          </p>
        )}
      </Section>
    </>
  );
}
