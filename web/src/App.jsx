import React, { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser, getToken, onUnauthorized, setSession } from './api/client.js';
import { AlertCircle } from 'lucide-react';
import { Alert } from './components/ui.jsx';
import AppShell, { findRoute, NAV } from './components/AppShell.jsx';
import { canSeePage } from './lib/pages.js';
import { ToastProvider, useToast } from './components/Toast.jsx';
import { I18nProvider, useI18n } from './lib/i18n.jsx';
import { writeSessionPeriod } from './lib/period.js';
import { canWrite as roleCanWrite, isAdminRole } from './lib/accessRoles.js';
import { setFormatCurrency } from './lib/format.js';
import { routeOfHash } from './lib/route.js';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import ActivationPage from './pages/ActivationPage.jsx';
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
import ProjectsPage from './pages/projects/ProjectsPage.jsx';

// Adresse → route : LE parseur partagé (lib/route.routeOfHash — redirections, route par défaut), avec
// les routes de la navigation (findRoute). La requête du hash (#/dashboard/couverture?from=2026-01&to=2026-06 :
// période, lot 1b) n'appartient pas à la route : elle est lue par usePeriod (lib/period.readHashPeriod).
function parseHash() {
  return routeOfHash(window.location.hash, findRoute);
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
  const [showSignup, setShowSignup] = useState(false);
  // Devise du pays (multi-pays, étape 1) : lue au profil après connexion ; posée pour tous les montants.
  const [currency, setCurrency] = useState(null);

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

  // Devise du pays : lue une fois connecté (profil). '' = non renseignée → montants sans suffixe.
  useEffect(() => {
    if (!user) { setCurrency(null); return; }
    let alive = true;
    api.getCountry().then((c) => { if (alive) setCurrency((c && c.currency) || ''); }).catch(() => { if (alive) setCurrency(''); });
    return () => { alive = false; };
  }, [user]);

  const navigate = useCallback((mod, sub, extra, extra2) => {
    let hash = `/${mod}/${sub}`;
    if (extra) hash += `/${extra}`;
    if (extra2) hash += `/${extra2}`;
    window.location.hash = hash;
  }, []);

  // Accès par écran : si la page courante n'est pas autorisée pour cet utilisateur,
  // on le renvoie vers le premier écran auquel il a droit (le menu masque déjà le reste).
  useEffect(() => {
    if (!user) return;
    const access = isAdminRole(user.role) ? null : (user.pageAccess || null);
    if (!access) return;
    if (canSeePage(access, route.module)) return;
    for (const g of NAV) {
      for (const item of g.items) {
        if (canSeePage(access, item.id)) { navigate(item.id, item.subs?.[0]?.id); return; }
      }
    }
  }, [user, route, navigate]);

  const openContract = useCallback((id) => navigate('contrats', 'liste', id), [navigate]);
  const newContract = useCallback(() => navigate('contrats', 'liste', 'nouveau'), [navigate]);
  const editContract = useCallback((id) => navigate('contrats', 'liste', id, 'edit'), [navigate]);
  const amendContract = useCallback((id) => navigate('contrats', 'liste', id, 'amend'), [navigate]);

  function handleLoggedIn(token, u) {
    setSession(token, u);
    setUser(u);
    setShowSignup(false);
  }

  function handleLogout() {
    forgetSessionPeriod();
    setSession(null, null);
    setUser(null);
  }

  if (!user) {
    // Lien d'activation : #/activer?token=XXXX (écran public, avant connexion).
    const activMatch = (window.location.hash || '').match(/^#\/activer\?token=([^&]+)/);
    if (activMatch) {
      const backToLogin = () => { window.location.hash = '#/contrats/liste'; setShowSignup(false); };
      return <ActivationPage token={decodeURIComponent(activMatch[1])} onBack={backToLogin} />;
    }
    return showSignup
      ? <SignupPage onBack={() => setShowSignup(false)} />
      : <LoginPage onLoggedIn={handleLoggedIn} onSignup={() => setShowSignup(true)} />;
  }

  // Applique la devise du pays à tous les montants (avant de rendre les écrans). Devise NON renseignée
  // (null ou '') → on garde « Ar » (MGA) pour ne RIEN changer aux installations existantes ; seule une
  // devise explicite (ex. USD) modifie le suffixe. La santé du paramétrage signale la devise manquante.
  setFormatCurrency(currency || 'MGA');
  const canEdit = roleCanWrite(user.role);
  const isAdmin = isAdminRole(user.role);
  // Restrictions d'accès par écran (null = aucune). Les administrateurs voient tout.
  const pageAccess = isAdmin ? null : (user.pageAccess || null);

  return (
    <AppShell user={user} route={route} onNavigate={navigate} onLogout={handleLogout} pageAccess={pageAccess}>
      <SchemaBanner isAdmin={isAdmin} />
      {route.module === 'contrats' && (() => {
        const back = () => navigate('contrats', 'liste');
        if (route.extra === 'nouveau') return <ContractFormPage mode="create" onDone={openContract} onCancel={back} />;
        if (route.extra && route.extra2 === 'edit') return <ContractFormPage mode="edit" contractId={route.extra} onDone={openContract} onCancel={back} />;
        if (route.extra && route.extra2 === 'amend') return <ContractFormPage mode="amend" contractId={route.extra} onDone={openContract} onCancel={back} />;
        if (route.extra) {
          return <ContractDetailPage contractId={route.extra} onBack={back} onOpen={openContract} onEdit={editContract} onAmend={amendContract}
            onOpenPartner={(id) => navigate('tpm', 'prestataires', id)} />;
        }
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
      {route.module === 'reporting' && route.sub === 'concepteur' && <ReportDesignerPage canEdit={canEdit} isAdmin={isAdmin} />}
      {route.module === 'reporting' && route.sub !== 'concepteur' && <ReportingPage onOpenContract={openContract} />}
      {route.module === 'tpm' && route.sub === 'budget' && <PlanningPage canEdit={canEdit} isAdmin={isAdmin} onNavigate={navigate} />}
      {route.module === 'processus' && route.sub === 'synthese' && <ProcessDashboardPage onNavigate={navigate} />}
      {route.module === 'processus' && route.sub === 'donnees' && (
        <ProcessMonitoringPage canEdit={canEdit} isAdmin={isAdmin} formId={route.extra} tab={route.extra2} onNavigate={navigate} />
      )}
      {route.module === 'processus' && route.sub === 'sites' && <FieldVisitsPage canEdit={canEdit} />}
      {route.module === 'processus' && route.sub === 'rbm' && (
        <RbmSpacePage canEdit={canEdit} isAdmin={isAdmin} tab={route.extra} onTab={(tab) => navigate('processus', 'rbm', tab)} />
      )}
      {route.module === 'processus' && route.sub === 'couverture' && <CoverageRecapPage />}
      {route.module === 'processus' && route.sub === 'carte' && <SitesMapPage onNavigate={navigate} isAdmin={isAdmin} />}
      {route.module === 'processus' && route.sub === 'calculs' && <CalcDocsPage />}
      {route.module === 'pdd' && <PddPage canEdit={canEdit} view={route.sub} onNavigate={navigate} />}
      {route.module === 'projets' && <ProjectsPage canEdit={canEdit} />}
      {route.module === 'parametrage' && <SettingsPage tab={route.sub} sub={route.extra} isAdmin={isAdmin} onNavigate={navigate} />}
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

