import React, { useMemo, useState } from 'react';
import { BookOpen, Search, Sigma, Gauge, Calculator, MapPinned, Database } from 'lucide-react';
import { Card, CardHeader, PageHeader, Skeleton, StatusBadge } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { useCalcFunctions, CALC_CATEGORIES } from './FormulaEditor.jsx';

/**
 * « Comment les calculs sont faits » (retour n° 4) : la documentation des
 * calculs du suivi de processus, fidèle au code — méthodes des indicateurs,
 * base, sens, classes, indice, champs calculés (la référence des fonctions est
 * le catalogue du moteur, servi par l'API), suivi terrain et RBM.
 */
const SECTIONS = [
  { id: 'donnees', label: 'Données prises en compte', icon: Database },
  { id: 'methodes', label: 'Méthodes des indicateurs', icon: Calculator },
  { id: 'classes', label: 'Sens, classes et indice', icon: Gauge },
  { id: 'formules', label: 'Champs calculés et formules', icon: Sigma },
  { id: 'terrain', label: 'Suivi terrain et RBM', icon: MapPinned },
];

const METHODS = [
  { name: '% de « oui »', counts: 'Réponses positives : oui, yes, 1, true, vrai — ou la valeur comptée, si elle est précisée.', formula: '100 × réponses positives ÷ réponses comptées', example: '30 « oui » sur 36 réponses comptées → 83,3 %' },
  { name: '% = valeur', counts: 'Réponses égales à la valeur comptée ; plusieurs valeurs séparées par « | » (1|2 : « Très sûr » et « Sûr »).', formula: '100 × réponses égales ÷ réponses comptées', example: '12 réponses « 1 » ou « 2 » sur 20 → 60 %' },
  { name: 'Moyenne', counts: 'Réponses numériques.', formula: 'somme ÷ nombre de réponses numériques', example: '3, 5 et 4 → 4' },
  { name: 'Somme', counts: 'Réponses numériques.', formula: 'total des réponses numériques', example: '3, 5 et 4 → 12' },
  { name: 'Nombre', counts: 'Réponses renseignées (non vides).', formula: 'nombre de réponses', example: '36 réponses → 36' },
];

const CLASS_DEF = {
  exc: { label: 'Excellent', tone: 'green', icon: 'check' },
  sat: { label: 'Satisfaisant', tone: 'blue', icon: 'clock' },
  imp: { label: 'À améliorer', tone: 'orange', icon: 'warn' },
  urg: { label: 'Action urgente', tone: 'red', icon: 'x' },
  na: { label: 'Non évalué', icon: 'na' },
};
const CLASSES = [
  { id: 'exc', withTarget: 'Cible atteinte', noTarget: 'Score ≥ 80' },
  { id: 'sat', withTarget: 'Écart à la cible ≤ 10 % de la cible', noTarget: 'Score ≥ 65' },
  { id: 'imp', withTarget: 'Écart ≤ 30 % de la cible', noTarget: 'Score ≥ 50' },
  { id: 'urg', withTarget: 'Écart > 30 % de la cible', noTarget: 'Score < 50' },
  { id: 'na', withTarget: 'Aucune réponse comptée', noTarget: 'Aucune réponse, ou moyenne / somme / nombre sans cible' },
];

function Section({ id, title, icon: Icon, children }) {
  return (
    <Card aria-labelledby={`doc-${id}`} className="doc-section">
      <span id={id} className="doc-anchor" />
      <CardHeader id={`doc-${id}`} title={<><Icon size={16} aria-hidden="true" /> {title}</>} />
      <div className="card-body doc-body">{children}</div>
    </Card>
  );
}

function FunctionReference() {
  const { tr } = useI18n();
  const cat = useCalcFunctions();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (cat?.functions || []).filter((f) => !needle || f.name.includes(needle) || tr(f.description).toLowerCase().includes(needle));
    return CALC_CATEGORIES.map((c) => ({ category: c, items: list.filter((f) => f.category === c) })).filter((g) => g.items.length);
  }, [cat, q, tr]);
  if (cat === null) return <Skeleton height={160} />;
  return (
    <>
      <h3 className="doc-h3">{tr('Opérateurs')}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">{tr('Symbole')}</th><th scope="col">{tr('Rôle')}</th><th scope="col">{tr('Exemple')}</th></tr></thead>
          <tbody>{cat.operators.map((o) => (
            <tr key={o.symbol}><td className="mono nowrap">{o.symbol}</td><td>{tr(o.description)}</td><td><code>{o.example}</code></td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="doc-fn-head">
        <h3 className="doc-h3">{tr('Fonctions')}</h3>
        <div className="fx-search">
          <Search size={14} aria-hidden="true" />
          <input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Rechercher une fonction…')} aria-label={tr('Rechercher une fonction')} />
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.category} className="doc-fn-group">
          <h4>{tr(g.category)}</h4>
          <dl className="doc-fn-list">
            {g.items.map((f) => (
              <div key={f.name} className="doc-fn">
                <dt><code className="fx-syntax">{f.syntax}</code></dt>
                <dd>{tr(f.description)}<div className="fx-example"><span className="muted">{tr('Exemple')}</span><code>{f.example}</code></div></dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {!groups.length && <p className="muted">{tr('Aucune fonction ne correspond.')}</p>}
    </>
  );
}

export default function CalcDocsPage() {
  const { tr } = useI18n();
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="section-gap">
      <PageHeader title={tr('Comment les calculs sont faits')}
        description={tr('Tous les chiffres du suivi de processus sont recalculés en direct à partir des données importées : rien n\'est saisi à la main. Voici les règles exactes appliquées par MEMS.')} />
      <nav className="doc-toc" aria-label={tr('Sommaire')}>
        <BookOpen size={15} aria-hidden="true" />
        {SECTIONS.map((s) => <button key={s.id} type="button" className="inline-link" onClick={() => go(s.id)}>{tr(s.label)}</button>)}
      </nav>

      <Section id="donnees" title={tr('Données prises en compte')} icon={Database}>
        <ul className="doc-list">
          <li>{tr('Une soumission est identifiée par son identifiant Kobo (_uuid, « @_uuid » en SPSS, instanceID sans « uuid: ») : réimporter le même formulaire — en Excel, en SPSS ou par l\'API — ne la compte qu\'une fois. Un autre format la complète sans effacer ce qu\'il ne porte pas.')}</li>
          <li>{tr('Mois de collecte : le mois de la date d\'enquête (la première lisible de SvyDate, today, start puis end) quand elle précède l\'envoi au serveur (_submission_time) de 0 jour à 2 ans ; un envoi plus de 92 jours après l\'enquête reste au mois de l\'enquête et est seulement signalé (envoi tardif). Sinon — date d\'enquête absente, illisible, postérieure à l\'envoi ou de plus de 2 ans avant (à vérifier) — le mois de l\'envoi. La colonne de la date d\'enquête se choisit dans « Mapping MEMS » ; la vérification avant import l\'applique comme l\'import.')}</li>
          <li>{tr('Les soumissions exclues (« Exclure de l\'analyse ») ne comptent dans aucun calcul.')}</li>
          <li>{tr('Bureau, lieux, site et partenaire sont lus dans les colonnes reconnues de l\'export (ou celles choisies dans « Mapping MEMS ») ; une réponse « autre » (999) est remplacée par la précision saisie.')}</li>
        </ul>
      </Section>

      <Section id="methodes" title={tr('Méthodes des indicateurs')} icon={Calculator}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{tr('Méthode')}</th><th scope="col">{tr('Ce qui est compté')}</th><th scope="col">{tr('Calcul')}</th><th scope="col">{tr('Exemple')}</th></tr></thead>
            <tbody>{METHODS.map((m) => (
              <tr key={m.name}><td><strong>{tr(m.name)}</strong></td><td>{tr(m.counts)}</td><td className="mono">{tr(m.formula)}</td><td>{tr(m.example)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <h3 className="doc-h3">{tr('La base : quelles réponses comptent')}</h3>
        <ul className="doc-list">
          <li>{tr('Une question sans réponse n\'entre pas dans la base.')}</li>
          <li>{tr('Les réponses « hors base » de l\'indicateur (par exemple 9999 Sans objet, 888 Ne sait pas, 777 N/A) sont écartées, quelle que soit la méthode.')}</li>
          <li>{tr('Pourcentages et moyennes sont arrondis au dixième.')}</li>
        </ul>
        <p className="doc-example"><strong>{tr('Exemple')}</strong> — {tr('40 soumissions : 30 « oui », 6 « non », 4 « Ne sait pas » (888, hors base). Base = 36 ; 30 ÷ 36 = 83,3 %.')}</p>
      </Section>

      <Section id="classes" title={tr('Sens, classes et indice')} icon={Gauge}>
        <h3 className="doc-h3">{tr('Sens et score orienté')}</h3>
        <p>{tr('Par défaut, plus haut = mieux. Pour un indicateur « plus bas = mieux » (personnel armé présent, fraude…), le score orienté d\'un pourcentage vaut 100 − valeur : c\'est lui qui sert aux classes sans cible et à l\'indice ; la valeur affichée reste la mesure.')}</p>
        <h3 className="doc-h3">{tr('Classes')}</h3>
        <p>{tr('La même règle est appliquée partout : liste des résultats, Synthèse, Couverture & performance et rapports.')}</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{tr('Classe')}</th><th scope="col">{tr('Avec une cible')}</th><th scope="col">{tr('Sans cible (indicateur en %)')}</th></tr></thead>
            <tbody>{CLASSES.map((c) => (
              <tr key={c.id}><td><StatusBadge def={CLASS_DEF[c.id]} /></td><td>{tr(c.withTarget)}</td><td>{tr(c.noTarget)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted">{tr('L\'écart est relatif à la cible : cible 80 %, valeur 72 % → écart 8 ÷ 80 = 10 % → Satisfaisant. Pour « plus bas = mieux », la cible est atteinte quand la valeur est inférieure ou égale.')}</p>
        <h3 className="doc-h3">{tr('Indice de conformité')}</h3>
        <p>{tr('Moyenne des domaines (D1, D2…) à poids égaux ; chaque domaine est la moyenne des scores orientés de ses indicateurs en %. Les indicateurs « hors indice » (chiffres clés) et ceux sans résultat ne comptent pas. Arrondi au dixième.')}</p>
        <p className="doc-example"><strong>{tr('Exemple')}</strong> — {tr('D1 : 90 et 70 → 80 ; D2 : 60 → 60. Indice = (80 + 60) ÷ 2 = 70.')}</p>
      </Section>

      <Section id="formules" title={tr('Champs calculés et formules')} icon={Sigma}>
        <ul className="doc-list">
          <li>{tr('Recodage : chaque valeur listée est remplacée par sa nouvelle valeur ; sinon la valeur par défaut, si elle est donnée, sinon la valeur d\'origine.')}</li>
          <li>{tr('Formule : calculée pour chaque soumission, dans l\'ordre de la liste des champs calculés (un champ peut utiliser ceux qui le précèdent). Un champ calculé sert ensuite de variable d\'indicateur comme une autre.')}</li>
          <li>{tr('Réponse manquante : un calcul, une comparaison ou une condition qui l\'utilise donne vide — la soumission sort alors de la base de l\'indicateur, elle ne compte ni « oui » ni « non ». Pour la traiter, testez-la avec isnull(x), x = null ou x = "", ou remplacez-la avec coalesce(x, 0) ; sum() et avg() ignorent les vides. Division par zéro → vide.')}</li>
          <li>{tr('Comparaison en nombres si les deux côtés en sont, sinon en texte. Faux = 0, « non », « no », « n », « false », « faux » (majuscules ignorées) ; toute autre réponse est vraie.')}</li>
          <li>{tr('Question à choix multiples : Kobo enregistre les options cochées séparées par des espaces (« 1 3 7 ») : utilisez selected(question, "3"). Une colonne éclatée « question/3 » s\'écrit entre crochets : [question/3].')}</li>
        </ul>
        <FunctionReference />
      </Section>

      <Section id="terrain" title={tr('Suivi terrain et RBM')} icon={MapPinned}>
        <ul className="doc-list">
          {/* Les taux des définitions communes (docs/PLAN_RETOURS_15_37.md, retour 110 : une seule source,
              GET /api/dashboards/coverage) : couverture = SITES, exécution du plan = VISITES — jamais l'un
              pour l'autre ; le taux des visites DÉCLARÉES seules porte un autre nom. */}
          <li>{tr('Couverture (sites) = sites actifs suivis au moins une fois pendant un de leurs mois actifs ÷ sites actifs ; suivi = visite déclarée réalisée OU données reçues rattachées au site. Sur une période, chaque site compte une fois (actif au moins un mois de la période) ; sans grille des sites actifs, tout le registre est actif. Une visite ou des données pendant un mois non actif sont dites à part, jamais comptées.')}</li>
          <li>{tr('Planification = sites actifs ayant au moins une visite prévue ÷ sites actifs ; « — aucun plan » quand aucune visite n\'est prévue, jamais 0 %.')}</li>
          <li>{tr('Exécution du plan (visites), tableaux de bord et alertes = visites prévues des mois échus (un site × un mois actif, comptée une fois, non annulée) suivies dans leur mois — visite déclarée OU données reçues — ÷ visites prévues. Les visites annulées ne comptent pas ; celles des mois à venir sont dites à part (« à venir »).')}</li>
          <li>{tr('Exécution des visites (déclarées), écran Affectation & visites = visites réalisées ÷ (prévues + réalisées), visites déclarées seulement : les données reçues n\'y comptent pas, d\'où un taux qui peut différer de l\'exécution du plan.')}</li>
          {/* Règle des jours de collecte = fieldMath.collectionDays ; journées-agent = planResources. */}
          <li>{tr('Jours de collecte d\'un TPM = une journée par agent et par date de visite non annulée (plusieurs sites d\'un même agent le même jour = une journée ; une visite datée sans agent = une journée) + jours de déplacement saisis. Une visite de plusieurs jours n\'y compte que sa date de début, seule enregistrée.')}</li>
          <li>{tr('Planification automatique : une journée-agent = un agent dans une commune pour la journée ; les visites d\'une commune (toutes activités) remplissent ses journées selon les suivis par jour du MMR, et une visite à moins d\'un suivi par jour occupe toute sa durée (0,5 suivi par jour = 2 journées consécutives du même agent). Agents d\'une unité = le plus petit effectif où toutes ses journées tiennent dans les jours de terrain du mois.')}</li>
          <li>{tr('Fréquence de suivi selon le risque du site : élevé = chaque mois, moyen = tous les 2 mois, faible = tous les 3 mois.')}</li>
          <li>{tr('Un site est « à suivre » s\'il n\'a jamais été visité, si cette fréquence est atteinte depuis sa dernière visite, ou si son score de priorité le signale en retard. Dernière visite = le dernier mois réalisé au mois de référence ou avant : visite réalisée, soumission reçue pour le site (ou sa commune) ou date du registre ; une visite seulement prévue ne compte jamais.')}</li>
        </ul>
      </Section>
    </div>
  );
}
