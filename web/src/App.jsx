import React, { useCallback, useEffect, useState } from 'react';
import { getStoredUser, getToken, onUnauthorized, setSession } from './api/client.js';
import AppShell, { findRoute } from './components/AppShell.jsx';
import { ToastProvider, useToast } from './components/Toast.jsx';
import { I18nProvider } from './lib/i18n.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ProvidersPage from './pages/ProvidersPage.jsx';
import AssignmentPage from './pages/AssignmentPage.jsx';
import ContractsListPage from './pages/contracts/ContractsListPage.jsx';
import ContractDetailPage from './pages/contracts/ContractDetailPage.jsx';
import ContractFormPage from './pages/contracts/ContractFormPage.jsx';
import ReportsPage from './pages/tpm/ReportsPage.jsx';
import ConsolidationPage from './pages/dashboard/ConsolidationPage.jsx';
import DashboardBIPage from './pages/dashboard/DashboardBIPage.jsx';
import AlertsPage from './pages/dashboard/AlertsPage.jsx';
import ReportingPage from './pages/dashboard/ReportingPage.jsx';
import PlanningPage from './pages/tpm/PlanningPage.jsx';
import ProcessMonitoringPage from './pages/monitoring/ProcessMonitoringPage.jsx';
import ProcessDashboardPage from './pages/monitoring/ProcessDashboardPage.jsx';
import FieldVisitsPage from './pages/monitoring/FieldVisitsPage.jsx';
import RbmPage from './pages/monitoring/RbmPage.jsx';
import FormationsPage from './pages/tpm/FormationsPage.jsx';
import EvaluationPage from './pages/tpm/EvaluationPage.jsx';
import SettingsPage from './pages/settings/SettingsPage.jsx';

const DEFAULT_ROUTE = { module: 'contrats', sub: 'liste' };

// Deep-linkable routes: #/tpm/prestataires, #/contrats/liste,
// #/contrats/liste/nouveau, #/contrats/liste/<id>, #/contrats/liste/<id>/edit,
// #/contrats/liste/<id>/amend
function parseHash() {
  const [, mod, sub, extra, extra2] = window.location.hash.split('/');
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
      {route.sub === 'affectation' && <AssignmentPage canEdit={canEdit} />}
      {route.module === 'tpm' && route.sub === 'rapports' && <ReportsPage canEdit={canEdit} onOpenContract={openContract} />}
      {route.module === 'dashboard' && route.sub === 'apercu' && <DashboardBIPage onOpenContract={openContract} />}
      {route.module === 'dashboard' && route.sub === 'consolidation' && <ConsolidationPage onOpenContract={openContract} />}
      {route.module === 'alertes' && <AlertsPage onNavigate={navigate} onOpenContract={openContract} />}
      {route.module === 'reporting' && <ReportingPage onOpenContract={openContract} />}
      {route.module === 'tpm' && route.sub === 'budget' && <PlanningPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'synthese' && <ProcessDashboardPage onNavigate={navigate} />}
      {route.module === 'processus' && route.sub === 'donnees' && <ProcessMonitoringPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'sites' && <FieldVisitsPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'rbm' && <RbmPage canEdit={canEdit} />}
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
