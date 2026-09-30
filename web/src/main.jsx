import React from 'react';
import ReactDOM from 'react-dom/client';
// Fonts are self-hosted (bundled) rather than loaded from a CDN, so the app
// renders identically on restricted or offline networks. Inter for the UI
// (the modern SaaS standard), IBM Plex Mono for codes/IDs.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
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
