import React, { useCallback, useEffect, useState } from 'react';
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
 * rattacher seul au découpage. Une décision (lier / ignorer) vaut pour TOUTES
 * les lignes qui portent cette graphie, maintenant et aux prochains imports
 * (la graphie devient un alias). Rien n'est rattaché sans validation humaine.
 */
export default function PlaceMatchQueue({ canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [aliases, setAliases] = useState(null);
  const [busy, setBusy] = useState(null);
  const [choose, setChoose] = useState(null); // ligne pour « Choisir… »

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

  if (rows === null) return <Card><div className="card-body"><Skeleton height={220} /></div></Card>;
  const occurrences = (o) => Object.entries(o || {}).map(([k, n]) => `${formatInt(n)} ${tr(SOURCES[k] || k)}`).join(' · ');

  return (
    <>
      <Card aria-labelledby="pm-title">
        <CardHeader id="pm-title" title={tr('À rapprocher')}
          subtitle={tr('Noms de lieux importés que l\'outil n\'a pas reconnus seul. Une décision vaut pour toutes les lignes qui portent ce nom, maintenant et aux prochains imports.')}>
          {canEdit && <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === 'apply'} onClick={applyNow}>{tr('Rapprocher maintenant')}</Button>}
        </CardHeader>
        {rows.length === 0 ? (
          <div className="card-body">
            <EmptyState icon={CheckCircle2} title={tr('Tout est rattaché')}>{tr('Tous les noms de lieux des sites sont reconnus dans le découpage.')}</EmptyState>
          </div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">{tr('Nom importé')}</th><th scope="col">{tr('Niveau')}</th><th scope="col">{tr('Dans')}</th>
              <th scope="col" className="num">{tr('Lignes')}</th><th scope="col">{tr('État')}</th><th scope="col">{tr('Propositions')}</th>
              {canEdit && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.rawLabel}</strong></td>
                  <td>{r.levelLabel || `adm${r.depth}`}</td>
                  <td>{r.parentLabel || <span className="muted">{tr('tout le pays')}</span>}</td>
                  <td className="num tabular" title={occurrences(r.occurrences)}>{formatInt(r.total)}</td>
                  <td><StatusBadge map={QUEUE_STATUS} value={r.status} /></td>
                  <td>
                    {(r.candidates || []).length === 0 ? <span className="muted">{tr('aucune')}</span> : (
                      <div className="pm-cands">
                        {r.candidates.map((c) => (canEdit ? (
                          <button key={c.id} type="button" className="pm-cand" disabled={busy === r.id} onClick={() => decide(r, { action: 'lier', areaId: c.id })}
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
                    <td className="row-actions">
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

      {choose && <ChooseAreaModal row={choose} busy={busy === choose.id} onClose={() => setChoose(null)} onPick={(areaId) => decide(choose, { action: 'lier', areaId })} />}
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
      {list === null ? <Skeleton height={120} /> : list.length === 0 ? <Alert tone="info">{tr('Aucune unité trouvée. Créez-la dans le répertoire des localités si elle manque.')}</Alert> : (
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
