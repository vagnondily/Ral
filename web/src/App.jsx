import React, { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser, getToken, onUnauthorized, setSession } from './api/client.js';
import { AlertCircle } from 'lucide-react';
import { Alert } from './components/ui.jsx';
import AppShell, { findRoute } from './components/AppShell.jsx';
import { ToastProvider, useToast } from './components/Toast.jsx';
import { I18nProvider, useI18n } from './lib/i18n.jsx';
import { writeSessionPeriod } from './lib/period.js';
import LoginPage from './pages/LoginPage.jsx';
import ProvidersPage from './pages/ProvidersPage.jsx';
import ContractsListPage from './pages/contracts/ContractsListPage.jsx';
import ContractDetailPage from './pages/contracts/ContractDetailPage.jsx';
import ContractFormPage from './pages/contracts/ContractFormPage.jsx';
import ReportsPage from './pages/tpm/ReportsPage.jsx';
import ProviderSheetPage from './pages/tpm/ProviderSheetPage.jsx';
import ConsolidationPage from './pages/dashboard/ConsolidationPage.jsx';
import DashboardBIPage from './pages/dashboard/DashboardBIPage.jsx';
import DashboardCoveragePage from './pages/dashboard/DashboardCoveragePage.jsx';
import AlertsPage from './pages/dashboard/AlertsPage.jsx';
import ReportingPage from './pages/dashboard/ReportingPage.jsx';
import ReportDesignerPage from './pages/reports/ReportDesignerPage.jsx';
import PlanningPage from './pages/tpm/PlanningPage.jsx';
import ProcessMonitoringPage from './pages/monitoring/ProcessMonitoringPage.jsx';
import ProcessDashboardPage from './pages/monitoring/ProcessDashboardPage.jsx';
import CalcDocsPage from './pages/monitoring/CalcDocsPage.jsx';
import FieldVisitsPage from './pages/monitoring/FieldVisitsPage.jsx';
import RbmSpacePage from './pages/monitoring/RbmSpacePage.jsx';
import CoverageRecapPage from './pages/monitoring/CoverageRecapPage.jsx';
import SitesMapPage from './pages/monitoring/SitesMapPage.jsx';
import PddPage from './pages/pdd/PddPage.jsx';
import FormationsPage from './pages/tpm/FormationsPage.jsx';
import TrainingSessionPage from './pages/tpm/TrainingSessionPage.jsx';
import EvaluationPage from './pages/tpm/EvaluationPage.jsx';
import SettingsPage from './pages/settings/SettingsPage.jsx';

const DEFAULT_ROUTE = { module: 'contrats', sub: 'liste' };

// Deep-linkable routes: #/tpm/prestataires, #/contrats/liste,
// #/contrats/liste/nouveau, #/contrats/liste/<id>, #/contrats/liste/<id>/edit,
// #/contrats/liste/<id>/amend
// Routes retirées → redirigées (ex. l'ancien « Affectation & calendrier »,
// fusionné dans « Affectation & visites »).
// Anciennes adresses → nouvel emplacement (les favoris restent valides).
const REDIRECTS = {
  'tpm/affectation': { module: 'processus', sub: 'sites' },
  // Le plan de suivi est un onglet de l'espace RBM (retour n° 7).
  'processus/plan': { module: 'processus', sub: 'rbm', extra: 'plan' },
  // Le registre des sites est un onglet de Localités (retour 63).
  'parametrage/sites': { module: 'parametrage', sub: 'localites', extra: 'sites' },
  // Le rapport trimestriel est devenu la carte « Couverture par activité » de la Synthèse (retour 76).
  'dashboard/trimestriel': { module: 'processus', sub: 'synthese' },
};

// La requête du hash (#/dashboard/couverture?from=2026-01&to=2026-06 : période, lot 1b)
// n'appartient pas à la route : elle est lue par usePeriod (lib/period.readHashPeriod).
function parseHash() {
  const [, mod, sub, extra, extra2] = window.location.hash.split('?')[0].split('/');
  const redirect = REDIRECTS[`${mod}/${sub}`];
  if (redirect) return redirect;
  return findRoute(mod, sub) ? { module: mod, sub, extra: extra || null, extra2: extra2 || null } : DEFAULT_ROUTE;
}

// La période de travail de la session (usePeriod) n'est jamais transmise à l'utilisateur suivant.
function forgetSessionPeriod() {
  try { writeSessionPeriod(window.sessionStorage, null); } catch { /* stockage indisponible */ }
}

function Workspace() {
  const { tr } = useI18n();
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
      forgetSessionPeriod();
      setUser(null);
      toast.info(tr('Votre session a expiré. Veuillez vous reconnecter.'));
    });
  }, [toast, tr]);

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
    forgetSessionPeriod();
    setSession(null, null);
    setUser(null);
  }

  if (!user) return <LoginPage onLoggedIn={handleLoggedIn} />;

  const canEdit = user.role === 'admin' || user.role === 'manager';

  return (
    <AppShell user={user} route={route} onNavigate={navigate} onLogout={handleLogout}>
      <SchemaBanner isAdmin={user.role === 'admin'} />
      {route.module === 'contrats' && (() => {
        const back = () => navigate('contrats', 'liste');
        if (route.extra === 'nouveau') return <ContractFormPage mode="create" onDone={openContract} onCancel={back} />;
        if (route.extra && route.extra2 === 'edit') return <ContractFormPage mode="edit" contractId={route.extra} onDone={openContract} onCancel={back} />;
        if (route.extra && route.extra2 === 'amend') return <ContractFormPage mode="amend" contractId={route.extra} onDone={openContract} onCancel={back} />;
        if (route.extra) return <ContractDetailPage contractId={route.extra} onBack={back} onOpen={openContract} onEdit={editContract} onAmend={amendContract} />;
        return <ContractsListPage canEdit={canEdit} onOpen={openContract} onNew={newContract} onEdit={editContract} onAmend={amendContract} />;
      })()}
      {route.module === 'tpm' && route.sub === 'prestataires' && (route.extra
        ? <ProviderSheetPage providerId={route.extra} tab={route.extra2} canEdit={canEdit} user={user} onNavigate={navigate} onOpenContract={openContract} />
        : <ProvidersPage canEdit={canEdit} onNavigate={navigate} />)}
      {route.module === 'tpm' && route.sub === 'formations' && (route.extra
        ? <TrainingSessionPage sessionId={route.extra} canEdit={canEdit} onNavigate={navigate} />
        : <FormationsPage canEdit={canEdit} onNavigate={navigate} />)}
      {route.module === 'tpm' && route.sub === 'evaluation' && <EvaluationPage canEdit={canEdit} />}
      {route.module === 'tpm' && route.sub === 'rapports' && <ReportsPage canEdit={canEdit} onOpenContract={openContract} onNavigate={navigate} />}
      {route.module === 'dashboard' && route.sub === 'apercu' && <DashboardBIPage onOpenContract={openContract} onNavigate={navigate} />}
      {route.module === 'dashboard' && route.sub === 'consolidation' && <ConsolidationPage onOpenContract={openContract} />}
      {route.module === 'dashboard' && route.sub === 'couverture' && <DashboardCoveragePage onNavigate={navigate} />}
      {route.module === 'alertes' && <AlertsPage onNavigate={navigate} onOpenContract={openContract} />}
      {route.module === 'reporting' && route.sub === 'concepteur' && <ReportDesignerPage canEdit={canEdit} isAdmin={user.role === 'admin'} />}
      {route.module === 'reporting' && route.sub !== 'concepteur' && <ReportingPage onOpenContract={openContract} />}
      {route.module === 'tpm' && route.sub === 'budget' && <PlanningPage canEdit={canEdit} isAdmin={user.role === 'admin'} onNavigate={navigate} />}
      {route.module === 'processus' && route.sub === 'synthese' && <ProcessDashboardPage onNavigate={navigate} />}
      {route.module === 'processus' && route.sub === 'donnees' && (
        <ProcessMonitoringPage canEdit={canEdit} isAdmin={user.role === 'admin'} formId={route.extra} tab={route.extra2} onNavigate={navigate} />
      )}
      {route.module === 'processus' && route.sub === 'sites' && <FieldVisitsPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'rbm' && (
        <RbmSpacePage canEdit={canEdit} isAdmin={user.role === 'admin'} tab={route.extra} onTab={(tab) => navigate('processus', 'rbm', tab)} />
      )}
      {route.module === 'processus' && route.sub === 'couverture' && <CoverageRecapPage />}
      {route.module === 'processus' && route.sub === 'carte' && <SitesMapPage onNavigate={navigate} isAdmin={user.role === 'admin'} />}
      {route.module === 'processus' && route.sub === 'calculs' && <CalcDocsPage />}
      {route.module === 'pdd' && <PddPage canEdit={canEdit} view={route.sub} onNavigate={navigate} />}
      {route.module === 'parametrage' && <SettingsPage tab={route.sub} sub={route.extra} isAdmin={user.role === 'admin'} onNavigate={navigate} />}
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

/**
 * Base de données en retard sur l'application (migration oubliée après une mise
 * à jour) : bandeau en tête de chaque page, avec la marche à suivre pour
 * l'administrateur. Silencieux si la vérification échoue (rien d'inventé).
 */
function SchemaBanner({ isAdmin }) {
  const { tr } = useI18n();
  const [pending, setPending] = useState(0);
  useEffect(() => { api.systemStatus().then((r) => setPending(Number(r.pendingCount) || 0)).catch(() => {}); }, []);
  if (!pending) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <Alert tone="error" icon={AlertCircle}>
        {isAdmin
          ? tr('La base de données n\'est pas à jour ({n} mise(s) à jour en attente) : certaines pages ne fonctionneront pas. Arrêtez l\'API, lancez « npm run migrate » dans le dossier server, puis redémarrez l\'API.', { n: pending })
          : tr('L\'application est en cours de mise à jour : certaines pages peuvent ne pas fonctionner. Prévenez votre administrateur.')}
      </Alert>
    </div>
  );
}

