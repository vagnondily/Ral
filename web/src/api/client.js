import { periodParams } from '../lib/period.js';

// API de base : VITE_API_URL si fourni ; sinon en DEV l'API locale (vite sur :5173 → API :9000),
// et en PRODUCTION la MÊME origine que la page (l'API sert l'interface compilée → un seul service,
// pas de CORS, fonctionne en local comme depuis le réseau sans rien configurer).
const API_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? 'http://localhost:9000'
    : (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:9000'));
const TOKEN_KEY = 'mems2_tpm_token';
const USER_KEY = 'mems2_tpm_user';

// Storage can throw (private mode, blocked site data) — never let that
// break the app; the session then simply lives in memory.
function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

let memoryToken = safeGet(TOKEN_KEY);
let unauthorizedHandler = null;

export function getToken() {
  return memoryToken;
}

export function getStoredUser() {
  try { return JSON.parse(safeGet(USER_KEY)); } catch { return null; }
}

// Secrets saisis pendant la session (jetons des liens de données, par fiche et par lien) : gardés
// EN MÉMOIRE seulement, jamais dans le stockage du navigateur, et oubliés à chaque changement de
// session (connexion, déconnexion, session expirée) — l'utilisateur suivant ne les réutilise jamais.
const sessionSecrets = new Map();
export const getSessionSecret = (key) => sessionSecrets.get(key);
export const setSessionSecret = (key, value) => { sessionSecrets.set(key, value); };

export function setSession(token, user) {
  sessionSecrets.clear();
  memoryToken = token || null;
  safeSet(TOKEN_KEY, token || null);
  safeSet(USER_KEY, user ? JSON.stringify(user) : null);
}

/** App registers this so an expired/invalid token sends the user back to
 * the login screen instead of leaving every request failing silently. */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Téléchargement authentifié d'un fichier binaire (modèles .xlsx, exports).
async function downloadFile(path, filename) {
  let res;
  try {
    res = await fetch(new URL(`${API_URL}${path}`), {
      headers: memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {},
    });
  } catch { throw new ApiError(0, 'Serveur injoignable.'); }
  if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

// Envoi authentifié d'un fichier binaire (imports .xlsx/.zip) ; renvoie le JSON.
async function uploadFile(path, file) {
  const buf = await file.arrayBuffer();
  let res;
  try {
    res = await fetch(new URL(`${API_URL}${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
      body: buf,
    });
  } catch { throw new ApiError(0, 'Serveur injoignable.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
  return data;
}

// Lecture authentifiée d'un fichier binaire (logo d'un en-tête de rapport) : renvoie un Blob.
async function fetchBlob(path) {
  let res;
  try {
    res = await fetch(new URL(`${API_URL}${path}`), { headers: memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {} });
  } catch { throw new ApiError(0, 'Serveur injoignable.'); }
  if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
  return res.blob();
}

// Téléchargement d'un fichier produit à partir d'un corps JSON (export d'un rapport non enregistré).
async function downloadPost(path, body, filename) {
  let res;
  try {
    res = await fetch(new URL(`${API_URL}${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch { throw new ApiError(0, 'Serveur injoignable.'); }
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.error || `Erreur ${res.status}`, d.details); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

const uiLang = () => (document.documentElement.lang === 'en' ? 'en' : 'fr');

async function request(path, { method = 'GET', body, query, auth = true } = {}) {
  const url = new URL(API_URL + path);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifiez votre connexion et réessayez.');
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && auth) {
    setSession(null, null);
    unauthorizedHandler?.();
    throw new ApiError(401, 'Votre session a expiré. Veuillez vous reconnecter.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
  }
  return data;
}

/** Envoi brut d'un fichier de soumissions (import ou vérification) ; erreurs détaillées conservées. */
async function uploadSubmissions(path, file) {
  const buf = await file.arrayBuffer();
  let res;
  try {
    res = await fetch(new URL(`${API_URL}${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
      body: buf,
    });
  } catch { throw new ApiError(0, 'Serveur injoignable.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
  return data;
}

// Paramètres de période d'un appel (lot 1b) : { from, to } → ?from=&to= ; « AAAA-MM » → l'ancien
// ?month= (toujours accepté par le serveur) ; rien → aucun paramètre. Voir lib/period.periodParams.
export const pq = periodParams;
/** Requête sans paramètres vides (undefined si aucun). */
const qs = (o) => { const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')); return Object.keys(out).length ? out : undefined; };

let calcFunctionsCache = null; // le catalogue ne change qu'avec une nouvelle version de l'API

export const api = {
  systemStatus: () => request('/api/system/status'),
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  listProviders: () => request('/api/tpm/providers'),
  createProvider: (input) => request('/api/tpm/providers', { method: 'POST', body: input }),
  createAgent: (providerId, input) =>
    request(`/api/tpm/providers/${providerId}/agents`, { method: 'POST', body: input }),
  getMonthlyPlan: (month) => request('/api/tpm/plans', { query: { month } }),
  upsertAssignment: (planId, input) =>
    request(`/api/tpm/plans/${planId}/assignments`, { method: 'PUT', body: input }),
  advancePlan: (planId) => request(`/api/tpm/plans/${planId}/advance`, { method: 'POST' }),
  listMissionDays: (planId) => request(`/api/tpm/plans/${planId}/mission-days`),
  listExpenses: (planId) => request(`/api/tpm/plans/${planId}/expenses`),
  // Contrats
  listContracts: () => request('/api/contracts'),
  listValidators: () => request('/api/contracts/validators'),
  getContract: (id) => request(`/api/contracts/${id}`),
  getContractHistory: (id) => request(`/api/contracts/${id}/history`),
  contractForecast: (id, until) => request(`/api/contracts/${id}/forecast`, { query: until ? { until } : {} }),
  createContract: (input) => request('/api/contracts', { method: 'POST', body: input }),
  updateContract: (id, input) => request(`/api/contracts/${id}`, { method: 'PUT', body: input }),
  submitContract: (id, input) => request(`/api/contracts/${id}/submit`, { method: 'POST', body: input }),
  approveContract: (id, input) => request(`/api/contracts/${id}/approve`, { method: 'POST', body: input }),
  rejectContract: (id, input) => request(`/api/contracts/${id}/reject`, { method: 'POST', body: input }),
  requestAmendment: (id, input) => request(`/api/contracts/${id}/amendments`, { method: 'POST', body: input }),
  approveAmendment: (id, amendmentId, input) =>
    request(`/api/contracts/${id}/amendments/${amendmentId}/approve`, { method: 'POST', body: input }),
  rejectAmendment: (id, amendmentId, input) =>
    request(`/api/contracts/${id}/amendments/${amendmentId}/reject`, { method: 'POST', body: input }),
  renewContract: (id, input) => request(`/api/contracts/${id}/renew`, { method: 'POST', body: input }),
  terminateContract: (id, input) => request(`/api/contracts/${id}/terminate`, { method: 'POST', body: input }),
  deleteContract: (id, justification) => request(`/api/contracts/${id}`, { method: 'DELETE', body: justification ? { justification } : undefined }),
  deleteAmendment: (id, amendmentId, justification) => request(`/api/contracts/${id}/amendments/${amendmentId}`, { method: 'DELETE', body: justification ? { justification } : undefined }),

  // Découpage administratif (localités) — référentiel par tenant/pays
  listAdminLevels: () => request('/api/settings/admin-levels'),
  listAdminAreas: (query) => request('/api/settings/admin-areas', { query }),
  importAdminBreakdown: (file, { confirm = false } = {}) => uploadFile(`/api/settings/admin-breakdown/import${confirm ? '?confirm=1' : ''}`, file),
  getCountry: () => request('/api/settings/country'),
  saveCountry: (input) => request('/api/settings/country', { method: 'PUT', body: input }),
  listLocalities: (query) => request('/api/settings/localities', { query }),
  // Rapprochement des lieux : file « À rapprocher » et graphies apprises.
  listPlaceMatches: (query) => request('/api/settings/place-matches', { query }),
  applyPlaceMatches: () => request('/api/settings/place-matches/apply', { method: 'POST' }),
  decidePlaceMatch: (id, body) => request(`/api/settings/place-matches/${id}/decide`, { method: 'POST', body }),
  listPlaceAliases: () => request('/api/settings/place-aliases'),
  deletePlaceAlias: (id) => request(`/api/settings/place-aliases/${id}`, { method: 'DELETE' }),
  createLocality: (input) => request('/api/settings/localities', { method: 'POST', body: input }),
  updateLocality: (id, patch) => request(`/api/settings/localities/${id}`, { method: 'PATCH', body: patch }),
  deleteLocality: (id, { cascade } = {}) => request(`/api/settings/localities/${id}`, { method: 'DELETE', query: cascade ? { cascade: 1 } : undefined }),
  exportLocalitiesCsv: (query, filename) => downloadFile(`/api/settings/localities/export.csv?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''))}`, filename),

  // Import d'un budget FLA (.xlsx) → postes pour pré-remplir le formulaire
  importBudget: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/contracts/import-budget`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },

  // Export Excel du budget (template avec formules) — téléchargement authentifié
  downloadBudgetXlsx: async (id) => {
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/contracts/${id}/budget.xlsx`), {
        headers: memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {},
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = m ? m[1] : `Budget_${id}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  },

  // Export Excel d'une facture (état des dépenses) — téléchargement authentifié
  downloadReportXlsx: async (id) => {
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/reports/${id}/facture.xlsx`), {
        headers: memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {},
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = m ? m[1] : `Facture_${id}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  },

  // Suivi de processus — formulaires, indicateurs (mapping), soumissions réelles
  monForms: () => request('/api/monitoring/forms'),
  // Concepteur de rapport
  reportCatalog: () => request('/api/report-designer/catalog'),
  // lang = langue de l'interface : libellé de période et bulletin auto-rédigé.
  reportRender: (doc) => request('/api/report-designer/render', { method: 'POST', body: doc, query: { lang: uiLang() } }),
  // Rendu progressif (lot 7a) : le plan (sans calcul lourd), puis les blocs par lots de 8 au plus.
  reportPlan: (doc) => request('/api/report-designer/render/plan', { method: 'POST', body: { doc }, query: { lang: uiLang() } }),
  reportBlocks: (doc, iids) => request('/api/report-designer/render/blocks', { method: 'POST', body: { doc, iids }, query: { lang: uiLang() } }),
  reportExportXlsx: (doc, filename) => downloadPost(`/api/report-designer/export.xlsx?lang=${uiLang()}`, doc, filename),
  reportTemplates: () => request('/api/report-designer/templates'),
  reportCreateTemplate: (input) => request('/api/report-designer/templates', { method: 'POST', body: input }),
  reportUpdateTemplate: (id, input) => request(`/api/report-designer/templates/${id}`, { method: 'PUT', body: input }),
  reportDeleteTemplate: (id) => request(`/api/report-designer/templates/${id}`, { method: 'DELETE' }),
  reportDocuments: () => request('/api/report-designer/documents'),
  reportDocument: (id) => request(`/api/report-designer/documents/${id}`),
  reportDocumentData: (id) => request(`/api/report-designer/documents/${id}/data`, { query: { lang: uiLang() } }),
  reportCreateDocument: (input) => request('/api/report-designer/documents', { method: 'POST', body: input }),
  reportUpdateDocument: (id, input) => request(`/api/report-designer/documents/${id}`, { method: 'PUT', body: input }),
  reportFinalizeDocument: (id, version) => request(`/api/report-designer/documents/${id}/finalize`, { method: 'POST', body: { version }, query: { lang: uiLang() } }),
  reportDeleteDocument: (id) => request(`/api/report-designer/documents/${id}`, { method: 'DELETE' }),
  // Logos des en-têtes et pieds de page (PNG ou JPEG, 512 Ko au plus, reconnus par les octets).
  reportAssets: () => request('/api/report-designer/assets'),
  reportUploadAsset: (file) => uploadFile(`/api/report-designer/assets?name=${encodeURIComponent(file.name || '')}`, file),
  reportAssetBlob: (id) => fetchBlob(`/api/report-designer/assets/${id}`),
  // « Mes en-têtes » : en-têtes et pieds de page enregistrés par le compte.
  reportBandTemplates: () => request('/api/report-designer/band-templates'),
  reportSaveBandTemplate: (input) => request('/api/report-designer/band-templates', { method: 'POST', body: input }),
  reportDeleteBandTemplate: (id) => request(`/api/report-designer/band-templates/${id}`, { method: 'DELETE' }),
  // Plan de suivi « type Excel »
  planBoard: (year, { adjusted } = {}) => request('/api/tpm/field/plan-board', { query: { year, adjusted: adjusted ? 1 : undefined } }),
  planBoardSetMonths: (input) => request('/api/tpm/field/plan-board/months', { method: 'PUT', body: input }),
  planBoardSetStatus: (input) => request('/api/tpm/field/plan-board/status', { method: 'PUT', body: input }),
  // Sites (actifs / inactifs) : grille du classeur d'activation (retour 64).
  activationGrid: (year) => request('/api/tpm/field/activation', { query: { year } }),
  saveActivation: (input) => request('/api/tpm/field/activation', { method: 'PUT', body: input }),
  activationFill: (input) => request('/api/tpm/field/activation/fill', { method: 'POST', body: input }),
  activationHistory: (siteId, year) => request('/api/tpm/field/activation/history', { query: { siteId, year } }),
  activationExport: (year) => downloadFile(`/api/tpm/field/activation.xlsx?year=${year}`, `Sites_actifs_${year}.xlsx`),
  activationImport: (file, { commit, year } = {}) => uploadFile(`/api/tpm/field/activation/import?commit=${commit ? 1 : 0}&year=${year}`, file),
  planBoardExport: (year) => downloadFile(`/api/tpm/field/plan-board/locations.xlsx?year=${year}`, `Plan_de_suivi_sites_${year}.xlsx`),
  planBoardBulk: (input) => request('/api/tpm/field/plan-board/bulk', { method: 'POST', body: input }),
  // Planification automatique sur une période selon des critères configurables (retour 82).
  planAutoPreview: (input) => request('/api/tpm/plan-auto/preview', { method: 'POST', body: input }),
  planAutoApply: (input) => request('/api/tpm/plan-auto/apply', { method: 'POST', body: input }),
  planAutoClear: (input) => request('/api/tpm/plan-auto/clear', { method: 'POST', body: input }),
  planBoardAddSite: (input) => request('/api/tpm/field/plan-board/sites', { method: 'POST', body: input }),
  planBoardTemplate: (year, activity) => downloadFile(`/api/tpm/field/plan-board/template.xlsx?year=${year}${activity ? `&activity=${encodeURIComponent(activity)}` : ''}`, `Gabarit_sites${activity ? `_${activity.replace(/[^\w]+/g, '_').slice(0, 40)}` : ''}_${year}.xlsx`),
  planBoardImport: (file, { commit, skipErrors } = {}) => uploadFile(`/api/tpm/field/plan-board/locations/import?commit=${commit ? 1 : 0}${skipErrors ? '&skipErrors=1' : ''}`, file),
  linkPull: (formId, input) => request(`/api/monitoring/forms/${formId}/link-pull`, { method: 'POST', body: input }),
  monCreateForm: (input) => request('/api/monitoring/forms', { method: 'POST', body: input }),
  monUpdateForm: (id, input) => request(`/api/monitoring/forms/${id}`, { method: 'PATCH', body: input }),
  monDeleteForm: (id, confirm) => request(`/api/monitoring/forms/${id}`, { method: 'DELETE', query: confirm ? { confirm } : undefined }),
  monFields: (id) => request(`/api/monitoring/forms/${id}/fields`),
  monIndicators: (id) => request(`/api/monitoring/forms/${id}/indicators`),
  // Modèle d'indicateurs : celui de l'activité, sinon le proposé d'après les variables, ou `template` (clé choisie).
  monTemplate: (id, template = null) => request(`/api/monitoring/forms/${id}/template`, { query: template ? { template } : undefined }),
  monApplyTemplate: (id, items, { template = null } = {}) => request(`/api/monitoring/forms/${id}/template/apply`, { method: 'POST', body: { items, ...(template ? { template } : {}) } }),
  // « Créer les N indicateurs proposés » : les éléments cochés d'office par le serveur (même règle que la carte).
  monApplyProposed: (id, { template = null } = {}) => request(`/api/monitoring/forms/${id}/template/apply`, { method: 'POST', body: { proposed: true, ...(template ? { template } : {}) } }),
  monCreateIndicator: (id, input) => request(`/api/monitoring/forms/${id}/indicators`, { method: 'POST', body: input }),
  monUpdateIndicator: (indId, input) => request(`/api/monitoring/indicators/${indId}`, { method: 'PATCH', body: input }),
  // Mise à jour depuis le modèle, en UNE requête pour le lot : pour chaque indicateur, la modification MONTRÉE par la
  // carte, recalculée et vérifiée sous verrou ; résultat ligne par ligne ({ id, ok, code… }).
  monTemplateUpdates: (formId, { mode = 'corrections', template = null, items }) => request(`/api/monitoring/forms/${formId}/template-update`,
    { method: 'POST', body: { mode, items, ...(template ? { template } : {}) } }),
  monDeleteIndicator: (indId) => request(`/api/monitoring/indicators/${indId}`, { method: 'DELETE' }),
  // « Comment c'est calculé » : une définition appliquée aux soumissions de la période (lecture seule).
  monIndicatorPreview: (id, body) => request(`/api/monitoring/forms/${id}/indicators/preview`, { method: 'POST', body }),
  monFormMonths: (id) => request(`/api/monitoring/forms/${id}/months`),
  // Période : { from, to } (plage), « AAAA-MM » (un mois, ancien format) ou rien (toutes les périodes) — voir pq().
  monValues: (id, period) => request(`/api/monitoring/forms/${id}/values`, { query: qs(pq(period)) }),
  monDashboard: (id, period) => request(`/api/monitoring/forms/${id}/dashboard`, { query: qs(pq(period)) }),
  monOverview: (period) => request('/api/monitoring/overview', { query: qs(pq(period)) }),
  monCoverageDashboard: (period) => request('/api/monitoring/coverage-dashboard', { query: qs(pq(period)) }),
  // Mesures de couverture d'une période (retour 110) : UNE réponse pour la Synthèse et pour
  // « Couverture & performance » (univers, suivis, exécution, sites prévus, sites à jour, communes,
  // par activité / bureau / district). Bureau facultatif (le bureau et ses antennes).
  dashCoverage: (period, { officeId } = {}) => request('/api/dashboards/coverage', { query: qs({ ...pq(period), office: officeId }) }),
  // Volume de données par mois + période par défaut (dernier mois substantiel ≤ mois courant).
  monPeriods: (today) => request('/api/monitoring/periods', { query: today ? { today } : undefined }),
  monSubmissions: (period) => request('/api/monitoring/submissions', { query: qs(pq(period)) }),
  monCatalog: (id) => request(`/api/monitoring/forms/${id}/catalog`),
  monMemsMapping: (id) => request(`/api/monitoring/forms/${id}/mems-mapping`),
  monSetMemsMapping: (id, dimension, column) => request(`/api/monitoring/forms/${id}/mems-mapping`, { method: 'PUT', body: { dimension, column } }),
  monResetMemsMapping: (id, dimension) => request(`/api/monitoring/forms/${id}/mems-mapping/${dimension}`, { method: 'DELETE' }),
  monApplyMemsMapping: (id) => request(`/api/monitoring/forms/${id}/mems-mapping/apply`, { method: 'POST' }),
  // Cycle de vie du mapping : action ∈ submit | validate | reset.
  monMappingAction: (id, action) => request(`/api/monitoring/forms/${id}/mapping/${action}`, { method: 'POST' }),
  monFormSubmissions: (id, { period, month, limit, offset } = {}) => request(`/api/monitoring/forms/${id}/submissions`, { query: qs({ ...pq(period || month), limit, offset }) }),
  monCalcFields: (id) => request(`/api/monitoring/forms/${id}/calc-fields`),
  // Éditeur de formule : catalogue des fonctions (mis en cache) et aperçu sur les soumissions réelles.
  monCalcFunctions: () => (calcFunctionsCache ||= request('/api/monitoring/calc-functions').catch((e) => { calcFunctionsCache = null; throw e; })),
  monVariables: (id) => request(`/api/monitoring/forms/${id}/variables`),
  monCalcPreview: (id, body) => request(`/api/monitoring/forms/${id}/calc-fields/preview`, { method: 'POST', body }),
  monCreateCalcField: (id, body) => request(`/api/monitoring/forms/${id}/calc-fields`, { method: 'POST', body }),
  monUpdateCalcField: (cfId, body) => request(`/api/monitoring/calc-fields/${cfId}`, { method: 'PATCH', body }),
  monDeleteCalcField: (cfId) => request(`/api/monitoring/calc-fields/${cfId}`, { method: 'DELETE' }),
  monSetExclusion: (id, body) => request(`/api/monitoring/forms/${id}/exclude`, { method: 'POST', body }),
  monImportDefinition: async (file) => {
    const token = getToken();
    const res = await fetch(new URL(`${API_URL}/api/monitoring/import-definition`), {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: file,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
    return res.json();
  },
  monKoboPull: (id, input) => request(`/api/monitoring/forms/${id}/kobo-pull`, { method: 'POST', body: input }),
  monUrlPull: (id, input) => request(`/api/monitoring/forms/${id}/url-pull`, { method: 'POST', body: input }),
  monImport: (id, file) => uploadSubmissions(`/api/monitoring/forms/${id}/import`, file),
  // Correspondances des valeurs codées (bureau, partenaire, agent) d'une fiche.
  monCorrespondences: (id, dimension) => request(`/api/monitoring/forms/${id}/correspondences`, { query: { dimension } }),
  monSetCorrespondence: (id, body) => request(`/api/monitoring/forms/${id}/correspondences`, { method: 'PUT', body }),
  // Vérification avant import : ce que contient le fichier (rien n'est écrit).
  monImportPreview: (id, file) => uploadSubmissions(`/api/monitoring/forms/${id}/import/preview`, file),

  // Paramètres
  listPartnerTypes: () => request('/api/settings/partner-types'),
  createPartnerType: (input) => request('/api/settings/partner-types', { method: 'POST', body: input }),
  listActivities: () => request('/api/settings/activities'),
  listUsers: () => request('/api/users'),
  createUser: (input) => request('/api/users', { method: 'POST', body: input }),
  updateUser: (id, input) => request(`/api/users/${id}`, { method: 'PATCH', body: input }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
  listExchangeRates: () => request('/api/settings/exchange-rates'),
  saveExchangeRate: (input) => request('/api/settings/exchange-rates', { method: 'POST', body: input }),
  deleteExchangeRate: (id) => request(`/api/settings/exchange-rates/${id}`, { method: 'DELETE' }),
  listMmr: () => request('/api/settings/mmr'),
  saveMmr: (input) => request('/api/settings/mmr', { method: 'POST', body: input }),
  deleteMmr: (id) => request(`/api/settings/mmr/${id}`, { method: 'DELETE' }),
  mmrRegistry: () => request('/api/settings/mmr/registry'),
  saveMmrBulk: (input) => request('/api/settings/mmr/bulk', { method: 'PUT', body: input }),
  exportMmrXlsx: () => downloadFile('/api/settings/mmr/export.xlsx', 'Parametres_MMR_MEMS2.xlsx'),
  importMmrXlsx: (file) => uploadFile('/api/settings/mmr/import', file),
  listOffices: () => request('/api/settings/offices'),
  officeCommunes: () => request('/api/settings/offices/communes'),
  officePerimeter: (id) => request(`/api/settings/offices/${id}/perimeter`),
  createOffice: (input) => request('/api/settings/offices', { method: 'POST', body: input }),
  updateOffice: (id, input) => request(`/api/settings/offices/${id}`, { method: 'PATCH', body: input }),
  deleteOffice: (id, { confirm } = {}) => request(`/api/settings/offices/${id}`, { method: 'DELETE', query: confirm ? { confirm: 1 } : undefined }),
  createActivity: (input) => request('/api/settings/activities', { method: 'POST', body: input }),
  setActivityActive: (id, active) => request(`/api/settings/activities/${id}`, { method: 'PATCH', body: { active } }),
  // Sous-activités (retour 92) : activité › sous-activité (activity_tag) › information.
  listSubActivities: (query) => request('/api/sub-activities', { query }),
  createSubActivity: (input) => request('/api/sub-activities', { method: 'POST', body: input }),
  updateSubActivity: (id, input) => request(`/api/sub-activities/${id}`, { method: 'PATCH', body: input }),
  deleteSubActivity: (id) => request(`/api/sub-activities/${id}`, { method: 'DELETE' }),
  listPartners: (type) => request('/api/settings/partners', { query: type ? { type } : undefined }),
  createPartner: (input) => request('/api/settings/partners', { method: 'POST', body: input }),
  updatePartner: (id, input) => request(`/api/settings/partners/${id}`, { method: 'PATCH', body: input }),
  createPartnerAgent: (id, input) => request(`/api/settings/partners/${id}/agents`, { method: 'POST', body: input }),
  deletePartnerAgent: (id, agentId) => request(`/api/settings/partners/${id}/agents/${agentId}`, { method: 'DELETE' }),
  setPartnerAgentActive: (id, agentId, active) => request(`/api/partners/${id}/agents/${agentId}`, { method: 'PATCH', body: { active } }),
  listAgentsEvaluation: () => request('/api/tpm/agents-evaluation'),
  createAgentEvaluation: (id, agentId, input) => request(`/api/settings/partners/${id}/agents/${agentId}/evaluations`, { method: 'POST', body: input }),
  deleteAgentEvaluation: (id, agentId, evaluationId) => request(`/api/settings/partners/${id}/agents/${agentId}/evaluations/${evaluationId}`, { method: 'DELETE' }),
  // Fiche prestataire 360° (lot 8, retour 28.1) et règle « prestataire actif » (retour 30).
  partnerProviders: () => request('/api/partners/providers'),
  partnerSheet: (id) => request(`/api/partners/${id}/sheet`),
  updatePartnerProfile: (id, patch) => request(`/api/partners/${id}`, { method: 'PATCH', body: patch }),
  partnerContracts: (id) => request(`/api/partners/${id}/contracts`),
  partnerReports: (id) => request(`/api/partners/${id}/reports`),
  partnerPlans: (id) => request(`/api/partners/${id}/plans`),
  partnerFollowups: (id, period) => request(`/api/partners/${id}/followups`, { query: qs(pq(period)) }),
  partnerTimeline: (id, before) => request(`/api/partners/${id}/timeline`, { query: qs({ before }) }),
  partnerAgents: (id) => request(`/api/partners/${id}/agents`),
  addPartnerAgent: (id, input) => request(`/api/partners/${id}/agents`, { method: 'POST', body: input }),
  patchPartnerAgent: (id, agentId, patch) => request(`/api/partners/${id}/agents/${agentId}`, { method: 'PATCH', body: patch }),
  removePartnerAgent: (id, agentId) => request(`/api/partners/${id}/agents/${agentId}`, { method: 'DELETE' }),
  selectableProviders: (period) => request('/api/partners/selectable', { query: qs(pq(period)) }),
  // Formations en sessions (lot 8, retour 28.2).
  listTrainings: (filters = {}) => request('/api/trainings', { query: qs({ ...pq(filters.period), providerId: filters.providerId, themeId: filters.themeId, status: filters.status }) }),
  trainingThemes: () => request('/api/trainings/themes'),
  // Chiffres clés de toutes les sessions (agrégés en SQL ; la liste est bornée à `limit`).
  trainingsSummary: (filters = {}) => request('/api/trainings/summary', { query: qs({ ...pq(filters.period), providerId: filters.providerId, themeId: filters.themeId, status: filters.status }) }),
  trainingsByProvider: (providerId) => request(`/api/trainings/by-provider/${providerId}`),
  getTraining: (id) => request(`/api/trainings/${id}`),
  createTraining: (input) => request('/api/trainings', { method: 'POST', body: input }),
  updateTraining: (id, patch) => request(`/api/trainings/${id}`, { method: 'PATCH', body: patch }),
  deleteTraining: (id) => request(`/api/trainings/${id}`, { method: 'DELETE' }),
  addTrainingParticipants: (id, input) => request(`/api/trainings/${id}/participants`, { method: 'POST', body: input }),
  saveTrainingParticipants: (id, rows) => request(`/api/trainings/${id}/participants`, { method: 'PATCH', body: { rows } }),
  removeTrainingParticipant: (id, agentId) => request(`/api/trainings/${id}/participants/${agentId}`, { method: 'DELETE' }),
  // Évaluations (lot 8) : grilles, pondérations, évaluation du prestataire.
  evaluationCriteria: (scope) => request('/api/evaluation/criteria', { query: { scope } }),
  createEvaluationCriterion: (input) => request('/api/evaluation/criteria', { method: 'POST', body: input }),
  updateEvaluationCriterion: (id, patch) => request(`/api/evaluation/criteria/${id}`, { method: 'PATCH', body: patch }),
  evaluationSettings: () => request('/api/evaluation/settings'),
  saveEvaluationSettings: (input) => request('/api/evaluation/settings', { method: 'PUT', body: input }),
  providerEvaluations: (partnerId) => request(`/api/evaluation/providers/${partnerId}`),
  providerEvaluation: (partnerId, id) => request(`/api/evaluation/providers/${partnerId}/${id}`),
  createProviderEvaluation: (partnerId, input) => request(`/api/evaluation/providers/${partnerId}`, { method: 'POST', body: input }),
  updateProviderEvaluation: (partnerId, id, input) => request(`/api/evaluation/providers/${partnerId}/${id}`, { method: 'PATCH', body: input }),
  // updatedAt : la version relue par le valideur (409 si elle a changé depuis).
  validateProviderEvaluation: (partnerId, id, updatedAt) => request(`/api/evaluation/providers/${partnerId}/${id}/validate`, { method: 'POST', body: { updatedAt } }),
  deleteProviderEvaluation: (partnerId, id) => request(`/api/evaluation/providers/${partnerId}/${id}`, { method: 'DELETE' }),

  // Rapports & dépenses TPM
  reportsContext: () => request('/api/tpm/reports/context'),
  // Rapports : { period | month, partnerId, contractId } — un rapport est retenu si sa période chevauche.
  listReports: ({ period, month, ...rest } = {}) => request('/api/tpm/reports', { query: qs({ ...pq(period || month), ...rest }) }),
  getReport: (id) => request(`/api/tpm/reports/${id}`),
  reportInvoice: (id) => request(`/api/tpm/reports/${id}/invoice`),

  // Suivi terrain — sites & visites
  fieldSites: (q) => request('/api/tpm/field/sites', { query: q ? { q } : undefined }),
  fieldCreateSite: (input) => request('/api/tpm/field/sites', { method: 'POST', body: input }),
  fieldUpdateSite: (id, input) => request(`/api/tpm/field/sites/${id}`, { method: 'PATCH', body: input }),
  // Visites : { period | month, providerId, status } — 12 mois au plus sur une plage.
  // Liste paginée côté serveur (pages de 1 000, chacune < 1 Mo) : toutes les pages sont lues, une
  // après l'autre, jusqu'au total ; l'écran reçoit le tableau complet des visites demandées.
  fieldVisits: async ({ period, month, ...rest } = {}) => {
    const items = [];
    for (let offset = 0, guard = 0; guard < 100; guard += 1) {
      const page = await request('/api/tpm/field/visits', { query: qs({ ...pq(period || month), ...rest, offset: offset || undefined }) });
      const list = Array.isArray(page) ? page : (page.items || []);
      items.push(...list);
      if (Array.isArray(page) || !list.length || items.length >= page.total) break;
      offset = items.length;
    }
    return items;
  },
  // Faits site × mois sur la période (sites distincts actifs / prévus / réalisés, visites, taux).
  fieldSummary: (period) => request('/api/tpm/field/summary', { query: qs(pq(period)) }),
  fieldCreateVisit: (input) => request('/api/tpm/field/visits', { method: 'POST', body: input }),
  fieldUpdateVisit: (id, input) => request(`/api/tpm/field/visits/${id}`, { method: 'PATCH', body: input }),
  fieldDeleteVisit: (id) => request(`/api/tpm/field/visits/${id}`, { method: 'DELETE' }),
  fieldCollectionDays: (month) => request('/api/tpm/field/collection-days', { query: month ? { month } : undefined }),
  fieldCoverageRecap: ({ district, operationMonths, period } = {}) => request('/api/tpm/field/coverage-recap', { query: qs({ district, operationMonths, ...pq(period) }) }),
  // Matrice : une année (nombre, 12 mois) ou une période { from, to } (colonnes = mois de la période).
  fieldCoverageMatrix: (yearOrPeriod) => request('/api/tpm/field/coverage-matrix', {
    query: qs(yearOrPeriod && typeof yearOrPeriod === 'object' ? pq(yearOrPeriod) : { year: yearOrPeriod }),
  }),
  fieldMonths: (year) => request('/api/tpm/field/months', { query: year ? { year } : undefined }),
  fieldSetMonthStatus: (month, status) => request('/api/tpm/field/months/status', { method: 'PUT', body: { month, status } }),
  fieldSetTravelDays: (input) => request('/api/tpm/field/collection-days', { method: 'PUT', body: input }),
  // Mois de référence « AAAA-MM », ou une période { from, to } : l'état est lu au mois `to`.
  rbmSites: (monthOrPeriod, risk) => request('/api/tpm/field/rbm/sites', { query: qs({ ...pq(monthOrPeriod), risk }) }),
  // Compteurs seuls de l'état RBM ({ total, byRisk, due, dueOpen, upToDate, toPlan }) — mêmes lignes
  // et mêmes règles que rbmSites, sans télécharger la liste (≈ 1,3 Ko par site) quand l'écran
  // n'affiche que des totaux.
  rbmCounts: (monthOrPeriod, risk) => request('/api/tpm/field/rbm/counts', { query: qs({ ...pq(monthOrPeriod), risk }) }),
  // Un site avec « Pourquoi ? / Conséquence / Que faire ? » (retour n° 48).
  rbmSiteExplain: (id, month) => request(`/api/tpm/field/rbm/sites/${encodeURIComponent(id)}`, { query: month ? { month } : {} }),
  rbmGenerate: (month, risk) => request(`/api/tpm/field/rbm/generate?month=${encodeURIComponent(month)}${risk ? `&risk=${risk}` : ''}`, { method: 'POST' }),
  rbmImport: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/field/rbm/import`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },
  rbmImportPlan: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/field/rbm/import-plan`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },
  fieldImportPlanning: async (file, month) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/field/import?month=${encodeURIComponent(month)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },
  createReport: (input) => request('/api/tpm/reports', { method: 'POST', body: input }),
  saveReportItems: (id, input) => request(`/api/tpm/reports/${id}/items`, { method: 'PUT', body: input }),
  submitReport: (id) => request(`/api/tpm/reports/${id}/submit`, { method: 'POST', body: {} }),
  approveReport: (id, input) => request(`/api/tpm/reports/${id}/approve`, { method: 'POST', body: input }),
  rejectReport: (id, input) => request(`/api/tpm/reports/${id}/reject`, { method: 'POST', body: input }),
  deleteReport: (id, justification) => request(`/api/tpm/reports/${id}`, { method: 'DELETE', body: justification ? { justification } : undefined }),
  generateMonthlyReports: (input) => request('/api/tpm/reports/generate-monthly', { method: 'POST', body: input }),
  reportNotApplicable: (id) => request(`/api/tpm/reports/${id}/not-applicable`, { method: 'POST', body: {} }),

  // Suivi budgétaire consolidé (Dashboard décisionnel) — interliaison
  // Budget (contrat) ↔ Planifié (plans) ↔ Réalisé (factures).
  // Consolidation : cumul « à date » ; avec { period } s'ajoutent les colonnes de la période.
  // L'ancien appel consolidation('AAAA-MM') (mois de référence du cumul) reste accepté.
  consolidation: (opts) => {
    const { today, period } = typeof opts === 'string' ? { today: opts } : (opts || {});
    return request('/api/tpm/consolidation', { query: qs({ today, ...pq(period) }) });
  },
  // Centre d'alertes : une seule liste pour la page et la cloche de l'en-tête.
  // Alertes : sans période, le mois courant (la cloche) ; une période vaut pour le terrain et les rapports.
  alerts: (period) => request('/api/alerts', { query: qs(pq(period)) }),
  // Carte du suivi (lot 6a) : tous les thèmes par district sur une période (requise) ;
  // filtres bureau (avec ses antennes) et activité ; levels: ['commune'] = classement par commune.
  mapDistricts: (period, { officeId, activity, levels } = {}) => request('/api/map/districts', {
    query: qs({ ...pq(period), office: officeId, activity, levels: levels && levels.length ? levels.join(',') : undefined }),
  }),
  // Points : sites GPS, positions déduites des collectes, centres de commune, points de collecte
  // (précis pour admin / gestionnaire, carroyage de 2 km sinon).
  mapPoints: (period, { officeId, activity, layers, limit } = {}) => request('/api/map/points', {
    query: qs({ ...pq(period), office: officeId, activity, layers: layers && layers.length ? layers.join(',') : undefined, limit }),
  }),
  mapSearch: (q) => request('/api/map/search', { query: { q } }),
  // Paramétrage › Localités › Contours de la carte (administrateur).
  mapShapeLinks: () => request('/api/map/shape-links'),
  mapShapeLinkSet: (pcode, shapeKey) => request(`/api/map/shape-links/${encodeURIComponent(pcode)}`, { method: 'PUT', body: { shapeKey } }),
  mapShapeLinkClear: (pcode) => request(`/api/map/shape-links/${encodeURIComponent(pcode)}`, { method: 'DELETE' }),
  mapFillCentres: () => request('/api/map/shape-links/fill-centres', { method: 'POST' }),

  // Planification & budget — budget prévisionnel des vagues de collecte
  listPlans: ({ period, month, ...rest } = {}) => request('/api/tpm/planning', { query: qs({ ...pq(period || month), ...rest }) }),
  getPlan: (id) => request(`/api/tpm/planning/${id}`),
  createPlan: (input) => request('/api/tpm/planning', { method: 'POST', body: input }),
  updatePlan: (id, input) => request(`/api/tpm/planning/${id}`, { method: 'PUT', body: input }),
  deletePlan: (id, justification) => request(`/api/tpm/planning/${id}`, { method: 'DELETE', body: justification ? { justification } : undefined }),

  // Journal des suppressions (retour 56), admin.
  listDeletions: (query) => request('/api/deletions', { query }),

  // Registre des sites (page de gestion des sites).
  listSiteRegistry: (query) => request('/api/site-registry', { query }),
  createSiteRegistry: (body) => request('/api/site-registry', { method: 'POST', body }),
  updateSiteRegistry: (id, body) => request(`/api/site-registry/${id}`, { method: 'PATCH', body }),
  deleteSiteRegistry: (id) => request(`/api/site-registry/${id}`, { method: 'DELETE' }),
  autoAttributeSites: (body) => request('/api/site-registry/auto-attribute', { method: 'POST', body }),
  siteRegistryTemplate: () => downloadFile('/api/site-registry/template.xlsx', 'Modele_sites_MEMS2.xlsx'),
  siteRegistryExport: (q) => downloadFile(`/api/site-registry/export.xlsx${q ? `?q=${encodeURIComponent(q)}` : ''}`, 'Sites_MEMS2.xlsx'),
  importSiteRegistry: (file) => uploadFile('/api/site-registry/import', file),
  bulkSiteRegistry: (ids, action, patch) => request('/api/site-registry/bulk', { method: 'POST', body: { ids, action, patch } }),
  previewBulkSiteDelete: (ids) => request('/api/site-registry/bulk/preview', { method: 'POST', body: { ids } }),
  siteRegistryExportSelection: (ids) => downloadPost('/api/site-registry/export.xlsx', { ids }, 'Sites_selection_MEMS2.xlsx'),
  // Liaison : postes du plan pour pré-remplir une facture (même contrat + mois)
  planningPrefill: (partnerId, contractId, month) => request('/api/tpm/planning/prefill', { query: { partnerId, contractId, month } }),

  // Import Excel de postes (facture / plan) — validé côté serveur, non persisté
  importPostes: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/postes/import`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },
  // Modèle Excel vierge (avec listes déroulantes)
  downloadPddTemplate: () => downloadFile('/api/pdd/template.xlsx', 'Modele_PDD_MEMS2.xlsx'),
  downloadPostesTemplate: async () => {
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/postes/template.xlsx`), {
        headers: memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {},
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Modele_postes_MEMS2.xlsx'; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  },

  toggleMissionDay: (assignmentId, date) =>
    request(`/api/tpm/assignments/${assignmentId}/mission-days`, { method: 'POST', body: { date } }),

  // Plan de Distribution d'urgence (PDD) — distributions, synthèse, pipeline.
  pddCommodities: () => request('/api/pdd/commodities'),
  // Distributions : lecture bornée { rows, total, limit, offset } ; { period | month, hazard, region, district, limit, offset }.
  pddDistributions: ({ period, month, ...rest } = {}) => request('/api/pdd/distributions', { query: qs({ ...pq(period || month), ...rest }) }),
  // Toutes les lignes de la période, page après page (2 000 par réponse, chacune bornée), jusqu'au
  // total ou à `max` lignes : { rows, total } — la liste, ses filtres et son CSV portent sur tout.
  pddDistributionsAll: async ({ period, month, max = 20000, ...rest } = {}) => {
    const rows = [];
    let total = 0;
    while (rows.length < max) {
      const page = await request('/api/pdd/distributions', {
        query: qs({ ...pq(period || month), ...rest, limit: Math.min(2000, max - rows.length), offset: rows.length || undefined }),
      });
      total = page.total;
      rows.push(...(page.rows || []));
      if (!page.rows || !page.rows.length || rows.length >= total) break;
    }
    return { rows, total };
  },
  // Synthèse : cumul sur la période + pic mensuel (`peak`).
  pddSummary: ({ period, month, ...rest } = {}) => request('/api/pdd/summary', { query: qs({ ...pq(period || month), ...rest }) }),
  // Pipeline : une période { from, to } (mois par mois) ou un mois « AAAA-MM » ; rien = tous les mois.
  pddPipeline: (periodOrMonth) => request('/api/pdd/pipeline', { query: qs(pq(periodOrMonth)) }),
  pddSetStock: (input) => request('/api/pdd/stock', { method: 'PUT', body: input }),
  // `partial` : « Importer quand même » malgré des lignes ignorées dans les mois remplacés.
  pddImport: async (file, { partial = false } = {}) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/pdd/import${partial ? '?partial=1' : ''}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },
};

// ---- Affectation des TPM par zone (retour 58) — /api/tpm/attribution ------------------------
// Ajouts en fin de fichier (fichier partagé par toutes les branches).
Object.assign(api, {
  // Table région › district (› commune) : TPM selon contrat et TPM retenu, par segments de mois.
  tpmAttribution: ({ period, regionId, all } = {}) => request('/api/tpm/attribution', { query: qs({ ...pq(period), regionId, all: all ? 1 : undefined }) }),
  // Prestataires : titulaires d'un contrat de suivi (avec leurs mois) puis autres TPM actifs.
  tpmAttributionProviders: (period) => request('/api/tpm/attribution/providers', { query: qs(pq(period)) }),
  // TPM de la zone d'un site pour un mois (formulaire de visite).
  tpmAttributionResolve: (siteId, month) => request('/api/tpm/attribution/resolve', { query: { siteId, month } }),
  // Aperçu sans écriture : { areaIds, regionIds, from, to, mode: 'modifier' | 'revenir', providerId, reason }.
  tpmAttributionPreview: (input) => request('/api/tpm/attribution/preview', { method: 'POST', body: input }),
  // Enregistrer (raison obligatoire, empreinte de l'aperçu) : 409 si l'affectation a changé entre-temps.
  tpmAttributionSave: (input) => request('/api/tpm/attribution/overrides', { method: 'PUT', body: input }),
  tpmAttributionRevert: (input) => request('/api/tpm/attribution/revert', { method: 'POST', body: input }),
  tpmAttributionApply: (input) => request('/api/tpm/attribution/apply', { method: 'POST', body: input }),
  // TPM de visites : { visitIds, action: 'zone' | 'set' | 'keep', providerId, reason }.
  tpmAttributionVisits: (input) => request('/api/tpm/attribution/visits', { method: 'POST', body: input }),
  // Journal : lots paginés ({ areaId, from, to, action, limit, offset }) ou détail d'un lot ({ batchId }).
  tpmAttributionLog: (filters = {}) => request('/api/tpm/attribution/log', { query: qs(filters) }),
});
