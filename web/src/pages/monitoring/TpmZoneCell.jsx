import React from 'react';
import { STATUS_ICONS } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { shortMonthLabel } from '../../lib/format.js';
import { TPM_ZONE_STATE, detachedHint, rangeLabel } from '../../lib/tpmAttribution.js';
import './tpmAttribution.css';

/** Adresse de l'onglet « Affectation des TPM » de l'espace RBM. */
export const TPM_TAB_HREF = '#/processus/rbm/tpm';

/** Visites de l'exercice dont le TPM diffère de celui de leur zone ce mois-là (écart motivé ou reprise). */
export function divergentVisits(months, segments, year) {
  let n = 0;
  for (const c of months || []) {
    if (!c || c.status === 'annule' || !c.provider) continue;
    const m = `${year}-${String(c.month).padStart(2, '0')}`;
    const seg = (segments || []).find((s) => s.from <= m && m <= s.to);
    if (seg && (seg.providerName || null) !== c.provider) n += 1;
  }
  return n;
}

/**
 * Colonne « Prestataire (TPM) » du Plan de suivi (retour 58) : le TPM de la ZONE du site
 * (contrats de suivi, ou modification motivée), au mois de référence, avec son origine — couleur +
 * icône + libellé, jamais la couleur seule. L'infobulle donne les segments de l'exercice et les
 * visites qui portent un autre TPM. Sans TPM : « À affecter » dit, au survol, comment en obtenir un
 * (jamais un lien vers un onglet qui n'existe pas encore).
 * @param {{ tpm: { ref, refMonth, segments }|null, months: object[] }} props
 */
export default function TpmZoneCell({ tpm, months }) {
  const { tr } = useI18n();
  if (!tpm || !tpm.ref) return <td className="pb-tpm"><span className="cell-empty">—</span></td>;
  const { ref, refMonth, segments = [] } = tpm;
  const def = TPM_ZONE_STATE[ref.state] || TPM_ZONE_STATE.sans_contrat;
  const Icon = STATUS_ICONS[def.icon];
  const year = refMonth.slice(0, 4);
  const when = shortMonthLabel(refMonth);
  const origin = {
    contrat: tr('contrat {n}', { n: ref.contractLabel || ref.numero || '' }),
    modifie: tr('modifié : {r}', { r: ref.reason || '' }),
    aucun_tpm: tr('aucun TPM, décidé : {r}', { r: ref.reason || '' }),
    a_arbitrer: tr('{n} contrats : choisir', { n: (ref.candidates || []).length || 2 }),
    sans_contrat: detachedHint(tr, ref) || tr('aucun contrat actif sur cette zone ce mois ({m})', { m: when }),
    district_inconnu: tr('district du site non reconnu'),
  }[ref.state] || '';
  const assigned = Boolean(ref.providerId);
  // Autres périodes de l'exercice qui ont un TPM (ex. contrat échu : « ASSOCIATION AINA janv. – sept. »).
  const others = segments.filter((s) => s.providerName && !(s.from <= refMonth && refMonth <= s.to) && s.providerName !== ref.providerName);
  const diff = divergentVisits(months, segments, year);
  const segText = (s) => {
    const what = s.providerName
      ? `${s.providerName} (${s.state === 'contrat' ? tr('contrat {n}', { n: s.contractLabel || s.numero || '' }) : tr((TPM_ZONE_STATE[s.state] || def).label)})`
      : tr((TPM_ZONE_STATE[s.state] || def).label);
    return `${rangeLabel(s.from, s.to)} : ${what}`;
  };
  const tooltip = [
    tr('Règle : le TPM d\'un site est celui du contrat de suivi actif qui couvre son district (ou sa commune) ce mois-là — le TPM qui facture sur ce contrat, sinon son titulaire ; une modification exige une raison.'),
    tr('TPM de la zone du site, exercice {y} :', { y: year }),
    ...segments.map(segText),
    ...(diff ? [tr('{n} visite(s) de l\'exercice portent un autre TPM (écart motivé ou saisi avant la règle).', { n: diff })] : []),
    ...(ref.providerId ? [] : [tr('Pour affecter un TPM : ajoutez cette zone aux zones d\'intervention d\'un contrat de suivi actif (Contrats), ou choisissez un TPM pour une visite, avec une raison (Affectation & visites, crayon).')]),
  ].join('\n');
  return (
    <td className={`pb-tpm tpm-tone-${def.tone || 'none'}`} title={tooltip}>
      <span className="pb-tpm-main">
        <Icon size={13} aria-hidden="true" className="pb-tpm-ic" />
        {assigned
          ? <span className="pb-tpm-name">{ref.providerName}</span>
          : <span className="pb-tpm-name pb-tpm-todo">{tr('À affecter')}</span>}
        {diff > 0 && <span className="pb-tpm-diff" aria-label={tr('{n} visite(s) avec un autre TPM', { n: diff })}>≠ {diff}</span>}
      </span>
      <span className="pb-tpm-origin">{origin}</span>
      {others.length > 0 && (
        <span className="pb-tpm-more">{others.slice(0, 1).map((s) => `${s.providerName} ${rangeLabel(s.from, s.to)}`).join('')}{others.length > 1 ? ` +${others.length - 1}` : ''}</span>
      )}
    </td>
  );
}
