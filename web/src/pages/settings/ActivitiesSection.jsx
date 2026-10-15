import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Workflow, FileSignature, Plus, Search, ChevronRight, Pencil, Trash2, GitMerge, CornerDownRight, FolderInput, Inbox,
  Sparkles, Ban, Link2, X, RotateCcw, Info, Tag, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton, Stats, Alert } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { activityKey, activityErrorText, invalidateProgrammeActivities, USAGE_TEXT } from '../../lib/programmeActivities.js';

/**
 * Paramétrage › Activités — DEUX référentiels distincts (correction de l'utilisateur du 15/10) :
 *  1. Activités de programme (suivi de processus) › sous-activités (Activity_tag) › information :
 *     la liste proposée partout (sites, MMR, fiches de suivi, visites, PDD) — migration 105 ;
 *  2. Prestations contractuelles (FLA) : ce qu'un partenaire est payé pour faire dans un contrat
 *     (Suivi, Ciblage, PDM, Distribution, Évaluation) — table `activities`, inchangée.
 */
const TABS = ['programme', 'prestations'];
const USAGE_KEYS = ['sites', 'mmr', 'forms', 'visits', 'pdd'];
const USAGE_HEADINGS = { sites: 'Sites', mmr: 'Exigences MMR', forms: 'Fiches de suivi', visits: 'Visites de terrain', pdd: 'Lignes du PDD' };
const ALIAS_SOURCE = { libelle: 'ancien libellé', code: 'code', manuel: 'graphie reliée' };

export default function ActivitiesSection({ isAdmin, initialTab, onNavigate }) {
  const { tr } = useI18n();
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : 'programme');
  useEffect(() => { if (TABS.includes(initialTab)) setTab(initialTab); }, [initialTab]);
  const go = (t) => { setTab(t); if (onNavigate) onNavigate('parametrage', 'activites', t); };
  return (
    <div className="section-gap">
      <div className="segmented loc-tabs" role="tablist" aria-label={tr('Activités')}>
        <button type="button" role="tab" aria-selected={tab === 'programme'} aria-pressed={tab === 'programme'} onClick={() => go('programme')}>
          <Workflow size={15} aria-hidden="true" /> {tr('Activités de programme (suivi de processus)')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'prestations'} aria-pressed={tab === 'prestations'} onClick={() => go('prestations')}>
          <FileSignature size={15} aria-hidden="true" /> {tr('Prestations contractuelles (FLA)')}
        </button>
      </div>
      {tab === 'programme' ? <ProgrammePanel isAdmin={isAdmin} /> : <PrestationsPanel isAdmin={isAdmin} />}
    </div>
  );
}

/* ================================================================ Activités de programme == */

function ProgrammePanel({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [sel, setSel] = useState(null);         // { type: 'activity' | 'sub', id }
  const [modal, setModal] = useState(null);     // { kind, ... }

  const reload = useCallback(async () => {
    try { setData(await api.programmeActivityReferential()); } catch (e) { toast.error(e.message); setData({ activities: [], unresolved: [] }); }
  }, [toast]);
  useEffect(() => { reload(); }, [reload]);
  const changed = useCallback(async () => { invalidateProgrammeActivities(); await reload(); }, [reload]);
  // Choisir un élément ; sur un écran étroit (fiche sous la liste), la fiche vient à l'écran.
  const pick = useCallback((next) => {
    setSel(next);
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 1100px)').matches) {
      window.requestAnimationFrame(() => document.getElementById('pa-info')?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, []);

  const activities = useMemo(() => (data ? data.activities.filter((a) => !a.bucket) : []), [data]);
  const bucket = data ? data.activities.find((a) => a.bucket) : null;
  const allSubs = useMemo(() => (data ? data.activities.flatMap((a) => a.subActivities.map((s) => ({ ...s, activity: a }))) : []), [data]);
  const k = activityKey(q);
  const visible = useMemo(() => activities.filter((a) => !k
    || [a.label, a.shortLabel, a.code].some((x) => activityKey(x).includes(k))
    || a.subActivities.some((s) => activityKey(s.code).includes(k) || activityKey(s.label).includes(k))), [activities, k]);

  if (!data) return <Card><div className="card-body"><Skeleton height={260} /></div></Card>;

  const selActivity = sel && sel.type === 'activity' ? data.activities.find((a) => a.id === sel.id) : null;
  const selSub = sel && sel.type === 'sub' ? allSubs.find((s) => s.id === sel.id) : null;
  const toVerify = activities.filter((a) => a.origin === 'reprise').length;
  const toggle = (id) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = async (fn, okText) => {
    try { await fn(); if (okText) toast.success(okText); await changed(); return true; } catch (e) { toast.error(activityErrorText(tr, e)); return false; }
  };

  return (
    <>
      <Card aria-labelledby="pa-title">
        <CardHeader id="pa-title" title={tr('Activités de programme (suivi de processus)')}>
          {isAdmin && <Button icon={Plus} onClick={() => setModal({ kind: 'activity' })}>{tr('Nouvelle activité')}</Button>}
        </CardHeader>
        <p className="actref-purpose">
          {tr('Les activités que le suivi de processus observe (catégories du MMR), chacune avec ses sous-activités (Activity_tag portés par les sites, ex. GD, SMP). C\'est la seule liste proposée pour les sites, le MMR, les fiches de suivi, les visites et le PDD : une activité inconnue y est refusée.')}
        </p>
        <Stats compact items={[
          { label: tr('Activités'), value: formatInt(activities.length), foot: toVerify ? tr('{n} reprise(s) des libellés existants, à vérifier', { n: toVerify }) : tr('toutes vérifiées') },
          { label: tr('Sous-activités'), value: formatInt(allSubs.length), foot: tr('Activity_tag des sites') },
          { label: tr('À classer'), value: formatInt(bucket ? bucket.subActivities.length : 0), foot: tr('sous-activités sans activité') },
          { label: tr('Libellés non reconnus'), value: formatInt(data.unresolved.length), foot: data.unresolved.length ? tr('à relier ou à reprendre') : tr('chaque libellé est reconnu') },
        ]} />
      </Card>

      {data.unresolved.length > 0 && (
        <UnresolvedCard list={data.unresolved} isAdmin={isAdmin}
          onLink={(label) => setModal({ kind: 'target', mode: 'link', label })}
          onReprise={() => run(() => api.repriseProgrammeActivities(), tr('Libellés repris comme activités « à vérifier ».'))} />
      )}

      <div className="actref-grid">
        <Card aria-labelledby="pa-list" className="actref-listcard">
          <div className="actref-toolbar">
            <h2 className="card-title" id="pa-list">{tr('Activités › sous-activités')}</h2>
            <label className="actref-search">
              <Search size={15} aria-hidden="true" />
              <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Rechercher une activité, un code…')} aria-label={tr('Rechercher')} />
            </label>
          </div>
          <ul className="actref-tree" role="tree" aria-label={tr('Activités de programme')}>
            {bucket && bucket.subActivities.length > 0 && (
              <li className="actref-node is-bucket" role="treeitem" aria-expanded="true" aria-selected={selActivity?.id === bucket.id}>
                <div className={`actref-row ${selActivity?.id === bucket.id ? 'is-selected' : ''}`} onClick={() => pick({ type: 'activity', id: bucket.id })}>
                  <span className="actref-ic"><Inbox size={15} aria-hidden="true" /></span>
                  <span className="actref-name"><span className="actref-label">{tr('À classer')}</span>
                    <span className="actref-short">{tr('Sous-activités sans activité de programme connue : rangez-les.')}</span></span>
                  <Badge tone="orange" icon={AlertTriangle}>{formatInt(bucket.subActivities.length)}</Badge>
                </div>
                <ul role="group">
                  {bucket.subActivities.map((s) => (
                    <SubRow key={s.id} s={s} selected={selSub?.id === s.id} onSelect={() => pick({ type: 'sub', id: s.id })}
                      action={isAdmin && (
                        <Button size="sm" variant="secondary" icon={FolderInput}
                          onClick={(e) => { e.stopPropagation(); setModal({ kind: 'target', mode: 'move', source: s }); }}>{tr('Ranger sous…')}</Button>
                      )} />
                  ))}
                </ul>
              </li>
            )}
            {visible.length === 0 && (
              <li className="actref-empty">{q ? tr('Aucune activité ne correspond à « {q} ».', { q }) : tr('Aucune activité de programme. Créez la première.')}</li>
            )}
            {visible.map((a) => {
              const isOpen = open.has(a.id) || Boolean(k);
              const sites = a.usage.sites;
              return (
                <li key={a.id} className="actref-node" role="treeitem" aria-expanded={isOpen} aria-selected={selActivity?.id === a.id}>
                  <div className={`actref-row ${selActivity?.id === a.id ? 'is-selected' : ''} ${a.active ? '' : 'is-off'}`} onClick={() => pick({ type: 'activity', id: a.id })}>
                    <button type="button" className="actref-chevron" aria-label={isOpen ? tr('Replier : {label}', { label: a.label }) : tr('Déplier : {label}', { label: a.label })}
                      aria-expanded={isOpen} onClick={(e) => { e.stopPropagation(); toggle(a.id); }} disabled={!a.subActivities.length}>
                      <ChevronRight size={15} aria-hidden="true" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
                    </button>
                    <span className="actref-name">
                      <span className="actref-label">{a.label}</span>
                      <span className="actref-short">
                        <span className="mono">{a.code}</span>
                        {a.shortLabel ? ` · ${a.shortLabel}` : ''}
                      </span>
                    </span>
                    <span className="actref-meta tabular">
                      {tr('{n} sous-act.', { n: a.subActivities.length })}<br />{tr('{n} site(s)', { n: formatInt(sites) })}
                    </span>
                    <span className="actref-badges">
                      {a.origin === 'reprise' && <Badge tone="orange" icon={Sparkles}>{tr('À vérifier')}</Badge>}
                      {!a.active && <Badge icon={Ban}>{tr('Désactivée')}</Badge>}
                    </span>
                  </div>
                  {isOpen && a.subActivities.length > 0 && (
                    <ul role="group">
                      {a.subActivities.map((s) => (
                        <SubRow key={s.id} s={s} selected={selSub?.id === s.id} onSelect={() => pick({ type: 'sub', id: s.id })} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card aria-labelledby="pa-info" className="actref-infocard">
          <CardHeader id="pa-info" title={tr('Information')} subtitle={tr('Fiche de l\'élément choisi : ce qui le désigne et ce qui l\'utilise.')} />
          <div className="card-body">
            {selActivity ? (
              <ActivitySheet a={selActivity} isAdmin={isAdmin}
                onEdit={() => setModal({ kind: 'activity', activity: selActivity })}
                onAddSub={() => setModal({ kind: 'sub', activityId: selActivity.id })}
                onMerge={() => setModal({ kind: 'target', mode: 'merge', source: selActivity })}
                onConvert={() => setModal({ kind: 'target', mode: 'convert', source: selActivity })}
                onToggle={() => run(() => api.updateProgrammeActivity(selActivity.id, { active: !selActivity.active }),
                  selActivity.active ? tr('Activité désactivée : elle n\'est plus proposée.') : tr('Activité réactivée.'))}
                onDelete={async () => {
                  if (!window.confirm(tr('Supprimer l\'activité « {label} » ?', { label: selActivity.label }))) return;
                  if (await run(() => api.deleteProgrammeActivity(selActivity.id), tr('Activité supprimée.'))) setSel(null);
                }}
                onUnlink={(alias) => {
                  if (!window.confirm(tr('Ne plus reconnaître « {label} » pour cette activité ?', { label: alias.label || alias.key }))) return;
                  run(() => api.unlinkProgrammeLabel(selActivity.id, alias.key), tr('Libellé retiré.'));
                }} />
            ) : selSub ? (
              <SubSheet s={selSub} isAdmin={isAdmin}
                onEdit={() => setModal({ kind: 'sub', sub: selSub, activityId: selSub.programmeActivityId })}
                onMove={() => setModal({ kind: 'target', mode: 'move', source: selSub })}
                onToggle={() => run(() => api.updateSubActivity(selSub.id, { active: !selSub.active }),
                  selSub.active ? tr('Sous-activité désactivée.') : tr('Sous-activité réactivée.'))}
                onDelete={async () => {
                  if (!window.confirm(tr('Supprimer la sous-activité « {label} » ?', { label: selSub.label }))) return;
                  if (await run(() => api.deleteSubActivity(selSub.id), tr('Sous-activité supprimée.'))) setSel(null);
                }} />
            ) : (
              <EmptyState icon={Info} title={tr('Choisissez une activité ou une sous-activité')}>
                {tr('Sa fiche s\'affiche ici : code, libellés reconnus et « Utilisé par » (sites, exigences MMR, fiches de suivi, visites, lignes du PDD).')}
              </EmptyState>
            )}
          </div>
        </Card>
      </div>

      {modal?.kind === 'activity' && (
        <ActivityModal activity={modal.activity} onClose={() => setModal(null)}
          onSaved={async (id) => { setModal(null); await changed(); if (id) setSel({ type: 'activity', id }); }} />
      )}
      {modal?.kind === 'sub' && (
        <SubActivityModal sub={modal.sub} activityId={modal.activityId} activities={activities} onClose={() => setModal(null)}
          onSaved={async (id) => { setModal(null); await changed(); if (id) setSel({ type: 'sub', id }); }} />
      )}
      {modal?.kind === 'target' && (
        <TargetModal mode={modal.mode} source={modal.source} label={modal.label} activities={activities} onClose={() => setModal(null)}
          onDone={async (focusId) => { setModal(null); await changed(); if (focusId) setSel({ type: 'activity', id: focusId }); }} />
      )}
    </>
  );
}

function SubRow({ s, selected, onSelect, action }) {
  const { tr } = useI18n();
  return (
    <li role="treeitem" aria-selected={selected} className="actref-subnode">
      <div className={`actref-row actref-subrow ${selected ? 'is-selected' : ''} ${s.active ? '' : 'is-off'}`} onClick={onSelect}>
        <CornerDownRight size={14} aria-hidden="true" className="actref-branch" />
        <span className="mono actref-tag">{s.code}</span>
        <span className="actref-name"><span className="actref-sublabel">{s.label}</span></span>
        <span className="actref-meta tabular">{tr('{n} site(s)', { n: formatInt(s.siteCount || 0) })}</span>
        <span className="actref-badges">{!s.active && <Badge icon={Ban}>{tr('Désactivée')}</Badge>}{action}</span>
      </div>
    </li>
  );
}

/** « Utilisé par » : les cinq modules, zéro compris (une ligne vide se lit aussi). */
function UsageList({ usage }) {
  const { tr } = useI18n();
  return (
    <dl className="actref-usage">
      {USAGE_KEYS.map((key) => {
        const n = usage[key] || 0;
        return (
          <div key={key} className={n ? '' : 'is-zero'}>
            <dt>{tr(USAGE_HEADINGS[key])}</dt>
            <dd className="tabular">{formatInt(n)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ActivitySheet({ a, isAdmin, onEdit, onAddSub, onMerge, onConvert, onToggle, onDelete, onUnlink }) {
  const { tr } = useI18n();
  const used = USAGE_KEYS.some((key) => a.usage[key]) || a.subActivities.length > 0;
  if (a.bucket) {
    return (
      <div className="actref-sheet">
        <h3 className="actref-sheet-title"><Inbox size={16} aria-hidden="true" /> {tr('À classer')}</h3>
        <p className="muted">{tr('Rangement d\'attente des sous-activités dont l\'activité de programme n\'est pas connue (reprises des Tag_code des sites, ou de l\'ancienne liste). Choisissez « Ranger sous… » sur chacune.')}</p>
        <p><strong className="tabular">{formatInt(a.subActivities.length)}</strong> {tr('sous-activité(s) à ranger')}</p>
      </div>
    );
  }
  return (
    <div className="actref-sheet">
      <div className="actref-sheet-head">
        <h3 className="actref-sheet-title">{a.label}</h3>
        <div className="actref-sheet-sub"><span className="mono">{a.code}</span>{a.shortLabel ? ` · ${a.shortLabel}` : ''}</div>
        <div className="actref-badges">
          {a.active ? <Badge tone="green" icon={CheckCircle2}>{tr('Active')}</Badge> : <Badge icon={Ban}>{tr('Désactivée')}</Badge>}
          {a.origin === 'reprise' && <Badge tone="orange" icon={Sparkles}>{tr('Reprise des libellés existants — à vérifier')}</Badge>}
        </div>
      </div>
      {a.description && <p className="actref-desc">{a.description}</p>}

      <h4 className="actref-h">{tr('Utilisé par')}</h4>
      <UsageList usage={a.usage} />

      <h4 className="actref-h">{tr('Sous-activités (Activity_tag)')}</h4>
      {a.subActivities.length ? (
        <ul className="actref-chips">
          {a.subActivities.map((s) => <li key={s.id}><Tag size={12} aria-hidden="true" /><span className="mono">{s.code}</span> {s.label}</li>)}
        </ul>
      ) : <p className="muted">{tr('Aucune sous-activité.')}</p>}

      <h4 className="actref-h">{tr('Aussi reconnu sous')}</h4>
      {a.aliases.length ? (
        <ul className="actref-chips">
          {a.aliases.map((al) => (
            <li key={al.key} title={tr(ALIAS_SOURCE[al.source] || al.source)}>
              <span>{al.label || al.key}</span>
              <span className="actref-chip-src">{tr(ALIAS_SOURCE[al.source] || al.source)}</span>
              {isAdmin && <button type="button" className="actref-chip-x" aria-label={tr('Ne plus reconnaître « {label} »', { label: al.label || al.key })} onClick={() => onUnlink(al)}><X size={12} aria-hidden="true" /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="muted">{tr('Seulement son libellé et son code.')}</p>}

      {isAdmin && (
        <div className="actref-actions">
          <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>{tr('Modifier')}</Button>
          <Button size="sm" variant="secondary" icon={Plus} onClick={onAddSub}>{tr('Ajouter une sous-activité')}</Button>
          <Button size="sm" variant="secondary" icon={GitMerge} onClick={onMerge} title={tr('Ses libellés et ses sous-activités passent à une autre activité.')}>{tr('Fusionner dans…')}</Button>
          <Button size="sm" variant="secondary" icon={CornerDownRight} onClick={onConvert} title={tr('Saisie au mauvais niveau (ex. « GD ») : elle devient une sous-activité d\'une autre activité.')}>{tr('Ranger comme sous-activité de…')}</Button>
          <Button size="sm" variant="ghost" icon={Ban} onClick={onToggle}>{a.active ? tr('Désactiver') : tr('Réactiver')}</Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete} disabled={used}
            title={used ? tr('Utilisée : fusionnez-la ou désactivez-la plutôt.') : tr('Supprimer')}>{tr('Supprimer')}</Button>
        </div>
      )}
      {isAdmin && used && <p className="hint">{tr('Une activité utilisée ne se supprime pas : fusionnez-la (ses libellés la suivent) ou désactivez-la.')}</p>}
    </div>
  );
}

function SubSheet({ s, isAdmin, onEdit, onMove, onToggle, onDelete }) {
  const { tr } = useI18n();
  const sites = s.siteCount || 0;
  return (
    <div className="actref-sheet">
      <div className="actref-sheet-head">
        <h3 className="actref-sheet-title"><span className="mono">{s.code}</span> — {s.label}</h3>
        <div className="actref-sheet-sub">{s.activity.bucket ? tr('À classer') : s.activity.label}</div>
        <div className="actref-badges">
          {s.active ? <Badge tone="green" icon={CheckCircle2}>{tr('Active')}</Badge> : <Badge icon={Ban}>{tr('Désactivée')}</Badge>}
          {s.activity.bucket && <Badge tone="orange" icon={AlertTriangle}>{tr('À ranger')}</Badge>}
        </div>
      </div>
      {s.info ? <p className="actref-desc">{s.info}</p> : <p className="muted">{tr('Aucune information.')}</p>}
      <h4 className="actref-h">{tr('Utilisé par')}</h4>
      <dl className="actref-usage"><div className={sites ? '' : 'is-zero'}><dt>{tr('Sites qui portent ce code (Tag_code)')}</dt><dd className="tabular">{formatInt(sites)}</dd></div></dl>
      {isAdmin && (
        <div className="actref-actions">
          <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>{tr('Modifier')}</Button>
          <Button size="sm" variant="secondary" icon={FolderInput} onClick={onMove}>{tr('Ranger sous…')}</Button>
          <Button size="sm" variant="ghost" icon={Ban} onClick={onToggle}>{s.active ? tr('Désactiver') : tr('Réactiver')}</Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete} disabled={sites > 0}
            title={sites > 0 ? tr('Portée par des sites : désactivez-la plutôt.') : tr('Supprimer')}>{tr('Supprimer')}</Button>
        </div>
      )}
      {isAdmin && sites > 0 && <p className="hint">{tr('Code porté par {n} site(s) : il est figé et la sous-activité ne se supprime pas (désactivez-la).', { n: formatInt(sites) })}</p>}
    </div>
  );
}

function UnresolvedCard({ list, isAdmin, onLink, onReprise }) {
  const { tr } = useI18n();
  return (
    <Card aria-labelledby="pa-unres">
      <CardHeader id="pa-unres" title={tr('Libellés non reconnus')}
        subtitle={tr('Textes d\'activité écrits dans les données sans activité de programme correspondante. Reliez-les à une activité, ou reprenez-les comme activités « à vérifier ».')}>
        {isAdmin && <Button variant="secondary" icon={RotateCcw} onClick={onReprise}>{tr('Tout reprendre')}</Button>}
      </CardHeader>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">{tr('Libellé')}</th><th scope="col">{tr('Utilisé par')}</th>{isAdmin && <th scope="col" />}</tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.key}>
                <td><strong>{u.label}</strong></td>
                <td className="muted">{USAGE_KEYS.filter((key) => u.usage[key]).map((key) => tr(USAGE_TEXT[key][u.usage[key] === 1 ? 0 : 1], { n: u.usage[key] })).join(', ')}</td>
                {isAdmin && <td style={{ textAlign: 'right' }}><Button size="sm" variant="secondary" icon={Link2} onClick={() => onLink(u.label)}>{tr('Relier à…')}</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ActivityModal({ activity, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(activity);
  const [f, setF] = useState({
    label: activity?.label || '', shortLabel: activity?.shortLabel || '', code: activity?.code || '',
    description: activity?.description || '', sortOrder: activity?.sortOrder ?? 0,
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = {
    label: f.label.trim().length < 2 ? tr('Libellé requis (2 caractères au moins).') : null,
    code: f.code.trim() && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(f.code.trim()) ? tr('Code : lettre ou chiffre en tête, puis lettres, chiffres, « . », « _ » ou « - » (30 au plus).') : null,
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.label || errs.code) return;
    setSaving(true);
    try {
      const body = { label: f.label.trim(), shortLabel: f.shortLabel.trim(), description: f.description.trim(), sortOrder: Number(f.sortOrder) || 0 };
      if (f.code.trim()) body.code = f.code.trim();
      if (editing) {
        await api.updateProgrammeActivity(activity.id, body);
        toast.success(tr('Activité enregistrée.'));
        onSaved(activity.id);
      } else {
        const r = await api.createProgrammeActivity(body);
        toast.success(tr('Activité « {label} » créée.', { label: r.label }));
        onSaved(r.id);
      }
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={editing ? tr('Modifier l\'activité de programme') : tr('Nouvelle activité de programme')}
      subtitle={tr('Activité observée par le suivi de processus (catégorie du MMR).')} initialFocus="#pa-label"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="pa-form" loading={saving}>{editing ? tr('Enregistrer') : tr('Créer')}</Button></>}>
      <form id="pa-form" onSubmit={save} noValidate className="actref-form">
        <Field label={tr('Libellé officiel')} htmlFor="pa-label" required error={touched ? errs.label : undefined}
          hint={editing ? tr('L\'ancien libellé reste reconnu : les données qui l\'écrivent restent rattachées.') : tr('Ex. School meal activities')}>
          <input id="pa-label" className="input" value={f.label} maxLength={160} onChange={set('label')} />
        </Field>
        <div className="form-grid">
          <Field label={tr('Libellé court')} htmlFor="pa-short" hint={tr('Affiché dans les listes (facultatif).')}>
            <input id="pa-short" className="input" value={f.shortLabel} maxLength={60} onChange={set('shortLabel')} />
          </Field>
          <Field label={tr('Code')} htmlFor="pa-code" error={touched ? errs.code : undefined} hint={editing ? tr('L\'ancien code reste reconnu.') : tr('Facultatif : proposé d\'après le libellé.')}>
            <input id="pa-code" className="input mono" value={f.code} maxLength={30} onChange={set('code')} />
          </Field>
        </div>
        <Field label={tr('Description')} htmlFor="pa-desc">
          <textarea id="pa-desc" className="input" rows={3} maxLength={2000} value={f.description} onChange={set('description')} />
        </Field>
        <Field label={tr('Ordre')} htmlFor="pa-order" hint={tr('Rang dans les listes (plus petit en premier).')}>
          <input id="pa-order" className="input" type="number" value={f.sortOrder} onChange={set('sortOrder')} style={{ maxWidth: 140 }} />
        </Field>
      </form>
    </Modal>
  );
}

function SubActivityModal({ sub, activityId, activities, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(sub);
  const locked = editing && (sub.siteCount || 0) > 0;
  const [f, setF] = useState({ programmeActivityId: activityId || '', code: sub?.code || '', label: sub?.label || '', info: sub?.info || '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = {
    programmeActivityId: !f.programmeActivityId || !activities.some((a) => a.id === f.programmeActivityId) ? tr('Choisissez l\'activité de programme.') : null,
    code: !f.code.trim() || !activityKey(f.code) || f.code.trim().length > 60 ? tr('Code requis : 1 à 60 caractères, dont une lettre ou un chiffre.') : null,
    label: f.label.trim().length < 2 ? tr('Libellé requis (2 caractères au moins).') : null,
  };
  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.programmeActivityId || errs.code || errs.label) return;
    setSaving(true);
    try {
      const body = { programmeActivityId: f.programmeActivityId, label: f.label.trim(), info: f.info.trim() };
      if (!locked) body.code = f.code.trim();
      if (editing) { await api.updateSubActivity(sub.id, body); toast.success(tr('Sous-activité enregistrée.')); onSaved(sub.id); } else {
        const r = await api.createSubActivity({ ...body, code: f.code.trim() });
        toast.success(tr('Sous-activité « {code} » créée.', { code: f.code.trim() }));
        onSaved(r.id);
      }
    } catch (err) { toast.error(activityErrorText(tr, err)); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={editing ? tr('Modifier la sous-activité') : tr('Nouvelle sous-activité')}
      subtitle={tr('Sous-activité (Activity_tag) : le code porté par les sites, ex. GD, SMP.')} initialFocus="#sa-code"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="sa-form" loading={saving}>{editing ? tr('Enregistrer') : tr('Créer')}</Button></>}>
      <form id="sa-form" onSubmit={save} noValidate className="actref-form">
        <Field label={tr('Activité de programme')} htmlFor="sa-act" required error={touched ? errs.programmeActivityId : undefined}>
          <select id="sa-act" className={`select ${f.programmeActivityId ? '' : 'is-empty'}`} value={f.programmeActivityId} onChange={(e) => setF({ ...f, programmeActivityId: e.target.value })}>
            <option value="">{tr('Choisir une activité…')}</option>
            {activities.filter((a) => a.active || a.id === f.programmeActivityId).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>
        <div className="form-grid">
          <Field label={tr('Code (Activity_tag)')} htmlFor="sa-code" required error={touched ? errs.code : undefined}
            hint={locked ? tr('Figé : porté par {n} site(s).', { n: formatInt(sub.siteCount) }) : tr('Ex. GD, PREVMA, SMP.')}>
            <input id="sa-code" className="input mono" value={f.code} maxLength={60} disabled={locked} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label={tr('Libellé')} htmlFor="sa-label" required error={touched ? errs.label : undefined}>
            <input id="sa-label" className="input" value={f.label} maxLength={160} onChange={(e) => setF({ ...f, label: e.target.value })} />
          </Field>
        </div>
        <Field label={tr('Information')} htmlFor="sa-info" hint={tr('Définition, public cible, modalité… (facultatif).')}>
          <textarea id="sa-info" className="input" rows={3} maxLength={2000} value={f.info} onChange={(e) => setF({ ...f, info: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Choix d'une activité cible : fusionner, ranger comme sous-activité, ranger une sous-activité,
 * relier un libellé non reconnu. Le texte dit ce qui va changer, avant d'agir.
 */
function TargetModal({ mode, source, label, activities, onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [code, setCode] = useState(mode === 'convert' ? (source.code || '') : '');
  const [busy, setBusy] = useState(false);
  const choices = activities.filter((a) => a.active && (!source || a.id !== source.id) && a.id !== source?.programmeActivityId);
  const t = activities.find((a) => a.id === target);
  const TITLES = {
    merge: tr('Fusionner « {label} » dans…', { label: source?.label }),
    convert: tr('Ranger « {label} » comme sous-activité de…', { label: source?.label }),
    move: tr('Ranger la sous-activité « {code} » sous…', { code: source?.code }),
    link: tr('Relier « {label} » à…', { label }),
  };
  const explain = !t ? null : {
    merge: tr('Les textes qui écrivent « {from} » (sites, MMR, fiches, visites, PDD) désigneront « {to} », et ses sous-activités passeront sous « {to} ». Aucune donnée n\'est réécrite ; « {from} » disparaît de la liste.', { from: source?.label, to: t.label }),
    convert: tr('« {from} » devient la sous-activité « {code} » de « {to} » : ses données désigneront « {to} ». Aucune donnée n\'est réécrite.', { from: source?.label, code: code || '…', to: t.label }),
    move: tr('La sous-activité « {code} » sera rangée sous « {to} ».', { code: source?.code, to: t.label }),
    link: tr('Le libellé « {from} » désignera « {to} » partout où il est écrit.', { from: label, to: t.label }),
  }[mode];
  async function confirm() {
    if (!t) return;
    setBusy(true);
    try {
      if (mode === 'merge') { await api.mergeProgrammeActivity(source.id, t.id); toast.success(tr('Activités fusionnées.')); } else if (mode === 'convert') {
        await api.convertProgrammeActivity(source.id, { targetId: t.id, ...(code.trim() ? { code: code.trim() } : {}) });
        toast.success(tr('« {from} » est maintenant une sous-activité de « {to} ».', { from: source.label, to: t.label }));
      } else if (mode === 'move') { await api.updateSubActivity(source.id, { programmeActivityId: t.id }); toast.success(tr('Sous-activité rangée.')); } else {
        await api.linkProgrammeLabel({ label, programmeActivityId: t.id }); toast.success(tr('Libellé relié.'));
      }
      onDone(t.id);
    } catch (e) { toast.error(activityErrorText(tr, e)); } finally { setBusy(false); }
  }
  const icon = { merge: GitMerge, convert: CornerDownRight, move: FolderInput, link: Link2 }[mode];
  return (
    <Modal open onClose={() => !busy && onClose()} title={TITLES[mode]}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button icon={icon} onClick={confirm} loading={busy} disabled={!t}>{tr('Confirmer')}</Button></>}>
      <div className="actref-form">
        <Field label={tr('Activité de programme')} htmlFor="tg-act" required>
          <select id="tg-act" className={`select ${target ? '' : 'is-empty'}`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{tr('Choisir une activité…')}</option>
            {choices.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>
        {mode === 'convert' && (
          <Field label={tr('Code de la sous-activité (Activity_tag)')} htmlFor="tg-code" hint={tr('Par défaut, le code de l\'activité rangée.')}>
            <input id="tg-code" className="input mono" value={code} maxLength={60} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {explain && <Alert tone="info" icon={Info}>{explain}</Alert>}
      </div>
    </Modal>
  );
}

/* ============================================================= Prestations contractuelles == */

function PrestationsPanel({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(false);
  const reload = useCallback(async () => {
    try { setItems(await api.listActivities()); } catch (e) { toast.error(e.message); setItems([]); }
  }, [toast]);
  useEffect(() => { reload(); }, [reload]);
  async function toggle(a) {
    try { await api.setActivityActive(a.id, !a.active); reload(); } catch (e) { toast.error(e.message); }
  }
  return (
    <Card aria-labelledby="pf-title">
      <CardHeader id="pf-title" title={tr('Prestations contractuelles (FLA)')}>
        {isAdmin && <Button icon={Plus} onClick={() => setModal(true)}>{tr('Nouvelle prestation')}</Button>}
      </CardHeader>
      <p className="actref-purpose">
        {tr('Ce qu\'un partenaire est payé pour faire dans un contrat FLA (suivi, ciblage, PDM…) : multi-sélection sur les contrats et ventilation du budget. Sans lien avec les activités de programme.')}
      </p>
      {items === null ? <div className="card-body"><Skeleton height={100} /></div> : items.length === 0 ? (
        <div className="card-body"><EmptyState icon={FileSignature} title={tr('Aucune prestation')} /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{tr('Prestation')}</th><th scope="col">{tr('Code')}</th><th scope="col">{tr('État')}</th>{isAdmin && <th scope="col" />}</tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.label}</strong></td>
                  <td><span className="mono">{a.code}</span></td>
                  <td>{a.active ? <Badge tone="green" icon={CheckCircle2}>{tr('Active')}</Badge> : <Badge icon={Ban}>{tr('Inactive')}</Badge>}</td>
                  {isAdmin && <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" onClick={() => toggle(a)}>{a.active ? tr('Désactiver') : tr('Activer')}</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <PrestationModal onClose={() => setModal(false)} onSaved={() => { setModal(false); reload(); }} />}
    </Card>
  );
}

function PrestationModal({ onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ code: '', label: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = {
    label: f.label.trim().length < 2 ? tr('Libellé requis.') : null,
    code: !/^[a-z0-9_-]{2,40}$/i.test(f.code.trim()) ? tr('Code : lettres/chiffres/tiret, 2 à 40.') : null,
  };
  async function save(e) {
    e.preventDefault();
    setTouched(true);
    if (errs.label || errs.code) return;
    setSaving(true);
    try { await api.createActivity({ code: f.code.trim(), label: f.label.trim() }); toast.success(tr('Enregistré.')); onSaved(); } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={tr('Nouvelle prestation contractuelle')} initialFocus="#pf-label"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button type="submit" form="pf-form" loading={saving}>{tr('Créer')}</Button></>}>
      <form id="pf-form" onSubmit={save} noValidate className="actref-form">
        <Field label={tr('Libellé')} htmlFor="pf-label" required error={touched ? errs.label : undefined}>
          <input id="pf-label" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={tr('Ex. Suivi post-distribution (PDM)')} />
        </Field>
        <Field label={tr('Code')} htmlFor="pf-code" required error={touched ? errs.code : undefined}>
          <input id="pf-code" className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="pdm" />
        </Field>
      </form>
    </Modal>
  );
}
