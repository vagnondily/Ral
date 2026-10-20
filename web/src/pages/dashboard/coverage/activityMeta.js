import {
  BarChart3, CircleHelp, ClipboardCheck, FileQuestion, FileText, HeartPulse, LayoutDashboard, Layers, MapPin, MonitorDot,
  Package, ShieldAlert, Soup, Sprout, UserRound,
} from 'lucide-react';

/**
 * Identité visuelle d'une activité du tableau de bord : une ICÔNE et un LIBELLÉ (jamais une
 * couleur propre — les couleurs fortes sont réservées aux classes, la teinte d'accent de MEMS
 * reste la seule). Icône du modèle d'indicateurs quand l'activité en a un (clé du catalogue,
 * lue dans la réponse du serveur), sinon une icône générique.
 */
const TEMPLATE_ICONS = { GD: Package, SMP: Soup, MAM: HeartPulse, STUNT: Sprout };

export const activityIcon = (a) => (a && a.kind === 'sans' ? FileQuestion : (a && TEMPLATE_ICONS[a.templateKey]) || Layers);

/** Identifiant d'onglet (les fiches sans activité ont la clé vide côté serveur). */
export const tabIdOf = (a) => (a.key ? `a:${a.key}` : 'none');

/** Nom affiché d'une activité ; `tr` traduit le libellé des fiches sans activité. */
export const activityName = (a, tr) => (a.kind === 'sans' ? tr('Fiches sans activité') : (a.label || a.category || ''));

/** Paramètres d'API d'une activité : sa catégorie, ou « fiches sans activité ». */
export const activityQuery = (a) => (a.kind === 'sans' ? { none: true } : { activity: a.category });

/** Pages d'une activité (menu de gauche de la maquette) et leur public. */
export const PAGES = [
  { id: 'synthese', label: 'Synthèse', audience: 'Management / Bailleurs', icon: LayoutDashboard },
  { id: 'controle', label: 'Salle de contrôle', audience: 'Suivi des indicateurs', icon: MonitorDot },
  { id: 'carte', label: 'Carte', audience: 'Bailleurs / Coordination', icon: MapPin },
  { id: 'performance', label: 'Performance', audience: 'Analystes', icon: BarChart3 },
  { id: 'bulletin', label: 'Bulletin', audience: 'Communication', icon: FileText },
  { id: 'qualite', label: 'Qualité', audience: 'Gestionnaires', icon: ClipboardCheck },
  { id: 'integrite', label: 'Contrôle', audience: 'Contrôle / Intégrité', icon: ShieldAlert },
  { id: 'agents', label: 'Agents', audience: 'Qualité de saisie', icon: UserRound },
  { id: 'aide', label: 'Aide', audience: 'Tous', icon: CircleHelp },
];
