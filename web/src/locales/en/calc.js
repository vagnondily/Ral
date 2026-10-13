/**
 * Éditeur de formule, champs calculés et page « Comment les calculs sont faits »
 * (retour n° 4). Les descriptions des fonctions et des opérateurs viennent du
 * catalogue du serveur (calcFields.FUNCTIONS) : leur texte français est la clé.
 */
export default {
  'Réponse manquante : un calcul, une comparaison ou une condition qui l\'utilise donne vide — la soumission sort alors de la base de l\'indicateur, elle ne compte ni « oui » ni « non ». Pour la traiter, testez-la avec isnull(x), x = null ou x = "", ou remplacez-la avec coalesce(x, 0) ; sum() et avg() ignorent les vides. Division par zéro → vide.':
    'Missing answer: any calculation, comparison or condition that uses it gives empty — the submission then leaves the indicator’s base and counts neither “yes” nor “no”. To handle it, test it with isnull(x), x = null or x = "", or replace it with coalesce(x, 0); sum() and avg() ignore empty values. Division by zero → empty.',
  'Comparaison en nombres si les deux côtés en sont, sinon en texte. Faux = 0, « non », « no », « n », « false », « faux » (majuscules ignorées) ; toute autre réponse est vraie.':
    'Comparison as numbers when both sides are numbers, otherwise as text. False = 0, “non”, “no”, “n”, “false”, “faux” (case ignored); any other answer is true.',
  'Renvoie « si_vrai » quand la condition est vraie, « si_faux » quand elle est fausse (vide si omis), et vide quand la condition est vide (réponse manquante). Les conditions s\'imbriquent : if(a, x, if(b, y, z)).':
    'Returns “if_true” when the condition is true, “if_false” when it is false (empty if omitted), and empty when the condition is empty (missing answer). Conditions can be nested: if(a, x, if(b, y, z)).',
  '1 si la valeur est un nombre compris entre min et max (bornes incluses), sinon 0 ; vide si la valeur est vide ou n\'est pas un nombre.':
    '1 if the value is a number between min and max (inclusive), otherwise 0; empty if the value is empty or not a number.',
  'Comparaison (== et != aussi acceptés) : nombres si les deux côtés en sont, sinon textes. Renvoie 1 (vrai) ou 0 (faux), et vide si un côté est vide (réponse manquante) ; « x = null » ou « x = \"\" » teste si x est vide.':
    'Comparison (== and != also accepted): as numbers when both sides are numbers, otherwise as texts. Returns 1 (true) or 0 (false), and empty when a side is empty (missing answer); “x = null” or “x = \"\"” tests whether x is empty.',
  'Logique (&&, || et ! aussi acceptés). Faux = 0, « non », « no », « n », « false », « faux » (majuscules ignorées) ; vide = inconnu, sauf si l\'autre côté suffit (faux AND vide = faux, vrai OR vide = vrai). NOT devant un terme suivi d\'une comparaison porte sur toute la comparaison : NOT x = 1 se lit NOT (x = 1) ; devant un calcul, il ne porte que sur le premier terme (NOT isnull(a) + NOT isnull(b) = 2).':
    'Logic (&&, || and ! also accepted). False = 0, “non”, “no”, “n”, “false”, “faux” (case ignored); empty = unknown, unless the other side decides (false AND empty = false, true OR empty = true). NOT before a term followed by a comparison applies to the whole comparison: NOT x = 1 reads NOT (x = 1); before a calculation it applies to the first term only (NOT isnull(a) + NOT isnull(b) = 2).',
  '{n} doublon(s) du fichier comptés une seule fois (dernière version retenue).': '{n} duplicate(s) in the file counted once (latest version kept).',
  // ---- Éditeur de formule
  'Formule': 'Formula',
  'Tapez une formule, ou choisissez une fonction à droite.': 'Type a formula, or pick a function on the right.',
  'Vérification…': 'Checking…',
  'La formule contient une erreur': 'The formula contains an error',
  'caractère {n}': 'character {n}',
  'La formule est valide.': 'The formula is valid.',
  'Aucune soumission dans cette fiche : importez des données pour voir le résultat.': 'No submissions in this form yet: import data to see the result.',
  'Aperçu sur les {n} soumissions les plus récentes': 'Preview on the {n} most recent submissions',
  '{f} avec un résultat · {e} vide(s) · {k} valeur(s) distincte(s)': '{f} with a result · {e} empty · {k} distinct value(s)',
  'Résultat': 'Result',
  'vide': 'empty',
  'Répartition des résultats': 'Distribution of results',
  'autres valeurs : {n}': 'other values: {n}',
  'vides : {n}': 'empty: {n}',
  'Tab pour compléter': 'Tab to complete',
  'Opérateurs : + − * / , = <> < <= > >= , AND OR NOT. Texte entre guillemets ; variable avec « / » ou espaces entre crochets : [process_monitoring/3].':
    'Operators: + − * / , = <> < <= > >= , AND OR NOT. Text in double quotes; a variable with “/” or spaces in square brackets: [process_monitoring/3].',
  'Aide à la saisie': 'Input help',
  'Fonctions': 'Functions',
  'Rechercher une fonction…': 'Search a function…',
  'Rechercher une fonction': 'Search a function',
  'Rechercher une variable (nom ou libellé)…': 'Search a variable (name or label)…',
  'Aucune fonction ne correspond.': 'No matching function.',
  'Aucune variable ne correspond.': 'No matching variable.',
  'Insérer {name}( )': 'Insert {name}( )',
  'Insérer {name}': 'Insert {name}',
  'choix multiples : selected({name}, "…")': 'multiple choice: selected({name}, "…")',
  'Comment les calculs sont faits': 'How calculations are done',
  'Aide aux calculs': 'Calculation help',
  'Comment c\'est calculé ?': 'How is it calculated?',
  'Documentation': 'Documentation',
  'Toutes': 'All',
  'Catégories': 'Categories',

  // ---- Catégories et catalogue des fonctions (texte servi par l'API)
  'Logique': 'Logic',
  'Nombres': 'Numbers',
  'Texte': 'Text',
  'Choix multiples': 'Multiple choice',
  'Valeurs manquantes': 'Missing values',
  '1 si la valeur est égale à l\'une des valeurs listées (nombres ou textes, sans tenir compte des majuscules), sinon 0 ; vide si la valeur est vide (réponse manquante), sauf si la liste contient "" ou null.':
    '1 if the value equals one of the listed values (numbers or texts, case-insensitive), otherwise 0; empty if the value is empty (missing answer), unless the list contains "" or null.',
  'Convertit en nombre ; 0 si la valeur est vide ou n\'est pas un nombre.': 'Converts to a number; 0 if the value is empty or not a number.',
  'Arrondit x au nombre de décimales indiqué (0 par défaut).': 'Rounds x to the given number of decimals (0 by default).',
  'Valeur absolue (écart sans signe).': 'Absolute value (unsigned difference).',
  'Somme des valeurs renseignées, en ignorant les vides (alors que a + b est vide dès qu\'un terme manque).':
    'Sum of the filled-in values, ignoring empty ones (whereas a + b is empty as soon as one term is missing).',
  'Moyenne des valeurs renseignées (les vides sont ignorés).': 'Average of the filled-in values (empty ones are ignored).',
  'Plus petite des valeurs renseignées.': 'Smallest of the filled-in values.',
  'Plus grande des valeurs renseignées.': 'Largest of the filled-in values.',
  'Texte en minuscules.': 'Text in lower case.',
  'Texte en majuscules.': 'Text in upper case.',
  'Retire les espaces au début et à la fin.': 'Removes leading and trailing spaces.',
  'Nombre de caractères.': 'Number of characters.',
  'Les n premiers caractères (ex. code de région au début d\'un pcode).': 'The first n characters (e.g. the region code at the start of a pcode).',
  'Les n derniers caractères.': 'The last n characters.',
  '1 si le texte contient la recherche (sans tenir compte des majuscules), sinon 0 ; vide si le texte est vide (réponse manquante).':
    '1 if the text contains the search string (case-insensitive), otherwise 0; empty if the text is empty (missing answer).',
  'Met bout à bout les valeurs (les vides comptent pour rien).': 'Joins the values together (empty values count as nothing).',
  '1 si l\'option fait partie des réponses d\'une question à choix multiples (réponses séparées par des espaces, comme dans Kobo), sinon 0 ; vide si la question n\'a pas de réponse.':
    '1 if the option is among the answers of a multiple-choice question (answers separated by spaces, as in Kobo), otherwise 0; empty if the question was not answered.',
  'Nombre d\'options cochées pour une question à choix multiples ; 0 si la question n\'a pas de réponse.':
    'Number of options ticked for a multiple-choice question; 0 if the question has no answer.',
  '1 si la valeur est vide (question non répondue), sinon 0.': '1 if the value is empty (question not answered), otherwise 0.',
  'Première valeur non vide de la liste.': 'First non-empty value of the list.',
  'Calcul : addition, soustraction, multiplication, division, reste. Vide si un terme est vide ; division par zéro → vide.':
    'Arithmetic: addition, subtraction, multiplication, division, remainder. Empty if a term is empty; division by zero → empty.',
  'Texte entre guillemets ; variable dont le nom contient des espaces ou des « / » entre crochets ; null = valeur vide.':
    'Text in double quotes; a variable whose name contains spaces or “/” in square brackets; null = empty value.',

  // ---- Page « Comment les calculs sont faits »
  'Tous les chiffres du suivi de processus sont recalculés en direct à partir des données importées : rien n\'est saisi à la main. Voici les règles exactes appliquées par MEMS.':
    'Every process-monitoring figure is recomputed live from the imported data: nothing is typed by hand. Here are the exact rules MEMS applies.',
  'Sommaire': 'Contents',
  'Opérateurs': 'Operators',
  'Symbole': 'Symbol',
  'Rôle': 'Role',
  'Données prises en compte': 'Data taken into account',
  'Une soumission est identifiée par son identifiant Kobo (_uuid, « @_uuid » en SPSS, instanceID sans « uuid: ») : réimporter le même formulaire — en Excel, en SPSS ou par l\'API — ne la compte qu\'une fois. Un autre format la complète sans effacer ce qu\'il ne porte pas.':
    'A submission is identified by its Kobo identifier (_uuid, “@_uuid” in SPSS, instanceID without “uuid:”): re-importing the same form — in Excel, SPSS or through the API — counts it only once. Another format completes it without erasing what it does not carry.',
  'Mois de collecte : le mois de la date d\'enquête (la première lisible de SvyDate, today, start puis end) quand elle précède l\'envoi au serveur (_submission_time) de 0 jour à 2 ans ; un envoi plus de 92 jours après l\'enquête reste au mois de l\'enquête et est seulement signalé (envoi tardif). Sinon — date d\'enquête absente, illisible, postérieure à l\'envoi ou de plus de 2 ans avant (à vérifier) — le mois de l\'envoi. La colonne de la date d\'enquête se choisit dans « Mapping MEMS » ; la vérification avant import l\'applique comme l\'import.':
    'Collection month: the month of the survey date (the first readable one among SvyDate, today, start then end) when it precedes the upload to the server (_submission_time) by 0 days to 2 years; an upload more than 92 days after the survey stays in the survey month and is only flagged (late upload). Otherwise — survey date missing, unreadable, after the upload or more than 2 years before it (to be checked) — the upload month. The survey-date column is chosen in “MEMS mapping”; the pre-import check applies it exactly like the import.',
  'Les soumissions exclues (« Exclure de l\'analyse ») ne comptent dans aucun calcul.': 'Excluded submissions (“Exclude from analysis”) count in no calculation.',
  'Bureau, lieux, site et partenaire sont lus dans les colonnes reconnues de l\'export (ou celles choisies dans « Mapping MEMS ») ; une réponse « autre » (999) est remplacée par la précision saisie.':
    'Office, places, site and partner are read from the recognised columns of the export (or those chosen in “MEMS mapping”); an “other” answer (999) is replaced by the specification typed in.',
  'Méthodes des indicateurs': 'Indicator methods',
  'Méthode': 'Method',
  'Ce qui est compté': 'What is counted',
  'Calcul': 'Calculation',
  'Réponses positives : oui, yes, 1, true, vrai — ou la valeur comptée, si elle est précisée.': 'Positive answers: oui, yes, 1, true, vrai — or the counted value, when one is set.',
  '100 × réponses positives ÷ réponses comptées': '100 × positive answers ÷ counted answers',
  '30 « oui » sur 36 réponses comptées → 83,3 %': '30 “yes” out of 36 counted answers → 83.3 %',
  'Réponses égales à la valeur comptée ; plusieurs valeurs séparées par « | » (1|2 : « Très sûr » et « Sûr »).': 'Answers equal to the counted value; several values separated by “|” (1|2: “Very safe” and “Safe”).',
  '100 × réponses égales ÷ réponses comptées': '100 × matching answers ÷ counted answers',
  '12 réponses « 1 » ou « 2 » sur 20 → 60 %': '12 answers “1” or “2” out of 20 → 60 %',
  'Réponses numériques.': 'Numeric answers.',
  'somme ÷ nombre de réponses numériques': 'sum ÷ number of numeric answers',
  '3, 5 et 4 → 4': '3, 5 and 4 → 4',
  'total des réponses numériques': 'total of the numeric answers',
  '3, 5 et 4 → 12': '3, 5 and 4 → 12',
  'Réponses renseignées (non vides).': 'Filled-in (non-empty) answers.',
  'nombre de réponses': 'number of answers',
  '36 réponses → 36': '36 answers → 36',
  'La base : quelles réponses comptent': 'The base: which answers count',
  'Une question sans réponse n\'entre pas dans la base.': 'An unanswered question is not part of the base.',
  'Les réponses « hors base » de l\'indicateur (par exemple 9999 Sans objet, 888 Ne sait pas, 777 N/A) sont écartées, quelle que soit la méthode.':
    'The indicator’s “out of base” answers (for example 9999 Not applicable, 888 Don’t know, 777 N/A) are left out, whatever the method.',
  'Pourcentages et moyennes sont arrondis au dixième.': 'Percentages and averages are rounded to one decimal.',
  '40 soumissions : 30 « oui », 6 « non », 4 « Ne sait pas » (888, hors base). Base = 36 ; 30 ÷ 36 = 83,3 %.':
    '40 submissions: 30 “yes”, 6 “no”, 4 “Don’t know” (888, out of base). Base = 36; 30 ÷ 36 = 83.3 %.',
  'Sens, classes et indice': 'Direction, classes and index',
  'Sens et score orienté': 'Direction and oriented score',
  'Par défaut, plus haut = mieux. Pour un indicateur « plus bas = mieux » (personnel armé présent, fraude…), le score orienté d\'un pourcentage vaut 100 − valeur : c\'est lui qui sert aux classes sans cible et à l\'indice ; la valeur affichée reste la mesure.':
    'By default, higher = better. For a “lower = better” indicator (armed staff present, fraud…), the oriented score of a percentage is 100 − value: it is used for the classes without a target and for the index; the displayed value remains the measurement.',
  'Classes': 'Classes',
  'La même règle est appliquée partout : liste des résultats, Synthèse, Couverture & performance et rapports.':
    'The same rule applies everywhere: results list, Summary, Coverage & performance and reports.',
  'Classe': 'Class',
  'Avec une cible': 'With a target',
  'Sans cible (indicateur en %)': 'Without a target (indicator in %)',
  'Cible atteinte': 'Target reached',
  'Score ≥ 80': 'Score ≥ 80',
  'Écart à la cible ≤ 10 % de la cible': 'Gap to target ≤ 10 % of the target',
  'Score ≥ 65': 'Score ≥ 65',
  'Écart ≤ 30 % de la cible': 'Gap ≤ 30 % of the target',
  'Score ≥ 50': 'Score ≥ 50',
  'Écart > 30 % de la cible': 'Gap > 30 % of the target',
  'Score < 50': 'Score < 50',
  'Aucune réponse comptée': 'No counted answer',
  'Aucune réponse, ou moyenne / somme / nombre sans cible': 'No answer, or average / sum / count without a target',
  'L\'écart est relatif à la cible : cible 80 %, valeur 72 % → écart 8 ÷ 80 = 10 % → Satisfaisant. Pour « plus bas = mieux », la cible est atteinte quand la valeur est inférieure ou égale.':
    'The gap is relative to the target: target 80 %, value 72 % → gap 8 ÷ 80 = 10 % → Satisfactory. For “lower = better”, the target is reached when the value is lower or equal.',
  'Indice de conformité': 'Compliance index',
  'Moyenne des domaines (D1, D2…) à poids égaux ; chaque domaine est la moyenne des scores orientés de ses indicateurs en %. Les indicateurs « hors indice » (chiffres clés) et ceux sans résultat ne comptent pas. Arrondi au dixième.':
    'Average of the domains (D1, D2…) with equal weights; each domain is the average of the oriented scores of its indicators in %. “Not in index” indicators (key figures) and those without a result do not count. Rounded to one decimal.',
  'D1 : 90 et 70 → 80 ; D2 : 60 → 60. Indice = (80 + 60) ÷ 2 = 70.': 'D1: 90 and 70 → 80; D2: 60 → 60. Index = (80 + 60) ÷ 2 = 70.',
  'Champs calculés et formules': 'Calculated fields and formulas',
  'Recodage : chaque valeur listée est remplacée par sa nouvelle valeur ; sinon la valeur par défaut, si elle est donnée, sinon la valeur d\'origine.':
    'Recode: each listed value is replaced by its new value; otherwise the default value, if given, otherwise the original value.',
  'Formule : calculée pour chaque soumission, dans l\'ordre de la liste des champs calculés (un champ peut utiliser ceux qui le précèdent). Un champ calculé sert ensuite de variable d\'indicateur comme une autre.':
    'Formula: computed for every submission, in the order of the calculated-field list (a field can use those before it). A calculated field can then be used as an indicator variable like any other.',
  'Question à choix multiples : Kobo enregistre les options cochées séparées par des espaces (« 1 3 7 ») : utilisez selected(question, "3"). Une colonne éclatée « question/3 » s\'écrit entre crochets : [question/3].':
    'Multiple-choice question: Kobo records the ticked options separated by spaces (“1 3 7”): use selected(question, "3"). A split column “question/3” is written in square brackets: [question/3].',
  'Suivi terrain et RBM': 'Field monitoring and RBM',
  'Couverture terrain = visites réalisées ÷ (planifiées + réalisées) ; les visites annulées ne comptent pas.': 'Field coverage = completed visits ÷ (planned + completed); cancelled visits do not count.',
  'Jours de collecte d\'un prestataire = visites datées non annulées + jours de déplacement saisis.': 'A provider’s collection days = dated, non-cancelled visits + travel days entered.',
  'Fréquence de suivi selon le risque du site : élevé = chaque mois, moyen = tous les 2 mois, faible = tous les 3 mois.': 'Monitoring frequency by site risk: high = every month, medium = every 2 months, low = every 3 months.',
  'Un site est « à suivre » s\'il n\'a jamais été visité, si cette fréquence est atteinte depuis sa dernière visite, ou si son score de priorité le signale en retard. Dernière visite = la plus récente entre la dernière visite planifiée ou réalisée, la dernière soumission reçue pour le site (ou sa commune) et la date du registre.':
    'A site is “due” if it was never visited, if this frequency has elapsed since its last visit, or if its priority score flags it as late. Last visit = the most recent of the last planned or completed visit, the last submission received for the site (or its commune) and the registry date.',
};
