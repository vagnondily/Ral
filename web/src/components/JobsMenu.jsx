import React, { useEffect, useState } from 'react';
import { ListChecks, ChevronRight } from 'lucide-react';
import { StatusBadge } from './ui.jsx';
import { usePopover } from './HeaderMenus.jsx';
import { useToast } from './Toast.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { formatInt } from '../lib/format.js';
import {
  JOB_STATUS, headerJobs, isActiveJob, jobElapsedSeconds, jobKindLabel, jobPercent, jobStepLabel, jobTarget,
} from '../lib/jobs.js';
import { subscribeJobs } from '../lib/jobsStore.js';

/**
 * « Tâches en cours » de l'en-tête : les travaux longs (import d'un fichier de soumissions,
 * réapplication du mapping) tournent en tâche de fond sur le serveur ; l'écran reste
 * utilisable. Le bouton n'apparaît que s'il y a des tâches en file, en cours ou terminées
 * depuis peu ; une roue tourne tant qu'une tâche travaille. Le panneau montre l'étape et
 * l'avancement, mène à la fiche concernée, et une notification dit la fin d'une tâche
 * quand aucun écran ne l'attendait (l'assistant d'import montre lui-même son compte rendu).
 */
export function JobsMenu({ onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const { open, setOpen, ref } = usePopover();
  const [jobs, setJobs] = useState([]);
  const [, setTick] = useState(0);

  useEffect(() => subscribeJobs(setJobs), []);
  const active = jobs.filter(isActiveJob).length;
  // Durées affichées : rafraîchies chaque seconde, seulement panneau ouvert et tâche en cours.
  useEffect(() => {
    if (!open || !active) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open, active]);
  useEffect(() => {
    const onFinished = (e) => {
      const { job, watched } = e.detail || {};
      if (!job || watched) return;
      const what = `${tr(jobKindLabel(job))}${job.payload?.formLabel ? ` — ${job.payload.formLabel}` : ''}`;
      if (job.status === 'done') toast.success(tr('{what} : terminé.', { what }));
      else toast.error(tr('{what} : échec — {message}', { what, message: job.error?.message || tr('Erreur interne du serveur.') }));
    };
    window.addEventListener('mems:job-finished', onFinished);
    return () => window.removeEventListener('mems:job-finished', onFinished);
  }, [toast, tr]);

  const list = headerJobs(jobs);
  if (!list.length) return null;
  const failed = list.some((j) => j.status === 'failed');
  const label = active ? tr('Tâches en cours : {n}', { n: active }) : tr('Tâches de fond');
  const go = (job) => { const target = jobTarget(job); setOpen(false); if (target && onNavigate) onNavigate(...target); };

  return (
    <div className="pop-anchor" ref={ref}>
      <button type="button" className="btn btn-ghost btn-icon bell-btn jobs-btn" aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {active ? <span className="spinner jobs-spinner" aria-hidden="true" /> : <ListChecks size={18} aria-hidden="true" />}
        {active > 0 && <span className="bell-count jobs-count" aria-hidden="true">{active > 9 ? '9+' : active}</span>}
        {!active && failed && <span className="bell-count is-critical jobs-count" aria-hidden="true">!</span>}
      </button>
      {open && (
        <div className="pop notif-pop jobs-pop" role="menu" aria-label={tr('Tâches de fond')}>
          <div className="pop-label notif-head">
            <span>{tr('Tâches de fond')}</span>
            <span className="notif-counts">{tr('Elles continuent même si vous changez d\'écran.')}</span>
          </div>
          {list.map((job) => {
            const pct = jobPercent(job);
            const p = job.progress || {};
            const target = jobTarget(job);
            return (
              <button type="button" role="menuitem" className="menu-item notif-item job-item" key={job.id}
                disabled={!target} onClick={() => go(job)}>
                <StatusBadge map={JOB_STATUS} value={job.status} />
                <span className="notif-text">
                  <span className="notif-title">{tr(jobKindLabel(job))}{job.payload?.formLabel ? ` — ${job.payload.formLabel}` : ''}</span>
                  <span className="job-meta">
                    {[job.payload?.fileName, job.createdByName, `${formatInt(jobElapsedSeconds(job))} s`].filter(Boolean).join(' · ')}
                  </span>
                  {isActiveJob(job) && (
                    <>
                      <span className="job-step">
                        {tr(jobStepLabel(job))}
                        {p.total ? ` · ${formatInt(p.done || 0)} / ${formatInt(p.total)}` : ''}
                      </span>
                      <span className="progress job-progress" role="progressbar" aria-label={tr(jobStepLabel(job))}
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
                        <span className={pct == null ? 'is-indeterminate' : undefined} style={pct == null ? undefined : { width: `${pct}%` }} />
                      </span>
                    </>
                  )}
                  {job.status === 'failed' && <span className="job-error">{job.error?.message || tr('Erreur interne du serveur.')}</span>}
                </span>
                {target && <ChevronRight size={15} aria-hidden="true" className="mi-icon" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
