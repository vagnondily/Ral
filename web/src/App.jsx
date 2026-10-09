import React, { useCallback, useEffect, useState } from 'react';
import { getStoredUser, getToken, onUnauthorized, setSession } from './api/client.js';
import AppShell, { findRoute } from './components/AppShell.jsx';
import { ToastProvider, useToast } from './components/Toast.jsx';
import { I18nProvider } from './lib/i18n.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ProvidersPage from './pages/ProvidersPage.jsx';
import ContractsListPage from './pages/contracts/ContractsListPage.jsx';
import ContractDetailPage from './pages/contracts/ContractDetailPage.jsx';
import ContractFormPage from './pages/contracts/ContractFormPage.jsx';
import ReportsPage from './pages/tpm/ReportsPage.jsx';
import ConsolidationPage from './pages/dashboard/ConsolidationPage.jsx';
import DashboardBIPage from './pages/dashboard/DashboardBIPage.jsx';
import DashboardCoveragePage from './pages/dashboard/DashboardCoveragePage.jsx';
import AlertsPage from './pages/dashboard/AlertsPage.jsx';
import ReportingPage from './pages/dashboard/ReportingPage.jsx';
import PlanningPage from './pages/tpm/PlanningPage.jsx';
import ProcessMonitoringPage from './pages/monitoring/ProcessMonitoringPage.jsx';
import ProcessDashboardPage from './pages/monitoring/ProcessDashboardPage.jsx';
import FieldVisitsPage from './pages/monitoring/FieldVisitsPage.jsx';
import RbmPage from './pages/monitoring/RbmPage.jsx';
import CoverageRecapPage from './pages/monitoring/CoverageRecapPage.jsx';
import SitesMapPage from './pages/monitoring/SitesMapPage.jsx';
import PddPage from './pages/pdd/PddPage.jsx';
import FormationsPage from './pages/tpm/FormationsPage.jsx';
import EvaluationPage from './pages/tpm/EvaluationPage.jsx';
import SettingsPage from './pages/settings/SettingsPage.jsx';

const DEFAULT_ROUTE = { module: 'contrats', sub: 'liste' };

// Deep-linkable routes: #/tpm/prestataires, #/contrats/liste,
// #/contrats/liste/nouveau, #/contrats/liste/<id>, #/contrats/liste/<id>/edit,
// #/contrats/liste/<id>/amend
// Routes retirées → redirigées (ex. l'ancien « Affectation & calendrier »,
// fusionné dans « Affectation & visites »).
const REDIRECTS = { 'tpm/affectation': { module: 'processus', sub: 'sites' } };

function parseHash() {
  const [, mod, sub, extra, extra2] = window.location.hash.split('/');
  const redirect = REDIRECTS[`${mod}/${sub}`];
  if (redirect) return redirect;
  return findRoute(mod, sub) ? { module: mod, sub, extra: extra || null, extra2: extra2 || null } : DEFAULT_ROUTE;
}

function Workspace() {
  const toast = useToast();
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setUser(null);
      toast.info('Votre session a expiré. Veuillez vous reconnecter.');
    });
  }, [toast]);

  const navigate = useCallback((mod, sub, extra, extra2) => {
    let hash = `/${mod}/${sub}`;
    if (extra) hash += `/${extra}`;
    if (extra2) hash += `/${extra2}`;
    window.location.hash = hash;
  }, []);

  const openContract = useCallback((id) => navigate('contrats', 'liste', id), [navigate]);
  const newContract = useCallback(() => navigate('contrats', 'liste', 'nouveau'), [navigate]);
  const editContract = useCallback((id) => navigate('contrats', 'liste', id, 'edit'), [navigate]);
  const amendContract = useCallback((id) => navigate('contrats', 'liste', id, 'amend'), [navigate]);

  function handleLoggedIn(token, u) {
    setSession(token, u);
    setUser(u);
  }

  function handleLogout() {
    setSession(null, null);
    setUser(null);
  }

  if (!user) return <LoginPage onLoggedIn={handleLoggedIn} />;

  const canEdit = user.role === 'admin' || user.role === 'manager';

  return (
    <AppShell user={user} route={route} onNavigate={navigate} onLogout={handleLogout}>
      {route.module === 'contrats' && (() => {
        const back = () => navigate('contrats', 'liste');
        if (route.extra === 'nouveau') return <ContractFormPage mode="create" onDone={openContract} onCancel={back} />;
        if (route.extra && route.extra2 === 'edit') return <ContractFormPage mode="edit" contractId={route.extra} onDone={openContract} onCancel={back} />;
        if (route.extra && route.extra2 === 'amend') return <ContractFormPage mode="amend" contractId={route.extra} onDone={openContract} onCancel={back} />;
        if (route.extra) return <ContractDetailPage contractId={route.extra} onBack={back} onOpen={openContract} onEdit={editContract} onAmend={amendContract} />;
        return <ContractsListPage canEdit={canEdit} onOpen={openContract} onNew={newContract} onEdit={editContract} onAmend={amendContract} />;
      })()}
      {route.sub === 'prestataires' && <ProvidersPage canEdit={canEdit} onNavigate={navigate} />}
      {route.module === 'tpm' && route.sub === 'formations' && <FormationsPage canEdit={canEdit} />}
      {route.module === 'tpm' && route.sub === 'evaluation' && <EvaluationPage canEdit={canEdit} />}
      {route.module === 'tpm' && route.sub === 'rapports' && <ReportsPage canEdit={canEdit} onOpenContract={openContract} onNavigate={navigate} />}
      {route.module === 'dashboard' && route.sub === 'apercu' && <DashboardBIPage onOpenContract={openContract} />}
      {route.module === 'dashboard' && route.sub === 'consolidation' && <ConsolidationPage onOpenContract={openContract} />}
      {route.module === 'dashboard' && route.sub === 'couverture' && <DashboardCoveragePage onNavigate={navigate} />}
      {route.module === 'alertes' && <AlertsPage onNavigate={navigate} onOpenContract={openContract} />}
      {route.module === 'reporting' && <ReportingPage onOpenContract={openContract} />}
      {route.module === 'tpm' && route.sub === 'budget' && <PlanningPage canEdit={canEdit} onNavigate={navigate} />}
      {route.module === 'processus' && route.sub === 'synthese' && <ProcessDashboardPage onNavigate={navigate} />}
      {route.module === 'processus' && route.sub === 'donnees' && <ProcessMonitoringPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'sites' && <FieldVisitsPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'rbm' && <RbmPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'couverture' && <CoverageRecapPage />}
      {route.module === 'processus' && route.sub === 'carte' && <SitesMapPage />}
      {route.module === 'pdd' && <PddPage canEdit={canEdit} view={route.sub} onNavigate={navigate} />}
      {route.module === 'parametrage' && <SettingsPage tab={route.sub} isAdmin={user.role === 'admin'} onNavigate={navigate} />}
    </AppShell>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <Workspace />
      </ToastProvider>
    </I18nProvider>
  );
}
