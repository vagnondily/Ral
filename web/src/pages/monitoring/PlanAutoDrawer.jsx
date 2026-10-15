import React, { useMemo, useState } from 'react';
import { Eye, Wand2, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';

// Mois AAAA-MM décalé de n mois à partir d'aujourd'hui.
function monthFromNow(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
const decemberOf = (ym) => `${ym.slice(0, 4)}-12`;

/**
 * Assistant de génération automatique du plan de suivi sur une PÉRIODE (retour 82).
 * Les visites EXIGÉES viennent du MMR (bureau × activité) et la priorité du RBM ;
 * la « fréquence par risque » ne sert qu'aux sites SANS paramètre MMR. Deux temps :
 * « Aperçu » (aucune écriture) puis « Appliquer ». Le calcul fait foi côté serveur.
 */
export default function PlanAutoDrawer({ onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [from, setFrom] = useState(() => monthFromNow(1));
  const [to, setTo] = useState(() => decemberOf(monthFromNow(1))); // par défaut : jusqu'à décembre (même exercice)
  const [freq, setFreq] = useState({ elevee: 1, moyenne: 2, faible: 3 });
  const [capacity, setCapacity] = useState('');
  const [useMmrCapacity, setUseMmrCapacity] = useState(true);
  const [adjusted, setAdjusted] = useState(false);
  const [risk, setRisk] = useState('');
  const [exclude, setExclude] = useState('');
  const [overflow, setOverflow] = useState(10);        // débordement autorisé (%)
  const [groupByCommune, setGroupByCommune] = useState(true);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const invalid = !from || !to || from > to || !sameYear;

  const payload = useMemo(() => ({
    from, to, adjusted,
    ...(risk ? { risk } : {}),
    settings: {
      frequency: { elevee: Number(freq.elevee) || 1, moyenne: Number(freq.moyenne) || 2, faible: Number(freq.faible) || 3 },
      ...(Number(capacity) > 0 ? { capacityPerMonth: Number(capacity) } : {}),
      useMmrCapacity,
      overflowPct: Number(overflow) || 0,
      groupByCommune,
      excludeMonths: exclude.split(',').map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}$/.test(s)),
    },
  }), [from, to, risk, freq, capacity, useMmrCapacity, overflow, groupByCommune, adjusted, exclude]);

  async function runPreview() {
    if (invalid) return;
    setBusy(true);
    try { setPreview(await api.planAutoPreview(payload)); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function apply() {
    if (invalid) return;
    setBusy(true);
    try {
      const r = await api.planAutoApply(payload);
      toast.success(tr('{n} visite(s) planifiée(s).', { n: r.created }));
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function clearPlanned() {
    if (invalid) return;
    if (!window.confirm(tr('Effacer toutes les visites PLANIFIÉES de la période ? Les visites réalisées, annulées ou figées sont conservées.'))) return;
    setBusy(true);
    try {
      const r = await api.planAutoClear({ from, to, ...(risk ? { risk } : {}) });
      toast.success(tr('{n} planification(s) effacée(s).', { n: r.deleted }));
      setPreview(null);
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  const maxCount = preview ? Math.max(1, ...preview.perMonth.map((m) => m.count)) : 1;
  const cov = preview ? (preview.summary.coverageRate ?? 0) : 0;

  return (
    <Modal open onClose={() => !busy && onClose()} title={tr('Générer le plan de suivi (période)')} wide
      footer={<>
        <Button variant="ghost" icon={Trash2} onClick={clearPlanned} disabled={busy || invalid} title={tr('Supprimer les visites planifiées de la période pour repartir d\'un plan propre.')}>{tr('Effacer les planifications')}</Button>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button>
        <Button variant="secondary" icon={Eye} loading={busy && !preview} disabled={invalid} onClick={runPreview}>{tr('Aperçu')}</Button>
        <Button icon={Wand2} loading={busy} disabled={invalid || !preview} onClick={apply}>{tr('Appliquer')}</Button>
      </>}>
      <div style={{ display: 'grid', gap: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {tr('Les visites exigées viennent du MMR (bureau × activité) et la priorité du RBM ; la « fréquence par risque » ci-dessous ne sert qu\'aux sites sans paramètre MMR. Zones interdites exclues ; mois déjà visité, inactif ou exclu sauté. Rien n\'est écrit avant « Appliquer ».')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={tr('Du mois')} htmlFor="pa-from"><input id="pa-from" type="month" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} /></Field>
          <Field label={tr('Au mois')} htmlFor="pa-to" error={from > to ? tr('Période invalide.') : (!sameYear ? tr('La période doit tenir dans un seul exercice (même année).') : undefined)}>
            <input id="pa-to" type="month" className="input" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={tr('Niveau de risque (facultatif)')} htmlFor="pa-risk" hint={tr('Limiter la génération à un niveau de risque.')}>
            <select id="pa-risk" className="select" value={risk} onChange={(e) => { setRisk(e.target.value); setPreview(null); }}>
              <option value="">{tr('Tous')}</option>
              <option value="elevee">{tr('Risque élevé')}</option>
              <option value="moyenne">{tr('Risque moyen')}</option>
              <option value="faible">{tr('Risque faible')}</option>
            </select>
          </Field>
          <Field label={tr('Mois à exclure (facultatif)')} htmlFor="pa-excl" hint={tr('Mois AAAA-MM séparés par des virgules (ex. saison des pluies).')}>
            <input id="pa-excl" className="input" value={exclude} onChange={(e) => { setExclude(e.target.value); setPreview(null); }} placeholder="2026-01, 2026-02" />
          </Field>
        </div>
        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}>
          <legend style={{ padding: '0 6px', fontSize: 13, fontWeight: 600 }}>{tr('Capacité')}</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="check"><input type="checkbox" checked={useMmrCapacity} onChange={(e) => { setUseMmrCapacity(e.target.checked); setPreview(null); }} /> {tr('Respecter la capacité mensuelle du MMR')}</label>
            <label className="check"><input type="checkbox" checked={adjusted} onChange={(e) => { setAdjusted(e.target.checked); setPreview(null); }} /> {tr('Fréquence MMR ajustée (CO adjusted)')}</label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label={tr('Capacité par mois (facultatif)')} htmlFor="pa-cap" hint={tr('Plafond global de visites planifiées par mois ; le surplus glisse au mois suivant.')}>
              <input id="pa-cap" type="number" min="1" className="input" value={capacity} onChange={(e) => { setCapacity(e.target.value); setPreview(null); }} placeholder={tr('Illimité')} />
            </Field>
            <Field label={tr('Débordement autorisé (%)')} htmlFor="pa-ov" hint={tr('Dépassement toléré de la capacité mensuelle avant de reporter au mois suivant.')}>
              <input id="pa-ov" type="number" min="0" max="100" className="input" value={overflow} onChange={(e) => { setOverflow(e.target.value); setPreview(null); }} />
            </Field>
          </div>
          <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={groupByCommune} onChange={(e) => { setGroupByCommune(e.target.checked); setPreview(null); }} /> {tr('Regrouper les sites par commune (tournées)')}</label>
        </fieldset>
        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}>
          <legend style={{ padding: '0 6px', fontSize: 13, fontWeight: 600 }}>{tr('Fréquence des sites sans paramètre MMR (mois entre deux visites)')}</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label={tr('Risque élevé')} htmlFor="pa-fe"><input id="pa-fe" type="number" min="1" max="12" className="input" value={freq.elevee} onChange={(e) => { setFreq({ ...freq, elevee: e.target.value }); setPreview(null); }} /></Field>
            <Field label={tr('Risque moyen')} htmlFor="pa-fm"><input id="pa-fm" type="number" min="1" max="12" className="input" value={freq.moyenne} onChange={(e) => { setFreq({ ...freq, moyenne: e.target.value }); setPreview(null); }} /></Field>
            <Field label={tr('Risque faible')} htmlFor="pa-ff"><input id="pa-ff" type="number" min="1" max="12" className="input" value={freq.faible} onChange={(e) => { setFreq({ ...freq, faible: e.target.value }); setPreview(null); }} /></Field>
          </div>
        </fieldset>

        {preview ? (
          <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <strong style={{ fontSize: 13 }}>{tr('Aperçu')}</strong>
            {/* Barre de progression : couverture des sites. */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span className="muted">{tr('Couverture des sites')}</span>
                <span><strong>{formatInt(preview.summary.sitesCovered)}</strong> / {formatInt(preview.summary.sitesActivePlannable)}{preview.summary.coverageRate != null ? ` · ${preview.summary.coverageRate} %` : ''}</span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, cov)}%`, background: cov >= 80 ? 'var(--green-500, #2e9e5b)' : cov >= 50 ? 'var(--amber-500, #d99100)' : 'var(--red-500, #d64545)', transition: 'width .3s' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
              <span>{tr('Visites planifiées')} : <strong>{formatInt(preview.summary.planned)}</strong></span>
              <span className="muted">{tr('Pilotées par le MMR')} : {formatInt(preview.summary.mmrDriven)}</span>
              <span className="muted">{tr('Repli RBM (sans MMR)')} : {formatInt(preview.summary.rbmFallback)}</span>
              {preview.summary.latePlanned > 0 && <span className="muted">{tr('Prévues antérieures re-planifiées')} : {formatInt(preview.summary.latePlanned)}</span>}
              {preview.summary.forbidden > 0 && <span className="muted">{tr('Zones interdites exclues')} : {formatInt(preview.summary.forbidden)}</span>}
              {preview.summary.unplaced > 0 && <span className="muted">{tr('Non placées (capacité)')} : {formatInt(preview.summary.unplaced)}</span>}
            </div>
            <table className="table" style={{ background: 'var(--surface)' }}>
              <thead><tr><th scope="col">{tr('Mois')}</th><th scope="col" className="num">{tr('Visites')}</th><th scope="col" style={{ width: '55%' }} /></tr></thead>
              <tbody>
                {preview.perMonth.map((m) => (
                  <tr key={m.month}>
                    <td className="mono">{m.month}</td>
                    <td className="num">{formatInt(m.count)}</td>
                    <td><span style={{ display: 'inline-block', height: 8, borderRadius: 4, background: 'var(--blue-500, #0f6cbd)', width: `${Math.round((m.count / maxCount) * 100)}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>{tr('« Appliquer » crée ces visites comme « planifiées ». Idempotent : un site déjà prévu ce mois n\'est pas dupliqué.')}</p>
          </div>
        ) : <Alert tone="info">{tr('Cliquez sur « Aperçu » pour voir la répartition avant d\'écrire.')}</Alert>}
      </div>
    </Modal>
  );
}
