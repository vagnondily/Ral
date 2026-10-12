import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, EyeOff, Search, RefreshCw, Trash2, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton, StatusBadge } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';

// Statut d'une graphie de la file : couleur + icône + libellé (jamais la couleur seule).
const QUEUE_STATUS = {
  a_valider: { label: 'Proposition à valider', tone: 'orange', icon: 'clock' },
  ambigu: { label: 'Plusieurs possibilités', tone: 'orange', icon: 'warn' },
  introuvable: { label: 'Non trouvée', tone: 'red', icon: 'x' },
};
const SOURCES = { sites: 'sites', soumissions: 'formulaires reçus', pdd: 'distributions' };

/**
 * File « À rapprocher » : noms de lieux importés que le moteur n'a pas pu
 * rattacher seul au découpage, et sites déclarés dans les formulaires reçus
 * (DPName, POIName, école…) qu'il n'a pas pu relier au référentiel des sites.
 * Une décision (lier / ignorer) vaut pour TOUTES les lignes qui portent cette
 * graphie, maintenant et aux prochains imports (la graphie devient un alias).
 * Rien n'est rattaché sans validation humaine.
 */
export default function PlaceMatchQueue({ canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [aliases, setAliases] = useState(null);
  const [busy, setBusy] = useState(null);
  const [choose, setChoose] = useState(null); // ligne pour « Choisir… »
  const [kind, setKind] = useState('zone');     // lieux du découpage | sites des formulaires reçus

  const load = useCallback(async () => {
    try {
      const [q, a] = await Promise.all([api.listPlaceMatches(), api.listPlaceAliases()]);
      setRows(q); setAliases(a);
    } catch (e) { toast.error(e.message); setRows([]); setAliases([]); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function decide(row, body) {
    setBusy(row.id);
    try {
      const r = await api.decidePlaceMatch(row.id, body);
      toast.success(body.action === 'ignorer'
        ? tr('« {label} » ne sera plus proposée.', { label: row.rawLabel })
        : row.kind === 'site'
          ? tr('« {label} » est reliée au site {name} : {n} formulaire(s) reçu(s) relié(s) à un site au total.', { label: row.rawLabel, name: r.site?.name || '', n: formatInt(r.applied?.submissionSites?.linked ?? 0) })
          : tr('« {label} » est rattachée : {n} site(s) rattaché(s) au total.', { label: row.rawLabel, n: formatInt(r.applied?.sites?.resolved ?? 0) }));
      setChoose(null);
      await load();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function applyNow() {
    setBusy('apply');
    try {
      const r = await api.applyPlaceMatches();
      toast.success(tr('Rattachement relancé : {ok} site(s) rattaché(s), {pending} à rapprocher.', { ok: formatInt(r.sites.resolved), pending: formatInt(r.sites.pending) }));
      await load();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function removeAlias(a) {
    if (!window.confirm(tr('Oublier la graphie « {label} » ? Les lignes qui la portent repasseront dans la file.', { label: a.aliasLabel }))) return;
    try { await api.deletePlaceAlias(a.id); await load(); } catch (e) { toast.error(e.message); }
  }

  const byKind = useMemo(() => ({
    zone: (rows || []).filter((r) => r.kind !== 'site'),
    site: (rows || []).filter((r) => r.kind === 'site'),
  }), [rows]);
  const link = (r, id) => decide(r, r.kind === 'site' ? { action: 'lier', siteId: id } : { action: 'lier', areaId: id });

  if (rows === null) return <Card><div className="card-body"><Skeleton height={220} /></div></Card>;
  const shown = byKind[kind];
  const occurrences = (o) => Object.entries(o || {}).map(([k, n]) => `${formatInt(n)} ${tr(SOURCES[k] || k)}`).join(' · ');

  return (
    <>
      <Card aria-labelledby="pm-title">
        <CardHeader id="pm-title" title={tr('À rapprocher')}
          subtitle={tr('Noms de lieux et de sites importés que l\'outil n\'a pas reconnus seul. Une décision vaut pour toutes les lignes qui portent ce nom, maintenant et aux prochains imports.')}>
          {canEdit && <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === 'apply'} onClick={applyNow}>{tr('Rapprocher maintenant')}</Button>}
        </CardHeader>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="segmented" role="tablist" aria-label={tr('Type de nom')}>
            <button type="button" role="tab" aria-selected={kind === 'zone'} aria-pressed={kind === 'zone'} onClick={() => setKind('zone')}>
              {tr('Lieux (découpage)')} <span className="tabular muted">{formatInt(byKind.zone.length)}</span></button>
            <button type="button" role="tab" aria-selected={kind === 'site'} aria-pressed={kind === 'site'} onClick={() => setKind('site')}>
              {tr('Sites des formulaires reçus')} <span className="tabular muted">{formatInt(byKind.site.length)}</span></button>
          </div>
          {kind === 'site' && <p className="hint">{tr('Site déclaré dans un formulaire (point de distribution, point d\'intérêt, école) que l\'outil n\'a pas relié seul au référentiel des sites. Un code (école, fokontany) relié une fois l\'est partout ; un nom l\'est dans sa commune.')}</p>}
        </div>
        {shown.length === 0 ? (
          <div className="card-body">
            <EmptyState icon={CheckCircle2} title={tr('Tout est rattaché')}>{kind === 'site'
              ? tr('Tous les sites déclarés dans les formulaires reçus sont reliés au référentiel des sites.')
              : tr('Tous les noms de lieux des sites sont reconnus dans le découpage.')}</EmptyState>
          </div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">{kind === 'site' ? tr('Site déclaré') : tr('Nom importé')}</th>{kind !== 'site' && <th scope="col">{tr('Niveau')}</th>}<th scope="col">{tr('Dans')}</th>
              <th scope="col" className="num">{tr('Lignes')}</th><th scope="col">{tr('État')}</th><th scope="col">{tr('Propositions')}</th>
              {canEdit && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.rawLabel}</strong></td>
                  {kind !== 'site' && <td>{r.levelLabel || `adm${r.depth}`}</td>}
                  <td>{r.parentLabel || <span className="muted">{tr('tout le pays')}</span>}</td>
                  <td className="num tabular" title={occurrences(r.occurrences)}>{formatInt(r.total)}</td>
                  <td><StatusBadge map={QUEUE_STATUS} value={r.status} /></td>
                  <td>
                    {(r.candidates || []).length === 0 ? <span className="muted">{tr('aucune')}</span> : (
                      <div className="pm-cands">
                        {r.candidates.map((c) => (canEdit ? (
                          <button key={c.id} type="button" className="pm-cand" disabled={busy === r.id} onClick={() => link(r, c.id)}
                            title={tr('Lier « {label} » à {name}', { label: r.rawLabel, name: c.name })}>
                            <Link2 size={14} aria-hidden="true" /> {tr('Lier à {name}', { name: c.name })}
                            <span className="pm-score tabular">{Math.round((c.score || 0) * 100)} %</span>
                          </button>
                        ) : (
                          <span key={c.id} className="chip is-static">{c.name} <span className="pm-score tabular">{Math.round((c.score || 0) * 100)} %</span></span>
                        )))}
                      </div>
                    )}
                  </td>
                  {canEdit && (
                    <td className="row-actions is-stacked">
                      <Button size="sm" variant="secondary" icon={Search} onClick={() => setChoose(r)}>{tr('Choisir…')}</Button>
                      <Button size="sm" variant="ghost" icon={EyeOff} disabled={busy === r.id} onClick={() => decide(r, { action: 'ignorer' })}>{tr('Ignorer')}</Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card aria-labelledby="pm-alias-title">
        <CardHeader id="pm-alias-title" title={tr('Graphies apprises')}
          subtitle={tr('Noms validés une fois et reconnus ensuite automatiquement (validation ou renommage d\'une localité).')} />
        {(aliases || []).length === 0 ? <div className="card-body"><p className="muted">{tr('Aucune graphie apprise pour l\'instant.')}</p></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">{tr('Nom importé')}</th><th scope="col">{tr('Rattaché à')}</th><th scope="col">{tr('Origine')}</th>
              {canEdit && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}</tr></thead>
            <tbody>
              {aliases.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.aliasLabel}</strong></td>
                  <td>{a.currentPath || a.targetPath || a.targetPcode || '—'}</td>
                  <td><Badge tone={a.source === 'renommage' ? 'blue' : 'green'}>{a.source === 'renommage' ? tr('Renommage') : tr('Validé')}</Badge></td>
                  {canEdit && <td className="row-actions"><Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeAlias(a)}>{tr('Oublier')}</Button></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {choose && (choose.kind === 'site'
        ? <ChooseSiteModal row={choose} busy={busy === choose.id} onClose={() => setChoose(null)} onPick={(siteId) => link(choose, siteId)} />
        : <ChooseAreaModal row={choose} busy={busy === choose.id} onClose={() => setChoose(null)} onPick={(areaId) => link(choose, areaId)} />)}
    </>
  );
}

/** Recherche d'une unité du même niveau (le serveur vérifie qu'elle est dans le même parent). */
function ChooseAreaModal({ row, busy, onClose, onPick }) {
  const { tr } = useI18n();
  const [q, setQ] = useState(row.parentId ? '' : row.rawLabel.slice(0, 4));
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const r = await api.listLocalities({ depth: row.depth, ancestorId: row.parentId || undefined, q: q || undefined, page: 1, pageSize: 30 });
        if (alive) setList(r.rows || []);
      } catch { if (alive) setList([]); }
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [q, row.depth]);

  return (
    <Modal open onClose={onClose} title={tr('Rattacher « {label} »', { label: row.rawLabel })}
      subtitle={row.parentLabel ? tr('Choisissez une unité de niveau « {level} » dans {parent}.', { level: row.levelLabel || `adm${row.depth}`, parent: row.parentLabel }) : tr('Choisissez une unité de niveau « {level} ».', { level: row.levelLabel || `adm${row.depth}` })}>
      <label className="field">
        <span className="field-label">{tr('Rechercher')}</span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      {short ? <p className="muted">{tr('Tapez au moins 2 caractères du nom, du code ou de la commune du site.')}</p>
        : list === null ? <Skeleton height={120} /> : list.length === 0 ? <Alert tone="info">{tr('Aucune unité trouvée. Créez-la dans le répertoire des localités si elle manque.')}</Alert> : (
        <ul className="pm-pick">
          {list.map((a) => (
            <li key={a.id}>
              <button type="button" className="pm-pick-item" disabled={busy} onClick={() => onPick(a.id)}>
                <strong>{a.name}</strong> <span className="muted">{a.path}</span>{a.pcode && <span className="mono muted"> · {a.pcode}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Recherche d'un site du référentiel (nom, code, ID RBM, commune ou district). */
function ChooseSiteModal({ row, busy, onClose, onPick }) {
  const { tr } = useI18n();
  const first = String(row.rawLabel || '').replace(/\s*\(.*\)$/, '');
  // Code d'école (chiffres) : cherché tel quel ; pcode de fokontany : sa commune ; sinon le début du nom.
  const [q, setQ] = useState(/^\d+$/.test(first) ? first : /^[A-Za-z]{2,3}\d{4,}/.test(first) ? (row.parentLabel || first) : first.slice(0, 6));
  const [list, setList] = useState(null);
  const short = !q || q.trim().length < 2;
  useEffect(() => {
    let alive = true;
    setList(null);
    const h = setTimeout(async () => {
      if (short) return; // rien cherché : pas de « aucun site trouvé »
      try { const r = await api.fieldSites(q.trim()); if (alive) setList((r || []).slice(0, 40)); } catch { if (alive) setList([]); }
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);
  return (
    <Modal open onClose={onClose} title={tr('Relier « {label} » à un site', { label: row.rawLabel })}
      subtitle={row.parentLabel ? tr('Déclaré dans {parent}.', { parent: row.parentLabel }) : null}>
      <label className="field">
        <span className="field-label">{tr('Rechercher un site (nom, code, commune)')}</span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      {short ? <p className="muted">{tr('Tapez au moins 2 caractères du nom, du code ou de la commune du site.')}</p>
        : list === null ? <Skeleton height={120} /> : list.length === 0 ? <Alert tone="info">{tr('Aucun site trouvé. Ajoutez-le au référentiel (RBM & plan de suivi › Sites) s\'il manque.')}</Alert> : (
        <ul className="pm-pick">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" className="pm-pick-item" disabled={busy} onClick={() => onPick(s.id)}>
                <strong>{s.name}</strong> <span className="muted">{[s.commune, s.district].filter(Boolean).join(' · ')}</span>
                {s.activity && <span className="muted"> · {s.activity}</span>}{s.code && <span className="mono muted"> · {s.code}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

