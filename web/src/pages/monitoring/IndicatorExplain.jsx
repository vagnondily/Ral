import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, MinusCircle, Ban, AlertTriangle, Circle, Loader2, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Skeleton, StatusBadge } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, formatLocale, monthLabel } from '../../lib/format.js';
import {
  INDICATOR_STATUS, choiceText, classesStatus, classificationRule, explainSegments, indexStatus, indicatorErrorText, segmentShareText, unknownVariableText,
} from '../../lib/indicatorView.js';

/**
 * « Comment c'est calculé » — explication d'un indicateur sur les soumissions
 * réelles de la période, chiffre par chiffre : soumissions examinées, écartées
 * (sans la variable, vides, hors base), base, numérateur ÷ dénominateur,
 * répartition des réponses avec leur rôle, et la règle de classement
 * appliquée. Le serveur calcule avec LE moteur des résultats
 * (monitoringMath.explainIndicator) : la valeur affichée est celle des
 * tableaux de bord. Utilisé par l'éditeur d'indicateur et l'onglet « Méthode »
 * du détail.
 */

/** Aperçu du calcul d'une définition, recalculé 450 ms après la dernière modification. */
export function useIndicatorPreview(formId, body, { enabled = true } = {}) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!enabled || !formId || !body || !String(body.sourceField || '').trim()) {
      setState({ loading: false, data: null, error: null });
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const h = setTimeout(() => {
      api.monIndicatorPreview(formId, body)
        .then((data) => alive && setState({ loading: false, data, error: null }))
        // L'erreur garde son statut et ses détails structurés : la phrase est refaite dans la langue de l'interface.
        .catch((e) => alive && setState({ loading: false, data: null, error: { message: e.message, status: e.status, details: e.details } }));
    }, 450);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, key, enabled]);
  return state;
}

// Rôle d'une réponse dans le calcul : couleur + icône + libellé (jamais la couleur seule).
const ROLE = {
  positive: { label: 'Comptée positive', tone: 'green', icon: CheckCircle2 },
  negative: { label: 'Comptée négative', tone: null, icon: MinusCircle },
  counted: { label: 'Comptée', tone: 'blue', icon: CheckCircle2 },
  ignored: { label: 'Ignorée (non numérique)', tone: 'orange', icon: AlertTriangle },
  na: { label: 'Hors base', tone: 'orange', icon: Ban },
  blank: { label: 'Sans réponse', tone: null, icon: Circle },
  absent: { label: 'Sans la variable', tone: null, icon: Circle },
};
// Libellés de la barre « d'où vient la base ».
const SEGMENT = {
  positive: 'Positives', negative: 'Négatives', counted: 'Comptées', ignored: 'Ignorées',
  na: 'Hors base', blank: 'Sans réponse', absent: 'Sans la variable',
};

const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString(formatLocale(), { maximumFractionDigits: 2 }));
const withLabel = (v, label) => (label && label !== v ? `${v} — ${label}` : v);

function RoleBadge({ role }) {
  const { tr } = useI18n();
  const r = ROLE[role];
  if (!r) return null;
  return <Badge tone={r.tone} icon={r.icon}>{tr(r.label)}</Badge>;
}

/** Phrase de la règle de classement appliquée (classifyDetail). */
function RuleText({ explain, direction, scored }) {
  const { tr } = useI18n();
  const c = explain.classification;
  const rule = classificationRule(c, direction);
  const label = tr((INDICATOR_STATUS[c.rating] || INDICATOR_STATUS.na).label);
  let text;
  if (rule.key === 'no_data') text = tr('Aucune réponse comptée sur la période : l\'indicateur n\'est pas évalué.');
  else if (rule.key === 'no_target') text = tr('Moyenne, somme ou nombre sans cible : l\'indicateur n\'est pas classé. Ajoutez une cible pour l\'évaluer.');
  else if (rule.key === 'target_met') text = tr('Cible {target} atteinte → {label}.', { target: fmtNum(rule.vars.target), label });
  else if (rule.key === 'target_gap') {
    text = tr('Écart à la cible {target} : {gap} % (≤ {sat} % : Satisfaisant ; ≤ {imp} % : À améliorer ; au-delà : Action urgente) → {label}.', {
      target: fmtNum(rule.vars.target), gap: fmtNum(rule.vars.gap), sat: rule.vars.sat, imp: rule.vars.imp, label,
    });
  } else {
    text = rule.vars.lower
      ? tr('Sans cible : score orienté = 100 − valeur (plus bas = mieux) = {oriented}, {band} → {label} (bandes 80 / 65 / 50).', { oriented: fmtNum(rule.vars.oriented), band: rule.vars.band, label })
      : tr('Sans cible : score {oriented} {band} → {label} (bandes 80 / 65 / 50).', { oriented: fmtNum(rule.vars.oriented), band: rule.vars.band, label });
  }
  return (
    <div className="ix-rule">
      <div className="ix-rule-head"><StatusBadge def={INDICATOR_STATUS[c.rating] || INDICATOR_STATUS.na} /> <span>{text}</span></div>
      {scored != null && <div className="muted ix-small">{{
        not_pct: tr('Seuls les indicateurs en % entrent dans l\'indice de conformité.'),
        in: tr('Compte dans l\'indice de conformité de la fiche.'),
        excluded: tr('Hors indice : affiché, mais n\'entre pas dans l\'indice de conformité.'),
      }[indexStatus({ agg: explain.agg, scored })]} {{
        counted: tr('Compté dans les classes de Couverture & performance.'),
        complementary: tr('Complémentaire : hors des classes de Couverture & performance.'),
      }[classesStatus({ scored })]}</div>}
    </div>
  );
}

/** Ligne de calcul : numérateur ÷ dénominateur = valeur, selon la méthode. */
function Formula({ x, positives }) {
  const { tr } = useI18n();
  const value = x.value == null ? '—' : fmtNum(x.value);
  if (x.agg === 'mean') {
    return <>{x.denominator ? tr('Somme {sum} ÷ {n} réponse(s) numérique(s) = {value}', { sum: fmtNum(x.numerator), n: formatInt(x.denominator), value }) : tr('Aucune réponse numérique : pas de moyenne.')}</>;
  }
  if (x.agg === 'sum') return <>{tr('Somme des {n} réponse(s) numérique(s) = {value}', { n: formatInt(x.base), value })}</>;
  if (x.agg === 'count') return <>{tr('{n} réponse(s) renseignée(s) = {value}', { n: formatInt(x.base), value })}</>;
  if (!x.denominator) return <>{tr('Aucune réponse comptée : pas de pourcentage.')}</>;
  return (
    <>{tr('{num} réponse(s) {values} ÷ {den} réponse(s) comptée(s) = {value} %', {
      num: formatInt(x.numerator), den: formatInt(x.denominator), value,
      values: positives,
    })}</>
  );
}

/**
 * @param {{ preview: {loading, data, error}, direction?: string, scored?: boolean, periodLabel?: string }} props
 */
export default function IndicatorExplain({ preview, direction, scored, periodLabel }) {
  const { tr } = useI18n();
  const d = preview.data;
  if (preview.error) return <Alert tone="error" icon={AlertTriangle}>{indicatorErrorText(preview.error, tr)}</Alert>;
  if (!d) {
    return preview.loading ? <Skeleton height={180} /> : <p className="muted ix-small">{tr('Choisissez une variable pour voir comment l\'indicateur est calculé.')}</p>;
  }
  const x = d.explain;
  const labels = new Map((d.variable?.choices || []).map((c) => [String(c.value), choiceText(c.label, tr)]));
  const positives = x.positiveValues.length
    ? x.positiveValues.map((v) => tr('« {v} »', { v: withLabel(v, labels.get(v)) })).join(tr(' ou '))
    : tr('« oui » (oui, yes, 1, true, vrai)');
  const segments = explainSegments(x);
  const period = d.period?.month ? monthLabel(d.period.month) : (periodLabel || tr('Toutes les périodes'));
  return (
    <div className={`ix${preview.loading ? ' is-stale' : ''}`} aria-live="polite">
      {preview.loading && <span className="ix-loading muted"><Loader2 size={13} className="spin" aria-hidden="true" /> {tr('Recalcul…')}</span>}
      {d.check && d.check.known === false && (
        <Alert tone="warning" icon={AlertTriangle}>{d.check.code ? unknownVariableText(d.check.name, d.check.suggestion, tr) : d.check.error}</Alert>
      )}
      {d.check && d.check.known && <Alert tone="info" icon={Info}>{tr('La variable « {name} » n\'a aucune réponse sur cette période.', { name: d.check.name })}</Alert>}
      {d.variable && (
        <div className="ix-var">
          <span className="mono">{d.variable.name}</span>
          {d.variable.label && <span className="ix-var-label" title={d.variable.label}>{d.variable.label}</span>}
        </div>
      )}

      <div className="ix-value">
        <div>
          <div className="ix-value-big tabular">{x.value == null ? '—' : `${fmtNum(x.value)}${x.agg === 'percent_yes' || x.agg === 'percent_value' ? ' %' : ''}`}</div>
          <div className="muted ix-small">{tr('{period} · base {base} réponse(s)', { period, base: formatInt(x.base) })}</div>
        </div>
      </div>

      <ol className="ix-steps">
        <li><span className="ix-n tabular">{formatInt(x.total)}</span> {tr('soumission(s) sur la période (hors soumissions exclues)')}</li>
        {x.absent > 0 && <li className="is-out"><span className="ix-n tabular">− {formatInt(x.absent)}</span> {tr('sans la variable (question absente de cette version du formulaire, ou non posée)')}</li>}
        {x.blank > 0 && <li className="is-out"><span className="ix-n tabular">− {formatInt(x.blank)}</span> {tr('sans réponse (vide)')}</li>}
        {x.naCount > 0 && (
          <li className="is-out"><span className="ix-n tabular">− {formatInt(x.naCount)}</span> {tr('hors base : {codes}', {
            codes: x.na.map((r) => `${withLabel(r.value, choiceText(r.label, tr))} (${formatInt(r.n)})`).join(', '),
          })}</li>
        )}
        {x.ignored > 0 && <li className="is-out"><span className="ix-n tabular">− {formatInt(x.ignored)}</span> {tr('réponse(s) non numérique(s), ignorée(s)')}</li>}
        <li className="is-base"><span className="ix-n tabular">= {formatInt(x.base)}</span> {tr('réponse(s) comptée(s) : la base du calcul')}</li>
      </ol>
      <div className="ix-formula"><Formula x={x} positives={positives} /></div>

      {segments.length > 0 && (
        <div className="ix-bar-wrap">
          {/* Parts rapportées à TOUTES les soumissions de la période (≠ % de l'indicateur, calculé sur la base). */}
          <div className="muted ix-small ix-bar-cap">{tr('Répartition des {n} soumission(s) de la période :', { n: formatInt(x.total) })}</div>
          <div className="ix-bar" role="img" aria-label={segments.map((s) => `${tr(SEGMENT[s.key])} ${s.n} (${segmentShareText(s, tr, fmtNum)})`).join(', ')}>
            {segments.map((s) => <span key={s.key} className={`ix-seg is-${s.key}`} style={{ width: `${Math.max(s.pct, 0.8)}%` }} />)}
          </div>
          <ul className="ix-legend">
            {segments.map((s) => (
              <li key={s.key}><span className={`ix-swatch is-${s.key}`} aria-hidden="true" />{tr(SEGMENT[s.key])} <b className="tabular">{formatInt(s.n)}</b> <span className="muted">({segmentShareText(s, tr, fmtNum)})</span></li>
            ))}
          </ul>
        </div>
      )}

      {(x.distribution.length > 0 || x.na.length > 0 || x.blank > 0) && (
        <div className="table-wrap ix-dist">
          <table className="table table-compact">
            <thead><tr><th scope="col">{tr('Réponse')}</th><th scope="col" className="num">{tr('Soumissions')}</th><th scope="col">{tr('Rôle dans le calcul')}</th></tr></thead>
            <tbody>
              {x.distribution.map((r) => (
                <tr key={`v:${r.value}`}><td><span className="mono">{r.value}</span>{r.label && <span className="ix-choice"> — {choiceText(r.label, tr)}</span>}</td><td className="num tabular">{formatInt(r.n)}</td><td><RoleBadge role={r.role} /></td></tr>
              ))}
              {x.others.n > 0 && (
                <tr><td className="muted">{tr('{n} autre(s) valeur(s)', { n: formatInt(x.distinct - x.distribution.length) })}</td><td className="num tabular">{formatInt(x.others.n)}</td>
                  <td className="muted ix-small">{x.agg === 'percent_yes' || x.agg === 'percent_value' ? tr('dont {n} positive(s)', { n: formatInt(x.others.positives) }) : ''}</td></tr>
              )}
              {x.na.map((r) => (
                <tr key={`na:${r.value}`}><td><span className="mono">{r.value}</span>{r.label && <span className="ix-choice"> — {choiceText(r.label, tr)}</span>}</td><td className="num tabular">{formatInt(r.n)}</td><td><RoleBadge role="na" /></td></tr>
              ))}
              {x.blank > 0 && <tr><td className="muted">{tr('(vide)')}</td><td className="num tabular">{formatInt(x.blank)}</td><td><RoleBadge role="blank" /></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <RuleText explain={x} direction={direction} scored={scored} />
      <a className="fx-doclink" href="#/processus/calculs" target="_blank" rel="noopener noreferrer">
        <BookOpen size={14} aria-hidden="true" /> {tr('Comment les calculs sont faits')}
      </a>
    </div>
  );
}
