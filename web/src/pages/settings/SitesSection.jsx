import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Search, Trash2, Pencil, MapPin, LocateFixed, Download, Upload, FileSpreadsheet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Registre des sites — page de gestion dédiée (Paramétrage › Sites).
 * Insertion / modification / suppression + attribution automatique de la zone
 * depuis le GPS (centroïde le plus proche). La liaison se fait par l'identité
 * stable du site (UUID / Code POI), jamais par pcode.
 */
const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

export default function SitesSection({ isAdmin }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [offices, setOffices] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // null | {} (nouveau) | ligne
  const [busyGps, setBusyGps] = useState(false);
  const [busyIo, setBusyIo] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setRows(null); setError(null);
    Promise.all([
      api.listSiteRegistry(q ? { q } : undefined),
      api.listOffices().catch(() => []),
    ]).then(([list, offs]) => { setRows(list); setOffices(offs || []); })
      .catch((e) => setError(e.message));
  }, [q]);
  useEffect(() => { const id = setTimeout(load, q ? 250 : 0); return () => clearTimeout(id); }, [load, q]);

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
      <CardHeader title={tr('Registre des sites')} subtitle={rows ? tr('{n} site(s)', { n: rows.length }) : ''}>
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

      {!rows ? <Skeleton height={220} /> : rows.length === 0 ? (
        <EmptyState icon={MapPin} title={tr('Aucun site')} action={<Button icon={Plus} onClick={() => setEdit({})}>{tr('Ajouter un site')}</Button>}>
          {tr('Ajoutez un site, ou importez-les. Avec des coordonnées GPS, « Attribuer depuis le GPS » rattache automatiquement la zone.')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr>
              <th>{tr('Identifiant')}</th><th>{tr('Localité')}</th><th>{tr('Code POI')}</th>
              <th>{tr('Field office')}</th><th>{tr('Code bureau')}</th>
              <th>{tr('Région')}</th><th>Adm1</th><th>{tr('District')}</th><th>Adm2</th>
              <th>{tr('Commune')}</th><th>Adm3</th><th>{tr('Fokontany')}</th><th>Adm4</th>
              <th>{tr('Activité')}</th><th>{tr('Code tag')}</th><th>Lat</th><th>Long</th><th />
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.identifiant}</td>
                  <td>{s.localite}</td>
                  <td className="mono">{s.codePoi || '—'}</td>
                  <td>{s.fieldOffice || '—'}</td>
                  <td className="mono">{s.fieldOfficeCode || '—'}</td>
                  <td>{s.region || '—'}</td><td className="mono muted">{s.adm1Code || '—'}</td>
                  <td>{s.district || '—'}</td><td className="mono muted">{s.adm2Code || '—'}</td>
                  <td>{s.commune || '—'}</td><td className="mono muted">{s.adm3Code || '—'}</td>
                  <td>{s.fokontany || '—'}</td><td className="mono muted">{s.adm4Code || '—'}</td>
                  <td>{s.activityTag || '—'}</td><td className="mono">{s.tagCode || '—'}</td>
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
    </Card>
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
