import React from 'react';

/**
 * MEMS 2.0 logo mark — an emblem drawn as inline SVG so it renders crisply at
 * any size, in light or dark theme, with no external asset. A stylised « M »
 * (also reading as an upward monitoring pulse) on an indigo gradient.
 *
 * To swap in the official MEMS logo later, replace the <svg> below with an
 * <img src="/mems-logo.svg" …/> (drop the file in web/public/) — every
 * placement (sidebar, login) uses this single component.
 */
export function LogoMark({ size = 36, className = '' }) {
  const gid = React.useId();
  return (
    <svg
      className={`logo-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="MEMS"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4c8dff" />
          <stop offset="1" stopColor="#2f6bff" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="11" fill={`url(#${gid})`} />
      {/* Stylised M */}
      <path
        d="M11 37 V12 H16.5 L24 23 L31.5 12 H37 V37 H31 V21.5 L25 30 H23 L17 21.5 V37 Z"
        fill="#fff"
      />
      {/* Monitoring accent dot */}
      <circle cx="24" cy="34" r="2.4" fill="#ffc759" />
    </svg>
  );
}
