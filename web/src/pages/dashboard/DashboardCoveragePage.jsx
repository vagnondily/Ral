import React, { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { usePeriod } from '../../components/PeriodBanner.jsx';
import { peekMapOpen, forgetMapOpen } from '../../components/map/MapExplorer.jsx';
import { PERIOD_CAPS } from '../../lib/periodCaps.js';
import { useI18n } from '../../lib/i18n.jsx';
import CoverageTemplate from './coverage/CoverageTemplate.jsx';

/** Durée maximale : celle des endpoints d'analyse (indicateurs relus sur la période, lib/periodCaps). */
const ANALYSIS_MAX_SPAN = PERIOD_CAPS.analysis;

/**
 * Dashboard décisionnel › « Couverture & performance du suivi » — le tableau de bord de la
 * maquette de l'utilisateur (retours 40, 66, 67, 85), section par section, rempli par MEMS
 * (pages/dashboard/coverage/*). Cette page ne tient que l'en-tête et la période commune
 * (lot 1b : URL, puis période de travail de la session, puis le dernier mois substantiel avec
 * des données, dit par PeriodBanner) ; le bureau, les activités et les pages sont dans
 * CoverageTemplate. « Ouvrir la carte » (Vue d'ensemble du Dashboard) passe la période par
 * l'URL (#/dashboard/couverture?from=…&to=…) et le thème / les filtres par
 * sessionStorage['mems.map.open'], lus une fois ici.
 */
export default function DashboardCoveragePage({ onNavigate }) {
  const { tr } = useI18n();
  const per = usePeriod({ scope: 'analysis', defaultRule: 'data', maxSpan: ANALYSIS_MAX_SPAN });
  const [opened] = useState(() => peekMapOpen());
  useEffect(() => { forgetMapOpen(); }, []);

  return (
    <div className="section-gap">
      <PageHeader title={tr('Couverture & performance du suivi')}
        description={tr('Par activité : couverture des sites, visites, indice de conformité, modules, carte, bureaux, signaux de risque et qualité de saisie. Recalculé en direct à partir des données de MEMS.')}>
        {per.ready && <PeriodSelect value={per.period} onChange={per.setPeriod} counts={per.counts} latest={per.latest} today={per.today} maxSpan={ANALYSIS_MAX_SPAN} align="right" />}
      </PageHeader>
      <CoverageTemplate per={per} opened={opened} onNavigate={onNavigate} />
    </div>
  );
}
