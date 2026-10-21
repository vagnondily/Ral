import React, { useEffect, useState } from 'react';
import { Mail, Lock, User, Building2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import { Alert, Button, Field } from '../components/ui.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Auto-inscription. Crée un compte EN ATTENTE : l'utilisateur ne voit rien tant
 * qu'un administrateur ne l'a pas validé et ne lui a pas attribué un rôle.
 * Aucun e-mail n'est envoyé (pas de service configuré) : la validation par
 * l'administrateur est le garde-fou contre les robots.
 */
export default function SignupPage({ onBack }) {
  const { tr } = useI18n();
  const [tenants, setTenants] = useState(null);
  const [form, setForm] = useState({ tenantId: '', email: '', fullName: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listAuthTenants()
      .then((t) => { setTenants(t); setForm((f) => ({ ...f, tenantId: t.length === 1 ? t[0].id : '' })); })
      .catch(() => setTenants([]));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) { setError(tr('Les deux mots de passe ne correspondent pas.')); return; }
    if (form.password.length < 10) { setError(tr('Mot de passe : au moins 10 caractères.')); return; }
    setLoading(true);
    try {
      await api.register({ tenantId: form.tenantId, email: form.email.trim(), fullName: form.fullName.trim(), password: form.password });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  if (done) {
    return (
      <div className="login">
        <main className="login-card">
          <div className="login-head"><LogoMark size={52} /><div className="login-brand-name">MEMS 2.0</div></div>
          <div className="login-form">
            <Alert tone="success" icon={CheckCircle2}>
              {tr('Demande enregistrée. Un administrateur doit valider votre compte et vous attribuer un rôle avant votre première connexion.')}
            </Alert>
            <Button block variant="secondary" onClick={onBack}>{tr('Retour à la connexion')}</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="login">
      <main className="login-card">
        <div className="login-head">
          <LogoMark size={52} />
          <div className="login-brand-name">MEMS 2.0</div>
          <p className="login-tagline">{tr('Plateforme de suivi & évaluation')}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-form-head">
            <h2>{tr('Créer un compte')}</h2>
            <p className="lead">{tr('Votre compte sera activé après validation par un administrateur.')}</p>
          </div>

          {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

          <Field label={tr('Organisation')} htmlFor="su-tenant">
            <div className="input-wrap">
              <Building2 size={18} aria-hidden="true" />
              <select id="su-tenant" className="select" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} required>
                <option value="">{tenants === null ? tr('Chargement…') : tr('— Choisir —')}</option>
                {(tenants || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </Field>

          <Field label={tr('Nom complet')} htmlFor="su-name">
            <div className="input-wrap">
              <User size={18} aria-hidden="true" />
              <input id="su-name" className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required placeholder={tr('Prénom Nom')} />
            </div>
          </Field>

          <Field label={tr('Adresse email')} htmlFor="su-email">
            <div className="input-wrap">
              <Mail size={18} aria-hidden="true" />
              <input id="su-email" className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder={tr('prenom.nom@exemple.mg')} />
            </div>
          </Field>

          <Field label={tr('Mot de passe')} htmlFor="su-pass" hint={tr('Au moins 10 caractères.')}>
            <div className="input-wrap">
              <Lock size={18} aria-hidden="true" />
              <input id="su-pass" className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </div>
          </Field>

          <Field label={tr('Confirmer le mot de passe')} htmlFor="su-confirm">
            <div className="input-wrap">
              <Lock size={18} aria-hidden="true" />
              <input id="su-confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
            </div>
          </Field>

          <Button type="submit" block loading={loading} disabled={!form.tenantId || !form.email || !form.fullName || !form.password}>
            {loading ? tr('Envoi…') : tr('Créer mon compte')}
          </Button>

          <p className="demo-hint">
            <button type="button" className="inline-link" onClick={onBack}>{tr('← Retour à la connexion')}</button>
          </p>
        </form>
      </main>
    </div>
  );
}
