import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Upload, Wand2, MapPin, SlidersHorizontal, Clock, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Field, Stats } from '../../components/ui.jsx';
import DataList from '../../components/DataList.jsx';
import Modal from '../../components/Modal.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatInt } from '../../lib/format.js';
import { richText } from '../../lib/contracts.js';
import { useI18n } from '../../lib/i18n.jsx';
// Libellés des critères (échelles du classeur RBM) et formulaire « Éditer les critères » : module pur testé.
import { LABEL01, LABEL02, RBM_CRITERIA, caseloadOf, criteriaForm, criteriaPatch, hasBeneficiaryNumber, securityLabel } from '../../lib/rbmCriteria.js';
import { RbmExplainDrawer, ScoreButton, UrgentButton } from './RbmExplain.jsx';

const RISK = {
  elevee: { label: 'Élevé', color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)', freq: 'tous les mois' },
  moyenne: { label: 'Moyen', color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)', freq: 'tous les 2 mois' },
  faible: { label: 'Faible', color: 'var(--green)', bg: 'var(--green-bg)', text: 'var(--green-text)', freq: 'tous les 3 mois' },
};
// Taille retenue par le score (servie par le serveur, sinon même règle) : nombre de bénéficiaires s'il est saisi.
const caseloadValue = (s) => (s.caseload != null ? s.caseload : caseloadOf(s));
const caseloadText = (s) => `${LABEL01.caseload[caseloadValue(s)]}${hasBeneficiaryNumber(s.beneficiaryNumber) ? ` (${s.beneficiaryNumber})` : ''}`;
const experienceText = (tr) => (s) => { const l = LABEL02.experience[Number(s.experiencedPartner) || 0]; return l ? tr(l) : String(s.experiencedPartner); };

/**
 * Risk-Based Monitoring — le référentiel de sites porte un niveau de risque qui
 * pilote la fréquence de suivi (élevé = tous les mois, moyen = 2 mois, faible =
 * 3 mois). La planification des visites du mois se GÉNÈRE depuis ce RBM : chaque
 * site « à suivre » (jamais visité ou échéance atteinte) devient une visite
 * planifiée. Import du référentiel Master Data pris en charge.
 */
export default function RbmPage({ canEdit, embedded = false }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [risk, setRisk] = useState('');
  const [sites, setSites] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [crit, setCrit] = useState(null); // site en cours d'édition des critères
  const [why, setWhy] = useState(null); // site dont on explique le score / le drapeau
  const [offices, setOffices] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const fileRef = useRef(null);
  const planRef = useRef(null);

  const reload = useCallback(() => {
    setSites(null);
    api.rbmSites(month, risk).then(setSites).catch((e) => setError(e.message));
  }, [month, risk]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { api.listOffices().then(setOffices).catch(() => setOffices([])); }, []);

  // Sous-arbre d'un bureau : lui-même + toutes ses antennes (récursif). Un bureau
  // pays (national) couvre TOUT le pays ; un bureau terrain ne voit que ses sites.
  const officeById = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);
  const descendantsOf = useCallback((officeId) => {
    const set = new Set([officeId]);
    let added = true;
    while (added) {
      added = false;
      for (const o of offices) { if (o.parentId && set.has(o.parentId) && !set.has(o.id)) { set.add(o.id); added = true; } }
    }
    return set;
  }, [offices]);

  const setSiteRisk = async (s, riskLevel) => {
    try { await api.fieldUpdateSite(s.id, { riskLevel }); reload(); }
    catch (e) { toast.error(e.message); }
  };
  // Ne planifie que les sites « à planifier » (à suivre, hors zone interdite, sans visite prévue ce mois) :
  // un deuxième clic ne crée rien.
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.rbmGenerate(month, risk);
      const notes = [
        r.cancelled ? tr('{n} site(s) avec une visite annulée ce mois, laissée telle quelle', { n: r.cancelled }) : null,
        r.inactive ? tr('{n} site(s) inactif(s) ce mois, non planifié(s)', { n: r.inactive }) : null,
      ].filter(Boolean);
      const tail = notes.length ? ` (${notes.join(' · ')})` : '';
      if (r.created > 0) toast.success(tr('{created} visite(s) planifiée(s) sur {due} site(s) à suivre.', { created: r.created, due: r.due }) + tail);
      else if (r.due > 0) toast.info(tr('Aucune nouvelle visite : les {due} site(s) à suivre sont déjà planifiés.', { due: r.due }) + tail);
      else toast.info(tr('Aucun site à suivre ce mois (hors zones interdites).'));
      reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const onImport = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { const r = await api.rbmImport(f); toast.success(tr('{inserted} site(s) ajouté(s) · {total} ligne(s).', { inserted: r.inserted, total: r.total })); reload(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const onImportPlan = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.rbmImportPlan(f);
      toast.success(`${[
        tr('{n} site(s) importé(s) (feuille « {sheet} »)', { n: r.upserted, sheet: r.sheet }),
        r.lastVisits ? tr('{n} dernière(s) visite(s)', { n: r.lastVisits }) : null,
        r.skipped ? tr('{n} ligne(s) sans géographie ignorée(s)', { n: r.skipped }) : null,
      ].filter(Boolean).join(' · ')}.`);
      reload();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const stats = useMemo(() => {
    const s = { total: 0, elevee: 0, moyenne: 0, faible: 0, due: 0, toPlan: 0 };
    for (const x of sites || []) {
      s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1;
      if (x.due && !x.forbidden) s.due += 1; // même définition que « Générer » (rbmMath.planningCounts)
      if (x.toPlan) s.toPlan += 1; // ce que « Générer » planifiera (serveur : rbmMath.needsPlanning)
    }
    return s;
  }, [sites]);

  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort().map((x) => ({ id: x, label: x }));

  // Colonnes fidèles à la feuille « Risk-based site selection » du Plan de suivi
  // (en-têtes réels, non inventés). Le sélecteur de colonnes permet de montrer
  // les colonnes de critères détaillées.
  const columns = useMemo(() => {
    const c = {
      subOffice: { label: tr('Sous-bureau'), sortVal: (s) => s.subOfficeName || '', csv: (s) => s.subOfficeName || '', render: (s) => s.subOfficeName || <span className="cell-empty">—</span> },
      antenne: { label: tr('Antenne'), sortVal: (s) => s.antenneName || '', csv: (s) => s.antenneName || '', render: (s) => s.antenneName || <span className="cell-empty">—</span> },
      name: { label: tr('Nom du site'), sortVal: (s) => s.name, csv: (s) => s.name, render: (s) => <strong>{s.name}</strong> },
      region: { label: tr('Région'), sortVal: (s) => s.adm1 || '', csv: (s) => s.adm1 || '', render: (s) => s.adm1 || '—' },
      district: { label: tr('District'), sortVal: (s) => s.adm2 || s.district || '', csv: (s) => s.adm2 || s.district || '', render: (s) => s.adm2 || s.district || '—' },
      communes: { label: tr('Commune'), sortVal: (s) => s.adm3 || s.commune || '', csv: (s) => s.adm3 || s.commune || '', render: (s) => s.adm3 || s.commune || '—' },
      fokontany: { label: tr('Fokontany'), sortVal: (s) => s.fokontany || '', csv: (s) => s.fokontany || '', render: (s) => s.fokontany || '—' },
      idSite: { label: tr('ID site'), sortVal: (s) => s.code || '', csv: (s) => s.code || '', render: (s) => <span className="mono">{s.code || '—'}</span> },
      gpsLat: { label: tr('GPS Lat.'), num: true, sortVal: (s) => s.gpsLat ?? -999, csv: (s) => s.gpsLat ?? '', render: (s) => (s.gpsLat ?? '—') },
      gpsLng: { label: tr('GPS Long.'), num: true, sortVal: (s) => s.gpsLng ?? -999, csv: (s) => s.gpsLng ?? '', render: (s) => (s.gpsLng ?? '—') },
      activityCategory: { label: tr("Catégorie d'activité"), sortVal: (s) => s.activity || '', csv: (s) => s.activity || '', render: (s) => s.activity || '—' },
      risk: { label: tr('Niveau de risque'), sortVal: (s) => ({ elevee: 3, moyenne: 2, faible: 1 }[s.riskLevel] || 0), csv: (s) => (RISK[s.riskLevel] ? tr(RISK[s.riskLevel].label) : s.riskLevel),
        render: (s) => (canEdit
          ? <select className="select" style={{ minWidth: 110 }} value={s.riskLevel || 'moyenne'} onClick={(e) => e.stopPropagation()} onChange={(e) => setSiteRisk(s, e.target.value)} aria-label={tr('Niveau de risque')}>
              <option value="elevee">{tr('Élevé')}</option><option value="moyenne">{tr('Moyen')}</option><option value="faible">{tr('Faible')}</option></select>
          : <span className="badge" style={{ background: RISK[s.riskLevel]?.bg, color: RISK[s.riskLevel]?.text }}><span className="dot" style={{ background: RISK[s.riskLevel]?.color }} />{RISK[s.riskLevel] ? tr(RISK[s.riskLevel].label) : s.riskLevel}</span>) },
      security: { label: tr('Situation sécuritaire'), sortVal: (s) => s.security || 0,
        csv: (s) => (securityLabel(s.security) ? tr(securityLabel(s.security)) : String(s.security ?? '')),
        render: (s) => (securityLabel(s.security) ? tr(securityLabel(s.security)) : String(s.security ?? '—')) },
      synergies: { label: tr('Synergies de programme'), sortVal: (s) => s.synergies || 0, csv: (s) => tr(LABEL01.synergies[s.synergies || 0]), render: (s) => tr(LABEL01.synergies[s.synergies || 0]) },
      caseload: { label: tr('Taille (caseload)'), sortVal: (s) => caseloadValue(s), csv: caseloadText, render: caseloadText },
      newPartner: { label: tr('Nouveau partenaire'), sortVal: (s) => s.newPartner || 0, csv: (s) => tr(LABEL01.newPartner[s.newPartner || 0]), render: (s) => tr(LABEL01.newPartner[s.newPartner || 0]) },
      experiencedPartner: { label: tr('Expérience du partenaire'), sortVal: (s) => s.experiencedPartner || 0, csv: experienceText(tr), render: experienceText(tr) },
      // Dernière visite RÉELLE (visite réalisée, collecte de données ou registre) ; une visite
      // seulement planifiée n'en est jamais une : elle est montrée à part (« prévue AAAA-MM »).
      lastVisit: { label: tr('Dernière visite'), sortVal: (s) => (s.monthsSinceVisit == null ? 1e9 : s.monthsSinceVisit), csv: (s) => s.lastVisitMonth || '',
        render: (s) => (
          <span className="tabular">
            {s.lastVisitMonth || <span className="muted">{tr('Jamais visité')}</span>}
            {s.monthsSinceVisit != null && s.monthsSinceVisit >= 0 && <div className="site-meta">{tr('il y a {n} mois', { n: s.monthsSinceVisit })}</div>}
            {s.nextPlannedMonth && <div className="site-meta">{tr('prévue {m}', { m: s.nextPlannedMonth })}</div>}
            {!s.nextPlannedMonth && s.latePlannedMonth && <div className="site-meta">{tr('prévue {m} (non réalisée)', { m: s.latePlannedMonth })}</div>}
          </span>
        ) },
      dataVisit: { label: tr('Dernière collecte (données)'), sortVal: (s) => s.dataVisitMonth || '', csv: (s) => s.dataVisitMonth || '',
        render: (s) => (s.dataVisitMonth
          ? <span className="tabular">{s.dataVisitMonth}{s.dataVisitCount ? <div className="site-meta">{s.dataVisitCount > 1 ? tr('{n} soumissions', { n: s.dataVisitCount }) : tr('{n} soumission', { n: s.dataVisitCount })}</div> : null}</span>
          : <span className="muted" title={tr('Aucune soumission réelle rattachée à la commune de ce site (pcode).')}>—</span>) },
      issuesProcess: { label: tr('Problèmes — processus interne'), sortVal: (s) => s.issuesProcess || 0, csv: (s) => tr(LABEL02.issues[s.issuesProcess || 0]), render: (s) => tr(LABEL02.issues[s.issuesProcess || 0]) },
      issuesPartnerReport: { label: tr('Problème rapport partenaire'), sortVal: (s) => s.issuesPartnerReport || 0, csv: (s) => tr(LABEL02.issues[s.issuesPartnerReport || 0]), render: (s) => tr(LABEL02.issues[s.issuesPartnerReport || 0]) },
      issuesCFM: { label: tr('Problème CFM'), sortVal: (s) => s.issuesCFM || 0, csv: (s) => tr(LABEL02.issues[s.issuesCFM || 0]), render: (s) => tr(LABEL02.issues[s.issuesCFM || 0]) },
      fraud: { label: tr('Fraude et corruption'), sortVal: (s) => s.fraud || 0, csv: (s) => tr(LABEL02.fraud[s.fraud || 0]), render: (s) => tr(LABEL02.fraud[s.fraud || 0]) },
      // Badge et drapeau = boutons : « Pourquoi ? / Conséquence / Que faire ? » (retour n° 48).
      finalScore: { label: tr('SCORE FINAL'), sortVal: (s) => s.finalScore || 0, csv: (s) => (s.finalLabel ? tr(s.finalLabel) : ''),
        render: (s) => <div className="rbm-score-cell"><ScoreButton site={s} onOpen={setWhy} />{s.urgentFlags && <UrgentButton site={s} onOpen={setWhy} />}</div> },
      interval: { label: tr('Intervalle requis (CO)'), num: true, sortVal: (s) => s.interval || 0, csv: (s) => s.interval || '', render: (s) => <span className="tabular">{s.interval != null ? tr('{n} mois', { n: s.interval }) : '—'}</span> },
      due: { label: tr('À suivre ce mois'), sortVal: (s) => (s.due ? 1 : 0), csv: (s) => (s.due ? tr('oui') : tr('non')),
        render: (s) => (s.due
          ? <Badge tone="blue" icon={Clock}>{tr('À suivre')}</Badge>
          : <Badge tone="green" icon={CheckCircle2}>{tr('À jour')}</Badge>) },
    };
    return c;
  }, [canEdit, tr]); // eslint-disable-line

  const filters = useMemo(() => ({
    q: { label: tr('Recherche'), type: 'search', placeholder: tr('Site, commune, district…'),
      match: (s, v) => [s.name, s.commune, s.adm3, s.district, s.adm2, s.code].some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) },
    office: { label: tr('Bureau'), type: 'select',
      options: () => [{ id: '', label: tr('Tous les bureaux') }, ...offices.map((o) => ({ id: o.id, label: o.national ? '🏛 ' + tr('{name} (pays — tous les sites)', { name: o.name }) : (o.parentId ? '— ' : '') + o.name }))],
      match: (s, v) => { const o = officeById.get(v); if (!o) return true; if (o.national) return true; return descendantsOf(v).has(s.fieldOfficeId); } },
    region: { label: tr('Région'), type: 'select', options: (rows) => [{ id: '', label: tr('Toutes les régions') }, ...uniq(rows.map((s) => s.adm1))],
      match: (s, v) => s.adm1 === v },
    district: { label: tr('District'), type: 'select',
      options: (rows, vals) => [{ id: '', label: tr('Tous les districts') }, ...uniq(rows.filter((s) => !vals.region || s.adm1 === vals.region).map((s) => s.adm2))],
      match: (s, v) => s.adm2 === v },
    communes: { label: tr('Commune'), type: 'select',
      options: (rows, vals) => [{ id: '', label: tr('Toutes les communes') }, ...uniq(rows.filter((s) => (!vals.region || s.adm1 === vals.region) && (!vals.district || s.adm2 === vals.district)).map((s) => s.adm3))],
      match: (s, v) => s.adm3 === v },
    risk: { label: tr('Niveau de risque'), type: 'select',
      options: [{ id: '', label: tr('Tous') }, { id: 'elevee', label: tr('Élevé') }, { id: 'moyenne', label: tr('Moyen') }, { id: 'faible', label: tr('Faible') }],
      match: (s, v) => s.riskLevel === v },
    due: { label: tr('À suivre'), type: 'select', options: [{ id: '', label: tr('Tous') }, { id: 'due', label: tr('À suivre (non visités / en retard)') }, { id: 'ok', label: tr('À jour') }],
      match: (s, v) => (v === 'due' ? !!s.due : !s.due) },
  }), [offices, officeById, descendantsOf, tr]); // eslint-disable-line

  const DEFAULT_COLS = ['subOffice', 'antenne', 'name', 'district', 'communes', 'risk', 'lastVisit', 'dataVisit', 'finalScore', 'due'];

  return (
    <div className="section-gap">
      <div className="page-header">
        <div>
          {!embedded && <h1 className="page-title">{tr('Risk-Based Monitoring (RBM)')}</h1>}
          <p className="page-desc">{richText(tr('Sélectionnez une ligne (ou <strong>double-clic</strong>) pour éditer ses critères. « Générer » planifie les sites à suivre du mois. La <strong>dernière visite</strong> est une visite <strong>réalisée</strong> ou une <strong>collecte réelle</strong> issue des données uploadées (reliées au site, sinon à sa commune) ; une visite seulement prévue est affichée à part. Cliquez sur un <strong>score</strong> ou un <strong>drapeau</strong> pour voir pourquoi, la conséquence et que faire.'))}</p>
        </div>
        <div className="header-actions">
          <MonthSelect value={month} onChange={setMonth} />
          {canEdit && <>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImport} />
            <input ref={planRef} type="file" accept=".xlsx,.xlsm" hidden onChange={onImportPlan} />
            <Button variant="secondary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>{tr('Master Data')}</Button>
            <Button variant="secondary" icon={Upload} loading={busy} onClick={() => planRef.current?.click()}
              title={tr('Importe la feuille « Risk-based site selection » : critères, SCORE FINAL, GPS, activité, dernière visite.')}>{tr('Plan de suivi')}</Button>
            <Button icon={Wand2} loading={busy} onClick={generate}
              title={tr('Planifie une visite pour chaque site à suivre qui n\'en a pas encore ce mois (hors zones interdites).')}>
              {sites && stats.toPlan ? tr('Générer ({n})', { n: stats.toPlan }) : tr('Générer')}</Button>
          </>}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Stats compact items={[
        { label: tr('Sites référencés'), value: sites ? formatInt(stats.total) : '—', foot: tr('Référentiel du plan') },
        { label: tr('Risque élevé'), value: sites ? formatInt(stats.elevee) : '—', foot: tr(RISK.elevee.freq) },
        { label: tr('Risque moyen'), value: sites ? formatInt(stats.moyenne) : '—', foot: tr(RISK.moyenne.freq) },
        { label: tr('Risque faible'), value: sites ? formatInt(stats.faible) : '—', foot: tr(RISK.faible.freq) },
        { label: tr('À suivre ce mois (hors zones interdites)'), value: sites ? formatInt(stats.due) : '—',
          foot: sites ? tr('dont {n} à planifier', { n: formatInt(stats.toPlan) }) : tr('Selon le RBM') },
      ]} />

      <DataList
        rows={sites} columns={columns} defaultColumns={DEFAULT_COLS}
        filters={filters} defaultFilters={['q', 'office', 'risk', 'due']}
        storageKey="mems.rbm.view.v4" pageSize={15} defaultSort={{ key: 'finalScore', dir: 'desc' }}
        csvName={`rbm_${month}.csv`} emptyIcon={MapPin} emptyTitle={tr('Aucun site référencé')}
        emptyChildren={tr('Importez le référentiel Master Data (.xlsx) pour alimenter le RBM.')}
        selectable selectedId={selectedId} onSelect={setSelectedId}
        onRowDoubleClick={canEdit ? (s) => setCrit(s) : undefined}
        toolbar={canEdit ? (sel) => (sel ? <>
          <Button size="sm" variant="secondary" icon={SlidersHorizontal} onClick={() => setCrit(sel)}>{tr('Éditer les critères')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>{tr('Désélectionner')}</Button>
        </> : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tr('Sélectionnez un site pour éditer ses critères.')}</span>) : undefined}
        rowClassName={(s) => (s.due ? 'row-due' : '')}
      />

      {why && <RbmExplainDrawer site={why} month={month} onClose={() => setWhy(null)}
        onEditCriteria={canEdit ? (s) => { setWhy(null); setCrit(s); } : undefined} />}
      {crit && <CritModal site={crit} onClose={() => setCrit(null)} onSaved={() => { setCrit(null); reload(); }} />}
    </div>
  );
}

/**
 * « Éditer les critères » : chaque raison que « Pourquoi ? » peut afficher se corrige ici
 * (lib/rbmCriteria : RBM_CRITERIA + REASON_FIELDS), y compris le nombre de bénéficiaires
 * — prioritaire sur « ≤ 200 / > 200 », comme dans le score — et l'expérience du partenaire.
 */
function CritModal({ site, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const idBase = useId();
  const [form, setForm] = useState(() => criteriaForm(site));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const numberSet = hasBeneficiaryNumber(form.beneficiaryNumber);

  async function save() {
    const { patch, error: invalid } = criteriaPatch(form);
    if (invalid) { setError(tr(invalid)); return; }
    setSaving(true);
    try { await api.fieldUpdateSite(site.id, patch); toast.success(tr('Critères enregistrés.')); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }
  // Règle de priorité toujours visible (les aides .field-hint sont masquables : ici c'est la règle du score).
  const note = (id, text) => <span id={id} className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{text}</span>;
  const field = (c) => {
    const id = `${idBase}-${c.key}`;
    if (c.kind === 'number') {
      return (
        <Field key={c.key} label={tr(c.label)} htmlFor={id} error={error}>
          <input id={id} className="input tabular" type="number" min="0" step="1" inputMode="numeric" value={form[c.key]}
            placeholder={tr('Non renseigné')} aria-invalid={error ? true : undefined} aria-describedby={`${id}-note`}
            onChange={(e) => { setError(null); setForm({ ...form, [c.key]: e.target.value }); }} />
          {note(`${id}-note`, tr(c.hint))}
        </Field>
      );
    }
    // Le choix ≤ 200 / > 200 ne compte pas quand le nombre de bénéficiaires est saisi : montré déduit, non modifiable.
    const derived = c.key === 'beneficiaryOver200' && numberSet;
    const value = derived ? caseloadOf(form) : form[c.key];
    // Valeur hors échelle (ancienne saisie) : gardée et montrée telle quelle, jamais remplacée en silence.
    const options = c.options.some(([v]) => v === value) ? c.options : [...c.options, [value, String(value)]];
    return (
      <Field key={c.key} label={tr(c.label)} htmlFor={id}>
        <select id={id} className="select" value={value} disabled={derived} aria-describedby={derived ? `${id}-note` : undefined}
          onChange={(e) => setForm({ ...form, [c.key]: Number(e.target.value) })}>
          {options.map(([v, o]) => <option key={v} value={v}>{tr(o)}</option>)}
        </select>
        {derived && note(`${id}-note`, tr('Déduit du nombre de bénéficiaires saisi.'))}
      </Field>
    );
  };
  return (
    <Modal open size="md" title={tr('Critères de risque (RBM)')} subtitle={tr('{site} — alimentent le score et la priorité', { site: site.name })} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button onClick={save} loading={saving}>{tr('Enregistrer')}</Button></>}>
      <div className="form-grid">
        {RBM_CRITERIA.map(field)}
      </div>
    </Modal>
  );
}

