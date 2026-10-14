import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, Pencil, MapPin, LocateFixed, Download, Upload, FileSpreadsheet, X, Tag, Building2, Link2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { monthLabel } from '../../lib/format.js';

/**
 * Registre des sites — page de gestion dédiée (Paramétrage › Sites).
 * Insertion / modification / suppression + attribution automatique de la zone
 * depuis le GPS (centroïde le plus proche). La liaison se fait par l'identité
 * stable du site (UUID / Code POI), jamais par pcode.
 */
const LIST_CAP = 5000;
const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

export default function SitesSection({ isAdmin, onOpenTab, showAdmCodes = true }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [offices, setOffices] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // null | {} (nouveau) | ligne
  const [busyGps, setBusyGps] = useState(false);
  const [busyIo, setBusyIo] = useState(false);
  const [sel, setSel] = useState(() => new Set()); // sites cochés (retour 62)
  const [bulk, setBulk] = useState(null);         // 'activity' | 'office' | 'delete'
  const [refused, setRefused] = useState(null);   // sites gardés après une suppression groupée
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setRows(null); setError(null);
    Promise.all([
      // Tout le registre (plafond serveur 5 000), jamais tronqué en silence.
      api.listSiteRegistry(q ? { q, limit: LIST_CAP } : { limit: LIST_CAP }),
      api.listOffices().catch(() => []),
    ]).then(([list, offs]) => { setRows(list); setOffices(offs || []); })
      .catch((e) => setError(e.message));
  }, [q]);
  useEffect(() => { const id = setTimeout(load, q ? 250 : 0); return () => clearTimeout(id); }, [load, q]);
  // La sélection ne garde que des sites encore listés (après un rechargement ou une recherche).
  useEffect(() => { if (rows) setSel((prev) => new Set(rows.filter((r) => prev.has(r.id)).map((r) => r.id))); }, [rows]);
  const ids = useMemo(() => [...sel], [sel]);
  const allChecked = !!rows && rows.length > 0 && rows.every((r) => sel.has(r.id));
  const someChecked = sel.size > 0 && !allChecked;
  const toggle = (id) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set((rows || []).map((r) => r.id)));

  async function gpsSelection() {
    setBusyGps(true);
    try {
      const r = await api.autoAttributeSites({ ids, onlyEmpty: false });
      toast.success(tr('{n} site(s) rattaché(s) ; {s} sans correspondance.', { n: r.attributed, s: r.skipped }));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusyGps(false); }
  }
  async function exportSelection() {
    setBusyIo(true);
    try { await api.siteRegistryExportSelection(ids); } catch (e) { toast.error(e.message); } finally { setBusyIo(false); }
  }

  async function removeSite(s) {
    if (!window.confirm(tr('Supprimer le site « {name} » ?', { name: s.localite }))) return;
    try { await api.deleteSiteRegistry(s.id); toast.success(tr('Site supprimé.')); load(); }
    catch (e) { toast.error(e.message); }
  }

  async function doExport() {
    setBusyIo(true);
    try { await api.siteRegistryExport(q); } catch (e) { toast.error(e.message); } finally { setBusyIo(false); }
  }
  async function doTemplate() {
    setBusyIo(true);
    try { await api.siteRegistryTemplate(); } catch (e) { toast.error(e.message); } finally { setBusyIo(false); }
  }
  async function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setBusyIo(true);
    try {
      const r = await api.importSiteRegistry(file);
      const nSkip = (r.skipped || []).length;
      toast.success(tr('Import : {c} créé(s), {u} mis à jour{s}.', {
        c: r.created, u: r.updated, s: nSkip ? tr(' ; {n} ignoré(s)', { n: nSkip }) : '',
      }));
      if (r.ignoredCodes) toast.info(tr('{n} identifiant(s) saisi(s) dans le modèle et inconnu(s) de MEMS : non repris, les sites ont reçu l\'identifiant de MEMS.', { n: r.ignoredCodes }));
      load();
    } catch (e2) { toast.error(e2.message); } finally { setBusyIo(false); }
  }

  async function runGps() {
    if (!window.confirm(tr('Attribuer la zone (région / district / commune) à tous les sites géolocalisés, depuis leurs coordonnées GPS ?'))) return;
    setBusyGps(true);
    try {
      const r = await api.autoAttributeSites({ onlyEmpty: false });
      toast.success(tr('{n} site(s) rattaché(s) ; {s} sans correspondance.', { n: r.attributed, s: r.skipped }));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusyGps(false); }
  }

  if (!isAdmin) return <Card><EmptyState icon={MapPin} title={tr('Réservé aux administrateurs')} /></Card>;
  if (error) return <Card><EmptyState icon={MapPin} title={tr('Sites indisponibles')} action={<Button onClick={load}>{tr('Réessayer')}</Button>}>{error}</EmptyState></Card>;

  return (
    <Card>
      <CardHeader title={tr('Registre des sites')}
        subtitle={rows ? tr('{n} site(s) — le même registre que le RBM, le plan de suivi et les données reçues.', { n: rows.length }) : ''}>
        <div className="toolbar">
          <span className="input-wrap ind-search">
            <Search size={16} aria-hidden="true" />
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Rechercher (nom, commune, code POI…)')} aria-label={tr('Rechercher un site')} />
          </span>
          <Button size="sm" variant="secondary" icon={LocateFixed} loading={busyGps} onClick={runGps}>{tr('Attribuer depuis le GPS')}</Button>
          <Button size="sm" variant="ghost" icon={FileSpreadsheet} loading={busyIo} onClick={doTemplate}>{tr('Modèle')}</Button>
          <Button size="sm" variant="ghost" icon={Download} loading={busyIo} onClick={doExport}>{tr('Exporter')}</Button>
          <Button size="sm" variant="ghost" icon={Upload} loading={busyIo} onClick={() => fileRef.current && fileRef.current.click()}>{tr('Importer')}</Button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImportFile} />
          <Button size="sm" icon={Plus} onClick={() => setEdit({})}>{tr('Nouveau site')}</Button>
        </div>
      </CardHeader>

      {rows && rows.length >= LIST_CAP && (
        <Alert tone="warning">{tr('Affichage limité aux {n} premiers sites : affinez avec la recherche.', { n: LIST_CAP })}</Alert>
      )}
      {onOpenTab && (
        <div className="note" style={{ margin: '0 20px 12px' }}>
          <Link2 size={16} aria-hidden="true" />
          <span>{tr('Les sites déclarés dans les formulaires reçus se relient à ce registre dans')}{' '}
            <button type="button" className="link-btn" style={{ marginLeft: 0 }} onClick={() => onOpenTab('rapprocher')}>{tr('À rapprocher')}</button>.
          </span>
        </div>
      )}

      {sel.size > 0 && (
        <div className="bulk-bar" role="region" aria-label={tr('Actions sur la sélection')}>
          <strong>{tr('{n} site(s) sélectionné(s)', { n: sel.size })}</strong>
          <Button size="sm" variant="secondary" icon={Tag} onClick={() => setBulk('activity')}>{tr('Changer l\'activité')}</Button>
          <Button size="sm" variant="secondary" icon={Building2} onClick={() => setBulk('office')}>{tr('Changer le bureau')}</Button>
          <Button size="sm" variant="secondary" icon={LocateFixed} loading={busyGps} onClick={gpsSelection}>{tr('Attribuer depuis le GPS')}</Button>
          <Button size="sm" variant="secondary" icon={Download} loading={busyIo} onClick={exportSelection}>{tr('Exporter la sélection')}</Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => setBulk('delete')}>{tr('Supprimer')}</Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => setSel(new Set())}>{tr('Désélectionner')}</Button>
        </div>
      )}
      {refused && refused.length > 0 && (
        <Alert tone="warning">
          {tr('{n} site(s) gardé(s) : ils portent des données (marquez-les inactifs dans la grille des sites actifs).', { n: refused.length })}
          <ul className="compact-list">{refused.slice(0, 8).map((r) => <li key={r.id}><strong>{r.name}</strong> — {r.reason}</li>)}</ul>
          {refused.length > 8 && <span className="muted">{tr('… et {n} autre(s).', { n: refused.length - 8 })}</span>}
        </Alert>
      )}

      {!rows ? <Skeleton height={220} /> : rows.length === 0 ? (
        <EmptyState icon={MapPin} title={tr('Aucun site')} action={<Button icon={Plus} onClick={() => setEdit({})}>{tr('Ajouter un site')}</Button>}>
          {tr('Ajoutez un site, ou importez-les. Avec des coordonnées GPS, « Attribuer depuis le GPS » rattache automatiquement la zone.')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr>
              <th className="col-check">
                <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll} aria-label={tr('Tout sélectionner')} />
              </th>
              <th>{tr('Identifiant')}</th><th>{tr('Localité')}</th><th>{tr('Code POI')}</th>
              <th>{tr('Field office')}</th><th>{tr('Code bureau')}</th>
              <th>{tr('Région')}</th>{showAdmCodes && <th>Adm1</th>}<th>{tr('District')}</th>{showAdmCodes && <th>Adm2</th>}
              <th>{tr('Commune')}</th>{showAdmCodes && <th>Adm3</th>}<th>{tr('Fokontany')}</th>{showAdmCodes && <th>Adm4</th>}
              <th>{tr('Activité')}</th><th>{tr('Code tag')}</th>
              <th title={tr('Mois de la dernière soumission rattachée à ce site')}>{tr('Dernière collecte (données)')}</th>
              <th className="num">{tr('Soumissions')}</th><th className="num">{tr('Visites')}</th>
              <th>Lat</th><th>Long</th><th />
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={sel.has(s.id) ? 'is-selected' : ''}>
                  <td className="col-check">
                    <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={tr('Sélectionner « {name} »', { name: s.localite })} />
                  </td>
                  <td className="mono">{s.identifiant}</td>
                  <td>{s.localite}</td>
                  <td className="mono">{s.codePoi || '—'}</td>
                  <td>{s.fieldOffice || '—'}</td>
                  <td className="mono">{s.fieldOfficeCode || '—'}</td>
                  <td>{s.region || '—'}</td>{showAdmCodes && <td className="mono muted">{s.adm1Code || '—'}</td>}
                  <td>{s.district || '—'}</td>{showAdmCodes && <td className="mono muted">{s.adm2Code || '—'}</td>}
                  <td>{s.commune || '—'}</td>{showAdmCodes && <td className="mono muted">{s.adm3Code || '—'}</td>}
                  <td>{s.fokontany || '—'}</td>{showAdmCodes && <td className="mono muted">{s.adm4Code || '—'}</td>}
                  <td>{s.activityTag || '—'}</td><td className="mono">{s.tagCode || '—'}</td>
                  <td>{s.lastDataMonth ? monthLabel(s.lastDataMonth) : <span className="cell-empty">{tr('aucune')}</span>}</td>
                  <td className="num tabular">{s.submissionCount || 0}</td><td className="num tabular">{s.visitCount || 0}</td>
                  <td className="tabular">{s.lat ?? '—'}</td><td className="tabular">{s.lng ?? '—'}</td>
                  <td className="nowrap">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(s)} aria-label={tr('Modifier')} />
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeSite(s)} aria-label={tr('Supprimer')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <SiteFormModal site={edit} offices={offices} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {bulk && (
        <BulkModal kind={bulk} ids={ids} offices={offices} onClose={() => setBulk(null)}
          onDone={(r) => {
            setBulk(null);
            if (bulk === 'delete') {
              setRefused(r.refused || []);
              toast.success(tr('{n} site(s) supprimé(s).', { n: r.deleted }));
            } else {
              setRefused(null);
              toast.success(tr('{n} site(s) modifié(s).', { n: r.updated }));
            }
            setSel(new Set());
            load();
          }} />
      )}
    </Card>
  );
}

/** Action groupée : changer l'activité, changer le bureau, ou supprimer (sites sans donnée reliée). */
function BulkModal({ kind, ids, offices, onClose, onDone }) {
  const { tr } = useI18n();
  const [value, setValue] = useState('');
  const [activities, setActivities] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (kind !== 'activity') return;
    api.listMmr().then((rows) => setActivities([...new Set(rows.map((r) => String(r.activityCategory || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))))
      .catch(() => setActivities([]));
  }, [kind]);
  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = kind === 'delete'
        ? await api.bulkSiteRegistry(ids, 'delete')
        : await api.bulkSiteRegistry(ids, 'set', kind === 'activity' ? { activityTag: value || null } : { fieldOfficeId: value || null });
      onDone(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const title = kind === 'delete' ? tr('Supprimer {n} site(s) ?', { n: ids.length })
    : kind === 'activity' ? tr('Changer l\'activité de {n} site(s)', { n: ids.length }) : tr('Changer le bureau de {n} site(s)', { n: ids.length });
  return (
    <Modal open onClose={() => !busy && onClose()} title={title}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button>
          <Button variant={kind === 'delete' ? 'danger' : 'primary'} loading={busy} onClick={run}>{kind === 'delete' ? tr('Supprimer') : tr('Appliquer')}</Button>
        </>
      )}>
      {kind === 'delete' && <p>{tr('Seuls les sites sans donnée reliée (visites, soumissions, grille des sites actifs) sont supprimés ; les autres restent et sont listés. L\'action est définitive.')}</p>}
      {kind === 'activity' && (
        <Field label={tr('Activité')} hint={tr('Les activités viennent du MMR (Paramétrage › Paramètres MMR).')}>
          {activities === null ? <Skeleton height={38} /> : (
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">{tr('— aucune (retirer l\'activité) —')}</option>
              {activities.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </Field>
      )}
      {kind === 'office' && (
        <Field label={tr('Bureau')}>
          <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">{tr('— aucun (retirer le bureau) —')}</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ''}</option>)}
          </select>
        </Field>
      )}
      {err && <Alert tone="danger">{err}</Alert>}
    </Modal>
  );
}

function SiteFormModal({ site, offices, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const isNew = !site.id;
  const [f, setF] = useState({
    localite: site.localite || '', activityTag: site.activityTag || '', tagCode: site.tagCode || '',
    fieldOfficeId: site.fieldOfficeId || '', region: site.region || '', district: site.district || '',
    commune: site.commune || '', fokontany: site.fokontany || '',
    lat: site.lat ?? '', lng: site.lng ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save() {
    if (!f.localite.trim()) { setErr(tr('La localité (nom du site) est obligatoire.')); return; }
    setBusy(true); setErr(null);
    const body = {
      localite: f.localite.trim(),
      activityTag: f.activityTag.trim() || undefined, tagCode: f.tagCode.trim() || undefined,
      fieldOfficeId: f.fieldOfficeId || null,
      region: f.region.trim() || undefined, district: f.district.trim() || undefined,
      commune: f.commune.trim() || undefined, fokontany: f.fokontany.trim() || undefined,
      lat: num(f.lat), lng: num(f.lng),
    };
    try {
      if (isNew) await api.createSiteRegistry(body); else await api.updateSiteRegistry(site.id, body);
      toast.success(isNew ? tr('Site créé.') : tr('Site modifié.'));
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={isNew ? tr('Nouveau site') : tr('Modifier le site')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button>
          <Button loading={busy} onClick={save}>{tr('Enregistrer')}</Button>
        </>
      )}>
      <div className="form-grid">
        <Field label={tr('Localité (nom du site)')} required><input value={f.localite} onChange={set('localite')} maxLength={200} /></Field>
        <Field label={tr('Field office')}>
          <select value={f.fieldOfficeId} onChange={set('fieldOfficeId')}>
            <option value="">{tr('— aucun —')}</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ''}</option>)}
          </select>
        </Field>
        <Field label={tr('Activité (tag)')}><input value={f.activityTag} onChange={set('activityTag')} maxLength={160} /></Field>
        <Field label={tr('Code tag')}><input value={f.tagCode} onChange={set('tagCode')} maxLength={60} /></Field>
        <Field label={tr('Latitude')} hint={tr('Degrés décimaux (ex. -23.12)')}><input type="number" step="any" value={f.lat} onChange={set('lat')} /></Field>
        <Field label={tr('Longitude')}><input type="number" step="any" value={f.lng} onChange={set('lng')} /></Field>
        <Field label={tr('Région')}><input value={f.region} onChange={set('region')} maxLength={120} /></Field>
        <Field label={tr('District')}><input value={f.district} onChange={set('district')} maxLength={120} /></Field>
        <Field label={tr('Commune')}><input value={f.commune} onChange={set('commune')} maxLength={120} /></Field>
        <Field label={tr('Fokontany')}><input value={f.fokontany} onChange={set('fokontany')} maxLength={120} /></Field>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        {tr('Le Code POI est attribué automatiquement. Avec des coordonnées GPS, « Attribuer depuis le GPS » remplit la région / district / commune et les codes de zone.')}
      </p>
      {err && <Alert tone="danger">{err}</Alert>}
    </Modal>
  );
}
