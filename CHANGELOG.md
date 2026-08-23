# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions : [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Added

- Bouton « Actualiser » sur la synthèse avec fraîcheur et source des prix, badge « périmé ».
- Fournisseurs de prix Kraken, Hyperliquid (HYPE, PURR et tokens spot Hyperliquid) et DefiLlama,
  prix en USD convertis au taux BCE du jour.
- Clé CoinGecko Demo optionnelle dans les réglages.
- Navigation en espaces : Vue d'ensemble (accueil), Investissement, Trading (en préparation), Plus ;
  anciens liens (`#/asset/btc`, `#/import`…) toujours valables.

### Changed

- Version 2 en préparation (branche `v2`) : espaces « Investissement » et « Trading » séparés,
  Vue d'ensemble consolidée, import Hyperliquid en lecture seule par adresse publique, journal de
  trading et statistiques de performance. La version 1.0.0 reste la version publiée d'ici là.

## [1.0.0] - 2026-08-23

### Security

- Données d'exemple entièrement synthétiques : le jeu de démonstration (et fixture de tests) est
  désormais inventé par un générateur déterministe (`npm run fixture`) ; l'ancien export « anonymisé »,
  dérivé d'un export réel par une transformation réversible, est retiré du dépôt et de son historique.
- Chaîne d'approvisionnement : scripts d'installation npm désactivés et délai de 7 jours avant toute
  nouvelle version (`.npmrc`), même délai côté Dependabot, actions GitHub épinglées par empreinte de
  commit, ajout de CodeQL, de la revue des dépendances sur les pull requests et du Scorecard OpenSSF
  (badges dans le README).

### Changed

- ROI rapporté au capital maximal engagé (portefeuille : apports − retraits en euros à leur plus
  haut ; actif : achats − produits à leur plus haut) au lieu de « Σ achats », qui comptait plusieurs
  fois le même euro transitant par l'USDC et se diluait à chaque rachat (docs/DECISIONS.md n° 15).
- « Investi » ne couvre plus que les positions cotées (même périmètre que « Valeur », donc
  Latent = Valeur − Investi) ; le coût des actifs sans prix est annoncé à part.

### Fixed

- Moteur (audit + oracle indépendant) : une migration à coût reporté n'est plus comptée comme un
  achat et un produit ; les remises de frais sont converties au taux implicite des frais Coinhouse
  (plus de frais net négatif de quelques millièmes) ; à la même seconde, un échange qui produit du
  cash/stablecoin précède celui qui en consomme ; une migration depuis un actif à historique
  incomplet crée quand même l'actif reçu (coût 0, avertissement) ; les apports/retraits en euros
  d'une opération non appliquée ne sont plus comptés ; un actif entièrement « à qualifier » est
  signalé par le contrôle de solde ; une cotation sans date fiable est convertie au dernier taux
  BCE connu ; vendre une poussière d'un actif jamais détenu est un historique manquant, pas un
  arrondi.
- Exports CSV : arrondi au plus proche (demi vers le haut) comme à l'écran, quantités à 9
  décimales, prix et PRU à 10 (PEPE/BONK ne sont plus tronqués).
- Accessibilité : la liste des positions est une vraie liste de liens (plus de rôles de tableau
  incorrects sur des liens), avec des libellés lus par les lecteurs d'écran (quantité, prix, valeur,
  latent, réalisé, total) ; l'en-tête visuel de colonnes est décoratif.
- Logos des cryptos : chargement immédiat (plus de `loading="lazy"`, qui laissait les badges vides
  dans un onglet masqué) et un réessai automatique en contournant les caches avant de retomber sur
  les initiales ; les échecs restants sont listés dans le diagnostic copiable (URL et statut HTTP)
  pour identifier les blocages côté navigateur.

### Added

- Bouton « Rapport PDF » en tête de la carte Synthèse du portefeuille (il n'était proposé qu'en pied
  de page).
- Test de cohérence transversale (`tests/e2e/coherence.spec.ts`) : synthèse, lignes, positions
  clôturées, fiche actif, onglet Calcul, rapport, export CSV et graphique doivent donner les mêmes
  chiffres, à l'arrondi près ; rejouable localement sur un export réel.
- Amélioration continue : section « Vérifications automatiques » (cohérence comptable, lots,
  soldes, opérations à qualifier, prix, sauvegarde) avec rappel en pied de portefeuille ; oracle
  indépendant qui recalcule tout depuis le CSV ; signalement GitHub pré-rempli avec le diagnostic ;
  page « Nouveautés » (changelog dans l'application) et bandeau à chaque mise à jour ; page
  d'erreur avec « Réessayer » et diagnostic (erreurs récentes capturées) ; surveillance
  automatique toutes les 6 h du site en ligne et des API de prix avec issue ouverte/refermée
  automatiquement ; seuils de couverture bloquants.
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
