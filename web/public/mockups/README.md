# Maquettes (design)

Maquettes HTML autonomes servant de référence visuelle/interaction, hors du
bundle applicatif (servies telles quelles par Vite depuis `public/`).

- **liste-drawer.html** — brique « liste d'indicateurs + drawer de détail » :
  table riche (toolbar, recherche, sélection multiple + barre d'actions
  groupées, pagination, densité réglable), **menu contextuel au clic droit sur
  un en-tête** (afficher/masquer des colonnes, déplacer/ réordonner, trier,
  filtrer), **réordonnancement par glisser-déposer** des en-têtes, **disposition
  mémorisée** (colonnes/ordre/filtres/tri/densité, localStorage) avec
  « Réinitialiser l'affichage », thème clair/sombre et rendu responsive.

Ouvrir en dev : `cd web && npm run dev` → http://localhost:5173/mockups/liste-drawer.html
