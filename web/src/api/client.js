const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:9000';
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

export function setSession(token, user) {
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

export const api = {
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
  deleteContract: (id) => request(`/api/contracts/${id}`, { method: 'DELETE' }),

  // Découpage administratif (localités) — référentiel par tenant/pays
  listAdminLevels: () => request('/api/settings/admin-levels'),
  listAdminAreas: (query) => request('/api/settings/admin-areas', { query }),
  adminBreakdownSummary: () => request('/api/settings/admin-breakdown/summary'),
  importAdminBreakdown: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/settings/admin-breakdown/import`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': file.name,
          ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}),
        },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },

  // Import d'un budget FLA (.xlsx) → postes pour pré-remplir le formulaire
  importBudget: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/contracts/import-budget`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name, ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
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
  monCreateForm: (input) => request('/api/monitoring/forms', { method: 'POST', body: input }),
  monUpdateForm: (id, input) => request(`/api/monitoring/forms/${id}`, { method: 'PATCH', body: input }),
  monFields: (id) => request(`/api/monitoring/forms/${id}/fields`),
  monIndicators: (id) => request(`/api/monitoring/forms/${id}/indicators`),
  monCreateIndicator: (id, input) => request(`/api/monitoring/forms/${id}/indicators`, { method: 'POST', body: input }),
  monUpdateIndicator: (indId, input) => request(`/api/monitoring/indicators/${indId}`, { method: 'PATCH', body: input }),
  monDeleteIndicator: (indId) => request(`/api/monitoring/indicators/${indId}`, { method: 'DELETE' }),
  monValues: (id, month) => request(`/api/monitoring/forms/${id}/values`, { query: month ? { month } : undefined }),
  monDashboard: (id, month) => request(`/api/monitoring/forms/${id}/dashboard`, { query: month ? { month } : undefined }),
  monOverview: (month) => request('/api/monitoring/overview', { query: month ? { month } : undefined }),
  monCatalog: (id) => request(`/api/monitoring/forms/${id}/catalog`),
  monImportDefinition: async (file) => {
    const token = getToken();
    const res = await fetch(new URL(`${API_URL}/api/monitoring/import-definition`), {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: file,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
    return res.json();
  },
  monKoboPull: (id, input) => request(`/api/monitoring/forms/${id}/kobo-pull`, { method: 'POST', body: input }),
  monImport: async (id, file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/monitoring/forms/${id}/import`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name, ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },

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
  listOffices: () => request('/api/settings/offices'),
  officeCommunes: () => request('/api/settings/offices/communes'),
  officePerimeter: (id) => request(`/api/settings/offices/${id}/perimeter`),
  createOffice: (input) => request('/api/settings/offices', { method: 'POST', body: input }),
  updateOffice: (id, input) => request(`/api/settings/offices/${id}`, { method: 'PATCH', body: input }),
  deleteOffice: (id) => request(`/api/settings/offices/${id}`, { method: 'DELETE' }),
  createActivity: (input) => request('/api/settings/activities', { method: 'POST', body: input }),
  setActivityActive: (id, active) => request(`/api/settings/activities/${id}`, { method: 'PATCH', body: { active } }),
  listPartners: (type) => request('/api/settings/partners', { query: type ? { type } : undefined }),
  createPartner: (input) => request('/api/settings/partners', { method: 'POST', body: input }),
  updatePartner: (id, input) => request(`/api/settings/partners/${id}`, { method: 'PATCH', body: input }),
  createPartnerAgent: (id, input) => request(`/api/settings/partners/${id}/agents`, { method: 'POST', body: input }),
  deletePartnerAgent: (id, agentId) => request(`/api/settings/partners/${id}/agents/${agentId}`, { method: 'DELETE' }),
  createAgentFormation: (id, agentId, input) => request(`/api/settings/partners/${id}/agents/${agentId}/formations`, { method: 'POST', body: input }),
  deleteAgentFormation: (id, agentId, formationId) => request(`/api/settings/partners/${id}/agents/${agentId}/formations/${formationId}`, { method: 'DELETE' }),
  listAgentsEvaluation: () => request('/api/tpm/agents-evaluation'),
  createAgentEvaluation: (id, agentId, input) => request(`/api/settings/partners/${id}/agents/${agentId}/evaluations`, { method: 'POST', body: input }),
  deleteAgentEvaluation: (id, agentId, evaluationId) => request(`/api/settings/partners/${id}/agents/${agentId}/evaluations/${evaluationId}`, { method: 'DELETE' }),

  // Rapports & dépenses TPM
  reportsContext: () => request('/api/tpm/reports/context'),
  listReports: (query) => request('/api/tpm/reports', { query }),
  getReport: (id) => request(`/api/tpm/reports/${id}`),
  reportInvoice: (id) => request(`/api/tpm/reports/${id}/invoice`),

  // Suivi terrain — sites & visites
  fieldSites: (q) => request('/api/tpm/field/sites', { query: q ? { q } : undefined }),
  fieldCreateSite: (input) => request('/api/tpm/field/sites', { method: 'POST', body: input }),
  fieldUpdateSite: (id, input) => request(`/api/tpm/field/sites/${id}`, { method: 'PATCH', body: input }),
  fieldVisits: (query) => request('/api/tpm/field/visits', { query }),
  fieldSummary: (month) => request('/api/tpm/field/summary', { query: month ? { month } : undefined }),
  fieldCreateVisit: (input) => request('/api/tpm/field/visits', { method: 'POST', body: input }),
  fieldUpdateVisit: (id, input) => request(`/api/tpm/field/visits/${id}`, { method: 'PATCH', body: input }),
  fieldDeleteVisit: (id) => request(`/api/tpm/field/visits/${id}`, { method: 'DELETE' }),
  fieldCollectionDays: (month) => request('/api/tpm/field/collection-days', { query: month ? { month } : undefined }),
  fieldCoverageRecap: ({ district, operationMonths } = {}) => request('/api/tpm/field/coverage-recap', { query: { ...(district ? { district } : {}), ...(operationMonths ? { operationMonths } : {}) } }),
  fieldSetTravelDays: (input) => request('/api/tpm/field/collection-days', { method: 'PUT', body: input }),
  rbmSites: (month, risk) => request('/api/tpm/field/rbm/sites', { query: { ...(month ? { month } : {}), ...(risk ? { risk } : {}) } }),
  rbmGenerate: (month, risk) => request(`/api/tpm/field/rbm/generate?month=${encodeURIComponent(month)}${risk ? `&risk=${risk}` : ''}`, { method: 'POST' }),
  rbmImport: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/field/rbm/import`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name, ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
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
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name, ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },
  createReport: (input) => request('/api/tpm/reports', { method: 'POST', body: input }),
  saveReportItems: (id, input) => request(`/api/tpm/reports/${id}/items`, { method: 'PUT', body: input }),
  approveReport: (id, input) => request(`/api/tpm/reports/${id}/approve`, { method: 'POST', body: input }),
  rejectReport: (id, input) => request(`/api/tpm/reports/${id}/reject`, { method: 'POST', body: input }),
  deleteReport: (id) => request(`/api/tpm/reports/${id}`, { method: 'DELETE' }),
  generateMonthlyReports: (input) => request('/api/tpm/reports/generate-monthly', { method: 'POST', body: input }),
  reportNotApplicable: (id) => request(`/api/tpm/reports/${id}/not-applicable`, { method: 'POST', body: {} }),

  // Suivi budgétaire consolidé (Dashboard décisionnel) — interliaison
  // Budget (contrat) ↔ Planifié (plans) ↔ Réalisé (factures).
  consolidation: (today) => request('/api/tpm/consolidation', { query: today ? { today } : undefined }),

  // Planification & budget — budget prévisionnel des vagues de collecte
  listPlans: (query) => request('/api/tpm/planning', { query }),
  getPlan: (id) => request(`/api/tpm/planning/${id}`),
  createPlan: (input) => request('/api/tpm/planning', { method: 'POST', body: input }),
  updatePlan: (id, input) => request(`/api/tpm/planning/${id}`, { method: 'PUT', body: input }),
  deletePlan: (id) => request(`/api/tpm/planning/${id}`, { method: 'DELETE' }),
  // Liaison : postes du plan pour pré-remplir une facture (même contrat + mois)
  planningPrefill: (contractId, month) => request('/api/tpm/planning/prefill', { query: { contractId, month } }),

  // Import Excel de postes (facture / plan) — validé côté serveur, non persisté
  importPostes: async (file) => {
    const buf = await file.arrayBuffer();
    let res;
    try {
      res = await fetch(new URL(`${API_URL}/api/tpm/postes/import`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name, ...(memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}) },
        body: buf,
      });
    } catch { throw new ApiError(0, 'Serveur injoignable.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
    return data;
  },
  // Modèle Excel vierge (avec listes déroulantes)
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
};
