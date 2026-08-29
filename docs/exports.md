# Exports

Tous les exports sont produits dans le navigateur, dans la **devise d'affichage** choisie (€ ou $),
au format tableur français : séparateur `;`, UTF-8 avec BOM, décimales à virgule. Arrondis comme à l'écran (au plus proche, demi vers le haut) : montants à 2 décimales, quantités à 9, prix et PRU à 10. Ils s'ouvrent
directement dans Excel / LibreOffice. Les noms de fichiers sont datés (`AAAA-MM-JJ`). Deux exports
font exception à ce format (deux dernières lignes du tableau) : la sauvegarde JSON n'est pas un
tableur, et l'export portable suit les exigences de Koinly, pas celles d'Excel FR — détail des deux
dans `docs/backup-format.md`.

| Export                                | Où                                            | Contenu                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positions                             | Réglages → Données                            | Une ligne par actif : quantité, PRU, investi, prix, valeur, latent (€/%), réalisé, total, ROI, net investi, frais, remises.                                                                                                                                                                                                                                                       |
| Opérations                            | Réglages → Données ; page d'un actif (menu ⋮) | Historique normalisé chronologique : date, heure, actif, opération, quantité signée, montant all-in, prix unitaire, contrepartie, cours d'exécution et sa devise, frais, remise, réalisé sur la vente, **PRU après**, **quantité après**, source (Coinhouse / manuel), **compte** (libellé de la plateforme, ex. « Coinhouse », « Ledger »), identifiant, avertissements.         |
| Lots                                  | Réglages → Données                            | Lots ouverts : date, origine, contrepartie, quantités initiale/restante, coûts, prix all-in, valeur, latent.                                                                                                                                                                                                                                                                      |
| Série d'évolution                     | Carte « Évolution »                           | Jour (ou « Instant » ISO 8601 UTC en période 1J), valeur, investi, latent (€/%), quantité, prix, PRU — pour refaire ses propres graphiques. Prix vide = aucune cotation ce jour-là : la valeur est alors estimée au coût.                                                                                                                                                         |
| Rapport PDF                           | Réglages ; `#/report`                         | Rapport professionnel (page de garde, synthèse, répartition, positions, clôturées, méthodologie).                                                                                                                                                                                                                                                                                 |
| **Sauvegarde JSON**                   | Réglages → Données                            | État complet (lignes brutes, saisies, qualifications, comptes, réglages, taux, cache de prix, alertes, journal…) : la seule façon de restaurer ou de migrer vers un autre appareil, dans **cette** app. Format documenté et versionné : `docs/backup-format.md`.                                                                                                                  |
| **Export portable** (Koinly / Waltio) | Réglages → Données, juste après la sauvegarde | Achats, ventes, récompenses, frais reconstruits en euros par le moteur, au format Koinly Universal (virgule, point décimal, dates UTC, **sans** BOM — pas le format tableur ci-dessus). Ni les comptes ni les réglages ; un décompte chiffré des pertes s'affiche avant le téléchargement. Ce qui survit, ce qui ne survit pas : `docs/backup-format.md`, `docs/pivot-import.md`. |

Conventions : montants positifs ; quantité signée dans l'historique (négatif = sortie) ; `PRU après`
vide quand la quantité est nulle ; pourcentages en points (66,67 = +66,67 %).

## Mode discret

Le mode discret masque, à l'écran et dans le rapport PDF, les **montants et les quantités**
(« •••• »). Les **prix, PRU, prix unitaires et pourcentages restent visibles** : ce sont des prix,
pas des montants, et ils ne permettent pas de reconstituer un patrimoine. Les exports CSV (tableur
comme export portable) et la sauvegarde JSON ne sont **jamais masqués** : ce sont des données
brutes destinées à un tableur, à un autre outil ou à une restauration ; ne les partagez pas si vous
tenez à la discrétion.
