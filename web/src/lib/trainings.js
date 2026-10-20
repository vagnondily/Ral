// Formations en sessions (lot 8, retour 28.2) : statuts (couleur + icône + libellé), présence,
// format des pourcentages. Les chiffres viennent du serveur (trainingMath.js).

export const TRAINING_STATUS = {
  planifiee: { label: 'Planifiée', tone: 'blue', icon: 'clock' },
  realisee: { label: 'Réalisée', tone: 'green', icon: 'check' },
  annulee: { label: 'Annulée', tone: null, icon: 'ban' },
};

export const ATTENDANCE = [
  { id: 'present', label: 'Présent' },
  { id: 'partiel', label: 'Partiel' },
  { id: 'absent', label: 'Absent' },
];

/** « 75 % » (format de la langue via tr), « — » sans valeur. */
export const formatPct = (x, tr) => (x == null ? '—' : tr('{p} %', { p: x }));
