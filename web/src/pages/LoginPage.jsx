import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { api } from '../api/client.js';
import { Alert, Button, Field } from '../components/ui.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { useI18n } from '../lib/i18n.jsx';

const DEMO_EMAIL = 'admin@mems.mg';

export default function LoginPage({ onLoggedIn }) {
  const { tr } = useI18n();
  // Demo credentials are only suggested in development builds.
  const [email, setEmail] = useState(import.meta.env.DEV ? DEMO_EMAIL : '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.login(email.trim(), password);
      onLoggedIn(token, user);
    } catch (err) {
      setError(err.status === 401 ? tr('Email ou mot de passe incorrect.') : err.message);
      setLoading(false);
    }
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
            <h2>{tr('Connexion')}</h2>
            <p className="lead">{tr('Accédez à votre espace de travail.')}</p>
          </div>

          {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

          <Field label={tr('Adresse email')} htmlFor="login-email">
            <div className="input-wrap">
              <Mail size={18} aria-hidden="true" />
              <input
                id="login-email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-invalid={Boolean(error) || undefined}
                placeholder={tr('prenom.nom@exemple.mg')}
              />
            </div>
          </Field>

          <Field label={tr('Mot de passe')} htmlFor="login-password">
            <div className="input-wrap">
              <Lock size={18} aria-hidden="true" />
              <input
                id="login-password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                aria-invalid={Boolean(error) || undefined}
                style={{ paddingRight: 48 }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm input-action"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? tr('Masquer le mot de passe') : tr('Afficher le mot de passe')}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </Field>

          <Button type="submit" block loading={loading} disabled={!email || !password}>
            {loading ? tr('Connexion…') : tr('Se connecter')}
          </Button>

          {import.meta.env.DEV && (
            <p className="demo-hint">
              {tr('Démo :')} <code>{DEMO_EMAIL}</code> / <code>changeme123</code>
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
