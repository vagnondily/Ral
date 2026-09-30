import React from 'react';
import ReactDOM from 'react-dom/client';
// Fonts are self-hosted (bundled) rather than loaded from a CDN, so the app
// renders identically on restricted or offline networks. IBM Plex Sans for
// the UI, IBM Plex Mono for figures (a precise, data-oriented pairing).
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import App from './App.jsx';
import './styles.css';
import { initTheme } from './lib/theme.js';

// Apply the saved theme before first paint to avoid a flash.
initTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
