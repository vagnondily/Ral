import React, { useEffect, useId, useState } from 'react';
import {
  AlertTriangle, ArrowDownCircle, CalendarClock, CheckCircle2, CircleDot, Clock, Flag, Info, ShieldAlert, SlidersHorizontal,
} from 'lucide-react';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { Alert, Badge, Button, Skeleton } from '../../components/ui.jsx';
import { monthLabel } from '../../lib/format.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * RBM — « pourquoi ce drapeau ? » (retour n° 48). Le badge du SCORE FINAL et le
 * drapeau « urgent » sont des boutons qui ouvrent un panneau en trois parties :
 *   - Pourquoi ?   les règles qui ont compté, avec la valeur du site et ses points
 *                  (urgentes d'abord) ;
 *   - Conséquence  niveau, priorité (et sa justification), fréquence de suivi,
 *                  dernière visite réelle, visite prévue, état du mois ;
 *   - Que faire ?  actions courtes, avec le mois concerné.
 * Tout vient du serveur (rbmScore.scoreSite : reasons / consequence / actions,
 * GET /rbm/sites/:id) : l'écran ne recalcule rien. Panneau = Modal « drawer » :
 * Échap, piège du focus et retour du focus au bouton qui l'a ouvert.
 */

// Couleur + icône + libellé (jamais la couleur seule).
const SCORE_STYLE = { 0: { tone: 'green', icon: CheckCircle2 }, 1: { tone: 'orange', icon: CircleDot }, 2: { tone: 'red', icon: AlertTriangle } };
const PRIORITY_STYLE = { 0: { tone: 'green', icon: ArrowDownCircle }, 1: { tone: 'orange', icon: CircleDot }, 2: { tone: 'red', icon: AlertTriangle } };

const PRIORITY_BASIS = {
  urgent: 'Un drapeau urgent ⇒ priorité haute.',
  highOverdue: 'Niveau élevé et visite en retard ⇒ priorité haute.',
  high: 'Niveau élevé, mais visite à jour ⇒ priorité moyenne.',
  overdue: 'Visite en retard ou jamais faite ⇒ priorité moyenne.',
  medium: 'Niveau moyen ⇒ priorité moyenne.',
  low: 'Niveau faible et visite à jour ⇒ priorité basse.',
};
const VISIT_SOURCE = { visite: 'visite réalisée', donnees: 'collecte de données reçue', registre: 'date du registre' };

const stop = (e) => e.stopPropagation();
const fmtMonth = (m) => (m ? monthLabel(m) : null);

/** Badge du SCORE FINAL cliquable (ouvre l'explication). */
export function ScoreButton({ site, onOpen }) {
  const { tr } = useI18n();
  const st = SCORE_STYLE[site.finalScore];
  if (!st) return <span className="cell-empty">—</span>;
  return (
    <button type="button" className="rbm-why" aria-haspopup="dialog" onClick={(e) => { stop(e); onOpen(site); }} onDoubleClick={stop}
      title={tr('Pourquoi ce niveau ?')} aria-label={tr('Niveau {level} — pourquoi ? ({site})', { level: tr(site.finalLabel), site: site.name })}>
      <Badge tone={st.tone} icon={st.icon}>{tr(site.finalLabel)}</Badge>
      <Info size={13} aria-hidden="true" className="rbm-why-ic" />
    </button>
  );
}

/** Drapeau « urgent » cliquable (ouvre la même explication). */
export function UrgentButton({ site, onOpen }) {
  const { tr } = useI18n();
  return (
    <button type="button" className="rbm-flag" aria-haspopup="dialog" onClick={(e) => { stop(e); onOpen(site); }} onDoubleClick={stop}
      title={tr('Pourquoi urgent ?')} aria-label={tr('Drapeau urgent — pourquoi ? ({site})', { site: site.name })}>
      <Flag size={12} aria-hidden="true" /> {tr('urgent')}
    </button>
  );
}

function Section({ title, children }) {
  const id = useId();
  return (
    <section className="rbm-explain-sec" aria-labelledby={id}>
      <h3 className="rbm-explain-h" id={id}>{title}</h3>
      {children}
    </section>
  );
}

/** Dernière visite réelle (jamais une visite seulement prévue). */
function lastVisitText(tr, site, c) {
  if (!c.lastVisitMonth) return tr('Jamais visité (aucune visite réalisée ni donnée collectée)');
  const parts = [fmtMonth(c.lastVisitMonth)];
  if (site.lastVisitSource) parts.push(tr(VISIT_SOURCE[site.lastVisitSource]));
  if (c.monthsSinceVisit != null && c.monthsSinceVisit >= 0) parts.push(tr('il y a {n} mois', { n: c.monthsSinceVisit }));
  return parts.join(' · ');
}

/** « une visite par mois » / « une visite tous les n mois ». */
const frequencyText = (tr, n) => (n === 1 ? tr('une visite par mois') : tr('une visite tous les {n} mois', { n }));

function dueText(tr, due, c) {
  if (due) {
    if (c.neverVisited) return tr('À suivre : aucune visite réalisée ni donnée collectée.');
    if (c.frequencyMonths != null) return tr('À suivre : {n} mois depuis la dernière visite (fréquence : {freq}).', { n: c.monthsSinceVisit, freq: frequencyText(tr, c.frequencyMonths) });
    return tr('À suivre : visite en retard.');
  }
  return c.nextDueMonth ? tr('À jour : prochain suivi dû en {m}.', { m: fmtMonth(c.nextDueMonth) }) : tr('À jour.');
}

/**
 * Panneau d'explication d'un site RBM. La liste ne porte que le score : l'explication
 * d'UN site est demandée à l'ouverture (GET /rbm/sites/:id), calculée par la même
 * fonction serveur que la liste — la liste de tous les sites reste légère.
 */
export function RbmExplainDrawer({ site: row, month, onClose, onEditCriteria }) {
  const { tr } = useI18n();
  const [site, setSite] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setSite(null); setError(null);
    api.rbmSiteExplain(row.id, month)
      .then((s) => { if (alive) setSite(s); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [row.id, month]);
  const place = [row.adm2 || row.district, row.adm3 || row.commune].filter(Boolean).join(' › ');
  return (
    <Modal open variant="drawer" onClose={onClose} title={row.name}
      subtitle={tr('{place} — situation de {month}', { place: place || '—', month: fmtMonth(month) || '—' })}
      footer={<>
        {onEditCriteria && <Button variant="secondary" icon={SlidersHorizontal} onClick={() => onEditCriteria(row)}>{tr('Éditer les critères')}</Button>}
        <Button onClick={onClose}>{tr('Fermer')}</Button>
      </>}>
      {error && <Alert tone="error">{error}</Alert>}
      {!error && !site && <div aria-busy="true" aria-label={tr('Chargement…')} className="rbm-explain-sec">
        <Skeleton height={22} width="60%" /><Skeleton height={56} /><Skeleton height={56} /><Skeleton height={120} />
      </div>}
      {site && <ExplainBody site={site} />}
    </Modal>
  );
}

function ExplainBody({ site }) {
  const { t, tr } = useI18n();
  const c = site.consequence || {};
  // « Moyenne » seul se traduit comme la moyenne statistique : la priorité passe par ses clés.
  const prioLabel = c.priorityLabel ? t(`priority.${c.priorityLabel}`, c.priorityLabel) : '—';
  const reasons = site.reasons || [];
  const actions = site.actions || [];
  const score = SCORE_STYLE[c.finalScore];
  const prio = PRIORITY_STYLE[c.priority];
  const due = Boolean(site.due);
  return (
    <>
      <div className="rbm-explain-badges">
        {score && <Badge tone={score.tone} icon={score.icon}>{tr('Niveau {level}', { level: tr(c.finalLabel) })}</Badge>}
        {prio && <Badge tone={prio.tone} icon={prio.icon}>{tr('Priorité {p}', { p: prioLabel.toLowerCase() })}</Badge>}
        {due
          ? <Badge tone="blue" icon={Clock}>{tr('À suivre')}</Badge>
          : <Badge tone="green" icon={CheckCircle2}>{tr('À jour')}</Badge>}
      </div>

      <Section title={tr('Pourquoi ?')}>
        {reasons.length ? (
          <ul className="rbm-reasons">
            {reasons.map((r) => (
              <li key={r.code} className={r.urgent ? 'is-urgent' : ''}>
                <span className="rbm-reason-ic" aria-hidden="true">{r.urgent ? <Flag size={14} /> : <CircleDot size={14} />}</span>
                <span className="rbm-reason-text">
                  <strong>{tr(r.label)}</strong>
                  <span>{r.valueLabel ? tr(r.valueLabel) : String(r.value)} <span className="muted">({tr('valeur {v}', { v: r.value })})</span></span>
                </span>
                <span className="rbm-reason-pts">
                  {r.urgent && <span className="rbm-reason-urgent">{tr('urgent')}</span>}
                  <span className="tabular">{tr('+{n} pt', { n: r.points })}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">{tr('Aucun critère de risque renseigné pour ce site.')}</p>}
        <p className="rbm-rule">
          {c.basis === 'urgent'
            ? tr('Règle : un drapeau urgent (problème urgent, fraude, sécurité stricte ou zone interdite) place le site au niveau Élevé, quel que soit le total ({n} point(s)).', { n: c.riskPoints })
            : tr('Règle : {n} point(s) de risque — 4 et plus = Élevé, 2 à 3 = Moyen, moins de 2 = Faible.', { n: c.riskPoints })}
        </p>
      </Section>

      <Section title={tr('Conséquence')}>
        <dl className="rbm-kv">
          <dt>{tr('Niveau final')}</dt><dd>{tr(c.finalLabel)}</dd>
          <dt>{tr('Priorité')}</dt><dd>{prioLabel}{PRIORITY_BASIS[c.priorityBasis] && <span className="muted"> — {tr(PRIORITY_BASIS[c.priorityBasis])}</span>}</dd>
          <dt>{tr('Fréquence de suivi')}</dt>
          <dd>{c.frequencyMonths != null ? frequencyText(tr, c.frequencyMonths) : '—'}</dd>
          <dt>{tr('Dernière visite')}</dt><dd>{lastVisitText(tr, site, c)}</dd>
          {(c.nextPlannedMonth || c.latePlannedMonth) && <>
            <dt>{tr('Visite prévue')}</dt>
            <dd>
              {c.nextPlannedMonth && <span className="rbm-planned"><CalendarClock size={13} aria-hidden="true" /> {fmtMonth(c.nextPlannedMonth)}</span>}
              {c.latePlannedMonth && <span className="rbm-planned is-late"><ShieldAlert size={13} aria-hidden="true" /> {tr('{m} (non réalisée)', { m: fmtMonth(c.latePlannedMonth) })}</span>}
              <span className="muted rbm-note">{tr('Une visite prévue ne compte pas comme visite tant qu\'elle n\'est pas marquée « réalisée ».')}</span>
            </dd>
          </>}
          <dt>{tr('Ce mois')}</dt><dd>{dueText(tr, due, c)}</dd>
        </dl>
      </Section>

      <Section title={tr('Que faire ?')}>
        <ol className="rbm-actions">
          {actions.map((a) => (
            <li key={a.code}>
              <span>{tr(a.label)}</span>
              {a.month && <span className="rbm-action-month"><CalendarClock size={13} aria-hidden="true" /> {fmtMonth(a.month)}</span>}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
