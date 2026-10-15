// Partenaires & TPM (lot 8) : statuts et libellés partagés par la liste des prestataires, la
// fiche 360° et les listes de choix. Statut = couleur + icône + libellé (StatusBadge).

// Statut d'un prestataire selon ses contrats de suivi (règle commune « prestataire actif »,
// server/src/modules/tpm/activeProvider.js providerStatus).
export const PROVIDER_STATUS = {
  actif: { label: 'Actif selon contrat', tone: 'green', icon: 'check' },
  a_venir: { label: 'Contrat à venir', tone: 'blue', icon: 'clock' },
  echu: { label: 'Contrat terminé', tone: null, icon: 'ban' },
  aucun: { label: 'Sans contrat de suivi', tone: null, icon: 'na' },
};

// Comment un prestataire est rattaché à un contrat.
export const VIA_LABELS = {
  titulaire: 'Titulaire',
  plan: 'Plan de collecte',
  rapport: 'Rapports et factures',
  visite: 'Visites',
};

/** Taux en % (1 décimale) ou null. */
export const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
