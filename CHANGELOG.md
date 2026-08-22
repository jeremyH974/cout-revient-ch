# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions : [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Added

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
