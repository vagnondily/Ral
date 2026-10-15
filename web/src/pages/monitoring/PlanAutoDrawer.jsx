import React, { useMemo, useState } from 'react';
import { Eye, Wand2 } from 'lucide-react';
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

/**
 * Assistant de génération automatique du plan de suivi sur une PÉRIODE selon des
 * critères configurables (retour 82). Deux temps : « Aperçu » (aucune écriture,
 * montre combien de visites et la couverture) puis « Appliquer » (écrit les
 * visites planifiées, idempotent). Le calcul fait foi côté serveur.
 */
export default function PlanAutoDrawer({ onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [from, setFrom] = useState(() => monthFromNow(1));
  const [to, setTo] = useState(() => monthFromNow(6));
  const [freq, setFreq] = useState({ elevee: 1, moyenne: 2, faible: 3 });
  const [capacity, setCapacity] = useState('');
  const [risk, setRisk] = useState('');
  const [exclude, setExclude] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const invalid = !from || !to || from > to;

  const payload = useMemo(() => ({
    from, to,
    ...(risk ? { risk } : {}),
    settings: {
      frequency: {
        elevee: Number(freq.elevee) || 1,
        moyenne: Number(freq.moyenne) || 2,
        faible: Number(freq.faible) || 3,
      },
      ...(Number(capacity) > 0 ? { capacityPerMonth: Number(capacity) } : {}),
      excludeMonths: exclude.split(',').map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}$/.test(s)),
    },
  }), [from, to, risk, freq, capacity, exclude]);

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

  const maxCount = preview ? Math.max(1, ...preview.perMonth.map((m) => m.count)) : 1;

  return (
    <Modal open onClose={() => !busy && onClose()} title={tr('Générer le plan de suivi (période)')} wide
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button>
        <Button variant="secondary" icon={Eye} loading={busy && !preview} disabled={invalid} onClick={runPreview}>{tr('Aperçu')}</Button>
        <Button icon={Wand2} loading={busy} disabled={invalid || !preview} onClick={apply}>{tr('Appliquer')}</Button>
      </>}>
      <div style={{ display: 'grid', gap: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {tr('Répartit les visites à planifier sur les mois de la période selon le risque et la capacité. Les zones interdites sont exclues ; un mois déjà visité, inactif ou exclu est sauté. Rien n\'est écrit avant « Appliquer ».')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={tr('Du mois')} htmlFor="pa-from"><input id="pa-from" type="month" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={tr('Au mois')} htmlFor="pa-to" error={invalid ? tr('Période invalide.') : undefined}><input id="pa-to" type="month" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}>
          <legend style={{ padding: '0 6px', fontSize: 13, fontWeight: 600 }}>{tr('Fréquence (mois entre deux visites)')}</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label={tr('Risque élevé')} htmlFor="pa-fe"><input id="pa-fe" type="number" min="1" max="12" className="input" value={freq.elevee} onChange={(e) => setFreq({ ...freq, elevee: e.target.value })} /></Field>
            <Field label={tr('Risque moyen')} htmlFor="pa-fm"><input id="pa-fm" type="number" min="1" max="12" className="input" value={freq.moyenne} onChange={(e) => setFreq({ ...freq, moyenne: e.target.value })} /></Field>
            <Field label={tr('Risque faible')} htmlFor="pa-ff"><input id="pa-ff" type="number" min="1" max="12" className="input" value={freq.faible} onChange={(e) => setFreq({ ...freq, faible: e.target.value })} /></Field>
          </div>
        </fieldset>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={tr('Capacité par mois (facultatif)')} htmlFor="pa-cap" hint={tr('Nombre maximum de visites planifiées par mois ; le surplus glisse au mois suivant.')}>
            <input id="pa-cap" type="number" min="1" className="input" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder={tr('Illimité')} />
          </Field>
          <Field label={tr('Niveau de risque (facultatif)')} htmlFor="pa-risk" hint={tr('Limiter la génération à un niveau de risque.')}>
            <select id="pa-risk" className="select" value={risk} onChange={(e) => setRisk(e.target.value)}>
              <option value="">{tr('Tous')}</option>
              <option value="elevee">{tr('Risque élevé')}</option>
              <option value="moyenne">{tr('Risque moyen')}</option>
              <option value="faible">{tr('Risque faible')}</option>
            </select>
          </Field>
        </div>
        <Field label={tr('Mois à exclure (facultatif)')} htmlFor="pa-excl" hint={tr('Mois AAAA-MM séparés par des virgules (ex. saison des pluies).')}>
          <input id="pa-excl" className="input" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="2026-01, 2026-02" />
        </Field>

        {preview && (
          <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <strong style={{ fontSize: 13 }}>{tr('Aperçu')}</strong>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
              <span>{tr('Visites planifiées')} : <strong>{formatInt(preview.summary.planned)}</strong></span>
              <span>{tr('Sites couverts')} : <strong>{formatInt(preview.summary.sitesCovered)}</strong> / {formatInt(preview.summary.sitesActivePlannable)}{preview.summary.coverageRate != null ? ` (${preview.summary.coverageRate} %)` : ''}</span>
              {preview.summary.forbidden > 0 && <span className="muted">{tr('Zones interdites exclues')} : {formatInt(preview.summary.forbidden)}</span>}
              {preview.summary.unplaced > 0 && <span className="muted">{tr('Non placées (capacité)')} : {formatInt(preview.summary.unplaced)}</span>}
            </div>
            <table className="table" style={{ background: 'var(--surface)' }}>
              <thead><tr><th scope="col">{tr('Mois')}</th><th scope="col" className="num">{tr('Visites')}</th><th scope="col" style={{ width: '50%' }} /></tr></thead>
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
        )}
        {!preview && <Alert tone="info">{tr('Cliquez sur « Aperçu » pour voir la répartition avant d\'écrire.')}</Alert>}
      </div>
    </Modal>
  );
}
