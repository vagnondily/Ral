import React from 'react';
import { ChevronRight } from 'lucide-react';
import { initials, RISK } from '../lib/format.js';

export function Button({ variant = 'primary', size, block, loading, disabled, icon: Icon, children, className = '', type = 'button', ...props }) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} disabled={loading || disabled} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="spinner" aria-hidden="true" /> : Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, size, variant = 'ghost', className = '', ...props }) {
  return (
    <button
      type="button"
      className={['btn', `btn-${variant}`, 'btn-icon', size === 'sm' && 'btn-sm', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

export function Badge({ tone, dot, children }) {
  return (
    <span className={`badge ${tone ? `badge-${tone}` : ''}`}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function RiskBadge({ level }) {
  const risk = RISK[level];
  if (!risk) return <span className="cell-empty">—</span>;
  return (
    <Badge tone={risk.tone} dot>
      {risk.label}
    </Badge>
  );
}

export function Avatar({ name, size }) {
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Card({ className = '', children, ...props }) {
  return (
    <section className={`card ${className}`} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, children, id }) {
  return (
    <div className="card-header">
      <div>
        <h2 className="card-title" id={id}>{title}</h2>
        {subtitle && <p className="card-sub">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, children }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </header>
  );
}

export function Field({ label, htmlFor, required, hint, error, children }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {error ? (
        <span className="field-error" id={`${htmlFor}-error`}>{error}</span>
      ) : (
        hint && <span className="field-hint" id={`${htmlFor}-hint`}>{hint}</span>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', icon: Icon, children }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {Icon && <Icon size={18} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}

export function Skeleton({ width = '100%', height = 16, style }) {
  return <span className="skeleton" style={{ display: 'block', width, height, ...style }} aria-hidden="true" />;
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && (
        <span className="empty-icon">
          <Icon size={22} aria-hidden="true" />
        </span>
      )}
      <span className="empty-title">{title}</span>
      {children && <span>{children}</span>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/** Compact band of figures — replaces stacked KPI cards. */
export function Stats({ items, compact }) {
  return (
    <div className={`stats ${compact ? 'stats-compact' : ''}`} style={{ '--stat-cols': items.length }}>
      {items.map((it) => (
        <div className="stat" key={it.label}>
          <span className="stat-label">{it.label}</span>
          <span className="stat-value">
            {it.value}
            {it.suffix && <small> {it.suffix}</small>}
          </span>
          {it.children}
          {it.foot && <span className="stat-foot">{it.foot}</span>}
        </div>
      ))}
    </div>
  );
}

/** Chevron toggle for a table row that opens a sub-group. */
export function ExpandButton({ expanded, onClick, label, controls }) {
  return (
    <button
      type="button"
      className="expander"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={`${expanded ? 'Replier' : 'Déplier'} : ${label}`}
      title={expanded ? 'Replier' : 'Déplier'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

/** Consumption bar + percentage (turns orange ≥ 90 %, red above 100 %). */
export function Usage({ rate }) {
  const pct = Math.round(rate * 100);
  const tone = rate > 1 ? 'is-over' : rate >= 0.9 ? 'is-high' : '';
  return (
    <div className="usage">
      <div className={`progress ${tone}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Taux de consommation">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span>{pct} %</span>
    </div>
  );
}

export function Progress({ value, label }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
