# Exports

Tous les exports sont produits dans le navigateur, dans la **devise d'affichage** choisie (€ ou $),
au format tableur français : séparateur `;`, UTF-8 avec BOM, décimales à virgule. Arrondis comme à l'écran (au plus proche, demi vers le haut) : montants à 2 décimales, quantités à 9, prix et PRU à 10. Ils s'ouvrent
directement dans Excel / LibreOffice. Les noms de fichiers sont datés (`AAAA-MM-JJ`).

| Export            | Où                                            | Contenu                                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positions         | Réglages → Données                            | Une ligne par actif : quantité, PRU, investi, prix, valeur, latent (€/%), réalisé, total, ROI, net investi, frais, remises.                                                                                                                                                                         |
| Opérations        | Réglages → Données ; page d'un actif (menu ⋮) | Historique normalisé chronologique : date, heure, actif, opération, quantité signée, montant all-in, prix unitaire, contrepartie, cours d'exécution et sa devise, frais, remise, réalisé sur la vente, **PRU après**, **quantité après**, source (Coinhouse / manuel), identifiant, avertissements. |
| Lots              | Réglages → Données                            | Lots ouverts : date, origine, contrepartie, quantités initiale/restante, coûts, prix all-in, valeur, latent.                                                                                                                                                                                        |
| Série d'évolution | Carte « Évolution »                           | Jour (ou « Instant » ISO 8601 UTC en période 1J), valeur, investi, latent (€/%), quantité, prix, PRU — pour refaire ses propres graphiques. Prix vide = aucune cotation ce jour-là : la valeur est alors estimée au coût.                                                                           |
| Rapport PDF       | Réglages ; `#/report`                         | Rapport professionnel (page de garde, synthèse, répartition, positions, clôturées, méthodologie).                                                                                                                                                                                                   |
| Sauvegarde JSON   | Réglages → Données                            | État complet (lignes brutes, saisies, qualifications, réglages, taux, cache de prix) : seule façon de restaurer ou de migrer vers un autre appareil.                                                                                                                                                |

Conventions : montants positifs ; quantité signée dans l'historique (négatif = sortie) ; `PRU après`
vide quand la quantité est nulle ; pourcentages en points (66,67 = +66,67 %).

## Mode discret

Le mode discret masque, à l'écran et dans le rapport PDF, les **montants et les quantités**
(« •••• »). Les **prix, PRU, prix unitaires et pourcentages restent visibles** : ce sont des prix,
pas des montants, et ils ne permettent pas de reconstituer un patrimoine. Les exports CSV et la
sauvegarde JSON ne sont **jamais masqués** : ce sont des données brutes destinées à un tableur ou à
une restauration ; ne les partagez pas si vous tenez à la discrétion.
