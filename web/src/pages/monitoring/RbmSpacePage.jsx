import React from 'react';
import { ShieldAlert, ListChecks, MapPin, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import RbmPage from './RbmPage.jsx';
import PlanBoardPage from './PlanBoardPage.jsx';
import MmrSection from '../settings/MmrSection.jsx';

/**
 * Espace « RBM » (retour n° 7) : tout le suivi par les risques au même endroit,
 * en onglets, au lieu de trois écrans séparés.
 *   - Priorités du mois : niveau de risque, sites à suivre, génération des visites ;
 *   - Plan de suivi : visites exigées / faites / prévues par site, avec le
 *     prestataire de suivi (TPM) affecté ;
 *   - Sites : registre, sites actifs ou inactifs par mois, aller-retour Excel
 *     (listes du découpage, GPS facultatif) ;
 *   - Exigences : paramètres MMR (fréquences et volumes par bureau × activité).
 * Chaque onglet réutilise l'écran existant : une seule saisie, un seul calcul.
 */
const TABS = [
  { id: 'priorites', label: 'Priorités du mois', icon: ShieldAlert },
  { id: 'plan', label: 'Plan de suivi', icon: ListChecks },
  { id: 'sites', label: 'Sites (actifs / inactifs)', icon: MapPin },
  { id: 'exigences', label: 'Exigences (MMR)', icon: SlidersHorizontal },
];
const TAB_HELP = {
  priorites: 'Sites à suivre ce mois selon leur niveau de risque ; « Générer » planifie leurs visites.',
  plan: 'Visites exigées par le MMR, faites, prévues et restantes, avec le prestataire de suivi affecté.',
  sites: 'Registre des sites : activité, bureau, lieux, GPS facultatif et statut actif / inactif par mois. Exportez le classeur Excel, complétez-le hors ligne (listes du découpage), puis réimportez-le.',
  exigences: 'Exigences minimales de suivi (MMR) par bureau et activité : durée, fréquence, nombre de sites.',
};

export default function RbmSpacePage({ canEdit, isAdmin, tab, onTab }) {
  const { tr } = useI18n();
  const current = TABS.some((x) => x.id === tab) ? tab : 'priorites';
  return (
    <div className="section-gap">
      <PageHeader title={tr('RBM — suivi par les risques')} description={tr(TAB_HELP[current])} />
      <div className="seg rbm-tabs" role="tablist" aria-label={tr('Espace RBM')}>
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={current === x.id} className={current === x.id ? 'is-active' : ''} onClick={() => onTab(x.id)}>
            <x.icon size={15} aria-hidden="true" /> {tr(x.label)}
          </button>
        ))}
      </div>
      <div className="rbm-tab-body">
        {current === 'priorites' && <RbmPage canEdit={canEdit} embedded />}
        {current === 'plan' && <PlanBoardPage key="plan" canEdit={canEdit} embedded initialView="plan" />}
        {current === 'sites' && <PlanBoardPage key="sites" canEdit={canEdit} embedded initialView="standard" />}
        {current === 'exigences' && <MmrSection isAdmin={isAdmin} />}
      </div>
    </div>
  );
}
