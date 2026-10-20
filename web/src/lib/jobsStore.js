import { api } from '../api/client.js';
import { finishedSince, isActiveJob, mergeJob, pollDelay } from './jobs.js';

/**
 * Tâches de fond du compte, lues sur GET /api/jobs et PARTAGÉES par l'en-tête (« tâches en
 * cours ») et les écrans qui en lancent (assistant d'import, « Mapping MEMS ») : un seul relevé
 * pour toute l'application — toutes les 1,5 s tant qu'une tâche est en file ou en cours, toutes
 * les minutes sinon, et seulement tant qu'un composant écoute (rien après la déconnexion).
 * Quand une tâche se termine, l'évènement « mems:job-finished » est émis sur window
 * (detail = { job, watched }) : l'écran concerné se recharge ; `watched` dit qu'un écran attend
 * déjà cette tâche (waitForJob) et montre lui-même son résultat.
 */
let jobs = [];
const listeners = new Set();
const watched = new Map(); // id → nombre d'écrans qui attendent cette tâche
let timer = null;
let loading = null;

function emit() { for (const fn of [...listeners]) fn(jobs); }

function setJobs(next) {
  const done = finishedSince(jobs, next);
  jobs = next;
  emit();
  if (typeof window === 'undefined') return;
  for (const job of done) {
    window.dispatchEvent(new CustomEvent('mems:job-finished', { detail: { job, watched: watched.has(job.id) } }));
  }
}

function schedule(ms = pollDelay(jobs)) {
  clearTimeout(timer);
  timer = listeners.size ? setTimeout(refreshJobs, ms) : null;
}

/** Relit les tâches du compte (une seule lecture à la fois). */
export function refreshJobs() {
  if (loading) return loading;
  loading = (async () => {
    try {
      let next = (await api.jobs()).items || [];
      // Tâche attendue par un écran mais absente de la liste (au-delà des plus récentes) : lue seule.
      for (const id of watched.keys()) {
        if (!next.some((j) => j.id === id)) {
          try { next = mergeJob(next, await api.job(id)); } catch (e) {
            // Supprimée (ménage après 7 jours) ou d'un autre compte : l'écran qui l'attend est libéré.
            if (e && e.status === 404) next = mergeJob(next, { id, status: 'failed', error: { statusCode: 404, message: 'Tâche introuvable' } });
          }
        }
      }
      // Tâche lancée à l'instant et pas encore listée : gardée telle quelle.
      for (const j of jobs) if (isActiveJob(j) && watched.has(j.id) && !next.some((x) => x.id === j.id)) next = [...next, j];
      setJobs(next);
    } catch { /* réseau, session expirée : l'écran garde le dernier état */ }
  })().finally(() => { loading = null; schedule(); });
  return loading;
}

/** Abonnement aux tâches du compte ; rend la fonction de désabonnement. */
export function subscribeJobs(fn) {
  listeners.add(fn);
  fn(jobs);
  if (listeners.size === 1) refreshJobs(); else if (!timer && !loading) schedule();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) { clearTimeout(timer); timer = null; jobs = []; watched.clear(); } // déconnexion : rien ne reste
  };
}

/** Tâche que cet écran vient de lancer : montrée tout de suite, relue sans attendre. */
export function trackJob(job) {
  setJobs(mergeJob(jobs, job));
  schedule(400);
}

/**
 * Un écran affiché montre lui-même l'issue de cette tâche : l'en-tête ne la répète pas (pas de
 * notification) tant que la fonction rendue n'a pas été appelée (écran fermé).
 */
export function watchJob(id) {
  watched.set(id, (watched.get(id) || 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (watched.get(id) || 1) - 1;
    if (n > 0) watched.set(id, n); else watched.delete(id);
  };
}

/** Attend la fin d'une tâche (résolue avec la tâche terminée, réussie ou en échec). */
export function waitForJob(id) {
  const unwatch = watchJob(id);
  return new Promise((resolve) => {
    let off = null;
    let settled = false;
    const check = (list) => {
      const j = list.find((x) => x.id === id);
      if (settled || !j || isActiveJob(j)) return;
      settled = true;
      setTimeout(unwatch, 0); // après l'évènement « mems:job-finished » de ce relevé
      if (off) off();
      resolve(j);
    };
    off = subscribeJobs(check);
    if (settled) off();
  });
}
