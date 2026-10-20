/**
 * Tâches de fond (import de soumissions, réapplication du mapping) — règles d'affichage
 * PURES, testées (server/test/webJobs.test.js). Le serveur exécute et décide
 * (server/src/modules/jobs) ; l'écran montre l'état, l'étape et l'avancement.
 * Les libellés sont des phrases françaises de référence, traduites par tr().
 */

export const JOB_KIND_LABELS = {
  'monitoring.import': 'Import de soumissions',
  'monitoring.reapply': 'Réapplication du mapping',
};

export const JOB_STEP_LABELS = {
  read: 'Lecture du fichier',
  prepare: 'Préparation des soumissions',
  write: 'Écriture des soumissions',
  links: 'Rattachement aux bureaux, lieux et sites',
  relift: 'Relecture des colonnes choisies',
  dates: 'Recalcul des mois de collecte',
};

/** Statut = couleur + icône (clé de STATUS_ICONS) + libellé. */
export const JOB_STATUS = {
  queued: { label: 'En attente', icon: 'clock' },
  running: { label: 'En cours', tone: 'blue', icon: 'dot' },
  done: { label: 'Terminée', tone: 'green', icon: 'check' },
  failed: { label: 'Échec', tone: 'red', icon: 'x' },
};

export const isActiveJob = (job) => Boolean(job) && (job.status === 'queued' || job.status === 'running');

export const jobKindLabel = (job) => JOB_KIND_LABELS[job && job.kind] || 'Tâche de fond';

/** Étape à afficher. */
export function jobStepLabel(job) {
  if (!job) return '';
  if (job.status === 'queued') return 'En attente de démarrage';
  if (job.status === 'done') return 'Terminée';
  if (job.status === 'failed') return 'Échec';
  return JOB_STEP_LABELS[job.progress && job.progress.step] || 'Démarrage';
}

/** Avancement en % (entier, 0 à 100) quand l'étape a un total ; 100 une fois terminée ; sinon null. */
export function jobPercent(job) {
  if (!job) return null;
  if (job.status === 'done') return 100;
  if (job.status !== 'running' || typeof job.fraction !== 'number' || !Number.isFinite(job.fraction)) return null;
  return Math.max(0, Math.min(100, Math.floor(job.fraction * 100)));
}

/** Secondes écoulées depuis le démarrage (ou la mise en file), jusqu'à la fin s'il y en a une. */
export function jobElapsedSeconds(job, now = Date.now()) {
  if (!job) return 0;
  const start = Date.parse(job.startedAt || job.createdAt || '');
  if (!Number.isFinite(start)) return 0;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  return Math.max(0, Math.round(((Number.isFinite(end) ? end : now) - start) / 1000));
}

/** Erreur d'une tâche en échec, sous la forme d'une erreur d'API { status, message, details }. */
export function jobError(job) {
  if (!job || job.status !== 'failed') return null;
  const e = job.error || {};
  return { status: e.statusCode || 500, message: e.message || 'Erreur interne du serveur.', details: e.details };
}

/** Tâches passées d'« en file / en cours » à « terminée / en échec » entre deux relevés. */
export function finishedSince(previous, next) {
  const before = new Map((previous || []).map((j) => [j.id, j.status]));
  return (next || []).filter((j) => !isActiveJob(j) && isActiveJob({ status: before.get(j.id) }));
}

/** Délai du prochain relevé : rapide tant qu'une tâche est en file ou en cours, lent sinon. */
export function pollDelay(jobs, { activeMs = 1500, idleMs = 60000 } = {}) {
  return (jobs || []).some(isActiveJob) ? activeMs : idleMs;
}

/** Liste avec la tâche `job` à jour (remplacée, sinon ajoutée en tête). */
export function mergeJob(list, job) {
  if (!job || !job.id) return list || [];
  const rest = (list || []).filter((j) => j.id !== job.id);
  const old = (list || []).find((j) => j.id === job.id);
  return [{ ...(old || {}), ...job }, ...rest];
}

const time = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };

/** Tâches de l'en-tête : en file / en cours d'abord (plus récentes en tête), puis terminées récentes. */
export function headerJobs(jobs, max = 6) {
  const list = [...(jobs || [])];
  const active = list.filter(isActiveJob).sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const ended = list.filter((j) => !isActiveJob(j)).sort((a, b) => time(b.finishedAt || b.createdAt) - time(a.finishedAt || a.createdAt));
  return [...active, ...ended].slice(0, max);
}

/** Tâche en file ou en cours d'un type pour une fiche (ex. import déjà lancé sur cette fiche). */
export function activeJobFor(jobs, kind, formId) {
  return headerJobs(jobs, Infinity).find((j) => isActiveJob(j) && j.kind === kind && j.payload && j.payload.formId === formId) || null;
}

/** Écran à ouvrir pour une tâche : la fiche, sur l'onglet qui l'a lancée. */
export function jobTarget(job) {
  const formId = job && job.payload && job.payload.formId;
  if (!formId) return null;
  return ['processus', 'donnees', formId, job.kind === 'monitoring.reapply' ? 'mapping' : 'importation'];
}
