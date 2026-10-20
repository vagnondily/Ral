import React from 'react';
import { BAND_RULES, indicatorValueText } from '../../../lib/coverageView.js';
import { INDICATOR_STATUS } from '../../../lib/indicatorView.js';
import { NA_REASONS } from '../../../lib/naReasons.js';
import { formatInt } from '../../../lib/format.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { ClassBadge, ClassSwatch, MeterRow, Section } from './parts.jsx';

/**
 * Pages « Salle de contrôle » et « Qualité » d'une activité (maquette) : tous les indicateurs,
 * groupés par module, chacun avec sa classe (règle unique du serveur : cible, sinon bandes
 * 80 / 65 / 50 sur le score orienté). Modules de l'indice d'abord, complémentaires ensuite.
 */

const noDomain = (name, tr) => (name === '(sans dimension)' ? tr('Sans module') : name);
const reasonText = (code, tr) => (code && NA_REASONS[code] ? tr(NA_REASONS[code].label) : null);

export function ControlRoomPage({ a, gate }) {
  const { tr } = useI18n();
  const c = a.indicatorClasses || {};
  const evaluated = (c.exc || 0) + (c.sat || 0) + (c.imp || 0) + (c.urg || 0);
  const conform = evaluated ? Math.round((((c.exc || 0) + (c.sat || 0)) / evaluated) * 100) : null;
  const tiles = [
    { k: 'n', label: tr('Indicateurs'), value: formatInt(a.indicatorCount), sub: tr('{n} dans l\'indice', { n: formatInt(c.scored || 0) }) },
    { k: 'conf', label: tr('Conformes'), value: conform == null ? '—' : `${conform} %`, sub: tr('Excellent ou Satisfaisant'), band: conform == null ? 'na' : 'exc' },
    { k: 'imp', label: tr('À surveiller'), value: formatInt(c.imp || 0), sub: tr(INDICATOR_STATUS.imp.label), band: 'imp' },
    { k: 'urg', label: tr('Critiques'), value: formatInt(c.urg || 0), sub: tr(INDICATOR_STATUS.urg.label), band: 'urg' },
    { k: 'idx', label: tr('Indice'), value: a.index == null ? '—' : `${Math.round(a.index)}/100`, sub: tr(INDICATOR_STATUS[a.band].label), band: a.band },
  ];
  return (
    <>
      <div className="cvt-crbar">
        {tiles.map((t) => (
          <div className="cvt-crc" key={t.k}>
            {t.band ? <ClassBadge band={t.band} bare /> : <span className="cvt-crc-dot" aria-hidden="true" />}
            <div>
              <div className="cvt-crc-n tabular">{t.value}</div>
              <div className="cvt-crc-l">{t.label}<span> · {t.sub}</span></div>
            </div>
          </div>
        ))}
      </div>
      <Legend />
      {gate || (
        <div className="cvt-wall">
          {a.wall.map((g) => (
            <section className="card cvt-wallmod" key={`${g.complementary ? 'c' : 's'}|${g.name}`}>
              <header className="cvt-wallmod-h">
                <b>{noDomain(g.name, tr)}</b>
                {g.score != null && <span className="cvt-wallmod-sc tabular">{g.score} %</span>}
                <ClassBadge band={g.band} bare />
                {g.complementary && <span className="cvt-tag">{tr('hors indice')}</span>}
                <span className="cvt-wallmod-n">{tr('{n} ind.', { n: g.n })}</span>
              </header>
              <div className="cvt-cells">
                {g.indicators.map((ind, i) => {
                  const why = ind.band === 'na' ? reasonText(ind.reason, tr) : null;
                  const value = indicatorValueText(ind, formatInt);
                  return (
                    <div className={`cvt-cell cvt-bl-${ind.band}`} key={`${ind.id || ind.code || ind.label}-${i}`}
                      title={`${ind.label}${ind.form ? ` · ${ind.form}` : ''} — ${value} — ${tr(INDICATOR_STATUS[ind.band].label)}${why ? ` (${why})` : ''}`}>
                      <ClassBadge band={ind.band} bare />
                      <span className="cvt-cell-l">{ind.label}</span>
                      <span className="cvt-cell-v tabular">{value}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Légende des classes et des seuils (règle unique, dite en clair). */
function Legend() {
  const { tr } = useI18n();
  return (
    <div className="cvt-legend">
      {BAND_RULES.map((r) => <span key={r.k}><ClassSwatch band={r.k} />{tr(INDICATOR_STATUS[r.k].label)} <b className="tabular">{r.range}</b></span>)}
      <span><ClassSwatch band="na" />{tr(INDICATOR_STATUS.na.label)}</span>
      <span className="cvt-legend-note">{tr('Sans cible : score orienté ; avec cible : écart ≤ 10 % Satisfaisant, ≤ 30 % À améliorer.')}</span>
    </div>
  );
}

export function QualityPage({ a, gate }) {
  const { tr } = useI18n();
  const groups = [...a.dims.map((d) => ({ ...d, complementary: false })), ...a.complementary.map((d) => ({ ...d, complementary: true }))];
  return (
    <Section id="cvt-qual" title={tr('Indicateurs regroupés par module')} sub={tr('Triés du plus faible au plus solide · indicateurs en %, score orienté (« plus bas = mieux » retourné)')}>
      {gate || (groups.length ? groups.map((g) => (
        <div className="cvt-qgroup" key={`${g.complementary ? 'c' : 's'}|${g.name}`}>
          <div className="cvt-qgroup-h">
            <b>{noDomain(g.name, tr)}</b>
            <small>{tr('{n} ind.', { n: g.n })}</small>
            {g.complementary && <span className="cvt-tag">{tr('hors indice')}</span>}
            <span className="cvt-qgroup-v tabular">{g.score} %</span>
            <ClassBadge band={g.band} />
          </div>
          <div className="cvt-meters">
            {g.inds.map((x, i) => <MeterRow key={`${x.label}-${i}`} label={x.label} value={x.score} band={x.band} right={`${x.pct} %`}
              title={x.lower ? tr('« plus bas = mieux » : score orienté {s}', { s: Math.round(x.score) }) : undefined} />)}
          </div>
        </div>
      )) : <p className="muted">{tr('Aucun indicateur en % sur la période.')}</p>)}
    </Section>
  );
}

