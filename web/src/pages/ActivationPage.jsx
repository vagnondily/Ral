import React, { useState } from 'react';
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import { Alert, Button, Field } from '../components/ui.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Activation d'un compte : la personne définit son mot de passe via le lien
 * (jeton) que l'administrateur lui a communiqué. Écran public (pré-connexion).
 */
export default function ActivationPage({ token, onBack }) {
  const { tr } = useI18n();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) { setError(tr('Les deux mots de passe ne correspondent pas.')); return; }
    if (form.password.length < 10) { setError(tr('Mot de passe : au moins 10 caractères.')); return; }
    setLoading(true);
    try {
      await api.activate({ token, password: form.password });
      setDone(true);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <div className="login">
      <main className="login-card">
        <div className="login-head">
          <LogoMark size={52} />
          <div className="login-brand-name">MEMS 2.0</div>
          <p className="login-tagline">{tr('Activation du compte')}</p>
        </div>

        {done ? (
          <div className="login-form">
            <Alert tone="success" icon={CheckCircle2}>{tr('Mot de passe défini. Vous pouvez maintenant vous connecter.')}</Alert>
            <Button block onClick={onBack}>{tr('Aller à la connexion')}</Button>
          </div>
        ) : !token ? (
          <div className="login-form">
            <Alert tone="error" icon={AlertCircle}>{tr("Lien d'activation incomplet. Utilisez le lien exact communiqué par votre administrateur.")}</Alert>
            <Button block variant="secondary" onClick={onBack}>{tr('Retour à la connexion')}</Button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-form-head">
              <h2>{tr('Définir mon mot de passe')}</h2>
              <p className="lead">{tr('Choisissez un mot de passe pour activer votre compte.')}</p>
            </div>
            {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}
            <Field label={tr('Mot de passe')} htmlFor="ac-pass" hint={tr('Au moins 10 caractères.')}>
              <div className="input-wrap">
                <Lock size={18} aria-hidden="true" />
                <input id="ac-pass" className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </div>
            </Field>
            <Field label={tr('Confirmer le mot de passe')} htmlFor="ac-confirm">
              <div className="input-wrap">
                <Lock size={18} aria-hidden="true" />
                <input id="ac-confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
              </div>
            </Field>
            <Button type="submit" block loading={loading} disabled={!form.password || !form.confirm}>
              {loading ? tr('Activation…') : tr('Activer mon compte')}
            </Button>
            <p className="demo-hint"><button type="button" className="inline-link" onClick={onBack}>{tr('← Retour à la connexion')}</button></p>
          </form>
        )}
      </main>
    </div>
  );
}
