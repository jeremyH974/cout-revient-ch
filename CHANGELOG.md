# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions : [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Security

- Chaîne d'approvisionnement : scripts d'installation npm désactivés et délai de 7 jours avant toute
  nouvelle version (`.npmrc`), même délai côté Dependabot, actions GitHub épinglées par empreinte de
  commit, ajout de CodeQL, de la revue des dépendances sur les pull requests et du Scorecard OpenSSF
  (badges dans le README).

### Fixed

- Accessibilité : la liste des positions est une vraie liste de liens (plus de rôles de tableau
  incorrects sur des liens), avec des libellés lus par les lecteurs d'écran (quantité, prix, valeur,
  latent, réalisé, total) ; l'en-tête visuel de colonnes est décoratif.
- Logos des cryptos : chargement immédiat (plus de `loading="lazy"`, qui laissait les badges vides
  dans un onglet masqué) et un réessai automatique en contournant les caches avant de retomber sur
  les initiales ; les échecs restants sont listés dans le diagnostic copiable (URL et statut HTTP)
  pour identifier les blocages côté navigateur.

### Added

- Qualité automatisée : tests de bout en bout Playwright (Chromium desktop et mobile, WebKit sur
  les parcours visuels) sur le build de production — démo, import par fichier, PRU comparés au
  moteur, fiche actif, exports CSV/PDF, sauvegarde → effacement → restauration, thème et mode
  discret, diagnostic, accessibilité axe (WCAG 2.2 AA) sur toutes les pages, manifeste/service
  worker/CSP sans erreur console, tout réseau externe stubé ; Lighthouse CI avec seuils ; tests de
  propriétés fast-check sur les invariants du moteur (total = valeur + produits − achats, PRU
  invariant à la vente, lots réconciliés, survente bloquée). La CI ne déploie que si tout est vert.
- Mode démo : « Essayer avec des données d'exemple » sur l'accueil charge l'export anonymisé du
  dépôt (chunk séparé, chargé à la demande) avec un bandeau « Données d'exemple (fictives) » et un
  bouton « Quitter la démo » ; importer un fichier, saisir une opération ou restaurer une sauvegarde
  efface d'abord les données fictives (préférences d'affichage conservées) ; sauvegardes préfixées
  `demo-`.
- Aide et retours : section dans les réglages (et sur la carte d'échec d'import) avec un diagnostic
  copiable qui ne contient ni montant ni quantité (version, commit déployé, navigateur, colonnes des
  fichiers importés, compteurs, statuts d'intégrité, libellés d'opérations inconnus) et un lien vers
  les gabarits de signalement GitHub (fichier non reconnu, bug, idée) ; `SECURITY.md`.
- Graphiques : couleur par zone — vert en gain, rouge en perte, avec bascule exacte au
  croisement de la référence (zéro pour le latent, capital investi pour la valeur, PRU pour le
  prix) ; PRU tracé en trait plein avec étiquette et zone gain/perte entre prix et PRU ; légende ;
  PRU et prix rappelés dans l'en-tête et l'infobulle ; « PRU vs prix » par défaut sur un actif.
- Bascule de thème clair / sombre / système dans la barre ; couleur de la barre du navigateur
  mobile suit le thème.
- Cartes « Évolution » (portefeuille et actif) : courbe reconstituée jour par jour à partir des
  quantités réellement détenues × prix historiques (Coinbase Exchange, Kraken, CoinGecko ; cache
  IndexedDB), périodes 1J · 1S · 1M · 3M · 1A · Tout, métriques valeur / latent € / latent % /
  PRU vs prix, performance de période hors apports, marqueurs d'achats/ventes, export CSV de la
  série.
- Exports CSV : positions, opérations normalisées avec PRU après chaque ligne, lots ouverts,
  historique d'un actif — dans la devise affichée (voir `docs/exports.md`).
- Devise d'affichage EUR/USD : chaque mouvement converti au taux de référence BCE de son jour
  (Frankfurter, sans clé, cache incrémental inclus dans la sauvegarde) ; prix actuels au dernier
  taux ; bascule dans la barre et les réglages.
- Vrais logos des cryptos (62 SVG, web3icons MIT / cryptocurrency-icons CC0), repli sur les
  initiales pour les tickers sans source libre.
- Import de l'export Coinhouse (CSV reçu par e-mail) : détection du format par en-têtes,
  opérations à deux jambes, migrations (delisting + migration), abonnements, ré-import idempotent.
- Moteur : PRU = coût moyen pondéré all-in invariant à la vente, lots au prorata,
  réalisé / latent / total par actif, ROI, net investi, contrôle de cohérence par la colonne
  « Solde », stablecoins en section à part.
- Écrans mobile-first façon eToro : portefeuille (investi / valeur / P&L total), détail par actif
  (historique avec PRU après chaque ligne, positions, « comment c'est calculé »), saisie manuelle,
  réglages, aide, confidentialité.
- Prix en direct (CoinGecko groupé, repli Coinbase), prix manuels, cache hors ligne.
- Sauvegarde / restauration JSON, export CSV pour Excel, mode discret, PWA installable avec
  invite de mise à jour, image Open Graph pour Discord.
- Rapport de portefeuille en PDF (page de garde, synthèse, répartition, positions ouvertes,
  stablecoins, positions clôturées, méthodologie), généré dans le navigateur avec jsPDF chargé à
  la demande ; vue imprimable `#/report` de repli (« Imprimer / Enregistrer en PDF »), mode discret
  respecté.
- Squelette : Vite 8 + Svelte 5 + TypeScript, lint/format/typecheck/tests, CI GitHub Actions avec
  déploiement sur GitHub Pages.
