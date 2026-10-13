import React, { useEffect, useRef, useState } from 'react';
import {
  FileArchive, FileSpreadsheet, Link2, CloudDownload, Upload, CheckCircle2, AlertTriangle, ArrowLeft, Table2, BarChart3,
  RefreshCw, MapPinned, Check,
} from 'lucide-react';
import { api, getSessionSecret, setSessionSecret } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, Field, Skeleton, Stats } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { dayLabel, formatInt, monthLabel } from '../../lib/format.js';

/**
 * Onglet « Importation » d'une fiche de suivi (retour n° 5) : un assistant en
 * étapes au lieu d'une rangée de boutons.
 *   1. Source — la nature de la source, parmi les nôtres : export Kobo SPSS,
 *      Excel / CSV, lien ONA / MoDA, API KoboToolbox ;
 *   2. Fichier ou connexion ;
 *   3. Vérification (fichiers) — ce que contient le fichier AVANT d'écrire quoi
 *      que ce soit : nouvelles soumissions, déjà importées (mises à jour), mois
 *      couverts, colonnes reconnues, points d'attention ;
 *   4. Compte rendu — ce qui a été écrit et rattaché (bureau, commune, site).
 * Le serveur reconnaît toujours le format par le contenu : la source choisie
 * guide l'utilisateur, elle ne contourne aucune vérification.
 */
const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

export const IMPORT_SOURCES = [
  { id: 'spss', icon: FileArchive, label: 'Export Kobo SPSS', formats: '.zip, .sav', accept: '.zip,.sav', recommended: true,
    description: 'L\'export « SPSS » de Kobo garde les libellés des réponses (bureaux, sites, partenaires) : c\'est le plus complet.' },
  { id: 'excel', icon: FileSpreadsheet, label: 'Fichier Excel ou CSV', formats: '.xlsx, .csv', accept: '.xlsx,.csv',
    description: 'Export Excel de Kobo ou ONA, avec ou sans les noms de groupes, ou tableau préparé (une ligne par soumission).' },
  { id: 'link', icon: Link2, label: 'Lien ONA / MoDA', formats: 'https://…',
    description: 'Lien de données ONA, MoDA ou Tableau WDC, ou lien d\'export CSV / XLSX / JSON. Il est mémorisé : un clic suffit ensuite pour actualiser.' },
  { id: 'kobo', icon: CloudDownload, label: 'API KoboToolbox', formats: 'UID + jeton',
    description: 'Récupère directement les soumissions d\'un formulaire Kobo (identifiant du formulaire et jeton API).' },
];

const FIELD_LABELS = [
  ['external_id', 'Identifiant Kobo'], ['submitted_at', 'Date de collecte'], ['field_office', 'Bureau'],
  ['admin1', 'Région'], ['admin2', 'District'], ['admin3', 'Commune'], ['admin4', 'Fokontany'],
  ['site', 'Site'], ['partner', 'Partenaire'], ['agent', 'Agent'],
];
const FORMAT_LABELS = { sav: 'SPSS (.sav)', csv: 'CSV', xlsx: 'Excel (.xlsx)' };
const STEPS = ['Source', 'Fichier ou connexion', 'Vérification', 'Compte rendu'];

const sizeMo = (bytes) => (bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1).replace('.', ',');

/** Erreur du serveur, avec les lignes en cause quand il les donne (dates illisibles). */
function ImportError({ error }) {
  const { tr } = useI18n();
  if (!error) return null;
  const lines = error.details?.invalidDates || [];
  return (
    <Alert tone="error" icon={AlertTriangle}>
      <div>{error.message}</div>
      {lines.length > 0 && (
        <ul className="wiz-errlines">
          {lines.slice(0, 8).map((d, i) => <li key={i}>{tr('ligne {l}, colonne « {c} » : « {v} »', { l: d.line, c: d.column, v: d.value })}</li>)}
        </ul>
      )}
    </Alert>
  );
}

function Stepper({ step, sourceId }) {
  const { tr } = useI18n();
  const steps = sourceId === 'link' || sourceId === 'kobo' ? [STEPS[0], STEPS[1], STEPS[3]] : STEPS;
  const index = sourceId === 'link' || sourceId === 'kobo' ? [0, 1, 3].indexOf(step) : step;
  return (
    <ol className="wiz-steps" aria-label={tr('Étapes de l\'import')}>
      {steps.map((label, i) => (
        <li key={label} className={i < index ? 'is-done' : i === index ? 'is-current' : ''} aria-current={i === index ? 'step' : undefined}>
          <span className="wiz-step-n" aria-hidden="true">{i < index ? <Check size={13} /> : i + 1}</span>{tr(label)}
        </li>
      ))}
    </ol>
  );
}

/** Ce qui a été écrit : nouvelles / mises à jour, rattachements de la fiche, mois couverts. */
function ImportReport({ result, onGoData, onGoResults, onRestart }) {
  const { tr } = useI18n();
  const f = result.form || {};
  const pct = (n) => (f.total ? Math.round((n / f.total) * 100) : 0);
  return (
    <div className="wiz-body">
      <Alert tone="success" icon={CheckCircle2}>
        {tr('Import terminé : {c} nouvelle(s) soumission(s), {u} déjà présente(s) mise(s) à jour.', { c: formatInt(result.created ?? result.inserted ?? 0), u: formatInt(result.updated ?? 0) })}
        {result.truncated && <div>{tr('La source a été lue en partie seulement (limite de pages) : relancez l\'actualisation pour la suite.')}</div>}
        {result.duplicates > 0 && <div>{tr('{n} doublon(s) du fichier comptés une seule fois (dernière version retenue).', { n: formatInt(result.duplicates) })}</div>}
      </Alert>
      {f.total > 0 && (
        <Stats compact items={[
          { label: tr('Soumissions dans la fiche'), value: formatInt(f.total) },
          { label: tr('Bureau reconnu'), value: `${pct(f.withOffice)} %`, foot: formatInt(f.withOffice) },
          { label: tr('Commune reconnue'), value: `${pct(f.withCommune)} %`, foot: formatInt(f.withCommune) },
          { label: tr('Site du registre relié'), value: `${pct(f.withSite)} %`, foot: formatInt(f.withSite) },
        ]} />
      )}
      {f.sitePending > 0 && (
        <Alert tone="info" icon={MapPinned}>
          {tr('{n} soumission(s) déclarent un site à confirmer : rapprochez-les dans Paramétrage › Localités › À rapprocher.', { n: formatInt(f.sitePending) })}{' '}
          <a href="#/parametrage/localites">{tr('Ouvrir')}</a>
        </Alert>
      )}
      {result.months?.length > 0 && (
        <div className="wiz-months">
          <span className="muted">{tr('Mois reçus')} :</span>
          {result.months.map((m) => <Badge key={m.month} tone="blue">{monthLabel(m.month.slice(0, 7))} · {formatInt(m.n)}</Badge>)}
        </div>
      )}
      <div className="wiz-actions">
        <Button icon={Table2} onClick={onGoData}>{tr('Voir les données')}</Button>
        <Button variant="secondary" icon={BarChart3} onClick={onGoResults}>{tr('Voir les résultats')}</Button>
        <Button variant="ghost" icon={RefreshCw} onClick={onRestart}>{tr('Nouvel import')}</Button>
      </div>
    </div>
  );
}

// Jetons saisis pendant la session, par fiche et par lien : gardés en mémoire par api/client
// (jamais dans le stockage du navigateur, oubliés à la déconnexion), pour survivre à un
// changement d'onglet de la fiche.
const tokenKey = (formId, url) => `${formId}|${String(url || '').trim()}`;

export default function ImportWizard({ form, canEdit, onImported, onGoData, onGoResults }) {
  const { tr } = useI18n();
  const fileRef = useRef(null);
  const [step, setStep] = useState(0);
  const [source, setSource] = useState(null);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [link, setLink] = useState({ url: form.sourceUrl || '', token: '', full: false });
  const [kobo, setKobo] = useState({ baseUrl: 'https://kf.kobotoolbox.org', assetUid: '', token: '' });
  // Le jeton n'est jamais mémorisé : une source « API Kobo » le redemande pour être actualisée.
  const [refreshToken, setRefreshToken] = useState('');
  const src = IMPORT_SOURCES.find((x) => x.id === source);
  const rememberedNeedsToken = form.sourceKind === 'kobo-api';
  // Le lien proposé suit la source mémorisée de la fiche (elle change après chaque import par lien).
  useEffect(() => { setLink((l) => ({ ...l, url: form.sourceUrl || '' })); }, [form.sourceUrl]);

  const restart = () => { setStep(0); setSource(null); setFile(null); setPreview(null); setResult(null); setError(null); };
  const choose = (id) => { setSource(id); setStep(1); setError(null); setFile(null); setPreview(null); };

  async function check(f) {
    setError(null);
    if (f.size > MAX_IMPORT_BYTES) { setError({ message: tr('Fichier trop volumineux ({size} Mo) : la taille maximale acceptée est de 80 Mo. Exportez une période plus courte ou découpez le fichier, puis réessayez.', { size: Math.round(f.size / (1024 * 1024)) }) }); return; }
    setFile(f); setBusy(true);
    try { setPreview(await api.monImportPreview(form.id, f)); setStep(2); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function run(action) {
    setBusy(true); setError(null);
    try { const r = await action(); setResult(r); setStep(3); await onImported?.(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  const importFile = () => run(() => api.monImport(form.id, file));
  const importLink = () => {
    if (link.token.trim()) setSessionSecret(tokenKey(form.id, link.url), link.token.trim());
    return run(() => api.linkPull(form.id, { url: link.url.trim(), token: link.token.trim() || undefined, full: link.full || undefined }));
  };
  const importKobo = () => run(() => api.monKoboPull(form.id, { baseUrl: kobo.baseUrl.trim(), assetUid: kobo.assetUid.trim(), token: kobo.token.trim() }));
  // « Actualiser maintenant » relit exactement la source affichée sur la carte.
  // Jeton : celui saisi ici, sinon celui déjà saisi pour ce lien pendant la session (lien protégé).
  const refreshRemembered = () => {
    setSource('link');
    const token = refreshToken.trim() || link.token.trim() || getSessionSecret(tokenKey(form.id, form.sourceUrl)) || '';
    if (token) setSessionSecret(tokenKey(form.id, form.sourceUrl), token);
    run(() => api.linkPull(form.id, { url: form.sourceUrl, token: token || undefined }));
  };

  if (!canEdit) {
    return <Alert tone="info">{tr('Lecture seule : l\'import de données est réservé aux gestionnaires et administrateurs.')}</Alert>;
  }

  const onDrop = (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) check(f); };
  const p = preview;
  const newTotal = p ? p.newCount + p.withoutId : 0;

  return (
    <div className="section-gap">
      {form.sourceUrl && step === 0 && (
        <Card>
          <div className="card-body wiz-remembered">
            <Link2 size={16} aria-hidden="true" />
            <div>
              <strong>{tr('Source mémorisée')}</strong>
              <div className="site-meta mono" title={form.sourceUrl}>{form.sourceUrl}</div>
            </div>
            <input className="input mono wiz-token" type="password" autoComplete="off" value={refreshToken}
              placeholder={rememberedNeedsToken ? tr('Jeton API') : tr('Jeton (facultatif)')}
              aria-label={rememberedNeedsToken ? tr('Jeton API') : tr('Jeton (facultatif)')} onChange={(e) => setRefreshToken(e.target.value)} />
            <Button variant="secondary" icon={RefreshCw} loading={busy} disabled={rememberedNeedsToken && !refreshToken.trim()}
              title={rememberedNeedsToken && !refreshToken.trim() ? tr('Saisissez le jeton API Kobo pour actualiser cette source.') : undefined}
              onClick={refreshRemembered}>{tr('Actualiser maintenant')}</Button>
          </div>
        </Card>
      )}
      <Card aria-labelledby="wiz-title">
        <CardHeader id="wiz-title" title={tr('Importer des soumissions')}
          subtitle={tr('{n} soumission(s) dans cette fiche. Réimporter les mêmes données ne crée pas de doublon : une soumission déjà reçue est mise à jour.', { n: formatInt(form.submissionCount ?? 0) })} />
        <div className="card-body">
          <Stepper step={step} sourceId={source} />
          <ImportError error={error} />

          {step === 0 && (
            <div className="wiz-sources" role="radiogroup" aria-label={tr('Nature de la source')}>
              {IMPORT_SOURCES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={source === s.id} className="wiz-source" onClick={() => choose(s.id)}>
                  <s.icon size={22} aria-hidden="true" />
                  <span className="wiz-source-title">{tr(s.label)}{s.recommended && <Badge tone="green">{tr('recommandé')}</Badge>}</span>
                  <span className="wiz-source-desc">{tr(s.description)}</span>
                  <span className="wiz-source-fmt mono">{s.formats}</span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (source === 'spss' || source === 'excel') && (
            <div className="wiz-body">
              <div className={`wiz-drop${drag ? ' is-drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)} onDrop={onDrop}>
                {busy ? <><Skeleton height={18} width={220} /><span className="muted">{tr('Lecture du fichier…')}</span></> : (
                  <>
                    <Upload size={26} aria-hidden="true" />
                    <span>{tr('Glissez le fichier ici, ou')} <button type="button" className="inline-link" onClick={() => fileRef.current?.click()}>{tr('choisissez-le')}</button></span>
                    <span className="muted">{tr('Formats : {f} · 80 Mo au plus', { f: src.formats })}</span>
                  </>
                )}
                <input ref={fileRef} type="file" accept={`${src.accept},.csv,.xlsx,.sav,.zip`} hidden
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) check(f); }} />
              </div>
              <div className="wiz-actions"><Button variant="ghost" icon={ArrowLeft} onClick={restart}>{tr('Changer de source')}</Button></div>
            </div>
          )}

          {step === 1 && source === 'link' && (
            <div className="wiz-body">
              <Field label={tr('Lien de données')} hint={tr('Lien ONA / MoDA (open data ou Tableau WDC), lien API Kobo v2, ou lien d\'export CSV / XLSX / JSON. Seules les nouveautés sont lues aux actualisations suivantes.')}>
                <input className="input mono" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://api.ona.io/api/v1/data/123456" />
              </Field>
              <div className="form-grid">
                <Field label={tr('Jeton (facultatif)')} hint={tr('Seulement si le lien est protégé.')}>
                  <input className="input mono" type="password" autoComplete="off" value={link.token} onChange={(e) => setLink({ ...link, token: e.target.value })} />
                </Field>
                <label className="check wiz-full"><input type="checkbox" checked={link.full} onChange={(e) => setLink({ ...link, full: e.target.checked })} /> {tr('Tout relire (au lieu des seules nouveautés)')}</label>
              </div>
              <div className="wiz-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={restart}>{tr('Changer de source')}</Button>
                <Button icon={CloudDownload} loading={busy} disabled={!/^https?:\/\//i.test(link.url.trim())} onClick={importLink}>{tr('Importer depuis le lien')}</Button>
              </div>
            </div>
          )}

          {step === 1 && source === 'kobo' && (
            <div className="wiz-body">
              <div className="form-grid">
                <Field label={tr('Adresse du serveur Kobo')}><input className="input" value={kobo.baseUrl} onChange={(e) => setKobo({ ...kobo, baseUrl: e.target.value })} /></Field>
                <Field label={tr('Identifiant du formulaire (UID)')} hint={tr('Dans Kobo : Formulaire › Paramètres, ou dans l\'adresse de la page (/forms/aXXXX…).')}>
                  <input className="input mono" value={kobo.assetUid} onChange={(e) => setKobo({ ...kobo, assetUid: e.target.value })} placeholder="aXXXXXXXXXXXXXXXX" />
                </Field>
                <Field label={tr('Jeton API')} hint={tr('Dans Kobo : Paramètres du compte › Sécurité › Clé API.')}>
                  <input className="input mono" type="password" autoComplete="off" value={kobo.token} onChange={(e) => setKobo({ ...kobo, token: e.target.value })} />
                </Field>
              </div>
              <div className="wiz-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={restart}>{tr('Changer de source')}</Button>
                <Button icon={CloudDownload} loading={busy} disabled={!kobo.assetUid.trim() || !kobo.token.trim()} onClick={importKobo}>{tr('Récupérer les soumissions')}</Button>
              </div>
            </div>
          )}

          {step === 2 && p && (
            <div className="wiz-body">
              <div className="wiz-file">
                <FileSpreadsheet size={18} aria-hidden="true" />
                <strong>{file?.name}</strong>
                <span className="muted">{sizeMo(file?.size || 0)} Mo · {tr('format reconnu : {f}', { f: tr(FORMAT_LABELS[p.source] || p.source) })} · {tr('{n} colonne(s)', { n: formatInt(p.fields) })}</span>
              </div>
              <Stats compact items={[
                { label: tr('Soumissions dans le fichier'), value: formatInt(p.count) },
                { label: tr('Nouvelles'), value: formatInt(newTotal) },
                { label: tr('Déjà importées (mises à jour)'), value: formatInt(p.alreadyImported) },
                { label: tr('Période'), value: p.from ? `${dayLabel(p.from)} → ${dayLabel(p.to)}` : '—' },
              ]} />
              {p.months.length > 0 && (
                <div className="wiz-months">
                  <span className="muted">{tr('Mois couverts')} :</span>
                  {p.months.map((m) => <Badge key={m.month} tone="blue">{monthLabel(m.month.slice(0, 7))} · {formatInt(m.n)}</Badge>)}
                </div>
              )}
              <div className="wiz-checks">
                {p.duplicatesInFile > 0 && <Alert tone="info">{tr('{n} soumission(s) en double dans le fichier : elles ne compteront qu\'une fois.', { n: formatInt(p.duplicatesInFile) })}</Alert>}
                {p.withoutId > 0 && <Alert tone="warn" icon={AlertTriangle}>{tr('{n} ligne(s) sans identifiant Kobo (_uuid) : si vous réimportez ce fichier, elles seront ajoutées une seconde fois.', { n: formatInt(p.withoutId) })}</Alert>}
                {p.withoutDate > 0 && <Alert tone="warn" icon={AlertTriangle}>{tr('{n} soumission(s) sans date de collecte : elles ne figureront dans aucun mois.', { n: formatInt(p.withoutDate) })}</Alert>}
                {!p.recognized.field_office && <Alert tone="info">{tr('Aucune colonne de bureau reconnue : après l\'import, choisissez-la dans l\'onglet « Mapping MEMS ».')}</Alert>}
              </div>
              <details className="wiz-cols">
                <summary>{tr('Colonnes reconnues pour MEMS ({n} sur {t})', { n: FIELD_LABELS.filter(([k]) => p.recognized[k]).length, t: FIELD_LABELS.length })}</summary>
                <table className="table">
                  <thead><tr><th scope="col">{tr('Information MEMS')}</th><th scope="col">{tr('Colonne du fichier')}</th></tr></thead>
                  <tbody>{FIELD_LABELS.map(([k, label]) => (
                    <tr key={k}><td>{tr(label)}</td><td>{p.recognized[k] ? <span className="mono">{p.recognized[k]}</span> : <span className="muted">{tr('non trouvée')}</span>}</td></tr>
                  ))}</tbody>
                </table>
              </details>
              <div className="wiz-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => { setStep(1); setPreview(null); setFile(null); }}>{tr('Choisir un autre fichier')}</Button>
                <Button icon={Upload} loading={busy} onClick={importFile}>
                  {tr(newTotal ? 'Importer {n} soumission(s)' : 'Mettre à jour {n} soumission(s)', { n: formatInt(p.count - p.duplicatesInFile) })}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <ImportReport result={result} onGoData={onGoData} onGoResults={onGoResults} onRestart={restart} />
          )}
        </div>
      </Card>
    </div>
  );
}
