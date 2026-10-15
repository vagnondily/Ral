import React from 'react';
import { ShieldAlert, ListChecks, MapPin, SlidersHorizontal, UserCog } from 'lucide-react';
import { PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import RbmPage from './RbmPage.jsx';
import PlanBoardPage from './PlanBoardPage.jsx';
import SitesActivationPage from './SitesActivationPage.jsx';
import MmrSection from '../settings/MmrSection.jsx';
import TpmAttributionTab from './TpmAttributionTab.jsx';

/**
 * Espace « RBM » : tout le suivi par les risques au même endroit, en onglets
 * nettement séparés (retour du 14/10 : « divise bien ») :
 *   - Priorités du mois : niveau de risque, sites à suivre, génération des visites ;
 *   - Plan de suivi : QUAND visiter — le plan, les sites déjà visités, la carte ;
 *   - Affectation des TPM : QUI suit chaque zone chaque mois — le TPM des contrats de
 *     suivi, modifiable avec une raison (retour 58 ; lien profond ?zone=…&m=AAAA-MM) ;
 *   - Sites (actifs / inactifs) : SI un site est actif chaque mois, avant de
 *     planifier (grille du classeur d'activation, journal des changements) ;
 *   - Configuration RBM : critères de risque des sites (vue standard du
 *     registre RBM) et exigences minimales de suivi (MMR) ; la planification
 *     automatique s'y ajoutera.
 * Chaque onglet réutilise l'écran existant : une seule saisie, un seul calcul.
 */
const TABS = [
  { id: 'priorites', label: 'Priorités du mois', icon: ShieldAlert },
  { id: 'plan', label: 'Plan de suivi', icon: ListChecks },
  { id: 'sites', label: 'Sites (actifs / inactifs)', icon: MapPin },
  { id: 'tpm', label: 'Affectation des TPM', icon: UserCog },
  { id: 'configuration', label: 'Configuration RBM', icon: SlidersHorizontal },
];
const CONFIG_SECTIONS = [
  { id: 'risques', label: 'Critères de risque des sites' },
  { id: 'mmr', label: 'Exigences (MMR)' },
];
const TAB_HELP = {
  priorites: 'Sites à suivre ce mois selon leur niveau de risque ; « Générer » planifie leurs visites.',
  plan: 'Visites exigées par le MMR, faites, prévues et restantes, avec le prestataire de suivi affecté.',
  sites: 'Pour chaque site du registre, actif (Oui) ou inactif (Non) chaque mois, avant de planifier. Exportez le classeur, complétez-le hors ligne, puis réimportez-le.',
  tpm: 'Qui suit quelle zone chaque mois : le TPM des contrats de suivi par région › district, modifiable avec une raison.',
  configuration: 'Ce qui règle le suivi par les risques : les critères de risque de chaque site et les exigences minimales de suivi (MMR) par bureau et activité.',
};
// Anciennes adresses : « exigences » mène à Configuration › Exigences (MMR).
const LEGACY = { exigences: ['configuration', 'mmr'] };

export default function RbmSpacePage({ canEdit, isAdmin, tab, onTab }) {
  const { tr } = useI18n();
  const [legacyTab, legacySection] = LEGACY[tab] || [];
  const current = legacyTab || (TABS.some((x) => x.id === tab) ? tab : 'priorites');
  const [section, setSection] = React.useState(legacySection || 'risques');
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
        {current === 'plan' && <PlanBoardPage key="plan" canEdit={canEdit} embedded initialView="plan" views={['plan', 'visited', 'map']} />}
        {current === 'sites' && <SitesActivationPage canEdit={canEdit} />}
        {current === 'tpm' && <TpmAttributionTab canEdit={canEdit} />}
        {current === 'configuration' && (
          <>
            <div className="segmented rbm-config-nav" role="tablist" aria-label={tr('Configuration RBM')}>
              {CONFIG_SECTIONS.map((x) => (
                <button key={x.id} type="button" role="tab" aria-selected={section === x.id} aria-pressed={section === x.id} onClick={() => setSection(x.id)}>{tr(x.label)}</button>
              ))}
            </div>
            {section === 'risques' && <PlanBoardPage key="risques" canEdit={canEdit} embedded initialView="standard" views={['standard']} />}
            {section === 'mmr' && <MmrSection isAdmin={isAdmin} />}
          </>
        )}
      </div>
    </div>
  );
}
