# Allègement des écrans et ton « humain » — consigne commune à tous les lots

Retour de l'utilisateur (ses mots) :
- « Fais que les titres soient les plus humains possible et que ce ne soit pas, dans la globalité de l'application, reconnaissable qu'elle a été faite par une IA. »
- « Ce que je n'aime pas, c'est la lourdeur des écrans. Les commentaires inutiles, ou encore les commentaires qui chargent trop l'écran par rapport à l'information réelle (pour ça on a les infobulles). »
- « N'enlève pas la synthèse de la carte. »

Rien de ce qui a été demandé avant ne disparaît : chaque chiffre reste explicable (valeur réelle, n/N, référence, formule, limites) — mais l'explication va dans l'infobulle « i » (`infoBtn(texte)`) ou dans le tiroir de détail (`openDrawer`), PAS en paragraphe à l'écran.

## Règles
1. **Titres** : courts, comme les écrirait un chargé de S&E dans un tableau de bord fait main. 1 à 4 mots de préférence, sans deux-points, sans question, sans parenthèse, sans sigle non courant. Exemples : « Visites », « Score par activité », « Alertes », « Cas à suivre », « Couverture du plan », « Agents », « Organisations de suivi », « Partenaires de mise en œuvre », « Plan du mois », « Capacité », « Durée des fiches ». À éviter : « Sommes-nous sous contrôle ? Une ligne par activité », « Organisations de suivi (TPM) : qualité de la collecte », « Synthèse analytique… », « Fiche indicateur standard ».
2. **Sous-titres / phrases d'introduction** : supprimés par défaut. Au plus UNE ligne courte (≈ 10 mots) si elle est indispensable pour lire le bloc ; tout le reste (définition, méthode, seuils, sources, limites, « comment lire ») → infobulle « i » à côté du titre.
3. **Commentaires à supprimer** de l'écran : méta-commentaires (« Cliquez sur une ligne pour… », « Ce que l'on évalue : », « Lecture : », « Remarque : », « recalculé en direct », « moteur unique », « source de vérité », « calculé à partir de… »), répétitions des filtres appliqués (une seule fois, dans la barre de filtres), liens « Détail du calcul › » sous chaque tuile (la tuile entière est cliquable : curseur main + petit « i » discret suffit), légendes redondantes, notes de méthode sous les graphiques.
4. **Avertissements** : seuls ceux qui demandent une action restent visibles, en une ligne courte (ex. « Grille 2027 non renseignée »). Les autres → infobulle ou tiroir.
5. **Tuiles** : un libellé court, un chiffre, au plus une petite ligne (ex. « 2 275 visites » / « sur 2 546 »). Pas de paragraphes dans les tuiles.
6. **Tableaux** : en-têtes courts ; une cellule = une valeur lisible (« 31/38 » ou « 81 % »), le détail (« 5 non vérifiables, médiane 4,8 h… ») en infobulle de cellule (`bindTip`) ou dans le tiroir de la ligne ; pas de deuxième ligne grise sous chaque valeur sauf si essentielle.
7. **Ton** : français simple et naturel, phrases courtes, vocabulaire du terrain. Évite les marqueurs typiques des textes générés : enchaînements de tirets cadratins « — », accumulation de « · », listes de puces en gras « Libellé : texte » partout, parenthèses explicatives en cascade, guillemets « » autour de chaque terme, formules creuses (« afin de garantir », « de manière fiable », « en toute transparence », « clé », « robuste », « exhaustif », « il est important de noter »), symboles décoratifs. Pas d'emoji. Majuscule seulement en début de titre.
8. **Densité** : moins de cartes, plus d'air ; un écran doit se lire en quelques secondes. Si un bloc n'apporte pas de décision ou d'information nouvelle, replie-le (`details`) ou supprime-le.
9. **Garde** : la synthèse de la carte (panneau « Sélection » avec ses 4 chiffres), les tiroirs de détail, les exports, toutes les fonctions.

## Livraison
Même lot, mêmes fichiers, mêmes règles techniques (BRIEF.md), 0 erreur. Fais des captures avant/après de tes onglets (`shots-<lot>/clean-*.png`), regarde-les, et cite en fin de compte rendu : nombre de paragraphes / phrases retirés de l'écran ou passés en infobulle, et 5 exemples de titres avant → après.
